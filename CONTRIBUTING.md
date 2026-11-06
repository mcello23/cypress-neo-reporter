# Contributing

Thanks for helping. Issues and pull requests are welcome.

## Set up

```bash
git clone https://github.com/mcello23/cypress-neo-reporter.git
cd cypress-neo-reporter
CYPRESS_INSTALL_BINARY=0 npm install
```

The Cypress package is only needed for its types, so the binary download can be skipped.

## Work on the report

```bash
npm run demo
```

This writes `demo/E2E-regression.html` from the fixture in `test/fixtures/summary.ts`. Open it in a browser, change `src/report.ts`, run the command again.

## Before you open a pull request

```bash
npm run typecheck
npm test
npm run build
```

- Keep the report a single file with no external requests.
- Check new UI in both the light and the dark theme.
- Add a test for every bug fix and every new option.
- Add a line to `CHANGELOG.md` under "Unreleased".

## Project layout

| Path | What it holds |
| --- | --- |
| `src/report.ts` | Summary building, HTML, JUnit and Markdown output, Azure DevOps history, merging and the plugin. |
| `src/support.ts` | Browser side: `cy.step`, `cy.addTestContext`, `cy.businessGoal`, request and console capture. |
| `src/cli.ts` | The `neo-reporter` command. |
| `src/plugin.ts`, `src/index.ts` | Package entry points. |
| `test/` | Unit tests and the sample run used by the demo. |
