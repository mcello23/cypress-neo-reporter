# GitLab CI

On GitLab CI the reporter reads the pipeline from the environment and links the report header back to GitLab. There is nothing to configure.

- **Build links.** Branch, commit and pipeline in the report header, with the commit and the pipeline linked to GitLab. In merge request pipelines the branch is the source branch.
- **Test results.** The JUnit file feeds the merge request test widget and the pipeline's Tests tab.
- **Summary.** GitLab has no job summary page, so `summary.md` stays in the artifacts. Set `reportUrl` or `--report-url` to give it a link to the report.

Failure history comes from a history file that the pipeline keeps in the GitLab cache, see [Run history](#run-history).

## One job

```yaml
e2e:
  image: cypress/browsers:latest
  script:
    - npm ci
    - npx cypress run
  artifacts:
    when: always
    expose_as: E2E report
    paths:
      - cypress/reports/
    reports:
      junit: cypress/reports/*.junit.xml
```

`expose_as` puts a link to the report folder on the merge request.

## Sharded runs

Every shard writes the same HTML, JUnit and summary file names, so each one moves its reports into its own folder before the artifacts are collected. The `e2e-report` job gets all of them through `needs` and merges them into one report. With `parallel:`, the `<id>` in each job's run JSON name is built from `CI_NODE_INDEX` instead of the spec files, so a retried job keeps its file name.

```yaml
e2e:
  image: cypress/browsers:latest
  parallel:
    matrix:
      - AREA: [checkout, account, search]
  script:
    - npm ci
    - npx cypress run --spec "cypress/e2e/$AREA/**/*.cy.ts"
  after_script:
    - mkdir -p shards && mv cypress/reports "shards/$AREA"
  artifacts:
    when: always
    paths:
      - shards/
    reports:
      junit: shards/*/*.junit.xml

e2e-report:
  image: node:22
  needs: [e2e]
  when: always
  variables:
    CYPRESS_INSTALL_BINARY: "0"
  script:
    - npm ci
    - npx neo-reporter merge shards --out cypress/reports --name "E2E regression" --report-url "$CI_JOB_URL/artifacts/browse/cypress/reports/"
  artifacts:
    when: always
    expose_as: E2E report
    paths:
      - cypress/reports/
```

## Run history

Turn the file provider on in the Cypress config:

```ts
return neoReporter(on, config, { history: { provider: 'file' } });
```

Then cache the history file in the job that runs Cypress, also when tests fail:

```yaml
e2e:
  cache:
    key: neo-history-$CI_COMMIT_REF_SLUG
    fallback_keys:
      - neo-history-$CI_DEFAULT_BRANCH
    paths:
      - cypress/reports/neo-history.jsonl
    when: always
```

A run starts from the latest history of its own branch, else of the default branch. For sharded runs, leave the file provider off on the shards, put the cache on `e2e-report` and pass `--history-file cypress/reports/neo-history.jsonl` to `neo-reporter merge`.

To let the report decide whether the job fails, see [Quality gate](../README.md#quality-gate-and-notifications).

The environment variables the reporter reads are listed in [options.md](options.md#environment-variables).
