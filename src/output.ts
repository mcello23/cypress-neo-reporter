import { copyFileSync, writeFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, isAbsolute, basename } from 'node:path';
import { toEmbeddedFile } from './format';
import { attachRunHistory, createHistoryLoader } from './history';
import { generateHtmlReport } from './html';
import { generateJUnitXml } from './junit';
import { writeMarkdownSummary } from './markdown';
import { applyRedaction } from './redact';
import { buildReportSummary, evidenceFiles, stripEmbed } from './summary';
import {
  DEFAULT_MAX_EMBED_MB,
  DEFAULT_REPORTS_DIR,
  REPORT_OUTPUTS,
  type ReporterOptions,
  type ReportOutput,
  type ReportSummary,
  type SpecData
} from './types';

const MB = 1024 * 1024;

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

function embedEvidence(specs: SpecData[], maxEmbedMb = DEFAULT_MAX_EMBED_MB): void {
  let budget = maxEmbedMb * MB;
  let droppedCount = 0;
  let droppedChars = 0;
  for (const { file, mimeType } of evidenceFiles(specs).sort((a, b) => a.rank - b.rank)) {
    const base64 = file.base64 ?? toEmbeddedFile(file.path, mimeType).base64;
    delete file.base64;
    if (!base64) continue;
    if (base64.length > budget) {
      droppedCount++;
      droppedChars += base64.length;
      continue;
    }
    budget -= base64.length;
    file.base64 = base64;
  }
  if (droppedCount) {
    console.warn(
      `[neo-reporter] ${droppedCount} screenshots or recordings (${(droppedChars / MB).toFixed(1)} MB) are not embedded, to keep the report under maxEmbedMb (${maxEmbedMb} MB). Raise maxEmbedMb, or set assets: 'folder' to keep them next to the report.`
    );
  }
}

function copyEvidence(specs: SpecData[], outputDir: string, assetsDir: string): void {
  const files = evidenceFiles(specs);
  rmSync(join(outputDir, assetsDir), { recursive: true, force: true });
  if (files.length) mkdirSync(join(outputDir, assetsDir), { recursive: true });
  files.forEach(({ file }, index) => {
    const target = `${assetsDir}/${index + 1}-${reportFileBase(file.name)}`;
    try {
      if (file.base64) writeFileSync(join(outputDir, target), Buffer.from(file.base64.slice(file.base64.indexOf(',') + 1), 'base64'));
      else copyFileSync(file.path, join(outputDir, target));
      file.path = target;
      delete file.base64;
    } catch (error) {
      console.warn(`[neo-reporter] Copying ${file.name} to ${assetsDir} failed: ${error}`);
    }
  });
}

function shardId(summary: ReportSummary): string {
  const identity = [summary.browser, summary.environment, summary.resolution, ...summary.specs.map(spec => spec.specFile).sort()];
  return createHash('sha1').update(identity.join('\n')).digest('hex').slice(0, 8);
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
  options: Pick<ReporterOptions, 'reportUrl' | 'assets' | 'maxEmbedMb'> = {}
): ReportFiles {
  mkdirSync(outputDir, { recursive: true });
  const base = join(outputDir, reportFileBase(baseName));
  const jsonBase = summary.mergedFrom ? base : `${base}.${shardId(summary)}`;
  if (outputs.includes('html') || outputs.includes('json')) {
    if (options.assets === 'folder') copyEvidence(summary.specs, outputDir, `${basename(jsonBase)}-assets`);
    else embedEvidence(summary.specs, options.maxEmbedMb);
  }
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
  write('json', `${jsonBase}.json`, file => writeReportFile(file, summary, s => JSON.stringify(s, null, 2)));
  write('junit', `${base}.junit.xml`, file => writeFileSync(file, generateJUnitXml(summary), 'utf-8'));
  write('html', `${base}.html`, file => writeReportFile(file, summary, generateHtmlReport));
  write('markdown', `${base}.summary.md`, file => writeMarkdownSummary(file, summary, options.reportUrl));
  Object.values(files).forEach(file => {
    const size = statSync(file).size;
    console.log(`[neo-reporter] Wrote ${file} (${size < MB ? `${Math.ceil(size / 1024)} KB` : `${(size / MB).toFixed(1)} MB`})`);
  });
  if (Object.keys(files).length === 0) console.warn(`[neo-reporter] No report file written to ${outputDir}.`);
  return files;
}

export async function generateReports(runResults: CypressCommandLine.CypressRunResult, options: ReporterOptions = {}): Promise<ReportFiles> {
  const projectDir = (runResults.config as { projectRoot?: string } | undefined)?.projectRoot ?? process.cwd();
  const outputDir = resolveOutputDir(projectDir, options.outputDir);
  const outputs = options.outputs ?? REPORT_OUTPUTS;
  const summary = applyRedaction(buildReportSummary(runResults, projectDir, { ...options, outputDir }), options);
  if (needsHistory(outputs)) {
    const loader =
      options.historyLoader === undefined ? createHistoryLoader(options.history, summary.ci?.branch, projectDir) : options.historyLoader;
    await attachRunHistory(summary, loader);
  }
  return writeReportOutputs(summary, outputDir, options.reportName ?? summary.projectName, outputs, options);
}
