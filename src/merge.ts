import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { assertTimeZone, computePassRate } from './format';
import { attachRunHistory, createHistoryLoader } from './history';
import { packageVersion } from './html/assets';
import { needsHistory, writeReportOutputs, type ReportFiles } from './output';
import { capEmbeddedVideos } from './summary';
import { DEFAULT_REPORTS_DIR, MERGE_OUTPUTS, SCHEMA_VERSION, STEPS_FILE_NAME, type MergeOptions, type ReportSummary } from './types';

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

function readReportJson(filePath: string): ReportSummary | null {
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8')) as ReportSummary;
    if (!data || !Array.isArray(data.specs) || typeof data.totalTests !== 'number') return null;
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
  if (needsHistory(outputs)) await attachRunHistory(merged, createHistoryLoader(options.history, merged.ci?.branch));
  const outputDir = options.outputDir ? resolve(options.outputDir) : reportRoot;
  const files = writeReportOutputs(merged, outputDir, merged.suiteLabel || merged.projectName, outputs, options.reportUrl);
  console.log(`[neo-reporter] Merged ${summaries.length} reports`);
  return { summary: merged, files };
}
