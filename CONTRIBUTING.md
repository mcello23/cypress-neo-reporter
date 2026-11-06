# Contributing

Thanks for helping. Issues and pull requests are welcome.

## Set up

```bash
git clone https://github.com/mcello23/cypress-neo-reporter.git
cd cypress-neo-reporter
CYPRESS_INSTALL_BINARY=0 npm install
```

The unit tests only need the Cypress package for its types, so the binary download can be skipped. `npm run e2e` downloads the binary it needs.

## Work on the report

```bash
npm run demo
```

This writes `demo/E2E-regression.html` from the fixture in `test/fixtures/summary.ts`. Open it in a browser, change the code in `src/html/`, run the command again.

## Before you open a pull request

```bash
npm run typecheck
npm test
npm run build
npm run e2e
```

`npm run e2e` packs the package, installs the tarball and Cypress into `e2e/` and runs the fixture project with real Cypress. `npm run e2e -- 15` picks a Cypress version. It needs the Cypress binary, so it does not work with `CYPRESS_INSTALL_BINARY=0` exported in your shell, or with `ELECTRON_RUN_AS_NODE=1` set, as some editor terminals do. CI runs it on Cypress 15 and 16.

- Keep the report a single file that works under its Content-Security-Policy: no external requests, inline script and style, `data:` and `blob:` media only.
- Check new UI in both the light and the dark theme.
- Add a test for every bug fix and every new option. Tests import internals from their own module, such as `src/history`, because `src/index.ts` exports only the public API. Tests with hostile input for the HTML, Markdown and prompts live in `test/render-security.test.ts`.
- Add every new option name to `KNOWN_OPTION_KEYS` in `src/validate.ts`, or it prints an unknown-option warning.
- Add a line to `CHANGELOG.md` under "Unreleased".

## Project layout

| Path | What it holds |
| --- | --- |
| `src/index.ts`, `src/plugin.ts` | Package entry points. Everything they export is public API. |
| `src/reporter.ts` | `createNeoReporter` and `neoReporter`: the Cypress events and the record task. |
| `src/support.ts`, `src/task.ts` | Browser side: `cy.step`, `cy.addTestContext`, `cy.businessGoal`, request and console capture, and the names it shares with the plugin. |
| `src/types.ts`, `src/validate.ts` | Option and report types, and option checks. |
| `src/summary.ts` | Builds the report data from the Cypress results. Recorded tests are kept in memory here. |
| `src/output.ts`, `src/merge.ts` | Writes the files, embeds or copies evidence, and merges JSON reports. |
| `src/html/` | The HTML report (`index.ts`), its styles (`styles.ts`) and the vendored player (`assets.ts`). |
| `src/markdown.ts`, `src/junit.ts`, `src/prompts.ts` | Markdown summary, JUnit XML, failure groups and AI prompts. |
| `src/history.ts`, `src/ci.ts` | Run history from Azure DevOps or a file, CI and git info, spec owners. |
| `src/redact.ts`, `src/video.ts`, `src/format.ts` | Redaction, video clips, shared helpers. |
| `src/cli.ts`, `src/gate.ts`, `src/notify.ts` | The `neo-reporter` command: `merge`, `gate` and `notify`. |
| `vendor/plyr-3.8.5/` | plyr's prebuilt player and MIT license, copied byte for byte from the plyr npm tarball. To upgrade, replace `plyr.min.js`, `plyr.css`, `plyr.svg` and `LICENSE.md` from the new tarball, rename the folder and update `PLYR_DIR` in `src/html/assets.ts`. |
| `test/` | Unit tests and the sample run used by the demo. |
| `e2e/` | The Cypress fixture project that `npm run e2e` runs. |
| `.github/workflows/` | `ci.yml` for pushes to `main` and pull requests, `release.yml` for publishing. |

## Releasing

1. Bump the version in `package.json` and `package-lock.json`.
2. Rename the "Unreleased" heading in `CHANGELOG.md` to the new version and add an empty "Unreleased" above it.
3. Commit, then `git tag vX.Y.Z && git push origin vX.Y.Z`.

The Release workflow publishes the tag to npm with trusted publishing and provenance. Nobody publishes from a laptop. `npm pack` and `npm publish` build `dist/` through `prepack`. A prerelease version needs an npm dist-tag, which the workflow does not pass.
