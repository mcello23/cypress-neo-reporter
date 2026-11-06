# Options

## Plugin options

Pass these as the third argument of `neoReporter(on, config, options)`. Every option is optional.

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `projectName` | `string` | `name` in the project's `package.json` | Shown in the header and the page title. |
| `reportName` | `string` | none | Suite label next to the project name. Also used for file names. |
| `teamName` | `string` | none | Your team's name, shown in the header and the page title. |
| `showTeamName` | `boolean` | `true` | `false` hides the team name without removing it from your config. |
| `timeZone` | `string` | the machine's zone | IANA time zone for every time in the report. An unknown name stops the run with an error. |
| `theme` | `'auto' \| 'light' \| 'dark'` | `'auto'` | The theme the report opens in. `'auto'` follows the reader's system. Readers can switch it, and their choice is remembered in the browser. |
| `outputDir` | `string` | `'cypress/reports'` | Where the files are written, relative to the project root. |
| `outputs` | `Array<'html' \| 'json' \| 'junit' \| 'markdown'>` | all four | The files to write. |
| `history` | `HistoryOptions \| false` | on when a token is available | Azure DevOps run history. `false` turns it off. |
| `reportUrl` | `string` | none | Link the Markdown summary points to. |

## History options

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `history.provider` | `'azure-devops'` | `'azure-devops'` | The only provider today. |
| `history.organization` | `string` | `SYSTEM_COLLECTIONURI` | Organization URL such as `https://dev.azure.com/your-org`, or just `your-org`. |
| `history.project` | `string` | `SYSTEM_TEAMPROJECT` | Azure DevOps project name. |
| `history.runName` | `string` | `NEO_TEST_RUN_NAME`, else matched by test names | Pins history to one test run title. |
| `history.runs` | `number` | `10` | How many previous runs to compare with. |
| `history.maxWeeks` | `number` | `8` | How far back to look for those runs. |

There is no built-in organization. In a pipeline both values come from the agent. On your machine, set them here.

## Environment variables

| Variable | Used for |
| --- | --- |
| `SYSTEM_ACCESSTOKEN` | Reading past test runs in a pipeline. |
| `AZURE_DEVOPS_PAT` | The same, from your machine. Needs the Test Management (Read) scope. |
| `SYSTEM_COLLECTIONURI`, `SYSTEM_TEAMPROJECT` | Organization and project to query. |
| `BUILD_BUILDNUMBER`, `BUILD_BUILDID` | Build label and link in the header. |
| `BUILD_SOURCEBRANCH`, `BUILD_SOURCEVERSION` | Branch and commit. History prefers runs of the same branch. |
| `BUILD_DEFINITIONID`, `RELEASE_DEFINITIONID` | Limits history to runs of the same pipeline. |
| `RELEASE_RELEASENAME`, `RELEASE_RELEASEWEBURL` | Release label and link for classic release pipelines. |
| `NEO_TEST_RUN_NAME` | Pins history to one test run title. |
| `TF_BUILD` | When set, the Markdown summary is attached to the pipeline run. |

Outside Azure Pipelines, branch and commit are read from git.

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
neo-reporter merge [dir] [options]
```

Merges the JSON reports found under `dir` (default `cypress/reports`, searched recursively) into one report.

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
| `--report-url <url>` | Link the Markdown summary points to. |
| `--no-history` | Skip Azure DevOps run history. |

The merged report does not write JUnit by default, so a CI test tab that already reads each shard's JUnit file does not count every test twice.

## Programmatic API

```ts
import { generateHtmlReport, generateMarkdownSummary, generateJUnitXml, mergeReports } from 'cypress-neo-reporter';
```

`generateHtmlReport`, `generateMarkdownSummary` and `generateJUnitXml` take the report JSON (`ReportSummary`) and return a string. `mergeReports` takes the same options as the CLI.
