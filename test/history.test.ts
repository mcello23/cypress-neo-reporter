import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateHtmlReport, generateJUnitXml, mergeReports, type HistoryOptions, type ReportSummary, type TestData } from '../src';
import { attachRunHistory, createHistoryLoader } from '../src/history';
import { sampleSummary } from './fixtures/summary';

const CART_TEST = 'Cart summary › removes the last item';
const CART_SPEC = 'cypress/e2e/cart/cart-summary.cy.ts';
const CART_KEY = `${CART_SPEC} › ${CART_TEST}`;
const SAVED_CARD_KEY = 'cypress/e2e/checkout/payment.cy.ts › Checkout › pays with a saved card';

interface AdoResult {
  automatedTestName?: string;
  testCaseTitle?: string;
  outcome: string;
  durationInMs?: number;
}

function isolate(t: TestContext) {
  const env = { ...process.env };
  t.after(() => {
    process.env = env;
  });
  for (const key of [
    'SYSTEM_ACCESSTOKEN',
    'AZURE_DEVOPS_PAT',
    'SYSTEM_COLLECTIONURI',
    'SYSTEM_TEAMFOUNDATIONCOLLECTIONURI',
    'SYSTEM_TEAMPROJECT',
    'BUILD_BUILDID',
    'BUILD_DEFINITIONID',
    'RELEASE_DEFINITIONID',
    'RELEASE_RELEASEID',
    'NEO_TEST_RUN_NAME'
  ]) {
    delete process.env[key];
  }
  return { log: t.mock.method(console, 'log', () => undefined), warn: t.mock.method(console, 'warn', () => undefined) };
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'neo-history-'));
}

function currentRun(): ReportSummary {
  return { ...sampleSummary(), history: undefined };
}

function runOn(day: number, branch: string, cart: Partial<TestData> = {}): ReportSummary {
  const summary = currentRun();
  return {
    ...summary,
    timestamp: `2026-11-0${day}T10:00:00.000Z`,
    ci: { branch, build: `2026110${day}.1` },
    specs: summary.specs.map(spec => ({ ...spec, tests: spec.tests.map(item => (item.fullTitle === CART_TEST ? { ...item, ...cart } : item)) }))
  };
}

function junitTestCases(summary: ReportSummary): Array<{ name: string; classname: string }> {
  return [...generateJUnitXml(summary).matchAll(/<testcase name="([^"]*)" classname="([^"]*)"/g)].map(([, name, classname]) => ({ name, classname }));
}

function fakeAzureDevOps(t: TestContext, results: (runId: number) => AdoResult[]): URL[] {
  const runs = [3, 2, 1].map(id => ({ id, name: 'E2E regression', build: { id: String(100 + id), name: `20261105.${id}` } }));
  const requested: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL) => {
    const url = new URL(String(input));
    requested.push(url);
    if (url.pathname.endsWith('/test/runs')) {
      const isFirstWeek = Date.now() - Date.parse(url.searchParams.get('maxLastUpdatedDate') ?? '') < 60_000;
      const value = isFirstWeek
        ? runs.map((run, index) => ({
            ...run,
            state: 'Completed',
            totalTests: 74,
            passedTests: 74,
            completedDate: new Date(Date.now() - index * 86_400_000).toISOString()
          }))
        : [];
      return Response.json({ value });
    }
    const runId = Number(url.pathname.match(/Runs\/(\d+)\/results/)?.[1]);
    const skip = Number(url.searchParams.get('$skip'));
    const top = Math.min(Number(url.searchParams.get('$top')), 1000);
    return Response.json({ value: results(runId).slice(skip, skip + top) });
  });
  return requested;
}

function panelHtml(html: string, title: string): string {
  const start = html.indexOf(`</svg>${title}</h2>`);
  assert.ok(start >= 0, `${title} panel`);
  return html.slice(start, html.indexOf('</section>', start));
}

test('Azure DevOps history matches the test names of the JUnit file this package writes', async t => {
  isolate(t);
  process.env.AZURE_DEVOPS_PAT = 'token';
  const testCases = junitTestCases(currentRun());
  const shapes: Record<string, (testCase: { name: string; classname: string }) => Omit<AdoResult, 'outcome'>> = {
    'JUnit name in both fields': ({ name }) => ({ automatedTestName: name, testCaseTitle: name }),
    'class-qualified automated name': ({ name, classname }) => ({ automatedTestName: `${classname}.${name}`, testCaseTitle: name }),
    'space-joined name of other reporters': ({ name }) => ({ automatedTestName: name.split(' › ').join(' ') })
  };
  let shape = shapes['JUnit name in both fields'];
  const requested = fakeAzureDevOps(t, runId =>
    testCases.map(testCase => ({
      ...shape(testCase),
      outcome: runId === 3 && testCase.name === CART_TEST ? 'Failed' : 'Passed',
      durationInMs: runId * 1000
    }))
  );

  for (const [label, current] of Object.entries(shapes)) {
    shape = current;
    const summary = currentRun();
    await attachRunHistory(summary, createHistoryLoader({ organization: 'your-org', project: 'your-project', runs: 3 }, 'main'));
    assert.equal(summary.history?.family, 'E2E regression', label);
    assert.equal(summary.history.source, 'Azure DevOps', label);
    assert.deepEqual(
      summary.history.runs.map(run => [run.label, run.total, run.failed]),
      [
        ['20261105.1', 74, 0],
        ['20261105.2', 74, 0],
        ['20261105.3', 74, 1]
      ],
      label
    );
    assert.equal(Object.keys(summary.history.tests).length, 74, label);
    assert.equal(summary.history.tests[CART_KEY], 'PPF', label);
    assert.equal(summary.history.durations?.[SAVED_CARD_KEY], 2000, label);
    assert.equal(summary.history.durations?.[CART_KEY], 1500, label);
  }
  assert.ok(requested.every(url => url.href.startsWith('https://dev.azure.com/your-org/your-project/_apis/')));
  assert.ok(requested.filter(url => url.pathname.endsWith('/test/runs')).every(url => url.searchParams.get('branchName') === 'refs/heads/main'));
});

test('Azure DevOps history reads every page of a run with more than 1000 results', async t => {
  isolate(t);
  process.env.AZURE_DEVOPS_PAT = 'token';
  const names = [
    ...Array.from({ length: 1500 }, (_, index) => `Other suite test ${index}`),
    ...junitTestCases(currentRun()).map(({ name }) => name.split(' › ').join(' '))
  ];
  fakeAzureDevOps(t, () => names.map(name => ({ automatedTestName: name, outcome: 'Passed' })));
  const summary = currentRun();
  await attachRunHistory(summary, createHistoryLoader({ organization: 'your-org', project: 'your-project', runName: 'E2E regression', runs: 3 }));
  assert.equal(summary.history?.runs[0].total, 1574);
  assert.equal(Object.keys(summary.history.tests).length, 74);
});

test('warns when the Azure DevOps token would be sent over plain http', t => {
  const { warn } = isolate(t);
  process.env.AZURE_DEVOPS_PAT = 'token';
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('offline');
  });
  createHistoryLoader({ organization: 'https://tfs.example.test/tfs/DefaultCollection', project: 'your-project' });
  assert.equal(warn.mock.callCount(), 0);
  createHistoryLoader({ organization: 'http://tfs.example.test:8080/tfs/DefaultCollection', project: 'your-project' });
  assert.equal(warn.mock.callCount(), 1);
  assert.match(String(warn.mock.calls[0].arguments[0]), /http:\/\/.*unencrypted/);
});

test('file history keeps one slim line per run and prefers runs of the same branch', async t => {
  const { log } = isolate(t);
  const path = join(tempDir(), 'history', 'neo-history.jsonl');
  const options: HistoryOptions = { provider: 'file', path, runs: 2 };
  const record = (summary: ReportSummary) => attachRunHistory(summary, createHistoryLoader(options));

  const first = runOn(1, 'main', { state: 'passed', duration: 1000 });
  await record(first);
  assert.equal(first.history, undefined);
  await record(runOn(2, 'feature', { state: 'failed' }));
  await record(runOn(3, 'main', { state: 'passed', duration: 3000 }));
  await record(runOn(4, 'main', { state: 'failed', duration: 2000 }));
  const current = runOn(5, 'main');
  await record(current);

  assert.equal(current.history?.family, 'E2E regression');
  assert.equal(current.history.source, 'neo-history.jsonl');
  assert.deepEqual(
    current.history.runs.map(run => [run.label, run.total, run.failed]),
    [
      ['20261103.1', 74, 6],
      ['20261104.1', 74, 7]
    ]
  );
  assert.equal(current.history.tests[CART_KEY], 'PF');
  assert.equal(current.history.durations?.[CART_KEY], 3000);
  assert.match(String(log.mock.calls.at(-1)?.arguments[0]), /Loaded 2 previous runs of "E2E regression" from neo-history\.jsonl/);

  const fresh = runOn(6, 'fresh-branch');
  await record(fresh);
  assert.deepEqual(
    fresh.history?.runs.map(run => run.label),
    ['20261104.1', '20261105.1']
  );

  const text = readFileSync(path, 'utf-8');
  const lines = text.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(lines.length, 6);
  assert.deepEqual(Object.keys(lines[5]).sort(), ['branch', 'date', 'label', 'name', 'tests']);
  assert.deepEqual(lines[5].tests[CART_KEY], { s: 'F', d: 14_200 });
  assert.equal(Object.keys(lines[5].tests).length, 74);
  assert.doesNotMatch(text, /base64|displayError|AssertionError/);
});

test('file history trims the file to five times the runs it compares', async t => {
  isolate(t);
  const path = join(tempDir(), 'neo-history.jsonl');
  for (let day = 1; day <= 7; day++) {
    await attachRunHistory(runOn(day, 'main'), createHistoryLoader({ provider: 'file', path, runs: 1 }));
  }
  const dates = readFileSync(path, 'utf-8')
    .trim()
    .split('\n')
    .map(line => JSON.parse(line).date);
  assert.deepEqual(
    dates,
    [3, 4, 5, 6, 7].map(day => `2026-11-0${day}T10:00:00.000Z`)
  );
});

test('merge writes one history line for the merged run instead of one per shard', async t => {
  isolate(t);
  const root = tempDir();
  const path = join(root, 'neo-history.jsonl');
  const options: HistoryOptions = { provider: 'file', path };
  await attachRunHistory(runOn(1, 'main', { state: 'passed' }), createHistoryLoader(options));
  for (const [index, shard] of [runOn(2, 'main'), runOn(3, 'main')].entries()) {
    mkdirSync(join(root, `shard-${index}`));
    writeFileSync(join(root, `shard-${index}`, 'E2E-regression.json'), JSON.stringify(shard));
    await attachRunHistory(shard, createHistoryLoader(options));
  }

  const result = await mergeReports({ reportRoot: root, history: options });

  assert.deepEqual(
    result?.summary.history?.runs.map(run => run.label),
    ['20261101.1']
  );
  assert.equal(result.summary.history.tests[CART_KEY], 'P');
  const dates = readFileSync(path, 'utf-8')
    .trim()
    .split('\n')
    .map(line => JSON.parse(line).date);
  assert.deepEqual(dates, ['2026-11-01T10:00:00.000Z', result.summary.timestamp]);
});

test('merge with a baseline report compares the merged run with that report', async t => {
  isolate(t);
  const root = tempDir();
  mkdirSync(join(root, 'shard-1'));
  writeFileSync(join(root, 'shard-1', 'E2E-regression.json'), JSON.stringify(runOn(2, 'main')));
  const baseline = join(root, 'baseline.json');
  writeFileSync(baseline, JSON.stringify(runOn(1, 'main', { state: 'passed' })));

  const result = await mergeReports({ reportRoot: root, baseline });

  assert.equal(result?.summary.mergedFrom, 1);
  assert.equal(result.summary.history?.source, 'baseline.json');
  assert.deepEqual(
    result.summary.history.runs.map(run => run.label),
    ['20261101.1']
  );
  assert.equal(result.summary.history.tests[CART_KEY], 'P');
  assert.match(readFileSync(result.files.markdown!, 'utf-8'), /History vs the last 1 runs of "E2E regression": \*\*1 new failures\*\* · 6 known · 0 fixed/);
  await assert.rejects(mergeReports({ reportRoot: root, baseline: join(root, 'missing.json') }), /baseline/);
});

test('the run history panel names the provider it came from', () => {
  const summary = sampleSummary();
  const html = generateHtmlReport({ ...summary, history: { ...summary.history!, source: 'neo-history.jsonl' } });
  assert.match(panelHtml(html, 'Run history'), /last 10 runs of “E2E regression” from neo-history\.jsonl/);
  assert.doesNotMatch(html, /Azure DevOps/);
  assert.match(panelHtml(generateHtmlReport(currentRun()), 'Run history'), /provider: 'file'/);
});

test('Most unstable ranks tests that flip between pass and fail above tests that keep failing', () => {
  const summary = sampleSummary();
  summary.history!.tests = {
    [SAVED_CARD_KEY]: 'PFPPFPPFPP',
    'cypress/e2e/checkout/payment.cy.ts › Checkout › scenario 1': 'PPPPFPPPPP',
    [CART_KEY]: 'PPFFFFFFFF'
  };
  const panel = panelHtml(generateHtmlReport(summary), 'Most unstable');
  assert.match(panel, /pays with a saved card<\/span><span class="panel-row-value">6 flips/);
  assert.ok(panel.indexOf('pays with a saved card') < panel.indexOf('scenario 1'));
  assert.doesNotMatch(panel, /removes the last item/);
});

test('Slower than usual lists passing tests that took over twice their usual time', () => {
  const summary = sampleSummary();
  summary.history!.durations = {
    [SAVED_CARD_KEY]: 2000,
    'cypress/e2e/checkout/payment.cy.ts › Checkout › scenario 1': 1000,
    'cypress/e2e/checkout/payment.cy.ts › Checkout › scenario 3': 1000,
    [CART_KEY]: 2000
  };
  const html = generateHtmlReport(summary);
  const panel = panelHtml(html, 'Slower than usual');
  assert.match(panel, /pays with a saved card<\/span><span class="panel-row-value">2\.0s → 6\.1s/);
  assert.match(panel, /scenario 3/);
  assert.doesNotMatch(panel, /scenario 1<|removes the last item/);
  assert.doesNotMatch(generateHtmlReport(sampleSummary()), /Slower than usual/);
});
