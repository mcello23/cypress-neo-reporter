import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNeoReporter } from '../src';
import { FAILED_REQUEST_STATUSES, PLUGIN_FLAG, RECORD_TASK } from '../src/task';
import { validateOptions } from '../src/validate';

function pluginConfig(extra: Record<string, unknown> = {}): Cypress.PluginConfigOptions {
  const projectRoot = mkdtempSync(join(tmpdir(), 'neo-requests-'));
  return { projectRoot, video: false, isTextTerminal: true, cypressBinaryRoot: join(projectRoot, 'no-cypress'), env: {}, expose: {}, ...extra } as unknown as Cypress.PluginConfigOptions;
}

test('failedRequestStatuses is a known option and must hold HTTP status codes', t => {
  const warn = t.mock.method(console, 'warn', () => undefined);
  validateOptions({ failedRequestStatuses: [419, 420] });
  validateOptions({ fileName: 'Release-42-Chrome' });
  assert.equal(warn.mock.callCount(), 0);
  for (const failedRequestStatuses of ['419', [99], [600], [419.5], ['419'], null]) {
    assert.throws(() => validateOptions({ failedRequestStatuses } as never), /failedRequestStatuses must be an array of HTTP status codes/);
  }
  for (const fileName of ['', ' ', 42]) {
    assert.throws(() => validateOptions({ fileName } as never), /fileName must be a non-empty string/);
  }
});

test('the plugin hands failedRequestStatuses to the support file', () => {
  const withExpose = pluginConfig();
  createNeoReporter(withExpose, { failedRequestStatuses: [419, 420] });
  assert.deepEqual(withExpose.expose[FAILED_REQUEST_STATUSES], [419, 420]);

  const withoutExpose = pluginConfig({ expose: undefined });
  createNeoReporter(withoutExpose, { failedRequestStatuses: [419] });
  assert.deepEqual(withoutExpose.env[FAILED_REQUEST_STATUSES], [419]);

  const none = pluginConfig();
  createNeoReporter(none);
  assert.equal(none.expose[FAILED_REQUEST_STATUSES], undefined);
});

test('support file: records 500 and up, plus the statuses in failedRequestStatuses', t => {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  const hooks: Record<string, (this: unknown) => void> = {};
  const tasks: Array<{ network?: Array<{ status: number; url: string }> }> = [];
  const exposed: Record<string, unknown> = { [PLUGIN_FLAG]: true };
  const globals = globalThis as Record<string, unknown>;
  t.after(() => ['Cypress', 'cy', 'beforeEach', 'afterEach'].forEach(key => delete globals[key]));
  Object.assign(globals, {
    Cypress: {
      spec: { relative: 'cypress/e2e/login.cy.ts' },
      on: (event: string, handler: (...args: unknown[]) => void) => (handlers[event] = handler),
      log: () => undefined,
      Commands: { add: () => undefined },
      expose: (key: string) => exposed[key],
      env: () => undefined
    },
    cy: { task: (name: string, payload: (typeof tasks)[number]) => name === RECORD_TASK && tasks.push(payload) },
    beforeEach: (fn: () => void) => (hooks.beforeEach = fn),
    afterEach: (fn: () => void) => (hooks.afterEach = fn)
  });
  require('../src/support');
  const loadPage = (statuses: number[]) => {
    let observe: (list: { getEntries: () => unknown[] }) => void = () => undefined;
    const win = {
      console: { error: () => undefined },
      PerformanceObserver: class {
        constructor(callback: typeof observe) {
          observe = callback;
        }
        observe() {}
      }
    };
    handlers['window:before:load'](win);
    observe({ getEntries: () => statuses.map(status => ({ name: `https://shop.test/api/${status}`, responseStatus: status })) });
  };
  const failingTest = { currentTest: { state: 'failed', titlePath: () => ['Login', 'fails'], body: '', err: { stack: 'Error: x' } } };
  const recordedStatuses = (statuses: number[]) => {
    hooks.beforeEach.call({});
    loadPage(statuses);
    hooks.afterEach.call(failingTest);
    return tasks[tasks.length - 1].network?.map(request => request.status);
  };

  assert.deepEqual(recordedStatuses([200, 404, 419, 420, 500, 503]), [500, 503]);
  exposed[FAILED_REQUEST_STATUSES] = [419, 420];
  assert.deepEqual(recordedStatuses([200, 404, 419, 420, 500, 503]), [419, 420, 500, 503]);
});
