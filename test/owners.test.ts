import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { devNull, tmpdir } from 'node:os';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gitSpecOwners } from '../src/ci';
import { buildReportSummary } from '../src/summary';

const ROOT = join(__dirname, '..');
const TSX = pathToFileURL(require.resolve('tsx')).href;
const GIT_ENV = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_(AUTHOR|COMMITTER)_/.test(key))),
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_NOSYSTEM: '1'
};
const ANA = ['Ana', 'a@example.com'];
const SAM = ['Sam', 's@example.com'];

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'neo-owners-'));
}

function git(cwd: string, args: string[], [name, email] = ANA): void {
  execFileSync('git', ['-c', `user.name=${name}`, '-c', `user.email=${email}`, '-c', 'commit.gpgsign=false', ...args], { cwd, env: GIT_ENV, stdio: 'ignore' });
}

function commit(repo: string, file: string, author: string[], content: string): void {
  mkdirSync(dirname(join(repo, file)), { recursive: true });
  writeFileSync(join(repo, file), content);
  git(repo, ['add', file], author);
  git(repo, ['commit', '-q', '-m', `Change ${file}`], author);
}

let repo: string | undefined;

function specRepo(): string {
  if (repo) return repo;
  repo = tempDir();
  git(repo, ['init', '-q']);
  commit(repo, 'cypress/e2e/a.cy.ts', ANA, 'one');
  commit(repo, 'cypress/e2e/a.cy.ts', ANA, 'two');
  commit(repo, 'cypress/e2e/a.cy.ts', SAM, 'three');
  commit(repo, 'cypress/e2e/b.cy.ts', SAM, 'one');
  return repo;
}

function shallowClone(): string {
  const dir = join(tempDir(), 'clone');
  execFileSync('git', ['clone', '-q', '--depth', '1', pathToFileURL(specRepo()).href, dir], { env: GIT_ENV, stdio: 'ignore' });
  return dir;
}

function cli(cwd: string, args: string[]) {
  return spawnSync(process.execPath, ['--import', TSX, join(ROOT, 'src', 'cli.ts'), 'owners', ...args], { cwd, encoding: 'utf-8' });
}

test('gitSpecOwners picks the top committer of each tracked spec', () => {
  assert.deepEqual(Object.fromEntries(gitSpecOwners(specRepo(), ['*.cy.*'])), {
    'cypress/e2e/a.cy.ts': 'Ana',
    'cypress/e2e/b.cy.ts': 'Sam'
  });
});

test('gitSpecOwners fails without a repository, on a shallow checkout and without matching specs', () => {
  assert.throws(() => gitSpecOwners(tempDir(), ['*.cy.*']), /Not a git repository/);
  assert.throws(() => gitSpecOwners(shallowClone(), ['*.cy.*']), /shallow/);
  assert.throws(() => gitSpecOwners(specRepo(), ['nothing/*.cy.ts']), /No tracked file matches nothing\/\*\.cy\.ts/);
});

test('neo-reporter owners writes sorted spec owners', () => {
  const result = cli(specRepo(), ['--out', 'out/owners.json']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    readFileSync(join(specRepo(), 'out', 'owners.json'), 'utf-8'),
    '{\n  "cypress/e2e/a.cy.ts": "Ana",\n  "cypress/e2e/b.cy.ts": "Sam"\n}\n'
  );
});

test('neo-reporter owners exits 1 on a shallow checkout and 2 on a usage error', () => {
  const shallow = cli(shallowClone(), []);
  assert.equal(shallow.status, 1);
  assert.match(shallow.stderr, /shallow/);

  const help = cli(specRepo(), ['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--out <file>/);

  assert.equal(cli(specRepo(), ['--bogus']).status, 2);
});

test('a compiled .js spec takes its owner from the TypeScript source listed in spec-owners.json', () => {
  const projectRoot = tempDir();
  writeFileSync(
    join(projectRoot, 'spec-owners.json'),
    JSON.stringify({ 'cypress/e2e/cart.cy.ts': 'Ana', 'cypress/e2e/menu.cy.tsx': 'Sam', 'cypress/e2e/both.cy.js': 'Lee', 'cypress/e2e/both.cy.ts': 'Ana' })
  );
  const run = (spec: string) => ({
    spec: { absolute: join(projectRoot, spec), name: spec.split('/').pop() },
    stats: { tests: 0 },
    screenshots: [],
    video: null,
    tests: []
  });
  const summary = buildReportSummary(
    {
      totalDuration: 0,
      totalSuites: 4,
      totalTests: 0,
      config: { projectRoot },
      runs: ['cypress/e2e/cart.cy.js', 'cypress/e2e/menu.cy.jsx', 'cypress/e2e/both.cy.js', 'cypress/e2e/other.cy.mjs'].map(run)
    } as unknown as CypressCommandLine.CypressRunResult,
    projectRoot
  );
  assert.deepEqual(
    summary.specs.map(spec => [spec.specFile, spec.owner]),
    [
      ['cypress/e2e/cart.cy.js', 'Ana'],
      ['cypress/e2e/menu.cy.jsx', 'Sam'],
      ['cypress/e2e/both.cy.js', 'Lee'],
      ['cypress/e2e/other.cy.mjs', undefined]
    ]
  );
});
