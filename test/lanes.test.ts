import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateMarkdownSummary, mergeReports, type ReportSummary } from '../src';
import { buildRunSummaryText } from '../src/markdown';
import { writeReportOutputs } from '../src/output';
import { collectFailureGroups } from '../src/prompts';
import { DEFAULT_OUTPUTS, SCHEMA_VERSION } from '../src/types';
import { validateOptions } from '../src/validate';
import { sampleSummary } from './fixtures/summary';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'neo-lanes-'));
}

function quiet(t: TestContext): void {
  t.mock.method(console, 'log', () => undefined);
  t.mock.method(console, 'warn', () => undefined);
}

function lane(label: string, passing = false): ReportSummary {
  const summary = { ...sampleSummary(), schemaVersion: SCHEMA_VERSION, suiteLabel: label };
  if (!passing) return summary;
  summary.specs = summary.specs.map(spec => ({
    ...spec,
    failures: 0,
    tests: spec.tests.map(item => (item.state === 'failed' || item.state === 'flaky' ? { ...item, state: 'passed' as const } : item))
  }));
  summary.totalPassed += summary.totalFailed;
  summary.totalFailed = 0;
  summary.passRate = Math.floor((summary.totalPassed / summary.totalTests) * 100);
  return summary;
}

function withEvidence(summary: ReportSummary): ReportSummary {
  const shot = { name: 'shot.png', path: 'shot.png', base64: 'data:image/png;base64,AAAA' };
  const video = { name: 'clip.mp4', path: 'clip.mp4', base64: 'data:video/mp4;base64,AAAA' };
  summary.specs.forEach(spec => {
    spec.video = video;
    spec.tests.forEach(item => {
      item.screenshots = [shot];
      item.video = video;
      item.steps = [{ phase: 'STEP', message: 'step' }];
      item.code = "it('x', () => {})";
    });
  });
  return summary;
}

test('summary output is opt-in and accepted by validation', () => {
  assert.ok(!(DEFAULT_OUTPUTS as readonly string[]).includes('summary'));
  assert.doesNotThrow(() => validateOptions({ outputs: ['summary'] }));
});

test('summary output drops evidence, and steps and code of passed tests', t => {
  quiet(t);
  const dir = tempDir();
  const files = writeReportOutputs(withEvidence(lane('Lane A')), dir, 'Lane A', ['summary']);
  assert.match(files.summary ?? '', /Lane-A\.[0-9a-f]{8}\.summary\.json$/);
  const slim = JSON.parse(readFileSync(files.summary!, 'utf-8')) as ReportSummary;
  const tests = slim.specs.flatMap(spec => spec.tests);
  assert.ok(slim.specs.every(spec => spec.video === undefined));
  assert.ok(tests.every(item => item.screenshots === undefined && item.video === undefined));
  assert.ok(tests.filter(item => item.state === 'passed').every(item => item.steps === undefined && item.code === undefined));
  assert.ok(tests.filter(item => item.state !== 'passed').every(item => item.steps?.length && item.code));
  assert.equal(slim.totalTests, tests.length);
  assert.ok(slim.history);
});

test('merge reads a slim summary only when its full JSON is missing', async t => {
  quiet(t);
  const root = tempDir();
  writeReportOutputs(lane('Lane A'), root, 'Lane A', ['json', 'summary']);
  writeReportOutputs(lane('Lane B', true), root, 'Lane B', ['summary']);
  assert.equal(readdirSync(root).filter(file => file.endsWith('.json')).length, 3);
  const result = await mergeReports({ reportRoot: root, history: false, outputs: [] });
  assert.equal(result?.summary.mergedFrom, 2);
});

test('merging lanes adds a lane table sorted failed, then flaky, then name', async t => {
  quiet(t);
  const root = tempDir();
  const flaky = lane('Lane C', true);
  flaky.specs[0].tests[2].state = 'flaky';
  flaky.environment = 'https://other.acme.test';
  writeReportOutputs(lane('Lane B', true), root, 'Lane B', ['summary']);
  writeReportOutputs(flaky, root, 'Lane C', ['summary']);
  writeReportOutputs(lane('Lane A'), root, 'Lane A', ['summary']);
  const result = await mergeReports({ reportRoot: root, reportName: 'All lanes', history: false, outputs: ['markdown'] });
  const lanes = result!.summary.lanes!;
  assert.deepEqual(
    lanes.map(row => [row.label, row.failed, row.flaky]),
    [
      ['Lane A', 7, 1],
      ['Lane C', 0, 1],
      ['Lane B', 0, 0]
    ]
  );
  const a = lanes[0];
  assert.equal(a.passed + a.flaky + a.failed + 1, a.total);
  assert.deepEqual(result!.summary.environment.split(', ').sort(), ['https://other.acme.test', 'https://staging.acme.test']);
  const markdown = readFileSync(result!.files.markdown!, 'utf-8');
  assert.match(markdown, /#### Lanes\n\n\| Lane \| Failed \| Flaky \|/);
  assert.match(markdown, /\| ❌ Lane A \| 7 \| 1 \|/);
  assert.match(markdown, /\| ⚠️ Lane C \| 0 \| 1 \|/);
  assert.match(markdown, /\| ✅ Lane B \| 0 \| 0 \|/);
  const text = buildRunSummaryText(result!.summary, 'All lanes', collectFailureGroups(result!.summary));
  assert.match(text, /Lanes: 3\n {2}❌ Lane A {2}\s+7 failed/);
});

test('shards of one lane merge without a lane table', async t => {
  quiet(t);
  const root = tempDir();
  const shard = lane('Lane A');
  shard.environment = 'https://other.acme.test';
  writeReportOutputs(lane('Lane A'), root, 'Lane A', ['summary']);
  writeReportOutputs(shard, root, 'Lane A', ['summary']);
  const result = await mergeReports({ reportRoot: root, history: false, outputs: [] });
  assert.equal(result?.summary.mergedFrom, 2);
  assert.equal(result?.summary.lanes, undefined);
  assert.doesNotMatch(generateMarkdownSummary(result!.summary), /#### Lanes/);
});

test('lane histories fill in when the merge loads none and every lane has history of the same family', async t => {
  quiet(t);
  const root = tempDir();
  const b = lane('Lane B', true);
  b.specs = b.specs.map(spec => ({ ...spec, specFile: spec.specFile.replace('cypress/e2e/', 'cypress/e2e/b/') }));
  b.history = { ...b.history!, tests: { 'cypress/e2e/b/only.cy.ts › only': 'PPF' } };
  writeReportOutputs(lane('Lane A'), root, 'Lane A', ['summary']);
  writeReportOutputs(b, root, 'Lane B', ['summary']);
  const merged = await mergeReports({ reportRoot: root, outputs: ['markdown'] });
  assert.equal(merged?.summary.history?.family, 'E2E regression');
  assert.equal(merged?.summary.history?.tests['cypress/e2e/b/only.cy.ts › only'], 'PPF');
  assert.ok(Object.keys(merged!.summary.history!.tests).length > 1);

  const off = await mergeReports({ reportRoot: root, history: false, outputs: ['markdown'] });
  assert.equal(off?.summary.history, undefined);

  const other = tempDir();
  writeReportOutputs(lane('Lane A'), other, 'Lane A', ['summary']);
  writeReportOutputs({ ...b, history: { ...b.history!, family: 'Other' } }, other, 'Lane B', ['summary']);
  const mixed = await mergeReports({ reportRoot: other, outputs: ['markdown'] });
  assert.equal(mixed?.summary.history, undefined);

  const partial = tempDir();
  writeReportOutputs(lane('Lane A'), partial, 'Lane A', ['summary']);
  writeReportOutputs({ ...b, history: undefined }, partial, 'Lane B', ['summary']);
  const missing = await mergeReports({ reportRoot: partial, outputs: ['markdown'] });
  assert.equal(missing?.summary.lanes?.length, 2);
  assert.equal(missing?.summary.history, undefined);
  assert.doesNotMatch(readFileSync(missing!.files.markdown!, 'utf-8'), /new failures/);
});
