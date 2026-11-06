import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve, isAbsolute, basename } from 'node:path';
import { readCiInfo, readSpecOwners, readSpecOwnersFile } from './ci';
import { computePassRate, deriveSuiteLabel, machineTimeZone, toEmbeddedFile, toScreenshotSafeName, toSourceSpecPath } from './format';
import {
  DEFAULT_REPORTS_DIR,
  STEPS_FILE_NAME,
  type EmbeddedFile,
  type RecordedTestsMap,
  type ReporterOptions,
  type ReportSummary,
  type SpecData,
  type TestData
} from './types';
import { MAX_EMBEDDED_VIDEO_CHARS, recordedSpecVideos, testVideoPath } from './video';

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

export function capEmbeddedVideos(specs: SpecData[]): SpecData[] {
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

export function readRecordedTests(candidates: string[]): RecordedTestsMap {
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
