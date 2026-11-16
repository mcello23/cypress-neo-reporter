/// <reference types="cypress" preserve="true" />
import type { ReportFiles } from './output';
import { generateReports as writeRunReports } from './reporter';
import type { NeoReporterOptions } from './types';
import { validateOptions } from './validate';

export type {
  ReportSummary,
  SpecData,
  TestData,
  NeoReporterOptions,
  MergeOptions,
  RemoteLanesOptions,
  HistoryOptions,
  ReportOutput,
  ReportTheme,
  RunHistory,
  HistoryRun,
  LaneSummary,
  CiInfo,
  TestStep,
  TestAttempt,
  EmbeddedFile,
  NetworkFailure,
  RecordedTestPayload
} from './types';
export type { ReportFiles } from './output';
export { neoReporter, createNeoReporter } from './reporter';
export { mergeReports, type MergeResult } from './merge';
export { generateHtmlReport } from './html';
export { generateMarkdownSummary } from './markdown';
export { generateJUnitXml } from './junit';

export async function generateReports(runResults: CypressCommandLine.CypressRunResult, options: NeoReporterOptions = {}): Promise<ReportFiles> {
  validateOptions(options);
  return writeRunReports(runResults, options);
}
