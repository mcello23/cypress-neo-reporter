import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeReports } from '../src';
import { readCiInfo } from '../src/ci';
import { writeMarkdownSummary } from '../src/markdown';
import { sampleSummary } from './fixtures/summary';

const HEAD_SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const MERGE_SHA = 'ffffffffffffffffffffffffffffffffffffffff';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'neo-reporter-'));
}

function useEnv(t: TestContext, vars: Record<string, string>): void {
  const env = { ...process.env };
  t.after(() => {
    process.env = env;
  });
  for (const key of Object.keys(process.env)) {
    if (/^(GITHUB_|GITLAB_|CI_|BUILD_|SYSTEM_|RELEASE_|TF_BUILD$)/.test(key)) delete process.env[key];
  }
  Object.assign(process.env, vars);
}

function githubEnv(dir: string, event: unknown, vars: Record<string, string> = {}): Record<string, string> {
  const eventPath = join(dir, 'event.json');
  writeFileSync(eventPath, JSON.stringify(event));
  return {
    GITHUB_ACTIONS: 'true',
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_REPOSITORY: 'acme/storefront',
    GITHUB_RUN_ID: '9876543210',
    GITHUB_RUN_NUMBER: '42',
    GITHUB_SHA: MERGE_SHA,
    GITHUB_EVENT_PATH: eventPath,
    ...vars
  };
}

test('github pull request: head branch and head commit, linked to the run', t => {
  const dir = tempDir();
  useEnv(t, githubEnv(dir, { pull_request: { head: { sha: HEAD_SHA } } }, { GITHUB_HEAD_REF: 'feature/cart', GITHUB_REF_NAME: '12/merge' }));
  assert.deepEqual(readCiInfo(dir), {
    branch: 'feature/cart',
    commit: HEAD_SHA,
    commitUrl: `https://github.com/acme/storefront/commit/${HEAD_SHA}`,
    build: '#42',
    buildUrl: 'https://github.com/acme/storefront/actions/runs/9876543210'
  });
});

test('github push: ref name and GITHUB_SHA', t => {
  const dir = tempDir();
  useEnv(t, githubEnv(dir, { ref: 'refs/heads/main' }, { GITHUB_HEAD_REF: '', GITHUB_REF_NAME: 'main' }));
  const ci = readCiInfo(dir);
  assert.equal(ci.branch, 'main');
  assert.equal(ci.commit, MERGE_SHA);
  assert.equal(ci.commitUrl, `https://github.com/acme/storefront/commit/${MERGE_SHA}`);
});

test('gitlab merge request: source branch, commit and pipeline links', t => {
  useEnv(t, {
    GITLAB_CI: 'true',
    CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: 'feature/cart',
    CI_COMMIT_REF_NAME: 'refs/merge-requests/7/head',
    CI_COMMIT_SHA: HEAD_SHA,
    CI_PROJECT_URL: 'https://gitlab.com/acme/storefront',
    CI_PIPELINE_ID: '1234567',
    CI_PIPELINE_URL: 'https://gitlab.com/acme/storefront/-/pipelines/1234567'
  });
  assert.deepEqual(readCiInfo(tempDir()), {
    branch: 'feature/cart',
    commit: HEAD_SHA,
    commitUrl: `https://gitlab.com/acme/storefront/-/commit/${HEAD_SHA}`,
    build: '#1234567',
    buildUrl: 'https://gitlab.com/acme/storefront/-/pipelines/1234567'
  });
});

test('gitlab branch pipeline: ref name', t => {
  useEnv(t, { GITLAB_CI: 'true', CI_COMMIT_REF_NAME: 'main', CI_COMMIT_SHA: HEAD_SHA });
  assert.equal(readCiInfo(tempDir()).branch, 'main');
});

test('azure devops: build variables as before', t => {
  useEnv(t, {
    TF_BUILD: 'True',
    BUILD_SOURCEVERSION: HEAD_SHA,
    BUILD_SOURCEBRANCH: 'refs/heads/main',
    BUILD_REPOSITORY_URI: 'https://dev.azure.com/your-org/your-project/_git/storefront',
    BUILD_BUILDNUMBER: '20261106.3',
    BUILD_BUILDID: '4211',
    SYSTEM_COLLECTIONURI: 'https://dev.azure.com/your-org',
    SYSTEM_TEAMPROJECT: 'your project'
  });
  assert.deepEqual(readCiInfo(tempDir()), {
    branch: 'main',
    commit: HEAD_SHA,
    commitUrl: `https://dev.azure.com/your-org/your-project/_git/storefront/commit/${HEAD_SHA}`,
    build: '20261106.3',
    buildUrl: 'https://dev.azure.com/your-org/your%20project/_build/results?buildId=4211',
    release: undefined,
    releaseUrl: undefined
  });
});

test('plain git checkout: branch and commit from git, no links', t => {
  useEnv(t, {});
  const dir = tempDir();
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=Neo', '-c', 'user.email=neo@example.com', '-c', 'commit.gpgsign=false', ...args], {
      cwd: dir,
      encoding: 'utf-8'
    }).trim();
  git('init', '-q', '-b', 'feature/cart');
  git('commit', '-q', '--allow-empty', '-m', 'init');
  const ci = readCiInfo(dir);
  assert.equal(ci.branch, 'feature/cart');
  assert.equal(ci.commit, git('rev-parse', 'HEAD'));
  assert.equal(ci.commitUrl, undefined);
  assert.equal(ci.buildUrl, undefined);
});

test('github: the plugin and merge append their summary to the job summary and link the run by default', async t => {
  const dir = tempDir();
  const stepSummary = join(dir, 'step-summary.md');
  writeFileSync(stepSummary, 'Earlier step\n');
  useEnv(t, { ...githubEnv(dir, {}, { GITHUB_REF_NAME: 'main' }), GITHUB_STEP_SUMMARY: stepSummary });
  t.mock.method(console, 'log', () => undefined);
  const summary = { ...sampleSummary(), ci: readCiInfo(dir) };

  writeMarkdownSummary(join(dir, 'shard.summary.md'), summary);
  const written = readFileSync(join(dir, 'shard.summary.md'), 'utf-8');
  assert.match(written, /\[📄 Open the full HTML report\]\(https:\/\/github.com\/acme\/storefront\/actions\/runs\/9876543210\)/);
  assert.equal(readFileSync(stepSummary, 'utf-8'), `Earlier step\n${written}`);

  writeMarkdownSummary(join(dir, 'custom.summary.md'), summary, 'https://example.com/report.html');
  assert.match(readFileSync(join(dir, 'custom.summary.md'), 'utf-8'), /\(https:\/\/example.com\/report.html\)/);

  const root = join(dir, 'reports');
  mkdirSync(join(root, 'shard-1'), { recursive: true });
  writeFileSync(join(root, 'shard-1', 'E2E-regression.json'), JSON.stringify(summary));
  const before = readFileSync(stepSummary, 'utf-8');
  const merged = await mergeReports({ reportRoot: root, history: false });
  assert.ok(merged?.files.markdown);
  const mergedMarkdown = readFileSync(merged.files.markdown, 'utf-8');
  assert.match(mergedMarkdown, /actions\/runs\/9876543210\)/);
  assert.equal(readFileSync(stepSummary, 'utf-8'), before + mergedMarkdown);
});

test('outside github: no job summary and no default link', t => {
  const dir = tempDir();
  useEnv(t, {});
  writeMarkdownSummary(join(dir, 'local.summary.md'), sampleSummary());
  assert.doesNotMatch(readFileSync(join(dir, 'local.summary.md'), 'utf-8'), /Open the full HTML report/);
});
