import type { ReportSummary, SpecData, TestData, TestStep } from '../../src/report';

const RUN_AT = Date.parse('2026-11-06T10:42:00Z');
const at = (offsetMs: number) => new Date(RUN_AT + offsetMs).toISOString();

const cartTotalError = `AssertionError: Timed out retrying after 10000ms: Expected to find element: [data-test=cart-total], but never found it.
    at Context.eval (webpack:///./cypress/e2e/checkout/payment.cy.ts:42:8)`;
const ordersError = `AssertionError: expected 500 to equal 200
    at Context.eval (webpack:///./cypress/e2e/orders/order-history.cy.ts:18:30)`;
const visitError = `CypressError: cy.visit() failed trying to load:

/account

We attempted to make an http request to this URL but the request failed without a response.`;

function steps(...entries: Array<[TestStep['phase'], string]>): TestStep[] {
  return entries.map(([phase, message], index) => ({ phase, message, timestamp: at(index * 900), durationMs: 900 }));
}

function passed(title: string[], duration = 2400): TestData {
  return { title, fullTitle: title.join(' › '), state: 'passed', duration, attempts: [{ state: 'passed' }], screenshots: [], steps: [] };
}

function failed(title: string[], error: string, extra: Partial<TestData> = {}): TestData {
  return {
    title,
    fullTitle: title.join(' › '),
    state: 'failed',
    duration: 14_200,
    startedAt: at(60_000),
    displayError: error,
    attempts: [
      { state: 'failed', error: { message: error } },
      { state: 'failed', error: { message: error } }
    ],
    screenshots: [],
    steps: steps(
      ['VISIT', 'Open /cart with 2 items'],
      ['FIND', 'Locate the discount field'],
      ['STEP', 'Apply code SPRING10'],
      ['CHECK', 'Cart total shows the discount']
    ),
    code: `it('${title[title.length - 1]}', () => {\n  cy.step('Open /cart with 2 items', 'VISIT');\n  cy.visit('/cart');\n  cy.get('[data-test=discount]').type('SPRING10{enter}');\n  cy.get('[data-test=cart-total]').should('contain', '€90.00');\n});`,
    network: [{ status: 503, url: 'https://staging.acme.test/api/cart/totals', timestamp: at(70_000) }],
    consoleErrors: ['TypeError: Cannot read properties of undefined (reading "total")'],
    ...extra
  };
}

function spec(specFile: string, owner: string, tests: TestData[]): SpecData {
  const count = (state: TestData['state']) => tests.filter(test => test.state === state).length;
  return {
    specFile: `cypress/e2e/${specFile}`,
    specName: specFile,
    owner,
    tests,
    duration: tests.reduce((sum, test) => sum + test.duration, 0),
    passes: count('passed') + count('flaky'),
    failures: count('failed'),
    pending: count('pending'),
    skipped: count('skipped'),
    total: tests.length
  };
}

function filler(area: string, count: number): TestData[] {
  return Array.from({ length: count }, (_, index) => passed([area, `scenario ${index + 1}`], 1500 + ((index * 337) % 4000)));
}

export function sampleSummary(): ReportSummary {
  const specs: SpecData[] = [
    spec('checkout/payment.cy.ts', 'Ana Ruiz', [
      failed(['Checkout', 'applies discount code at checkout'], cartTotalError),
      passed(['Checkout', 'pays with a saved card'], 6100),
      {
        ...passed(['Checkout', 'shows the 3-D Secure challenge'], 9800),
        state: 'flaky',
        displayError: 'Timed out retrying after 4000ms: expected iframe to be visible',
        attempts: [{ state: 'failed', error: { message: 'Timed out retrying after 4000ms: expected iframe to be visible' } }, { state: 'passed' }]
      },
      ...filler('Checkout', 12)
    ]),
    spec('cart/cart-summary.cy.ts', 'Ana Ruiz', [
      failed(['Cart summary', 'updates total when quantity changes'], cartTotalError),
      failed(['Cart summary', 'removes the last item'], cartTotalError),
      passed(['Cart summary', 'keeps the cart after reload']),
      ...filler('Cart summary', 10)
    ]),
    spec('cart/cart-badge.cy.ts', 'Leo Martin', [failed(['Cart badge', 'shows item count'], cartTotalError), ...filler('Cart badge', 6)]),
    spec('orders/order-history.cy.ts', 'Sam Lee', [failed(['Order history', 'lists orders of the last year'], ordersError), ...filler('Order history', 9)]),
    spec('orders/reorder.cy.ts', 'Sam Lee', [failed(['Reorder', 'reorders a past order'], ordersError), ...filler('Reorder', 5)]),
    spec('account/profile.cy.ts', 'Leo Martin', [
      failed(['Profile', 'updates the display name'], visitError, { network: [], consoleErrors: [] }),
      ...filler('Profile', 7)
    ]),
    spec('search/search.cy.ts', 'Leo Martin', [
      ...filler('Search', 14),
      { ...passed(['Search', 'suggests spelling fixes'], 0), state: 'pending', attempts: [] }
    ])
  ];
  const tests = specs.flatMap(item => item.tests);
  const count = (state: TestData['state']) => tests.filter(test => test.state === state).length;
  const totalPassed = count('passed') + count('flaky');
  const history: Record<string, string> = {};
  tests.forEach((test, index) => {
    history[test.fullTitle] = test.fullTitle.includes('removes the last item') ? 'PPPPPPPPFF' : index % 9 === 0 ? 'PPPPPFPPPP' : 'PPPPPPPPPP';
  });
  return {
    projectName: 'acme-storefront',
    suiteLabel: 'E2E regression',
    teamName: 'Web QA team',
    timeZone: 'Europe/Paris',
    theme: 'auto',
    timestamp: new Date(RUN_AT).toISOString(),
    browser: 'chrome 141',
    environment: 'https://staging.acme.test',
    resolution: '1280 × 720',
    totalDurationMs: specs.reduce((sum, item) => sum + item.duration, 0),
    totalSpecs: specs.length,
    totalTests: tests.length,
    totalPassed,
    totalFailed: count('failed'),
    totalPending: count('pending'),
    totalSkipped: count('skipped'),
    passRate: Math.floor((totalPassed / tests.length) * 100),
    specs,
    ci: {
      branch: 'main',
      commit: '4f2c9e1a7b3d5e6f',
      commitUrl: 'https://dev.azure.com/your-org/your-project/_git/acme-storefront/commit/4f2c9e1a7b3d5e6f',
      build: '20261106.3',
      buildUrl: 'https://dev.azure.com/your-org/your-project/_build/results?buildId=4211'
    },
    history: {
      family: 'E2E regression',
      runs: Array.from({ length: 10 }, (_, index) => ({
        id: 4201 + index,
        label: `202611${String(index + 1).padStart(2, '0')}.1`,
        date: new Date(RUN_AT - (10 - index) * 86_400_000).toISOString(),
        total: tests.length,
        passed: tests.length - (index === 5 ? 6 : index > 7 ? 2 : 1),
        failed: index === 5 ? 6 : index > 7 ? 2 : 1
      })),
      tests: history
    }
  };
}
