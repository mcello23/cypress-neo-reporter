import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { createNeoReporter, generateHtmlReport, generateReports, mergeReports } from '../src';
import { applyRedaction } from '../src/redact';
import { SCHEMA_VERSION, type ReportSummary } from '../src/types';
import { validateOptions } from '../src/validate';
import { sampleSummary } from './fixtures/summary';

const ROOT = join(__dirname, '..');
const REQUEST_URL = 'https://shop.test/api/items?page=2&sig=abc#frag';
const TARGET_URL = 'https://shop.test/?tenant=7&access_token=xyz';
const KEPT_REQUEST_URL = 'https://shop.test/api/items?page=2&sig=[redacted]#frag';
const KEPT_TARGET_URL = 'https://shop.test/?tenant=7&access_token=[redacted]';
const DARK_CSS = ':root[data-theme="dark"] { --color-brand: #123456; }';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'neo-options-'));
}

function quiet(t: TestContext) {
  t.mock.method(console, 'log', () => undefined);
  return t.mock.method(console, 'warn', () => undefined);
}

function withUrls(): ReportSummary {
  const summary = { ...sampleSummary(), schemaVersion: SCHEMA_VERSION, environment: TARGET_URL };
  summary.specs[0].tests[0].network = [{ status: 503, url: REQUEST_URL, timestamp: '2026-11-06T10:43:00.000Z' }];
  return summary;
}

function requestUrl(summary?: ReportSummary): string | undefined {
  const specFile = sampleSummary().specs[0].specFile;
  return summary?.specs.find(spec => spec.specFile === specFile)?.tests[0].network?.[0]?.url;
}

function contentSecurityPolicy(html: string): string | undefined {
  return html.match(/<meta http-equiv="Content-Security-Policy" content="[^"]*">/)?.[0];
}

function count(text: string, part: string): number {
  return text.split(part).length - 1;
}

function pluginConfig(projectRoot: string): Cypress.PluginConfigOptions {
  return { projectRoot, video: false, isTextTerminal: true, cypressBinaryRoot: join(projectRoot, 'no-cypress'), env: {}, expose: {} } as unknown as Cypress.PluginConfigOptions;
}

function runResults(projectRoot: string): CypressCommandLine.CypressRunResult {
  const spec = 'cypress/e2e/cart.cy.ts';
  return {
    totalDuration: 1000,
    totalSuites: 1,
    totalTests: 1,
    totalPassed: 1,
    totalFailed: 0,
    totalPending: 0,
    totalSkipped: 0,
    config: { projectRoot },
    runs: [
      {
        spec: { absolute: join(projectRoot, spec), relative: spec, name: 'cart.cy.ts' },
        stats: { tests: 1, passes: 1, failures: 0, pending: 0, skipped: 0, duration: 1000 },
        screenshots: [],
        video: null,
        tests: [{ title: ['Cart', 'adds items'], state: 'passed', duration: 1000, attempts: [{ state: 'passed' }], displayError: null }]
      }
    ]
  } as unknown as CypressCommandLine.CypressRunResult;
}

test('keepQuery keeps query strings and fragments, with secret parameters still masked', () => {
  const kept = applyRedaction(withUrls(), { redact: { keepQuery: true } });
  assert.equal(requestUrl(kept), KEPT_REQUEST_URL);
  assert.equal(kept.environment, KEPT_TARGET_URL);

  const trimmed = applyRedaction(withUrls());
  assert.equal(requestUrl(trimmed), 'https://shop.test/api/items');
  assert.equal(trimmed.environment, 'https://shop.test/');
});

test('keepQuery masks every parameter named like a secret, in request URLs and the target URL', () => {
  const summary = withUrls();
  summary.environment = 'https://shop.test/?tenant=7&client_secret=CS1';
  summary.specs[0].tests[0].network = [
    'https://s3.test/b/k?X-Amz-Credential=AK1&X-Amz-Security-Token=ST1&X-Amz-Signature=SG1&page=2',
    'https://app.test/cb#id_token=IT1&refresh_token=RT1&state=x',
    'https://api.test/x?api_key=AK2&apikey=AK3&signature=SG2&X-Goog-Signature=SG3&sessionId=SE1&user=ana'
  ].map(url => ({ status: 503, url, timestamp: '2026-11-06T10:43:00.000Z' }));
  const kept = applyRedaction(summary, { redact: { keepQuery: true } });
  assert.deepEqual(
    kept.specs[0].tests[0].network?.map(request => request.url),
    [
      'https://s3.test/b/k?X-Amz-Credential=[redacted]&X-Amz-Security-Token=[redacted]&X-Amz-Signature=[redacted]&page=2',
      'https://app.test/cb#id_token=[redacted]&refresh_token=[redacted]&state=x',
      'https://api.test/x?api_key=[redacted]&apikey=[redacted]&signature=[redacted]&X-Goog-Signature=[redacted]&sessionId=SE1&user=ana'
    ]
  );
  assert.equal(kept.environment, 'https://shop.test/?tenant=7&client_secret=[redacted]');
});

test('keepQuery must be a boolean', () => {
  assert.throws(() => createNeoReporter(pluginConfig(tempDir()), { redact: { keepQuery: 'yes' } as never }), /redact must be/);
});

test('merge keeps query strings only with keepQuery, in the API and the CLI', async t => {
  quiet(t);
  const dir = tempDir();
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ ...withUrls(), history: undefined }));

  const trimmed = await mergeReports({ reportRoot: dir, outputDir: tempDir(), history: false, outputs: ['json'] });
  assert.equal(requestUrl(trimmed?.summary), 'https://shop.test/api/items');

  const kept = await mergeReports({ reportRoot: dir, outputDir: tempDir(), history: false, outputs: ['json'], redact: { keepQuery: true } });
  assert.equal(requestUrl(kept?.summary), KEPT_REQUEST_URL);
  assert.equal(kept?.summary.environment, KEPT_TARGET_URL);

  const out = tempDir();
  const cli = spawnSync(
    process.execPath,
    ['--import', 'tsx', join(ROOT, 'src', 'cli.ts'), 'merge', dir, '--keep-query', '--no-history', '--outputs', 'json', '--out', out],
    { cwd: ROOT, encoding: 'utf-8', env: { ...process.env, NEO_SLACK_WEBHOOK: '', NEO_TEAMS_WEBHOOK: '' } }
  );
  assert.equal(cli.status, 0, cli.stderr);
  const [file] = readdirSync(out).filter(name => name.endsWith('.json'));
  const merged = JSON.parse(readFileSync(join(out, file), 'utf-8')) as ReportSummary;
  assert.equal(requestUrl(merged), requestUrl(kept?.summary));
  assert.equal(merged.environment, kept?.summary.environment);
});

test('css is added after the built-in styles and leaves the Content-Security-Policy as it is', () => {
  const plain = generateHtmlReport(sampleSummary());
  const styled = generateHtmlReport({ ...sampleSummary(), css: DARK_CSS });
  const head = styled.slice(0, styled.indexOf('</head>'));
  const block = head.indexOf(`<style>${DARK_CSS}</style>`);
  assert.ok(block > head.indexOf('</style>'));
  assert.equal(head.lastIndexOf('<style>'), block);
  assert.equal(contentSecurityPolicy(styled), contentSecurityPolicy(plain));
  assert.ok(contentSecurityPolicy(plain));
  assert.equal(count(styled, '<style>'), count(plain, '<style>') + 1);
  assert.ok(!plain.includes(DARK_CSS));
});

test('css cannot close its style element', () => {
  const html = generateHtmlReport({ ...sampleSummary(), css: '</style><script>alert(1)</script></STYLE >' });
  const start = html.lastIndexOf('<style>', html.indexOf('</head>')) + '<style>'.length;
  const end = start + html.slice(start).search(/<\/style/i);
  assert.equal(html.slice(start, end), '<\\/style><script>alert(1)</script><\\/STYLE >');
  assert.ok(html.slice(end).startsWith('</style>\n</head>'));
});

test('css keeps the < of range media and container queries', () => {
  const css = '@media (width < 600px) { body { color: red; } } @container (400px <= inline-size < 800px) { a { color: blue; } }';
  assert.ok(generateHtmlReport({ ...sampleSummary(), css }).includes(`<style>${css}</style>`));
});

test('css is kept in the JSON and in merged reports, and a merge can replace it', async t => {
  const warn = quiet(t);
  const projectRoot = tempDir();
  const files = await generateReports(runResults(projectRoot), { css: DARK_CSS, history: false, outputs: ['html', 'json'] });
  const jsonPath = files.json ?? assert.fail('no JSON written');
  assert.equal((JSON.parse(readFileSync(jsonPath, 'utf-8')) as ReportSummary).css, DARK_CSS);
  assert.ok(readFileSync(files.html ?? assert.fail('no HTML written'), 'utf-8').includes(`<style>${DARK_CSS}</style>`));

  const merged = await mergeReports({ reportRoot: dirname(jsonPath), outputDir: tempDir(), history: false, outputs: ['json'] });
  assert.equal(merged?.summary.css, DARK_CSS);
  const other = 'body { letter-spacing: 0.01em; }';
  const replaced = await mergeReports({ reportRoot: dirname(jsonPath), outputDir: tempDir(), history: false, outputs: ['json'], css: other });
  assert.equal(replaced?.summary.css, other);

  const bad = tempDir();
  writeFileSync(join(bad, 'run.json'), JSON.stringify({ ...sampleSummary(), schemaVersion: SCHEMA_VERSION, css: {} }));
  assert.equal(await mergeReports({ reportRoot: bad, outputDir: tempDir(), history: false, outputs: ['json'] }), null);
  assert.ok(warn.mock.calls.some(call => String(call.arguments[0]).includes('unexpected field values')));
});

test('css must be a string', () => {
  assert.throws(() => validateOptions({ css: 42 as never }), /css must be a string/);
});

test('fileName names the files while reportName stays the label, in a run, a merge and the CLI', async t => {
  quiet(t);
  const projectRoot = tempDir();
  const files = await generateReports(runResults(projectRoot), {
    reportName: 'Chrome',
    fileName: 'Release 42 Chrome',
    history: false,
    outputs: ['html', 'json', 'markdown'],
    reportUrl: 'https://reports.test/{file}'
  });
  const reports = join(projectRoot, 'cypress/reports');
  assert.equal(files.html, join(reports, 'Release-42-Chrome.html'));
  assert.match(basename(files.json!), /^Release-42-Chrome\.[0-9a-f]{8}\.json$/);
  const markdown = readFileSync(files.markdown!, 'utf-8');
  assert.match(markdown, /^### ✅ Cypress - Chrome\n/);
  assert.ok(markdown.includes('[📄 Open the full HTML report](https://reports.test/Release-42-Chrome.html)'));
  const run = JSON.parse(readFileSync(files.json!, 'utf-8')) as ReportSummary;
  assert.equal(run.suiteLabel, 'Chrome');
  assert.equal(run.fileName, 'Release 42 Chrome');

  const kept = await mergeReports({ reportRoot: reports, outputDir: tempDir(), history: false, outputs: ['html'] });
  assert.equal(basename(kept!.files.html!), 'Release-42-Chrome.html');
  const renamed = await mergeReports({ reportRoot: reports, outputDir: tempDir(), history: false, outputs: ['html'], reportName: 'Nightly' });
  assert.equal(basename(renamed!.files.html!), 'Nightly.html');

  const out = tempDir();
  const cli = spawnSync(
    process.execPath,
    ['--import', 'tsx', join(ROOT, 'src', 'cli.ts'), 'merge', reports, '--name', 'Nightly', '--file-name', 'Release 42 Nightly', '--no-history', '--out', out],
    { cwd: ROOT, encoding: 'utf-8', env: { ...process.env, NEO_SLACK_WEBHOOK: '', NEO_TEAMS_WEBHOOK: '' } }
  );
  assert.equal(cli.status, 0, cli.stderr);
  assert.deepEqual(readdirSync(out).sort(), ['Release-42-Nightly.html', 'Release-42-Nightly.summary.md']);
  assert.match(readFileSync(join(out, 'Release-42-Nightly.summary.md'), 'utf-8'), /^### ✅ Cypress - Nightly\n/);
});
