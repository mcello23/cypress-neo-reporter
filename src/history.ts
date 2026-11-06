import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { adoCollectionUrl } from './ci';
import { historyKey } from './junit';
import { testPath } from './prompts';
import type { HistoryLoader, HistoryOptions, HistoryRun, ReportSummary, RunHistory, SpecData, TestData } from './types';

const HISTORY_RUN_COUNT = 10;
const HISTORY_MAX_WEEKS = 8;
const HISTORY_DISCOVERY_WEEKS = 2;
const HISTORY_MIN_OVERLAP = 0.3;
const HISTORY_CANDIDATE_FAMILIES = 10;
const HISTORY_CONCURRENCY = 10;
const HISTORY_TIMEOUT_MS = 180_000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const RESULTS_PAGE_SIZE = 1000;
const HISTORY_FILE_PATH = 'cypress/reports/neo-history.jsonl';
const HISTORY_FILE_LINES_PER_RUN = 5;
const STATE_CODES: Record<TestData['state'], string> = { passed: 'P', flaky: 'P', failed: 'F', pending: 'S', skipped: 'S' };

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

interface TestOutcome {
  s: string;
  d: number;
}

interface RunOutcomes {
  results: TestOutcome[];
  tests: Map<string, TestOutcome>;
}

type PastRun = Omit<HistoryRun, 'total' | 'passed' | 'failed'> & RunOutcomes;

interface HistoryLine {
  date: string;
  name: string;
  branch?: string;
  label: string;
  tests: Record<string, TestOutcome>;
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
  if (/^http:\/\//i.test(organizationUrl)) {
    console.warn(
      `[neo-reporter] The Azure DevOps address is http://, so the token goes unencrypted to ${organizationUrl}. Use https:// where the server supports it.`
    );
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

async function adoRunOutcomes(apiUrl: string, authorization: string, runId: number): Promise<RunOutcomes> {
  const outcomes: RunOutcomes = { results: [], tests: new Map() };
  for (let skip = 0; ;) {
    const { body } = await adoGet<{
      value: Array<{ automatedTestName?: string; testCaseTitle?: string; outcome: string; durationInMs?: number }>;
    }>(`${apiUrl}/test/Runs/${runId}/results?$top=${RESULTS_PAGE_SIZE}&$skip=${skip}&api-version=7.1`, authorization);
    if (body.value.length === 0) return outcomes;
    for (const result of body.value) {
      const outcome = { s: outcomeCode(result.outcome), d: result.durationInMs ?? 0 };
      outcomes.results.push(outcome);
      [result.automatedTestName, result.testCaseTitle].forEach(name => name && outcomes.tests.set(historyKey(name), outcome));
    }
    skip += body.value.length;
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
  outcomes: RunOutcomes;
}

interface FamilyRuns {
  runs: AdoRun[];
  outcomes: RunOutcomes[];
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
  const overlaps = candidates.map(({ outcomes }) => testNames.filter(name => outcomes.tests.has(name)).length / Math.max(testNames.length, 1));
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

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function toRunHistory(
  summary: ReportSummary,
  family: string,
  source: string,
  runs: PastRun[],
  key: (spec: SpecData, test: TestData) => string
): RunHistory {
  const tests: Record<string, string> = {};
  const durations: Record<string, number> = {};
  for (const spec of summary.specs) {
    for (const test of spec.tests) {
      const outcomes = runs.map(run => run.tests.get(key(spec, test)));
      const codes = outcomes.map(outcome => outcome?.s ?? '-').join('');
      if (/[PFS]/.test(codes)) tests[testPath({ spec, test })] = codes;
      const passed = outcomes.flatMap(outcome => (outcome?.s === 'P' && outcome.d > 0 ? [outcome.d] : []));
      if (passed.length > 0) durations[testPath({ spec, test })] = median(passed);
    }
  }
  return {
    family: family.trim(),
    source,
    runs: runs.map(run => ({
      id: run.id,
      label: run.label,
      date: run.date,
      total: run.results.length,
      passed: run.results.filter(result => result.s === 'P').length,
      failed: run.results.filter(result => result.s === 'F').length,
      url: run.url
    })),
    tests,
    durations
  };
}

function adoTestKey(_spec: SpecData, test: TestData): string {
  return historyKey(test.fullTitle);
}

function toAdoRunHistory(summary: ReportSummary, family: string, { runs, outcomes }: FamilyRuns): RunHistory {
  const pastRuns = runs.map((run, index) => ({
    id: run.id,
    label: run.release?.name ?? run.build?.name ?? `Run ${run.id}`,
    date: run.completedDate ?? '',
    url: run.webAccessUrl,
    ...outcomes[index]
  }));
  return toRunHistory(summary, family, 'Azure DevOps', pastRuns, adoTestKey);
}

function fileTestKey(spec: SpecData, test: TestData): string {
  return `${spec.specFile} › ${test.fullTitle}`;
}

function historyName(summary: ReportSummary): string {
  return summary.suiteLabel || summary.projectName;
}

function toHistoryLine(summary: ReportSummary): HistoryLine {
  const tests: Record<string, TestOutcome> = {};
  summary.specs.forEach(spec => spec.tests.forEach(test => (tests[fileTestKey(spec, test)] = { s: STATE_CODES[test.state], d: test.duration })));
  return {
    date: summary.timestamp,
    name: historyName(summary),
    branch: summary.ci?.branch,
    label: summary.ci?.release ?? summary.ci?.build ?? summary.ci?.commit?.slice(0, 8) ?? 'Local run',
    tests
  };
}

function toPastRun(line: HistoryLine): PastRun {
  const tests = new Map(Object.entries(line.tests));
  return { id: Date.parse(line.date), label: line.label, date: line.date, results: [...tests.values()], tests };
}

function readHistoryLines(path: string, mergedRuns: string[]): HistoryLine[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf-8')
    .split('\n')
    .flatMap(text => {
      try {
        const line = JSON.parse(text) as HistoryLine;
        return line?.tests && !mergedRuns.includes(line.date) ? [line] : [];
      } catch {
        return [];
      }
    });
}

function createFileHistoryLoader(options: HistoryOptions, projectDir: string, mergedRuns: string[]): HistoryLoader {
  const path = resolve(projectDir, options.path ?? HISTORY_FILE_PATH);
  const runs = options.runs ?? HISTORY_RUN_COUNT;
  return {
    warm() {},
    async load(summary) {
      const family = readHistoryLines(path, mergedRuns).filter(line => line.name === historyName(summary));
      const onBranch = family.filter(line => line.branch === summary.ci?.branch);
      const lines = (onBranch.length > 0 ? onBranch : family).slice(-runs);
      if (lines.length === 0) {
        console.log(`[neo-reporter] No earlier runs of "${historyName(summary)}" in ${path} yet`);
        return null;
      }
      return toRunHistory(summary, historyName(summary), basename(path), lines.map(toPastRun), fileTestKey);
    },
    record(summary) {
      const lines = [...readHistoryLines(path, mergedRuns), toHistoryLine(summary)].slice(-runs * HISTORY_FILE_LINES_PER_RUN);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, lines.map(line => `${JSON.stringify(line)}\n`).join(''), 'utf-8');
    }
  };
}

export function createBaselineHistoryLoader(baseline: ReportSummary, source: string): HistoryLoader {
  return {
    warm() {},
    async load(summary) {
      return toRunHistory(summary, historyName(baseline), source, [toPastRun(toHistoryLine(baseline))], fileTestKey);
    }
  };
}

export function createHistoryLoader(
  options: HistoryOptions | false = {},
  branch?: string,
  projectDir = process.cwd(),
  mergedRuns: string[] = []
): HistoryLoader | null {
  if (options === false) return null;
  if (options.provider === 'file') return createFileHistoryLoader(options, projectDir, mergedRuns);
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
          const family = pickRunFamily(known, [historyKey(testName)], target.runName);
          if (family) familyRuns(family);
        },
        () => undefined
      );
    },
    async load(summary) {
      const testNames = summary.specs.flatMap(spec => spec.tests.map(test => adoTestKey(spec, test)));
      const family = pickRunFamily(await candidates, testNames, target.runName);
      if (!family) {
        console.warn('[neo-reporter] Run history skipped: no Azure DevOps test run matches the tests of this report.');
        return null;
      }
      return toAdoRunHistory(summary, family, await familyRuns(family));
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
    if (history) {
      summary.history = history;
      console.log(
        `[neo-reporter] Loaded ${history.runs.length} previous run${history.runs.length === 1 ? '' : 's'} of "${history.family}"${history.source ? ` from ${history.source}` : ''}`
      );
    }
  } catch (error) {
    console.warn(`[neo-reporter] Run history unavailable: ${error instanceof Error ? error.message : error}`);
  }
  try {
    loader.record?.(summary);
  } catch (error) {
    console.warn(`[neo-reporter] Run history not saved: ${error instanceof Error ? error.message : error}`);
  }
}
