/// <reference types="cypress" preserve="true" />
import { generateReports as writeRunReports, type ReportFiles } from './output';
import type { NeoReporterOptions } from './types';

export type {
  ReportSummary,
  SpecData,
  TestData,
  NeoReporterOptions,
  MergeOptions,
  HistoryOptions,
  ReportOutput,
  ReportTheme
} from './types';
export type { ReportFiles } from './output';
export { neoReporter } from './reporter';
export { mergeReports, type MergeResult } from './merge';
export { generateHtmlReport } from './html';
export { generateMarkdownSummary } from './markdown';
export { generateJUnitXml } from './junit';

export function generateReports(runResults: CypressCommandLine.CypressRunResult, options: NeoReporterOptions = {}): Promise<ReportFiles> {
  return writeRunReports(runResults, options);
}
