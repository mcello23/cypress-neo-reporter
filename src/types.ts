export const SPEC_OWNERS_FILE_NAME = 'spec-owners.json';
export const DEFAULT_REPORTS_DIR = 'cypress/reports';
export const REPORT_OUTPUTS = ['html', 'json', 'junit', 'markdown'] as const;
export const MERGE_OUTPUTS = ['html', 'markdown'] as const;
export const SCHEMA_VERSION = 1;
export const DEFAULT_MAX_EMBED_MB = 150;

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
  redact?: false | { patterns?: RegExp[]; replace?: (text: string) => string };
  includeTestCode?: boolean;
  maxEmbedMb?: number;
  assets?: 'inline' | 'folder';
  historyLoader?: HistoryLoader | null;
}

export interface NeoReporterOptions extends Omit<ReporterOptions, 'historyLoader'> {
  keepVideos?: boolean;
}

export interface MergeOptions extends NeoReporterOptions {
  reportRoot?: string;
  summaryFiles?: string[];
  baseline?: string;
}

export interface RecordedTestPayload {
  spec: string;
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

export type RecordedTestsMap = Map<string, Omit<RecordedTestPayload, 'spec' | 'fullTitle'>>;

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
  tags?: string[];
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
  browser?: string;
  testingType?: string;
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
  source?: string;
  runs: HistoryRun[];
  tests: Record<string, string>;
  durations?: Record<string, number>;
}

export interface ReportSummary {
  schemaVersion?: number;
  reporterVersion?: string;
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

export interface HistoryOptions {
  provider?: 'azure-devops' | 'file';
  path?: string;
  organization?: string;
  project?: string;
  runName?: string;
  runs?: number;
  maxWeeks?: number;
}

export interface HistoryLoader {
  warm(testName: string): void;
  load(summary: ReportSummary): Promise<RunHistory | null>;
  record?(summary: ReportSummary): void;
}
