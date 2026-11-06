import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachRunHistory, createHistoryLoader, type ReportSummary } from '../src';
import { sampleSummary } from './fixtures/summary';

interface FakeRun {
  id: number;
  name: string;
  build: { id: string; name: string };
}

function adoResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

test('reads the last runs of the matching test run from Azure DevOps', async t => {
  const env = { ...process.env };
  t.after(() => {
    process.env = env;
  });
  for (const key of ['SYSTEM_ACCESSTOKEN', 'BUILD_BUILDID', 'BUILD_DEFINITIONID', 'RELEASE_DEFINITIONID', 'RELEASE_RELEASEID', 'NEO_TEST_RUN_NAME']) {
    delete process.env[key];
  }
  process.env.AZURE_DEVOPS_PAT = 'token';

  const summary: ReportSummary = { ...sampleSummary(), history: undefined };
  const testNames = summary.specs.flatMap(spec => spec.tests.map(item => item.title.join(' ')));
  const runs: FakeRun[] = [3, 2, 1].map(id => ({ id, name: 'E2E regression', build: { id: String(100 + id), name: `20261105.${id}` } }));
  const requested: URL[] = [];

  t.mock.method(globalThis, 'fetch', async (input: string | URL) => {
    const url = new URL(String(input));
    requested.push(url);
    assert.equal(url.origin + url.pathname.split('/_apis')[0], 'https://dev.azure.com/your-org/your-project');
    if (url.pathname.endsWith('/test/runs')) {
      const isFirstWeek = Date.now() - Date.parse(url.searchParams.get('maxLastUpdatedDate') ?? '') < 60_000;
      const value = isFirstWeek
        ? runs.map((run, index) => ({
            ...run,
            state: 'Completed',
            totalTests: testNames.length,
            passedTests: testNames.length,
            completedDate: new Date(Date.now() - index * 86_400_000).toISOString()
          }))
        : [];
      return adoResponse({ value });
    }
    const runId = Number(url.pathname.match(/Runs\/(\d+)\/results/)?.[1]);
    return adoResponse({
      value: testNames.map(name => ({ automatedTestName: name, outcome: runId === 3 && name.includes('removes the last item') ? 'Failed' : 'Passed' }))
    });
  });

  const loader = createHistoryLoader({ organization: 'your-org', project: 'your-project', runs: 3 }, 'main');
  t.mock.method(console, 'log', () => undefined);
  await attachRunHistory(summary, loader);

  assert.equal(summary.history?.family, 'E2E regression');
  assert.deepEqual(
    summary.history?.runs.map(run => run.label),
    ['20261105.1', '20261105.2', '20261105.3']
  );
  assert.equal(summary.history?.tests['Cart summary › removes the last item'], 'PPF');
  const listCalls = requested.filter(url => url.pathname.endsWith('/test/runs'));
  assert.ok(listCalls.every(url => url.searchParams.get('branchName') === 'refs/heads/main'));
});
