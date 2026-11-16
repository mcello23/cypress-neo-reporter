import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNeoReporter, neoReporter } from '../src';
import { validateOptions } from '../src/validate';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'neo-flaky-'));
}

function useEnv(t: TestContext, vars: Record<string, string>): void {
  const env = { ...process.env };
  t.after(() => {
    process.env = env;
  });
  for (const key of Object.keys(process.env)) {
    if (/^(GITHUB_|GITLAB_|CI_|BUILD_|SYSTEM_|RELEASE_|TF_BUILD$)/.test(key)) delete process.env[key];
  }
  Object.assign(process.env, vars);
}

function pluginConfig(projectRoot: string, extra: Record<string, unknown> = {}): Cypress.PluginConfigOptions {
  const config = { projectRoot, video: false, isTextTerminal: true, cypressBinaryRoot: join(projectRoot, 'no-cypress'), env: {}, expose: {} };
  return { ...config, ...extra } as unknown as Cypress.PluginConfigOptions;
}

function logLines(t: TestContext): () => string[] {
  t.mock.method(console, 'warn', () => undefined);
  const log = t.mock.method(console, 'log', () => undefined);
  return () => log.mock.calls.map(call => String(call.arguments[0]));
}

function runSpec(relative: string, flakyTitle: string[], options: { flakyWarnings?: boolean } = { flakyWarnings: true }, owners?: Record<string, string>): void {
  const projectRoot = tempDir();
  if (owners) writeFileSync(join(projectRoot, 'spec-owners.json'), JSON.stringify(owners));
  const neo = createNeoReporter(pluginConfig(projectRoot), { history: false, ...options });
  const tests = [
    { title: flakyTitle, state: 'passed', attempts: [{ state: 'failed' }, { state: 'passed' }] },
    { title: ['Cart', 'shows the total'], state: 'passed', attempts: [{ state: 'passed' }] },
    { title: ['Cart', 'removes an item'], state: 'failed', attempts: [{ state: 'failed' }, { state: 'failed' }] }
  ];
  neo.afterSpec({ relative, absolute: join(projectRoot, 'spec.cy.ts') } as Cypress.Spec, { video: null, tests } as unknown as CypressCommandLine.RunResult);
}

function registeredEvents(options: { flakyWarnings?: boolean }): string[] {
  const events: string[] = [];
  const on = (event: string) => events.push(event);
  neoReporter(on as unknown as Cypress.PluginEvents, pluginConfig(tempDir()), options);
  return events;
}

test('flakyWarnings on GitHub Actions prints one escaped warning per flaky test', t => {
  useEnv(t, { GITHUB_ACTIONS: 'true' });
  const lines = logLines(t);
  runSpec('cypress/e2e/a,b:c.cy.ts', ['Cart', 'adds 50%\r\nitems']);
  assert.deepEqual(lines(), ['::warning file=cypress/e2e/a%2Cb%3Ac.cy.ts::FLAKY Cart › adds 50%25%0D%0Aitems']);
});

test('flakyWarnings on Azure Pipelines prints a logissue warning linked to the spec', t => {
  useEnv(t, { TF_BUILD: 'True' });
  const lines = logLines(t);
  runSpec('cypress\\e2e\\cart;v2].cy.ts', ['Cart', 'adds 50%\nitems']);
  assert.deepEqual(lines(), ['##vso[task.logissue type=warning;sourcepath=cypress/e2e/cart%3Bv2%5D.cy.ts]FLAKY Cart › adds 50%%0Aitems']);
});

test('a flaky warning of a compiled .js spec links the TypeScript source that spec-owners.json lists', t => {
  useEnv(t, { TF_BUILD: 'True' });
  const lines = logLines(t);
  runSpec('cypress\\e2e\\cart.cy.js', ['Cart', 'adds items'], { flakyWarnings: true }, { 'cypress/e2e/cart.cy.ts': 'Ana' });
  runSpec('cypress/e2e/menu.cy.js', ['Menu', 'opens'], { flakyWarnings: true }, { 'cypress/e2e/cart.cy.ts': 'Ana' });
  assert.deepEqual(lines(), [
    '##vso[task.logissue type=warning;sourcepath=cypress/e2e/cart.cy.ts]FLAKY Cart › adds items',
    '##vso[task.logissue type=warning;sourcepath=cypress/e2e/menu.cy.js]FLAKY Menu › opens'
  ]);
});

test('flaky warnings stay off outside CI and without the option', t => {
  useEnv(t, {});
  const lines = logLines(t);
  runSpec('cypress/e2e/cart.cy.ts', ['Cart', 'adds items']);
  assert.deepEqual(lines(), []);

  process.env.TF_BUILD = 'True';
  runSpec('cypress/e2e/cart.cy.ts', ['Cart', 'adds items'], {});
  assert.deepEqual(lines(), []);
});

test('after:spec is registered with video off only for flaky warnings on a supported CI', t => {
  useEnv(t, {});
  assert.deepEqual(registeredEvents({ flakyWarnings: true }), ['before:run', 'task', 'after:run']);

  process.env.TF_BUILD = 'True';
  assert.ok(registeredEvents({ flakyWarnings: true }).includes('after:spec'));
  assert.deepEqual(registeredEvents({}), ['before:run', 'task', 'after:run']);
});

test('flakyWarnings must be a boolean', t => {
  const warn = t.mock.method(console, 'warn', () => undefined);
  assert.throws(() => validateOptions({ flakyWarnings: 'yes' as never }), /flakyWarnings must be true or false/);
  validateOptions({ flakyWarnings: false });
  assert.equal(warn.mock.calls.length, 0);
});
