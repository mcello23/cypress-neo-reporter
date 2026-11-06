import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync, rmSync, renameSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, relative, resolve, isAbsolute, basename, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { RECORD_TASK } from './task';

export const STEPS_FILE_NAME = 'neo-reporter-steps.json';
export const SPEC_OWNERS_FILE_NAME = 'spec-owners.json';
export const DEFAULT_REPORTS_DIR = 'cypress/reports';
export const REPORT_OUTPUTS = ['html', 'json', 'junit', 'markdown'] as const;
export const MERGE_OUTPUTS = ['html', 'markdown'] as const;
const PACKAGE_ROOT = join(__dirname, '..');

export type ReportOutput = (typeof REPORT_OUTPUTS)[number];
export type ReportTheme = 'auto' | 'light' | 'dark';

export interface ReporterOptions {
  projectName?: string;
  reportName?: string;
  teamName?: string;
  showTeamName?: boolean;
  timeZone?: string;
  theme?: ReportTheme;
  outputDir?: string;
  outputs?: readonly ReportOutput[];
  history?: HistoryOptions | false;
  reportUrl?: string;
  stepsFilePath?: string;
  historyLoader?: HistoryLoader | null;
}

export type NeoReporterOptions = Omit<ReporterOptions, 'stepsFilePath' | 'historyLoader'>;

export interface MergeOptions extends NeoReporterOptions {
  reportRoot?: string;
  summaryFiles?: string[];
}

export interface RecordedTestPayload {
  fullTitle: string;
  startedAt?: string;
  attempt?: { leadMs: number; durationMs: number };
  businessGoal?: { goal: string; persona?: string } | null;
  steps: TestStep[];
  code?: string;
  firstError?: string;
  network?: NetworkFailure[];
  consoleErrors?: string[];
}

export interface NetworkFailure {
  status: number;
  url: string;
  timestamp: string;
}

type RecordedTestsMap = Record<string, Omit<RecordedTestPayload, 'fullTitle'>>;

export interface TestAttempt {
  state: string;
  error?: {
    name?: string;
    message?: string;
    stack?: string;
  } | null;
  wallClockDuration?: number;
}

export interface TestStep {
  phase: 'VISIT' | 'FIND' | 'STEP' | 'CHECK' | 'INFO' | string;
  message: string;
  timestamp?: string;
  durationMs?: number;
}

export interface TestData {
  title: string[];
  fullTitle: string;
  state: 'passed' | 'flaky' | 'failed' | 'pending' | 'skipped';
  duration: number;
  startedAt?: string;
  displayError?: string | null;
  attempts?: TestAttempt[];
  screenshots?: Array<{
    name: string;
    path: string;
    base64?: string;
  }>;
  businessGoal?: {
    goal: string;
    persona?: string;
  } | null;
  steps?: TestStep[];
  code?: string;
  video?: EmbeddedFile;
  network?: NetworkFailure[];
  consoleErrors?: string[];
}

export interface EmbeddedFile {
  name: string;
  path: string;
  base64?: string;
}

export interface SpecData {
  specFile: string;
  specName: string;
  tests: TestData[];
  video?: EmbeddedFile;
  owner?: string;
  duration: number;
  passes: number;
  failures: number;
  pending: number;
  skipped: number;
  total: number;
}

export interface CiInfo {
  branch?: string;
  commit?: string;
  commitUrl?: string;
  build?: string;
  buildUrl?: string;
  release?: string;
  releaseUrl?: string;
}

export interface HistoryRun {
  id: number;
  label: string;
  date: string;
  total: number;
  passed: number;
  failed: number;
  url?: string;
}

export interface RunHistory {
  family: string;
  runs: HistoryRun[];
  tests: Record<string, string>;
}

export interface ReportSummary {
  projectName: string;
  timestamp: string;
  browser: string;
  environment: string;
  resolution: string;
  totalDurationMs: number;
  totalSpecs: number;
  totalTests: number;
  totalPassed: number;
  totalFailed: number;
  totalPending: number;
  totalSkipped: number;
  passRate: number;
  specs: SpecData[];
  suiteLabel?: string;
  ci?: CiInfo;
  history?: RunHistory;
  teamName?: string;
  timeZone?: string;
  theme?: ReportTheme;
  mergedFrom?: number;
}

/** Rounded down, so a run with even one failure never reads as 100%. */
function computePassRate(passed: number, total: number): number {
  return Math.floor((passed / Math.max(total, 1)) * 100);
}

function deriveSuiteLabel(reportName?: string): string {
  return reportName?.trim() ?? '';
}

/**
 * Format milliseconds into human-readable duration (e.g. "5h 30m 23s", "1m 32s" or "450ms")
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
  return `${mins}m ${secs}s`;
}

export function machineTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function assertTimeZone(timeZone?: string): void {
  if (!timeZone) return;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    throw new Error(`[neo-reporter] Unknown timeZone "${timeZone}". Use an IANA name such as Europe/Paris or America/New_York.`);
  }
}

/**
 * Format an ISO timestamp in the report time zone (e.g. "2026-09-30T08:34:47")
 */
function formatTimestamp(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString('sv-SE', { timeZone, hourCycle: 'h23' }).replace(' ', 'T');
}

/**
 * Escape HTML special characters
 */
function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function toSourceSpecPath(specPath: string): string {
  return specPath.replace(/\\/g, '/');
}

/**
 * Escape XML special characters
 */
function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function firstLine(text?: string | null): string {
  return (
    (text ?? '')
      .split('\n')
      .find(line => line.trim())
      ?.trim() ?? ''
  );
}

const FILENAME_UNSAFE_CHARS = /[/?<>\\:*|"]/g;

function toScreenshotSafeName(title: string): string {
  return title.replace(FILENAME_UNSAFE_CHARS, '').toLowerCase();
}

function toEmbeddedFile(filePath: string, mimeType: string): EmbeddedFile {
  const name = basename(filePath);
  try {
    return { name, path: filePath, base64: `data:${mimeType};base64,${readFileSync(filePath).toString('base64')}` };
  } catch {
    return { name, path: filePath };
  }
}

const MAX_EMBEDDED_VIDEO_CHARS = 150 * 1024 * 1024;
const FAILED_VIDEO_CRF = 30;
const CLIP_LEAD_MS = 0;
const CLIP_TAIL_MS = 1000;
const recordedSpecVideos = new Map<string, string>();

interface VideoTools {
  ffmpeg: string;
  ffprobe: string | null;
}

function bundledBinaryPath(cypressBinaryRoot: string, pkg: string, name: string): string | null {
  const binary = process.platform === 'win32' ? `${name}.exe` : name;
  const candidate = join(cypressBinaryRoot, 'node_modules', pkg, `${process.platform}-${process.arch}`, binary);
  return existsSync(candidate) ? candidate : null;
}

function bundledVideoTools(cypressBinaryRoot: string): VideoTools | null {
  const ffmpeg = bundledBinaryPath(cypressBinaryRoot, '@ffmpeg-installer', 'ffmpeg');
  return ffmpeg ? { ffmpeg, ffprobe: bundledBinaryPath(cypressBinaryRoot, '@ffprobe-installer', 'ffprobe') } : null;
}

function readVideoDurationMs(ffprobePath: string | null, videoPath: string): number | null {
  if (!ffprobePath) return null;
  const args = ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', videoPath];
  const result = spawnSync(ffprobePath, args, { encoding: 'utf-8' });
  const seconds = Number(result.stdout?.trim());
  return result.status === 0 && seconds > 0 ? seconds * 1000 : null;
}

function runFfmpeg(ffmpegPath: string, args: string[]): boolean {
  return spawnSync(ffmpegPath, ['-y', ...args], { stdio: 'ignore' }).status === 0;
}

function cutClip(ffmpegPath: string, inputPath: string, outputPath: string, range: { start: number; end: number }): boolean {
  const seek = ['-ss', String(range.start), '-t', String(range.end - range.start)];
  return runFfmpeg(ffmpegPath, [...seek, '-i', inputPath, '-c', 'copy', outputPath]);
}

function testVideoDir(specVideoPath: string): string {
  return specVideoPath.replace(/\.mp4$/i, '');
}

function testVideoPath(specVideoPath: string, title: string[]): string {
  return join(testVideoDir(specVideoPath), `${toScreenshotSafeName(title.join(' '))}.mp4`);
}

function compressVideo(ffmpegPath: string, videoPath: string): void {
  const tmpPath = `${videoPath}.compressing.mp4`;
  if (runFfmpeg(ffmpegPath, ['-i', videoPath, '-c:v', 'libx264', '-preset', 'fast', '-crf', String(FAILED_VIDEO_CRF), tmpPath])) {
    renameSync(tmpPath, videoPath);
  } else {
    rmSync(tmpPath, { force: true });
    console.warn(`[neo-reporter] Video compression failed for ${videoPath}; keeping it uncompressed.`);
  }
}

function cutFailedTestVideos(
  tools: VideoTools,
  specVideoPath: string,
  tests: CypressCommandLine.TestResult[],
  recorded: RecordedTestsMap
): boolean {
  const testsMs = tests.reduce((sum, test) => sum + (test.duration || 0), 0);
  if (testsMs === 0) return false;
  const videoMs = readVideoDurationMs(tools.ffprobe, specVideoPath);
  const preRollMs = videoMs ? Math.max(0, videoMs - testsMs) : 0;
  const clips: Array<{ path: string; start: number; end: number }> = [];
  let elapsedMs = preRollMs;
  for (const test of tests) {
    const durationMs = test.duration || 0;
    if (test.attempts?.some(attempt => attempt.state === 'failed')) {
      const firstAttempt = test.attempts.length > 1 ? recorded[test.title.join(' › ')]?.attempt : undefined;
      const clipMs = firstAttempt ? firstAttempt.leadMs + firstAttempt.durationMs : durationMs;
      clips.push({
        path: testVideoPath(specVideoPath, test.title),
        start: Math.max(0, elapsedMs - CLIP_LEAD_MS) / 1000,
        end: (elapsedMs + clipMs + CLIP_TAIL_MS) / 1000
      });
    }
    elapsedMs += durationMs;
  }
  if (clips.length === 0) return false;
  const clipDir = testVideoDir(specVideoPath);
  mkdirSync(clipDir, { recursive: true });
  if (clips.every(clip => cutClip(tools.ffmpeg, specVideoPath, clip.path, clip))) return true;
  rmSync(clipDir, { recursive: true, force: true });
  return false;
}

function toTestState(test: CypressCommandLine.TestResult): TestData['state'] {
  const state = (test.state as TestData['state']) || 'passed';
  return state === 'passed' && test.attempts?.some(attempt => attempt.state === 'failed') ? 'flaky' : state;
}

function hasFailureEvidence(test: TestData): boolean {
  return test.state === 'failed' || test.state === 'flaky';
}

function stripEmbed(file: EmbeddedFile): EmbeddedFile {
  return { name: file.name, path: file.path };
}

function capEmbeddedVideos(specs: SpecData[]): SpecData[] {
  let embeddedChars = 0;
  const keep = (file?: EmbeddedFile): EmbeddedFile | undefined => {
    const size = file?.base64?.length ?? 0;
    if (!file || !size) return file;
    if (embeddedChars + size <= MAX_EMBEDDED_VIDEO_CHARS) {
      embeddedChars += size;
      return file;
    }
    return stripEmbed(file);
  };
  return specs.map(spec => ({
    ...spec,
    tests: spec.tests.map(t => (t.video ? { ...t, video: keep(t.video) } : t)),
    video: keep(spec.video)
  }));
}

function withoutVideos(summary: ReportSummary): ReportSummary {
  return {
    ...summary,
    specs: summary.specs.map(spec => ({
      ...spec,
      tests: spec.tests.map(t => (t.video ? { ...t, video: stripEmbed(t.video) } : t)),
      video: spec.video ? stripEmbed(spec.video) : spec.video
    }))
  };
}

function withoutEmbeds(summary: ReportSummary): ReportSummary {
  const stripped = withoutVideos(summary);
  return {
    ...stripped,
    specs: stripped.specs.map(spec => ({
      ...spec,
      tests: spec.tests.map(t => ({ ...t, screenshots: t.screenshots?.map(s => ({ name: s.name, path: s.path })) }))
    }))
  };
}

function writeReportFile(filePath: string, summary: ReportSummary, render: (summary: ReportSummary) => string): void {
  const variants: Array<[string, () => ReportSummary]> = [
    ['full', () => summary],
    ['without videos', () => withoutVideos(summary)],
    ['without videos and screenshots', () => withoutEmbeds(summary)]
  ];
  for (const [index, [label, variant]] of variants.entries()) {
    try {
      writeFileSync(filePath, render(variant()), 'utf-8');
      if (index > 0) {
        console.warn(`[neo-reporter] ${basename(filePath)} written ${label}`);
      }
      return;
    } catch (error) {
      if (index === variants.length - 1) throw error;
      console.warn(`[neo-reporter] Writing ${basename(filePath)} (${label}) failed: ${error}`);
    }
  }
}

function toProjectPath(filePath: string, projectDir: string): string {
  return isAbsolute(filePath) ? filePath : join(projectDir, filePath);
}

function readGit(projectDir: string, args: string[]): string | undefined {
  const result = spawnSync('git', args, { cwd: projectDir, encoding: 'utf-8', timeout: 5000 });
  const output = result.status === 0 ? result.stdout.trim() : '';
  return output && output !== 'HEAD' ? output : undefined;
}

function adoCollectionUrl(): string | undefined {
  const url = process.env.SYSTEM_TEAMFOUNDATIONCOLLECTIONURI || process.env.SYSTEM_COLLECTIONURI;
  return url?.replace(/\/?$/, '/');
}

function readCiInfo(projectDir: string): CiInfo {
  const env = process.env;
  const collectionUrl = adoCollectionUrl();
  const commit = env.BUILD_SOURCEVERSION || readGit(projectDir, ['rev-parse', 'HEAD']);
  return {
    branch: env.BUILD_SOURCEBRANCH?.replace(/^refs\/heads\//, '') || readGit(projectDir, ['rev-parse', '--abbrev-ref', 'HEAD']),
    commit,
    commitUrl: commit && env.BUILD_REPOSITORY_URI ? `${env.BUILD_REPOSITORY_URI}/commit/${commit}` : undefined,
    build: env.BUILD_BUILDNUMBER,
    buildUrl:
      collectionUrl && env.SYSTEM_TEAMPROJECT && env.BUILD_BUILDID
        ? `${collectionUrl}${encodeURIComponent(env.SYSTEM_TEAMPROJECT)}/_build/results?buildId=${env.BUILD_BUILDID}`
        : undefined,
    release: env.RELEASE_RELEASENAME,
    releaseUrl: env.RELEASE_RELEASEWEBURL
  };
}

export function readSpecOwners(projectDir: string, specFiles: string[]): Map<string, string> {
  const owners = new Map<string, string>();
  const baseDir = [projectDir, dirname(projectDir)].find(dir => specFiles.length > 0 && existsSync(join(dir, specFiles[0])));
  if (!baseDir || readGit(baseDir, ['rev-parse', '--is-shallow-repository']) !== 'false') return owners;
  const result = spawnSync('git', ['log', '--no-merges', '--format=%x00%an', '--name-only', '--relative', '--', ...specFiles], {
    cwd: baseDir,
    encoding: 'utf-8',
    timeout: 60_000,
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.status !== 0) return owners;
  const commitsByFile = new Map<string, Map<string, number>>();
  let author = '';
  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('\0')) {
      author = line.slice(1);
    } else if (line.trim() && author) {
      const authors = commitsByFile.get(line) ?? new Map<string, number>();
      authors.set(author, (authors.get(author) ?? 0) + 1);
      commitsByFile.set(line, authors);
    }
  }
  for (const [file, authors] of commitsByFile) {
    owners.set(file, [...authors].sort((a, b) => b[1] - a[1])[0][0]);
  }
  return owners;
}

function readSpecOwnersFile(projectDir: string): Map<string, string> | null {
  const filePath = join(projectDir, SPEC_OWNERS_FILE_NAME);
  if (!existsSync(filePath)) return null;
  try {
    return new Map(Object.entries(JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, string>));
  } catch (error) {
    console.warn(`[neo-reporter] Skipping unreadable ${filePath}: ${error}`);
    return null;
  }
}

const HISTORY_RUN_COUNT = 10;
const HISTORY_MAX_WEEKS = 8;
const HISTORY_DISCOVERY_WEEKS = 2;
const HISTORY_MIN_OVERLAP = 0.3;
const HISTORY_CANDIDATE_FAMILIES = 10;
const HISTORY_CONCURRENCY = 10;
const HISTORY_TIMEOUT_MS = 180_000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const RESULTS_PAGE_SIZE = 5000;

export interface HistoryOptions {
  provider?: 'azure-devops';
  organization?: string;
  project?: string;
  runName?: string;
  runs?: number;
  maxWeeks?: number;
}

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

export interface HistoryLoader {
  warm(testName: string): void;
  load(summary: ReportSummary): Promise<RunHistory | null>;
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

function ciSourceLine(ci?: CiInfo): string {
  return [
    ci?.branch && `Branch: ${ci.branch}`,
    ci?.commit && `Commit: ${ci.commit.slice(0, 8)}`,
    ci?.build && `Build: ${ci.build}`,
    ci?.release && `Release: ${ci.release}`
  ]
    .filter(Boolean)
    .join(' · ');
}

function packageVersion(): string {
  try {
    return (JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf-8')) as { version?: string }).version ?? '';
  } catch {
    return '';
  }
}

function readProjectName(projectDir: string): string | undefined {
  try {
    return (JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf-8')) as { name?: string }).name || undefined;
  } catch {
    return undefined;
  }
}

function readPlyrAssets(): { js: string; css: string; sprite: string } {
  const plyrDist = dirname(createRequire(join(PACKAGE_ROOT, 'package.json')).resolve('plyr/dist/plyr.css'));
  const read = (file: string) => readFileSync(join(plyrDist, file), 'utf-8');
  return {
    js: read('plyr.min.js'),
    css: read('plyr.css'),
    sprite: read('plyr.svg').replace(/<\?xml[^>]*\?>|<!DOCTYPE[^>]*>/g, '')
  };
}

function readRecordedTests(candidates: string[]): RecordedTestsMap {
  let map: RecordedTestsMap = {};
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      map = { ...map, ...(JSON.parse(readFileSync(candidate, 'utf-8')) as RecordedTestsMap) };
    } catch (error) {
      console.warn(`[neo-reporter] Skipping unreadable steps file ${candidate}: ${error}`);
    }
  }
  return map;
}

/**
 * Transform Cypress run results into a structured report summary
 */
export function buildReportSummary(
  runResults: CypressCommandLine.CypressRunResult,
  projectDir: string = process.cwd(),
  options: ReporterOptions = {}
): ReportSummary {
  const specs: SpecData[] = [];

  const stepsCandidates = [
    options.stepsFilePath,
    resolve(projectDir, options.outputDir ?? DEFAULT_REPORTS_DIR, STEPS_FILE_NAME)
  ].filter(Boolean) as string[];
  const recordedTests = readRecordedTests(stepsCandidates);

  for (const run of runResults.runs) {
    const relPath = toSourceSpecPath(relative(projectDir, run.spec.absolute));
    const specName = toSourceSpecPath(run.spec.name);

    const specVideoPath = recordedSpecVideos.get(run.spec.absolute) ?? run.video;
    const tests: TestData[] = run.tests.map(t => {
      const fullTitle = t.title.join(' › ');
      const testLeafTitle = t.title[t.title.length - 1];
      const recorded = recordedTests[fullTitle];
      const leafNeedle = toScreenshotSafeName(testLeafTitle);

      const testScreenshots = (run.screenshots ?? [])
        .map(shot => toProjectPath(shot.path, projectDir))
        .filter(shotPath => toScreenshotSafeName(basename(shotPath)).includes(leafNeedle))
        .map(shotPath => toEmbeddedFile(shotPath, 'image/png'));
      const state = toTestState(t);
      const clipPath =
        specVideoPath && (state === 'failed' || state === 'flaky')
          ? testVideoPath(toProjectPath(specVideoPath, projectDir), t.title)
          : null;

      return {
        title: t.title,
        fullTitle,
        state,
        duration: t.duration || 0,
        startedAt: recorded?.startedAt,
        displayError: recorded?.firstError ?? t.displayError,
        attempts: t.attempts,
        screenshots: testScreenshots,
        businessGoal: recorded?.businessGoal ?? null,
        steps: recorded?.steps ?? [],
        code: recorded?.code,
        video: clipPath && existsSync(clipPath) ? toEmbeddedFile(clipPath, 'video/mp4') : undefined,
        network: recorded?.network,
        consoleErrors: recorded?.consoleErrors
      };
    });

    const stats = run.stats as {
      duration?: number;
      wallClockDuration?: number;
      passes?: number;
      failures?: number;
      pending?: number;
      skipped?: number;
      tests?: number;
    };

    specs.push({
      specFile: relPath,
      specName,
      tests,
      duration: stats.wallClockDuration || stats.duration || 0,
      passes: stats.passes || 0,
      failures: stats.failures || 0,
      pending: stats.pending || 0,
      skipped: stats.skipped || 0,
      total: run.stats.tests || 0,
      video:
        specVideoPath && existsSync(toProjectPath(specVideoPath, projectDir)) && tests.some(t => hasFailureEvidence(t) && !t.video)
          ? toEmbeddedFile(toProjectPath(specVideoPath, projectDir), 'video/mp4')
          : undefined
    });
  }

  const owners =
    readSpecOwnersFile(projectDir) ??
    readSpecOwners(
      projectDir,
      specs.map(spec => spec.specFile)
    );
  specs.forEach(spec => (spec.owner = owners.get(spec.specFile)));

  const passRate = computePassRate(runResults.totalPassed || 0, runResults.totalTests || 0);
  const runConfig = runResults.config;

  return {
    projectName: options.projectName ?? readProjectName(projectDir) ?? 'Cypress',
    timestamp: new Date().toISOString(),
    browser: `${runResults.browserName ?? 'Chrome'} ${runResults.browserVersion ?? ''}`.trim(),
    environment: runConfig?.baseUrl ?? process.env.CYPRESS_BASE_URL ?? '',
    resolution: runConfig ? `${runConfig.viewportWidth} × ${runConfig.viewportHeight}` : '1920 × 1080',
    totalDurationMs: runResults.totalDuration || 0,
    totalSpecs: runResults.totalSuites || specs.length,
    totalTests: runResults.totalTests || 0,
    totalPassed: runResults.totalPassed || 0,
    totalFailed: runResults.totalFailed || 0,
    totalPending: runResults.totalPending || 0,
    totalSkipped: runResults.totalSkipped || 0,
    passRate,
    specs: capEmbeddedVideos(specs),
    suiteLabel: deriveSuiteLabel(options.reportName),
    ci: readCiInfo(projectDir),
    teamName: options.showTeamName === false ? undefined : options.teamName?.trim() || undefined,
    timeZone: options.timeZone ?? machineTimeZone(),
    theme: options.theme ?? 'auto'
  };
}

/**
 * Generate standard JUnit XML for Azure DevOps Test Results publishing
 */
export function generateJUnitXml(summary: ReportSummary): string {
  const durationSec = (summary.totalDurationMs / 1000).toFixed(3);
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<testsuites name="${escapeXml(summary.projectName)}" time="${durationSec}" tests="${summary.totalTests}" failures="${summary.totalFailed}" errors="0">\n`;

  for (const spec of summary.specs) {
    const specDurationSec = (spec.duration / 1000).toFixed(3);
    xml += `  <testsuite name="${escapeXml(spec.specName)}" file="${escapeXml(spec.specFile)}" tests="${spec.total}" failures="${spec.failures}" skipped="${spec.pending + spec.skipped}" time="${specDurationSec}" timestamp="${summary.timestamp}">\n`;

    for (const test of spec.tests) {
      const testDurationSec = (test.duration / 1000).toFixed(3);
      xml += `    <testcase name="${escapeXml(test.fullTitle)}" classname="${escapeXml(spec.specName)}" time="${testDurationSec}">\n`;

      if (test.state === 'failed') {
        const msg = firstLine(test.displayError) || 'Test failed';
        xml += `      <failure message="${escapeXml(msg)}" type="AssertionError">\n`;
        xml += escapeXml(test.displayError || msg);
        xml += `\n      </failure>\n`;
      } else if (test.state === 'pending' || test.state === 'skipped') {
        xml += `      <skipped message="Test was skipped or pending"/>\n`;
      }

      xml += `    </testcase>\n`;
    }

    xml += `  </testsuite>\n`;
  }

  xml += `</testsuites>\n`;
  return xml;
}

const AI_PROMPT_STEP_TAIL = 20;

interface FailedTest {
  spec: SpecData;
  test: TestData;
}

type PromptKind = 'failed' | 'flaky';

function collectTestsByState(summary: ReportSummary, state: PromptKind): FailedTest[] {
  return summary.specs.flatMap(spec => spec.tests.filter(test => test.state === state).map(test => ({ spec, test })));
}

function fence(text: string, lang = ''): string {
  return `\`\`\`${lang}\n${text.replace(/\n+$/, '')}\n\`\`\``;
}

/** Shared by the run-wide prompt and the per-test one, so the two never drift apart. */
const AI_PROMPT_COPY: Record<
  PromptKind,
  { subject: string; single: string; heading: string; instructions: string[]; group: string; table: string }
> = {
  failed: {
    subject: 'failures',
    single: 'one failure',
    heading: 'Failure',
    instructions: [
      '1. Classify it as TEST BUG (selector, wait, data or intercept drift), PRODUCT REGRESSION, or ENVIRONMENT/FLAKY (timeout, backend, network, session).',
      '2. State the most likely root cause, citing the exact error line and the last executed steps.',
      '3. Propose a concrete fix (file and change) or, for product issues, the evidence to report.'
    ],
    group: '4. Group failures that share one root cause.',
    table: 'Finish with a table: spec · test · classification · root cause · action.'
  },
  flaky: {
    subject: 'flaky tests (failed on the first attempt, passed on a retry)',
    single: 'one flaky test (failed on the first attempt, passed on a retry)',
    heading: 'Flaky',
    instructions: [
      '1. Explain why the first attempt failed and the retry passed, citing the exact error line and the last executed steps.',
      '2. Classify the instability as RACE (action or assertion before a request or render settled), STATE LEAK (data, session or UI left by a previous test or attempt), ENVIRONMENT (timeout, backend, network, session), or PRODUCT (intermittent app bug).',
      '3. Propose a deterministic fix (file and change): wait on the request or element that settles the race, reset the leaked state, or report the product evidence. Do not rely on retries.'
    ],
    group: '4. Group flaky tests that share one root cause.',
    table: 'Finish with a table: spec · test · classification · root cause · fix.'
  }
};

/** Run context every prompt opens with, so a prompt pasted on its own still says what ran. */
function buildPromptContext(summary: ReportSummary): string[] {
  const failed = collectTestsByState(summary, 'failed').length;
  const flaky = collectTestsByState(summary, 'flaky').length;
  const source = ciSourceLine(summary.ci);
  return [
    `Run: ${summary.projectName} · ${summary.timestamp}`,
    ...(source ? [source] : []),
    `Target: ${summary.environment || 'n/a'} · Browser: ${summary.browser} · ${summary.resolution}`,
    `Result: ${failed} failed, ${flaky} flaky of ${summary.totalTests} tests (${summary.passRate}% pass rate)`
  ];
}

type HistoryStatus = 'new' | 'known' | 'fixed';

function testHistoryCodes(summary: ReportSummary, test: TestData): string | null {
  return summary.history?.tests[test.fullTitle] ?? null;
}

function failingStreak(codes: string): number {
  return codes.length - codes.replace(/F+$/, '').length;
}

function historyStatus(summary: ReportSummary, test: TestData): HistoryStatus | null {
  if (!summary.history) return null;
  const codes = testHistoryCodes(summary, test);
  const last = codes?.replace(/-/g, '').slice(-1);
  if (test.state === 'failed') return last === 'F' ? 'known' : 'new';
  if (test.state === 'passed' && last === 'F') return 'fixed';
  return null;
}

function historySentence(summary: ReportSummary, test: TestData): string | null {
  if (!summary.history) return null;
  const codes = testHistoryCodes(summary, test);
  if (!codes) return 'No result in the previous runs (new or renamed test).';
  const runs = codes.replace(/-/g, '').length;
  const failures = codes.split('F').length - 1;
  const status = historyStatus(summary, test);
  const detail =
    status === 'known'
      ? `; also failed in the ${failingStreak(codes)} run${failingStreak(codes) === 1 ? '' : 's'} before this one (known failure)`
      : status === 'new'
        ? failures === 0
          ? '; this is a new failure'
          : '; passed in the previous run (new failure)'
        : status === 'fixed'
          ? '; failed in the previous run, passes now'
          : '';
  const tally =
    failures === 0
      ? `Passed all of the last ${runs} run${runs === 1 ? '' : 's'}`
      : `Failed ${failures} of the last ${runs} run${runs === 1 ? '' : 's'}`;
  return `${tally}${detail}.`;
}

/** Everything known about one failure: error, executed steps, test code and screenshots. */
function buildFailureBlock({ spec, test }: FailedTest, heading: string, summary?: ReportSummary): string[] {
  const lines: string[] = [
    '---',
    heading,
    `Spec: ${spec.specFile}${spec.owner ? ` (owner: ${spec.owner})` : ''}`,
    `Test: ${test.fullTitle}`,
    `Duration: ${formatDuration(test.duration)} · Attempts: ${test.attempts?.length ?? 1}`
  ];
  if (test.businessGoal) lines.push(`Business goal: ${test.businessGoal.goal}`);
  const history = summary && historySentence(summary, test);
  if (history) {
    lines.push(
      `History (${summary.history?.family}, oldest to newest: ${testHistoryCodes(summary, test) ?? 'none'}; P passed, F failed, S skipped, - not run): ${history}`
    );
  }
  lines.push('Error:', fence(test.displayError || 'No error message captured'));

  const steps = test.steps ?? [];
  if (steps.length > 0) {
    const tail = steps.slice(-AI_PROMPT_STEP_TAIL);
    const omitted = steps.length - tail.length;
    lines.push(`Executed steps${omitted > 0 ? ` (last ${tail.length} of ${steps.length})` : ''}:`);
    tail.forEach((step, i) => lines.push(`${omitted + i + 1}. [${step.phase}] ${step.message}`));
    if (test.state === 'failed') {
      const last = steps[steps.length - 1];
      lines.push(`Last step reached before the failure: ${steps.length}. [${last.phase}] ${last.message}`);
    }
  }
  if (test.network?.length) {
    lines.push('Failed requests:');
    test.network.forEach(request => lines.push(`- ${request.status} ${request.url}`));
  }
  if (test.consoleErrors?.length) {
    lines.push('Console errors:');
    test.consoleErrors.forEach(message => lines.push(`- ${message}`));
  }
  if (test.code) lines.push('Test code:', fence(test.code, 'ts'));
  if (test.screenshots?.length) lines.push(`Screenshots: ${test.screenshots.map(shot => shot.name).join(', ')}`);
  lines.push('');
  return lines;
}

/** Prompt covering every failed or every flaky test of the run, offered once at the top of the report. */
function buildAiTriagePrompt(summary: ReportSummary, kind: PromptKind): string {
  const tests = collectTestsByState(summary, kind);
  if (tests.length === 0) return '';
  const copy = AI_PROMPT_COPY[kind];
  const lines: string[] = [
    `You are a senior Cypress/TypeScript engineer triaging ${copy.subject} from an automated E2E run of ${summary.projectName}.`,
    '',
    ...buildPromptContext(summary),
    '',
    'For each test below:',
    ...copy.instructions,
    copy.group,
    copy.table,
    ''
  ];

  tests.forEach((test, idx) =>
    lines.push(...buildFailureBlock(test, `## ${copy.heading} ${idx + 1}/${tests.length} — ${test.spec.specName}`, summary))
  );

  return lines.join('\n');
}

/** Prompt for a single failed or flaky test, offered inside that test's own failure panel. */
function buildSingleTestPrompt(summary: ReportSummary, failure: FailedTest): string {
  const copy = AI_PROMPT_COPY[failure.test.state === 'flaky' ? 'flaky' : 'failed'];
  const lines: string[] = [
    `You are a senior Cypress/TypeScript engineer triaging ${copy.single} from an automated E2E run of ${summary.projectName}.`,
    '',
    ...buildPromptContext(summary),
    '',
    'For the test below:',
    ...copy.instructions,
    ''
  ];
  lines.push(...buildFailureBlock(failure, `## ${copy.heading} — ${failure.spec.specName}`, summary));
  return lines.join('\n');
}

interface FailureGroup {
  message: string;
  tests: FailedTest[];
}

function failureSignature(error?: string | null): string {
  return firstLine(error)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\d+(\.\d+)?/g, '<n>');
}

function collectFailureGroups(summary: ReportSummary): FailureGroup[] {
  const groups = new Map<string, FailureGroup>();
  for (const failure of collectTestsByState(summary, 'failed')) {
    const signature = failureSignature(failure.test.displayError);
    const group = groups.get(signature) ?? { message: firstLine(failure.test.displayError) || 'No error message captured', tests: [] };
    group.tests.push(failure);
    groups.set(signature, group);
  }
  return [...groups.values()].sort((a, b) => b.tests.length - a.tests.length);
}

function testDomId(summary: ReportSummary, { spec, test }: FailedTest): string {
  return `test-${summary.specs.indexOf(spec)}-${spec.tests.indexOf(test)}`;
}

function testSummaryLine({ spec, test }: FailedTest): string {
  return `[${test.state.toUpperCase()}] ${spec.specFile} › ${test.fullTitle} — ${firstLine(test.displayError) || 'No error message captured'}`;
}

function testPathWithOwner({ spec, test }: FailedTest, summary: ReportSummary): string {
  const isNew = historyStatus(summary, test) === 'new';
  return `${isNew ? '[NEW] ' : ''}${spec.specFile} › ${test.fullTitle}${spec.owner ? ` (${spec.owner})` : ''}`;
}

function markdownCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
}

const MARKDOWN_ROW_LIMIT = 50;

export function generateMarkdownSummary(summary: ReportSummary, reportUrl?: string): string {
  const groups = collectFailureGroups(summary);
  const flaky = collectTestsByState(summary, 'flaky');
  const failed = groups.reduce((count, group) => count + group.tests.length, 0);
  const passed = summary.totalPassed - flaky.length;
  const title = summary.suiteLabel ? `${summary.projectName} - ${summary.suiteLabel}` : summary.projectName;
  const source = ciSourceLine(summary.ci);
  const allTests = summary.specs.flatMap(spec => spec.tests);
  const historyCounts = (status: HistoryStatus) => allTests.filter(test => historyStatus(summary, test) === status).length;
  const lines = [
    `### ${failed > 0 ? '❌' : flaky.length > 0 ? '⚠️' : '✅'} ${title}`,
    '',
    `**${failed} failed · ${flaky.length} flaky · ${passed} passed** of ${summary.totalTests} tests (${summary.passRate}% pass rate) · ${formatDuration(summary.totalDurationMs)}`,
    '',
    [source, summary.environment && `Target: ${summary.environment}`, summary.teamName].filter(Boolean).join(' · ')
  ];
  if (reportUrl) lines.push('', `[📄 Open the full HTML report](${reportUrl})`);
  if (summary.history) {
    lines.push(
      '',
      `History vs the last ${summary.history.runs.length} runs of "${summary.history.family}": **${historyCounts('new')} new failures** · ${historyCounts('known')} known · ${historyCounts('fixed')} fixed`
    );
  }
  if (groups.length > 0) {
    lines.push('', '#### Failure groups', '', '| Count | Error | Tests |', '| --- | --- | --- |');
    groups
      .slice(0, MARKDOWN_ROW_LIMIT)
      .forEach(group =>
        lines.push(
          `| ${group.tests.length}× | ${markdownCell(group.message)} | ${group.tests.map(failure => markdownCell(testPathWithOwner(failure, summary))).join('<br>')} |`
        )
      );
    if (groups.length > MARKDOWN_ROW_LIMIT) lines.push('', `…and ${groups.length - MARKDOWN_ROW_LIMIT} more groups in the HTML report.`);
  }
  if (flaky.length > 0) {
    lines.push('', '#### Flaky tests', '', '| Test | First error |', '| --- | --- |');
    flaky
      .slice(0, MARKDOWN_ROW_LIMIT)
      .forEach(failure =>
        lines.push(
          `| ${markdownCell(testPathWithOwner(failure, summary))} | ${markdownCell(firstLine(failure.test.displayError) || 'No error message captured')} |`
        )
      );
    if (flaky.length > MARKDOWN_ROW_LIMIT) lines.push('', `…and ${flaky.length - MARKDOWN_ROW_LIMIT} more flaky tests in the HTML report.`);
  }
  return lines.join('\n') + '\n';
}

function writeMarkdownSummary(filePath: string, summary: ReportSummary, reportUrl?: string): void {
  writeFileSync(filePath, generateMarkdownSummary(summary, reportUrl), 'utf-8');
  if (process.env.TF_BUILD) console.log(`##vso[task.uploadsummary]${filePath}`);
}

function buildRunSummaryText(summary: ReportSummary, title: string, groups: FailureGroup[]): string {
  const flaky = collectTestsByState(summary, 'flaky');
  const failed = groups.reduce((count, group) => count + group.tests.length, 0);
  const source = ciSourceLine(summary.ci);
  const lines = [`${title}: ${failed} failed, ${flaky.length} flaky of ${summary.totalTests} tests (${summary.passRate}% pass rate)`];
  if (source) lines.push(source);
  for (const group of groups) {
    lines.push('', `${group.tests.length}× ${group.message}`);
    group.tests.forEach(failure => lines.push(`  - ${testPathWithOwner(failure, summary)}`));
  }
  if (flaky.length > 0) {
    lines.push('', 'Flaky:');
    flaky.forEach(failure => lines.push(`  - ${testPathWithOwner(failure, summary)}`));
  }
  return lines.join('\n');
}

const STATUS_LABELS: Record<TestData['state'], string> = {
  passed: 'Passed',
  failed: 'Failed',
  flaky: 'Flaky',
  pending: 'Skipped',
  skipped: 'Skipped'
};

/**
 * Icons repeated on every test row. They are drawn once in the page (iconSprite) and referenced with <use>,
 * because thousands of inline copies made up a third of the test list's size.
 */
const ROW_ICONS: Record<string, string> = {
  'status-failed': `<circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M15 9l-6 6M9 9l6 6" stroke="#FFF" stroke-width="2.5" stroke-linecap="round"/>`,
  'status-passed': `<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 12.5l2.7 2.7L16.5 9.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`,
  'status-flaky': `<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2a10 10 0 0 1 0 20z" fill="currentColor"/>`,
  'status-pending': `<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3.5 3"/>`,
  'status-skipped': `<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3.5 3"/>`,
  link: `<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>`,
  steps: `<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>`
};

function iconSprite(): string {
  return `<svg>${Object.entries(ROW_ICONS)
    .map(([id, shapes]) => `<symbol id="icon-${id}" viewBox="0 0 24 24">${shapes}</symbol>`)
    .join('')}</svg>`;
}

function statusIcon(state: TestData['state']): string {
  return `<svg class="status-icon status-${state}" viewBox="0 0 24 24" role="img" aria-label="${STATUS_LABELS[state]}"><title>${STATUS_LABELS[state]}</title><use href="#icon-status-${state}"/></svg>`;
}

/**
 * Steps, screenshots and recordings are written as data blocks after the page script, so the report can be used
 * as soon as the test list is in, while the heavy part still downloads. The page fills a test in when it is opened.
 * The order follows how the report is used: open Failures, then open each test for its screenshots and video.
 * Steps of passing tests are rarely opened, so they come last.
 */
const PAYLOAD_ORDER = ['failureSteps', 'screenshots', 'videos', 'steps'] as const;
type PayloadKind = (typeof PAYLOAD_ORDER)[number];

function dataBlock(id: string, content: string): string {
  return `<script type="application/octet-stream" id="${id}">${content}</script>`;
}

/** JSON inside a script tag must never contain "</script" or "<!--", so every "<" is escaped. */
function scriptSafeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/**
 * Generate the interactive HTML report
 */
export function generateHtmlReport(summary: ReportSummary): string {
  const suiteLabel = summary.suiteLabel ?? '';
  const pageTitle = suiteLabel ? `${summary.projectName} - ${suiteLabel}` : summary.projectName;
  const timeZone = summary.timeZone ?? machineTimeZone();
  const teamName = summary.teamName?.trim();
  const theme = summary.theme ?? 'auto';
  const version = packageVersion();
  const downloadFileName = `${pageTitle.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')}.html`;
  const formattedDuration = formatDuration(summary.totalDurationMs);
  const formattedDate = new Date(summary.timestamp).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone
  });

  const failedTests = collectTestsByState(summary, 'failed');
  const flakyTests = collectTestsByState(summary, 'flaky');
  const flakyCount = summary.specs.reduce((count, spec) => count + spec.tests.filter(t => t.state === 'flaky').length, 0);
  const plyrAssets = summary.specs.some(spec => spec.video?.base64 || spec.tests.some(t => t.video?.base64)) ? readPlyrAssets() : null;
  const aiPrompt = buildAiTriagePrompt(summary, 'failed');
  const aiFlakyPrompt = buildAiTriagePrompt(summary, 'flaky');
  const copyIconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
  const linkIconSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="#icon-link"/></svg>`;
  const failureGroups = collectFailureGroups(summary);

  const groupIndexByTest = new Map<TestData, number>();
  failureGroups.forEach((group, idx) => group.tests.forEach(({ test }) => groupIndexByTest.set(test, idx + 1)));

  const payloads: Record<PayloadKind, string[]> = { failureSteps: [], screenshots: [], steps: [], videos: [] };
  // The history dots of a test are drawn when it is opened; with a dot per run on every row they were a third of the test list.
  const historyRunTitles = (summary.history?.runs ?? []).map(
    run => `${run.label} · ${run.date ? formatTimestamp(run.date, timeZone).slice(0, 10) : ''}`
  );

  // Generate Waterfall Bar items
  const maxSpecDuration = Math.max(...summary.specs.map(s => s.duration), 1);
  const waterfallBarsHtml = summary.specs
    .map(spec => {
      const pct = Math.max(8, Math.round((spec.duration / maxSpecDuration) * 100));
      const hasFail = spec.failures > 0;
      const hasFlaky = !hasFail && spec.tests.some(t => t.state === 'flaky');
      const barColor = hasFail ? 'var(--color-fail)' : hasFlaky ? 'var(--color-flaky)' : 'var(--color-pass)';
      return `
      <div class="waterfall-row" onclick="filterBySpec('${escapeHtml(spec.specName)}')">
        <div class="waterfall-label" title="${escapeHtml(spec.specName)}">
          ${escapeHtml(spec.specName)}
        </div>
        <div class="waterfall-track">
          <div class="waterfall-fill" style="width: ${pct}%; background: ${barColor};">
            <span class="waterfall-time">${formatDuration(spec.duration)}</span>
          </div>
        </div>
        <div class="waterfall-badge ${hasFail ? 'badge-fail' : hasFlaky ? 'badge-flaky' : 'badge-pass'}">
          ${spec.passes}/${spec.total}
        </div>
      </div>
    `;
    })
    .join('\n');

  // Generate Spec cards
  const specCardsHtml = summary.specs
    .map((spec, specIdx) => {
      const hasFailures = spec.failures > 0;
      const specFlakyCount = spec.tests.filter(t => t.state === 'flaky').length;
      const statusBadge = hasFailures
        ? `<span class="badge badge-fail"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> ${spec.failures} FAILED</span>`
        : specFlakyCount > 0
          ? `<span class="badge badge-flaky"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> ${specFlakyCount} FLAKY</span>`
          : `<span class="badge badge-pass"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> PASSED</span>`;

      const testsHtml = spec.tests
        .map((t, testIdx) => {
          const isFail = t.state === 'failed';
          const isFlaky = t.state === 'flaky';
          const stateBadge = statusIcon(t.state);
          const attemptCount = t.attempts?.length ?? 1;
          const flakyTag = isFlaky
            ? `<span class="flaky-tag" title="Failed on attempt 1, passed on attempt ${attemptCount}">Flaky</span>`
            : '';
          const testHistoryStatus = historyStatus(summary, t);
          const historyCodes = testHistoryCodes(summary, t);
          const historyTag =
            testHistoryStatus === 'new'
              ? `<span class="history-tag history-tag-new" title="${escapeHtml(historySentence(summary, t) ?? '')}">New failure</span>`
              : testHistoryStatus === 'known'
                ? `<span class="history-tag history-tag-known" title="${escapeHtml(historySentence(summary, t) ?? '')}">Failing ${failingStreak(historyCodes ?? '') + 1}×</span>`
                : testHistoryStatus === 'fixed'
                  ? `<span class="history-tag history-tag-fixed" title="${escapeHtml(historySentence(summary, t) ?? '')}">Fixed</span>`
                  : '';
          const historyStripHtml =
            summary.history && historyCodes
              ? `
            <div class="history-strip">
              <span class="history-strip-label">Last ${summary.history.runs.length} runs</span>
              <span class="history-dots" data-codes="${historyCodes}" data-current="${isFail ? 'F' : t.state === 'passed' || isFlaky ? 'P' : 'S'}" data-current-label="${STATUS_LABELS[t.state]}"></span>
              <span class="history-strip-text">${escapeHtml(historySentence(summary, t) ?? '')}</span>
            </div>`
              : '';

          const stepsCount = t.steps?.length ?? 0;
          const stepsBadge =
            stepsCount > 0 ? `<span class="steps-chip" title="${stepsCount} executed test steps">${stepsCount} steps</span>` : '';

          const businessGoalHtml = t.businessGoal
            ? `
            <div class="business-goal-card">
              <div class="goal-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6366F1" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
              </div>
              <div class="goal-body">
                <div class="goal-persona">${escapeHtml(t.businessGoal.persona ?? 'Business User')} · Business Objective</div>
                <div class="goal-text">${escapeHtml(t.businessGoal.goal)}</div>
              </div>
            </div>
          `
            : '';

          if (stepsCount > 0) {
            const steps = t.steps?.map(({ phase, message, durationMs }) => ({ phase, message, durationMs }));
            payloads[hasFailureEvidence(t) ? 'failureSteps' : 'steps'].push(
              dataBlock(`steps-data-${specIdx}-${testIdx}`, scriptSafeJson(steps))
            );
          }
          if (t.video?.base64) payloads.videos.push(dataBlock(`test-video-${specIdx}-${testIdx}`, t.video.base64));
          const stepsListHtml =
            stepsCount > 0
              ? `
            <div class="steps-section" id="steps-${specIdx}-${testIdx}">
              <button type="button" class="steps-section-header" aria-expanded="false" aria-controls="steps-body-${specIdx}-${testIdx}" onclick="toggleSteps('steps-${specIdx}-${testIdx}')">
                <span class="steps-section-title">
                  <span class="steps-toggle-chevron">&#9654;</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="#icon-steps"/></svg>
                  Execution Steps (${stepsCount})
                </span>
                <span class="steps-section-sub">Sequential action log</span>
              </button>
              <div class="test-steps-timeline" id="steps-body-${specIdx}-${testIdx}" data-steps-id="steps-data-${specIdx}-${testIdx}"${isFail ? ' data-failed' : ''}></div>
            </div>
          `
              : `
            <div class="steps-section-empty">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
              <span>All Cypress DOM assertions and network validations passed cleanly.</span>
            </div>
          `;

          const failureDetailsHtml = hasFailureEvidence(t)
            ? `
          <div class="test-error-box${isFlaky ? ' flaky' : ''}">
            ${isFlaky ? `<div class="flaky-note">Failed on attempt 1, passed on attempt ${attemptCount}. Error, screenshots and recording below are from the first failure.</div>` : ''}
            <div class="error-header">
              <span class="error-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>
              <strong>${escapeHtml(firstLine(t.displayError) || 'Assertion Failure')}</strong>
              <button class="btn-action btn-action-sm error-copy-btn" data-copy="${escapeHtml(testSummaryLine({ spec, test: t }))}" onclick="copyDataText(this)">${copyIconSvg}<span class="copy-label">Copy summary</span></button>
            </div>
            ${t.displayError ? `<pre class="error-stack"><code>${escapeHtml(t.displayError)}</code></pre>` : ''}
            ${
              t.network?.length || t.consoleErrors?.length
                ? `<details class="test-code test-diagnostics" open><summary>Failed requests & console errors (${(t.network?.length ?? 0) + (t.consoleErrors?.length ?? 0)})</summary><ul class="diagnostics-list">${(
                    t.network ?? []
                  )
                    .map(
                      request =>
                        `<li><span class="diagnostic-status">${request.status}</span><code>${escapeHtml(request.url)}</code><span class="diagnostic-time">${formatTimestamp(request.timestamp, timeZone)}</span></li>`
                    )
                    .join(
                      ''
                    )}${(t.consoleErrors ?? []).map(message => `<li><span class="diagnostic-status diagnostic-console">console</span><code>${escapeHtml(message)}</code></li>`).join('')}</ul></details>`
                : ''
            }
            ${t.code ? `<details class="test-code"><summary>Test code</summary><pre class="error-stack"><code>${escapeHtml(t.code)}</code></pre></details>` : ''}
            <div class="test-ai-prompt">
              <div class="test-ai-prompt-header">
                <span class="test-ai-prompt-title">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" stroke-width="2"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 17l.7 2.3L22 20l-2.3.7L19 23l-.7-2.3L16 20l2.3-.7z"/></svg>
                  ${isFlaky ? 'AI Flaky Triage Prompt' : 'AI Triage Prompt'} for this test
                </span>
                <button class="btn-action btn-action-sm" onclick="copyAiPrompt(this, 'test-prompt-${specIdx}-${testIdx}')">${copyIconSvg}<span class="ai-copy-label">Copy prompt</span></button>
              </div>
              <details class="ai-prompt-details">
                <summary>Preview and edit before copying</summary>
                <textarea id="test-prompt-${specIdx}-${testIdx}" class="ai-prompt-text test-ai-prompt-text" spellcheck="false">${escapeHtml(
                  buildSingleTestPrompt(summary, { spec, test: t })
                )}</textarea>
              </details>
            </div>
            ${
              t.screenshots && t.screenshots.length > 0
                ? `
              <div class="screenshot-evidence">
                <div class="evidence-title">Automated Failure Evidence:</div>
                <div class="screenshot-gallery">
                  ${t.screenshots
                    .map((s, shotIdx) => {
                      const mediaId = `shot-${specIdx}-${testIdx}-${shotIdx}`;
                      if (s.base64) payloads.screenshots.push(dataBlock(mediaId, s.base64));
                      return `
                    <div class="screenshot-thumbnail-wrap" data-caption="${escapeHtml(t.fullTitle)}" onclick="openLightbox(this.querySelector('img').src, this.dataset.caption)">
                      <img ${s.base64 ? `data-media-id="${mediaId}"` : `src="${escapeHtml(s.path)}"`} alt="${escapeHtml(s.name)}" class="screenshot-thumb" />
                      ${s.base64 ? '<div class="media-loader"><span class="media-spinner"></span>Loading screenshot…</div>' : ''}
                      <div class="zoom-overlay"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg> Click to Zoom</div>
                    </div>
                  `;
                    })
                    .join('')}
                </div>
              </div>
            `
                : ''
            }
            ${
              t.video?.base64
                ? `
              <div class="video-evidence">
                <div class="evidence-title">Test Recording:</div>
                <div class="video-player" data-video-id="test-video-${specIdx}-${testIdx}"></div>
              </div>
            `
                : t.video
                  ? `
              <div class="video-evidence">
                <div class="evidence-title">Test Recording:</div>
                <div>${escapeHtml(t.video.name)} is not embedded (report size limit); see the run's videos folder.</div>
              </div>
            `
                  : spec.video?.base64
                    ? `
              <div class="video-evidence">
                <div class="evidence-title">Spec Recording:</div>
                <div class="video-player" data-video-id="spec-video-${specIdx}"></div>
              </div>
            `
                    : spec.video
                      ? `
              <div class="video-evidence">
                <div class="evidence-title">Spec Recording:</div>
                <div>${escapeHtml(spec.video.name)} is not embedded (report size limit); see the run's videos folder.</div>
              </div>
            `
                      : ''
            }
          </div>
        `
            : '';

          return `
          <div class="test-row state-${t.state}" data-state="${t.state}" data-title="${escapeHtml(t.fullTitle.toLowerCase())}" data-error="${escapeHtml(firstLine(t.displayError).toLowerCase())}" data-group="${groupIndexByTest.get(t) ?? ''}" data-history="${testHistoryStatus ?? ''}">
            <div class="test-row-main" onclick="toggleTestDetails('test-${specIdx}-${testIdx}')">
              <div class="test-state-col">
                ${stateBadge}
              </div>
              <div class="test-title-col">
                <div class="test-title-text">${escapeHtml(t.title[t.title.length - 1])}</div>
                ${t.title.length > 1 ? `<div class="test-suite-crumbs">${escapeHtml(t.title.slice(0, -1).join(' › '))}</div>` : ''}
              </div>
              <div class="test-duration-col">
                ${historyTag}
                ${flakyTag}
                ${stepsBadge}
                ${t.startedAt ? `<span class="started-at-chip" title="Test started at (${escapeHtml(timeZone)})">${formatTimestamp(t.startedAt, timeZone)}</span>` : ''}
                <span class="duration-chip">${formatDuration(t.duration)}</span>
                <button type="button" class="test-link-btn" title="Copy a link that opens this test" onclick="copyTestLink(event, this, 'test-${specIdx}-${testIdx}')">${linkIconSvg}<span class="copy-label">Link</span></button>
                <span class="chevron-arrow" id="chevron-test-${specIdx}-${testIdx}">▼</span>
              </div>
            </div>
            <div id="test-${specIdx}-${testIdx}" class="test-details-drawer">
              ${historyStripHtml}
              ${businessGoalHtml}
              ${stepsListHtml}
              ${failureDetailsHtml}
            </div>
          </div>
        `;
        })
        .join('\n');
      if (spec.video?.base64) payloads.videos.push(dataBlock(`spec-video-${specIdx}`, spec.video.base64));

      return `
      <div class="spec-card ${hasFailures ? 'spec-has-failure' : specFlakyCount > 0 ? 'spec-has-flaky' : ''}" data-spec-name="${escapeHtml(spec.specName.toLowerCase())}" data-owner="${escapeHtml((spec.owner ?? '').toLowerCase())}">
        <div class="spec-card-header" onclick="toggleSpecCollapse('spec-body-${specIdx}')">
          <div class="spec-title-group">
            <span class="spec-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span>
            <div class="spec-title-box">
              <span class="spec-name-row">
                <span class="spec-tag">SPEC</span>
                <span class="spec-name">${escapeHtml(spec.specName)}</span>
              </span>
              <button type="button" class="spec-path" title="Copy spec path" data-path="${escapeHtml(spec.specFile)}" onclick="copySpecPath(event, this)"><span class="spec-path-label">${escapeHtml(spec.specFile)}</span>${copyIconSvg}</button>
            </div>
          </div>
          <div class="spec-meta-group">
            ${spec.owner ? `<span class="spec-owner-badge" title="Author with the most commits to this spec">${escapeHtml(spec.owner)}</span>` : ''}
            <span class="spec-time-badge">${formatDuration(spec.duration)}</span>
            <span class="spec-count-badge">${spec.passes}/${spec.total} passed</span>
            ${statusBadge}
            <span class="collapse-chevron" id="chevron-spec-body-${specIdx}">▼</span>
          </div>
        </div>
        <div class="spec-card-body" id="spec-body-${specIdx}" style="display: none">
          ${testsHtml}
        </div>
      </div>
    `;
    })
    .join('\n')
    // Template indentation was a quarter of a big report. Every text value is escaped, so ">  <" is always between tags.
    .replace(/>\s+</g, '>\n<');

  const ci = summary.ci ?? {};
  const runMetaItems: Array<[string, string | undefined, string | undefined]> = [
    ['Branch', ci.branch, undefined],
    ['Commit', ci.commit?.slice(0, 8), ci.commitUrl],
    ['Build', ci.build, ci.buildUrl],
    ['Release', ci.release, ci.releaseUrl]
  ];
  const renderRunMeta = (items: typeof runMetaItems) =>
    items
      .filter(([, value]) => value)
      .map(([label, value, url]) => {
        const text = `<span class="run-meta-label">${label}</span> ${escapeHtml(value ?? '')}`;
        return url
          ? `<a class="run-meta-item" href="${escapeHtml(url)}" target="_blank" rel="noopener">${text}</a>`
          : `<span class="run-meta-item">${text}</span>`;
      })
      .join('');
  const runMetaHtml = renderRunMeta(runMetaItems.slice(0, 2));
  const buildMetaHtml = renderRunMeta(runMetaItems.slice(2));

  const passedCount = summary.totalPassed - flakyCount;
  const skippedCount = summary.totalPending + summary.totalSkipped;
  const outcomeSegments: Array<{ state: TestData['state']; filter: string; count: number; label: string }> = [
    { state: 'passed', filter: 'passed', count: passedCount, label: 'passed' },
    { state: 'failed', filter: 'failed', count: failedTests.length, label: 'failed' },
    { state: 'flaky', filter: 'flaky', count: flakyCount, label: 'flaky' },
    { state: 'pending', filter: 'pending', count: skippedCount, label: 'skipped' }
  ];
  const topCountsHtml = outcomeSegments
    .filter(segment => segment.count > 0 || segment.state === 'failed' || segment.state === 'passed')
    .map(
      segment =>
        `<button type="button" class="top-count count-${segment.state}" onclick="setFilter('${segment.filter}')">${statusIcon(segment.state)}<strong>${segment.count}</strong> ${segment.label}</button>`
    )
    .join('');
  const outcomeBarHtml = `
      <div class="outcome-bar" role="img" aria-label="${outcomeSegments.map(segment => `${segment.count} ${segment.label}`).join(', ')}">
        ${outcomeSegments
          .filter(segment => segment.count > 0)
          .map(
            segment =>
              `<span class="outcome-segment segment-${segment.state}" style="flex-grow: ${segment.count}" title="${segment.count} ${segment.label}"></span>`
          )
          .join('')}
      </div>
      <div class="outcome-legend">
        ${outcomeSegments
          .map(
            segment =>
              `<button type="button" class="outcome-legend-item count-${segment.state}" onclick="setFilter('${segment.filter}')"><strong>${segment.count}</strong> ${segment.label}</button>`
          )
          .join('')}
      </div>`;

  const statCells: Array<{ label: string; value: string; sub: string; tone?: string; accent: string }> = [
    {
      accent: failedTests.length ? 'fail' : 'pass',
      tone: failedTests.length ? 'failed' : 'passed',
      label: 'Pass rate',
      value: `${summary.passRate}%`,
      sub: `${summary.totalPassed} of ${summary.totalTests} passed${flakyCount ? ` · ${flakyCount} on a retry` : ''}`
    },
    {
      accent: failedTests.length ? 'fail' : 'neutral',
      label: 'Failed',
      value: String(failedTests.length),
      sub: !failedTests.length
        ? 'None this run'
        : summary.history
          ? `${failedTests.filter(({ test }) => historyStatus(summary, test) === 'new').length} new · ${failedTests.filter(({ test }) => historyStatus(summary, test) === 'known').length} known`
          : `${failureGroups.length} distinct error${failureGroups.length === 1 ? '' : 's'}`,
      tone: failedTests.length ? 'failed' : undefined
    },
    {
      accent: flakyCount ? 'flaky' : 'neutral',
      label: 'Flaky',
      value: String(flakyCount),
      sub: flakyCount ? 'Passed on a retry' : 'None this run',
      tone: flakyCount ? 'flaky' : undefined
    },
    {
      accent: 'brand',
      label: 'Tests',
      value: String(summary.totalTests),
      sub: `${summary.totalSpecs} specs${skippedCount ? ` · ${skippedCount} skipped` : ''}`
    },
    { accent: 'time', label: 'Duration', value: formattedDuration, sub: `${summary.browser} · ${summary.resolution}` }
  ];
  const statStripHtml = statCells
    .map(
      cell => `
        <div class="stat-cell accent-${cell.accent}">
          <div class="stat-label">${cell.label}</div>
          <div class="stat-value${cell.tone ? ` stat-${cell.tone}` : ''}">${escapeHtml(cell.value)}</div>
          <div class="stat-sub">${escapeHtml(cell.sub)}</div>
        </div>`
    )
    .join('');

  const emptyState = (text: string) => `<p class="empty-state">${text}</p>`;

  const panelIcons = {
    groups: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
    ai: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 17l.7 2.3L22 20l-2.3.7L19 23l-.7-2.3L16 20l2.3-.7z"/>',
    owners:
      '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    bars: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>'
  };
  const panelTitle = (title: string, icon: string) =>
    `<h2 class="panel-title"><svg class="panel-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>${title}</h2>`;

  const panel = (title: string, icon: string, accent: string, meta: string, body: string, extraClass = '') => `
        <section class="panel accent-${accent}${extraClass}">
          <div class="panel-header">
            ${panelTitle(title, icon)}
            <div class="panel-meta">${meta}</div>
          </div>
          ${body}
        </section>`;

  const GROUP_TESTS_SHOWN = 5;
  const failureGroupsPanelHtml = panel(
    'Failure groups',
    panelIcons.groups,
    failureGroups.length ? 'fail' : 'neutral',
    failureGroups.length
      ? `${failedTests.length} failure${failedTests.length === 1 ? '' : 's'} · ${failureGroups.length} distinct error${failureGroups.length === 1 ? '' : 's'} <button class="btn-action btn-action-sm" data-copy="${escapeHtml(buildRunSummaryText(summary, pageTitle, failureGroups))}" onclick="copyDataText(this)">${copyIconSvg}<span class="copy-label">Copy summary</span></button>`
      : '',
    failureGroups.length
      ? `<div class="failure-groups">${failureGroups
          .map(
            (group, idx) => `
            <div class="failure-group">
              <button type="button" class="failure-group-header" title="Show only these failures" onclick="showGroup(${idx + 1})">
                <span class="failure-group-count">${group.tests.length}×</span>
                <code class="failure-group-message">${escapeHtml(group.message)}</code>
              </button>
              <div class="failure-group-tests">${group.tests
                .slice(0, GROUP_TESTS_SHOWN)
                .map(
                  failure =>
                    `<button type="button" class="test-jump" onclick="openTest('${testDomId(summary, failure)}')"><span class="test-jump-spec">${escapeHtml(failure.spec.specName)}</span> › ${escapeHtml(failure.test.fullTitle)}${failure.spec.owner ? `<span class="test-jump-owner"> · ${escapeHtml(failure.spec.owner)}</span>` : ''}</button>`
                )
                .join('')}${
                group.tests.length > GROUP_TESTS_SHOWN
                  ? `<button type="button" class="test-jump test-jump-more" onclick="showGroup(${idx + 1})">and ${group.tests.length - GROUP_TESTS_SHOWN} more…</button>`
                  : ''
              }</div>
            </div>`
          )
          .join('')}</div>`
      : emptyState('No failures this run.'),
    ' panel-wide'
  );

  const slowestTests = summary.specs
    .flatMap(spec => spec.tests.filter(test => test.duration > 0).map(test => ({ spec, test })))
    .sort((a, b) => b.test.duration - a.test.duration)
    .slice(0, 5);
  const slowestSpecs = [...summary.specs].sort((a, b) => b.duration - a.duration).slice(0, 5);
  const specState = (spec: SpecData): TestData['state'] =>
    spec.failures > 0 ? 'failed' : spec.tests.some(t => t.state === 'flaky') ? 'flaky' : 'passed';

  const slowestTestsPanelHtml = panel(
    'Slowest tests',
    panelIcons.clock,
    'time',
    '',
    slowestTests.length
      ? `<div class="panel-list">${slowestTests
          .map(
            failure =>
              `<button type="button" class="panel-row" title="${escapeHtml(`${failure.spec.specName} › ${failure.test.fullTitle}`)}" onclick="openTest('${testDomId(summary, failure)}')">${statusIcon(failure.test.state)}<span class="panel-row-name">${escapeHtml(failure.test.title[failure.test.title.length - 1])}</span><span class="panel-row-value">${formatDuration(failure.test.duration)}</span></button>`
          )
          .join('')}</div>`
      : emptyState('No timed tests this run.'),
    ' panel-half'
  );

  const slowestSpecsPanelHtml = panel(
    'Slowest specs',
    panelIcons.clock,
    'time',
    '',
    slowestSpecs.length
      ? `<div class="panel-list">${slowestSpecs
          .map(
            spec =>
              `<button type="button" class="panel-row" title="${escapeHtml(spec.specFile)}" onclick="filterBySpec('${escapeHtml(spec.specName)}')">${statusIcon(specState(spec))}<span class="panel-row-name">${escapeHtml(spec.specName)}</span><span class="panel-row-value">${formatDuration(spec.duration)}</span></button>`
          )
          .join('')}</div>`
      : emptyState('No specs ran.'),
    ' panel-half'
  );

  const ownerCounts = new Map<string, { failed: number; flaky: number }>();
  for (const { spec, test } of [...failedTests, ...flakyTests]) {
    if (!spec.owner) continue;
    const counts = ownerCounts.get(spec.owner) ?? { failed: 0, flaky: 0 };
    if (test.state === 'failed') counts.failed++;
    else counts.flaky++;
    ownerCounts.set(spec.owner, counts);
  }
  const hasOwners = summary.specs.some(spec => spec.owner);
  const ownersPanelHtml = panel(
    'Owners',
    panelIcons.owners,
    'brand',
    hasOwners ? 'failed · flaky' : '',
    ownerCounts.size
      ? `<div class="panel-list">${[...ownerCounts]
          .sort((a, b) => b[1].failed - a[1].failed || b[1].flaky - a[1].flaky)
          .map(
            ([owner, counts]) =>
              `<button type="button" class="panel-row" onclick="searchAll('owner:&quot;${escapeHtml(owner.toLowerCase())}&quot;')"><span class="panel-row-name">${escapeHtml(owner)}</span><span class="panel-row-value"><span class="count-failed">${counts.failed}</span> · <span class="count-flaky">${counts.flaky}</span></span></button>`
          )
          .join('')}</div>`
      : emptyState(
          hasOwners ? 'No failed or flaky tests this run.' : 'No owner data: git history was not available when the report was built.'
        ),
    ' panel-owners'
  );

  const aiPanel = (kind: PromptKind, prompt: string, count: number) =>
    panel(
      kind === 'flaky' ? 'AI flaky triage' : 'AI failure triage',
      panelIcons.ai,
      kind === 'flaky' ? 'flaky' : 'ai',
      prompt
        ? `<button class="btn-action btn-action-sm" onclick="copyAiPrompt(this, '${kind === 'flaky' ? 'aiFlakyPromptText' : 'aiPromptText'}')">${copyIconSvg}<span class="ai-copy-label">Copy prompt</span></button>`
        : '',
      prompt
        ? `<p class="panel-text">${count} ${kind === 'flaky' ? `flaky test${count === 1 ? '' : 's'}` : `failure${count === 1 ? '' : 's'}`} · ${(prompt.length / 1000).toFixed(1)}k chars · paste into Claude, Copilot or ChatGPT.</p>
          <details class="ai-prompt-details">
            <summary>Preview and edit before copying</summary>
            <textarea id="${kind === 'flaky' ? 'aiFlakyPromptText' : 'aiPromptText'}" class="ai-prompt-text" spellcheck="false">${escapeHtml(prompt)}</textarea>
          </details>`
        : emptyState(kind === 'flaky' ? 'No flaky tests this run.' : 'No failures to triage.'),
      ' panel-ai'
    );

  const allTestsWithSpec = summary.specs.flatMap(spec => spec.tests.map(test => ({ spec, test })));
  const testsWithStatus = (status: HistoryStatus) => allTestsWithSpec.filter(({ test }) => historyStatus(summary, test) === status);

  const testRowButton = (failure: FailedTest, value: string) =>
    `<button type="button" class="panel-row" title="${escapeHtml(`${failure.spec.specName} › ${failure.test.fullTitle}`)}" onclick="openTest('${testDomId(summary, failure)}')">${statusIcon(failure.test.state)}<span class="panel-row-name">${escapeHtml(failure.test.title[failure.test.title.length - 1])}</span><span class="panel-row-value">${value}</span></button>`;

  const historyListPanel = (
    title: string,
    accent: string,
    items: FailedTest[],
    value: (failure: FailedTest) => string,
    empty: string,
    meta = ''
  ) =>
    panel(
      title,
      panelIcons.clock,
      accent,
      meta || (items.length ? String(items.length) : ''),
      items.length ? `<div class="panel-list">${items.map(item => testRowButton(item, value(item))).join('')}</div>` : emptyState(empty)
    );

  const history = summary.history;
  const trendPoints = [
    ...(history?.runs ?? []).map(run => ({
      label: run.label,
      failed: run.failed,
      total: run.total,
      date: run.date,
      url: run.url,
      current: false
    })),
    { label: 'This run', failed: failedTests.length, total: summary.totalTests, date: summary.timestamp, url: undefined, current: true }
  ];
  const maxTrendFailed = Math.max(1, ...trendPoints.map(point => point.failed));
  const historyPanelsHtml = history
    ? `${panel(
        'Run history',
        panelIcons.bars,
        'brand',
        `Failed tests per run · last ${history.runs.length} runs of “${escapeHtml(history.family)}” in Azure DevOps`,
        `<div class="trend-chart">${trendPoints
          .map(point => {
            const body = `<span class="trend-value">${point.failed}</span><span class="trend-track"><span class="trend-bar" style="height: ${Math.max(3, Math.round((point.failed / maxTrendFailed) * 100))}%"></span></span><span class="trend-label">${escapeHtml(point.label)}</span>`;
            const tooltip = escapeHtml(
              `${point.label} · ${point.date ? formatTimestamp(point.date, timeZone).slice(0, 10) : ''} · ${point.failed} failed of ${point.total}`
            );
            return point.url
              ? `<a class="trend-col" href="${escapeHtml(point.url)}" target="_blank" rel="noopener" title="${tooltip}">${body}</a>`
              : `<span class="trend-col${point.current ? ' trend-current' : ''}" title="${tooltip}">${body}</span>`;
          })
          .join('')}</div>`,
        ' panel-wide'
      )}
      ${historyListPanel('New failures', 'fail', testsWithStatus('new'), () => 'new', 'None: every failure also failed in the previous run.')}
      ${historyListPanel('Fixed since last run', 'pass', testsWithStatus('fixed'), () => 'fixed', 'Nothing that failed last run passes now.')}
      ${historyListPanel(
        'Most unstable',
        'flaky',
        allTestsWithSpec
          .map(item => ({ item, codes: testHistoryCodes(summary, item.test) ?? '' }))
          .filter(({ codes }) => codes.split('F').length - 1 >= 2)
          .sort((a, b) => b.codes.split('F').length - a.codes.split('F').length)
          .slice(0, 5)
          .map(({ item }) => item),
        item => {
          const codes = testHistoryCodes(summary, item.test) ?? '';
          return `${codes.split('F').length - 1}/${codes.replace(/-/g, '').length}`;
        },
        'No test failed twice in the last runs.',
        'failed in last runs'
      )}`
    : panel(
        'Run history',
        panelIcons.bars,
        'neutral',
        '',
        `<p class="empty-state">Not loaded for this report. History comes from past Azure DevOps test runs. In a pipeline, map <code>SYSTEM_ACCESSTOKEN</code> into the Cypress step. On your machine, set <code>AZURE_DEVOPS_PAT</code> (Test Management, read) plus <code>history.organization</code> and <code>history.project</code> in the reporter options.</p>`,
        ' panel-wide'
      );

  const durationsPanelHtml = `
        <details class="panel panel-wide accent-brand durations-panel">
          <summary class="panel-header">
            ${panelTitle('Spec durations', panelIcons.bars)}
            <div class="panel-meta">${summary.specs.length} spec${summary.specs.length === 1 ? '' : 's'} · click a bar to open its tests</div>
          </summary>
          <div class="waterfall-container">
            ${waterfallBarsHtml}
          </div>
        </details>`;

  const galleryCount = summary.specs.reduce(
    (count, spec) =>
      count +
      spec.tests.reduce(
        (testCount, t) =>
          testCount +
          (hasFailureEvidence(t) ? (t.screenshots?.length ?? 0) + (t.video?.base64 || (!t.video && spec.video?.base64) ? 1 : 0) : 0),
        0
      ),
    0
  );

  const railItems: Array<{ nav: string; label: string; count?: number; onclick: string; icon: string }> = [
    {
      nav: 'insights',
      label: 'Insights',
      onclick: "showView('insights')",
      icon: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>'
    },
    {
      nav: 'failed',
      label: 'Failures',
      count: failedTests.length,
      onclick: "setFilter('failed')",
      icon: '<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/>'
    },
    {
      nav: 'flaky',
      label: 'Flaky',
      count: flakyCount,
      onclick: "setFilter('flaky')",
      icon: '<path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>'
    },
    {
      nav: 'all',
      label: 'All tests',
      count: summary.totalTests,
      onclick: "setFilter('all')",
      icon: '<path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>'
    },
    {
      nav: 'gallery',
      label: 'Gallery',
      count: galleryCount,
      onclick: "showView('gallery')",
      icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>'
    }
  ];
  const railHtml = railItems
    .map(
      item =>
        `<button type="button" class="rail-item" data-nav="${item.nav}" onclick="${item.onclick}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${item.icon}</svg><span class="rail-label">${item.label}</span>${item.count === undefined ? '' : `<span class="rail-count">${item.count}</span>`}</button>`
    )
    .join('');

  const menuItemsHtml = [
    aiPrompt
      ? `<button type="button" class="menu-item" onclick="copyAiPrompt(this, 'aiPromptText')">${copyIconSvg}<span class="ai-copy-label">Copy failure AI prompt</span></button>`
      : '',
    aiFlakyPrompt
      ? `<button type="button" class="menu-item" onclick="copyAiPrompt(this, 'aiFlakyPromptText')">${copyIconSvg}<span class="ai-copy-label">Copy flaky AI prompt</span></button>`
      : '',
    failureGroups.length || flakyCount
      ? `<button type="button" class="menu-item" data-copy="${escapeHtml(buildRunSummaryText(summary, pageTitle, failureGroups))}" onclick="copyDataText(this)">${copyIconSvg}<span class="copy-label">Copy run summary</span></button>`
      : '',
    `<button type="button" class="menu-item" onclick="saveReportAsHtml(this)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg><span class="save-html-label">Save as HTML</span></button>`,
    `<button type="button" class="menu-item" onclick="printReport()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg><span>Print</span></button>`
  ].join('');

  return `<!DOCTYPE html>
<html lang="en" data-theme="${theme === 'light' ? 'light' : 'dark'}" data-default-theme="${theme}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(teamName ? `${pageTitle} · ${teamName}` : pageTitle)}</title>
  <script>
    (function () {
      var root = document.documentElement;
      var saved = null;
      try {
        saved = localStorage.getItem('neo-report-theme');
      } catch (e) {}
      var preferred = root.getAttribute('data-default-theme');
      var system = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
      root.setAttribute('data-theme', saved || (preferred === 'auto' ? system : preferred));
    })();
  </script>
  <style>
    :root {
      --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      --font-mono: 'JetBrains Mono', Consolas, Monaco, "Courier New", monospace;

      /* Dark Theme (Default) */
      --bg-canvas: #0E1014;
      --bg-surface: #161920;
      --bg-surface-elevated: #1D2129;
      --bg-surface-hover: #262B35;
      --border-subtle: #272C36;
      --border-strong: #3A404C;
      --text-primary: #E8EAEF;
      --text-secondary: #A2A8B5;
      --text-muted: #7C8296;

      --color-pass: #2BA591;
      --color-pass-glow: rgba(43, 165, 145, 0.16);
      --color-fail: #F0616B;
      --color-fail-glow: rgba(240, 97, 107, 0.16);
      --color-pending: #8A90A8;
      --color-pending-glow: rgba(138, 144, 168, 0.16);
      --color-flaky: #E0A050;
      --color-flaky-glow: rgba(224, 160, 80, 0.16);
      --color-brand: #A3A6FF;
      color-scheme: dark;

      --shadow-card: none;
      --radius-sm: 6px;
      --radius-md: 10px;
      --radius-lg: 10px;
      --radius-pill: 9999px;
    }

    [data-theme="light"] {
      --bg-canvas: #F6F7F9;
      --bg-surface: #FFFFFF;
      --bg-surface-elevated: #F1F2F5;
      --bg-surface-hover: #E4E6EB;
      --border-subtle: #E4E6EB;
      --border-strong: #C9CDD6;
      --text-primary: #16181D;
      --text-secondary: #5A606D;
      --text-muted: #80869A;

      --color-pass: #0B7F7B;
      --color-pass-glow: rgba(11, 127, 123, 0.12);
      --color-fail: #A52830;
      --color-fail-glow: rgba(165, 40, 48, 0.12);
      --color-pending: #6B7186;
      --color-pending-glow: rgba(107, 113, 134, 0.12);
      --color-flaky: #B4610F;
      --color-flaky-glow: rgba(180, 97, 15, 0.12);
      --color-brand: #3D3FD8;
      color-scheme: light;

      --shadow-card: none;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--font-sans);
      background-color: var(--bg-canvas);
      color: var(--text-primary);
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
      padding: 0;
      margin: 0;
      min-height: 100vh;
    }

    .top-bar {
      position: sticky;
      top: 0;
      z-index: 100;
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
      padding: 10px 24px;
      background: var(--bg-canvas);
      border-bottom: 1px solid var(--border-subtle);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 8px;
      background: none;
      border: none;
      color: var(--text-primary);
      font-family: inherit;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      padding: 0;
    }
    .run-meta {
      display: flex;
      align-items: center;
      gap: 14px;
      flex-wrap: wrap;
      padding-left: 16px;
      border-left: 1px solid var(--border-subtle);
    }
    .run-meta-inline {
      padding-left: 0;
      border-left: none;
    }
    .run-meta-item {
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--text-secondary);
      text-decoration: none;
      white-space: nowrap;
    }
    .run-meta-label {
      font-family: var(--font-sans);
      color: var(--text-muted);
    }
    a.run-meta-item:hover {
      color: var(--color-brand);
    }
    .top-bar-right {
      display: flex;
      align-items: center;
      gap: 14px;
      flex-wrap: wrap;
      margin-left: auto;
    }
    .top-count, .outcome-legend-item {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: none;
      border: none;
      font-family: inherit;
      font-size: 13px;
      color: var(--text-secondary);
      cursor: pointer;
      padding: 2px 0;
    }
    .top-count strong, .outcome-legend-item strong {
      font-variant-numeric: tabular-nums;
    }
    .top-count:hover, .outcome-legend-item:hover {
      color: var(--text-primary);
    }
    .count-failed, .count-failed strong { color: var(--color-fail); }
    .count-passed strong { color: var(--color-pass); }
    .count-flaky, .count-flaky strong { color: var(--color-flaky); }
    .count-pending strong { color: var(--text-secondary); }
    .top-duration {
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--text-secondary);
    }
    .search-box {
      position: relative;
      display: flex;
      align-items: center;
    }
    .search-icon {
      position: absolute;
      left: 10px;
      color: var(--text-muted);
      pointer-events: none;
    }
    .search-input {
      width: 260px;
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-sm);
      padding: 7px 44px 7px 32px;
      color: var(--text-primary);
      font-size: 13px;
      font-family: inherit;
      outline: none;
    }
    .search-input:focus {
      border-color: var(--color-brand);
    }
    .search-kbd {
      position: absolute;
      right: 8px;
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text-muted);
      border: 1px solid var(--border-subtle);
      border-radius: 4px;
      padding: 0 5px;
      pointer-events: none;
    }
    .btn-action, .icon-btn {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      color: var(--text-primary);
      padding: 7px 12px;
      border-radius: var(--radius-sm);
      font-size: 13px;
      font-weight: 500;
      font-family: inherit;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .btn-action:hover, .icon-btn:hover {
      border-color: var(--border-strong);
      background: var(--bg-surface-hover);
    }
    .icon-btn {
      padding: 7px;
    }
    [data-theme="dark"] .icon-sun, [data-theme="light"] .icon-moon {
      display: none;
    }
    .menu {
      position: relative;
    }
    .menu summary {
      list-style: none;
    }
    .menu summary::-webkit-details-marker {
      display: none;
    }
    .menu-list {
      position: absolute;
      right: 0;
      top: calc(100% + 6px);
      min-width: 220px;
      background: var(--bg-surface);
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-sm);
      padding: 4px;
      display: flex;
      flex-direction: column;
      z-index: 200;
    }
    .menu-item {
      display: flex;
      align-items: center;
      gap: 10px;
      background: none;
      border: none;
      color: var(--text-primary);
      font-family: inherit;
      font-size: 13px;
      text-align: left;
      padding: 8px 10px;
      border-radius: 4px;
      cursor: pointer;
    }
    .menu-item:hover {
      background: var(--bg-surface-hover);
    }

    .shell {
      display: grid;
      grid-template-columns: 220px minmax(0, 1fr);
      min-height: calc(100vh - var(--top-bar-h, 53px));
    }
    .rail {
      position: sticky;
      top: var(--top-bar-h, 53px);
      align-self: start;
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 16px 10px;
      border-right: 1px solid var(--border-subtle);
      min-height: calc(100vh - var(--top-bar-h, 53px));
    }
    /* Until the page script has run, the menu buttons would do nothing, so they are locked behind a loader. */
    .rail-loader {
      display: none;
    }
    .rail[aria-busy="true"] .rail-item {
      opacity: 0.35;
    }
    .rail[aria-busy="true"] .rail-loader {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 10px;
      color: var(--text-secondary);
      font-size: 13px;
    }
    .rail-item {
      display: flex;
      align-items: center;
      gap: 10px;
      background: none;
      border: none;
      color: var(--text-secondary);
      font-family: inherit;
      font-size: 14px;
      text-align: left;
      padding: 8px 10px;
      border-radius: var(--radius-sm);
      cursor: pointer;
    }
    .rail-item:hover {
      color: var(--text-primary);
      background: var(--bg-surface-hover);
    }
    .rail-item.active {
      color: var(--text-primary);
      background: var(--bg-surface-elevated);
      font-weight: 600;
    }
    .rail-label {
      flex: 1;
    }
    .rail-count {
      font-size: 12px;
      font-variant-numeric: tabular-nums;
      color: var(--text-muted);
    }
    .main {
      padding: 28px 32px 64px;
      max-width: 1440px;
      width: 100%;
    }
    .view-header {
      display: flex;
      align-items: baseline;
      gap: 14px;
      flex-wrap: wrap;
      margin-bottom: 20px;
    }
    .view-title {
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.3px;
    }
    .view-subtitle {
      font-size: 13px;
      color: var(--text-secondary);
    }
    .view-actions {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .accent-fail { --accent: var(--color-fail); --accent-soft: var(--color-fail-glow); }
    .accent-pass { --accent: var(--color-pass); --accent-soft: var(--color-pass-glow); }
    .accent-flaky { --accent: var(--color-flaky); --accent-soft: var(--color-flaky-glow); }
    .accent-ai { --accent: #8B5CF6; --accent-soft: rgba(139, 92, 246, 0.14); }
    .accent-brand { --accent: var(--color-brand); --accent-soft: rgba(59, 130, 246, 0.14); }
    .accent-time { --accent: #06B6D4; --accent-soft: rgba(6, 182, 212, 0.14); }
    .accent-neutral { --accent: var(--border-strong); --accent-soft: transparent; }

    .stat-strip {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 16px;
    }
    @media (max-width: 900px) {
      .stat-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .stat-cell:last-child { grid-column: 1 / -1; }
    }
    .stat-cell {
      padding: 16px 20px;
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-top: 3px solid var(--accent);
      border-radius: var(--radius-lg);
    }
    .stat-label {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-secondary);
    }
    .stat-value {
      font-size: 32px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.5px;
      margin: 4px 0 2px;
    }
    .stat-failed { color: var(--color-fail); }
    .stat-passed { color: var(--color-pass); }
    .stat-flaky { color: var(--color-flaky); }
    .stat-sub {
      font-size: 12px;
      color: var(--text-muted);
    }
    .outcome-bar {
      display: flex;
      gap: 3px;
      height: 10px;
      margin-top: 22px;
    }
    .outcome-segment {
      border-radius: 5px;
      min-width: 6px;
    }
    .segment-passed { background: var(--color-pass); }
    .segment-failed { background: var(--color-fail); }
    .segment-flaky { background: var(--color-flaky); }
    .segment-pending { background: var(--text-muted); }
    .outcome-legend {
      display: flex;
      gap: 18px;
      flex-wrap: wrap;
      margin: 8px 0 20px;
    }

    .panel-grid {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 16px;
    }
    .panel-grid > .panel {
      grid-column: span 2;
    }
    .panel-grid > .panel-half {
      grid-column: span 3;
    }
    .panel-grid > .panel-wide {
      grid-column: 1 / -1;
    }
    @media (max-width: 1200px) {
      .panel-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .panel-grid > .panel, .panel-grid > .panel-half { grid-column: span 1; }
      .panel-grid > .panel-owners, .panel-grid > .panel-wide { grid-column: 1 / -1; }
    }
    @media (max-width: 700px) {
      .panel-grid { grid-template-columns: minmax(0, 1fr); }
    }
    .panel {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-left: 4px solid var(--accent);
      border-radius: var(--radius-lg);
      padding: 18px 20px;
      min-width: 0;
    }
    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }
    .panel-title {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 16px;
      font-weight: 700;
    }
    .panel-icon {
      color: var(--accent);
      flex-shrink: 0;
    }
    .panel-meta {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 13px;
      color: var(--text-secondary);
    }
    .failure-groups {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .failure-group {
      background: var(--bg-surface-elevated);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      padding: 12px 16px;
    }
    .failure-group-header {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      width: 100%;
      background: none;
      border: none;
      color: inherit;
      font-family: inherit;
      text-align: left;
      cursor: pointer;
      padding: 0;
      margin-bottom: 8px;
    }
    .failure-group-header:hover .failure-group-message {
      text-decoration: underline;
    }
    .failure-group-count {
      flex-shrink: 0;
      font-weight: 800;
      font-size: 13px;
      color: var(--color-fail);
      background: var(--color-fail-glow);
      border: 1px solid rgba(239, 68, 68, 0.35);
      border-radius: var(--radius-pill);
      padding: 1px 10px;
    }
    .failure-group-message {
      font-family: var(--font-mono);
      font-size: 12px;
      line-height: 1.6;
      color: var(--text-primary);
      word-break: break-word;
    }
    .failure-group-tests {
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .test-jump {
      background: none;
      border: none;
      color: var(--text-secondary);
      font-family: inherit;
      font-size: 13px;
      text-align: left;
      cursor: pointer;
      padding: 3px 8px;
      border-radius: var(--radius-sm);
    }
    .test-jump:hover {
      background: var(--bg-surface-hover);
      color: var(--text-primary);
    }
    .test-jump-spec, .test-jump-owner {
      color: var(--text-muted);
    }
    .test-jump-more {
      color: var(--color-brand);
    }
    .panel-list {
      display: flex;
      flex-direction: column;
    }
    .panel-row {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      background: none;
      border: none;
      color: var(--text-primary);
      font-family: inherit;
      font-size: 14px;
      text-align: left;
      padding: 7px 6px;
      margin: 0 -6px;
      border-radius: var(--radius-sm);
      cursor: pointer;
    }
    .panel-row:hover {
      background: var(--bg-surface-hover);
    }
    .panel-row + .panel-row {
      border-top: 1px solid var(--border-subtle);
    }
    .panel-row-name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    code.panel-row-name {
      font-family: var(--font-mono);
      font-size: 12px;
    }
    .panel-row-value {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-family: var(--font-mono);
      font-size: 13px;
      color: var(--text-secondary);
      font-variant-numeric: tabular-nums;
    }
    .panel-text {
      font-size: 13px;
      color: var(--text-secondary);
      margin-bottom: 10px;
    }
    .empty-state {
      font-size: 14px;
      color: var(--text-muted);
    }
    .durations-panel > summary {
      cursor: pointer;
      list-style: none;
      margin-bottom: 0;
    }
    .durations-panel > summary::-webkit-details-marker {
      display: none;
    }
    .durations-panel[open] > summary {
      margin-bottom: 14px;
    }
    .waterfall-container {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .waterfall-row {
      display: grid;
      grid-template-columns: 240px 1fr 90px;
      align-items: center;
      gap: 16px;
      cursor: pointer;
      padding: 2px 6px;
      border-radius: var(--radius-sm);
    }
    .waterfall-row:hover {
      background: var(--bg-surface-hover);
    }
    .waterfall-label {
      font-size: 13px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--text-primary);
    }
    .waterfall-track {
      background: var(--bg-surface-elevated);
      height: 20px;
      border-radius: 4px;
      overflow: hidden;
    }
    .waterfall-fill {
      height: 100%;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      padding-right: 8px;
      min-width: 48px;
    }
    .waterfall-time {
      font-size: 11px;
      font-weight: 600;
      font-family: var(--font-mono);
      color: #FFF;
    }
    .waterfall-badge {
      font-size: 12px;
      font-family: var(--font-mono);
      text-align: center;
      padding: 2px 8px;
      border-radius: var(--radius-pill);
    }
    .ai-prompt-details summary {
      cursor: pointer;
      font-size: 13px;
      color: var(--text-secondary);
    }
    .ai-prompt-text {
      width: 100%;
      min-height: 280px;
      margin-top: 10px;
      background: var(--bg-surface);
      color: var(--text-primary);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-sm);
      padding: 12px 14px;
      font-family: var(--font-mono);
      font-size: 12px;
      line-height: 1.6;
      resize: vertical;
    }
    .search-hint {
      font-size: 12px;
      color: var(--text-muted);
      margin-bottom: 16px;
    }
    .search-hint code {
      font-family: var(--font-mono);
      color: var(--text-secondary);
      background: var(--bg-surface-elevated);
      border-radius: 4px;
      padding: 1px 6px;
    }
    .gallery-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 16px;
    }
    .gallery-card {
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-sm);
      overflow: hidden;
      background: var(--bg-surface);
      display: flex;
      flex-direction: column;
    }
    .gallery-media {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      aspect-ratio: 16 / 10;
      background: var(--bg-surface-elevated);
      border: none;
      padding: 0;
      cursor: zoom-in;
      color: var(--text-secondary);
      font-family: inherit;
      font-size: 13px;
    }
    .gallery-media img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: top;
    }
    .gallery-video {
      cursor: pointer;
    }
    .gallery-caption {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      background: none;
      border: none;
      border-top: 1px solid var(--border-subtle);
      color: var(--text-primary);
      font-family: inherit;
      font-size: 13px;
      text-align: left;
      cursor: pointer;
    }
    .gallery-caption:hover {
      background: var(--bg-surface-hover);
    }
    .gallery-caption span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .status-icon {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
    }
    .status-passed { color: var(--color-pass); }
    .status-failed { color: var(--color-fail); }
    .status-flaky { color: var(--color-flaky); }
    .status-pending, .status-skipped { color: var(--text-muted); }

    @media (max-width: 900px) {
      .top-bar { padding: 10px 16px; }
      .run-meta { padding-left: 0; border-left: none; width: 100%; order: 3; }
      .top-bar-right { margin-left: 0; width: 100%; }
      .search-input { width: 100%; }
      .search-box { flex: 1; }
      .shell { grid-template-columns: minmax(0, 1fr); }
      .rail {
        position: relative;
        flex-direction: row;
        overflow-x: auto;
        min-height: 0;
        padding: 8px 16px;
        border-right: none;
        border-bottom: 1px solid var(--border-subtle);
      }
      .rail-item { flex-shrink: 0; }
      .main { padding: 20px 16px 48px; }
      .waterfall-row { grid-template-columns: 120px 1fr 64px; gap: 8px; }
    }

    @media print {
      .top-bar-right, .rail, .panel-ai, .view-actions, .search-hint, [data-view="gallery"] { display: none !important; }
      .shell { display: block; }
      [data-view]:not([data-view="gallery"]) { display: block !important; }
      .durations-panel .waterfall-container { display: flex !important; }
      /* Printed reports always show the full step log, whatever is collapsed on screen. */
      .test-steps-timeline { display: flex !important; }
      .error-copy-btn, .test-link-btn { display: none !important; }
      .steps-toggle-chevron { display: none; }
    }

    /* Spec Cards */
    .specs-list {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .spec-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-lg);
      overflow: hidden;
      box-shadow: var(--shadow-card);
      transition: border-color 0.2s;
    }
    .spec-card.spec-has-failure {
      border-left: 4px solid var(--color-fail);
    }
    .spec-card:not(.spec-has-failure) {
      border-left: 4px solid var(--color-pass);
    }
    .spec-card.spec-has-flaky {
      border-left-color: var(--color-flaky);
    }
    .spec-card-header {
      padding: 20px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      cursor: pointer;
      user-select: none;
      background: var(--bg-surface-elevated);
      border-bottom: 1px solid var(--border-strong);
      transition: background 0.15s;
    }
    .spec-card-header:hover {
      background: var(--bg-surface-hover);
    }
    .spec-title-group {
      display: flex;
      align-items: center;
      gap: 14px;
      min-width: 0;
    }
    .spec-icon {
      font-size: 20px;
      display: flex;
      align-items: center;
    }
    .spec-title-box {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }
    .spec-name-row {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .spec-tag {
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 1px;
      color: var(--color-brand);
      background: rgba(59, 130, 246, 0.14);
      border: 1px solid rgba(59, 130, 246, 0.4);
      padding: 2px 8px;
      border-radius: var(--radius-sm);
    }
    .spec-name {
      font-size: 18px;
      font-weight: 800;
      letter-spacing: -0.2px;
      color: var(--text-primary);
    }
    .spec-path {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      align-self: flex-start;
      max-width: 100%;
      padding: 0;
      border: 0;
      background: none;
      cursor: copy;
      text-align: left;
      overflow-wrap: anywhere;
      font-size: 12px;
      font-family: var(--font-mono);
      color: var(--text-muted);
    }
    .spec-path svg {
      flex-shrink: 0;
      opacity: 0;
      transition: opacity 0.15s;
    }
    .spec-path:hover,
    .spec-path:focus-visible {
      color: var(--color-brand);
    }
    .spec-path:hover svg,
    .spec-path:focus-visible svg {
      opacity: 1;
    }
    .spec-meta-group {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .spec-time-badge {
      font-size: 13px;
      font-family: var(--font-mono);
      color: var(--text-secondary);
      background: var(--bg-surface-elevated);
      padding: 4px 10px;
      border-radius: var(--radius-sm);
    }
    .spec-count-badge {
      font-size: 13px;
      color: var(--text-secondary);
    }
    .collapse-chevron {
      font-size: 12px;
      color: var(--text-muted);
      transition: transform 0.2s;
    }

    /* Badges */
    .badge {
      font-size: 12px;
      font-weight: 700;
      padding: 4px 10px;
      border-radius: var(--radius-pill);
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .badge-pass {
      background: var(--color-pass-glow);
      color: var(--color-pass);
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .badge-fail {
      background: var(--color-fail-glow);
      color: var(--color-fail);
      border: 1px solid rgba(239, 68, 68, 0.3);
    }
    .badge-flaky {
      background: var(--color-flaky-glow);
      color: var(--color-flaky);
      border: 1px solid rgba(234, 179, 8, 0.35);
    }

    /* Test Rows */
    .spec-card-body {
      border-top: 1px solid var(--border-subtle);
      background: var(--bg-canvas);
    }
    .test-row {
      border-bottom: 1px solid var(--border-subtle);
    }
    .test-row:last-child {
      border-bottom: none;
    }
    .test-row-main {
      padding: 14px 24px;
      display: grid;
      grid-template-columns: 28px 1fr auto;
      align-items: center;
      gap: 14px;
      cursor: pointer;
      transition: background 0.15s;
    }
    .test-row-main:hover {
      background: var(--bg-surface-hover);
    }
    .flaky-tag {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--color-flaky);
      background: var(--color-flaky-glow);
      padding: 2px 8px;
      border-radius: var(--radius-pill);
      border: 1px solid rgba(234, 179, 8, 0.35);
    }
    .test-title-col {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .test-title-text {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary);
    }
    .test-suite-crumbs {
      font-size: 12px;
      color: var(--text-muted);
    }
    .test-duration-col {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
    }
    /* Steps Chip & Drawer */
    .steps-chip {
      font-size: 11px;
      font-weight: 600;
      color: var(--text-secondary);
      background: var(--bg-surface-elevated);
      padding: 2px 8px;
      border-radius: var(--radius-pill);
      border: 1px solid var(--border-subtle);
    }
    .duration-chip {
      font-size: 12px;
      font-family: var(--font-mono);
      color: var(--text-secondary);
    }
    .started-at-chip {
      font-size: 12px;
      font-family: var(--font-mono);
      color: var(--text-muted);
      white-space: nowrap;
    }
    .test-link-btn {
      display: flex;
      align-items: center;
      gap: 4px;
      background: none;
      border: 1px solid transparent;
      border-radius: var(--radius-pill);
      color: var(--text-muted);
      font-family: inherit;
      font-size: 11px;
      padding: 2px 8px;
      cursor: pointer;
    }
    .test-link-btn:hover {
      border-color: var(--border-strong);
      color: var(--text-primary);
    }
    .test-row-highlight > .test-row-main {
      box-shadow: inset 4px 0 0 var(--color-brand);
    }
    .chevron-arrow {
      font-size: 10px;
      color: var(--text-muted);
      transition: transform 0.2s;
    }

    /* Test Details Drawer */
    .test-details-drawer {
      display: none;
      padding: 20px 24px 24px 66px;
      background: var(--bg-surface);
      border-top: 1px dashed var(--border-subtle);
    }
    .test-details-drawer.open {
      display: block;
    }

    /* Business Goal Card */
    .business-goal-card {
      background: rgba(99, 102, 241, 0.08);
      border: 1px solid rgba(99, 102, 241, 0.25);
      border-radius: var(--radius-md);
      padding: 12px 16px;
      margin-bottom: 16px;
      display: flex;
      align-items: flex-start;
      gap: 12px;
    }
    .goal-icon {
      flex-shrink: 0;
      margin-top: 2px;
    }
    .goal-body {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .goal-persona {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      color: #818CF8;
      letter-spacing: 0.5px;
    }
    .goal-text {
      font-size: 13px;
      color: var(--text-primary);
      font-weight: 600;
    }

    /* Steps Timeline Section */
    .steps-section {
      margin-bottom: 16px;
    }
    .steps-section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      width: 100%;
      padding: 9px 14px;
      background: var(--bg-surface-elevated);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-sm);
      color: inherit;
      font-family: inherit;
      text-align: left;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
    }
    .steps-section-header:hover {
      background: var(--bg-surface-hover);
      border-color: var(--border-strong);
    }
    .steps-toggle-chevron {
      font-size: 9px;
      color: var(--text-muted);
      display: inline-block;
      transition: transform 0.2s;
    }
    .steps-section.open .steps-toggle-chevron {
      transform: rotate(90deg);
    }
    .steps-section-title {
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: var(--text-secondary);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .steps-section-sub {
      font-size: 11px;
      color: var(--text-muted);
    }
    .test-steps-timeline {
      display: none;
      flex-direction: column;
      gap: 10px;
      position: relative;
      padding-left: 20px;
      margin-top: 14px;
    }
    .steps-section.open .test-steps-timeline {
      display: flex;
    }
    .test-steps-timeline::before {
      content: '';
      position: absolute;
      left: 6px;
      top: 8px;
      bottom: 8px;
      width: 2px;
      background: var(--border-subtle);
    }
    /* Shown while the report is still downloading the steps of a test opened early. */
    .test-steps-timeline:not([data-ready])::after {
      content: 'Loading steps…';
      color: var(--text-muted);
      font-size: 13px;
    }
    .step-item {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      position: relative;
    }
    .step-bullet {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: var(--bg-surface);
      border: 2px solid var(--border-strong);
      flex-shrink: 0;
      margin-top: 4px;
      margin-left: -20px;
      z-index: 1;
    }
    .step-failing .step-bullet {
      border-color: var(--color-fail);
      background: var(--color-fail);
    }
    .step-failing .step-message,
    .step-failing .step-subtext {
      color: var(--color-fail);
    }
    .history-tag {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      padding: 2px 8px;
      border-radius: var(--radius-pill);
      white-space: nowrap;
    }
    .history-tag-new {
      color: #FFF;
      background: var(--color-fail);
    }
    .history-tag-known {
      color: var(--text-secondary);
      background: var(--bg-surface-elevated);
      border: 1px solid var(--border-strong);
    }
    .history-tag-fixed {
      color: var(--color-pass);
      background: var(--color-pass-glow);
      border: 1px solid rgba(16, 185, 129, 0.35);
    }
    .history-strip {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 16px;
      font-size: 13px;
      color: var(--text-secondary);
    }
    .history-strip-label {
      font-weight: 600;
    }
    .history-dots {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .history-dot {
      width: 12px;
      height: 12px;
      border-radius: 3px;
      background: var(--border-subtle);
    }
    .history-dot-P { background: var(--color-pass); }
    .history-dot-F { background: var(--color-fail); }
    .history-dot-S { background: var(--text-muted); }
    .history-dot-none { background: transparent; border: 1px dashed var(--border-strong); }
    .history-dot-current {
      width: 16px;
      height: 16px;
      outline: 2px solid var(--text-primary);
      outline-offset: 1px;
    }
    .history-arrow {
      color: var(--text-muted);
      margin: 0 2px;
    }
    .trend-chart {
      display: flex;
      align-items: stretch;
      gap: 8px;
      height: 170px;
      overflow-x: auto;
    }
    .trend-col {
      flex: 1 0 56px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      color: var(--text-secondary);
      text-decoration: none;
      font-size: 12px;
      border-radius: var(--radius-sm);
      padding: 4px 2px;
    }
    a.trend-col:hover {
      background: var(--bg-surface-hover);
    }
    .trend-value {
      font-family: var(--font-mono);
      font-weight: 700;
      color: var(--text-primary);
    }
    .trend-track {
      flex: 1;
      width: 60%;
      display: flex;
      align-items: flex-end;
    }
    .trend-bar {
      width: 100%;
      background: var(--color-fail);
      opacity: 0.55;
      border-radius: 4px 4px 0 0;
    }
    .trend-current .trend-bar {
      opacity: 1;
    }
    .trend-current .trend-label {
      color: var(--text-primary);
      font-weight: 700;
    }
    .trend-label {
      white-space: nowrap;
      font-size: 11px;
    }
    .step-phase-badge {
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.5px;
      padding: 2px 7px;
      border-radius: var(--radius-sm);
      flex-shrink: 0;
      min-width: 50px;
      text-align: center;
    }
    .phase-VISIT { background: rgba(14, 165, 233, 0.15); color: #38BDF8; border: 1px solid rgba(14, 165, 233, 0.3); }
    .phase-FIND  { background: rgba(245, 158, 11, 0.15); color: #FBBF24; border: 1px solid rgba(245, 158, 11, 0.3); }
    .phase-STEP  { background: rgba(139, 92, 246, 0.15); color: #A78BFA; border: 1px solid rgba(139, 92, 246, 0.3); }
    .phase-CHECK { background: rgba(16, 185, 129, 0.15); color: #34D399; border: 1px solid rgba(16, 185, 129, 0.3); }
    .phase-INFO  { background: rgba(100, 116, 139, 0.15); color: #94A3B8; border: 1px solid rgba(100, 116, 139, 0.3); }
    .step-content {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .step-message {
      font-size: 13px;
      color: var(--text-primary);
      font-weight: 500;
      line-height: 1.4;
      white-space: pre-wrap;
    }
    .step-subtext {
      font-size: 11px;
      color: var(--text-muted);
      font-family: var(--font-mono);
    }
    .steps-section-empty {
      font-size: 13px;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 0;
    }
    .test-error-box {
      background: var(--bg-surface-elevated);
      border: 1px solid var(--border-subtle);
      border-left: 4px solid var(--color-fail);
      border-radius: var(--radius-md);
      padding: 16px;
      margin-bottom: 16px;
    }
    .test-error-box.flaky {
      border-left-color: var(--color-flaky);
    }
    .flaky-note {
      font-size: 13px;
      font-weight: 600;
      color: var(--color-flaky);
      margin-bottom: 10px;
    }
    .error-header {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 14px;
      color: var(--color-fail);
      font-weight: 600;
      margin-bottom: 10px;
    }
    .error-copy-btn {
      margin-left: auto;
      flex-shrink: 0;
    }
    .error-stack {
      background: var(--bg-canvas);
      padding: 12px 16px;
      border-radius: var(--radius-sm);
      overflow-x: auto;
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--text-primary);
      border: 1px solid var(--border-subtle);
      line-height: 1.6;
    }
    .test-code {
      margin-top: 12px;
    }
    .diagnostics-list {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 12px;
    }
    .diagnostics-list li {
      display: grid;
      grid-template-columns: 64px 1fr auto;
      gap: 10px;
      align-items: baseline;
    }
    .diagnostics-list code {
      font-family: var(--font-mono);
      word-break: break-all;
      color: var(--text-primary);
    }
    .diagnostic-status {
      font-family: var(--font-mono);
      font-weight: 700;
      color: var(--color-fail);
    }
    .diagnostic-console {
      color: var(--color-pending);
    }
    .diagnostic-time {
      font-family: var(--font-mono);
      color: var(--text-muted);
      white-space: nowrap;
    }
    .spec-owner-badge {
      font-size: 12px;
      color: var(--text-secondary);
      background: var(--bg-surface-elevated);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-pill);
      padding: 2px 10px;
      white-space: nowrap;
    }
    .search-hint {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 8px;
    }
    .search-hint code {
      font-family: var(--font-mono);
      color: var(--text-secondary);
      background: var(--bg-surface-elevated);
      border-radius: var(--radius-sm);
      padding: 1px 6px;
    }
    .test-ai-prompt {
      margin-top: 16px;
      padding-top: 14px;
      border-top: 1px dashed var(--border-strong);
    }
    .test-ai-prompt-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 10px;
    }
    .test-ai-prompt-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-secondary);
    }
    .btn-action-sm {
      padding: 5px 10px;
      font-size: 12px;
    }
    .test-ai-prompt-text {
      min-height: 200px;
    }
    .test-code summary {
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-secondary);
      margin-bottom: 8px;
    }
    .screenshot-evidence {
      margin-top: 16px;
    }
    .evidence-title {
      font-size: 13px;
      font-weight: 700;
      color: var(--text-secondary);
      margin-bottom: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .screenshot-gallery {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
    }
    .screenshot-thumbnail-wrap {
      position: relative;
      border-radius: var(--radius-md);
      overflow: hidden;
      border: 2px solid var(--border-subtle);
      cursor: pointer;
      max-width: 380px;
      transition: transform 0.2s, border-color 0.2s;
    }
    .screenshot-thumbnail-wrap:hover {
      transform: scale(1.02);
      border-color: var(--color-brand);
    }
    .screenshot-thumb {
      width: 100%;
      height: auto;
      display: block;
    }
    /* Keeps the thumbnail's place while the screenshot is still downloading. */
    .screenshot-thumb:not([src]) {
      width: 380px;
      max-width: 100%;
      aspect-ratio: 16 / 9;
      background: var(--bg-surface-elevated);
      /* The browser would print the file name (alt text) over the loader. */
      color: transparent;
    }
    .screenshot-thumbnail-wrap:has(> img:not([src])) {
      cursor: progress;
    }
    img:not([src]) ~ .zoom-overlay,
    .gallery-media img:not([src]) {
      display: none;
    }
    /* Shown next to a screenshot or recording that has not downloaded yet, so people know to wait. */
    .media-loader {
      display: none;
      align-items: center;
      justify-content: center;
      gap: 8px;
      color: var(--text-secondary);
      font-size: 13px;
    }
    img:not([src]) + .media-loader {
      display: flex;
    }
    .screenshot-thumbnail-wrap .media-loader {
      position: absolute;
      inset: 0;
    }
    .media-spinner,
    .video-player:empty::before {
      width: 16px;
      height: 16px;
      border: 2px solid var(--border-subtle);
      border-top-color: var(--color-brand);
      border-radius: 50%;
      animation: media-spin 0.8s linear infinite;
    }
    @keyframes media-spin {
      to { transform: rotate(360deg); }
    }
    @media (prefers-reduced-motion: reduce) {
      .media-spinner,
      .video-player:empty::before { animation: none; }
    }
    .zoom-overlay {
      position: absolute;
      inset: 0;
      background: rgba(0,0,0,0.6);
      color: #FFF;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      font-size: 13px;
      font-weight: 600;
      opacity: 0;
      transition: opacity 0.2s;
    }
    .screenshot-thumbnail-wrap:hover .zoom-overlay {
      opacity: 1;
    }
    .video-evidence {
      margin-top: 16px;
    }
    .video-player {
      --plyr-color-main: var(--color-brand);
      max-width: 1280px;
      border-radius: var(--radius-md);
      overflow: hidden;
      border: 2px solid var(--border-subtle);
      background: #000;
    }
    /* An empty player is a recording that has not downloaded yet. */
    .video-player:empty {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      aspect-ratio: 16 / 9;
      color: #D1D5DB;
      font-size: 13px;
    }
    .video-player:empty::before {
      content: '';
    }
    .video-player:empty::after {
      content: 'Loading recording…';
    }

    /* Lightbox Modal */
    .modal-lightbox {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.85);
      z-index: 1000;
      backdrop-filter: blur(8px);
      align-items: center;
      justify-content: center;
      padding: 40px;
    }
    .modal-lightbox.open {
      display: flex;
    }
    .lightbox-content {
      max-width: 95vw;
      max-height: 90vh;
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    /* Scrollable frame around the image: the shot grows past it once zoomed in. */
    .lightbox-viewport {
      max-width: 95vw;
      max-height: 82vh;
      overflow: auto;
      display: flex;
      align-items: safe center;
      justify-content: safe center;
    }
    .lightbox-img {
      max-width: 95vw;
      max-height: 82vh;
      flex: none;
      border-radius: var(--radius-md);
      box-shadow: 0 10px 40px rgba(0,0,0,0.8);
      border: 1px solid rgba(255,255,255,0.15);
    }
    .lightbox-img.zoomable {
      cursor: zoom-in;
    }
    /* Zoomed in: full pixel size, panned with the scrollbars of .lightbox-viewport. */
    .lightbox-img.zoomed {
      max-width: none;
      max-height: none;
      border-radius: 0;
      cursor: zoom-out;
    }
    .lightbox-caption {
      margin-top: 14px;
      color: #FFF;
      font-size: 14px;
      font-weight: 500;
    }
    .lightbox-close {
      position: absolute;
      top: -36px;
      right: 0;
      background: none;
      border: none;
      color: #FFF;
      font-size: 28px;
      cursor: pointer;
    }

    /* Footer */
    .footer {
      text-align: center;
      padding: 40px 0;
      border-top: 1px solid var(--border-subtle);
      font-size: 13px;
      color: var(--text-muted);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
  </style>
  ${plyrAssets ? `<style>${plyrAssets.css}</style>` : ''}
</head>
<body>
  ${plyrAssets ? `<div hidden>${plyrAssets.sprite}</div>` : ''}
  <div hidden>${iconSprite()}</div>
  <header class="top-bar">
    <button type="button" class="brand" onclick="showView('insights')" title="Back to Insights">
      <svg width="20" height="20" viewBox="0 0 28 28" aria-hidden="true"><rect width="28" height="28" rx="8" fill="var(--text-primary)"/><path d="M8.5 19.5v-11l11 11v-11" fill="none" stroke="var(--bg-canvas)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="22.5" cy="5.5" r="2.5" fill="var(--color-brand)"/></svg>
      ${escapeHtml(pageTitle)}
    </button>
    ${runMetaHtml ? `<div class="run-meta">${runMetaHtml}</div>` : ''}
    <div class="top-bar-right">
      ${topCountsHtml}
      <span class="top-duration" title="Suite duration">${formattedDuration}</span>
      <label class="search-box">
        <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" id="searchInput" class="search-input" placeholder="Search tests…" aria-label="Search tests" oninput="handleSearch(this.value)" />
        <span class="search-kbd">Ctrl K</span>
      </label>
      <button type="button" class="icon-btn" onclick="toggleTheme()" title="Switch light or dark theme" aria-label="Switch light or dark theme">
        <svg class="icon-moon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
        <svg class="icon-sun" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
      </button>
      <details class="menu" id="actionsMenu">
        <summary class="btn-action">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Actions
        </summary>
        <div class="menu-list">${menuItemsHtml}</div>
      </details>
    </div>
  </header>

  <div class="shell">
    <nav class="rail" aria-label="Report views" aria-busy="true" inert>${railHtml}<div class="rail-loader"><span class="media-spinner"></span>Loading report…</div></nav>

    <main class="main">
      <section data-view="insights">
        <div class="view-header">
          <h1 class="view-title">Insights</h1>
          <span class="view-subtitle">${teamName ? `${escapeHtml(teamName)} · ` : ''}Run of ${escapeHtml(formattedDate)} (${escapeHtml(timeZone)}) · Target: ${escapeHtml(summary.environment || 'n/a')}</span>
          ${buildMetaHtml ? `<div class="run-meta run-meta-inline">${buildMetaHtml}</div>` : ''}
        </div>
        <div class="stat-strip">${statStripHtml}</div>
        ${outcomeBarHtml}
        <div class="panel-grid">
          ${failureGroupsPanelHtml}
          ${historyPanelsHtml}
          ${aiPanel('failed', aiPrompt, failedTests.length)}
          ${aiPanel('flaky', aiFlakyPrompt, flakyTests.length)}
          ${ownersPanelHtml}
          ${slowestTestsPanelHtml}
          ${slowestSpecsPanelHtml}
          ${durationsPanelHtml}
        </div>
      </section>

      <section data-view="tests" hidden>
        <div class="view-header">
          <h1 class="view-title" id="testsViewTitle">All tests</h1>
          <span class="view-subtitle" id="testsViewCount"></span>
          <div class="view-actions">
            <button class="btn-action" onclick="toggleAllSpecs()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path id="expand-collapse-icon" d="M7 13l5 5 5-5M7 6l5 5 5-5"/></svg>
              <span id="expand-collapse-text">Expand All</span>
            </button>
          </div>
        </div>
        <div class="search-hint">Search filters: <code>status:failed</code> <code>spec:checkout</code> <code>error:timed out</code> <code>owner:name</code> <code>group:2</code> <code>history:new</code> · quote values with spaces, e.g. <code>error:"never found"</code></div>
        <section class="specs-list" id="specsList">
          ${specCardsHtml}
        </section>
        <p class="empty-state" id="testsEmpty" hidden>No tests match this view.</p>
      </section>

      <section data-view="gallery" hidden>
        <div class="view-header">
          <h1 class="view-title">Gallery</h1>
          <span class="view-subtitle">Screenshots and recordings from failed and flaky tests</span>
        </div>
        <div class="gallery-grid" id="galleryGrid"></div>
      </section>

      <footer class="footer">
        <div>Generated by <a href="https://github.com/mcello23/cypress-neo-reporter" target="_blank" rel="noopener"><strong>Cypress Neo Reporter</strong></a>${version ? ` ${escapeHtml(version)}` : ''}</div>
        <div>Run executed on ${escapeHtml(formattedDate)} (${escapeHtml(timeZone)}) · Target: ${escapeHtml(summary.environment || 'n/a')}</div>
      </footer>
    </main>
  </div>

  <!-- Lightbox Modal for Screenshots -->
  <div id="lightboxModal" class="modal-lightbox" onclick="closeLightbox()">
    <div class="lightbox-content" onclick="event.stopPropagation()">
      <button class="lightbox-close" onclick="closeLightbox()">&times;</button>
      <div id="lightboxViewport" class="lightbox-viewport">
        <img id="lightboxImg" class="lightbox-img" src="" alt="Screenshot" onclick="toggleLightboxZoom(event)" onload="markLightboxZoomable()" />
      </div>
      <div id="lightboxCaption" class="lightbox-caption"></div>
    </div>
  </div>

  ${plyrAssets ? `<script>${plyrAssets.js}</script>` : ''}
  <script>
    let currentFilter = 'all';
    let searchQuery = '';
    let currentView = 'insights';
    const FILTER_TITLES = { all: 'All tests', failed: 'Failures', flaky: 'Flaky', passed: 'Passed', pending: 'Skipped' };
    const VIEW_HASHES = ['insights', 'gallery', ...Object.keys(FILTER_TITLES)];

    function toggleTheme() {
      const html = document.documentElement;
      const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      html.setAttribute('data-theme', next);
      try {
        localStorage.setItem('neo-report-theme', next);
      } catch (e) {}
    }

    function showView(view, keepScroll) {
      currentView = view;
      document.querySelectorAll('[data-view]').forEach(section => (section.hidden = section.getAttribute('data-view') !== view));
      const activeNav = view === 'tests' ? currentFilter : view;
      document.querySelectorAll('.rail-item').forEach(item => item.classList.toggle('active', item.getAttribute('data-nav') === activeNav));
      if (view === 'gallery') buildGallery();
      if (view !== 'tests') history.replaceState(null, '', '#' + view);
      if (!keepScroll) window.scrollTo({ top: 0 });
    }

    function setFilter(filter) {
      currentFilter = filter;
      setSearch('');
      showView('tests');
      history.replaceState(null, '', '#' + filter);
      if (filter === 'failed' || filter === 'flaky') {
        document.querySelectorAll('.spec-card').forEach(card => {
          if (card.style.display !== 'none') revealCard(card, true);
        });
      }
    }

    function setSearch(query) {
      document.getElementById('searchInput').value = query;
      searchQuery = query.trim().toLowerCase();
      applyFilters();
    }

    function searchAll(query) {
      currentFilter = 'all';
      setSearch(query);
      showView('tests');
    }

    function showGroup(groupIndex) {
      currentFilter = 'failed';
      setSearch('group:' + groupIndex);
      showView('tests');
      document.querySelectorAll('.spec-card').forEach(card => {
        if (card.style.display !== 'none') revealCard(card, true);
      });
    }

    function handleSearch(query) {
      searchQuery = query.trim().toLowerCase();
      applyFilters();
      if (currentView !== 'tests') showView('tests');
    }

    function filterBySpec(specName) {
      searchAll(specName);
      const card = Array.from(document.querySelectorAll('.spec-card')).find(
        c => c.getAttribute('data-spec-name') === specName.toLowerCase()
      );
      if (card) revealCard(card);
    }

    function revealCard(card, skipScroll) {
      const body = card.querySelector('.spec-card-body');
      if (body && body.style.display === 'none') toggleSpecCollapse(body.id);
      if (!skipScroll) scrollToCard(card);
    }

    function scrollToCard(card) {
      const topBar = document.querySelector('.top-bar');
      const offset = (topBar ? topBar.getBoundingClientRect().height : 0) + 16;
      const top = card.getBoundingClientRect().top + window.pageYOffset - offset;
      window.scrollTo({ top: Math.max(top, 0), behavior: 'smooth' });
    }

    const SEARCH_TOKEN_PATTERN = /(status|spec|error|owner|group|history):("[^"]*"|\\S*)|"([^"]*)"|(\\S+)/g;

    function parseSearch(query) {
      const tokens = {};
      const words = [];
      for (const match of query.matchAll(SEARCH_TOKEN_PATTERN)) {
        if (match[1]) {
          const value = match[2].replace(/^"|"$/g, '');
          if (value) (tokens[match[1]] = tokens[match[1]] || []).push(value);
        } else {
          words.push(match[3] ?? match[4]);
        }
      }
      return { tokens, text: words.join(' ').trim() };
    }

    function matchesTokens(tokens, fields) {
      return Object.keys(tokens).every(key =>
        tokens[key].some(value =>
          key === 'status'
            ? fields.status === value || (value === 'skipped' && fields.status === 'pending')
            : key === 'group' || key === 'history'
              ? fields[key] === value
              : fields[key].includes(value)
        )
      );
    }

    function applyFilters() {
      const specCards = document.querySelectorAll('.spec-card');
      const search = parseSearch(searchQuery);
      let visibleTotal = 0;

      specCards.forEach(card => {
        const specName = card.getAttribute('data-spec-name') || '';
        const owner = card.getAttribute('data-owner') || '';
        const testRows = card.querySelectorAll('.test-row');
        let visibleTestsCount = 0;

        testRows.forEach(row => {
          const state = row.getAttribute('data-state');
          const title = row.getAttribute('data-title') || '';
          const error = row.getAttribute('data-error') || '';
          const group = row.getAttribute('data-group') || '';
          const history = row.getAttribute('data-history') || '';

          const matchesFilter = (currentFilter === 'all') || (state === currentFilter) || (currentFilter === 'pending' && state === 'skipped');
          const matchesSearch =
            matchesTokens(search.tokens, { status: state, spec: specName, error, owner, group, history }) &&
            (!search.text || title.includes(search.text) || specName.includes(search.text));

          if (matchesFilter && matchesSearch) {
            row.style.display = '';
            visibleTestsCount++;
          } else {
            row.style.display = 'none';
          }
        });

        if (visibleTestsCount > 0) {
          card.style.display = '';
        } else {
          card.style.display = 'none';
        }
        visibleTotal += visibleTestsCount;
      });

      document.getElementById('testsViewTitle').textContent = FILTER_TITLES[currentFilter] || 'All tests';
      document.getElementById('testsViewCount').textContent =
        visibleTotal + ' test' + (visibleTotal === 1 ? '' : 's') + (searchQuery ? ' matching "' + searchQuery + '"' : '');
      document.getElementById('testsEmpty').hidden = visibleTotal > 0;
    }

    function toggleSpecCollapse(bodyId) {
      const body = document.getElementById(bodyId);
      const chevron = document.getElementById('chevron-' + bodyId);
      if (!body) return;
      if (body.style.display === 'none') {
        body.style.display = '';
        if (chevron) chevron.textContent = '▲';
      } else {
        body.style.display = 'none';
        if (chevron) chevron.textContent = '▼';
      }
    }

    let allExpanded = false;
    function toggleAllSpecs() {
      allExpanded = !allExpanded;
      const bodies = document.querySelectorAll('.spec-card-body');
      const chevrons = document.querySelectorAll('.collapse-chevron');
      const drawers = document.querySelectorAll('.test-details-drawer');
      const testChevrons = document.querySelectorAll('.chevron-arrow');
      bodies.forEach(b => (b.style.display = allExpanded ? '' : 'none'));
      chevrons.forEach(c => (c.textContent = allExpanded ? '▲' : '▼'));
      drawers.forEach(d => {
        d.classList.toggle('open', allExpanded);
        if (allExpanded) fillTestDetails(d);
      });
      testChevrons.forEach(tc => (tc.textContent = allExpanded ? '▲' : '▼'));
      document.querySelectorAll('.steps-section').forEach(s => setStepsOpen(s, allExpanded));
      document.getElementById('expand-collapse-text').textContent = allExpanded ? 'Collapse All' : 'Expand All';
      const expandIcon = document.getElementById('expand-collapse-icon');
      if (expandIcon) expandIcon.setAttribute('d', allExpanded ? EXPAND_ICON_UP : EXPAND_ICON_DOWN);
    }

    function setStepsOpen(section, open) {
      section.classList.toggle('open', open);
      const header = section.querySelector('.steps-section-header');
      if (header) header.setAttribute('aria-expanded', String(open));
    }

    function toggleSteps(sectionId) {
      const section = document.getElementById(sectionId);
      if (!section) return;
      setStepsOpen(section, !section.classList.contains('open'));
    }

    function toggleTestDetails(detailsId) {
      const drawer = document.getElementById(detailsId);
      const chevron = document.getElementById('chevron-' + detailsId);
      if (!drawer) return;
      const isOpen = drawer.classList.toggle('open');
      if (isOpen) fillTestDetails(drawer);
      if (chevron) {
        chevron.textContent = isOpen ? '▲' : '▼';
      }
    }

    /* Steps, screenshots and recordings are data blocks after this script, so the page works before they download.
       Returns null while a block has not fully arrived: the next sibling only exists once its closing tag is parsed. */
    function readPayload(id) {
      const block = document.getElementById(id);
      if (!block || (document.readyState === 'loading' && !block.nextSibling)) return null;
      return block.textContent;
    }

    /* Anything not downloaded yet keeps its loader here and is filled in later by fillOpenTests. */
    function fillTestDetails(scope) {
      scope.querySelectorAll('.history-dots[data-codes]:not([data-ready])').forEach(renderHistoryDots);
      scope.querySelectorAll('.test-steps-timeline:not([data-ready])').forEach(renderSteps);
      scope.querySelectorAll('img[data-media-id]:not([src])').forEach(img => {
        const src = readPayload(img.getAttribute('data-media-id'));
        if (src) img.src = src;
      });
    }

    const HISTORY_RUN_TITLES = ${scriptSafeJson(historyRunTitles)};
    const HISTORY_OUTCOMES = { P: 'Passed', F: 'Failed', S: 'Skipped', '-': 'Not run' };

    function renderHistoryDots(dots) {
      [...dots.getAttribute('data-codes')].forEach((code, index) => {
        const dot = createElement('span', 'history-dot history-dot-' + (code === '-' ? 'none' : code));
        dot.title = HISTORY_RUN_TITLES[index] + ' · ' + HISTORY_OUTCOMES[code];
        dots.appendChild(dot);
      });
      const current = createElement('span', 'history-dot history-dot-current history-dot-' + dots.getAttribute('data-current'));
      current.title = 'This run · ' + dots.getAttribute('data-current-label');
      dots.append(createElement('span', 'history-arrow', '→'), current);
      dots.setAttribute('data-ready', '');
    }

    function renderSteps(timeline) {
      const data = readPayload(timeline.getAttribute('data-steps-id'));
      if (!data) return;
      const steps = JSON.parse(data);
      const testFailed = timeline.hasAttribute('data-failed');
      steps.forEach((step, index) => {
        const isFailingStep = testFailed && index === steps.length - 1;
        const content = createElement('div', 'step-content');
        content.append(
          createElement('div', 'step-message', step.message),
          createElement('div', 'step-subtext', 'Step ' + (index + 1) + (step.durationMs ? ' · ' + step.durationMs + 'ms' : '') + (isFailingStep ? ' · Last step reached before the failure' : ''))
        );
        const item = createElement('div', 'step-item' + (isFailingStep ? ' step-failing' : ''));
        item.append(createElement('div', 'step-bullet'), createElement('span', 'step-phase-badge phase-' + step.phase, step.phase), content);
        timeline.appendChild(item);
      });
      timeline.setAttribute('data-ready', '');
    }

    function createElement(tag, className, text) {
      const el = document.createElement(tag);
      el.className = className;
      if (text !== undefined) el.textContent = text;
      return el;
    }

    function copyAiPrompt(btn, textareaId) {
      const textarea = document.getElementById(textareaId || 'aiPromptText');
      if (!textarea) return;
      const label = btn.querySelector('.ai-copy-label');
      const done = () => flashLabel(label, 'Copied!');
      const fallback = () => {
        textarea.closest('details').open = true;
        textarea.select();
        document.execCommand('copy');
        done();
      };
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(textarea.value).then(done, fallback);
      } else {
        fallback();
      }
    }

    function writeClipboard(text, done) {
      const fallback = () => {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
        done();
      };
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(done, fallback);
      } else {
        fallback();
      }
    }

    function copySpecPath(event, btn) {
      event.stopPropagation();
      writeClipboard(btn.getAttribute('data-path'), () => flashLabel(btn.querySelector('.spec-path-label'), 'Copied!'));
    }

    function copyDataText(btn) {
      writeClipboard(btn.getAttribute('data-copy'), () => flashLabel(btn.querySelector('.copy-label'), 'Copied!'));
    }

    function copyTestLink(event, btn, testId) {
      event.stopPropagation();
      writeClipboard(location.href.split('#')[0] + '#' + testId, () => flashLabel(btn.querySelector('.copy-label'), 'Copied!'));
    }

    function openTest(testId) {
      const drawer = document.getElementById(testId);
      if (!drawer || !drawer.classList.contains('test-details-drawer')) return;
      const row = drawer.closest('.test-row');
      const card = drawer.closest('.spec-card');
      if (currentView !== 'tests' || row.style.display === 'none' || card.style.display === 'none') {
        currentFilter = 'all';
        setSearch('');
      }
      showView('tests', true);
      const body = card.querySelector('.spec-card-body');
      if (body.style.display === 'none') toggleSpecCollapse(body.id);
      if (!drawer.classList.contains('open')) toggleTestDetails(testId);
      history.replaceState(null, '', '#' + testId);
      document.querySelectorAll('.test-row-highlight').forEach(el => el.classList.remove('test-row-highlight'));
      row.classList.add('test-row-highlight');
      scrollToCard(row);
    }

    let galleryBuilt = false;
    function buildGallery() {
      if (galleryBuilt) return;
      galleryBuilt = true;
      const grid = document.getElementById('galleryGrid');
      /* Only failed and flaky tests carry screenshots or recordings. */
      document.querySelectorAll('.test-row[data-state="failed"], .test-row[data-state="flaky"]').forEach(row => {
        const testId = row.querySelector('.test-details-drawer').id;
        const title = row.querySelector('.test-title-text').textContent.trim();
        const specName = row.closest('.spec-card').querySelector('.spec-name').textContent.trim();
        const state = row.getAttribute('data-state');
        row.querySelectorAll('img.screenshot-thumb').forEach(thumb => {
          grid.appendChild(galleryCard(testId, title, specName, state, thumb));
        });
        if (row.querySelector('.video-player')) grid.appendChild(galleryCard(testId, title, specName, state, null));
      });
      if (!grid.children.length) {
        const empty = document.createElement('p');
        empty.className = 'empty-state';
        empty.textContent = 'No screenshots or recordings this run.';
        grid.appendChild(empty);
      }
      fillTestDetails(grid);
    }

    function galleryCard(testId, title, specName, state, thumb) {
      const card = document.createElement('div');
      card.className = 'gallery-card';
      const media = document.createElement('button');
      media.type = 'button';
      media.className = 'gallery-media' + (thumb ? '' : ' gallery-video');
      if (thumb) {
        const img = document.createElement('img');
        const mediaId = thumb.getAttribute('data-media-id');
        if (mediaId) img.setAttribute('data-media-id', mediaId);
        else img.src = thumb.src;
        img.alt = title;
        img.loading = 'lazy';
        media.appendChild(img);
        const loader = thumb.parentElement.querySelector('.media-loader');
        if (loader) media.appendChild(loader.cloneNode(true));
        media.onclick = () => openLightbox(img.src, specName + ' › ' + title);
      } else {
        media.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
        media.append('Recording');
        media.onclick = () => openTest(testId);
      }
      const caption = document.createElement('button');
      caption.type = 'button';
      caption.className = 'gallery-caption';
      caption.title = 'Open ' + specName + ' › ' + title;
      const icon = document.querySelector('.test-row[data-state="' + state + '"] .status-icon');
      if (icon) caption.appendChild(icon.cloneNode(true));
      const label = document.createElement('span');
      label.textContent = title;
      caption.appendChild(label);
      caption.onclick = () => openTest(testId);
      card.append(media, caption);
      return card;
    }

    function printReport() {
      document.getElementById('actionsMenu').open = false;
      window.print();
    }

    function openLightbox(src, caption) {
      /* A screenshot that has not downloaded yet has no src. */
      if (!src) return;
      resetLightboxZoom();
      document.getElementById('lightboxImg').src = src;
      document.getElementById('lightboxCaption').textContent = caption;
      document.getElementById('lightboxModal').classList.add('open');
      /* A cached screenshot can be ready right away and never fire load, so size it up here too. */
      if (document.getElementById('lightboxImg').complete) markLightboxZoomable();
    }

    /* Chrome-style viewer: one click blows the shot up to full size, the next click fits it back. */
    function toggleLightboxZoom(event) {
      const img = document.getElementById('lightboxImg');
      if (img.classList.contains('zoomed')) {
        resetLightboxZoom();
        return;
      }
      if (!canZoomImage(img)) return;
      const clicked = clickRatioOnImage(img, event);
      img.classList.add('zoomed');
      scrollViewportTo(img, clicked);
    }

    /* Where the click landed, as a 0-1 ratio, so that same spot stays in view after zooming. */
    function clickRatioOnImage(img, event) {
      const bounds = img.getBoundingClientRect();
      return {
        x: (event.clientX - bounds.left) / bounds.width,
        y: (event.clientY - bounds.top) / bounds.height
      };
    }

    function scrollViewportTo(img, ratio) {
      const viewport = document.getElementById('lightboxViewport');
      viewport.scrollLeft = ratio.x * img.offsetWidth - viewport.clientWidth / 2;
      viewport.scrollTop = ratio.y * img.offsetHeight - viewport.clientHeight / 2;
    }

    function resetLightboxZoom() {
      const viewport = document.getElementById('lightboxViewport');
      document.getElementById('lightboxImg').classList.remove('zoomed');
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
      markLightboxZoomable();
    }

    /* A shot small enough to be shown whole already reveals every pixel, so it never zooms. */
    function canZoomImage(img) {
      return img.naturalWidth > img.clientWidth || img.naturalHeight > img.clientHeight;
    }

    /* Only the fitted image says whether detail is still hidden, so never measure a zoomed one. */
    function markLightboxZoomable() {
      const img = document.getElementById('lightboxImg');
      if (img.classList.contains('zoomed')) return;
      img.classList.toggle('zoomable', canZoomImage(img));
    }

    const REPORT_FILE_NAME = '${downloadFileName}';
    const EXPAND_ICON_DOWN = 'M7 13l5 5 5-5M7 6l5 5 5-5';
    const EXPAND_ICON_UP = 'M7 11l5-5 5 5M7 18l5-5 5 5';

    /* Snapshot of the whole report, so a filtered view is never what gets emailed out. */
    function buildShareableHtml() {
      const clone = document.documentElement.cloneNode(true);
      clone.querySelectorAll('.spec-card, .test-row').forEach(el => el.style.removeProperty('display'));
      clone.querySelector('#galleryGrid').replaceChildren();
      clone.querySelector('#actionsMenu').removeAttribute('open');
      clone.querySelector('#searchInput').removeAttribute('value');
      clone.querySelectorAll('.video-player').forEach(player => player.replaceChildren());
      /* What was drawn on open is rebuilt from the data blocks, which are already in the file; keeping it would double it. */
      clone.querySelectorAll('[data-ready]').forEach(el => {
        el.replaceChildren();
        el.removeAttribute('data-ready');
      });
      clone.querySelectorAll('img[data-media-id]').forEach(img => img.removeAttribute('src'));
      const clonedRail = clone.querySelector('.rail');
      clonedRail.setAttribute('inert', '');
      clonedRail.setAttribute('aria-busy', 'true');
      clone.querySelectorAll('.test-row-highlight').forEach(row => row.classList.remove('test-row-highlight'));
      return '<!DOCTYPE html>' + String.fromCharCode(10) + clone.outerHTML;
    }

    function downloadHtml(html) {
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = REPORT_FILE_NAME;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function flashLabel(label, text) {
      if (!label) return;
      const original = label.textContent;
      label.textContent = text;
      setTimeout(() => (label.textContent = original), 2000);
    }

    async function saveReportAsHtml(btn) {
      const label = btn.querySelector('.save-html-label');
      if (document.readyState === 'loading') {
        flashLabel(label, 'Still loading…');
        return;
      }
      const html = buildShareableHtml();
      if (window.showSaveFilePicker) {
        try {
          const handle = await window.showSaveFilePicker({
            suggestedName: REPORT_FILE_NAME,
            types: [{ description: 'HTML report', accept: { 'text/html': ['.html'] } }]
          });
          const writable = await handle.createWritable();
          await writable.write(html);
          await writable.close();
          flashLabel(label, 'Saved!');
          return;
        } catch (err) {
          if (err && err.name === 'AbortError') return;
        }
      }
      downloadHtml(html);
      flashLabel(label, 'Saved!');
    }

    function closeLightbox() {
      resetLightboxZoom();
      document.getElementById('lightboxModal').classList.remove('open');
    }

    document.addEventListener('keydown', e => {
      const input = document.getElementById('searchInput');
      if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA')) {
        e.preventDefault();
        input.focus();
        input.select();
      } else if (e.key === 'Escape') {
        closeLightbox();
        document.getElementById('actionsMenu').open = false;
        if (document.activeElement === input) input.blur();
      }
    });

    function syncTopBarHeight() {
      document.documentElement.style.setProperty('--top-bar-h', document.querySelector('.top-bar').offsetHeight + 'px');
    }
    window.addEventListener('resize', syncTopBarHeight);
    syncTopBarHeight();

    document.addEventListener('click', e => {
      const menu = document.getElementById('actionsMenu');
      if (menu.open && !menu.contains(e.target)) menu.open = false;
    });

    const videoUrls = {};
    function videoUrl(id) {
      if (!videoUrls[id]) {
        const dataUri = readPayload(id);
        if (!dataUri) return null;
        const binary = atob(dataUri.slice(dataUri.indexOf(',') + 1));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        videoUrls[id] = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
      }
      return videoUrls[id];
    }

    function mountVideo(player) {
      const src = videoUrl(player.getAttribute('data-video-id'));
      if (!src) return false;
      const video = document.createElement('video');
      video.src = src;
      video.preload = 'metadata';
      video.setAttribute('playsinline', '');
      player.appendChild(video);
      new Plyr(video, { loadSprite: false });
      return true;
    }

    const videoObserver = new IntersectionObserver(
      entries => entries.forEach(entry => {
        if (entry.isIntersecting && mountVideo(entry.target)) videoObserver.unobserve(entry.target);
      }),
      { rootMargin: '200px' }
    );
    document.querySelectorAll('.video-player').forEach(player => videoObserver.observe(player));

    /* Fills what is open with whatever has downloaded since it was opened. */
    function fillOpenTests() {
      document.querySelectorAll('.test-details-drawer.open, #galleryGrid').forEach(fillTestDetails);
      /* Observing again re-checks a player that came into view before its recording had downloaded. */
      document.querySelectorAll('.video-player:empty').forEach(player => {
        videoObserver.unobserve(player);
        videoObserver.observe(player);
      });
    }

    /* While the page still downloads, each screenshot and recording replaces its loader as soon as it arrives. */
    const fillTimer = setInterval(fillOpenTests, 500);
    document.addEventListener('DOMContentLoaded', () => {
      clearInterval(fillTimer);
      fillOpenTests();
    });

    applyFilters();
    const initialHash = location.hash.slice(1);
    if (initialHash.startsWith('test-')) {
      openTest(initialHash);
      window.addEventListener('load', () => setTimeout(() => openTest(initialHash), 0));
    }
    else if (FILTER_TITLES[initialHash]) setFilter(initialHash);
    else showView(VIEW_HASHES.includes(initialHash) ? initialHash : 'insights');

    /* Everything above has run, so the menu works from here on, even while screenshots and recordings still download. */
    const rail = document.querySelector('.rail');
    rail.removeAttribute('inert');
    rail.removeAttribute('aria-busy');
  </script>
${PAYLOAD_ORDER.map(kind => payloads[kind].join('\n')).join('\n')}
</body>
</html>`;
}

export interface ReportFiles {
  html?: string;
  json?: string;
  junit?: string;
  markdown?: string;
}

export interface MergeResult {
  summary: ReportSummary;
  files: ReportFiles;
}

export function reportFileBase(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'report';
}

function needsHistory(outputs: readonly ReportOutput[]): boolean {
  return outputs.includes('html') || outputs.includes('markdown');
}

function resolveOutputDir(projectDir: string, outputDir = DEFAULT_REPORTS_DIR): string {
  return isAbsolute(outputDir) ? outputDir : join(projectDir, outputDir);
}

function writeReportOutputs(
  summary: ReportSummary,
  outputDir: string,
  baseName: string,
  outputs: readonly ReportOutput[],
  reportUrl?: string
): ReportFiles {
  mkdirSync(outputDir, { recursive: true });
  const base = join(outputDir, reportFileBase(baseName));
  const files: ReportFiles = {};
  if (outputs.includes('json')) {
    files.json = `${base}.json`;
    writeReportFile(files.json, summary, s => JSON.stringify(s, null, 2));
  }
  if (outputs.includes('junit')) {
    files.junit = `${base}.junit.xml`;
    writeFileSync(files.junit, generateJUnitXml(summary), 'utf-8');
  }
  if (outputs.includes('html')) {
    files.html = `${base}.html`;
    writeReportFile(files.html, summary, generateHtmlReport);
  }
  if (outputs.includes('markdown')) {
    files.markdown = `${base}.summary.md`;
    writeMarkdownSummary(files.markdown, summary, reportUrl);
  }
  Object.values(files).forEach(file => console.log(`[neo-reporter] Wrote ${file}`));
  return files;
}

export async function generateReports(runResults: CypressCommandLine.CypressRunResult, options: ReporterOptions = {}): Promise<ReportFiles> {
  const projectDir = (runResults.config as { projectRoot?: string } | undefined)?.projectRoot ?? process.cwd();
  const outputDir = resolveOutputDir(projectDir, options.outputDir);
  const outputs = options.outputs ?? REPORT_OUTPUTS;
  const summary = buildReportSummary(runResults, projectDir, { ...options, outputDir });
  if (needsHistory(outputs)) {
    const loader = options.historyLoader === undefined ? createHistoryLoader(options.history, summary.ci?.branch) : options.historyLoader;
    await attachRunHistory(summary, loader);
  }
  return writeReportOutputs(summary, outputDir, options.reportName ?? summary.projectName, outputs, options.reportUrl);
}

function findReportJsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) return findReportJsonFiles(entryPath);
    return entry.name.endsWith('.json') && entry.name !== STEPS_FILE_NAME ? [entryPath] : [];
  });
}

function readReportJson(filePath: string): ReportSummary | null {
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8')) as ReportSummary;
    return data && Array.isArray(data.specs) && typeof data.totalTests === 'number' ? data : null;
  } catch (error) {
    console.warn(`[neo-reporter] Skipping unreadable report file ${filePath}: ${error}`);
    return null;
  }
}

export async function mergeReports(options: MergeOptions = {}): Promise<MergeResult | null> {
  assertTimeZone(options.timeZone);
  const reportRoot = resolve(options.reportRoot ?? DEFAULT_REPORTS_DIR);
  const summaries = (options.summaryFiles ?? findReportJsonFiles(reportRoot))
    .map(readReportJson)
    .filter((summary): summary is ReportSummary => summary !== null && !summary.mergedFrom);
  if (summaries.length === 0) {
    console.warn(`[neo-reporter] No report JSON found under ${reportRoot}. Keep the 'json' output on for every run you want to merge.`);
    return null;
  }

  const [first] = summaries;
  const specs = summaries.flatMap(summary => summary.specs);
  const total = (pick: (summary: ReportSummary) => number) => summaries.reduce((sum, summary) => sum + (pick(summary) || 0), 0);
  const latest = (pick: (summary: ReportSummary) => string) => summaries.map(pick).filter(Boolean).pop() ?? '';
  const totalTests = total(summary => summary.totalTests);
  const totalPassed = total(summary => summary.totalPassed);

  const merged: ReportSummary = {
    projectName: options.projectName ?? first.projectName,
    timestamp: new Date().toISOString(),
    browser: latest(summary => summary.browser),
    environment: latest(summary => summary.environment),
    resolution: latest(summary => summary.resolution),
    totalDurationMs: total(summary => summary.totalDurationMs),
    totalSpecs: specs.length,
    totalTests,
    totalPassed,
    totalFailed: total(summary => summary.totalFailed),
    totalPending: total(summary => summary.totalPending),
    totalSkipped: total(summary => summary.totalSkipped),
    passRate: computePassRate(totalPassed, totalTests),
    specs: capEmbeddedVideos(specs),
    suiteLabel: options.reportName ?? first.suiteLabel,
    ci: summaries.find(summary => summary.ci)?.ci,
    teamName: options.showTeamName === false ? undefined : options.teamName?.trim() || first.teamName,
    timeZone: options.timeZone ?? first.timeZone,
    theme: options.theme ?? first.theme,
    mergedFrom: summaries.length
  };

  const outputs = options.outputs ?? MERGE_OUTPUTS;
  if (needsHistory(outputs)) await attachRunHistory(merged, createHistoryLoader(options.history, merged.ci?.branch));
  const outputDir = options.outputDir ? resolve(options.outputDir) : reportRoot;
  const files = writeReportOutputs(merged, outputDir, merged.suiteLabel || merged.projectName, outputs, options.reportUrl);
  console.log(`[neo-reporter] Merged ${summaries.length} reports`);
  return { summary: merged, files };
}

export function neoReporter(on: Cypress.PluginEvents, config: Cypress.PluginConfigOptions, options: NeoReporterOptions = {}): void {
  assertTimeZone(options.timeZone);
  const outputDir = resolveOutputDir(config.projectRoot, options.outputDir);
  const stepsFilePath = join(outputDir, STEPS_FILE_NAME);
  let historyLoader: HistoryLoader | null = null;

  on('before:run', () => {
    rmSync(stepsFilePath, { force: true });
    if (needsHistory(options.outputs ?? REPORT_OUTPUTS)) {
      historyLoader = createHistoryLoader(options.history, readCiInfo(config.projectRoot).branch);
    }
  });

  on('task', {
    [RECORD_TASK](data: RecordedTestPayload) {
      historyLoader?.warm(data.fullTitle.replace(/ › /g, ' '));
      mkdirSync(outputDir, { recursive: true });
      const map = readRecordedTests([stepsFilePath]);
      const { fullTitle, ...recorded } = data;
      map[fullTitle] = {
        ...recorded,
        attempt: map[fullTitle]?.attempt ?? recorded.attempt,
        code: map[fullTitle]?.code ?? recorded.code,
        firstError: map[fullTitle]?.firstError ?? recorded.firstError,
        network: map[fullTitle]?.network ?? recorded.network,
        consoleErrors: map[fullTitle]?.consoleErrors ?? recorded.consoleErrors
      };
      writeFileSync(stepsFilePath, JSON.stringify(map, null, 2), 'utf-8');
      return null;
    }
  });

  if (config.video) {
    const tools = bundledVideoTools(config.cypressBinaryRoot);
    if (!tools) {
      console.warn(`[neo-reporter] ffmpeg not found under ${config.cypressBinaryRoot}; failed-spec videos stay uncompressed.`);
    }

    on('after:spec', (spec, results) => {
      if (!results?.video || !existsSync(results.video)) return;
      recordedSpecVideos.set(spec.absolute, results.video);
      const tests = results.tests ?? [];
      if (!tests.some(test => test.attempts?.some(attempt => attempt.state === 'failed'))) {
        rmSync(results.video, { force: true });
        return;
      }
      if (!tools) return;
      if (cutFailedTestVideos(tools, results.video, tests, readRecordedTests([stepsFilePath]))) rmSync(results.video, { force: true });
      else compressVideo(tools.ffmpeg, results.video);
    });
  }

  on('after:run', async results => {
    if ('runs' in results) {
      await generateReports(results, { ...options, outputDir, stepsFilePath, historyLoader });
      rmSync(stepsFilePath, { force: true });
    }
  });
}
