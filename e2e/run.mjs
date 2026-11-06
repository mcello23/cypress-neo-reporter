import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const rootDir = dirname(fixtureDir);
const cypressVersion = process.argv[2] ?? JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8')).devDependencies.cypress;
const reportsDir = join(fixtureDir, 'cypress', 'reports');
const bin = name => join(fixtureDir, 'node_modules', '.bin', name);
const workDir = mkdtempSync(join(tmpdir(), 'neo-reporter-e2e-'));

execFileSync('npm', ['pack', '--pack-destination', workDir], { cwd: rootDir, stdio: 'inherit' });
const tarball = join(workDir, readdirSync(workDir).find(name => name.endsWith('.tgz')));

rmSync(join(fixtureDir, 'node_modules'), { recursive: true, force: true });
rmSync(reportsDir, { recursive: true, force: true });
execFileSync('npm', ['install', '--no-save', '--no-package-lock', '--no-audit', '--no-fund', tarball, `cypress@${cypressVersion}`], {
  cwd: fixtureDir,
  stdio: 'inherit'
});
execFileSync(bin('cypress'), ['install'], { cwd: fixtureDir, stdio: 'inherit' });

const run = spawnSync(bin('cypress'), ['run'], { cwd: fixtureDir, stdio: 'inherit' });
assert.equal(run.status, 1, 'cypress run should end with exactly one failed test');

for (const file of ['e2e.html', 'e2e.junit.xml', 'e2e.summary.md']) {
  assert.ok(existsSync(join(reportsDir, file)), `${file} was not written`);
}
const jsonFile = readdirSync(reportsDir).find(name => /^e2e\.[0-9a-f]{8}\.json$/.test(name));
assert.ok(jsonFile, 'e2e.<id>.json was not written');

const html = readFileSync(join(reportsDir, 'e2e.html'), 'utf-8');
assert.match(html, /data-video-id="test-video-/, 'the HTML report embeds no test clip');

const junit = readFileSync(join(reportsDir, 'e2e.junit.xml'), 'utf-8');
assert.match(junit, /<testsuites [^>]*\btests="3"/);
assert.match(junit, /<testsuites [^>]*\bfailures="1"/);
assert.equal(junit.match(/<testcase /g)?.length, 3);
assert.equal(junit.match(/<failure /g)?.length, 1);

const tests = JSON.parse(readFileSync(join(reportsDir, jsonFile), 'utf-8')).specs.flatMap(spec => spec.tests);
assert.deepEqual(tests.map(test => test.state).sort(), ['failed', 'flaky', 'passed']);
assert.ok(tests.every(test => test.steps.length > 0), 'cy.step was not recorded');

const mergeDir = join(workDir, 'merged');
const merge = spawnSync(bin('neo-reporter'), ['merge', reportsDir, '--out', mergeDir, '--name', 'merged', '--no-history'], { stdio: 'inherit' });
assert.equal(merge.status, 0, 'neo-reporter merge failed');
assert.ok(existsSync(join(mergeDir, 'merged.html')), 'neo-reporter merge wrote no HTML');

rmSync(workDir, { recursive: true, force: true });
console.log(`e2e passed with cypress@${cypressVersion}`);
