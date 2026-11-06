# Cypress Neo Reporter

One HTML report for Cypress runs: failures grouped by cause, history from your CI and the evidence behind every failed test.

[![npm](https://img.shields.io/npm/v/cypress-neo-reporter)](https://www.npmjs.com/package/cypress-neo-reporter)
[![license](https://img.shields.io/npm/l/cypress-neo-reporter)](LICENSE)
[![CI](https://github.com/mcello23/cypress-neo-reporter/actions/workflows/ci.yml/badge.svg)](https://github.com/mcello23/cypress-neo-reporter/actions/workflows/ci.yml)
![cypress 15+](https://img.shields.io/badge/cypress-15%2B-informational)
![node 20+](https://img.shields.io/badge/node-20%2B-informational)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/report-dark.png">
  <img alt="The report overview: pass rate, failure groups and run history" src="docs/assets/report-light.png">
</picture>

## Features

- **Failure groups.** Tests that broke for the same reason sit together, so one fix closes the group.
- **Run history.** Each failure is marked new, known or fixed against your last 10 runs in Azure DevOps.
- **Evidence per test.** Steps, screenshots, a video clip of the failed test, failed requests and console errors.
- **AI triage prompts.** Copy one prompt for the whole run or for one test and paste it into any assistant. No API keys, nothing leaves the file.
- **Your team's name.** Put your team in the header and the page title with `teamName`, hide it with `showTeamName: false`.
- **Your time zone.** Every time in the report uses the zone you set with `timeZone`, not the CI machine's.
- **Light and dark.** Follows the reader's system by default, with a switch in the header.
- **One file.** No server and no external assets. Open it offline, attach it to a ticket, keep it as a build artifact. Parallel runs merge into one.

## Requirements

- Cypress 15 or later
- Node.js 20 or later

Video clips use the ffmpeg build that ships with Cypress, so there is nothing else to install.

## Install

```bash
npm install --save-dev cypress-neo-reporter
```

## Set up

Register the plugin in `setupNodeEvents`:

```ts
import { defineConfig } from 'cypress';
import { neoReporter } from 'cypress-neo-reporter/plugin';

export default defineConfig({
  video: true,
  e2e: {
    setupNodeEvents(on, config) {
      neoReporter(on, config, {
        projectName: 'acme-storefront',
        reportName: 'E2E regression',
        teamName: 'Web QA team',
        timeZone: 'Europe/Paris',
      });
      return config;
    },
  },
});
```

Then import the support file in `cypress/support/e2e.ts`:

```ts
import 'cypress-neo-reporter/support';
```

The support file records steps, failed requests and console errors for each test. Without it the report still works, without the step list.

Run Cypress headless as usual (`npx cypress run`). The report is written when the run finishes.

## Output files

Files are written to `cypress/reports` and named after `reportName`, or `projectName` when there is no report name.

| File | What it is |
| --- | --- |
| `E2E-regression.html` | The report. One file, screenshots and clips inside. |
| `E2E-regression.json` | Every result as data, for your own dashboards and for `neo-reporter merge`. |
| `E2E-regression.junit.xml` | For any CI test tab: Azure DevOps, GitLab, Jenkins. |
| `E2E-regression.summary.md` | A short summary for pipeline pages and pull request comments. |

## Options

Every option is optional.

| Option | Default | What it does |
| --- | --- | --- |
| `projectName` | `package.json` name | Shown in the header. |
| `reportName` | none | Suite label next to the project name. Also the file name. |
| `teamName` | none | Your team's name, shown in the header and the page title. |
| `showTeamName` | `true` | Set to `false` to hide the team name and keep it in your config. |
| `timeZone` | the machine's zone | IANA name used for every time in the report, such as `America/New_York`. |
| `theme` | `'auto'` | `'light'`, `'dark'` or `'auto'` to follow the reader's system. Readers can still switch it. |
| `outputDir` | `'cypress/reports'` | Where the files are written. |
| `outputs` | all four | Any of `'html'`, `'json'`, `'junit'`, `'markdown'`. |
| `history` | on | Azure DevOps history settings, or `false` to turn it off. See [Azure DevOps](docs/azure-devops.md). |
| `reportUrl` | none | Link the Markdown summary points to, such as your published pipeline artifact. |

All options, the CLI and the environment variables are in [docs/options.md](docs/options.md).

## Logging steps

The support file adds three commands. Steps show in the Cypress command log and in the report, and the last steps before a failure go into the AI prompt.

```ts
it('applies a discount code', () => {
  cy.step('Open the cart with 2 items', 'VISIT');
  cy.visit('/cart');
  cy.step('Apply SPRING10', 'STEP');
  cy.get('[data-test=discount]').type('SPRING10{enter}');
  cy.step('Total shows the discount', 'CHECK');
  cy.get('[data-test=cart-total]').should('contain', '€90.00');
});
```

| Command | Use it for |
| --- | --- |
| `cy.step(message, phase?)` | One step. Phases: `VISIT`, `FIND`, `STEP`, `CHECK`, `INFO` (default). |
| `cy.addTestContext({ title, value })` | Extra data shown with the steps, such as the test user or an order ID. |
| `cy.businessGoal(goal, persona?)` | What the test proves, in plain words. Shown above the steps. |

In the Cypress app, press <kbd>Alt</kbd>+<kbd>S</kbd> to show only these steps in the command log.

## Parallel runs

Keep the `json` output on each machine, collect the JSON files in one folder, then merge them:

```bash
npx neo-reporter merge downloaded-reports --name "E2E regression"
```

The merged report gets HTML and Markdown by default. Run `npx neo-reporter merge --help` for every flag.

## CI integrations

| CI | Build links | Failure history | Pipeline summary |
| --- | --- | --- | --- |
| Azure DevOps | Supported | Supported | Supported |
| GitHub Actions | Planned | Planned | Planned |
| GitLab CI | Planned | Planned | Planned |
| Any other CI | Branch and commit from git | Not available | `summary.md` file |

JUnit XML is written on every CI, so the native test tab keeps working. See [Azure DevOps](docs/azure-devops.md) for the pipeline setup.

## Known limitations

- Cypress keeps only one handler per `before:run`, `after:run` and `after:spec` event. If another plugin listens to the same events, the last one registered wins.
- Video clips need `video: true` and are only cut for failed or flaky tests. Videos of passing specs are deleted to save space.
- Failed requests are recorded from the browser's resource timing, which reports status codes in Chromium-based browsers only.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
npm install
npm test
npm run demo
```

`npm run demo` builds a sample report in `demo/` from the fixture in `test/fixtures`, so you can work on the report without a Cypress project.

## License

[MIT](LICENSE) © Marcelo Costa. Not affiliated with Cypress.io or Microsoft.
