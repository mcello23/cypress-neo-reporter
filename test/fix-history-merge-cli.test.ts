import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateMarkdownSummary, mergeReports, type ReportSummary, type TestData } from '../src';
import { checkGate } from '../src/gate';
import { attachRunHistory, createHistoryLoader } from '../src/history';
import { notify } from '../src/notify';
import { writeReportOutputs } from '../src/output';
import { sampleSummary } from './fixtures/summary';

const ROOT = join(__dirname, '..');
const LOGIN = ['Login', 'rejects a wrong password'];
const CART_TEST = 'cypress/e2e/cart/cart-summary.cy.ts › Cart summary › removes the last item';
const CI_ENV = [
  'SYSTEM_ACCESSTOKEN',
  'AZURE_DEVOPS_PAT',
  'SYSTEM_COLLECTIONURI',
  'SYSTEM_TEAMFOUNDATIONCOLLECTIONURI',
  'SYSTEM_TEAMPROJECT',
  'SYSTEM_JOBPOSITIONINPHASE',
  'SYSTEM_TOTALJOBSINPHASE',
  'CI_NODE_INDEX',
  'GITHUB_ACTIONS'
];

function isolate(t: TestContext) {
  const env = { ...process.env };
  t.after(() => {
    process.env = env;
  });
  CI_ENV.forEach(key => delete process.env[key]);
  return { log: t.mock.method(console, 'log', () => undefined), warn: t.mock.method(console, 'warn', () => undefined) };
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'neo-fix-'));
}

function cli(args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', join(ROOT, 'src', 'cli.ts'), ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    env: { ...process.env, NEO_SLACK_WEBHOOK: '', NEO_TEAMS_WEBHOOK: '' }
  });
}

function loginRun(day: number, admin: TestData['state'], shop: TestData['state']): ReportSummary {
  const spec = (file: string, state: TestData['state']) => ({
    specFile: `cypress/e2e/${file}`,
    specName: file,
    tests: [{ title: LOGIN, fullTitle: LOGIN.join(' › '), state, duration: 1000, displayError: state === 'failed' ? `AssertionError: ${file}` : null }],
    duration: 1000,
    passes: state === 'passed' ? 1 : 0,
    failures: state === 'failed' ? 1 : 0,
    pending: 0,
    skipped: 0,
    total: 1
  });
  const specs = [spec('admin/login.cy.ts', admin), spec('shop/login.cy.ts', shop)];
  const passed = specs.filter(item => item.passes).length;
  return {
    ...sampleSummary(),
    timestamp: `2026-11-0${day}T10:00:00.000Z`,
    ci: { branch: 'main', build: `2026110${day}.1` },
    history: undefined,
    specs,
    totalSpecs: 2,
    totalTests: 2,
    totalPassed: passed,
    totalFailed: 2 - passed,
    totalPending: 0,
    totalSkipped: 0,
    passRate: passed * 50
  };
}

function runOn(day: number, cart: TestData['state']): ReportSummary {
  const summary = sampleSummary();
  return {
    ...summary,
    timestamp: `2026-11-0${day}T10:00:00.000Z`,
    ci: { branch: 'main', build: `2026110${day}.1` },
    history: undefined,
    specs: summary.specs.map(spec => ({
      ...spec,
      tests: spec.tests.map(item => (`${spec.specFile} › ${item.fullTitle}` === CART_TEST ? { ...item, state: cart } : item))
    }))
  };
}

function captureWebhooks(t: TestContext) {
  const posted: Array<{ url: string; body: any }> = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    posted.push({ url, body: JSON.parse(String(init.body)) });
    return new Response('ok');
  });
  return posted;
}

test('file history tells apart two specs whose tests share a full title', async t => {
  isolate(t);
  const path = join(tempDir(), 'neo-history.jsonl');
  await attachRunHistory(loginRun(1, 'passed', 'failed'), createHistoryLoader({ provider: 'file', path }));
  const current = loginRun(2, 'failed', 'failed');
  await attachRunHistory(current, createHistoryLoader({ provider: 'file', path }));

  assert.deepEqual(current.history?.tests, {
    'cypress/e2e/admin/login.cy.ts › Login › rejects a wrong password': 'P',
    'cypress/e2e/shop/login.cy.ts › Login › rejects a wrong password': 'F'
  });
  assert.deepEqual(current.history.durations, { 'cypress/e2e/admin/login.cy.ts › Login › rejects a wrong password': 1000 });
  assert.match(generateMarkdownSummary(current), /\*\*1 new failures\*\* · 1 known · 0 fixed/);
  assert.equal(checkGate(current, { failOn: 'new' }), false);
});

test('a baseline report tells apart two specs whose tests share a full title', async t => {
  isolate(t);
  const root = tempDir();
  mkdirSync(join(root, 'shard'));
  writeFileSync(join(root, 'shard', 'login.json'), JSON.stringify(loginRun(2, 'failed', 'failed')));
  const baseline = join(root, 'baseline.json');
  writeFileSync(baseline, JSON.stringify(loginRun(1, 'passed', 'failed')));

  const result = await mergeReports({ reportRoot: root, baseline, outputs: ['markdown'] });

  assert.match(readFileSync(result!.files.markdown!, 'utf-8'), /\*\*1 new failures\*\* · 1 known · 0 fixed/);
});

test('merging the same shards again keeps one history line for the run', async t => {
  isolate(t);
  const root = tempDir();
  const path = join(root, 'neo-history.jsonl');
  await attachRunHistory(runOn(1, 'passed'), createHistoryLoader({ provider: 'file', path }));
  mkdirSync(join(root, 'shards'));
  writeFileSync(join(root, 'shards', 'E2E.json'), JSON.stringify(runOn(2, 'failed')));
  const merge = () => mergeReports({ reportRoot: join(root, 'shards'), outputs: ['markdown'], history: { provider: 'file', path } });

  const first = await merge();
  assert.equal(checkGate(first!.summary, { failOn: 'new' }), false);
  const again = await merge();

  assert.equal(checkGate(again!.summary, { failOn: 'new' }), false);
  assert.deepEqual(
    again!.summary.history?.runs.map(run => run.label),
    ['20261101.1']
  );
  assert.equal(readFileSync(path, 'utf-8').trim().split('\n').length, 2);
  assert.equal(again!.summary.timestamp, '2026-11-02T10:00:00.000Z');
});

test('a run JSON keeps its name across browser updates and parallel spec rebalancing', t => {
  isolate(t);
  const dir = tempDir();
  const write = (browser: string, specs: number) => {
    const summary = { ...sampleSummary(), history: undefined, browser };
    summary.specs = summary.specs.slice(0, specs);
    return writeReportOutputs(summary, dir, 'E2E', ['json']).json;
  };

  assert.equal(write('chrome 141.0.1', 3), write('chrome 146.0.7680.216', 3));
  assert.notEqual(write('chrome 141', 3), write('firefox 141', 3));
  assert.notEqual(write('chrome 141', 3), write('chrome 141', 4));

  process.env.SYSTEM_TOTALJOBSINPHASE = '3';
  process.env.SYSTEM_JOBPOSITIONINPHASE = '2';
  const slot2 = write('chrome 141', 3);
  assert.equal(write('chrome 141', 4), slot2);
  process.env.SYSTEM_JOBPOSITIONINPHASE = '3';
  assert.notEqual(write('chrome 141', 3), slot2);

  delete process.env.SYSTEM_TOTALJOBSINPHASE;
  delete process.env.SYSTEM_JOBPOSITIONINPHASE;
  process.env.CI_NODE_INDEX = '1';
  assert.equal(write('chrome 141', 3), write('chrome 141', 4));
  assert.equal(readdirSync(dir).length, 6);
});

test('cli: an empty --min-pass-rate is a usage error, not 0%', () => {
  const dir = tempDir();
  const report = join(dir, 'report.json');
  writeFileSync(report, JSON.stringify(sampleSummary()));
  for (const value of ['', ' ']) {
    const result = cli(['gate', report, '--min-pass-rate', value]);
    assert.equal(result.status, 2, JSON.stringify(value));
    assert.match(result.stderr, /--min-pass-rate must be a number from 0 to 100/);
  }
});

test('cli: merge --time-zone with an unknown zone is a usage error', () => {
  const result = cli(['merge', tempDir(), '--time-zone', 'Mars/Base']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /^\[neo-reporter\] Unknown time zone: Mars\/Base\n\nUsage: neo-reporter merge/);
});

test('file history skips a JSON line without tests and drops it from the file', async t => {
  isolate(t);
  const path = join(tempDir(), 'neo-history.jsonl');
  await attachRunHistory(runOn(1, 'passed'), createHistoryLoader({ provider: 'file', path }));
  writeFileSync(path, `${readFileSync(path, 'utf-8')}${JSON.stringify({ date: '2026-11-01T11:00:00.000Z', name: 'E2E regression', label: 'x' })}\n`);

  const current = runOn(2, 'failed');
  await attachRunHistory(current, createHistoryLoader({ provider: 'file', path }));

  assert.equal(current.history?.runs.length, 1);
  const dates = readFileSync(path, 'utf-8')
    .trim()
    .split('\n')
    .map(line => JSON.parse(line).date);
  assert.deepEqual(dates, ['2026-11-01T10:00:00.000Z', '2026-11-02T10:00:00.000Z']);
});

test('merge only reads evidence files from inside the shard folder', async t => {
  isolate(t);
  const root = tempDir();
  const shardDir = join(root, 'reports', 'shard-1');
  mkdirSync(join(shardDir, 'E2E-assets'), { recursive: true });
  const secret = join(root, 'id_rsa');
  writeFileSync(secret, 'FAKE-PRIVATE-KEY');
  writeFileSync(join(shardDir, 'E2E-assets', '1-shot.png'), 'REAL-SCREENSHOT');
  const summary = { ...sampleSummary(), history: undefined };
  const failed = summary.specs[0].tests[0];
  failed.screenshots = [
    { name: 'absolute.png', path: secret },
    { name: 'escape.png', path: '../../id_rsa' },
    { name: 'shot.png', path: 'E2E-assets/1-shot.png' },
    { name: 'embedded.png', path: '/elsewhere/shot.png', base64: 'data:image/png;base64,RU1CRURERUQ=' }
  ];
  failed.video = { name: 'clip.mp4', path: secret };
  writeFileSync(join(shardDir, 'E2E.json'), JSON.stringify(summary));

  const result = await mergeReports({ reportRoot: join(root, 'reports'), outputs: ['json'], history: false });

  const merged = result!.summary.specs.find(spec => spec.specFile === summary.specs[0].specFile)!.tests[0];
  assert.deepEqual(
    merged.screenshots?.map(shot => [shot.name, shot.base64]),
    [
      ['shot.png', `data:image/png;base64,${Buffer.from('REAL-SCREENSHOT').toString('base64')}`],
      ['embedded.png', 'data:image/png;base64,RU1CRURERUQ=']
    ]
  );
  assert.equal(merged.video, undefined);
  assert.ok(!readFileSync(result!.files.json!, 'utf-8').includes(Buffer.from('FAKE-PRIVATE-KEY').toString('base64')));
});

test('merge ignores a leftover 1.x steps file without a warning', async t => {
  const { warn } = isolate(t);
  const root = tempDir();
  writeFileSync(join(root, 'E2E.json'), JSON.stringify({ ...sampleSummary(), history: undefined }));
  writeFileSync(join(root, 'neo-reporter-steps.json'), JSON.stringify({ 'cart.cy.ts › Cart › adds an item': { steps: [] } }));
  const result = await mergeReports({ reportRoot: root, outputs: [], history: false });
  assert.equal(result?.summary.mergedFrom, 1);
  assert.ok(warn.mock.calls.every(call => !String(call.arguments[0]).includes('neo-reporter-steps')));
});

test('Teams shows failure messages as plain text, not Markdown', async t => {
  isolate(t);
  const posted = captureWebhooks(t);
  const summary = sampleSummary();
  summary.specs[0].tests[0].displayError = 'Session expired. [Re-run the deploy approval](https://evil.example/approve)';
  assert.equal(await notify(summary, { teams: 'https://teams.example/hook' }), true);

  const body: Array<{ type: string; text?: string; inlines?: Array<{ type: string; text: string }> }> = posted[0].body.attachments[0].content.body;
  assert.ok(body.filter(block => block.type === 'TextBlock').every(block => !block.text?.includes('evil.example')));
  const failure = body.find(block => block.inlines?.some(inline => inline.text.includes('evil.example')));
  assert.equal(failure?.type, 'RichTextBlock');
  assert.deepEqual(failure.inlines, [{ type: 'TextRun', text: '• 1× Session expired. [Re-run the deploy approval](https://evil.example/approve)' }]);
});

test('warns when the Azure DevOps token would go over plain http from the pipeline collection URL', t => {
  for (const variable of ['SYSTEM_TEAMFOUNDATIONCOLLECTIONURI', 'SYSTEM_COLLECTIONURI']) {
    const { warn } = isolate(t);
    t.mock.method(globalThis, 'fetch', async () => {
      throw new Error('offline');
    });
    process.env.SYSTEM_ACCESSTOKEN = 'token';
    process.env.SYSTEM_TEAMPROJECT = 'your-project';
    process.env[variable] = 'http://tfs.example.test:8080/tfs/DefaultCollection/';
    createHistoryLoader({});
    assert.equal(warn.mock.callCount(), 1, variable);
    assert.match(String(warn.mock.calls[0].arguments[0]), /http:\/\/.*unencrypted.*tfs\.example\.test:8080/, variable);
    t.mock.restoreAll();
  }
});

test('Slack and Teams link the run page on GitHub Actions when no report URL is given', async t => {
  isolate(t);
  const posted = captureWebhooks(t);
  const summary = sampleSummary();
  const runPage = 'https://github.com/acme/storefront/actions/runs/42';
  summary.ci = { ...summary.ci, buildUrl: runPage };

  await notify(summary, { slack: 'https://hooks.slack.example/a', teams: 'https://teams.example/b' });
  assert.ok(!posted[0].body.blocks[0].text.text.includes('Open the full report'));
  assert.equal(posted[1].body.attachments[0].content.actions, undefined);

  process.env.GITHUB_ACTIONS = 'true';
  await notify(summary, { slack: 'https://hooks.slack.example/a', teams: 'https://teams.example/b' });
  assert.ok(posted[2].body.blocks[0].text.text.endsWith(`<${runPage}|Open the full report>`));
  assert.deepEqual(posted[3].body.attachments[0].content.actions, [{ type: 'Action.OpenUrl', title: 'Open the full report', url: runPage }]);

  await notify(summary, { slack: 'https://hooks.slack.example/a' }, 'https://ci.example/report.html');
  assert.ok(posted[4].body.blocks[0].text.text.endsWith('<https://ci.example/report.html|Open the full report>'));
});
