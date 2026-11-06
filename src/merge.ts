import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { computePassRate } from './format';
import { attachRunHistory, createBaselineHistoryLoader, createHistoryLoader } from './history';
import { packageVersion } from './html/assets';
import { needsHistory, writeReportOutputs, type ReportFiles } from './output';
import { applyRedaction } from './redact';
import { capEmbeddedVideos } from './summary';
import { DEFAULT_REPORTS_DIR, MERGE_OUTPUTS, SCHEMA_VERSION, STEPS_FILE_NAME, type MergeOptions, type ReportSummary } from './types';
import { validateOptions } from './validate';

export interface MergeResult {
  summary: ReportSummary;
  files: ReportFiles;
}

function findReportJsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) return findReportJsonFiles(entryPath);
    return entry.name.endsWith('.json') && entry.name !== STEPS_FILE_NAME ? [entryPath] : [];
  });
}

const THEMES = ['auto', 'light', 'dark'];
const TEST_STATES = ['passed', 'flaky', 'failed', 'pending', 'skipped'];
const isNumber = (value: unknown) => typeof value === 'number';

function hasValidFields(data: ReportSummary): boolean {
  return (
    (data.theme === undefined || THEMES.includes(data.theme)) &&
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

function readReportJson(filePath: string): ReportSummary | null {
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8')) as ReportSummary;
    if (!data || !Array.isArray(data.specs) || typeof data.totalTests !== 'number') return null;
    if (!hasValidFields(data)) {
      console.warn(`[neo-reporter] Skipping report file ${filePath}: unexpected field values`);
      return null;
    }
    if (!data.mergedFrom && data.schemaVersion !== SCHEMA_VERSION) {
      console.warn(`[neo-reporter] ${filePath} uses report schema ${data.schemaVersion ?? 'none'} (reporter ${data.reporterVersion ?? 'unknown'}), expected ${SCHEMA_VERSION}. The merged report may be incomplete.`);
    }
    return data;
  } catch (error) {
    console.warn(`[neo-reporter] Skipping unreadable report file ${filePath}: ${error}`);
    return null;
  }
}

export async function mergeReports(options: MergeOptions = {}): Promise<MergeResult | null> {
  validateOptions(options);
  const reportRoot = resolve(options.reportRoot ?? DEFAULT_REPORTS_DIR);
  const baselinePath = options.baseline && resolve(options.baseline);
  const baseline = baselinePath ? readReportJson(baselinePath) : null;
  if (baselinePath && !baseline) throw new Error(`Cannot read the baseline report ${baselinePath}`);
  const summaries = (options.summaryFiles ?? findReportJsonFiles(reportRoot))
    .filter(file => resolve(file) !== baselinePath)
    .map(readReportJson)
    .filter((summary): summary is ReportSummary => summary !== null && !summary.mergedFrom)
    .map(summary => applyRedaction(summary, options));
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
    schemaVersion: SCHEMA_VERSION,
    reporterVersion: packageVersion(),
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
  if (needsHistory(outputs)) {
    const loader =
      baseline && baselinePath
        ? createBaselineHistoryLoader(baseline, basename(baselinePath))
        : createHistoryLoader(options.history, merged.ci?.branch, process.cwd(), summaries.map(summary => summary.timestamp));
    await attachRunHistory(merged, loader);
  }
  const outputDir = options.outputDir ? resolve(options.outputDir) : reportRoot;
  const files = writeReportOutputs(merged, outputDir, merged.suiteLabel || merged.projectName, outputs, options.reportUrl);
  console.log(`[neo-reporter] Merged ${summaries.length} reports`);
  return { summary: merged, files };
}
