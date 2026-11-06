# Options

## Plugin options

Pass these as the third argument of `neoReporter(on, config, options)`, or the second of `createNeoReporter(config, options)`. Every option is optional.

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `projectName` | `string` | `name` in the project's `package.json`, else `'Cypress'` | Shown in the header and the page title. |
| `reportName` | `string` | none | Suite label next to the project name. Also used for file names. |
| `teamName` | `string` | none | Your team's name, shown in the header and the page title. |
| `showTeamName` | `boolean` | `true` | `false` hides the team name without removing it from your config. |
| `timeZone` | `string` | the machine's zone | IANA time zone for every time in the report. |
| `theme` | `'auto' \| 'light' \| 'dark'` | `'auto'` | The theme the report opens in. `'auto'` follows the reader's system. Readers can switch it, and their choice is remembered in the browser. |
| `outputDir` | `string` | `'cypress/reports'` | Where the files are written, relative to the project root. |
| `outputs` | `Array<'html' \| 'json' \| 'junit' \| 'markdown'>` | all four | The files to write. Run history is only loaded when `'html'` or `'markdown'` is on. |
| `history` | `HistoryOptions \| false` | Azure DevOps, when a token is set | Run history, see [History options](#history-options). `false` turns it off. |
| `reportUrl` | `string` | none | Link the Markdown summary points to. On GitHub Actions it defaults to the workflow run page. |
| `redact` | `false \| { patterns?: RegExp[]; replace?: (text: string) => string }` | on | Masks secrets in every output, see [Redaction](#redaction). |
| `includeTestCode` | `boolean` | `true` | `false` leaves test code out of every output and AI prompt. |
| `maxEmbedMb` | `number` | `150` | Most MB of screenshots and clips embedded in the report, see [Report size](#report-size). |
| `assets` | `'inline' \| 'folder'` | `'inline'` | `'folder'` copies screenshots and clips next to the report instead of embedding them. |
| `keepVideos` | `boolean` | `false` | `true` leaves Cypress's videos untouched. Clips of failed and flaky tests are still cut next to them. |

The plugin checks the options when Cypress starts. These stop the run with an error: `outputs` that is not an array of the four names, an unknown `theme`, `assets` or `history.provider`, a `maxEmbedMb` below 0, a `history.runs` or `history.maxWeeks` that is not a whole number above 0, and an unknown `timeZone`. An unknown option name prints a warning with the names it knows. `mergeReports` and `neo-reporter merge` check the same way.

By default, videos of passing specs are deleted and a failing spec's full video is replaced by per-test clips under `cypress/videos/<spec>/`, so Cypress Cloud uploads and CI artifact steps do not see the removed files. `keepVideos: true` turns that off.

## History options

| Option | Type | Default | Provider | What it does |
| --- | --- | --- | --- | --- |
| `history.provider` | `'azure-devops' \| 'file'` | `'azure-devops'` | both | Where history comes from. |
| `history.path` | `string` | `'cypress/reports/neo-history.jsonl'` | file | The history file, relative to the project root. For `neo-reporter merge`, relative to the working directory. |
| `history.organization` | `string` | `SYSTEM_TEAMFOUNDATIONCOLLECTIONURI`, else `SYSTEM_COLLECTIONURI` | Azure DevOps | Organization URL such as `https://dev.azure.com/your-org`, or just `your-org`. |
| `history.project` | `string` | `SYSTEM_TEAMPROJECT` | Azure DevOps | Azure DevOps project name. |
| `history.runName` | `string` | `NEO_TEST_RUN_NAME`, else matched by test names | Azure DevOps | Pins history to one test run title. |
| `history.runs` | `number` | `10` | both | How many previous runs to compare with. |
| `history.maxWeeks` | `number` | `8` | Azure DevOps | How far back to look for those runs. |

Azure DevOps history is read whenever `SYSTEM_ACCESSTOKEN` or `AZURE_DEVOPS_PAT` is set. Without a token, and without `provider: 'file'`, the report has no history. There is no built-in organization. In a pipeline the organization and project come from the agent. On your machine, set them here. See [Azure DevOps](azure-devops.md).

### History file

With `history: { provider: 'file' }`, every run with the `html` or `markdown` output reads the file, compares with the runs in it and adds one line. Each line is one JSON object:

```json
{"date":"2026-11-06T09:12:44.120Z","name":"E2E regression","branch":"main","label":"#412","tests":{"cypress/e2e/cart.cy.ts › Cart › adds an item":{"s":"P","d":1834}}}
```

- `name` is the report name (`reportName`, else `projectName`) and picks the lines that belong to this report.
- `branch` is the run's branch. History prefers lines of the same branch and falls back to every branch.
- `label` is the release, else the build number, else the short commit, else `Local run`.
- `tests` maps `<spec file> › <full test title>` to the state (`P` passed, `F` failed, `S` skipped or pending; flaky counts as `P`) and the duration `d` in milliseconds.

The file keeps the last `5 × history.runs` lines (50 by default). It only helps on CI when you keep it between runs, with a cache or the previous run's artifact. For parallel runs, pass `--history-file` to `neo-reporter merge` and leave the file provider off on the machines. Merge adds one line for the merged run and drops lines the machines wrote for the runs it merged.

## Redaction

Redaction is on by default. It replaces these with `[redacted]`:

- `Authorization`, `Cookie` and `Set-Cookie` header values, in raw and JSON form.
- Bearer tokens and JWT-shaped strings.
- The `user:password@` part of URLs.

It also drops the query string and fragment from recorded failed-request URLs and from the target URL. It covers error messages and stacks of every attempt, steps, business goals, console errors, request URLs, test code and the target URL, in every output: HTML, JSON, JUnit, Markdown, AI prompts and chat messages. Test titles, spec names, screenshots and videos are not changed.

```ts
neoReporter(on, config, {
  redact: {
    patterns: [/(?<=api_key=)\w+/g],
    replace: text => text.replace(/\b\d{16}\b/g, '[card]'),
  },
  includeTestCode: false,
});
```

- `patterns` adds to the built-in patterns. A pattern without the `g` flag is made global.
- `replace` runs on every captured text after the patterns.
- `redact: false` turns off the patterns and the URL trimming.

`mergeReports` and `neo-reporter merge` redact too, so merging also cleans JSON written by 1.x. The CLI has no flag for these options and always uses the defaults. `generateHtmlReport`, `generateMarkdownSummary` and `generateJUnitXml` do not redact: they render the summary they are given.

## Report size

Only failed and flaky tests' screenshots and clips are embedded, in this order: screenshots of failed tests, clips of failed tests, then the same for flaky tests. A file that no longer fits in `maxEmbedMb` is left out, measured as embedded base64, which is about 4/3 of the size on disk. The run log says how many files were left out. In the report, a clip that was left out says so, and a screenshot that was left out points to its file on disk. Screenshots of passing tests stay in the JSON as paths only.

`assets: 'folder'` copies every screenshot and clip of failed and flaky tests to `<name>.<id>-assets/` next to the report (`<name>-assets/` for a merged report), links them by relative path and keeps base64 out of the JSON. `maxEmbedMb` does not apply. Publish the folder with the report. `neo-reporter merge` finds a folder-mode run's files next to its JSON and embeds them, unless the merge uses `assets: 'folder'` too.

Neither option has a CLI flag. `mergeReports()` accepts both.

## Environment variables

| Variable | Used for |
| --- | --- |
| `SYSTEM_ACCESSTOKEN` | Reading past test runs in a pipeline. |
| `AZURE_DEVOPS_PAT` | The same, from your machine. Needs the Test Management (Read) scope. |
| `SYSTEM_TEAMFOUNDATIONCOLLECTIONURI`, `SYSTEM_COLLECTIONURI` | Organization for history and the build link. The first one wins when both are set. |
| `SYSTEM_TEAMPROJECT` | Project for history and the build link. |
| `BUILD_BUILDNUMBER`, `BUILD_BUILDID` | Build label and link in the header. The current build is left out of history. |
| `BUILD_SOURCEBRANCH`, `BUILD_SOURCEVERSION` | Branch and commit. History prefers runs of the same branch. |
| `BUILD_REPOSITORY_URI` | Commit link. |
| `BUILD_DEFINITIONID`, `RELEASE_DEFINITIONID` | Limits history to runs of the same pipeline. |
| `RELEASE_RELEASENAME`, `RELEASE_RELEASEWEBURL` | Release label and link for classic release pipelines. |
| `RELEASE_RELEASEID` | Leaves the current release out of history. |
| `NEO_TEST_RUN_NAME` | Pins history to one test run title. |
| `TF_BUILD` | When set, the Markdown summary is attached to the pipeline run. |
| `GITHUB_ACTIONS` | Turns on GitHub Actions detection. |
| `GITHUB_HEAD_REF`, `GITHUB_REF_NAME` | Branch. The head ref comes first, so pull requests show their own branch. |
| `GITHUB_EVENT_PATH`, `GITHUB_SHA` | Commit. On pull requests, the head commit from the event payload. |
| `GITHUB_SERVER_URL`, `GITHUB_REPOSITORY`, `GITHUB_RUN_ID`, `GITHUB_RUN_NUMBER` | Commit and run links, run number label. |
| `GITHUB_STEP_SUMMARY` | When set, the Markdown summary is added to the job summary, by the plugin and by `merge`. |
| `GITLAB_CI` | Turns on GitLab CI detection. |
| `CI_MERGE_REQUEST_SOURCE_BRANCH_NAME`, `CI_COMMIT_REF_NAME` | Branch. The merge request's source branch comes first. |
| `CI_COMMIT_SHA`, `CI_PROJECT_URL` | Commit and commit link. |
| `CI_PIPELINE_ID`, `CI_PIPELINE_URL` | Pipeline label and link. |
| `NEO_SLACK_WEBHOOK`, `NEO_TEAMS_WEBHOOK` | Webhooks for `notify` and `merge` when `--slack` or `--teams` is not given. |
| `CYPRESS_BASE_URL` | The target URL in the header when the run config has no `baseUrl`. |

CI agents set the build variables themselves. You set the tokens, the webhooks and `NEO_TEST_RUN_NAME`. GitHub Actions is checked first, then GitLab CI, then Azure Pipelines. Outside those three, branch and commit are read from git.

## Spec owners

The report shows an owner for each spec: the person with the most commits to it. That needs the full git history, and CI checkouts are often shallow. To set owners yourself, add a `spec-owners.json` at the project root:

```json
{
  "cypress/e2e/checkout/payment.cy.ts": "Ana Ruiz",
  "cypress/e2e/orders/reorder.cy.ts": "Sam Lee"
}
```

## CLI

```text
neo-reporter <command> [options]
```

| Command | What it does |
| --- | --- |
| `merge [dir]` | Merges the JSON reports found under `dir` into one report. |
| `gate <report.json>` | Exits 1 when a report fails the quality gate. |
| `notify <report.json>` | Posts a short run summary to Slack or Microsoft Teams. |

`-h`, `--help` lists the commands and `-v`, `--version` prints the version. `neo-reporter <command> --help` lists the flags of one command. The command comes first: `neo-reporter --name x merge` is a usage error.

### merge

```text
neo-reporter merge [dir] [options]
```

Merges the JSON reports found under `dir` (default `cypress/reports`, searched recursively) into one report. Merged reports already in `dir` are skipped.

| Flag | What it does |
| --- | --- |
| `--out <dir>` | Where to write the merged report. Default: `dir`. |
| `--name <name>` | Report name, also used for file names. |
| `--project <name>` | Project name shown in the header. |
| `--team <name>` | Team name shown in the header. |
| `--hide-team` | Leave the team name out. |
| `--time-zone <zone>` | IANA time zone for every time in the report. |
| `--theme <theme>` | `auto`, `light` or `dark`. |
| `--outputs <list>` | Comma-separated: `html,markdown,junit,json`. Default: `html,markdown`. |
| `--report-url <url>` | Link the Markdown summary and the chat message point to. |
| `--history-file <path>` | Read run history from this JSONL file and add the merged run to it. |
| `--baseline <file>` | Compare with one earlier report JSON instead of run history. It never writes the history file, and a baseline inside `dir` is not merged. |
| `--no-history` | Skip run history. |
| `--fail-on`, `--min-pass-rate`, `--quarantine` | Gate the merged run after writing its outputs, as [gate](#gate) does. |
| `--slack`, `--teams` | Post the merged run, as [notify](#notify) does. A failed post only warns. |

The merged report does not write JUnit by default, so a CI test tab that already reads each machine's JUnit file does not count every test twice. Merge counts every run it finds. It warns when the same spec, browser and testing type appear in more than one file, and for each file whose `schemaVersion` is missing or different, such as JSON written by 1.x. It skips, with a warning, files with unexpected field values.

`--baseline` takes a run's `<name>.<id>.json` or a merged `<name>.json`.

### gate

```text
neo-reporter gate <report.json> [options]
```

Checks one JSON report. Pass `--fail-on`, `--min-pass-rate` or both.

| Flag | What it does |
| --- | --- |
| `--fail-on new` | Fails on new failures: tests that failed now and did not fail the last time they ran, new tests included. Needs run history in the report. |
| `--fail-on failed` | Fails on any failure. |
| `--min-pass-rate <n>` | Fails when the pass rate is below `n`, from 0 to 100. |
| `--quarantine <file>` | Tests that do not count. Default: `quarantine.json` in the working directory, when it exists. |

The pass rate is the one in the report header: passed and flaky tests over all tests, rounded down. Quarantined tests are left out of it. Without run history, `--fail-on new` exits 1 instead of guessing. History is in the JSON when the run had Azure DevOps or file history and the `html` or `markdown` output on.

The gate prints the quarantined failures with their reason, how many known failures it did not count, the failures it counted, the pass-rate verdict, and `Gate passed` or `Gate failed`.

For a single run, let Cypress finish and gate its JSON. The file name carries the run's id, so use a glob on a clean CI agent:

```bash
npx cypress run || true
npx neo-reporter gate cypress/reports/E2E-regression.*.json --fail-on new --min-pass-rate 95
```

### Quarantine file

A JSON object. A key is a spec file (all its tests) or `<spec file> › <full test title>`, exactly as the gate prints it. The value is the reason or the ticket.

```json
{
  "cypress/e2e/orders/reorder.cy.ts": "ORD-9 reorder API rebuild",
  "cypress/e2e/cart/cart-badge.cy.ts › Cart badge › shows item count": "WEB-12"
}
```

Quarantined tests count neither as failures nor in the pass rate. A missing `--quarantine` file or a file of another shape exits 1. Quarantine only affects the gate. The HTML and Markdown reports do not show it.

### notify

```text
neo-reporter notify <report.json> [options]
```

| Flag | What it does |
| --- | --- |
| `--slack <url>` | Slack incoming webhook. Default: `NEO_SLACK_WEBHOOK`. |
| `--teams <url>` | Microsoft Teams Workflows webhook, from the "Post to a channel when a webhook request is received" template. It gets an Adaptive Card. Default: `NEO_TEAMS_WEBHOOK`. |
| `--report-url <url>` | Link the message points to. |

The message has the status and title, the failed, flaky and passed counts with pass rate and duration, new, known and fixed failures when the report has history, branch, commit and build, and the top 5 failure groups. It is built from the report data, which is already redacted. Keep webhooks in secrets, never in config. The URL is never printed. A post times out after 15 seconds.

`merge` posts too when `--slack`, `--teams` or the variables are set. Post once per pipeline, after the merge: not from each machine, and not from both `merge` and `notify`.

### Exit codes

| Code | `merge` | `gate` | `notify` |
| --- | --- | --- | --- |
| `0` | Merged, and the gate passed when one was asked for | The gate passed | Every post went through |
| `1` | Nothing to merge, the gate failed, or an error | The gate failed, or the report cannot be checked | A post failed, or the report cannot be read |
| `2` | Usage error | Usage error | Usage error |

A usage error is a missing or unknown command, an unknown flag, a missing value, an extra argument, a bad `--theme`, `--outputs`, `--fail-on` or `--min-pass-rate` value, `gate` without `--fail-on` or `--min-pass-rate`, `--quarantine` alone, or `notify` without a webhook. The message and the usage go to stderr. An unknown `--time-zone` is a runtime error and exits 1. `--help` and `--version` exit 0.

## Programmatic API

```ts
import {
  neoReporter,
  createNeoReporter,
  generateReports,
  mergeReports,
  generateHtmlReport,
  generateMarkdownSummary,
  generateJUnitXml,
} from 'cypress-neo-reporter';
```

| Export | Signature | What it does |
| --- | --- | --- |
| `neoReporter` | `(on, config, options?: NeoReporterOptions) => config` | Registers the plugin's events and returns the config. |
| `createNeoReporter` | `(config, options?: NeoReporterOptions) => { beforeRun, tasks, afterSpec, afterRun }` | The same handlers, to call from your own events. See [Known limitations](../README.md#known-limitations). |
| `generateReports` | `(runResults, options?: NeoReporterOptions) => Promise<ReportFiles>` | Writes the outputs for a `cypress run` result. |
| `mergeReports` | `(options?: MergeOptions) => Promise<MergeResult \| null>` | Merges JSON reports. Returns `{ summary, files }`, or `null` when there was nothing to merge. |
| `generateHtmlReport` | `(summary: ReportSummary) => string` | Renders the HTML report from the report JSON. |
| `generateMarkdownSummary` | `(summary: ReportSummary, reportUrl?: string) => string` | Renders the Markdown summary. |
| `generateJUnitXml` | `(summary: ReportSummary) => string` | Renders the JUnit XML. |

Types: `ReportSummary`, `SpecData`, `TestData`, `NeoReporterOptions`, `MergeOptions`, `HistoryOptions`, `ReportOutput`, `ReportTheme`, `ReportFiles` and `MergeResult`. They reference Cypress's global types, so they need `cypress` installed (it is a peer dependency), but no `types` entry in `tsconfig.json`.

`cypress-neo-reporter/plugin` exports `neoReporter`, `createNeoReporter`, `generateReports`, `mergeReports` and the types `NeoReporterOptions`, `MergeOptions`, `HistoryOptions`, `ReportOutput`, `ReportTheme` and `ReportFiles`. `cypress-neo-reporter/support` is imported for its side effects and exports the `StepPhase` type.

`generateReports` writes what the plugin writes at the end of a run. Steps recorded by the support file are kept in the memory of the plugin's process, so call it from an `after:run` handler in that process. Called from a separate script, the report has no steps.

`ReportFiles` holds the path of each file written: `{ html?, json?, junit?, markdown? }`.

`mergeReports` takes the plugin options plus these. The gate and the chat post are CLI only.

| Option | Default | CLI |
| --- | --- | --- |
| `reportRoot` | `'cypress/reports'` | `[dir]`. Searched recursively, relative to the working directory. |
| `summaryFiles` | none | none. Merges these JSON files instead of searching `reportRoot`. |
| `outputDir` | `reportRoot` | `--out` |
| `baseline` | none | `--baseline` |
| `reportName`, `projectName`, `teamName` | the first report's | `--name`, `--project`, `--team` |
| `showTeamName` | `true` | `--hide-team` sets `false`. |
| `timeZone`, `theme` | the first report's | `--time-zone`, `--theme` |
| `outputs` | `['html', 'markdown']` | `--outputs` |
| `reportUrl` | none | `--report-url` |
| `history` | Azure DevOps, when a token is set | `--history-file <path>` sets `{ provider: 'file', path }`, `--no-history` sets `false`. |
| `redact`, `includeTestCode`, `maxEmbedMb`, `assets` | as for the plugin | none |

## JSON report

The `json` output is the stable contract for your own dashboards. A run writes `<name>.<id>.json`, where the id comes from the browser, base URL, viewport and spec files. A merged report writes `<name>.json`.

| Field | What it holds |
| --- | --- |
| `schemaVersion` | Version of the JSON shape, `1` since 2.0.0. |
| `reporterVersion` | Version of `cypress-neo-reporter` that wrote the file. |
| `projectName`, `suiteLabel`, `teamName` | Names shown in the header. |
| `timestamp` | When the report was built, ISO 8601. |
| `browser` | Browser and version. A merged report lists every browser, comma-separated. |
| `environment` | The target URL (`baseUrl`). |
| `resolution` | The viewport. |
| `totalSpecs`, `totalTests`, `totalPassed`, `totalFailed`, `totalPending`, `totalSkipped`, `totalDurationMs` | Run totals. `totalPassed` includes flaky tests. |
| `passRate` | Passed over all tests, in percent, rounded down. |
| `specs[]` | One entry per spec: `specFile`, `specName`, `owner`, `browser`, `testingType` (`e2e` or `component`), `duration`, `passes`, `failures`, `pending`, `skipped`, `total`, `video` and `tests[]`. |
| `specs[].tests[]` | `title` (the title path as an array), `fullTitle` (joined with ` › `), `state` (`passed`, `flaky`, `failed`, `pending` or `skipped`), `duration`, `startedAt`, `displayError`, `attempts`, `steps`, `businessGoal`, `code`, `screenshots`, `video`, `network`, `consoleErrors` and `tags`. |
| `ci` | `branch`, `commit`, `build` and `release`, with links. |
| `history` | The history the report compared with: `family`, `source`, `runs`, `tests` (for each full title, a code per earlier run, oldest first: `P`, `F`, `S`, or `-` when it did not run) and `durations` (median passing duration in milliseconds). |
| `timeZone`, `theme` | Display settings. |
| `mergedFrom` | How many runs were merged. Only on merged reports. |

With `assets: 'inline'`, embedded screenshots and clips carry their content in `base64` as data URLs. With `assets: 'folder'`, `path` is relative to the report.
