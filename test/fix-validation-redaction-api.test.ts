import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNeoReporter, generateReports, mergeReports } from '../src';
import { applyRedaction } from '../src/redact';
import { sampleSummary } from './fixtures/summary';

const ROOT = join(__dirname, '..');
const TSC = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'neo-fix-'));
}

function pluginConfig(projectRoot: string): Cypress.PluginConfigOptions {
  return { projectRoot, video: false, isTextTerminal: true, env: {}, expose: {} } as unknown as Cypress.PluginConfigOptions;
}

function emptyRun(projectRoot: string): CypressCommandLine.CypressRunResult {
  return { runs: [], config: { projectRoot } } as unknown as CypressCommandLine.CypressRunResult;
}

function unknownOptionWarnings(warn: { mock: { calls: Array<{ arguments: unknown[] }> } }): string[] {
  return warn.mock.calls.map(call => String(call.arguments[0])).filter(message => message.includes('unknown option'));
}

test('redaction masks every Set-Cookie value of a JSON array', () => {
  const summary = sampleSummary();
  summary.specs[0].tests[0].displayError = [
    'CypressError: cy.request() failed',
    'Headers: {',
    '  "set-cookie": [',
    '    "session=SETCOOKIE1; Path=/; HttpOnly",',
    '    "refresh=SETCOOKIE2; Path=/; HttpOnly"',
    '  ],',
    '  "content-type": "application/json"',
    '}'
  ].join('\n');
  const error = applyRedaction(summary).specs[0].tests[0].displayError ?? '';
  assert.ok(!error.includes('SETCOOKIE1'), error);
  assert.ok(!error.includes('SETCOOKIE2'), error);
  assert.match(error, /"set-cookie": \[\n {4}"\[redacted\]",\n {4}"\[redacted\]"\n {2}\],\n {2}"content-type": "application\/json"/);
});

test('redaction masks secret JSON keys and secret URL parameters in every captured text', () => {
  const summary = sampleSummary();
  const [failed] = summary.specs[0].tests;
  failed.displayError = 'Body: {"username":"bob","password":"hunter2","client_secret":"cs-1","apiKey":"ak-2","refresh_token":"rt-\\"3"}';
  failed.attempts = [{ state: 'failed', error: { message: 'Body: {\n  "x-api-key": "ak-4",\n  "user": "bob"\n}', stack: 'Body: username=bob&password=pw-5' } }];
  failed.steps = [{ phase: 'VISIT', message: 'https://app.test/callback?code=oauth-6&state=ok' }];
  failed.consoleErrors = ['GET https://acme.blob.core.windows.net/c/a.png?sv=1&sig=sas-7&se=2 403', 'https://app.test/#access_token=at-8&token_type=bearer'];
  failed.code = `cy.visit('/reset?token=tok-9&key=key-10');`;
  const [clean] = applyRedaction(summary).specs[0].tests;
  const text = JSON.stringify(clean);
  for (const secret of ['hunter2', 'cs-1', 'ak-2', 'rt-', 'ak-4', 'pw-5', 'oauth-6', 'sas-7', 'at-8', 'tok-9', 'key-10']) {
    assert.ok(!text.includes(secret), `${secret} in ${text}`);
  }
  assert.equal(clean.displayError, 'Body: {"username":"bob","password":"[redacted]","client_secret":"[redacted]","apiKey":"[redacted]","refresh_token":"[redacted]"}');
  assert.equal(clean.attempts?.[0].error?.message, 'Body: {\n  "x-api-key": "[redacted]",\n  "user": "bob"\n}');
  assert.equal(clean.steps?.[0].message, 'https://app.test/callback?code=[redacted]&state=ok');
  assert.equal(clean.consoleErrors?.[0], 'GET https://acme.blob.core.windows.net/c/a.png?sv=1&sig=[redacted]&se=2 403');
  assert.equal(clean.consoleErrors?.[1], 'https://app.test/#access_token=[redacted]&token_type=bearer');
});

test('redact must be false or an object of RegExp patterns and a replace function', t => {
  t.mock.method(console, 'warn', () => undefined);
  const config = pluginConfig(tempDir());
  for (const redact of [{ patterns: ['token=\\w+'] }, { patterns: 'token=\\w+' }, { patterns: [null] }, { replace: 'x' }, true, null, 'on']) {
    assert.throws(() => createNeoReporter(config, { redact } as never), /\[neo-reporter\] redact must be/, JSON.stringify(redact));
  }
  for (const redact of [undefined, false, {}, { patterns: [/token=\w+/] }, { replace: (text: string) => text }]) {
    assert.doesNotThrow(() => createNeoReporter(config, { redact } as never));
  }
});

test('the public generateReports rejects invalid options like the plugin and merge do', async t => {
  t.mock.method(console, 'log', () => undefined);
  t.mock.method(console, 'warn', () => undefined);
  const run = emptyRun(tempDir());
  await assert.rejects(generateReports(run, { theme: 'darkk' as never, outputs: ['html'] }), /Unknown theme "darkk"/);
  await assert.rejects(generateReports(run, { outputs: 'html' as never }), /outputs must be an array/);
  await assert.rejects(generateReports(run, { redact: { patterns: ['x'] } as never }), /redact must be/);
});

test('merge-only options warn as unknown in the plugin and generateReports, and merge accepts them', async t => {
  const warn = t.mock.method(console, 'warn', () => undefined);
  t.mock.method(console, 'log', () => undefined);
  const root = tempDir();
  createNeoReporter(pluginConfig(root), { baseline: 'last.json', reportRoot: root, summaryFiles: [] } as never);
  await generateReports(emptyRun(root), { baseline: 'last.json', outputs: [], history: false } as never);
  const pluginWarnings = unknownOptionWarnings(warn);
  assert.equal(pluginWarnings.length, 2);
  assert.match(pluginWarnings[0], /unknown option "baseline", "reportRoot", "summaryFiles"\. Known options: /);
  for (const message of pluginWarnings) assert.doesNotMatch(message.split('Known options:')[1], /baseline|reportRoot|summaryFiles/);

  warn.mock.resetCalls();
  await mergeReports({ reportRoot: root, summaryFiles: [], outputs: [], history: false });
  assert.deepEqual(unknownOptionWarnings(warn), []);
});

test('consumers that emit declarations can name every type the public API returns', () => {
  const consumer = tempDir();
  const packageDir = join(consumer, 'node_modules', 'cypress-neo-reporter');
  const build = spawnSync(process.execPath, [TSC, '-p', join(ROOT, 'tsconfig.build.json'), '--emitDeclarationOnly', '--outDir', join(packageDir, 'dist')], {
    encoding: 'utf-8'
  });
  assert.equal(build.status, 0, build.stdout);
  copyFileSync(join(ROOT, 'package.json'), join(packageDir, 'package.json'));
  symlinkSync(join(ROOT, 'node_modules', 'cypress'), join(consumer, 'node_modules', 'cypress'), 'junction');
  writeFileSync(
    join(consumer, 'root.ts'),
    [
      "import { createNeoReporter, mergeReports, type ReportSummary } from 'cypress-neo-reporter';",
      'export const handlers = (config: Cypress.PluginConfigOptions) => createNeoReporter(config, {});',
      'export const merge = () => mergeReports({});',
      'export function details(summary: ReportSummary) {',
      '  const [test] = summary.specs[0].tests;',
      '  return { history: summary.history, run: summary.history?.runs[0], ci: summary.ci, steps: test.steps, attempt: test.attempts?.[0], video: test.video, network: test.network };',
      '}'
    ].join('\n')
  );
  writeFileSync(
    join(consumer, 'plugin.ts'),
    [
      "import { createNeoReporter, mergeReports } from 'cypress-neo-reporter/plugin';",
      'export const handlers = (config: Cypress.PluginConfigOptions) => createNeoReporter(config, {});',
      'export const merge = () => mergeReports({});'
    ].join('\n')
  );
  writeFileSync(
    join(consumer, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'node16',
        moduleResolution: 'node16',
        strict: true,
        skipLibCheck: false,
        declaration: true,
        emitDeclarationOnly: true,
        outDir: 'out',
        types: []
      },
      files: ['root.ts', 'plugin.ts']
    })
  );
  const check = spawnSync(process.execPath, [TSC, '-p', consumer], { encoding: 'utf-8' });
  assert.equal(check.status, 0, check.stdout);
});
