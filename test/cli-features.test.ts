import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkGate, readQuarantine } from '../src/gate';
import { notify, NOTIFY_TIMEOUT_MS } from '../src/notify';
import type { ReportSummary } from '../src/types';
import { sampleSummary } from './fixtures/summary';

const ROOT = join(__dirname, '..');
const NO_WEBHOOKS = { NEO_SLACK_WEBHOOK: '', NEO_TEAMS_WEBHOOK: '' };
const NEW_FAILURES = [
  'cypress/e2e/checkout/payment.cy.ts › Checkout › applies discount code at checkout',
  'cypress/e2e/cart/cart-summary.cy.ts › Cart summary › updates total when quantity changes',
  'cypress/e2e/cart/cart-badge.cy.ts › Cart badge › shows item count',
  'cypress/e2e/orders/order-history.cy.ts › Order history › lists orders of the last year',
  'cypress/e2e/orders/reorder.cy.ts › Reorder › reorders a past order',
  'cypress/e2e/account/profile.cy.ts › Profile › updates the display name'
];
const KNOWN_FAILURE = 'cypress/e2e/cart/cart-summary.cy.ts › Cart summary › removes the last item';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'neo-cli-'));
}

function writeJson(dir: string, name: string, data: unknown): string {
  const file = join(dir, name);
  writeFileSync(file, JSON.stringify(data));
  return file;
}

function cli(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, ['--import', 'tsx', join(ROOT, 'src', 'cli.ts'), ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    env: { ...process.env, ...NO_WEBHOOKS, ...env }
  });
}

function cliAsync(args: string[], env: NodeJS.ProcessEnv = {}): Promise<{ status: number | null; output: string }> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['--import', 'tsx', join(ROOT, 'src', 'cli.ts'), ...args], {
      cwd: ROOT,
      env: { ...process.env, ...NO_WEBHOOKS, ...env }
    });
    let output = '';
    child.stdout.on('data', chunk => (output += chunk));
    child.stderr.on('data', chunk => (output += chunk));
    child.on('close', status => resolve({ status, output }));
  });
}

function gateLog(t: TestContext) {
  const log = t.mock.method(console, 'log', () => undefined);
  return () => log.mock.calls.map(call => String(call.arguments[0])).join('\n');
}

function withFailures(keep: string[]): ReportSummary {
  const summary = sampleSummary();
  summary.specs.forEach(spec =>
    spec.tests.forEach(test => {
      if (test.state === 'failed' && !keep.includes(`${spec.specFile} › ${test.fullTitle}`)) test.state = 'passed';
    })
  );
  return summary;
}

interface Received {
  path: string;
  contentType?: string;
  body: any;
}

async function webhookServer(t: TestContext) {
  const received: Received[] = [];
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    let body = '';
    request.on('data', chunk => (body += chunk));
    request.on('end', () => {
      received.push({ path: request.url ?? '', contentType: request.headers['content-type'], body: JSON.parse(body) });
      if (request.url?.startsWith('/hang')) return;
      if (request.url?.startsWith('/fail')) {
        response.statusCode = 400;
        response.end('invalid_payload');
        return;
      }
      response.end('ok');
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const { port } = server.address() as AddressInfo;
  return { url: (path: string) => `http://127.0.0.1:${port}${path}`, received };
}

test('gate --fail-on new fails only on new failures and lists them', t => {
  const output = gateLog(t);
  assert.equal(checkGate(sampleSummary(), { failOn: 'new' }), false);
  assert.match(output(), /1 known failure not counted/);
  assert.match(output(), /6 new failures:/);
  NEW_FAILURES.forEach(path => assert.ok(output().includes(`  ${path}`), path));
  assert.ok(!output().includes(KNOWN_FAILURE));
  assert.match(output(), /Gate failed$/);

  assert.equal(checkGate(withFailures([KNOWN_FAILURE]), { failOn: 'new' }), true);
  assert.match(output(), /No new failures\n.*Gate passed$/);
});

test('gate --fail-on new refuses a report without run history', t => {
  t.mock.method(console, 'log', () => undefined);
  assert.throws(() => checkGate({ ...sampleSummary(), history: undefined }, { failOn: 'new' }), /--fail-on new needs run history/);
  const summary = sampleSummary();
  summary.history!.runs = [];
  assert.throws(() => checkGate(summary, { failOn: 'new' }), /needs run history/);
  assert.doesNotThrow(() => checkGate({ ...sampleSummary(), history: undefined }, { failOn: 'failed', minPassRate: 0 }));
});

test('gate --min-pass-rate compares with the report pass rate', t => {
  const output = gateLog(t);
  assert.equal(checkGate(sampleSummary(), { minPassRate: 89 }), true);
  assert.match(output(), /Pass rate 89% meets the minimum of 89%/);
  assert.equal(checkGate(sampleSummary(), { minPassRate: 90 }), false);
  assert.match(output(), /Pass rate 89% is below the minimum of 90%\n.*Gate failed$/);
});

test('quarantined tests count neither as failures nor in the pass rate', t => {
  const output = gateLog(t);
  const quarantine = new Map([
    ['cypress/e2e/cart/cart-summary.cy.ts', 'WEB-7 cart totals rework'],
    ['cypress/e2e/checkout/payment.cy.ts › Checkout › applies discount code at checkout', 'PAY-3'],
    ['cypress/e2e/cart/cart-badge.cy.ts › Cart badge › other test', 'WEB-8']
  ]);
  assert.equal(checkGate(sampleSummary(), { failOn: 'failed', minPassRate: 91, quarantine }), false);
  assert.match(output(), /3 quarantined failures not counted:/);
  assert.ok(output().includes(`  ${KNOWN_FAILURE} (WEB-7 cart totals rework)`));
  assert.ok(output().includes(`  ${NEW_FAILURES[0]} (PAY-3)`));
  assert.match(output(), /4 failures:/);
  assert.match(output(), /Pass rate 91% without quarantined tests meets the minimum of 91%/);

  const all = new Map([...NEW_FAILURES, KNOWN_FAILURE].map(path => [path, 'TICKET-1']));
  assert.equal(checkGate(sampleSummary(), { failOn: 'failed', quarantine: all }), true);
  assert.match(output(), /No failures\n.*Gate passed$/);
});

test('the quarantine file is optional by default and must map names to reasons', () => {
  const dir = tempDir();
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    assert.deepEqual(readQuarantine(), new Map());
    writeJson(dir, 'quarantine.json', { 'cypress/e2e/a.cy.ts': 'JIRA-1' });
    assert.deepEqual(readQuarantine(), new Map([['cypress/e2e/a.cy.ts', 'JIRA-1']]));
  } finally {
    process.chdir(cwd);
  }
  assert.throws(() => readQuarantine(join(dir, 'missing.json')), /ENOENT/);
  assert.throws(() => readQuarantine(writeJson(dir, 'list.json', ['cypress/e2e/a.cy.ts'])), /must map spec files/);
  assert.throws(() => readQuarantine(writeJson(dir, 'nested.json', { 'a.cy.ts': { ticket: 'X' } })), /must map spec files/);
});

test('cli gate exit codes: 0 passed, 1 failed or unusable report, 2 usage error', () => {
  const dir = tempDir();
  const report = writeJson(dir, 'report.json', sampleSummary());
  const quarantine = writeJson(dir, 'quarantine.json', Object.fromEntries(NEW_FAILURES.map(path => [path, 'WEB-1'])));

  const failed = cli(['gate', report, '--fail-on', 'new']);
  assert.equal(failed.status, 1);
  assert.match(failed.stdout, /6 new failures:[\s\S]*Gate failed/);

  const passed = cli(['gate', report, '--fail-on', 'new', '--min-pass-rate', '80', '--quarantine', quarantine]);
  assert.equal(passed.status, 0, passed.stderr);
  assert.match(passed.stdout, /No new failures[\s\S]*Pass rate 97% without quarantined tests meets the minimum of 80%[\s\S]*Gate passed/);

  const noHistory = cli(['gate', writeJson(dir, 'old.json', { ...sampleSummary(), history: undefined }), '--fail-on', 'new']);
  assert.equal(noHistory.status, 1);
  assert.match(noHistory.stderr, /needs run history/);

  const notReport = cli(['gate', writeJson(dir, 'other.json', { name: 'x' }), '--fail-on', 'failed']);
  assert.equal(notReport.status, 1);
  assert.match(notReport.stderr, /other\.json is not a neo-reporter JSON report/);

  for (const [args, message] of [
    [['gate', report], /Pass --fail-on, --min-pass-rate or both/],
    [['gate', '--fail-on', 'new'], /Pass exactly one report JSON file/],
    [['gate', report, '--fail-on', 'flaky'], /Unknown --fail-on value: flaky/],
    [['gate', report, '--min-pass-rate', '101'], /--min-pass-rate must be a number from 0 to 100/],
    [['merge', dir, '--quarantine', quarantine], /--quarantine needs --fail-on or --min-pass-rate/]
  ] as const) {
    const result = cli([...args]);
    assert.equal(result.status, 2, args.join(' '));
    assert.match(result.stderr, message);
  }
});

test('cli merge posts the merged run, then applies the gate after writing the report', async t => {
  const server = await webhookServer(t);
  const dir = tempDir();
  writeJson(dir, 'shard-1.json', { ...sampleSummary(), schemaVersion: 1, history: undefined });
  const out = join(dir, 'merged');
  const result = await cliAsync(['merge', dir, '--out', out, '--outputs', 'json', '--no-history', '--fail-on', 'failed', '--report-url', 'https://ci.example/report'], {
    NEO_SLACK_WEBHOOK: server.url('/slack/T000/SECRET')
  });
  assert.equal(result.status, 1);
  assert.match(result.output, /Posted the run summary to Slack[\s\S]*7 failures:[\s\S]*Gate failed/);
  assert.ok(!result.output.includes('SECRET'));
  assert.ok(existsSync(join(out, 'E2E-regression.json')));
  assert.equal(server.received.length, 1);
  assert.match(server.received[0].body.text, /7 failed · 1 flaky · 65 passed of 74 tests/);
  assert.ok(server.received[0].body.blocks[0].text.text.includes('<https://ci.example/report|Open the full report>'));

  const plain = cli(['merge', dir, '--out', out, '--outputs', 'json', '--no-history']);
  assert.equal(plain.status, 0, plain.stderr);
});

test('notify posts a Slack message and a Teams Adaptive Card', async t => {
  const server = await webhookServer(t);
  const log = t.mock.method(console, 'log', () => undefined);
  const summary = sampleSummary();
  summary.specs[5].tests[0].displayError = 'Expected <button> & <input> to be enabled';
  const ok = await notify(summary, { slack: server.url('/slack'), teams: server.url('/teams') }, 'https://ci.example/report.html');
  assert.equal(ok, true);
  assert.deepEqual(
    log.mock.calls.map(call => call.arguments[0]),
    ['[neo-reporter] Posted the run summary to Slack', '[neo-reporter] Posted the run summary to Microsoft Teams']
  );

  const [slack, teams] = server.received;
  assert.equal(slack.path, '/slack');
  assert.equal(slack.contentType, 'application/json');
  assert.equal(slack.body.text, '❌ acme-storefront - E2E regression: 7 failed · 1 flaky · 65 passed of 74 tests (89% pass rate) · 5m 0s');
  const text: string = slack.body.blocks[0].text.text;
  assert.equal(slack.body.blocks[0].text.type, 'mrkdwn');
  assert.match(text, /^\*❌ acme-storefront - E2E regression\*\n/);
  assert.match(text, /6 new failures · 1 known · 0 fixed/);
  assert.match(text, /Branch: main · Commit: 4f2c9e1a · Build: 20261106\.3/);
  assert.match(text, /\*Top failures\*\n• 4× AssertionError: Timed out retrying/);
  assert.ok(text.includes('• 1× Expected &lt;button&gt; &amp; &lt;input&gt; to be enabled'));
  assert.ok(text.endsWith('<https://ci.example/report.html|Open the full report>'));

  assert.equal(teams.path, '/teams');
  assert.equal(teams.body.type, 'message');
  const [attachment] = teams.body.attachments;
  assert.equal(attachment.contentType, 'application/vnd.microsoft.card.adaptive');
  assert.equal(attachment.content.type, 'AdaptiveCard');
  const texts: string[] = attachment.content.body.map((block: { text: string }) => block.text);
  assert.equal(texts[0], '❌ acme-storefront - E2E regression');
  assert.ok(texts.includes('6 new failures · 1 known · 0 fixed'));
  assert.ok(texts.includes('• 1× Expected <button> & <input> to be enabled'));
  assert.deepEqual(attachment.content.actions, [{ type: 'Action.OpenUrl', title: 'Open the full report', url: 'https://ci.example/report.html' }]);
});

test('notify lists the five largest failure groups and leaves history out when there is none', async t => {
  const server = await webhookServer(t);
  t.mock.method(console, 'log', () => undefined);
  const summary = { ...sampleSummary(), history: undefined };
  summary.specs.flatMap(spec => spec.tests).filter(test => test.state === 'failed').forEach((test, index) => (test.displayError = `Error ${'ABCDEFG'[index]}`));
  assert.equal(await notify(summary, { teams: server.url('/teams') }), true);
  const card = server.received[0].body.attachments[0].content;
  const texts: string[] = card.body.map((block: { text: string }) => block.text);
  assert.equal(texts.filter(text => text.startsWith('• 1× Error')).length, 5);
  assert.ok(texts.includes('• …and 2 more failure groups'));
  assert.ok(!texts.some(text => text.includes('new failures')));
  assert.equal(card.actions, undefined);
});

test('a failed or slow post warns without the webhook URL and reports false', async t => {
  const server = await webhookServer(t);
  const warn = t.mock.method(console, 'warn', () => undefined);
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  const timeouts: number[] = [];
  t.mock.method(AbortSignal, 'timeout', (ms: number) => {
    timeouts.push(ms);
    return timeout(100);
  });
  const ok = await notify(sampleSummary(), { slack: server.url('/fail/SECRET'), teams: server.url('/hang/SECRET') });
  assert.equal(ok, false);
  assert.deepEqual(timeouts, [NOTIFY_TIMEOUT_MS, NOTIFY_TIMEOUT_MS]);
  const warnings = warn.mock.calls.map(call => String(call.arguments[0]));
  assert.equal(warnings[0], '[neo-reporter] Posting the run summary to Slack failed: answered 400 Bad Request: invalid_payload');
  assert.match(warnings[1], /^\[neo-reporter\] Posting the run summary to Microsoft Teams failed: .*timeout/);
  assert.ok(warnings.every(warning => !warning.includes('SECRET') && !warning.includes('127.0.0.1')));

  const invalid = await notify(sampleSummary(), { slack: 'hooks slack SECRET' });
  assert.equal(invalid, false);
  assert.ok(!String(warn.mock.calls.at(-1)?.arguments[0]).includes('SECRET'));
});

test('cli notify reads the webhook from the environment and never prints it', async t => {
  const server = await webhookServer(t);
  const dir = tempDir();
  const report = writeJson(dir, 'report.json', sampleSummary());

  const posted = await cliAsync(['notify', report], { NEO_TEAMS_WEBHOOK: server.url('/teams/SECRET') });
  assert.equal(posted.status, 0, posted.output);
  assert.equal(server.received.at(-1)?.path, '/teams/SECRET');

  const failed = await cliAsync(['notify', report, '--slack', server.url('/fail/SECRET')]);
  assert.equal(failed.status, 1);
  assert.match(failed.output, /Posting the run summary to Slack failed: answered 400/);
  assert.ok(![posted.output, failed.output].some(output => output.includes('SECRET')));

  const missing = cli(['notify', report]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /Pass --slack or --teams, or set NEO_SLACK_WEBHOOK or NEO_TEAMS_WEBHOOK/);
});
