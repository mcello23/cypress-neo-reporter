import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { generateHtmlReport, generateJUnitXml, generateReports, mergeReports, type ReportSummary } from '../src';
import { writeReportOutputs } from '../src/output';
import { buildReportSummary } from '../src/summary';
import { validateOptions } from '../src/validate';
import { testVideoPath } from '../src/video';
import { sampleSummary } from './fixtures/summary';

const PASSED_TITLE = ['Cart @smoke', 'adds an item @fast @smoke'];
const FAILED_TITLE = ['Cart @smoke', 'emails the total to me@example.com'];
const SHOT_BYTES = Buffer.alloc(3000, 7);

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'neo-features-'));
}

function quiet(t: TestContext) {
  t.mock.method(console, 'log', () => undefined);
  return t.mock.method(console, 'warn', () => undefined);
}

function writeFile(path: string, content: Buffer = SHOT_BYTES): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return path;
}

function cartRun(projectRoot: string, extra: { testingType?: string; withEvidence?: boolean } = {}): CypressCommandLine.CypressRunResult {
  const shots = join(projectRoot, 'cypress/screenshots/cart.cy.js');
  const video = join(projectRoot, 'cypress/videos/cart.cy.js.mp4');
  const screenshots = extra.withEvidence
    ? [writeFile(join(shots, `${PASSED_TITLE.join(' -- ')}.png`)), writeFile(join(shots, `${FAILED_TITLE.join(' -- ')} (failed).png`))]
    : [];
  if (extra.withEvidence) writeFile(testVideoPath(video, FAILED_TITLE), Buffer.from('clip'));
  return {
    browserName: 'chrome',
    browserVersion: '141',
    totalDuration: 3000,
    totalSuites: 1,
    totalTests: 2,
    totalPassed: 1,
    totalFailed: 1,
    totalPending: 0,
    totalSkipped: 0,
    config: { projectRoot, testingType: extra.testingType ?? 'e2e', viewportWidth: 1280, viewportHeight: 720 },
    runs: [
      {
        spec: { absolute: join(projectRoot, 'cypress/e2e/cart.cy.js'), name: 'cart.cy.js', relative: 'cypress/e2e/cart.cy.js' },
        stats: { tests: 2, passes: 1, failures: 1, pending: 0, skipped: 0, duration: 3000 },
        screenshots: screenshots.map(path => ({ path })),
        video: extra.withEvidence ? video : null,
        tests: [
          { title: PASSED_TITLE, state: 'passed', duration: 1000, attempts: [{ state: 'passed' }], displayError: null },
          { title: FAILED_TITLE, state: 'failed', duration: 2000, attempts: [{ state: 'failed' }], displayError: 'AssertionError: wrong total' }
        ]
      }
    ]
  } as unknown as CypressCommandLine.CypressRunResult;
}

function readJson(file?: string): ReportSummary {
  assert.ok(file);
  return JSON.parse(readFileSync(file, 'utf-8')) as ReportSummary;
}

function withBrowser(summary: ReportSummary, browser: string): ReportSummary {
  return { ...summary, browser, specs: summary.specs.map(spec => ({ ...spec, browser })) };
}

function writeShard(root: string, folder: string, summary: ReportSummary): string {
  return writeFile(join(root, folder, 'E2E-regression.json'), Buffer.from(JSON.stringify(summary)));
}

test('tags come from @words in every title segment, without duplicates or e-mail addresses', () => {
  const projectRoot = tempDir();
  const summary = buildReportSummary(cartRun(projectRoot), projectRoot, { history: false });
  const [passed, failed] = summary.specs[0].tests;
  assert.deepEqual(passed.tags, ['@smoke', '@fast']);
  assert.deepEqual(failed.tags, ['@smoke']);
});

test('junit xml lists the tags of a test as properties', () => {
  const projectRoot = tempDir();
  const xml = generateJUnitXml(buildReportSummary(cartRun(projectRoot), projectRoot, { history: false }));
  assert.equal(xml.match(/<properties>/g)?.length, 2);
  assert.ok(xml.includes('<properties><property name="tag" value="@smoke"/><property name="tag" value="@fast"/></properties>'));
  assert.doesNotMatch(generateJUnitXml(sampleSummary()), /<properties>/);
});

test('html report has a tag breakdown and tag: search', () => {
  const projectRoot = tempDir();
  const html = generateHtmlReport(buildReportSummary(cartRun(projectRoot), projectRoot, { history: false }));
  assert.ok(html.includes('data-tags="@smoke @fast"'));
  assert.ok(
    html.includes(
      `data-tag="@smoke" onclick="searchAll('tag:' + this.dataset.tag)"><span class="panel-row-name">@smoke</span><span class="panel-row-value">1 · <span class="count-failed">1</span> · <span class="count-flaky">0</span>`
    )
  );
  assert.doesNotMatch(generateHtmlReport(sampleSummary()), /<\/svg>Tags<\/h2>/);

  const script = html.slice(html.indexOf('const SEARCH_TOKEN_PATTERN'), html.indexOf('function applyFilters()'));
  const { parseSearch, matchesTokens } = new Function(`${script}; return { parseSearch, matchesTokens };`)();
  const fields = { status: 'passed', spec: '', error: '', owner: '', group: '', history: '', tag: '@smoke @fast' };
  assert.equal(matchesTokens(parseSearch('tag:smoke').tokens, fields), true);
  assert.equal(matchesTokens(parseSearch('tag:@fast').tokens, fields), true);
  assert.equal(matchesTokens(parseSearch('tag:smok').tokens, fields), false);
  assert.equal(matchesTokens(parseSearch('tag:fast').tokens, { ...fields, tag: '' }), false);
});

test('only tests with failure evidence get their screenshots embedded', async t => {
  quiet(t);
  const projectRoot = tempDir();
  const files = await generateReports(cartRun(projectRoot, { withEvidence: true }), { history: false, outputs: ['json'] });
  const [passed, failed] = readJson(files.json).specs[0].tests;
  assert.equal(passed.screenshots?.length, 1);
  assert.equal(passed.screenshots?.[0].base64, undefined);
  assert.equal(failed.screenshots?.[0].base64, `data:image/png;base64,${SHOT_BYTES.toString('base64')}`);
  assert.equal(failed.video?.base64, `data:video/mp4;base64,${Buffer.from('clip').toString('base64')}`);
});

test('maxEmbedMb caps screenshots too, failed tests first, and says what it left out', t => {
  const warn = quiet(t);
  const dir = tempDir();
  const summary = sampleSummary();
  const flaky = summary.specs[0].tests.find(test => test.state === 'flaky');
  const failed = summary.specs[1].tests.find(test => test.state === 'failed');
  assert.ok(flaky && failed);
  flaky.screenshots = [{ name: 'flaky.png', path: writeFile(join(dir, 'shots/flaky.png')) }];
  failed.screenshots = [{ name: 'failed.png', path: writeFile(join(dir, 'shots/failed.png')) }];

  const files = writeReportOutputs(summary, dir, 'E2E regression', ['json'], { maxEmbedMb: 5000 / (1024 * 1024) });
  const tests = readJson(files.json).specs.flatMap(spec => spec.tests);
  assert.ok(tests.find(test => test.fullTitle === failed.fullTitle)?.screenshots?.[0].base64);
  assert.equal(tests.find(test => test.fullTitle === flaky.fullTitle)?.screenshots?.[0].base64, undefined);
  assert.ok(warn.mock.calls.some(call => /1 screenshots or recordings .* maxEmbedMb/.test(String(call.arguments[0]))));
});

test("assets: 'folder' copies evidence next to the report and keeps base64 out of the JSON", async t => {
  quiet(t);
  const projectRoot = tempDir();
  const outputDir = join(projectRoot, 'reports');
  const files = await generateReports(cartRun(projectRoot, { withEvidence: true }), {
    history: false,
    reportName: 'E2E',
    outputDir,
    assets: 'folder',
    outputs: ['json', 'html']
  });
  const json = readFileSync(files.json ?? '', 'utf-8');
  assert.doesNotMatch(json, /base64/);
  const [, failed] = readJson(files.json).specs[0].tests;
  const shot = failed.screenshots?.[0].path ?? '';
  const clip = failed.video?.path ?? '';
  assert.match(shot, /^E2E\.[0-9a-f]{8}-assets\/1-.+\.png$/);
  assert.match(clip, /^E2E\.[0-9a-f]{8}-assets\/2-.+\.mp4$/);
  assert.deepEqual(readFileSync(join(outputDir, shot)), SHOT_BYTES);
  assert.ok(existsSync(join(outputDir, clip)));
  const html = readFileSync(files.html ?? '', 'utf-8');
  assert.ok(html.includes(`src="${shot}"`));
  assert.ok(html.includes(`data-video-src="${clip}"`));
  assert.ok(html.includes('new Plyr('));
});

test('merge embeds the evidence of shards written with assets in a folder', async t => {
  quiet(t);
  const projectRoot = tempDir();
  const reportRoot = join(projectRoot, 'downloaded');
  const shard = sampleSummary();
  const [failed] = shard.specs[0].tests;
  failed.screenshots = [{ name: 'failed.png', path: 'E2E-assets/1-failed.png' }];
  failed.video = { name: 'failed.mp4', path: 'E2E-assets/2-failed.mp4' };
  writeFile(join(reportRoot, 'shard-1/E2E-assets/1-failed.png'));
  writeFile(join(reportRoot, 'shard-1/E2E-assets/2-failed.mp4'), Buffer.from('clip'));
  writeShard(reportRoot, 'shard-1', shard);
  const result = await mergeReports({ reportRoot, history: false, outputs: ['html'], outputDir: join(projectRoot, 'merged') });
  const html = readFileSync(result?.files.html ?? '', 'utf-8');
  assert.ok(html.includes(`data:image/png;base64,${SHOT_BYTES.toString('base64')}`));
  assert.ok(html.includes(`data:video/mp4;base64,${Buffer.from('clip').toString('base64')}`));
  assert.match(html, /<div class="video-player" data-video-id="test-video-\d+-0"><\/div>/);
});

test('validation knows the size options and rejects bad values', t => {
  const warn = quiet(t);
  validateOptions({ assets: 'folder', maxEmbedMb: 20 });
  assert.equal(warn.mock.calls.length, 0);
  assert.throws(() => validateOptions({ assets: 'folders' as 'folder' }), /Unknown assets "folders"/);
  assert.throws(() => validateOptions({ maxEmbedMb: -1 }), /maxEmbedMb must be a number of 0 or more/);
});

test('every spec records its browser and testing type', () => {
  const projectRoot = tempDir();
  const [spec] = buildReportSummary(cartRun(projectRoot, { testingType: 'component' }), projectRoot, { history: false }).specs;
  assert.equal(spec.browser, 'chrome 141');
  assert.equal(spec.testingType, 'component');
});

test('browser and testing type show only when a report mixes them', () => {
  const label = 'title="Browser and testing type of this run"';
  assert.doesNotMatch(generateHtmlReport(withBrowser(sampleSummary(), 'chrome 141')), new RegExp(label));
  const mixed = withBrowser(sampleSummary(), 'chrome 141');
  mixed.specs[0] = { ...mixed.specs[0], browser: 'firefox 130', testingType: 'component' };
  mixed.specs[1] = { ...mixed.specs[1], testingType: 'e2e' };
  const html = generateHtmlReport(mixed);
  assert.ok(html.includes(`${label}>firefox 130 · component</span>`));
  assert.ok(html.includes(`${label}>chrome 141 · e2e</span>`));
  assert.ok(html.includes('<span class="test-jump-spec">checkout/payment.cy.ts (firefox 130 · component)</span>'));
});

test('each shard writes its JSON under its own name, and a re-run replaces its own file', t => {
  quiet(t);
  const dir = tempDir();
  writeReportOutputs(sampleSummary(), dir, 'E2E regression', ['json']);
  writeReportOutputs(sampleSummary(), dir, 'E2E regression', ['json']);
  writeReportOutputs(withBrowser(sampleSummary(), 'firefox 130'), dir, 'E2E regression', ['json']);
  const shards = readdirSync(dir).filter(name => name.endsWith('.json'));
  assert.equal(shards.length, 2);
  shards.forEach(name => assert.match(name, /^E2E-regression\.[0-9a-f]{8}\.json$/));
  writeReportOutputs({ ...sampleSummary(), mergedFrom: 2 }, dir, 'E2E regression', ['json']);
  assert.ok(existsSync(join(dir, 'E2E-regression.json')));
});

test('merge lists every browser, counts repeated specs and warns about them', async t => {
  const warn = quiet(t);
  const root = tempDir();
  writeShard(root, 'shard-1', withBrowser(sampleSummary(), 'chrome 141'));
  writeShard(root, 'shard-2', withBrowser(sampleSummary(), 'firefox 130'));
  const matrix = await mergeReports({ reportRoot: root, history: false, outputs: [] });
  assert.equal(matrix?.summary.browser, 'chrome 141, firefox 130');
  assert.ok(!warn.mock.calls.some(call => String(call.arguments[0]).includes('more than one merged report')));

  writeShard(root, 'shard-3', withBrowser(sampleSummary(), 'chrome 141'));
  const repeated = await mergeReports({ reportRoot: root, history: false, outputs: [] });
  assert.equal(repeated?.summary.totalTests, sampleSummary().totalTests * 3);
  const warning = warn.mock.calls.map(call => String(call.arguments[0])).find(message => message.includes('more than one merged report'));
  assert.match(warning ?? '', /cypress\/e2e\/checkout\/payment\.cy\.ts · chrome 141 \(2×\)/);
  assert.doesNotMatch(warning ?? '', /firefox/);
});

test('merge orders specs by file, whatever order the shards come in', async t => {
  quiet(t);
  const root = tempDir();
  const shardWith = (specFile: string) => {
    const summary = sampleSummary();
    summary.specs = [{ ...summary.specs[0], specFile, specName: specFile }];
    return summary;
  };
  const later = writeShard(root, 'b', shardWith('cypress/e2e/z.cy.ts'));
  const earlier = writeShard(root, 'a', shardWith('cypress/e2e/a.cy.ts'));
  const result = await mergeReports({ reportRoot: root, summaryFiles: [later, earlier], history: false, outputs: [] });
  assert.deepEqual(
    result?.summary.specs.map(spec => spec.specFile),
    ['cypress/e2e/a.cy.ts', 'cypress/e2e/z.cy.ts']
  );
});
