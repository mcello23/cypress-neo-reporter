# Options

## Plugin options

Pass these as the third argument of `neoReporter(on, config, options)`, or the second of `createNeoReporter(config, options)`. Every option is optional.

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `projectName` | `string` | `name` in the project's `package.json`, else `'Cypress'` | Shown in the header and the page title. |
| `reportName` | `string` | none | Suite label next to the project name. Also used for file names, unless `fileName` is set. |
| `fileName` | `string` | `reportName`, else `projectName` | Base of the file names, such as `'Release 42 Chrome'` for `Release-42-Chrome.html`, so `reportName` can stay a short label. Kept in the JSON, so a `{file}` in `reportUrl` and the Lanes table link the right file. |
| `teamName` | `string` | none | Your team's name, shown in the header and the page title. |
| `showTeamName` | `boolean` | `true` | `false` hides the team name without removing it from your config. |
| `timeZone` | `string` | the machine's zone | IANA time zone for every time in the report. |
| `theme` | `'auto' \| 'light' \| 'dark'` | `'auto'` | The theme the report opens in. `'auto'` follows the reader's system. Readers can switch it, and their choice is remembered in the browser. |
| `css` | `string` | none | CSS added after the built-in styles, see [Custom styles](#custom-styles). |
| `outputDir` | `string` | `'cypress/reports'` | Where the files are written, relative to the project root. |
| `summaryDir` | `string` | `outputDir` | Where the summary output is written, relative to the project root. |
| `outputs` | `Array<'html' \| 'json' \| 'junit' \| 'markdown' \| 'summary'>` | `['html', 'json', 'junit', 'markdown']` | The files to write. `'summary'` writes `<name>.<id>.summary.json`: the JSON without screenshots, videos, or steps and code of passed tests, for merging lanes. Run history is only loaded when `'html'` or `'markdown'` is on. |
| `history` | `HistoryOptions \| false` | Azure DevOps, when a token is set | Run history, see [History options](#history-options). `false` turns it off. |
| `reportUrl` | `string` | none | Link the Markdown summary points to. On GitHub Actions it defaults to the workflow run page. A `{file}` in it is replaced by the report's HTML file name, so one template serves a lane, the lanes report and merges, and each Lanes table row links to its lane's report. |
| `remoteLanes` | `RemoteLanesOptions` | none | Builds a lanes report from the other lanes' summaries in an Azure Blob Storage folder, see [Remote lanes](#remote-lanes). |
| `redact` | `false \| { patterns?: RegExp[]; replace?: (text: string) => string; keepQuery?: boolean }` | on | Masks secrets in every output, see [Redaction](#redaction). |
| `includeTestCode` | `boolean` | `true` | `false` leaves test code out of every output and AI prompt. |
| `maxEmbedMb` | `number` | `150` | Most MB of screenshots and clips embedded in the report, see [Report size](#report-size). |
| `assets` | `'inline' \| 'folder'` | `'inline'` | `'folder'` copies screenshots and clips next to the report instead of embedding them. |
| `keepVideos` | `boolean` | `false` | `true` leaves Cypress's videos untouched. Clips of failed and flaky tests are still cut next to them. |
| `flakyWarnings` | `boolean` | `false` | `true` logs a warning for each flaky test on Azure Pipelines and GitHub Actions, linked to its spec file. The plugin then registers `after:spec` there even with video off. |
| `failedRequestStatuses` | `number[]` | none | Status codes recorded as failed requests on top of 500 and up, such as `[401, 429]`. |

The plugin checks the options when Cypress starts. These stop the run with an error: `outputs` that is not an array of the five names, an unknown `theme`, `assets` or `history.provider`, a `maxEmbedMb` below 0, a `history.runs` or `history.maxWeeks` that is not a whole number above 0, an unknown `timeZone`, a `css` that is not a string, a `flakyWarnings` that is not a boolean, a `summaryDir` or `fileName` that is not a non-empty string, a `failedRequestStatuses` that is not an array of whole numbers from 100 to 599, a `redact` other than `false` or an object with optional `patterns` (an array of RegExp), `replace` (a function) and `keepQuery` (a boolean), and a `remoteLanes` that is not an object, whose `azureBlob` is not the `https://` URL of a folder in a container without a query string, whose `sas`, `run`, `reportName`, `fileName`, `projectName` or `releaseStage` is given but is not a non-empty string, or whose `junit` is not `{ path, testName? }` with non-empty strings. The `remoteLanes` messages never repeat the folder URL or a SAS. An unknown option name prints a warning with the names it knows. `generateReports`, `mergeReports` and `neo-reporter merge` check the same way. `reportRoot`, `summaryFiles` and `baseline` are only known to `mergeReports`, so the plugin and `generateReports` warn about them as unknown.

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

Lines that are not history lines, such as broken JSON or a line without `tests`, are skipped and dropped the next time the file is written.

## Redaction

Redaction is on by default. It replaces these with `[redacted]`:

- `Authorization`, `Cookie` and `Set-Cookie` header values (every value of a Set-Cookie array), in raw and JSON form.
- Bearer tokens and JWT-shaped strings.
- The `user:password@` part of URLs.
- Values of JSON keys whose name contains `pass`, `secret`, `token`, `api-key`, `api_key` or `apikey`, in any case, such as `"password": "[redacted]"`. Only double-quoted string values are masked.
- The values of the URL parameters `token`, `access_token`, `sig`, `code`, `key` and `password` after `?`, `&` or `#`, wherever they appear, including steps, console errors and test code.

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
- `keepQuery: true` keeps the query string and fragment of failed-request URLs and the target URL. In those URLs, the value of every parameter whose name ends with `token`, `key`, `secret`, `sig`, `signature`, `password`, `credential` or `session`, in any case, is masked, such as `refresh_token`, `api_key`, `client_secret` or `X-Amz-Signature`. Add `patterns` for others.
- `redact: false` turns off the patterns and the URL trimming.

`mergeReports` and `neo-reporter merge` redact too, so merging also cleans JSON written by 1.x. The only redaction flag of `merge` is `--keep-query`. A merge must get the same `keepQuery`, or it trims the query strings again. `generateHtmlReport`, `generateMarkdownSummary` and `generateJUnitXml` do not redact: they render the summary they are given.

## Report size

Only failed and flaky tests' screenshots and clips are embedded, in this order: screenshots of failed tests, clips of failed tests, then the same for flaky tests. A file that no longer fits in `maxEmbedMb` is left out, measured as embedded base64, which is about 4/3 of the size on disk. The run log says how many files were left out. In the report, a clip that was left out says so, and a screenshot that was left out points to its file on disk. Screenshots of passing tests stay in the JSON as paths only.

`assets: 'folder'` copies every screenshot and clip of failed and flaky tests to `<name>.<id>-assets/` next to the report (`<name>-assets/` for a merged report), links them by relative path and keeps base64 out of the JSON. `maxEmbedMb` does not apply. Publish the folder with the report. `neo-reporter merge` finds a folder-mode run's files next to its JSON and embeds them, unless the merge uses `assets: 'folder'` too. Merge only embeds or copies evidence that a run already embedded or that sits inside its JSON's folder, such as `<name>.<id>-assets/`. Paths that point outside that folder, with `../` or an absolute path elsewhere, are dropped.

Neither option has a CLI flag. `mergeReports()` accepts both.

## Custom styles

`css` adds your own CSS to the report, after the built-in styles:

```ts
neoReporter(on, config, {
  css: `
    :root[data-theme="dark"] { --color-brand: #7c9cff; }
    :root[data-theme="light"] { --color-brand: #2b4fd8; --font-sans: Georgia, serif; }
  `,
});
```

Set custom properties such as `--color-brand` and `--font-sans` per theme with `:root[data-theme="dark"]` and `:root[data-theme="light"]`. Class names may change between versions, so prefer the custom properties.

A `</style` in it, in any case, is written as `<\/style`, so the text cannot close its style element. Everything else is kept as written, so range queries such as `@media (width < 600px)` work. The Content-Security-Policy allows fonts only from `data:` URLs, and images only from `data:`, `blob:` and `file:` URLs and the report's own location, so remote `@import` and `url()` do not load. Embed fonts and images as `data:` URLs.

The JSON keeps `css`. Merged reports use the first report's `css` unless you pass `css` to `mergeReports`. The CLI has no flag for it.

## Remote lanes

When a pipeline runs lanes in separate jobs or stages, such as one per browser or target, `remoteLanes` gives each lane a report of every lane. Each lane's summary is uploaded to one Azure Blob Storage folder. At the end of each lane, the plugin reads the summaries already there and merges them with its own run.

```ts
neoReporter(on, config, {
  reportName: 'Chrome',
  outputDir: 'cypress/results/reports',
  summaryDir: 'cypress/results/summaries',
  remoteLanes: {
    azureBlob: 'https://<account>.blob.core.windows.net/<container>/<path>/',
    junit: { path: 'cypress/results/all-lanes.junit.xml' },
  },
});
```

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `azureBlob` | `string` | required | The `https://` URL of the folder that holds the lane summaries, such as `https://<account>.blob.core.windows.net/<container>/<path>/`, without a query string. |
| `sas` | `string` | `NEO_BLOB_SAS` | A SAS with read and list permissions (`sp=rl`), with or without the leading `?`. Keep it in a secret variable, not in config. |
| `run` | `string` | the CI release name, else the build label | Only lane summaries whose CI release name, else build label, equals `run` count: the release name in a classic release, the build number on Azure Pipelines, `#<run number>` on GitHub Actions and `#<pipeline id>` on GitLab CI. Lanes do not save `run` in their summary, so it cannot match lanes that ran off CI. |
| `reportName` | `string` | `'All lanes'` | Name of the lanes report. Also used for its file names, unless `fileName` is set. |
| `fileName` | `string` | `reportName` | Base of the lanes report's file names, such as `'Release 42 All lanes'`. |
| `projectName` | `string` | the lane's `projectName` | Project name in the lanes report's header, so every lane writes the same title. |
| `junit` | `{ path: string; testName?: string }` | none | Writes a JUnit file to `path`, relative to the project root, with one passed test named `testName` (default: `reportName`). The test's output holds the lanes summary and attaches the lanes HTML report, so a CI test tab opens it. |
| `releaseStage` | `string` | none | Adds a link to the Tests tab of this stage of the current Azure DevOps classic release. Needs `SYSTEM_ACCESSTOKEN`, or `AZURE_DEVOPS_PAT` with the Release (Read) scope, and a classic release run (`RELEASE_RELEASEID`, `SYSTEM_TEAMPROJECT` and the collection URI). Without them the link is left out without a warning. |

At the end of each lane:

1. The lane writes its `summary` output to `summaryDir`, even when `outputs` leaves it out.
2. It lists the folder, downloads the lane summaries and keeps those of the same run.
3. It merges them with its own run into `All-lanes.html` and `All-lanes.summary.md` in `outputDir`, with a Lanes table, also when no other lane is in the folder yet. The header lists the target of every lane.
4. With `junit`, it writes the JUnit file.
5. Its own Markdown summary ends with the lanes summary, after a horizontal rule. That file is the only summary attached to the run on Azure Pipelines and GitHub Actions. `All-lanes.summary.md` is not attached, so keep the `markdown` output on. When the lanes report is skipped or not written, as described below, the lane's summary stays as it is.

Good to know:

- neo-reporter only reads the folder (`sp=rl`). Your pipeline uploads `summaryDir` to the folder after Cypress ends, and the reports wherever `reportUrl` points.
- Only blobs whose names end in `.summary.json` count, in the folder and its subfolders.
- The lanes report rolls. Each lane writes it again with the lanes it finds, and the copy of the last lane to finish wins. Lanes that finish at the same time can miss each other. Rebuild the report after the last lane with `neo-reporter merge --azure-blob <folder> --run <name>`.
- A summary in the folder with this lane's own file name, such as one from an earlier attempt, is replaced by the fresh run.
- A missing or expired SAS, a failed listing, a broken lane summary or a release that cannot be read only warns. The lane's own report is written either way, and no warning shows the SAS.
- Off CI, with no release or build to match lanes by, the lanes report is skipped. Set `run` to pick the lanes of one CI release or build.
- `mergeReports({ remoteLanes })` and `neo-reporter merge --azure-blob` read the same folder, see [merge](#merge).

[Azure DevOps](azure-devops.md#4-combine-lanes-on-blob-storage-optional) shows the pipeline steps.

## Environment variables

| Variable | Used for |
| --- | --- |
| `SYSTEM_ACCESSTOKEN` | Reading past test runs in a pipeline, and the stage id for `remoteLanes.releaseStage`, which needs permission to view releases. |
| `AZURE_DEVOPS_PAT` | The same, from your machine. Needs the Test Management (Read) scope, and Release (Read) for `remoteLanes.releaseStage`. |
| `SYSTEM_TEAMFOUNDATIONCOLLECTIONURI`, `SYSTEM_COLLECTIONURI` | Organization for history, the build link and the Tests tab link. The first one wins when both are set. |
| `SYSTEM_TEAMPROJECT` | Project for history, the build link and the Tests tab link. |
| `BUILD_BUILDNUMBER`, `BUILD_BUILDID` | Build label and link in the header. The current build is left out of history. Without a release, the build number is the run that `remoteLanes` matches lanes by. |
| `SYSTEM_JOBPOSITIONINPHASE`, `SYSTEM_TOTALJOBSINPHASE` | The job slot in the run JSON's `<id>` when the job runs in parallel. |
| `BUILD_SOURCEBRANCH`, `BUILD_SOURCEVERSION` | Branch and commit. History prefers runs of the same branch. |
| `BUILD_REPOSITORY_URI` | Commit link. |
| `BUILD_DEFINITIONID`, `RELEASE_DEFINITIONID` | Limits history to runs of the same pipeline. |
| `RELEASE_RELEASENAME`, `RELEASE_RELEASEWEBURL` | Release label and link for classic release pipelines. The release name is the run that `remoteLanes` matches lanes by. |
| `RELEASE_RELEASEID` | Leaves the current release out of history. It is also the release whose stage `remoteLanes.releaseStage` links to. |
| `NEO_TEST_RUN_NAME` | Pins history to one test run title. |
| `TF_BUILD` | When set, the Markdown summary is attached to the pipeline run, and flaky tests are logged as warnings when `flakyWarnings` is on. |
| `GITHUB_ACTIONS` | Turns on GitHub Actions detection, and flaky-test warnings when `flakyWarnings` is on. |
| `GITHUB_HEAD_REF`, `GITHUB_REF_NAME` | Branch. The head ref comes first, so pull requests show their own branch. |
| `GITHUB_EVENT_PATH`, `GITHUB_SHA` | Commit. On pull requests, the head commit from the event payload. |
| `GITHUB_SERVER_URL`, `GITHUB_REPOSITORY`, `GITHUB_RUN_ID`, `GITHUB_RUN_NUMBER` | Commit and run links, run number label (`#<run number>`). The label is the run that `remoteLanes` matches lanes by. |
| `GITHUB_STEP_SUMMARY` | When set, the Markdown summary is added to the job summary, by the plugin and by `merge`. |
| `GITLAB_CI` | Turns on GitLab CI detection. |
| `CI_MERGE_REQUEST_SOURCE_BRANCH_NAME`, `CI_COMMIT_REF_NAME` | Branch. The merge request's source branch comes first. |
| `CI_COMMIT_SHA`, `CI_PROJECT_URL` | Commit and commit link. |
| `CI_PIPELINE_ID`, `CI_PIPELINE_URL` | Pipeline label (`#<pipeline id>`) and link. The label is the run that `remoteLanes` matches lanes by. |
| `CI_NODE_INDEX` | The job slot in the run JSON's `<id>` for `parallel:` jobs. |
| `NEO_SLACK_WEBHOOK`, `NEO_TEAMS_WEBHOOK` | Webhooks for `notify` and `merge` when `--slack` or `--teams` is not given. |
| `NEO_BLOB_SAS` | The SAS, with read and list permissions, for `remoteLanes` when `remoteLanes.sas` is not set, and for `neo-reporter merge --azure-blob`. |
| `CYPRESS_BASE_URL` | The target URL in the header when the run config has no `baseUrl`. |

CI agents set the build variables themselves. You set the tokens, the webhooks, `NEO_BLOB_SAS` and `NEO_TEST_RUN_NAME`. GitHub Actions is checked first, then GitLab CI, then Azure Pipelines. Outside those three, branch and commit are read from git.

## Spec owners

The report shows an owner for each spec: the person with the most commits to it. That needs the full git history, and CI checkouts are often shallow. To set owners yourself, add a `spec-owners.json` at the project root:

```json
{
  "cypress/e2e/checkout/payment.cy.ts": "Ana Ruiz",
  "cypress/e2e/orders/reorder.cy.ts": "Sam Lee"
}
```

`npx neo-reporter owners` writes this file from the git history. Run it where the full history is, then commit the file, or copy it to the root of the project Cypress runs from, such as a compiled copy. The keys are paths relative to the working directory, so run it from the folder whose layout matches the spec paths in the report:

```bash
npx neo-reporter owners
npx neo-reporter owners "cypress/e2e/*.cy.ts" --out dist/spec-owners.json
```

When Cypress runs a compiled spec, such as `cypress/e2e/cart.cy.js` in `dist`, and the file lists only its TypeScript source, such as `cypress/e2e/cart.cy.ts` (or `.tsx`, `.mts`, `.cts`), the owner comes from the source, and a [flaky-test warning](#plugin-options) links the source file.

See [owners](#owners) for the flags.

## CLI

```text
neo-reporter <command> [options]
```

| Command | What it does |
| --- | --- |
| `merge [dir]` | Merges the JSON reports found under `dir`, or the lane summaries in an Azure Blob Storage folder, into one report. |
| `gate <report.json>` | Exits 1 when a report fails the quality gate. |
| `notify <report.json>` | Posts a short run summary to Slack or Microsoft Teams. |
| `owners [pathspec...]` | Writes `spec-owners.json` from the git history. |

`-h`, `--help` lists the commands and `-v`, `--version` prints the version. `neo-reporter <command> --help` lists the flags of one command. The command comes first: `neo-reporter --name x merge` is a usage error.

### merge

```text
neo-reporter merge [dir] [options]
```

Merges the JSON reports found under `dir` (default `cypress/reports`, searched recursively) into one report. Merged reports already in `dir` are skipped.

With `--azure-blob`, it merges the lane summaries in an Azure Blob Storage folder instead, as [remote lanes](#remote-lanes) do, with the SAS from `NEO_BLOB_SAS`. The report is named `All lanes` and written to `cypress/reports` unless you pass `--name` and `--out`. It is attached to the run like any merged report. Without `--run`, every lane summary in the folder counts.

| Flag | What it does |
| --- | --- |
| `--azure-blob <url>` | Merge the lane summaries in this Azure Blob Storage folder instead of `dir`, such as `https://<account>.blob.core.windows.net/<container>/<path>/`. |
| `--run <name>` | With `--azure-blob`, only lanes whose CI release name, else build label, is `name`. The build label is `#<run number>` on GitHub Actions and `#<pipeline id>` on GitLab CI. |
| `--out <dir>` | Where to write the merged report. Default: `dir`, or `cypress/reports` with `--azure-blob`. |
| `--name <name>` | Report name, also used for file names unless `--file-name` is given. Default with `--azure-blob`: `All lanes`. |
| `--file-name <name>` | Base of the file names. Default: the report name. |
| `--project <name>` | Project name shown in the header. |
| `--team <name>` | Team name shown in the header. |
| `--hide-team` | Leave the team name out. |
| `--time-zone <zone>` | IANA time zone for every time in the report. |
| `--theme <theme>` | `auto`, `light` or `dark`. |
| `--outputs <list>` | Comma-separated: `html,markdown,junit,json,summary`. Default: `html,markdown`. |
| `--report-url <url>` | Link the Markdown summary and the chat message point to. Default on GitHub Actions: the run page. |
| `--keep-query` | Keep query strings and fragments in request URLs and the target URL. Parameters whose name ends like a secret, such as `refresh_token` or `X-Amz-Signature`, stay masked, see [Redaction](#redaction). |
| `--history-file <path>` | Read run history from this JSONL file and add the merged run to it. |
| `--baseline <file>` | Compare with one earlier report JSON instead of run history. It never writes the history file, and a baseline inside `dir` is not merged. |
| `--no-history` | Skip run history. |
| `--fail-on`, `--min-pass-rate`, `--quarantine` | Gate the merged run after writing its outputs, as [gate](#gate) does. |
| `--slack`, `--teams` | Post the merged run, as [notify](#notify) does. A failed post only warns. |

The merged report does not write JUnit by default, so a CI test tab that already reads each machine's JUnit file does not count every test twice. Merge counts every run it finds. It warns when the same spec, browser and testing type appear in more than one file, and for each file whose `schemaVersion` is missing or different, such as JSON written by 1.x. It skips, with a warning, files with unexpected field values.

A merged report's `timestamp` is the newest merged run's, not the time of the merge. Merging the same runs again with `--history-file` replaces their history line instead of adding a second one.

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
| `--report-url <url>` | Link the message points to. Default on GitHub Actions: the run page. |

The message has the status and title, the failed, flaky and passed counts with pass rate and duration, new, known and fixed failures when the report has history, branch, commit and build, and the top 5 failure groups. It is built from the report data, which is already redacted. Keep webhooks in secrets, never in config. The URL is never printed. A post times out after 15 seconds.

`merge` posts too when `--slack`, `--teams` or the variables are set. Post once per pipeline, after the merge: not from each machine, and not from both `merge` and `notify`.

### owners

```text
neo-reporter owners [pathspec...] [options]
```

Writes the person with the most commits to each tracked file that matches a pathspec, sorted by path, as [spec-owners.json](#spec-owners). Pathspecs follow git's rules, where `*` also matches `/`, so the default `*.cy.*` matches spec files at any depth. Quote them so the shell does not expand them. Paths are relative to the working directory, so run it from the project root. Merge commits do not count.

| Flag | What it does |
| --- | --- |
| `--out <file>` | Where to write. Default: `spec-owners.json` in the working directory. |

It needs the full git history. A folder outside git, a shallow checkout, a pathspec that matches no tracked file, or files without authors exit 1.

### Exit codes

| Code | `merge` | `gate` | `notify` | `owners` |
| --- | --- | --- | --- | --- |
| `0` | Merged, and the gate passed when one was asked for | The gate passed | Every post went through | Written |
| `1` | Nothing to merge, the gate failed, no SAS for `--azure-blob`, a folder that cannot be listed, or an error | The gate failed, or the report cannot be checked | A post failed, or the report cannot be read | No git history, a shallow checkout, no matching spec, or no authors |
| `2` | Usage error | Usage error | Usage error | Usage error |

A usage error is a missing or unknown command, an unknown flag, a missing value, an extra argument, a bad `--theme`, `--outputs`, `--fail-on` or `--min-pass-rate` value (an empty or blank `--min-pass-rate` included), an unknown `--time-zone`, `gate` without `--fail-on` or `--min-pass-rate`, `--quarantine` alone, `notify` without a webhook, `--run` without `--azure-blob`, a `dir` together with `--azure-blob`, or an `--azure-blob` that is not an `https://` folder URL without a query string. That message never repeats the URL. The message and the usage go to stderr. `--help` and `--version` exit 0.

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
| `createNeoReporter` | `(config, options?: NeoReporterOptions) => { beforeRun, tasks, afterSpec, afterRun }` | The same handlers, to call from your own events. Pass the `before:run` details to `beforeRun(details)` so it can warn when the config is not returned. See [Known limitations](../README.md#known-limitations). |
| `generateReports` | `(runResults, options?: NeoReporterOptions) => Promise<ReportFiles>` | Writes the outputs for a `cypress run` result. |
| `mergeReports` | `(options?: MergeOptions) => Promise<MergeResult \| null>` | Merges JSON reports. Returns `{ summary, files }`, or `null` when there was nothing to merge. |
| `generateHtmlReport` | `(summary: ReportSummary) => string` | Renders the HTML report from the report JSON. |
| `generateMarkdownSummary` | `(summary: ReportSummary, reportUrl?: string) => string` | Renders the Markdown summary. |
| `generateJUnitXml` | `(summary: ReportSummary) => string` | Renders the JUnit XML. |

Types: `ReportSummary`, `SpecData`, `TestData`, `NeoReporterOptions`, `MergeOptions`, `RemoteLanesOptions`, `HistoryOptions`, `ReportOutput`, `ReportTheme`, `ReportFiles` and `MergeResult`. The nested report types `RunHistory`, `HistoryRun`, `LaneSummary`, `CiInfo`, `TestStep`, `TestAttempt`, `EmbeddedFile` and `NetworkFailure`, and `RecordedTestPayload` (the record task's argument), are exported too, so declarations that infer them compile. They reference Cypress's global types, so they need `cypress` installed (it is a peer dependency), but no `types` entry in `tsconfig.json`.

`cypress-neo-reporter/plugin` exports `neoReporter`, `createNeoReporter`, `generateReports`, `mergeReports` and the types `NeoReporterOptions`, `MergeOptions`, `RemoteLanesOptions`, `HistoryOptions`, `ReportOutput`, `ReportTheme` and `ReportFiles`. `cypress-neo-reporter/support` is imported for its side effects and exports the `StepPhase` type.

`generateReports` writes what the plugin writes at the end of a run. Steps recorded by the support file are kept in the memory of the plugin's process, so call it from an `after:run` handler in that process. Called from a separate script, the report has no steps.

`ReportFiles` holds the path of each file written: `{ html?, json?, junit?, markdown?, summary? }`.

`mergeReports` takes the plugin options plus these. The gate and the chat post are CLI only.

| Option | Default | CLI |
| --- | --- | --- |
| `reportRoot` | `'cypress/reports'` | `[dir]`. Searched recursively, relative to the working directory. |
| `summaryFiles` | none | none. Merges these JSON files instead of searching `reportRoot`. |
| `outputDir` | `reportRoot` | `--out` |
| `summaryDir` | `outputDir` | none. Relative to the working directory. |
| `remoteLanes` | none | `--azure-blob <url>` sets `azureBlob`, `--run <name>` sets `run`. Merges the lane summaries in that folder instead of `reportRoot`, so leave out `reportRoot` and `summaryFiles`. `outputDir` then defaults to `'cypress/reports'`, `reportName` to `remoteLanes.reportName`, else `'All lanes'`, and `fileName` and `projectName` to those of `remoteLanes`. See [Remote lanes](#remote-lanes). |
| `baseline` | none | `--baseline` |
| `reportName`, `projectName`, `teamName` | the first report's | `--name`, `--project`, `--team` |
| `fileName` | the first report's, when `reportName` is not given | `--file-name` |
| `showTeamName` | `true` | `--hide-team` sets `false`. |
| `timeZone`, `theme` | the first report's | `--time-zone`, `--theme` |
| `css` | the first report's | none |
| `outputs` | `['html', 'markdown']` | `--outputs` |
| `reportUrl` | none (the run page on GitHub Actions) | `--report-url` |
| `history` | Azure DevOps, when a token is set | `--history-file <path>` sets `{ provider: 'file', path }`, `--no-history` sets `false`. |
| `redact` | as for the plugin | `--keep-query` sets `{ keepQuery: true }`. |
| `includeTestCode`, `maxEmbedMb`, `assets` | as for the plugin | none |

## JSON report

The `json` output is the stable contract for your own dashboards. A run writes `<name>.<id>.json`, where the id comes from the browser name (not its version), base URL and viewport, plus the parallel job slot on Azure Pipelines (`System.JobPositionInPhase`) or GitLab (`CI_NODE_INDEX`), or else the spec files. A merged report writes `<name>.json`.

| Field | What it holds |
| --- | --- |
| `schemaVersion` | Version of the JSON shape, `1` since 2.0.0. |
| `reporterVersion` | Version of `cypress-neo-reporter` that wrote the file. |
| `projectName`, `suiteLabel`, `teamName` | Names shown in the header. |
| `fileName` | The `fileName` option, when it was set: the base of the file names. |
| `timestamp` | When the report was built, ISO 8601. A merged report has the newest merged run's. |
| `browser` | Browser and version. A merged report lists every browser, comma-separated. |
| `environment` | The target URL (`baseUrl`). A merged report with `lanes` lists the target of every lane, comma-separated. |
| `resolution` | The viewport. |
| `totalSpecs`, `totalTests`, `totalPassed`, `totalFailed`, `totalPending`, `totalSkipped`, `totalDurationMs` | Run totals. `totalPassed` includes flaky tests. |
| `passRate` | Passed over all tests, in percent, rounded down. |
| `specs[]` | One entry per spec: `specFile`, `specName`, `owner`, `browser`, `testingType` (`e2e` or `component`), `duration`, `passes`, `failures`, `pending`, `skipped`, `total`, `video` and `tests[]`. |
| `specs[].tests[]` | `title` (the title path as an array), `fullTitle` (joined with ` › `), `state` (`passed`, `flaky`, `failed`, `pending` or `skipped`), `duration`, `startedAt`, `displayError`, `attempts`, `steps`, `businessGoal`, `code`, `screenshots`, `video`, `network`, `consoleErrors` and `tags`. |
| `ci` | `branch`, `commit`, `build` and `release`, with links. |
| `history` | The history the report compared with: `family`, `source`, `runs`, `tests` (for each `<spec file> › <full title>`, as in `quarantine.json` and the gate output, a code per earlier run, oldest first: `P`, `F`, `S`, or `-` when it did not run) and `durations` (median passing duration in milliseconds, same keys). |
| `timeZone`, `theme`, `css` | Display settings. |
| `mergedFrom` | How many runs were merged. Only on merged reports. |
| `lanes` | One row per report name when a merge combined more than one, and on every lanes report built from Azure Blob Storage: `label`, `file` (the lane's HTML file name), `failed`, `flaky`, `passed` (without flaky), `total`, `passRate` and `durationMs`, lanes with failures first. Only on merged reports. |

The `summary` output writes the same shape to `<name>.<id>.summary.json` in `summaryDir`, without `screenshots` and `video`, and without `steps` and `code` for passed tests. `neo-reporter merge` reads it, and skips it when the full `<name>.<id>.json` sits next to it.

With `assets: 'inline'`, embedded screenshots and clips carry their content in `base64` as data URLs. With `assets: 'folder'`, `path` is relative to the report.
