import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basename, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createNeoReporter } from '../src';
import { buildReportSummary } from '../src/summary';
import { PLUGIN_FLAG } from '../src/task';
import { testVideoPath } from '../src/video';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'neo-evidence-'));
}

function cypressTest(title: string[], ...attempts: string[]) {
  const state = attempts.includes('passed') ? 'passed' : attempts[attempts.length - 1];
  return { title, state, duration: 1000, attempts: attempts.map(attempt => ({ state: attempt })), displayError: null };
}

function shotsOf(tests: ReturnType<typeof cypressTest>[], screenshots: string[], customNames: string[] = []): Record<string, string[]> {
  const projectRoot = tempDir();
  const summary = buildReportSummary(
    {
      totalDuration: 1000,
      totalSuites: 1,
      totalTests: tests.length,
      config: { projectRoot },
      runs: [
        {
          spec: { absolute: join(projectRoot, 'cypress/e2e/spec.cy.js'), relative: 'cypress/e2e/spec.cy.js', name: 'spec.cy.js' },
          stats: { tests: tests.length },
          screenshots: screenshots.map(name => ({
            path: join(projectRoot, 'cypress/screenshots/spec.cy.js', name),
            name: customNames.includes(name) ? name.replace(/\.png$/, '') : null
          })),
          video: null,
          tests
        }
      ]
    } as unknown as CypressCommandLine.CypressRunResult,
    projectRoot
  );
  return Object.fromEntries(summary.specs[0].tests.map(t => [t.fullTitle, (t.screenshots ?? []).map(shot => shot.name)]));
}

function cypressCut(name: string, maxBytes = 254): string {
  return `${Buffer.from(name).subarray(0, maxBytes - '.png'.length).toString()}.png`;
}

test('failure screenshots taken in hooks go to the test the hook ran for', () => {
  const shots = shotsOf(
    [
      cypressTest(['Each hook', 'logs in'], 'failed'),
      cypressTest(['All hook', 'opens the page'], 'failed'),
      cypressTest(['All hook', 'opens the page again'], 'skipped'),
      cypressTest(['After hook', 'cleans up'], 'failed'),
      cypressTest(['After all hook', 'first runs'], 'passed'),
      cypressTest(['After all hook', 'last runs'], 'failed'),
      cypressTest(['Named hook', 'shows the dashboard'], 'failed'),
      cypressTest(['Outer', 'nested'], 'passed'),
      cypressTest(['Outer', 'Inner', 'nested'], 'failed'),
      cypressTest(['Outer all', 'Inner all', 'only child'], 'failed'),
      cypressTest(['Root', 'root hook victim'], 'failed'),
      cypressTest(['Root', 'root hook bystander'], 'skipped')
    ],
    [
      'Each hook -- logs in -- before each hook (failed).png',
      'All hook -- opens the page -- before all hook (failed).png',
      'After hook -- cleans up -- after each hook (failed).png',
      'After all hook -- last runs -- after all hook (failed).png',
      'Named hook -- shows the dashboard -- before each hook signs in (failed).png',
      'Outer -- nested.png',
      'Outer -- nested -- before each hook (failed).png',
      'Outer all -- only child -- before all hook (failed).png',
      'root hook victim -- before each hook (failed).png'
    ]
  );
  assert.deepEqual(shots, {
    'Each hook › logs in': ['Each hook -- logs in -- before each hook (failed).png'],
    'All hook › opens the page': ['All hook -- opens the page -- before all hook (failed).png'],
    'All hook › opens the page again': [],
    'After hook › cleans up': ['After hook -- cleans up -- after each hook (failed).png'],
    'After all hook › first runs': [],
    'After all hook › last runs': ['After all hook -- last runs -- after all hook (failed).png'],
    'Named hook › shows the dashboard': ['Named hook -- shows the dashboard -- before each hook signs in (failed).png'],
    'Outer › nested': ['Outer -- nested.png'],
    'Outer › Inner › nested': ['Outer -- nested -- before each hook (failed).png'],
    'Outer all › Inner all › only child': ['Outer all -- only child -- before all hook (failed).png'],
    'Root › root hook victim': ['root hook victim -- before each hook (failed).png'],
    'Root › root hook bystander': []
  });
});

test('screenshot names are matched after the same clean-up Cypress applies to each title', () => {
  const shots = shotsOf(
    [
      cypressTest(['Cart.', 'fails under a dotted describe'], 'failed'),
      cypressTest(['Dots', 'ends with a dot.'], 'failed'),
      cypressTest(['Dots', 'ends with spaces  '], 'failed'),
      cypressTest(['Chars: a/b', 'has "quotes" <and> pipes | ?'], 'failed'),
      cypressTest(['Control', 'line\nbreak'], 'failed')
    ],
    [
      'Cart -- fails under a dotted describe (failed).png',
      'Dots -- ends with a dot (failed).png',
      'Dots -- ends with spaces (failed).png',
      'Chars ab -- has quotes and pipes (failed).png',
      'Control -- linebreak (failed).png'
    ]
  );
  assert.deepEqual(Object.values(shots), [
    ['Cart -- fails under a dotted describe (failed).png'],
    ['Dots -- ends with a dot (failed).png'],
    ['Dots -- ends with spaces (failed).png'],
    ['Chars ab -- has quotes and pipes (failed).png'],
    ['Control -- linebreak (failed).png']
  ]);
});

test('suffixes Cypress adds never hand a screenshot to a sibling', () => {
  const shots = shotsOf(
    [
      cypressTest(['Suffix', 'retries'], 'passed'),
      cypressTest(['Suffix', 'retries (2)'], 'failed'),
      cypressTest(['Dup', 'twice'], 'failed'),
      cypressTest(['Retry', 'always'], 'failed', 'failed'),
      cypressTest(['Retry', 'flaky'], 'failed', 'passed')
    ],
    [
      'Suffix -- retries (2) (failed).png',
      'Dup -- twice.png',
      'Dup -- twice (1).png',
      'Dup -- twice (failed).png',
      'Retry -- always (failed).png',
      'Retry -- always (failed) (attempt 2).png',
      'Retry -- flaky.png',
      'Retry -- flaky (failed).png',
      'Retry -- flaky (attempt 2).png'
    ]
  );
  assert.deepEqual(shots, {
    'Suffix › retries': [],
    'Suffix › retries (2)': ['Suffix -- retries (2) (failed).png'],
    'Dup › twice': ['Dup -- twice.png', 'Dup -- twice (1).png', 'Dup -- twice (failed).png'],
    'Retry › always': ['Retry -- always (failed).png', 'Retry -- always (failed) (attempt 2).png'],
    'Retry › flaky': ['Retry -- flaky.png', 'Retry -- flaky (failed).png', 'Retry -- flaky (attempt 2).png']
  });
});

test('screenshots whose names Cypress cut short still reach their test', () => {
  const suite = 'Checkout flow for returning customers with saved addresses, multiple payment methods and loyalty points applied at the final step';
  const group = 'when the shipping address changes after the order summary was already shown to the customer on the review page';
  const leaf = 'recalculates taxes, shipping costs and discounts and shows the new total before the customer confirms the order';
  const emoji = `${'🚀'.repeat(70)}xyz`;
  const long = cypressCut(`${suite} -- ${group} -- ${leaf} (failed)`);
  const midChar = cypressCut(`Emoji -- é${emoji} (failed)`);
  const shorter = cypressCut(`Emoji -- ${emoji} (failed)`, 253);
  assert.ok(midChar.endsWith('\uFFFD.png'));
  const shots = shotsOf(
    [
      cypressTest([suite, group, leaf], 'failed'),
      cypressTest([suite, group, 'recalculates taxes'], 'passed'),
      cypressTest(['Emoji', `é${emoji}`], 'failed'),
      cypressTest(['Emoji', emoji], 'failed'),
      cypressTest(['Emoji', 'plain'], 'failed')
    ],
    [long, midChar, shorter, 'Emoji -- plain (failed).png']
  );
  assert.deepEqual(Object.values(shots), [[long], [], [midChar], [shorter], ['Emoji -- plain (failed).png']]);
});

test('screenshots renamed to the test title reach their test inside a describe', () => {
  const shots = shotsOf(
    [
      cypressTest(['Checkout', 'Card', 'pays by card'], 'failed'),
      cypressTest(['Checkout', 'Card', 'retries the payment'], 'failed', 'failed'),
      cypressTest(['Login', 'signs in'], 'failed', 'passed'),
      cypressTest(['Cart', 'loads'], 'passed'),
      cypressTest(['Hooks', 'opens the page'], 'failed'),
      cypressTest(['Default', 'keeps its name'], 'failed')
    ],
    [
      'pays by card.png',
      'retries the payment.png',
      'retries the payment (failed) (attempt 2).png',
      'signs in.png',
      'loads.png',
      'opens the page -- before each hook.png',
      'Default -- keeps its name (failed).png',
      'pays by card (1).png'
    ]
  );
  assert.deepEqual(shots, {
    'Checkout › Card › pays by card': ['pays by card.png', 'pays by card (1).png'],
    'Checkout › Card › retries the payment': ['retries the payment.png', 'retries the payment (failed) (attempt 2).png'],
    'Login › signs in': ['signs in.png'],
    'Cart › loads': ['loads.png'],
    'Hooks › opens the page': ['opens the page -- before each hook.png'],
    'Default › keeps its name': ['Default -- keeps its name (failed).png']
  });
});

test('a renamed screenshot never goes to a test whose title only starts the same, that did not run, or that passed while the name says failed', () => {
  const shots = shotsOf(
    [
      cypressTest(['Cart', 'loads'], 'passed'),
      cypressTest(['Cart', 'loads the cart'], 'failed'),
      cypressTest(['Suffix', 'retries'], 'passed'),
      cypressTest(['Suffix', 'retries (2)'], 'failed'),
      cypressTest(['Skipped', 'pays'], 'skipped'),
      cypressTest(['Pending', 'pays'], 'pending'),
      cypressTest(['Ran', 'pays'], 'failed')
    ],
    ['loads the cart.png', 'loads (failed) (attempt 2).png', 'retries (2).png', 'pays.png']
  );
  assert.deepEqual(shots, {
    'Cart › loads': [],
    'Cart › loads the cart': ['loads the cart.png'],
    'Suffix › retries': [],
    'Suffix › retries (2)': ['retries (2).png'],
    'Skipped › pays': [],
    'Pending › pays': [],
    'Ran › pays': ['pays.png']
  });
});

test('a renamed screenshot that more than one test could own goes to none, and a file listed twice is attached once', () => {
  const shots = shotsOf(
    [
      cypressTest(['Admin', 'case 1'], 'failed'),
      cypressTest(['Shop', 'case 1'], 'failed'),
      cypressTest(['Shop', 'case 2'], 'failed'),
      cypressTest(['Dirty', 'a/b'], 'failed'),
      cypressTest(['Dirty', 'ab'], 'failed')
    ],
    ['case 1.png', 'case 1.png', 'case 2.png', 'case 2.png', 'ab.png']
  );
  assert.deepEqual(shots, {
    'Admin › case 1': [],
    'Shop › case 1': [],
    'Shop › case 2': ['case 2.png'],
    'Dirty › a/b': [],
    'Dirty › ab': []
  });
});

test('a renamed screenshot that several tests could own goes to the only one that failed or was flaky', () => {
  const shots = shotsOf(
    [
      cypressTest(['Admin', 'opens the settings'], 'failed', 'failed'),
      cypressTest(['Viewer', 'opens the settings'], 'passed'),
      cypressTest(['Primary', 'loads the cube'], 'failed', 'passed'),
      cypressTest(['Secondary', 'loads the cube'], 'passed'),
      cypressTest(['Dirty', 'a/b'], 'failed'),
      cypressTest(['Dirty', 'ab'], 'passed')
    ],
    ['opens the settings.png', 'opens the settings (failed) (attempt 2).png', 'loads the cube.png', 'ab.png']
  );
  assert.deepEqual(shots, {
    'Admin › opens the settings': ['opens the settings.png', 'opens the settings (failed) (attempt 2).png'],
    'Viewer › opens the settings': [],
    'Primary › loads the cube': ['loads the cube.png'],
    'Secondary › loads the cube': [],
    'Dirty › a/b': ['ab.png'],
    'Dirty › ab': []
  });
});

test('a hook screenshot named without the inner describe titles goes to one test that ran, preferring a failed one', () => {
  const shots = shotsOf(
    [
      cypressTest(['Admin', 'case 1'], 'failed'),
      cypressTest(['Shop', 'case 1'], 'passed'),
      cypressTest(['Editor', 'exports the grid'], 'failed', 'failed'),
      cypressTest(['Reader', 'exports the grid'], 'passed'),
      cypressTest(['Left', 'case 2'], 'failed'),
      cypressTest(['Right', 'case 2'], 'failed'),
      cypressTest(['Skipped', 'case 3'], 'skipped'),
      cypressTest(['Ran', 'case 3'], 'passed')
    ],
    [
      'case 1 -- before each hook.png',
      'exports the grid -- before each hook.png',
      'exports the grid -- before each hook (failed) (attempt 2).png',
      'case 2 -- before each hook (failed).png',
      'case 3 -- before each hook.png'
    ]
  );
  assert.deepEqual(shots, {
    'Admin › case 1': ['case 1 -- before each hook.png'],
    'Shop › case 1': [],
    'Editor › exports the grid': ['exports the grid -- before each hook.png', 'exports the grid -- before each hook (failed) (attempt 2).png'],
    'Reader › exports the grid': [],
    'Left › case 2': [],
    'Right › case 2': [],
    'Skipped › case 3': [],
    'Ran › case 3': ['case 3 -- before each hook.png']
  });
});

test('screenshots saved under a custom name stay unattached even when the name is a test title', () => {
  const shots = shotsOf(
    [cypressTest(['Cart', 'checkout'], 'failed'), cypressTest(['Cart', 'cart'], 'passed')],
    ['Cart -- checkout (failed).png', 'cart.png'],
    ['cart.png']
  );
  assert.deepEqual(shots, {
    'Cart › checkout': ['Cart -- checkout (failed).png'],
    'Cart › cart': []
  });
});

test('clip file names stay short in bytes, not only in characters', () => {
  const name = basename(testVideoPath('/videos/emoji.cy.js.mp4', ['Emoji', '🚀'.repeat(85)]));
  assert.ok(Buffer.byteLength(name) <= 100, `${Buffer.byteLength(name)} bytes`);
  assert.notEqual(name, basename(testVideoPath('/videos/emoji.cy.js.mp4', ['Emoji', '🚀'.repeat(86)])));
});

test('warns when setupNodeEvents did not return the config', t => {
  const warn = t.mock.method(console, 'warn', () => undefined);
  const config = { projectRoot: tempDir(), video: false, isTextTerminal: true, env: {}, expose: {} } as unknown as Cypress.PluginConfigOptions;
  const neo = createNeoReporter(config, { history: false });
  neo.beforeRun({ config: { ...config, expose: {} } } as unknown as Cypress.BeforeRunDetails);
  assert.equal(warn.mock.calls.length, 1);
  assert.match(String(warn.mock.calls[0].arguments[0]), /return the config/);

  warn.mock.resetCalls();
  neo.beforeRun({ config: { ...config, expose: { [PLUGIN_FLAG]: true } } } as unknown as Cypress.BeforeRunDetails);
  neo.beforeRun();
  assert.equal(warn.mock.calls.length, 0);
});
