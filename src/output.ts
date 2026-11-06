import { writeFileSync, mkdirSync } from 'node:fs';
import { join, isAbsolute, basename } from 'node:path';
import { attachRunHistory, createHistoryLoader } from './history';
import { generateHtmlReport } from './html';
import { generateJUnitXml } from './junit';
import { writeMarkdownSummary } from './markdown';
import { buildReportSummary, stripEmbed } from './summary';
import { DEFAULT_REPORTS_DIR, REPORT_OUTPUTS, type ReporterOptions, type ReportOutput, type ReportSummary } from './types';

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

export interface ReportFiles {
  html?: string;
  json?: string;
  junit?: string;
  markdown?: string;
}

export function reportFileBase(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'report';
}

export function needsHistory(outputs: readonly ReportOutput[]): boolean {
  return outputs.includes('html') || outputs.includes('markdown');
}

export function resolveOutputDir(projectDir: string, outputDir = DEFAULT_REPORTS_DIR): string {
  return isAbsolute(outputDir) ? outputDir : join(projectDir, outputDir);
}

export function writeReportOutputs(
  summary: ReportSummary,
  outputDir: string,
  baseName: string,
  outputs: readonly ReportOutput[],
  reportUrl?: string
): ReportFiles {
  mkdirSync(outputDir, { recursive: true });
  const base = join(outputDir, reportFileBase(baseName));
  const files: ReportFiles = {};
  const write = (output: ReportOutput, file: string, writeFile: (file: string) => void): void => {
    if (!outputs.includes(output)) return;
    try {
      writeFile(file);
      files[output] = file;
    } catch (error) {
      console.warn(`[neo-reporter] Writing ${file} failed: ${error}`);
    }
  };
  write('json', `${base}.json`, file => writeReportFile(file, summary, s => JSON.stringify(s, null, 2)));
  write('junit', `${base}.junit.xml`, file => writeFileSync(file, generateJUnitXml(summary), 'utf-8'));
  write('html', `${base}.html`, file => writeReportFile(file, summary, generateHtmlReport));
  write('markdown', `${base}.summary.md`, file => writeMarkdownSummary(file, summary, reportUrl));
  Object.values(files).forEach(file => console.log(`[neo-reporter] Wrote ${file}`));
  if (Object.keys(files).length === 0) console.warn(`[neo-reporter] No report file written to ${outputDir}.`);
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
