# GitHub Actions

On GitHub Actions the reporter reads the run from the environment, links the report header back to GitHub and puts a summary on the run page. There is nothing to configure.

- **Build links.** Branch, commit and run number in the report header, with the commit and the run linked to GitHub. On pull requests these are the pull request's branch and head commit, not the merge commit GitHub checks out.
- **Job summary.** Failure groups and flaky tests on the run's summary page, added after whatever else the step wrote there. The plugin and `neo-reporter merge` both add one.
- **Report link.** The summary links to the run, where the report artifact is listed. Set `reportUrl` or `--report-url` to point it somewhere else.

Failure history is read from Azure DevOps only for now.

## One job

```yaml
name: E2E

on:
  push:
    branches: [main]
  pull_request:

jobs:
  cypress:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: cypress-io/github-action@v6
      - uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with:
          name: e2e-report
          path: cypress/reports
```

## Sharded runs

Each shard uploads its own folder. The `report` job downloads them, each into its own subfolder, and merges them into one report.

```yaml
jobs:
  cypress:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        area: [checkout, account, search]
    steps:
      - uses: actions/checkout@v4
      - uses: cypress-io/github-action@v6
        with:
          spec: cypress/e2e/${{ matrix.area }}/**/*.cy.ts
      - uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with:
          name: e2e-shard-${{ matrix.area }}
          path: cypress/reports

  report:
    needs: cypress
    if: ${{ !cancelled() }}
    runs-on: ubuntu-latest
    env:
      CYPRESS_INSTALL_BINARY: 0
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - uses: actions/download-artifact@v4
        with:
          pattern: e2e-shard-*
          path: shards
      - run: npx neo-reporter merge shards --out cypress/reports --name "E2E regression"
      - uses: actions/upload-artifact@v4
        with:
          name: e2e-report
          path: cypress/reports
```

Each shard also adds its own job summary. To keep only the merged one, leave `'markdown'` out of `outputs` on the shards.

## Pull request comment

Add this step after the one that writes the summary, in the single job or in `report`. It keeps one comment per pull request and updates it on every run. The file is named after `reportName`, or `--name` for a merge.

```yaml
- name: Comment on the pull request
  if: ${{ !cancelled() && github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository }}
  env:
    GH_TOKEN: ${{ github.token }}
    GH_REPO: ${{ github.repository }}
  run: gh pr comment ${{ github.event.pull_request.number }} --edit-last --create-if-none --body-file "cypress/reports/E2E-regression.summary.md"
```

The job needs permission to comment:

```yaml
permissions:
  contents: read
  pull-requests: write
```

`--edit-last` edits the last comment posted with a `GITHUB_TOKEN` on that pull request, so it works best when no other workflow comments there. Pull requests from forks get a read-only token, which is why the step skips them.

The environment variables the reporter reads are listed in [options.md](options.md#environment-variables).
