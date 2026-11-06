import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as api from '../src';
import { generateHtmlReport, generateReports, mergeReports } from '../src';
import * as plugin from '../src/plugin';
import { sampleSummary } from './fixtures/summary';

const ROOT = join(__dirname, '..');
const PACKAGE = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')) as { version: string; dependencies?: unknown; files: string[] };
const TSC = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'neo-reporter-'));
}

function cli(...args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', join(ROOT, 'src', 'cli.ts'), ...args], { cwd: ROOT, encoding: 'utf-8' });
}

test('the entry points export only the public API', () => {
  assert.deepEqual(Object.keys(api).sort(), [
    'generateHtmlReport',
    'generateJUnitXml',
    'generateMarkdownSummary',
    'generateReports',
    'mergeReports',
    'neoReporter'
  ]);
  assert.deepEqual(Object.keys(plugin).sort(), ['generateReports', 'mergeReports', 'neoReporter']);
  assert.equal(plugin.generateReports, api.generateReports);
  const hidesInternals: Extract<keyof NonNullable<Parameters<typeof generateReports>[1]>, 'stepsFilePath' | 'historyLoader'> extends never
    ? true
    : false = true;
  assert.ok(hidesInternals);
});

test('the JSON report carries the schema and reporter versions', async t => {
  t.mock.method(console, 'log', () => undefined);
  const projectRoot = tempDir();
  const runResults = { runs: [], config: { projectRoot } } as unknown as CypressCommandLine.CypressRunResult;
  const files = await generateReports(runResults, { outputs: ['json'], history: false });
  const json = JSON.parse(readFileSync(files.json!, 'utf-8'));
  assert.equal(json.schemaVersion, 1);
  assert.equal(json.reporterVersion, PACKAGE.version);
});

test('mergeReports stamps the versions and warns about shards with another schema', async t => {
  const warn = t.mock.method(console, 'warn', () => undefined);
  t.mock.method(console, 'log', () => undefined);
  const root = tempDir();
  const shards = { 'current.json': { schemaVersion: 1 }, 'old.json': {}, 'future.json': { schemaVersion: 2, reporterVersion: '3.0.0' } };
  for (const [name, versions] of Object.entries(shards)) writeFileSync(join(root, name), JSON.stringify({ ...sampleSummary(), ...versions }));
  const result = await mergeReports({ reportRoot: root, history: false, outputs: [] });
  assert.equal(result?.summary.schemaVersion, 1);
  assert.equal(result?.summary.reporterVersion, PACKAGE.version);
  const warnings = warn.mock.calls.map(call => String(call.arguments[0])).filter(message => message.includes('schema'));
  assert.equal(warnings.length, 2);
  assert.match(warnings.find(message => message.includes('old.json')) ?? '', /uses report schema none \(reporter unknown\), expected 1/);
  assert.match(warnings.find(message => message.includes('future.json')) ?? '', /uses report schema 2 \(reporter 3\.0\.0\), expected 1/);
});

test('the video player is vendored and shipped with the package', () => {
  assert.equal(PACKAGE.dependencies, undefined);
  assert.ok(PACKAGE.files.includes('vendor'));
  assert.ok(existsSync(join(ROOT, 'vendor', 'plyr-3.8.5', 'LICENSE.md')));
  const summary = sampleSummary();
  summary.specs[0].video = { name: 'spec.mp4', path: 'spec.mp4', base64: 'data:video/mp4;base64,AAAA' };
  const html = generateHtmlReport(summary);
  assert.ok(html.includes(readFileSync(join(ROOT, 'vendor', 'plyr-3.8.5', 'plyr.min.js'), 'utf-8')));
  assert.ok(html.includes(readFileSync(join(ROOT, 'vendor', 'plyr-3.8.5', 'plyr.css'), 'utf-8')));
});

test('published types compile for a consumer without extra setup', () => {
  const consumer = tempDir();
  const packageDir = join(consumer, 'node_modules', 'cypress-neo-reporter');
  const build = spawnSync(process.execPath, [TSC, '-p', join(ROOT, 'tsconfig.build.json'), '--emitDeclarationOnly', '--outDir', join(packageDir, 'dist')], {
    encoding: 'utf-8'
  });
  assert.equal(build.status, 0, build.stdout);
  copyFileSync(join(ROOT, 'package.json'), join(packageDir, 'package.json'));
  symlinkSync(join(ROOT, 'node_modules', 'cypress'), join(consumer, 'node_modules', 'cypress'), 'junction');
  writeFileSync(
    join(consumer, 'consumer.ts'),
    [
      "import 'cypress-neo-reporter/support';",
      "import { neoReporter } from 'cypress-neo-reporter/plugin';",
      "import { generateReports, type ReportSummary } from 'cypress-neo-reporter';",
      'export const summary: ReportSummary | undefined = undefined;',
      'export const plugins = [neoReporter, generateReports];',
      "cy.step('Open the cart', 'VISIT');"
    ].join('\n')
  );
  writeFileSync(
    join(consumer, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { target: 'ES2022', strict: true, skipLibCheck: false, noEmit: true, types: [] }, files: ['consumer.ts'] })
  );
  for (const resolution of [
    ['--module', 'node16', '--moduleResolution', 'node16'],
    ['--module', 'esnext', '--moduleResolution', 'bundler']
  ]) {
    const check = spawnSync(process.execPath, [TSC, '-p', consumer, ...resolution], { encoding: 'utf-8' });
    assert.equal(check.status, 0, check.stdout);
  }
});

test('cli prints its version', () => {
  const result = cli('--version');
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), PACKAGE.version);
  assert.equal(cli('-v').stdout.trim(), PACKAGE.version);
});

test('cli usage errors go to stderr with exit code 2', () => {
  const cases: Array<[string[], RegExp]> = [
    [[], /Missing command/],
    [['report'], /Unknown command 'report'/],
    [['merge', '--bogus'], /Unknown option '--bogus'/],
    [['merge', 'a', 'b'], /Unexpected argument 'b'/],
    [['merge', '--theme', 'pink'], /Unknown theme: pink/]
  ];
  for (const [args, message] of cases) {
    const result = cli(...args);
    assert.equal(result.status, 2, args.join(' '));
    assert.equal(result.stdout, '');
    assert.match(result.stderr, message);
    assert.match(result.stderr, /Usage: neo-reporter/);
  }
});

test('cli help goes to stdout', () => {
  const help = cli('--help');
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Commands:\n {2}merge \[dir\]/);
  const mergeHelp = cli('merge', '--help');
  assert.equal(mergeHelp.status, 0);
  assert.match(mergeHelp.stdout, /Usage: neo-reporter merge \[dir\] \[options\]/);
});

test('cli merge exits 1 when there is nothing to merge', () => {
  const result = cli('merge', tempDir(), '--no-history');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No report JSON found/);
});
