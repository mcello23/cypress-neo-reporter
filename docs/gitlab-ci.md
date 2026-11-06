# GitLab CI

On GitLab CI the reporter reads the pipeline from the environment and links the report header back to GitLab. There is nothing to configure.

- **Build links.** Branch, commit and pipeline in the report header, with the commit and the pipeline linked to GitLab. In merge request pipelines the branch is the source branch.
- **Test results.** The JUnit file feeds the merge request test widget and the pipeline's Tests tab.
- **Summary.** GitLab has no job summary page, so `summary.md` stays in the artifacts. Set `reportUrl` or `--report-url` to give it a link to the report.

Failure history is read from Azure DevOps only for now.

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

Every shard writes the same file names, so each one moves its reports into its own folder before the artifacts are collected. The `e2e-report` job gets all of them through `needs` and merges them into one report.

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

The environment variables the reporter reads are listed in [options.md](options.md#environment-variables).
