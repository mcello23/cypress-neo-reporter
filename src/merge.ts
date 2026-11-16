import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { downloadBlobJson, listBlobNames, maskSas, parseBlobFolder } from './blob';
import { computePassRate, reportHtmlFile } from './format';
import { attachRunHistory, createBaselineHistoryLoader, createHistoryLoader, mapWithLimit, releaseStageTestsUrl } from './history';
import { packageVersion } from './html/assets';
import { generateCarrierJUnit } from './junit';
import { buildRunSummaryText, type MarkdownExtras } from './markdown';
import { needsHistory, runFileBase, toSlimSummary, writeReportOutputs, type ReportFiles } from './output';
import { collectFailureGroups } from './prompts';
import { applyRedaction } from './redact';
import { evidenceFiles } from './summary';
import {
  DEFAULT_LANES_REPORT_NAME,
  DEFAULT_REPORTS_DIR,
  MERGE_OUTPUTS,
  REPORT_THEMES,
  SCHEMA_VERSION,
  type EmbeddedFile,
  type HistoryLoader,
  type LaneSummary,
  type MergeOptions,
  type RemoteLanesOptions,
  type ReporterOptions,
  type ReportSummary,
  type RunHistory
} from './types';
import { MERGE_OPTION_KEYS, validateOptions } from './validate';

export interface MergeResult {
  summary: ReportSummary;
  files: ReportFiles;
}

function findReportJsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) return findReportJsonFiles(entryPath);
    if (entry.name.endsWith('.summary.json') && existsSync(entryPath.replace(/\.summary\.json$/, '.json'))) return [];
    return entry.name.endsWith('.json') ? [entryPath] : [];
  });
}

const TEST_STATES = ['passed', 'flaky', 'failed', 'pending', 'skipped'];
const isNumber = (value: unknown) => typeof value === 'number';

function hasValidFields(data: ReportSummary): boolean {
  return (
    (data.theme === undefined || REPORT_THEMES.includes(data.theme)) &&
    (data.css === undefined || typeof data.css === 'string') &&
    (data.fileName === undefined || typeof data.fileName === 'string') &&
    [data.totalPassed, data.totalFailed, data.totalPending, data.totalSkipped, data.totalDurationMs].every(isNumber) &&
    data.specs.every(
      spec =>
        Array.isArray(spec.tests) &&
        [spec.duration, spec.passes, spec.failures, spec.pending, spec.skipped, spec.total].every(isNumber) &&
        spec.tests.every(
          test => TEST_STATES.includes(test.state) && isNumber(test.duration) && (test.network ?? []).every(request => isNumber(request.status))
        )
    )
  );
}

function isReportShape(data: unknown): data is ReportSummary {
  return Array.isArray((data as ReportSummary | null)?.specs) && typeof (data as ReportSummary).totalTests === 'number';
}

export function parseReportSummary(data: unknown, source: string): ReportSummary | null {
  if (!isReportShape(data)) return null;
  if (!hasValidFields(data)) {
    console.warn(`[neo-reporter] Skipping report file ${source}: unexpected field values`);
    return null;
  }
  if (!data.mergedFrom && data.schemaVersion !== SCHEMA_VERSION) {
    console.warn(`[neo-reporter] ${source} uses report schema ${data.schemaVersion ?? 'none'} (reporter ${data.reporterVersion ?? 'unknown'}), expected ${SCHEMA_VERSION}. The merged report may be incomplete.`);
  }
  return data;
}

function readReportJson(filePath: string): ReportSummary | null {
  try {
    const data = parseReportSummary(JSON.parse(readFileSync(filePath, 'utf-8')), filePath);
    if (!data) return null;
    const dir = dirname(filePath);
    const usable = (file: EmbeddedFile) => {
      const path = relative(dir, resolve(dir, file.path));
      return Boolean(file.base64) || !(path.startsWith('..') || isAbsolute(path));
    };
    data.specs.forEach(spec => {
      if (spec.video && !usable(spec.video)) delete spec.video;
      spec.tests.forEach(test => {
        test.screenshots = test.screenshots?.filter(usable);
        if (test.video && !usable(test.video)) delete test.video;
      });
    });
    evidenceFiles(data.specs).forEach(({ file }) => (file.path = resolve(dir, file.path)));
    return data;
  } catch (error) {
    console.warn(`[neo-reporter] Skipping unreadable report file ${filePath}: ${error}`);
    return null;
  }
}

function laneSummaries(summaries: ReportSummary[], minLanes: number): LaneSummary[] | undefined {
  const byLabel = new Map<string, ReportSummary[]>();
  summaries.forEach(summary => {
    const label = summary.suiteLabel || summary.projectName;
    byLabel.set(label, [...(byLabel.get(label) ?? []), summary]);
  });
  if (byLabel.size < minLanes) return undefined;
  return [...byLabel]
    .map(([label, lane]) => {
      const tests = lane.flatMap(summary => summary.specs.flatMap(spec => spec.tests));
      const sum = (pick: (summary: ReportSummary) => number) => lane.reduce((total, summary) => total + (pick(summary) || 0), 0);
      const flaky = tests.filter(test => test.state === 'flaky').length;
      const total = sum(summary => summary.totalTests);
      const passed = sum(summary => summary.totalPassed);
      return {
        label,
        file: reportHtmlFile(lane[0]),
        failed: tests.filter(test => test.state === 'failed').length,
        flaky,
        passed: passed - flaky,
        total,
        passRate: computePassRate(passed, total),
        durationMs: sum(summary => summary.totalDurationMs)
      };
    })
    .sort((a, b) => b.failed - a.failed || b.flaky - a.flaky || a.label.localeCompare(b.label));
}

function laneHistory(summaries: ReportSummary[]): RunHistory | undefined {
  const histories = summaries.map(summary => summary.history).filter((history): history is RunHistory => Boolean(history));
  if (histories.length === 0 || histories.length < summaries.length || histories.some(history => history.family !== histories[0].family)) return undefined;
  return {
    ...histories[0],
    tests: Object.assign({}, ...histories.map(history => history.tests)),
    durations: Object.assign({}, ...histories.map(history => history.durations))
  };
}

interface BaselineReport {
  summary: ReportSummary;
  source: string;
}

async function combineReports(
  summaries: ReportSummary[],
  options: MergeOptions,
  target: { outputDir: string; historyLoader?: HistoryLoader | null; baseline?: BaselineReport; markdown?: MarkdownExtras; minLanes?: number }
): Promise<MergeResult> {
  const [first] = summaries;
  const specs = summaries
    .flatMap(summary => summary.specs)
    .sort((a, b) => a.specFile.localeCompare(b.specFile) || (a.browser ?? '').localeCompare(b.browser ?? ''));
  const runsPerSpec = new Map<string, number>();
  specs.forEach(spec => {
    const key = [spec.specFile, spec.browser, spec.testingType].filter(Boolean).join(' · ');
    runsPerSpec.set(key, (runsPerSpec.get(key) ?? 0) + 1);
  });
  const repeated = [...runsPerSpec].filter(([, count]) => count > 1);
  if (repeated.length) {
    console.warn(
      `[neo-reporter] ${repeated.map(([key, count]) => `${key} (${count}×)`).join(', ')} ran in more than one merged report, and every run is counted. Remove the extra JSON files if they are copies of one run.`
    );
  }
  const total = (pick: (summary: ReportSummary) => number) => summaries.reduce((sum, summary) => sum + (pick(summary) || 0), 0);
  const latest = (pick: (summary: ReportSummary) => string) => summaries.map(pick).filter(Boolean).pop() ?? '';
  const totalTests = total(summary => summary.totalTests);
  const totalPassed = total(summary => summary.totalPassed);
  const lanes = laneSummaries(summaries, target.minLanes ?? 2);

  const merged: ReportSummary = {
    schemaVersion: SCHEMA_VERSION,
    reporterVersion: packageVersion(),
    projectName: options.projectName ?? first.projectName,
    timestamp: summaries.map(summary => summary.timestamp).sort().pop() ?? new Date().toISOString(),
    browser: [...new Set(summaries.map(summary => summary.browser).filter(Boolean))].join(', '),
    environment: lanes ? [...new Set(summaries.map(summary => summary.environment).filter(Boolean))].join(', ') : latest(summary => summary.environment),
    resolution: latest(summary => summary.resolution),
    totalDurationMs: total(summary => summary.totalDurationMs),
    totalSpecs: specs.length,
    totalTests,
    totalPassed,
    totalFailed: total(summary => summary.totalFailed),
    totalPending: total(summary => summary.totalPending),
    totalSkipped: total(summary => summary.totalSkipped),
    passRate: computePassRate(totalPassed, totalTests),
    specs,
    suiteLabel: options.reportName ?? first.suiteLabel,
    fileName: options.fileName ?? (options.reportName === undefined ? first.fileName : undefined),
    ci: summaries.find(summary => summary.ci)?.ci,
    teamName: options.showTeamName === false ? undefined : options.teamName?.trim() || first.teamName,
    timeZone: options.timeZone ?? first.timeZone,
    theme: options.theme ?? first.theme,
    css: options.css ?? first.css,
    mergedFrom: summaries.length,
    lanes
  };

  const outputs = options.outputs ?? MERGE_OUTPUTS;
  if (needsHistory(outputs)) {
    const loader =
      target.historyLoader !== undefined
        ? target.historyLoader
        : target.baseline
          ? createBaselineHistoryLoader(target.baseline.summary, target.baseline.source)
          : createHistoryLoader(options.history, merged.ci?.branch, process.cwd(), summaries.map(summary => summary.timestamp));
    await attachRunHistory(merged, loader);
    if (!merged.history && merged.lanes && options.history !== false) merged.history = laneHistory(summaries);
  }
  const files = writeReportOutputs(merged, target.outputDir, merged.fileName || merged.suiteLabel || merged.projectName, outputs, {
    ...options,
    summaryDir: options.summaryDir && resolve(options.summaryDir),
    markdown: target.markdown
  });
  console.log(`[neo-reporter] Merged ${summaries.length} reports`);
  return { summary: merged, files };
}

const LANE_DOWNLOAD_CONCURRENCY = 4;

function runLabel(summary: ReportSummary): string | undefined {
  return summary.ci?.release || summary.ci?.build;
}

function blobSas(lanes: RemoteLanesOptions): string | undefined {
  return (lanes.sas ?? process.env.NEO_BLOB_SAS)?.replace(/^\?/, '') || undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readRemoteLanes(
  lanes: RemoteLanesOptions,
  sas: string,
  options: ReporterOptions,
  run?: string,
  ownFile?: string
): Promise<ReportSummary[]> {
  const folder = parseBlobFolder(lanes.azureBlob);
  const names = (await listBlobNames(folder, sas)).filter(name => name.endsWith('.summary.json') && name.split('/').pop() !== ownFile).sort();
  const summaries = await mapWithLimit(names, LANE_DOWNLOAD_CONCURRENCY, async name => {
    try {
      const data = await downloadBlobJson(folder, sas, name);
      if (!isReportShape(data)) {
        console.warn(maskSas(`[neo-reporter] Skipping lane summary ${name}: not a neo-reporter report`));
        return null;
      }
      return parseReportSummary(data, name);
    } catch (error) {
      console.warn(maskSas(`[neo-reporter] Skipping lane summary ${name}: ${errorMessage(error)}`));
      return null;
    }
  });
  return summaries
    .filter((summary): summary is ReportSummary => summary !== null && !summary.mergedFrom && (run === undefined || runLabel(summary) === run))
    .map(summary => applyRedaction(toSlimSummary(summary), options));
}

async function writeLanesReport(
  summaries: ReportSummary[],
  options: MergeOptions,
  lanes: RemoteLanesOptions,
  target: {
    name: string;
    fileName?: string;
    outputDir: string;
    baseDir: string;
    projectName?: string;
    testsUrl?: string;
    publish: boolean;
    historyLoader?: HistoryLoader | null;
    baseline?: BaselineReport;
  }
): Promise<MergeResult> {
  const testName = lanes.junit?.testName ?? target.name;
  const label = lanes.junit ? `🧪 Open "${testName}" in ${lanes.releaseStage} → Tests` : `🧪 Open ${lanes.releaseStage} → Tests`;
  const result = await combineReports(
    summaries,
    { ...options, reportName: target.name, fileName: target.fileName, projectName: target.projectName ?? options.projectName },
    {
      outputDir: target.outputDir,
      historyLoader: target.historyLoader,
      baseline: target.baseline,
      markdown: { link: target.testsUrl ? { label, url: target.testsUrl } : undefined, publish: target.publish },
      minLanes: 1
    }
  );
  const { html } = result.files;
  if (lanes.junit && html) {
    const merged = result.summary;
    const junitPath = resolve(target.baseDir, lanes.junit.path);
    const summaryText = buildRunSummaryText(merged, `${merged.projectName} - ${merged.suiteLabel}`, collectFailureGroups(merged)).replace(/\[\[(?=\s*ATTACHMENT\s*\|)/gi, '[ [');
    const text = `${summaryText}\n\nFull report: attached as ${basename(html)}\n[[ATTACHMENT|${relative(dirname(junitPath), html).split(sep).join('/')}]]`;
    const xml = generateCarrierJUnit(testName, merged.timestamp, text);
    mkdirSync(dirname(junitPath), { recursive: true });
    writeFileSync(junitPath, xml, 'utf-8');
    console.log(`[neo-reporter] Wrote ${junitPath} (${Math.ceil(Buffer.byteLength(xml) / 1024)} KB)`);
  }
  return result;
}

export async function rollingLanesAppendix(
  summary: ReportSummary,
  baseName: string,
  options: ReporterOptions,
  dirs: { projectDir: string; outputDir: string }
): Promise<string | undefined> {
  const own = toSlimSummary(summary);
  const lanes = options.remoteLanes;
  if (!lanes) return undefined;
  const run = lanes.run ?? runLabel(summary);
  if (!run) {
    console.log('[neo-reporter] Lanes report skipped: this run has no CI release or build to match other lanes by. Set remoteLanes.run to choose one.');
    return undefined;
  }
  const sas = blobSas(lanes);
  if (!sas) {
    console.warn('[neo-reporter] Lanes report skipped: set NEO_BLOB_SAS, or remoteLanes.sas, to a SAS with read and list permissions.');
    return undefined;
  }
  try {
    const [remote, testsUrl] = await Promise.all([
      readRemoteLanes(lanes, sas, options, run, `${runFileBase(summary, baseName)}.summary.json`),
      lanes.releaseStage ? releaseStageTestsUrl(lanes.releaseStage) : undefined
    ]);
    const { files } = await writeLanesReport([own, ...remote], { ...options, outputs: MERGE_OUTPUTS }, lanes, {
      name: lanes.reportName ?? DEFAULT_LANES_REPORT_NAME,
      fileName: lanes.fileName,
      outputDir: dirs.outputDir,
      baseDir: dirs.projectDir,
      projectName: lanes.projectName ?? summary.projectName,
      testsUrl,
      publish: false,
      historyLoader: null
    });
    if (remote.length === 0) console.log('[neo-reporter] No other lane found in the Azure Blob Storage folder yet.');
    return files.markdown && readFileSync(files.markdown, 'utf-8');
  } catch (error) {
    console.warn(maskSas(`[neo-reporter] Lanes report not written: ${errorMessage(error)}`));
    return undefined;
  }
}

async function mergeRemoteLanes(options: MergeOptions, lanes: RemoteLanesOptions, baseline?: BaselineReport): Promise<MergeResult | null> {
  const sas = blobSas(lanes);
  if (!sas) throw new Error('[neo-reporter] Set NEO_BLOB_SAS, or remoteLanes.sas, to a SAS with read and list permissions.');
  const [summaries, testsUrl] = await Promise.all([
    readRemoteLanes(lanes, sas, options, lanes.run),
    lanes.releaseStage ? releaseStageTestsUrl(lanes.releaseStage) : undefined
  ]);
  if (summaries.length === 0) {
    const { origin, container, prefix } = parseBlobFolder(lanes.azureBlob);
    console.warn(maskSas(`[neo-reporter] No lane summaries${lanes.run ? ` of ${lanes.run}` : ''} under ${origin}/${container}/${prefix}`));
    return null;
  }
  return writeLanesReport(summaries, options, lanes, {
    name: options.reportName ?? lanes.reportName ?? DEFAULT_LANES_REPORT_NAME,
    fileName: options.fileName ?? lanes.fileName,
    outputDir: resolve(options.outputDir ?? DEFAULT_REPORTS_DIR),
    baseDir: process.cwd(),
    projectName: options.projectName ?? lanes.projectName,
    testsUrl,
    publish: true,
    baseline
  });
}

export async function mergeReports(options: MergeOptions = {}): Promise<MergeResult | null> {
  validateOptions(options, MERGE_OPTION_KEYS);
  if (options.remoteLanes && (options.reportRoot || options.summaryFiles)) {
    throw new Error('[neo-reporter] remoteLanes reads the lane summaries from Azure Blob Storage, so leave out reportRoot and summaryFiles.');
  }
  const reportRoot = resolve(options.reportRoot ?? DEFAULT_REPORTS_DIR);
  const baselinePath = options.baseline && resolve(options.baseline);
  const baseline = baselinePath ? readReportJson(baselinePath) : null;
  if (baselinePath && !baseline) throw new Error(`Cannot read the baseline report ${baselinePath}`);
  const baselineReport = baseline && baselinePath ? { summary: baseline, source: basename(baselinePath) } : undefined;
  if (options.remoteLanes) return mergeRemoteLanes(options, options.remoteLanes, baselineReport);
  const summaries = (options.summaryFiles ?? findReportJsonFiles(reportRoot).sort())
    .filter(file => resolve(file) !== baselinePath)
    .map(readReportJson)
    .filter((summary): summary is ReportSummary => summary !== null && !summary.mergedFrom)
    .map(summary => applyRedaction(summary, options));
  if (summaries.length === 0) {
    console.warn(`[neo-reporter] No report JSON found under ${reportRoot}. Keep the 'json' output on for every run you want to merge.`);
    return null;
  }
  return combineReports(summaries, options, { outputDir: options.outputDir ? resolve(options.outputDir) : reportRoot, baseline: baselineReport });
}
