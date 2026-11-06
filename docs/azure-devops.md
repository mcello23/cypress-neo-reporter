# Azure DevOps

On Azure Pipelines the reporter reads the build from the agent, compares every test with your last 10 runs and puts a summary on the pipeline page. YAML and classic release pipelines both work.

- **Build links.** Build number, branch and commit in the report header, each linked back to Azure DevOps.
- **Failure history.** Each failure is marked new, failing for N runs, or fixed, read from past test runs.
- **Pipeline summary.** Failure groups and flaky tests on the run's summary tab, with a link to the full report.

## 1. Give the job a token

History reads past test runs through the Azure DevOps REST API. Map the pipeline's own token into the Cypress step.

To run it on your machine, set `AZURE_DEVOPS_PAT` to a personal access token with the Test Management (Read) scope, and set `history.organization` and `history.project` in the options.

Without a token the report is still written, without history and without the new or known labels.

## 2. Update the pipeline

Publish the JUnit file for the Tests tab and keep the report folder as an artifact. The summary is attached to the run by itself when the reporter detects an Azure Pipelines agent.

```yaml
steps:
  - script: npx cypress run
    displayName: Run Cypress
    env:
      SYSTEM_ACCESSTOKEN: $(System.AccessToken)

  - task: PublishTestResults@2
    condition: always()
    inputs:
      testResultsFormat: JUnit
      testResultsFiles: cypress/reports/*.junit.xml
      testRunTitle: E2E regression

  - publish: cypress/reports
    artifact: e2e-report
    condition: always()
```

Keep `testRunTitle` the same from run to run. History finds earlier runs by that title.

## How history finds earlier runs

1. It lists the automated test runs of the last two weeks, from the same pipeline when the agent says which one, and from the same branch when there are any.
2. It picks the run title whose tests overlap most with this run. Set `history.runName` or `NEO_TEST_RUN_NAME` to skip the guess.
3. It reads the results of the last `history.runs` runs with that title, up to `history.maxWeeks` back. Runs of the current build or release are left out.

When the branch has no earlier runs, for example a new feature branch, history falls back to runs from every branch.

## What the summary looks like

The summary is Markdown, so the same file works as a pull request comment.

```markdown
### ❌ acme-storefront - E2E regression

**7 failed · 1 flaky · 65 passed** of 74 tests (89% pass rate) · 5m 0s

Branch: main · Commit: 4f2c9e1a · Build: 20261106.3 · Target: https://staging.acme.test · Web QA team

History vs the last 10 runs of "E2E regression": **6 new failures** · 1 known · 0 fixed
```

Followed by a table of failure groups and one of flaky tests.

## Options

```ts
neoReporter(on, config, {
  projectName: 'acme-storefront',
  history: {
    organization: 'https://dev.azure.com/your-org',
    project: 'your-project',
    runs: 10,
    maxWeeks: 8,
  },
  reportUrl: process.env.NEO_REPORT_URL,
});
```

`reportUrl` is the link the summary points to, such as your published pipeline artifact. Leave it out and the summary has no link.

The environment variables the reporter reads are listed in [options.md](options.md#environment-variables).
