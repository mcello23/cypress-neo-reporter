import { adoCollectionUrl } from './ci';
import type { HistoryLoader, HistoryOptions, ReportSummary, RunHistory } from './types';

const HISTORY_RUN_COUNT = 10;
const HISTORY_MAX_WEEKS = 8;
const HISTORY_DISCOVERY_WEEKS = 2;
const HISTORY_MIN_OVERLAP = 0.3;
const HISTORY_CANDIDATE_FAMILIES = 10;
const HISTORY_CONCURRENCY = 10;
const HISTORY_TIMEOUT_MS = 180_000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const RESULTS_PAGE_SIZE = 5000;

interface AdoRun {
  id: number;
  name: string;
  state: string;
  completedDate?: string;
  totalTests: number;
  passedTests: number;
  webAccessUrl?: string;
  build?: { id?: string; name?: string };
  release?: { id?: number; name?: string };
}

interface AdoHistoryTarget {
  apiUrl: string;
  authorization: string;
  runName?: string;
  runs: number;
  maxWeeks: number;
  branch?: string;
}

function adoAuthorization(): string | null {
  const { SYSTEM_ACCESSTOKEN, AZURE_DEVOPS_PAT } = process.env;
  if (SYSTEM_ACCESSTOKEN) return `Bearer ${SYSTEM_ACCESSTOKEN}`;
  if (AZURE_DEVOPS_PAT) return `Basic ${Buffer.from(`:${AZURE_DEVOPS_PAT}`).toString('base64')}`;
  return null;
}

function adoOrganizationUrl(organization?: string): string | undefined {
  if (!organization) return adoCollectionUrl();
  const url = /^https?:\/\//i.test(organization) ? organization : `https://dev.azure.com/${organization}`;
  return url.replace(/\/?$/, '/');
}

function adoHistoryTarget(options: HistoryOptions, branch?: string): AdoHistoryTarget | null {
  const authorization = adoAuthorization();
  if (!authorization) return null;
  const organizationUrl = adoOrganizationUrl(options.organization);
  const project = options.project ?? process.env.SYSTEM_TEAMPROJECT;
  if (!organizationUrl || !project) {
    console.warn('[neo-reporter] Run history skipped: set history.organization and history.project to read Azure DevOps outside a pipeline.');
    return null;
  }
  return {
    apiUrl: `${organizationUrl}${encodeURIComponent(project)}/_apis`,
    authorization,
    runName: options.runName ?? process.env.NEO_TEST_RUN_NAME,
    runs: options.runs ?? HISTORY_RUN_COUNT,
    maxWeeks: options.maxWeeks ?? HISTORY_MAX_WEEKS,
    branch
  };
}

async function adoGet<T>(url: string, authorization: string): Promise<{ body: T; continuation: string | null }> {
  const response = await fetch(url, { headers: { Authorization: authorization }, signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Azure DevOps answered ${response.status} ${response.statusText} for ${url.split('?')[0]}`);
  return { body: (await response.json()) as T, continuation: response.headers.get('x-ms-continuationtoken') };
}

async function listAdoRuns(
  apiUrl: string,
  authorization: string,
  filters: Record<string, string>,
  weeks: number,
  enough = Infinity
): Promise<AdoRun[]> {
  const runs: AdoRun[] = [];
  for (let week = 0; week < weeks && runs.length < enough; week++) {
    const max = new Date(Date.now() - week * WEEK_MS);
    const min = new Date(max.getTime() - WEEK_MS + 60_000);
    let continuation: string | null = null;
    do {
      const params = new URLSearchParams({
        ...filters,
        minLastUpdatedDate: min.toISOString(),
        maxLastUpdatedDate: max.toISOString(),
        'api-version': '7.1'
      });
      if (continuation) params.set('continuationToken', continuation);
      const page: { body: { value: AdoRun[] }; continuation: string | null } = await adoGet(`${apiUrl}/test/runs?${params}`, authorization);
      runs.push(...page.body.value.filter(run => run.state === 'Completed' && run.totalTests > 0));
      continuation = page.continuation;
    } while (continuation);
  }
  return runs.sort((a, b) => Date.parse(b.completedDate ?? '') - Date.parse(a.completedDate ?? ''));
}

function branchRef(branch?: string): string | undefined {
  if (!branch) return undefined;
  return branch.startsWith('refs/') ? branch : `refs/heads/${branch}`;
}

async function listRunsOnBranch(target: AdoHistoryTarget, filters: Record<string, string>, weeks: number, enough = Infinity): Promise<AdoRun[]> {
  const ref = branchRef(target.branch);
  if (ref) {
    const onBranch = await listAdoRuns(target.apiUrl, target.authorization, { ...filters, branchName: ref }, weeks, enough);
    if (onBranch.length > 0) return onBranch;
  }
  return listAdoRuns(target.apiUrl, target.authorization, filters, weeks, enough);
}

function discoveryFilters(): Record<string, string> {
  const { RELEASE_DEFINITIONID, BUILD_DEFINITIONID } = process.env;
  if (RELEASE_DEFINITIONID) return { isAutomated: 'true', releaseDefIds: RELEASE_DEFINITIONID };
  if (BUILD_DEFINITIONID) return { isAutomated: 'true', buildDefIds: BUILD_DEFINITIONID };
  return { isAutomated: 'true' };
}

function isCurrentRun(run: AdoRun): boolean {
  const { RELEASE_RELEASEID, BUILD_BUILDID } = process.env;
  if (RELEASE_RELEASEID) return run.release?.id === Number(RELEASE_RELEASEID);
  return Boolean(BUILD_BUILDID) && String(run.build?.id) === BUILD_BUILDID;
}

function outcomeCode(outcome: string): string {
  if (outcome === 'Passed') return 'P';
  if (['Failed', 'Error', 'Aborted', 'Timeout'].includes(outcome)) return 'F';
  return 'S';
}

async function adoRunOutcomes(apiUrl: string, authorization: string, runId: number): Promise<Map<string, string>> {
  const outcomes = new Map<string, string>();
  for (let skip = 0; ;) {
    const { body } = await adoGet<{ value: Array<{ automatedTestName?: string; testCaseTitle?: string; outcome: string }> }>(
      `${apiUrl}/test/Runs/${runId}/results?$top=${RESULTS_PAGE_SIZE}&$skip=${skip}&api-version=7.1`,
      authorization
    );
    body.value.forEach(result => outcomes.set(result.automatedTestName ?? result.testCaseTitle ?? '', outcomeCode(result.outcome)));
    skip += body.value.length;
    if (body.value.length < RESULTS_PAGE_SIZE) return outcomes;
  }
}

async function mapWithLimit<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

interface HistoryCandidate {
  run: AdoRun;
  outcomes: Map<string, string>;
}

interface FamilyRuns {
  runs: AdoRun[];
  outcomes: Map<string, string>[];
}

async function loadHistoryCandidates(target: AdoHistoryTarget): Promise<HistoryCandidate[]> {
  const recent = await listRunsOnBranch(target, discoveryFilters(), HISTORY_DISCOVERY_WEEKS);
  const latestByFamily = new Map<string, AdoRun>();
  recent.filter(run => !isCurrentRun(run)).forEach(run => latestByFamily.has(run.name) || latestByFamily.set(run.name, run));
  return mapWithLimit([...latestByFamily.values()].slice(0, HISTORY_CANDIDATE_FAMILIES), 4, async run => ({
    run,
    outcomes: await adoRunOutcomes(target.apiUrl, target.authorization, run.id)
  }));
}

function pickRunFamily(candidates: HistoryCandidate[], testNames: string[], runName?: string): string | null {
  if (runName) return runName;
  const overlaps = candidates.map(({ outcomes }) => testNames.filter(name => outcomes.has(name)).length / Math.max(testNames.length, 1));
  const best = overlaps.reduce((bestIndex, overlap, index) => (overlap > (overlaps[bestIndex] ?? -1) ? index : bestIndex), -1);
  return best >= 0 && overlaps[best] >= HISTORY_MIN_OVERLAP ? candidates[best].run.name : null;
}

async function loadFamilyRuns(target: AdoHistoryTarget, family: string, candidates: HistoryCandidate[]): Promise<FamilyRuns> {
  const runs = (await listRunsOnBranch(target, { runTitle: family }, target.maxWeeks, target.runs + 1))
    .filter(run => !isCurrentRun(run))
    .slice(0, target.runs)
    .reverse();
  const known = new Map(candidates.map(candidate => [candidate.run.id, candidate.outcomes]));
  const outcomes = await mapWithLimit(
    runs,
    HISTORY_CONCURRENCY,
    async run => known.get(run.id) ?? adoRunOutcomes(target.apiUrl, target.authorization, run.id)
  );
  return { runs, outcomes };
}

function toRunHistory(summary: ReportSummary, family: string, { runs, outcomes }: FamilyRuns): RunHistory {
  const tests: Record<string, string> = {};
  for (const test of summary.specs.flatMap(spec => spec.tests)) {
    const codes = outcomes.map(runOutcomes => runOutcomes.get(test.title.join(' ')) ?? '-').join('');
    if (/[PFS]/.test(codes)) tests[test.fullTitle] = codes;
  }
  return {
    family: family.trim(),
    runs: runs.map((run, index) => {
      const codes = [...outcomes[index].values()];
      return {
        id: run.id,
        label: run.release?.name ?? run.build?.name ?? `Run ${run.id}`,
        date: run.completedDate ?? '',
        total: codes.length,
        passed: codes.filter(code => code === 'P').length,
        failed: codes.filter(code => code === 'F').length,
        url: run.webAccessUrl
      };
    }),
    tests
  };
}

export function createHistoryLoader(options: HistoryOptions | false = {}, branch?: string): HistoryLoader | null {
  if (options === false) return null;
  const target = adoHistoryTarget(options, branch);
  if (!target) return null;
  const candidates = target.runName ? Promise.resolve([]) : loadHistoryCandidates(target);
  candidates.catch(() => undefined);
  const families = new Map<string, Promise<FamilyRuns>>();
  const familyRuns = (family: string): Promise<FamilyRuns> => {
    let runs = families.get(family);
    if (!runs) {
      runs = candidates.then(known => loadFamilyRuns(target, family, known));
      runs.catch(() => undefined);
      families.set(family, runs);
    }
    return runs;
  };
  let warmed = false;
  return {
    warm(testName) {
      if (warmed) return;
      warmed = true;
      candidates.then(
        known => {
          const family = pickRunFamily(known, [testName], target.runName);
          if (family) familyRuns(family);
        },
        () => undefined
      );
    },
    async load(summary) {
      const testNames = summary.specs.flatMap(spec => spec.tests.map(test => test.title.join(' ')));
      const family = pickRunFamily(await candidates, testNames, target.runName);
      if (!family) {
        console.warn('[neo-reporter] Run history skipped: no Azure DevOps test run matches the tests of this report.');
        return null;
      }
      return toRunHistory(summary, family, await familyRuns(family));
    }
  };
}

export async function attachRunHistory(summary: ReportSummary, loader: HistoryLoader | null | undefined): Promise<void> {
  if (!loader) return;
  try {
    const history = await Promise.race([
      loader.load(summary),
      new Promise<never>((_, reject) =>
        globalThis.setTimeout(() => reject(new Error(`timed out after ${HISTORY_TIMEOUT_MS / 1000}s`)), HISTORY_TIMEOUT_MS).unref()
      )
    ]);
    if (!history) return;
    summary.history = history;
    console.log(`[neo-reporter] Loaded ${history.runs.length} previous runs of "${history.family}" from Azure DevOps`);
  } catch (error) {
    console.warn(`[neo-reporter] Run history unavailable: ${error instanceof Error ? error.message : error}`);
  }
}
