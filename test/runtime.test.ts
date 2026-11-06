import { test } from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { basename, join } from 'node:path';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createNeoReporter, generateJUnitXml, mergeReports, neoReporter } from '../src';
import { buildReportSummary } from '../src/summary';
import { writeReportOutputs } from '../src/output';
import { PLUGIN_FLAG, RECORD_TASK } from '../src/task';
import type { RecordedTestPayload } from '../src/types';
import { validateOptions } from '../src/validate';
import { cutFailedTestVideos, testVideoPath } from '../src/video';
import { sampleSummary } from './fixtures/summary';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'neo-runtime-'));
}

function pluginConfig(projectRoot: string, extra: Record<string, unknown> = {}): Cypress.PluginConfigOptions {
  const config = { projectRoot, video: false, isTextTerminal: true, cypressBinaryRoot: join(projectRoot, 'no-cypress'), env: {}, expose: {} };
  return { ...config, ...extra } as unknown as Cypress.PluginConfigOptions;
}

function record(neo: ReturnType<typeof createNeoReporter>, data: Pick<RecordedTestPayload, 'spec' | 'fullTitle'> & Partial<RecordedTestPayload>): null {
  return neo.tasks[RECORD_TASK]({ steps: [], ...data });
}

function cypressTest(title: string[], state: string) {
  return { title, state, duration: 1000, attempts: [{ state }], displayError: state === 'failed' ? 'Error: from Cypress' : null };
}

function runOf(projectRoot: string, spec: string, tests: unknown[], screenshots: string[] = []) {
  return {
    spec: { absolute: join(projectRoot, spec), relative: spec, name: basename(spec) },
    stats: { tests: tests.length, passes: 0, failures: 0, pending: 0, skipped: 0, duration: 1000 },
    screenshots: screenshots.map(name => ({ path: join(projectRoot, 'cypress/screenshots', basename(spec), name) })),
    video: null,
    tests
  };
}

function results(projectRoot: string, runs: unknown[]): CypressCommandLine.CypressRunResult {
  return {
    totalDuration: 1000,
    totalSuites: runs.length,
    totalTests: 0,
    totalPassed: 0,
    totalFailed: 0,
    totalPending: 0,
    totalSkipped: 0,
    config: { projectRoot },
    runs
  } as unknown as CypressCommandLine.CypressRunResult;
}

test('recorded steps and errors stay with their own spec when titles repeat', t => {
  t.mock.method(console, 'warn', () => undefined);
  const projectRoot = tempDir();
  const neo = createNeoReporter(pluginConfig(projectRoot));
  neo.beforeRun();
  record(neo, {
    spec: 'cypress/e2e/admin/login.cy.ts',
    fullTitle: 'Login › shows an error',
    steps: [{ phase: 'STEP', message: 'admin step' }],
    firstError: 'Error: admin failure',
    attempt: { leadMs: 1, durationMs: 1 }
  });
  record(neo, { spec: 'cypress/e2e/shop/login.cy.ts', fullTitle: 'Login › shows an error', steps: [{ phase: 'STEP', message: 'shop step' }] });

  const summary = buildReportSummary(
    results(projectRoot, [
      runOf(projectRoot, 'cypress/e2e/admin/login.cy.ts', [cypressTest(['Login', 'shows an error'], 'failed')]),
      runOf(projectRoot, 'cypress/e2e/shop/login.cy.ts', [cypressTest(['Login', 'shows an error'], 'passed')])
    ]),
    projectRoot,
    { history: false }
  );
  const [admin, shop] = summary.specs.map(spec => spec.tests[0]);
  assert.equal(admin.displayError, 'Error: admin failure');
  assert.deepEqual(admin.steps?.map(step => step.message), ['admin step']);
  assert.equal(shop.displayError, null);
  assert.deepEqual(shop.steps?.map(step => step.message), ['shop step']);
});

test('screenshots go only to the test whose full name they carry', () => {
  const projectRoot = tempDir();
  const summary = buildReportSummary(
    results(projectRoot, [
      runOf(
        projectRoot,
        'cypress/e2e/cart.cy.ts',
        [cypressTest(['Cart', 'loads'], 'passed'), cypressTest(['Cart', 'loads the cart'], 'failed')],
        ['Cart -- loads the cart (failed).png', 'Cart -- loads the cart (failed) (attempt 2).png']
      )
    ]),
    projectRoot
  );
  const [loads, loadsTheCart] = summary.specs[0].tests;
  assert.deepEqual(loads.screenshots, []);
  assert.deepEqual(
    loadsTheCart.screenshots?.map(shot => shot.name),
    ['Cart -- loads the cart (failed).png', 'Cart -- loads the cart (failed) (attempt 2).png']
  );
});

test('junit xml drops ANSI codes and characters XML 1.0 forbids', () => {
  const summary = sampleSummary();
  const failed = summary.specs.flatMap(spec => spec.tests).find(item => item.state === 'failed');
  assert.ok(failed);
  failed.displayError = 'Error: \u001b[31mboom\u001b[0m \u0000 end \uD800';
  const xml = generateJUnitXml(summary);
  assert.doesNotMatch(xml, /[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/u);
  assert.match(xml, /Error: \[31mboom\[0m {2}end/);
});

test('the summary strips ANSI codes from errors, steps and console errors', t => {
  t.mock.method(console, 'warn', () => undefined);
  const projectRoot = tempDir();
  const neo = createNeoReporter(pluginConfig(projectRoot));
  neo.beforeRun();
  record(neo, {
    spec: 'cypress/e2e/exec.cy.ts',
    fullTitle: 'Exec › runs',
    steps: [{ phase: 'STEP', message: '\u001b[1mbuild\u001b[22m' }],
    firstError: 'Error: \u001b[31mexit 1\u001b[39m',
    consoleErrors: ['\u001b[33mwarn\u001b[39m']
  });
  const summary = buildReportSummary(
    results(projectRoot, [runOf(projectRoot, 'cypress/e2e/exec.cy.ts', [cypressTest(['Exec', 'runs'], 'failed')])]),
    projectRoot
  );
  const [recorded] = summary.specs[0].tests;
  assert.equal(recorded.displayError, 'Error: exit 1');
  assert.equal(recorded.steps?.[0].message, 'build');
  assert.deepEqual(recorded.consoleErrors, ['warn']);
});

test('plugin handlers log reporter errors instead of failing the run', async t => {
  const warn = t.mock.method(console, 'warn', () => undefined);
  const projectRoot = tempDir();
  writeFileSync(join(projectRoot, 'blocker'), '');
  const neo = createNeoReporter(pluginConfig(projectRoot, { video: true }), { outputDir: 'blocker/reports', history: false });
  neo.beforeRun();

  assert.equal(neo.tasks[RECORD_TASK](undefined as unknown as RecordedTestPayload), null);
  await assert.doesNotReject(neo.afterRun(undefined));
  await assert.doesNotReject(neo.afterRun(results(projectRoot, [])));

  const videoDir = join(projectRoot, 'cypress/videos/spec.cy.ts.mp4');
  mkdirSync(videoDir, { recursive: true });
  const spec = { relative: 'spec.cy.ts', absolute: join(projectRoot, 'spec.cy.ts') } as Cypress.Spec;
  assert.doesNotThrow(() => neo.afterSpec(spec, { video: videoDir, tests: [] } as unknown as CypressCommandLine.RunResult));
  assert.ok(warn.mock.calls.length >= 3);
});

test('one failing output does not stop the others from being written', t => {
  const warn = t.mock.method(console, 'warn', () => undefined);
  t.mock.method(console, 'log', () => undefined);
  const outputDir = tempDir();
  mkdirSync(join(outputDir, 'E2E-regression.html'));
  const files = writeReportOutputs(sampleSummary(), outputDir, 'E2E regression', ['json', 'junit', 'html', 'markdown']);
  assert.deepEqual(Object.keys(files), ['json', 'junit', 'markdown']);
  Object.values(files).forEach(file => assert.ok(existsSync(file), file));
  assert.ok(warn.mock.calls.some(call => String(call.arguments[0]).includes('E2E-regression.html')));

  warn.mock.resetCalls();
  assert.deepEqual(writeReportOutputs(sampleSummary(), outputDir, 'E2E regression', []), {});
  assert.match(String(warn.mock.calls[0].arguments[0]), /No report file written/);
});

test('neoReporter tells the support file it is registered and returns the config', () => {
  const projectRoot = tempDir();
  const on = () => undefined;
  const withExpose = pluginConfig(projectRoot);
  assert.equal(neoReporter(on as unknown as Cypress.PluginEvents, withExpose), withExpose);
  assert.equal(withExpose.expose[PLUGIN_FLAG], true);

  const withoutExpose = pluginConfig(projectRoot, { expose: undefined });
  neoReporter(on as unknown as Cypress.PluginEvents, withoutExpose);
  assert.equal(withoutExpose.env[PLUGIN_FLAG], true);
});

test('neoReporter registers the handlers that createNeoReporter returns', () => {
  const events: string[] = [];
  const on = (event: string) => events.push(event);
  neoReporter(on as unknown as Cypress.PluginEvents, pluginConfig(tempDir()));
  assert.deepEqual(events, ['before:run', 'task', 'after:run']);
});

test('warns once when another plugin replaced before:run', t => {
  const warn = t.mock.method(console, 'warn', () => undefined);
  const projectRoot = tempDir();
  const replaced = createNeoReporter(pluginConfig(projectRoot));
  record(replaced, { spec: 'a.cy.ts', fullTitle: 'A › one' });
  record(replaced, { spec: 'a.cy.ts', fullTitle: 'A › two' });
  assert.equal(warn.mock.calls.filter(call => String(call.arguments[0]).includes('before:run')).length, 1);

  warn.mock.resetCalls();
  const intact = createNeoReporter(pluginConfig(projectRoot), { history: false });
  intact.beforeRun();
  record(intact, { spec: 'a.cy.ts', fullTitle: 'A › one' });
  assert.equal(warn.mock.calls.length, 0);
});

test('keepVideos keeps the videos of passing specs', t => {
  t.mock.method(console, 'warn', () => undefined);
  const projectRoot = tempDir();
  const spec = { relative: 'spec.cy.ts', absolute: join(projectRoot, 'spec.cy.ts') } as Cypress.Spec;
  for (const keepVideos of [false, true]) {
    const video = join(projectRoot, `spec-${keepVideos}.mp4`);
    writeFileSync(video, '');
    const neo = createNeoReporter(pluginConfig(projectRoot, { video: true }), { keepVideos });
    neo.afterSpec(spec, { video, tests: [cypressTest(['A', 'passes'], 'passed')] } as unknown as CypressCommandLine.RunResult);
    assert.equal(existsSync(video), keepVideos);
  }
});

test('invalid options fail fast and unknown ones only warn', async t => {
  const warn = t.mock.method(console, 'warn', () => undefined);
  const config = pluginConfig(tempDir());
  assert.throws(() => createNeoReporter(config, { outputs: ['htm'] as never }), /Unknown output "htm"/);
  assert.throws(() => validateOptions({ outputs: 'html' as never }), /outputs must be an array/);
  assert.throws(() => validateOptions({ theme: 'darkk' as never }), /Unknown theme "darkk"/);
  assert.throws(() => validateOptions({ history: { runs: '10' as never } }), /history.runs must be a whole number/);
  assert.throws(() => validateOptions({ history: { maxWeeks: 0 } }), /history.maxWeeks must be a whole number/);
  await assert.rejects(mergeReports({ reportRoot: tempDir(), theme: 'neon' as never }), /Unknown theme "neon"/);

  assert.doesNotThrow(() => validateOptions({ outputDirectory: 'out', outputs: ['html'], theme: 'dark', history: false } as never));
  assert.equal(warn.mock.calls.length, 1);
  assert.match(String(warn.mock.calls[0].arguments[0]), /unknown option "outputDirectory"/);
});

test('clips are only cut when the video length is known, and good clips survive a failed one', t => {
  const specVideo = join(tempDir(), 'cart.cy.ts.mp4');
  writeFileSync(specVideo, '');
  const tests = [cypressTest(['Cart', 'works'], 'failed'), cypressTest(['Cart', 'broken'], 'failed')] as unknown as CypressCommandLine.TestResult[];
  const calls: Array<{ command: string; options: { timeout?: number } }> = [];
  t.mock.method(childProcess, 'spawnSync', (command: string, args: string[], options: { timeout?: number }) => {
    calls.push({ command, options });
    if (command === 'ffprobe') return { status: 0, stdout: '4\n' };
    const output = args[args.length - 1];
    if (output.includes('broken')) return { status: 1 };
    writeFileSync(output, 'clip');
    return { status: 0 };
  });

  assert.equal(cutFailedTestVideos({ ffmpeg: 'ffmpeg', ffprobe: null }, specVideo, tests, () => undefined), false);
  assert.equal(calls.length, 0);

  assert.equal(cutFailedTestVideos({ ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' }, specVideo, tests, () => undefined), false);
  assert.ok(existsSync(testVideoPath(specVideo, ['Cart', 'works'])));
  assert.ok(!existsSync(testVideoPath(specVideo, ['Cart', 'broken'])));
  assert.ok(calls.length > 0 && calls.every(call => (call.options.timeout ?? 0) > 0));
});

test('long test titles give short, distinct clip file names', () => {
  const long = 'a'.repeat(300);
  const first = basename(testVideoPath('/videos/spec.cy.ts.mp4', ['Suite', `${long} one`]));
  const second = basename(testVideoPath('/videos/spec.cy.ts.mp4', ['Suite', `${long} two`]));
  assert.ok(first.length < 100, first);
  assert.notEqual(first, second);
  assert.equal(basename(testVideoPath('/videos/spec.cy.ts.mp4', ['Cart', 'loads'])), 'cart loads.mp4');
});

function fakeDocument(iframes: unknown[] = []) {
  const appended: Array<{ id?: string }> = [];
  return {
    appended,
    head: { appendChild: (element: { id?: string }) => appended.push(element) },
    documentElement: { dataset: {}, classList: { contains: () => false, toggle: () => undefined } },
    getElementById: (id: string) => appended.find(element => element.id === id) ?? null,
    createElement: () => ({}),
    addEventListener: () => undefined,
    querySelectorAll: () => iframes
  };
}

test('support file: records only when the plugin is registered and styles only the runner', t => {
  const hooks: Record<string, (this: unknown) => void> = {};
  const commands: Record<string, (...args: unknown[]) => unknown> = {};
  const tasks: Array<[string, { spec?: string }]> = [];
  const logs: unknown[] = [];
  const fakeCypress: Record<string, unknown> = {
    spec: { relative: 'cypress/e2e/login.cy.ts' },
    on: () => undefined,
    log: (entry: unknown) => logs.push(entry),
    Commands: { add: (name: string, fn: (...args: unknown[]) => unknown) => (commands[name] = fn) },
    expose: () => undefined,
    env: () => undefined
  };
  const autDocument = fakeDocument();
  const specDocument = fakeDocument();
  const runnerDocument = fakeDocument([{ contentWindow: { document: autDocument } }]);
  const globals = globalThis as Record<string, unknown>;
  t.after(() => ['Cypress', 'cy', 'beforeEach', 'afterEach', 'window'].forEach(key => delete globals[key]));
  Object.assign(globals, {
    Cypress: fakeCypress,
    cy: { task: (...args: [string, { spec?: string }]) => tasks.push(args), then: () => undefined },
    beforeEach: (fn: () => void) => (hooks.beforeEach = fn),
    afterEach: (fn: () => void) => (hooks.afterEach = fn),
    window: { document: specDocument, top: { document: runnerDocument } }
  });
  require('../src/support');
  const failingTest = { currentTest: { state: 'failed', titlePath: () => ['Login', 'fails'], body: '', err: { stack: 'Error: x' } } };
  const runFailingTest = () => {
    hooks.beforeEach.call({});
    hooks.afterEach.call(failingTest);
  };

  runFailingTest();
  runFailingTest();
  assert.equal(tasks.length, 0);
  assert.equal(logs.length, 1);

  fakeCypress.expose = (key: string) => key === PLUGIN_FLAG;
  runFailingTest();
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0][0], RECORD_TASK);
  assert.equal(tasks[0][1].spec, 'cypress/e2e/login.cy.ts');

  fakeCypress.expose = undefined;
  fakeCypress.env = (key: string) => key === PLUGIN_FLAG;
  runFailingTest();
  assert.equal(tasks.length, 2);

  commands.step('Open the cart', 'VISIT');
  commands.step('Check the total', 'CHECK');
  assert.equal(runnerDocument.appended.length, 1);
  assert.equal(autDocument.appended.length, 0);
  assert.equal(specDocument.appended.length, 0);
});
