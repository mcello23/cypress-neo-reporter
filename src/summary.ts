import { existsSync, readFileSync } from 'node:fs';
import { join, relative, isAbsolute, basename } from 'node:path';
import { readCiInfo, readSpecOwners, readSpecOwnersFile } from './ci';
import { computePassRate, deriveSuiteLabel, machineTimeZone, stripAnsi, toSourceSpecPath } from './format';
import { packageVersion } from './html/assets';
import { SCHEMA_VERSION, type EmbeddedFile, type RecordedTestsMap, type ReporterOptions, type ReportSummary, type SpecData, type TestData } from './types';
import { recordedSpecVideos, testVideoPath } from './video';

function toTestState(test: CypressCommandLine.TestResult): TestData['state'] {
  const state = (test.state as TestData['state']) || 'passed';
  return state === 'passed' && test.attempts?.some(attempt => attempt.state === 'failed') ? 'flaky' : state;
}

export function hasFailureEvidence(test: TestData): boolean {
  return test.state === 'failed' || test.state === 'flaky';
}

export function stripEmbed(file: EmbeddedFile): EmbeddedFile {
  return { name: file.name, path: file.path };
}

export interface EvidenceFile {
  file: EmbeddedFile;
  mimeType: string;
  rank: number;
}

export function evidenceFiles(specs: SpecData[]): EvidenceFile[] {
  return specs.flatMap(spec => [
    ...spec.tests.filter(hasFailureEvidence).flatMap(test => [
      ...(test.screenshots ?? []).map(file => ({ file, mimeType: 'image/png', rank: test.state === 'failed' ? 0 : 2 })),
      ...(test.video ? [{ file: test.video, mimeType: 'video/mp4', rank: test.state === 'failed' ? 1 : 3 }] : [])
    ]),
    ...(spec.video ? [{ file: spec.video, mimeType: 'video/mp4', rank: spec.failures > 0 ? 1 : 3 }] : [])
  ]);
}

function mediaFile(filePath: string): EmbeddedFile {
  return { name: basename(filePath), path: filePath };
}

const TITLE_TAG = /(?<!\S)@[\w-]+/g;

function toProjectPath(filePath: string, projectDir: string): string {
  return isAbsolute(filePath) ? filePath : join(projectDir, filePath);
}

function readProjectName(projectDir: string): string | undefined {
  try {
    return (JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf-8')) as { name?: string }).name || undefined;
  } catch {
    return undefined;
  }
}

export const recordedTests: RecordedTestsMap = new Map();

export function recordedTestKey(spec: string, fullTitle: string): string {
  return `${toSourceSpecPath(spec)}::${fullTitle}`;
}

const SCREENSHOT_SUFFIX = /^( -- (?:before|after) (?:each|all) hook(?: .+?)??)?( \(failed\))?(?: \(attempt \d+\))?(?: \(\d+\))?\.png$/;
const CUT_SCREENSHOT_NAME_BYTES = 253;
const CUT_SUFFIX_STARTS = [' -- before each hook', ' -- before all hook', ' -- after each hook', ' -- after all hook', ' (failed)', ' (attempt '];

function toScreenshotTitle(title: string): string {
  return title
    .replace(/[/?<>\\:*|"]/g, '')
    .replace(/[\x00-\x1f\x80-\x9f]/g, '')
    .replace(/^\.+$/, '')
    .replace(/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i, '')
    .replace(/[. ]+$/, '');
}

function isTestScreenshot(shotPath: string, title: string[], failed: boolean): boolean {
  const name = basename(shotPath);
  const leaf = toScreenshotTitle(title[title.length - 1]);
  const suites = title.slice(0, -1).filter(Boolean).map(toScreenshotTitle);
  for (let depth = suites.length; depth >= 0; depth--) {
    const testName = [...suites.slice(0, depth), leaf].join(' -- ');
    const match = name.startsWith(testName) ? SCREENSHOT_SUFFIX.exec(name.slice(testName.length)) : null;
    if (match && (depth === suites.length || match[1]) && (failed || !match[2])) return true;
  }
  if (!failed || Buffer.byteLength(name) < CUT_SCREENSHOT_NAME_BYTES) return false;
  const testName = [...suites, leaf].join(' -- ');
  const cut = name.replace(/( \(\d+\))?\.png$/, '').replace(/\uFFFD+$/, '');
  const rest = cut.slice(testName.length);
  return testName.startsWith(cut) || (cut.startsWith(testName) && CUT_SUFFIX_STARTS.some(start => start.startsWith(rest) || rest.startsWith(start)));
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
  const browser = `${runResults.browserName ?? 'Chrome'} ${runResults.browserVersion ?? ''}`.trim();
  const testingType = (runResults.config as { testingType?: string } | undefined)?.testingType;

  for (const run of runResults.runs) {
    const relPath = toSourceSpecPath(relative(projectDir, run.spec.absolute));
    const specName = toSourceSpecPath(run.spec.name);

    const specVideoPath = recordedSpecVideos.get(run.spec.absolute) ?? run.video;
    const tests: TestData[] = run.tests.map(t => {
      const fullTitle = t.title.join(' › ');
      const recorded = recordedTests.get(recordedTestKey(relPath, fullTitle));
      const displayError = recorded?.firstError ?? t.displayError;

      const state = toTestState(t);
      const testScreenshots = (run.screenshots ?? [])
        .map(shot => toProjectPath(shot.path, projectDir))
        .filter(shotPath => isTestScreenshot(shotPath, t.title, state === 'failed' || state === 'flaky'))
        .map(mediaFile);
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
        displayError: displayError && stripAnsi(displayError),
        attempts: t.attempts,
        screenshots: testScreenshots,
        businessGoal: recorded?.businessGoal ?? null,
        steps: (recorded?.steps ?? []).map(step => ({ ...step, message: stripAnsi(step.message) })),
        code: recorded?.code,
        video: clipPath && existsSync(clipPath) ? mediaFile(clipPath) : undefined,
        network: recorded?.network,
        consoleErrors: recorded?.consoleErrors?.map(stripAnsi),
        tags: [...new Set(t.title.join(' ').match(TITLE_TAG))]
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
      browser,
      testingType,
      video:
        specVideoPath && existsSync(toProjectPath(specVideoPath, projectDir)) && tests.some(t => hasFailureEvidence(t) && !t.video)
          ? mediaFile(toProjectPath(specVideoPath, projectDir))
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
    schemaVersion: SCHEMA_VERSION,
    reporterVersion: packageVersion(),
    projectName: options.projectName ?? readProjectName(projectDir) ?? 'Cypress',
    timestamp: new Date().toISOString(),
    browser,
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
    specs,
    suiteLabel: deriveSuiteLabel(options.reportName),
    ci: readCiInfo(projectDir),
    teamName: options.showTeamName === false ? undefined : options.teamName?.trim() || undefined,
    timeZone: options.timeZone ?? machineTimeZone(),
    theme: options.theme ?? 'auto'
  };
}
