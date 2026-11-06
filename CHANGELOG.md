# Changelog

## Unreleased

## 2.0.0

### Breaking changes

- `setupNodeEvents` must return the config, and `neoReporter` now returns it: `return neoReporter(on, config, options)`. Without the returned config the support file records nothing and logs "Steps are not recorded". The run log also warns at the start of the run when the config was not returned.
- The package root exports only `neoReporter`, `createNeoReporter`, `mergeReports`, `generateReports`, `generateHtmlReport`, `generateMarkdownSummary`, `generateJUnitXml` and the types `ReportSummary`, `SpecData`, `TestData`, `NeoReporterOptions`, `MergeOptions`, `HistoryOptions`, `ReportOutput`, `ReportTheme`, `ReportFiles`, `MergeResult`, `RunHistory`, `HistoryRun`, `CiInfo`, `TestStep`, `TestAttempt`, `EmbeddedFile`, `NetworkFailure` and `RecordedTestPayload`. Removed: `STEPS_FILE_NAME`, `SPEC_OWNERS_FILE_NAME`, `DEFAULT_REPORTS_DIR`, `REPORT_OUTPUTS`, `MERGE_OUTPUTS`, `ReporterOptions`, `HistoryLoader`, `machineTimeZone`, `assertTimeZone`, `readSpecOwners`, `createHistoryLoader`, `attachRunHistory`, `buildReportSummary` and `reportFileBase`.
- `generateReports` takes `NeoReporterOptions`. `stepsFilePath` and `historyLoader` are gone.
- The `cypress` peer range is `^15.0.0 || ^16.0.0` instead of `>=15`.
- A run's JSON is named `<name>.<id>.json` instead of `<name>.json`. A merged JSON keeps `<name>.json`.
- `history.tests` and `history.durations` in the JSON are keyed by `<specFile> › <full title>` instead of the full title.
- The support file no longer writes `neo-reporter-steps.json`. Recorded steps stay in the memory of the plugin's process, so `generateReports` called from another process has no steps.
- Invalid options stop the run with an error: `outputs`, `theme`, `assets`, `history.provider`, `maxEmbedMb`, `history.runs`, `history.maxWeeks`, `timeZone` and `redact`. Unknown option names print a warning. `generateReports` checks its options too. `reportRoot`, `summaryFiles` and `baseline` are merge-only and print the unknown-option warning in the plugin and `generateReports`.
- CLI: the command must come first, extra arguments are rejected, and usage errors go to stderr with exit code 2 instead of 1.
- Screenshots are attached to a test only when their file name is the name Cypress gives that test by default: its full title, or a hook's name for it, cleaned up and cut the way Cypress does. A failure screenshot only goes to a failed or flaky test.
- Screenshots of passing tests are no longer embedded. `maxEmbedMb` (150 by default) caps screenshots and clips together and replaces the fixed 150 MB video cap.
- Redaction is on by default. Secrets are masked, and failed-request URLs and the target URL lose their query string and fragment. `redact: false` turns it off.

### Fixes

- Steps, errors, test code, timings and screenshots no longer attach to the wrong test when titles repeat across specs or one title starts with another.
- Azure DevOps history matches runs published from this reporter's own JUnit file, and runs with more than 1000 results are read in full.
- JUnit XML no longer contains characters that XML 1.0 forbids, such as ANSI escapes and NUL. ANSI codes are stripped from errors, steps and console errors.
- A reporter error logs a warning instead of failing the Cypress run, and each output file is written on its own, so one failure does not lose the others. A run that writes no file says so.
- The support file without the plugin no longer fails tests or skips the rest of the suite.
- The support file no longer injects a style, a data attribute or an <kbd>Alt</kbd>+<kbd>S</kbd> handler into the app under test.
- Without ffprobe (Cypress below 15.16) the failing spec's full video is kept instead of mistimed clips. One failed clip no longer discards the others, long titles, including emoji and other multi-byte characters, get short clip names, and ffmpeg calls time out after 5 minutes.
- Failure screenshots are attached for titles ending in a dot or space and for long titles that Cypress cuts short.
- Report buttons work for spec and owner names with apostrophes.
- The published type declarations compile with `skipLibCheck: false` without adding `cypress` to `tsconfig.json` types.

### Features

- `createNeoReporter(config, options)` returns the plugin's handlers to call from your own events, and the run warns when another plugin replaced its `before:run` handler.
- `keepVideos` leaves Cypress's videos in place.
- File history: `history: { provider: 'file', path }`, `neo-reporter merge --history-file` and `--baseline <report.json>`.
- A Slower than usual panel from history durations. Most unstable ranks tests by pass/fail flips, and the history panel names its source.
- GitHub Actions: branch, pull request head commit, run number and links in the header, the Markdown summary in the job summary, and `reportUrl` defaults to the run page. Slack and Teams messages link the run page when no `--report-url` is given.
- GitLab CI: branch, commit, pipeline and links in the header.
- `neo-reporter gate` with `--fail-on new|failed`, `--min-pass-rate` and a `quarantine.json` list. `merge` takes the same flags.
- `neo-reporter notify` posts to Slack or Microsoft Teams, with `--slack`, `--teams`, `NEO_SLACK_WEBHOOK` and `NEO_TEAMS_WEBHOOK`. `merge` takes the same flags.
- `@tags` in titles: a Tags panel, a `tag:` search and JUnit properties.
- `maxEmbedMb` and `assets: 'folder'` to control the report size.
- Browser and testing type per spec. Merged reports list every browser and mark specs and failure groups when they differ. Merge warns when the same spec, browser and testing type appear twice, and its output no longer depends on file order.
- The JSON report carries `schemaVersion` (1) and `reporterVersion`, and merge warns about files with another schema version.
- CLI: `--version` and a top-level `--help`.
- Each written file is logged with its size.
- Guides for [GitHub Actions](docs/github-actions.md) and [GitLab CI](docs/gitlab-ci.md).

### Security

- Spec and owner names no longer go into inline JavaScript, which closes script injection through git author names. Embedded media and history codes are escaped.
- The report carries a Content-Security-Policy that blocks network requests.
- The Markdown summary escapes test titles and errors.
- AI prompts fence the captured run data and tell the assistant to treat it as data.
- `redact` and `includeTestCode` options. Authorization and cookie headers (every Set-Cookie value), bearer tokens, JWTs, URL passwords, values of JSON keys such as `password`, `secret`, `token` and `api_key`, and the URL parameters `token`, `access_token`, `sig`, `code`, `key` and `password` are masked in every output, and merge cleans JSON written by 1.x.
- Merge skips JSON files with unexpected field values, and ignores screenshot and video paths in a JSON file that point outside that file's folder.
- Teams shows failure messages as plain text, so test output cannot add Markdown links.
- The Azure DevOps token goes only to the configured organization, with a warning when that URL is `http://`, whether it comes from `history.organization` or from the pipeline's collection URL.
- plyr 3.8.5 is vendored with its license, so the package has no runtime dependencies and the player in a report changes only with a reporter release.
- Releases are published from GitHub Actions with npm trusted publishing and provenance.

### Upgrading from 1.x

1. Use Cypress 15 or 16.
2. Return the config: `setupNodeEvents: (on, config) => neoReporter(on, config, options)`.
3. Point scripts that read a run's JSON at `<name>.<id>.json`, for example with a glob. `--baseline` takes either file. Dashboards that read `history.tests` or `history.durations` must look tests up by `<specFile> › <full title>`.
4. Replace imports of removed internals with the public API.
5. Check CI steps that call `neo-reporter`: put the command first, and expect exit code 2 for usage errors.
6. Fix any option the run now rejects.
7. If you need query strings in failed-request URLs, set `redact: false`.
8. If another plugin uses `before:run`, `after:spec` or `after:run`, call the `createNeoReporter` handlers from your own events. See [Known limitations](README.md#known-limitations).

## 1.0.0

First public release.

- One-file HTML report with failure groups, run history, steps, screenshots, video clips of failed tests, failed requests and console errors.
- AI triage prompts for the whole run and for each failed or flaky test.
- JUnit XML, JSON and Markdown summary outputs.
- Azure DevOps integration: build links, failure history from past test runs and a summary on the pipeline page.
- `teamName` and `showTeamName` options.
- `timeZone` option for every time in the report.
- Light, dark and automatic themes.
- `neo-reporter merge` command for parallel runs.
