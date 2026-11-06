import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { neoReporter } from '../src';
import { RECORD_TASK } from '../src/task';

const rootDir = join(__dirname, '..');

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'neo-reporter-'));
}

test('npm pack builds dist and the peer range covers only verified Cypress majors', () => {
  const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8'));
  assert.equal(pkg.scripts.prepack, 'npm run build');
  assert.equal(pkg.peerDependencies.cypress, '^15.0.0 || ^16.0.0');
});

test('neoReporter writes the reports through the events it registers', async () => {
  const projectRoot = tempDir();
  const handlers: Record<string, any> = {};
  const on = ((event: string, handler: unknown) => {
    handlers[event] = handler;
  }) as unknown as Cypress.PluginEvents;
  neoReporter(on, { projectRoot, video: false, env: {} } as Cypress.PluginConfigOptions, { reportName: 'plugin', history: false });

  await handlers['before:run']();
  assert.equal(handlers.task[RECORD_TASK]({ spec: 'cypress/e2e/cart.cy.js', fullTitle: 'Cart › adds an item', steps: [{ phase: 'STEP', message: 'Add the item' }] }), null);
  await handlers['after:run']({
    totalTests: 1,
    totalPassed: 1,
    config: { projectRoot },
    runs: [
      {
        spec: { absolute: join(projectRoot, 'cypress/e2e/cart.cy.js'), name: 'cart.cy.js' },
        stats: { tests: 1, passes: 1, failures: 0, pending: 0, skipped: 0, duration: 1000 },
        screenshots: [],
        video: null,
        tests: [{ title: ['Cart', 'adds an item'], state: 'passed', duration: 1000, attempts: [{ state: 'passed' }], displayError: null }]
      }
    ]
  });

  for (const extension of ['html', 'json', 'junit.xml', 'summary.md']) {
    assert.ok(existsSync(join(projectRoot, `cypress/reports/plugin.${extension}`)), extension);
  }
});

test('neo-reporter exits with an error on an unknown output or theme', () => {
  for (const [option, value, message] of [
    ['--outputs', 'pdf', /Unknown output: pdf/],
    ['--theme', 'neon', /Unknown theme: neon/]
  ] as const) {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'merge', tempDir(), option, value], {
      cwd: rootDir,
      encoding: 'utf-8'
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, message);
  }
});
