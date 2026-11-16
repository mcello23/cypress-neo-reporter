import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { generateMarkdownSummary, generateReports, mergeReports, type MergeOptions, type NeoReporterOptions, type ReportSummary } from '../src';
import { releaseStageTestsUrl } from '../src/history';
import { reportLink } from '../src/markdown';
import { runFileBase, writeReportOutputs } from '../src/output';
import { buildReportSummary } from '../src/summary';
import { SCHEMA_VERSION, type LaneSummary } from '../src/types';
import { MERGE_OPTION_KEYS, validateOptions } from '../src/validate';
import { sampleSummary } from './fixtures/summary';

const ROOT = join(__dirname, '..');
const FOLDER = 'https://acct.blob.core.windows.net/ctr/runs/summaries/';
const SAS = 'sv=2024&sp=rl&sig=TOPSECRET';
const ROLLING_ENV = { TF_BUILD: 'True', RELEASE_RELEASENAME: 'Release 42', NEO_BLOB_SAS: SAS };
const ADO_ENV = {
  SYSTEM_TEAMFOUNDATIONCOLLECTIONURI: 'https://dev.azure.com/your-org/',
  SYSTEM_TEAMPROJECT: 'your project',
  RELEASE_RELEASEID: '42',
  SYSTEM_ACCESSTOKEN: 'adotoken'
};
const LANE_OPTIONS: NeoReporterOptions = { projectName: 'acme-storefront', reportName: 'Lane A', history: false, outputs: ['html', 'markdown'] };
const LANE_B = 'runs/summaries/Lane-B.1a2b3c4d.summary.json';
const LANE_C = 'runs/summaries/older/Lane-C.5e6f7a8b.summary.json';
const LANE_D = 'runs/summaries/Lane-D.9c0d1e2f.summary.json';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'neo-remote-lanes-'));
}

function isolate(t: TestContext, vars: Record<string, string> = {}): void {
  const env = { ...process.env };
  t.after(() => {
    process.env = env;
  });
  for (const key of Object.keys(process.env)) {
    if (/^(GITHUB_|GITLAB_|CI_|BUILD_|SYSTEM_|RELEASE_|TF_BUILD$|NEO_BLOB_SAS$|AZURE_DEVOPS_PAT$)/.test(key)) delete process.env[key];
  }
  Object.assign(process.env, vars);
}

function consoleLines(t: TestContext) {
  const log = t.mock.method(console, 'log', () => undefined);
  const warn = t.mock.method(console, 'warn', () => undefined);
  const lines = (mock: typeof log) => mock.mock.calls.map(call => call.arguments.map(String).join(' '));
  return { logs: () => lines(log), warns: () => lines(warn), all: () => [...lines(log), ...lines(warn)] };
}

interface FakeCall {
  url: string;
  authorization: string | null;
}

interface ListPage {
  names: string[];
  next?: string;
}

function fakeFetch(t: TestContext, answer: (url: URL) => Response | Promise<Response>): FakeCall[] {
  const calls: FakeCall[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), authorization: new Headers(init?.headers).get('authorization') });
    return answer(new URL(String(input)));
  });
  return calls;
}

function listXml({ names, next }: ListPage): string {
  const blobs = names.map(name => `<Blob><Name>${name.replace(/&/g, '&amp;')}</Name><Properties><Content-Length>1</Content-Length></Properties></Blob>`).join('');
  return `<?xml version="1.0" encoding="utf-8"?><EnumerationResults ServiceEndpoint="https://acct.blob.core.windows.net/" ContainerName="ctr"><Prefix>runs/summaries/</Prefix><Blobs>${blobs}</Blobs>${next ? `<NextMarker>${next}</NextMarker>` : '<NextMarker/>'}</EnumerationResults>`;
}

function fakeAzure(t: TestContext, pages: ListPage[], blobs: Record<string, unknown>, other?: (url: URL) => Response | undefined): FakeCall[] {
  return fakeFetch(t, url => {
    const answer = other?.(url);
    if (answer) return answer;
    if (url.searchParams.get('comp') === 'list') {
      const marker = url.searchParams.get('marker');
      const page = marker ? pages.find((_, index) => pages[index - 1]?.next === marker) : pages[0];
      return new Response(listXml(page ?? { names: [] }), { headers: { 'content-type': 'application/xml' } });
    }
    const blob = blobs[decodeURIComponent(url.pathname).replace(/^\/ctr\//, '')];
    if (blob instanceof Response) return blob;
    if (blob === undefined) return new Response('BlobNotFound', { status: 404, statusText: 'The specified blob does not exist.' });
    return new Response(typeof blob === 'string' ? blob : JSON.stringify(blob));
  });
}

function lane(label: string, release = 'Release 42'): ReportSummary {
  const summary = sampleSummary();
  return { ...summary, schemaVersion: SCHEMA_VERSION, suiteLabel: label, ci: { ...summary.ci, release } };
}

function laneRow(label: string): LaneSummary {
  return { label, file: `${label.replace(/ /g, '-')}.html`, failed: 0, flaky: 0, passed: 10, total: 10, passRate: 100, durationMs: 60_000 };
}

function runResults(projectRoot: string): CypressCommandLine.CypressRunResult {
  return {
    browserName: 'chrome',
    browserVersion: '141',
    totalDuration: 5000,
    totalSuites: 1,
    totalTests: 2,
    totalPassed: 1,
    totalFailed: 1,
    totalPending: 0,
    totalSkipped: 0,
    config: { projectRoot, baseUrl: 'https://staging.acme.test', viewportWidth: 1280, viewportHeight: 720 },
    runs: [
      {
        spec: { absolute: join(projectRoot, 'cypress/e2e/cart.cy.js'), name: 'cart.cy.js' },
        stats: { tests: 2, passes: 1, failures: 1, pending: 0, skipped: 0, duration: 5000 },
        screenshots: [],
        video: null,
        tests: [
          { title: ['Cart', 'adds an item'], state: 'passed', duration: 1000, attempts: [{ state: 'passed' }], displayError: null },
          {
            title: ['Cart', 'shows the total'],
            state: 'failed',
            duration: 4000,
            attempts: [{ state: 'failed' }],
            displayError: 'AssertionError: expected 500 to equal 200'
          }
        ]
      }
    ]
  } as unknown as CypressCommandLine.CypressRunResult;
}

function ownFile(projectRoot: string): string {
  return `${runFileBase(buildReportSummary(runResults(projectRoot), projectRoot, LANE_OPTIONS), 'Lane A')}.summary.json`;
}

function lanePages(own: string): ListPage[] {
  return [{ names: [LANE_B, `runs/summaries/${own}`, 'runs/summaries/Lane-B.html'], next: '2!m' }, { names: [LANE_C, LANE_D] }];
}

function laneBlobs(own: string): Record<string, unknown> {
  return {
    [LANE_B]: lane('Lane B'),
    [`runs/summaries/${own}`]: lane('Lane A'),
    'runs/summaries/Lane-B.html': '<html></html>',
    [LANE_C]: lane('Lane C', 'Release 41'),
    [LANE_D]: lane('Lane D')
  };
}

const uploads = (lines: string[]) => lines.filter(line => line.startsWith('##vso[task.uploadsummary]'));

test('summaryDir and remoteLanes are known options for the plugin and for merges', t => {
  const warn = t.mock.method(console, 'warn', () => undefined);
  const options = {
    summaryDir: 'x',
    remoteLanes: { azureBlob: 'https://acct.blob.core.windows.net/ctr/runs/42/summaries/', fileName: 'Release 42 All lanes', projectName: 'Shop' }
  };
  validateOptions(options);
  validateOptions(options, MERGE_OPTION_KEYS);
  assert.equal(warn.mock.callCount(), 0);
});

test('wrong summaryDir and remoteLanes values fail fast without repeating the URL or the SAS', () => {
  const invalid: Array<Record<string, unknown>> = [
    { remoteLanes: 'x' },
    { remoteLanes: null },
    { remoteLanes: {} },
    { remoteLanes: { azureBlob: 'http://acct.blob.core.windows.net/ctr/x/' } },
    { remoteLanes: { azureBlob: 'https://acct.blob.core.windows.net' } },
    { remoteLanes: { azureBlob: 'https://acct.blob.core.windows.net/ctr/x/?sv=1&sig=TOPSECRET' } },
    { remoteLanes: { azureBlob: 'not a url TOPSECRET' } },
    { remoteLanes: { azureBlob: FOLDER, sas: 42 } },
    { remoteLanes: { azureBlob: FOLDER, sas: '' } },
    { remoteLanes: { azureBlob: FOLDER, sas: 'TOPSECRET', run: '' } },
    { remoteLanes: { azureBlob: FOLDER, sas: 'TOPSECRET', reportName: '' } },
    { remoteLanes: { azureBlob: FOLDER, sas: 'TOPSECRET', junit: {} } },
    { remoteLanes: { azureBlob: FOLDER, junit: { path: '' } } },
    { remoteLanes: { azureBlob: FOLDER, junit: { path: 'a.xml', testName: '' } } },
    { remoteLanes: { azureBlob: FOLDER, releaseStage: '' } },
    { remoteLanes: { azureBlob: FOLDER, fileName: '' } },
    { remoteLanes: { azureBlob: FOLDER, projectName: 7 } },
    { remoteLanes: { azureBlob: FOLDER, junit: 'x' } },
    { summaryDir: '' },
    { summaryDir: 5 }
  ];
  for (const options of invalid) {
    assert.throws(
      () => validateOptions(options as MergeOptions),
      (error: Error) => /\[neo-reporter\] (remoteLanes|summaryDir)/.test(error.message) && !error.message.includes('TOPSECRET'),
      Object.keys(options).join()
    );
  }
});

test('summaryDir moves only the summary output, relative to the project root', async t => {
  isolate(t);
  consoleLines(t);
  const out = tempDir();
  const sums = join(tempDir(), 'summaries');
  const files = writeReportOutputs(lane('Lane A'), out, 'Lane A', ['json', 'summary', 'markdown'], { summaryDir: sums });
  assert.equal(dirname(files.summary!), sums);
  assert.match(files.summary!, /Lane-A\.[0-9a-f]{8}\.summary\.json$/);
  assert.equal(basename(files.summary!, '.summary.json'), basename(files.json!, '.json'));
  assert.equal(dirname(files.json!), out);
  assert.equal(files.markdown, join(out, 'Lane-A.summary.md'));

  const projectRoot = tempDir();
  const run = await generateReports(runResults(projectRoot), { outputs: ['summary'], summaryDir: 'cypress/results/summaries', history: false });
  assert.equal(dirname(run.summary!), join(projectRoot, 'cypress/results/summaries'));
});

test('a {file} in reportUrl names each report and links each lane row', t => {
  isolate(t);
  const merged: ReportSummary = { ...sampleSummary(), suiteLabel: 'All lanes', mergedFrom: 2, lanes: [laneRow('Lane A'), laneRow('Lane B')] };
  const template = 'https://acct.blob.core.windows.net/ctr/r/{file}?sv=1&sig=s';
  const markdown = generateMarkdownSummary(merged, template);
  assert.ok(markdown.includes('[📄 Open the full HTML report](https://acct.blob.core.windows.net/ctr/r/All-lanes.html?sv=1&sig=s)'));
  assert.ok(markdown.includes('| ✅ [Lane A](https://acct.blob.core.windows.net/ctr/r/Lane-A.html?sv=1&sig=s) |'));
  assert.ok(markdown.includes('| ✅ [Lane B](https://acct.blob.core.windows.net/ctr/r/Lane-B.html?sv=1&sig=s) |'));

  const plain = generateMarkdownSummary(merged, 'https://acct.blob.core.windows.net/ctr/r/report.html');
  assert.ok(plain.includes('[📄 Open the full HTML report](https://acct.blob.core.windows.net/ctr/r/report.html)'));
  assert.ok(plain.includes('| ✅ Lane A |'));
  assert.doesNotMatch(plain, /\[Lane A\]\(/);

  assert.equal(reportLink(merged, template), 'https://acct.blob.core.windows.net/ctr/r/All-lanes.html?sv=1&sig=s');
});

test('each lane merges the other lanes of its release into a lanes report and attaches one summary', async t => {
  isolate(t, ROLLING_ENV);
  const output = consoleLines(t);
  const projectRoot = tempDir();
  const own = ownFile(projectRoot);
  const calls = fakeAzure(t, lanePages(own), laneBlobs(own));
  const files = await generateReports(runResults(projectRoot), { ...LANE_OPTIONS, remoteLanes: { azureBlob: FOLDER } });

  const lists = calls.filter(call => call.url.includes('comp=list'));
  assert.equal(lists.length, 2);
  assert.ok(lists.every(call => call.url.startsWith('https://acct.blob.core.windows.net/ctr?restype=container&comp=list&prefix=runs%2Fsummaries%2F&')));
  assert.ok(lists[1].url.endsWith(`&marker=${encodeURIComponent('2!m')}`));
  const downloads = calls.filter(call => !call.url.includes('comp=list')).map(call => decodeURIComponent(new URL(call.url).pathname));
  assert.deepEqual(downloads.sort(), [`/ctr/${LANE_D}`, `/ctr/${LANE_B}`, `/ctr/${LANE_C}`].sort());
  assert.ok(calls.every(call => call.authorization === null));

  const reports = join(projectRoot, 'cypress/reports');
  assert.ok(existsSync(join(reports, 'All-lanes.html')));
  const lanesMd = readFileSync(join(reports, 'All-lanes.summary.md'), 'utf-8');
  const laneMd = readFileSync(files.markdown!, 'utf-8');
  assert.equal(files.markdown, join(reports, 'Lane-A.summary.md'));
  const [ownMd, appendix, ...rest] = laneMd.split('\n---\n\n');
  assert.equal(rest.length, 0);
  assert.equal(appendix, lanesMd);
  assert.match(ownMd, /^### ❌ acme-storefront - Lane A\n/);
  assert.doesNotMatch(ownMd, /#### Lanes/);
  assert.match(lanesMd, /^### ❌ acme-storefront - All lanes\n/);
  assert.match(lanesMd, /#### Lanes/);
  assert.match(lanesMd, /\| ❌ Lane A \| 1 \| 0 \| 1 \| 2 \| 50% \|/);
  assert.match(lanesMd, /\| ❌ Lane B \| 7 \| 1 \|/);
  assert.match(lanesMd, /\| ❌ Lane D \| 7 \| 1 \|/);
  assert.doesNotMatch(lanesMd, /Lane C/);

  assert.equal(files.summary, join(reports, own));
  assert.ok(readdirSync(reports).every(name => !name.endsWith('.xml')));
  assert.deepEqual(uploads(output.logs()), [`##vso[task.uploadsummary]${files.markdown}`]);
  assert.ok(output.all().every(line => !line.includes('TOPSECRET')));
});

test('a folder the SAS cannot list only warns, and the lane report is written as usual', async t => {
  const failures: Array<[string, () => Promise<Response>, RegExp[]]> = [
    [
      '403',
      async () =>
        new Response('<?xml version="1.0" encoding="utf-8"?><Error><Code>AuthenticationFailed</Code><Message>sig=TOPSECRET</Message></Error>', {
          status: 403,
          statusText: 'Server failed to authenticate the request.'
        }),
      [/Lanes report not written: Azure Blob Storage answered 403/, /read \(r\) and list \(l\)/]
    ],
    ['network', () => Promise.reject(new TypeError('fetch failed')), [/Lanes report not written: fetch failed/]]
  ];
  for (const [name, answer, messages] of failures) {
    await t.test(name, async t => {
      isolate(t, ROLLING_ENV);
      const output = consoleLines(t);
      const projectRoot = tempDir();
      fakeFetch(t, answer);
      const files = await generateReports(runResults(projectRoot), { ...LANE_OPTIONS, remoteLanes: { azureBlob: FOLDER } });
      const warns = output.warns().filter(line => line.includes('Lanes report'));
      assert.equal(warns.length, 1);
      messages.forEach(message => assert.match(warns[0], message));
      assert.doesNotMatch(readFileSync(files.markdown!, 'utf-8'), /\n---\n/);
      assert.ok(existsSync(files.html!) && existsSync(files.summary!));
      assert.ok(!existsSync(join(projectRoot, 'cypress/reports/All-lanes.html')));
      assert.ok(!existsSync(join(projectRoot, 'cypress/reports/All-lanes.summary.md')));
      assert.deepEqual(uploads(output.logs()), [`##vso[task.uploadsummary]${files.markdown}`]);
      assert.ok(output.all().every(line => !line.includes('TOPSECRET')));
    });
  }
});

test('a lane summary that fails to download or is not a report is skipped with one warning', async t => {
  isolate(t, ROLLING_ENV);
  const output = consoleLines(t);
  const projectRoot = tempDir();
  const broken = 'runs/summaries/Lane-E.aaaaaaaa.summary.json';
  const other = 'runs/summaries/Lane-F.bbbbbbbb.summary.json';
  fakeAzure(t, [{ names: [LANE_B, broken, other] }], {
    [LANE_B]: lane('Lane B'),
    [broken]: new Response('oops', { status: 500, statusText: 'Internal Server Error' }),
    [other]: '{"specs":"x"}'
  });
  const files = await generateReports(runResults(projectRoot), { ...LANE_OPTIONS, remoteLanes: { azureBlob: FOLDER } });
  const about = (name: string) => output.warns().filter(line => line.includes(name));
  assert.equal(about(broken).length, 1);
  assert.match(about(broken)[0], /Skipping lane summary runs\/summaries\/Lane-E\.aaaaaaaa\.summary\.json: Azure Blob Storage answered 500/);
  assert.equal(about(other).length, 1);
  assert.match(about(other)[0], /Skipping lane summary runs\/summaries\/Lane-F\.bbbbbbbb\.summary\.json: not a neo-reporter report/);
  const laneMd = readFileSync(files.markdown!, 'utf-8');
  assert.match(laneMd, /\n---\n\n### ❌ acme-storefront - All lanes\n/);
  assert.match(laneMd, /\| ❌ Lane A \| 1 \|/);
  assert.match(laneMd, /\| ❌ Lane B \| 7 \|/);
  assert.ok(output.all().every(line => !line.includes('TOPSECRET')));
});

test('without a SAS or a CI run label the lanes report is skipped before any request', async t => {
  const cases: Array<[string, Record<string, string>, (output: ReturnType<typeof consoleLines>) => void]> = [
    [
      'no SAS',
      { TF_BUILD: 'True', RELEASE_RELEASENAME: 'Release 42' },
      output => assert.equal(output.warns().filter(line => line.includes('set NEO_BLOB_SAS')).length, 1)
    ],
    [
      'no release or build',
      { TF_BUILD: 'True', NEO_BLOB_SAS: SAS },
      output => assert.ok(output.logs().some(line => line.includes('Lanes report skipped: this run has no CI release or build')))
    ]
  ];
  for (const [name, env, check] of cases) {
    await t.test(name, async t => {
      isolate(t, env);
      const output = consoleLines(t);
      const projectRoot = tempDir();
      const calls = fakeFetch(t, () => new Response(''));
      const files = await generateReports(runResults(projectRoot), { ...LANE_OPTIONS, remoteLanes: { azureBlob: FOLDER } });
      assert.equal(calls.length, 0);
      check(output);
      assert.ok(existsSync(files.html!) && existsSync(files.markdown!) && existsSync(files.summary!));
      assert.doesNotMatch(readFileSync(files.markdown!, 'utf-8'), /\n---\n/);
    });
  }
});

test('a folder with only this lane\'s own stale summary still writes the lanes report and its appendix, with one lane row', async t => {
  isolate(t, ROLLING_ENV);
  const output = consoleLines(t);
  const projectRoot = tempDir();
  const own = ownFile(projectRoot);
  const calls = fakeAzure(t, [{ names: [`runs/summaries/${own}`] }], { [`runs/summaries/${own}`]: lane('Lane A') });
  const files = await generateReports(runResults(projectRoot), { ...LANE_OPTIONS, remoteLanes: { azureBlob: FOLDER } });
  assert.equal(calls.length, 1);
  assert.ok(existsSync(join(projectRoot, 'cypress/reports/All-lanes.html')));
  const lanesMd = readFileSync(join(projectRoot, 'cypress/reports/All-lanes.summary.md'), 'utf-8');
  assert.ok(output.logs().includes('[neo-reporter] No other lane found in the Azure Blob Storage folder yet.'));
  assert.match(lanesMd, /#### Lanes\n\n\| Lane \|[^\n]*\n\| ---[^\n]*\n\| ❌ Lane A \| 1 \| 0 \| 1 \| 2 \| 50% \|[^\n]*\n\n/);
  assert.equal(readFileSync(files.markdown!, 'utf-8').split('\n---\n\n')[1], lanesMd);
});

test('remoteLanes names the lanes report and its project, lanes link their own file names, and every target is listed', async t => {
  isolate(t, ROLLING_ENV);
  consoleLines(t);
  const projectRoot = tempDir();
  const options = { ...LANE_OPTIONS, fileName: 'Release-42-Lane-A' };
  const own = `${runFileBase(buildReportSummary(runResults(projectRoot), projectRoot, options), options.fileName)}.summary.json`;
  const b = { ...lane('Lane B'), fileName: 'Release-42-Lane-B', projectName: 'other-project', environment: 'https://docker.acme.test' };
  fakeAzure(t, [{ names: [`runs/summaries/${own}`, LANE_B] }], { [`runs/summaries/${own}`]: lane('Lane A'), [LANE_B]: b });
  const files = await generateReports(runResults(projectRoot), {
    ...options,
    reportUrl: 'https://acct.blob.core.windows.net/ctr/runs/42/reports/{file}',
    remoteLanes: { azureBlob: FOLDER, projectName: 'Shop', fileName: 'Release 42 All lanes' }
  });
  const reports = join(projectRoot, 'cypress/reports');
  assert.equal(files.html, join(reports, 'Release-42-Lane-A.html'));
  assert.match(basename(files.summary!), /^Release-42-Lane-A\.[0-9a-f]{8}\.summary\.json$/);
  assert.ok(existsSync(join(reports, 'Release-42-All-lanes.html')));
  const lanesMd = readFileSync(join(reports, 'Release-42-All-lanes.summary.md'), 'utf-8');
  assert.match(lanesMd, /^### ❌ Shop - All lanes\n/);
  assert.ok(lanesMd.includes('[📄 Open the full HTML report](https://acct.blob.core.windows.net/ctr/runs/42/reports/Release-42-All-lanes.html)'));
  assert.ok(lanesMd.includes('| ❌ [Lane A](https://acct.blob.core.windows.net/ctr/runs/42/reports/Release-42-Lane-A.html) |'));
  assert.ok(lanesMd.includes('| ❌ [Lane B](https://acct.blob.core.windows.net/ctr/runs/42/reports/Release-42-Lane-B.html) |'));
  assert.ok(lanesMd.includes('Target: https://staging.acme.test, https://docker.acme.test'));
  const laneMd = readFileSync(files.markdown!, 'utf-8');
  assert.match(laneMd, /^### ❌ acme-storefront - Lane A\n/);
  assert.ok(laneMd.includes('[📄 Open the full HTML report](https://acct.blob.core.windows.net/ctr/runs/42/reports/Release-42-Lane-A.html)'));
});

test('the JUnit carrier holds one passed test with the lanes summary and the report attached', async t => {
  isolate(t, ROLLING_ENV);
  consoleLines(t);
  const projectRoot = tempDir();
  const own = ownFile(projectRoot);
  const blobs = laneBlobs(own);
  const b = lane('Lane B');
  b.specs[0].tests[0].displayError = 'AssertionError: expected ]]> to be gone\u0000 here';
  b.specs[1].tests[0].displayError = "AssertionError: expected 'Hi [[ATTACHMENT|/etc/passwd]]' to equal 'Hi'";
  b.specs[1].tests[1].title = ['Cart summary', 'removes [[ ATTACHMENT | ../../home/agent/.ssh/id_rsa]]'];
  b.specs[1].tests[1].fullTitle = b.specs[1].tests[1].title.join(' › ');
  blobs[LANE_B] = b;
  fakeAzure(t, lanePages(own), blobs);
  await generateReports(runResults(projectRoot), {
    ...LANE_OPTIONS,
    outputDir: 'cypress/results/reports',
    reportUrl: 'https://acct.blob.core.windows.net/ctr/runs/42/reports/{file}?sv=1&sig=read',
    remoteLanes: { azureBlob: FOLDER, junit: { path: 'cypress/results/all-lanes.junit.xml', testName: 'All lanes summary' } }
  });
  const xml = readFileSync(join(projectRoot, 'cypress/results/all-lanes.junit.xml'), 'utf-8');
  assert.equal(xml.match(/<testcase /g)?.length, 1);
  assert.ok(xml.includes('<testcase name="All lanes summary" classname="All lanes summary" time="0">'));
  assert.ok(!xml.includes('<failure'));
  assert.match(xml, /timestamp="\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d"/);
  assert.ok(!xml.includes('\u0000'));
  const systemOut = /<system-out>([\s\S]*)<\/system-out>/.exec(xml)![1];
  assert.ok(systemOut.startsWith('<![CDATA['));
  const text = [...systemOut.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)].map(match => match[1]).join('');
  assert.ok(text.includes('Lanes: 3'));
  assert.ok(text.includes('expected ]]> to be gone here'));
  assert.ok(text.endsWith('[[ATTACHMENT|reports/All-lanes.html]]'));
  assert.equal(text.match(/\[\[\s*ATTACHMENT\s*\|/gi)?.length, 1);
  assert.ok(text.includes("expected 'Hi [ [ATTACHMENT|/etc/passwd]]' to equal 'Hi'"));
  assert.ok(text.includes('removes [ [ ATTACHMENT | ../../home/agent/.ssh/id_rsa]]'));

  const laneMd = readFileSync(join(projectRoot, 'cypress/results/reports/Lane-A.summary.md'), 'utf-8');
  assert.ok(laneMd.includes('(https://acct.blob.core.windows.net/ctr/runs/42/reports/Lane-A.html?sv=1&sig=read)'));
  assert.ok(laneMd.includes('(https://acct.blob.core.windows.net/ctr/runs/42/reports/All-lanes.html?sv=1&sig=read)'));
  assert.ok(laneMd.includes('[Lane D](https://acct.blob.core.windows.net/ctr/runs/42/reports/Lane-D.html?sv=1&sig=read)'));
});

test('releaseStage links the lanes summary to the Tests tab of that release stage', async t => {
  isolate(t, { ...ROLLING_ENV, ...ADO_ENV });
  consoleLines(t);
  const projectRoot = tempDir();
  const own = ownFile(projectRoot);
  const calls = fakeAzure(t, lanePages(own), laneBlobs(own), url =>
    url.host === 'vsrm.dev.azure.com' && url.pathname === '/your-org/your%20project/_apis/release/releases/42'
      ? new Response(JSON.stringify({ environments: [{ id: 3, name: 'Run tests' }, { id: 7, name: 'Publish results' }] }))
      : undefined
  );
  const files = await generateReports(runResults(projectRoot), {
    ...LANE_OPTIONS,
    remoteLanes: { azureBlob: FOLDER, junit: { path: 'cypress/results/all-lanes.junit.xml', testName: 'All lanes summary' }, releaseStage: 'Publish results' }
  });
  const laneMd = readFileSync(files.markdown!, 'utf-8');
  assert.ok(
    laneMd.includes(
      '[🧪 Open "All lanes summary" in Publish results → Tests](https://dev.azure.com/your-org/your%20project/_releaseProgress?releaseId=42&environmentId=7&extensionId=ms.vss-test-web.test-result-in-release-environment-editor-tab&_a=release-environment-extension)'
    )
  );
  const authorized = calls.filter(call => call.authorization !== null);
  assert.deepEqual(
    authorized.map(call => [call.url, call.authorization]),
    [['https://vsrm.dev.azure.com/your-org/your%20project/_apis/release/releases/42?api-version=7.1', 'Bearer adotoken']]
  );
});

test('the Tests tab link follows the collection host and only warns when it cannot be built', async t => {
  await t.test('visualstudio.com goes to its vsrm host', async t => {
    isolate(t, { ...ADO_ENV, SYSTEM_TEAMFOUNDATIONCOLLECTIONURI: 'https://acme.visualstudio.com/' });
    const calls = fakeFetch(t, () => new Response(JSON.stringify({ environments: [{ id: 7, name: 'Publish results' }] })));
    const url = await releaseStageTestsUrl('Publish results');
    assert.equal(calls[0].url, 'https://acme.vsrm.visualstudio.com/your%20project/_apis/release/releases/42?api-version=7.1');
    assert.match(url ?? '', /^https:\/\/acme\.visualstudio\.com\/your%20project\/_releaseProgress\?releaseId=42&environmentId=7&/);
  });
  await t.test('an unknown stage warns once and gives no link', async t => {
    isolate(t, ADO_ENV);
    const output = consoleLines(t);
    fakeFetch(t, () => new Response(JSON.stringify({ environments: [{ id: 7, name: 'Publish results' }] })));
    assert.equal(await releaseStageTestsUrl('Deploy'), undefined);
    assert.equal(output.warns().length, 1);
    assert.match(output.warns()[0], /Tests tab link for Deploy unavailable/);
  });
  await t.test('an http:// collection makes no request', async t => {
    isolate(t, { ...ADO_ENV, SYSTEM_TEAMFOUNDATIONCOLLECTIONURI: 'http://tfs.example/DefaultCollection/' });
    const output = consoleLines(t);
    const calls = fakeFetch(t, () => new Response('{}'));
    assert.equal(await releaseStageTestsUrl('Publish results'), undefined);
    assert.equal(calls.length, 0);
    assert.match(output.warns().join('\n'), /Tests tab link for Publish results skipped: the Azure DevOps address is not https:\/\//);
  });
  await t.test('without a token there is no request and no warning', async t => {
    isolate(t, { ...ADO_ENV, SYSTEM_ACCESSTOKEN: '' });
    const output = consoleLines(t);
    const calls = fakeFetch(t, () => new Response('{}'));
    assert.equal(await releaseStageTestsUrl('Publish results'), undefined);
    assert.equal(calls.length + output.warns().length, 0);
  });
});

test('mergeReports rebuilds the lanes report of one run from the folder and attaches it once', async t => {
  await t.test('merges only the matching run', async t => {
    isolate(t, { TF_BUILD: 'True', NEO_BLOB_SAS: SAS });
    const output = consoleLines(t);
    const dir = tempDir();
    fakeAzure(t, [{ names: [LANE_B, LANE_C, LANE_D] }], { [LANE_B]: lane('Lane B'), [LANE_C]: lane('Lane C', 'Release 41'), [LANE_D]: lane('Lane D') });
    const result = await mergeReports({ remoteLanes: { azureBlob: FOLDER, run: 'Release 42' }, outputDir: dir, history: false });
    assert.equal(result?.summary.mergedFrom, 2);
    assert.deepEqual(result?.summary.lanes?.map(row => row.label), ['Lane B', 'Lane D']);
    assert.deepEqual(result?.files, { html: join(dir, 'All-lanes.html'), markdown: join(dir, 'All-lanes.summary.md') });
    assert.deepEqual(uploads(output.logs()), [`##vso[task.uploadsummary]${join(dir, 'All-lanes.summary.md')}`]);
    assert.ok(output.all().every(line => !line.includes('TOPSECRET')));
  });
  await t.test('needs a SAS', async t => {
    isolate(t);
    const calls = fakeFetch(t, () => new Response(''));
    await assert.rejects(mergeReports({ remoteLanes: { azureBlob: FOLDER }, outputDir: tempDir() }), /Set NEO_BLOB_SAS/);
    assert.equal(calls.length, 0);
  });
  await t.test('does not mix with reportRoot', async t => {
    isolate(t, { NEO_BLOB_SAS: SAS });
    await assert.rejects(mergeReports({ remoteLanes: { azureBlob: FOLDER }, reportRoot: tempDir() }), /leave out reportRoot and summaryFiles/);
  });
  await t.test('rejects a listing it may not read, without the SAS', async t => {
    isolate(t, { NEO_BLOB_SAS: SAS });
    fakeFetch(t, () => new Response('AuthenticationFailed', { status: 403, statusText: 'Forbidden' }));
    await assert.rejects(mergeReports({ remoteLanes: { azureBlob: FOLDER }, outputDir: tempDir() }), (error: Error) => {
      assert.match(error.message, /Azure Blob Storage answered 403 Forbidden for https:\/\/acct\.blob\.core\.windows\.net\/ctr\./);
      assert.doesNotMatch(error.message, /sig=|TOPSECRET/);
      return true;
    });
  });
});

test('cli merge --azure-blob checks its flags and never prints the URL it rejects', () => {
  const cli = (args: string[], env: NodeJS.ProcessEnv = {}) =>
    spawnSync(process.execPath, ['--import', 'tsx', join(ROOT, 'src', 'cli.ts'), 'merge', ...args], {
      cwd: ROOT,
      encoding: 'utf-8',
      env: { ...process.env, NEO_SLACK_WEBHOOK: '', NEO_TEAMS_WEBHOOK: '', ...env }
    });
  const both = cli([tempDir(), '--azure-blob', 'https://acct.blob.core.windows.net/ctr/x/']);
  assert.equal(both.status, 2);
  assert.match(both.stderr, /Pass either a dir or --azure-blob, not both/);

  const runAlone = cli(['--run', 'R']);
  assert.equal(runAlone.status, 2);
  assert.match(runAlone.stderr, /--run needs --azure-blob/);

  const withQuery = cli(['--azure-blob', 'https://acct.blob.core.windows.net/ctr/x/?sig=TOPSECRET']);
  assert.equal(withQuery.status, 2);
  assert.match(withQuery.stderr, /--azure-blob must be the https:\/\/ URL of a folder/);
  assert.ok(!`${withQuery.stdout}${withQuery.stderr}`.includes('TOPSECRET'));

  const noSas = cli(['--azure-blob', 'https://acct.blob.core.windows.net/ctr/x/'], { NEO_BLOB_SAS: '' });
  assert.equal(noSas.status, 1);
  assert.match(noSas.stderr, /NEO_BLOB_SAS/);

  const help = cli(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--azure-blob <url>/);
  assert.match(help.stdout, /--run <name>/);
});
