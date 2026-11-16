import { existsSync, rmSync } from 'node:fs';
import { flakyTestWarnings, ownedSpecPath, readCiInfo, readSpecOwnersFile, supportsFlakyWarnings } from './ci';
import { toSourceSpecPath } from './format';
import { attachRunHistory, createHistoryLoader } from './history';
import { rollingLanesAppendix } from './merge';
import { needsHistory, resolveOutputDir, writeReportOutputs, type ReportFiles } from './output';
import { applyRedaction } from './redact';
import { buildReportSummary, recordedTestKey, recordedTests, toTestState } from './summary';
import { FAILED_REQUEST_STATUSES, PLUGIN_FLAG, RECORD_TASK } from './task';
import {
  DEFAULT_OUTPUTS,
  type HistoryLoader,
  type NeoReporterOptions,
  type RecordedTestPayload,
  type ReporterOptions,
  type ReportOutput
} from './types';
import { validateOptions } from './validate';
import { bundledVideoTools, compressVideo, cutFailedTestVideos, recordedSpecVideos } from './video';

const KNOWN_LIMITATIONS_URL = 'https://github.com/mcello23/cypress-neo-reporter#known-limitations';

export async function generateReports(runResults: CypressCommandLine.CypressRunResult, options: ReporterOptions = {}): Promise<ReportFiles> {
  const projectDir = (runResults.config as { projectRoot?: string } | undefined)?.projectRoot ?? process.cwd();
  const outputDir = resolveOutputDir(projectDir, options.outputDir);
  const summaryDir = options.summaryDir ? resolveOutputDir(projectDir, options.summaryDir) : outputDir;
  const requested: readonly ReportOutput[] = options.outputs ?? DEFAULT_OUTPUTS;
  const outputs = options.remoteLanes && !requested.includes('summary') ? [...requested, 'summary' as const] : requested;
  const summary = applyRedaction(buildReportSummary(runResults, projectDir, { ...options, outputDir }), options);
  if (needsHistory(outputs)) {
    const loader =
      options.historyLoader === undefined ? createHistoryLoader(options.history, summary.ci?.branch, projectDir) : options.historyLoader;
    await attachRunHistory(summary, loader);
  }
  const baseName = options.fileName ?? options.reportName ?? summary.projectName;
  const appendix = options.remoteLanes ? await rollingLanesAppendix(summary, baseName, options, { projectDir, outputDir }) : undefined;
  return writeReportOutputs(summary, outputDir, baseName, outputs, { ...options, summaryDir, markdown: { appendix } });
}

export function createNeoReporter(config: Cypress.PluginConfigOptions, options: NeoReporterOptions = {}) {
  validateOptions(options);
  if (config.expose) config.expose[PLUGIN_FLAG] = true;
  else config.env[PLUGIN_FLAG] = true;
  if (options.failedRequestStatuses) (config.expose ?? config.env)[FAILED_REQUEST_STATUSES] = options.failedRequestStatuses;
  let historyLoader: HistoryLoader | null | undefined;
  let beforeRunSeen = false;
  const warnFlaky = options.flakyWarnings === true && supportsFlakyWarnings();
  const owners = warnFlaky ? readSpecOwnersFile(config.projectRoot) : null;

  const tools = config.video ? bundledVideoTools(config.cypressBinaryRoot) : null;
  if (config.video && !tools) {
    console.warn(`[neo-reporter] ffmpeg not found under ${config.cypressBinaryRoot}; failed-spec videos stay uncompressed.`);
  } else if (tools && !tools.ffprobe) {
    console.warn(`[neo-reporter] ffprobe not found under ${config.cypressBinaryRoot}; failed specs keep their full video instead of per-test clips.`);
  }

  const warnIfBeforeRunReplaced = (): void => {
    if (beforeRunSeen || !config.isTextTerminal) return;
    beforeRunSeen = true;
    console.warn(
      `[neo-reporter] Another plugin replaced neo-reporter's before:run handler, and likely its after:run too, so the report may not be written. Call the createNeoReporter() handlers from your own events: ${KNOWN_LIMITATIONS_URL}`
    );
  };

  return {
    beforeRun(details?: Cypress.BeforeRunDetails): void {
      beforeRunSeen = true;
      recordedTests.clear();
      const resolved = details?.config;
      if (resolved && !(resolved.expose ?? resolved.env)?.[PLUGIN_FLAG]) {
        console.warn(
          '[neo-reporter] setupNodeEvents did not return the config, so steps, test code, failed requests and console errors are not recorded. End setupNodeEvents with: return neoReporter(on, config, options)'
        );
      }
      try {
        if (needsHistory(options.outputs ?? DEFAULT_OUTPUTS)) {
          historyLoader = createHistoryLoader(options.history, readCiInfo(config.projectRoot).branch, config.projectRoot);
        }
      } catch (error) {
        console.warn(`[neo-reporter] before:run failed: ${error}`);
      }
    },

    tasks: {
      [RECORD_TASK](data: RecordedTestPayload): null {
        try {
          warnIfBeforeRunReplaced();
          historyLoader?.warm(data.fullTitle);
          const { spec, fullTitle, ...recorded } = data;
          const key = recordedTestKey(spec, fullTitle);
          const previous = recordedTests.get(key);
          recordedTests.set(key, {
            ...recorded,
            attempt: previous?.attempt ?? recorded.attempt,
            code: previous?.code ?? recorded.code,
            firstError: previous?.firstError ?? recorded.firstError,
            network: previous?.network ?? recorded.network,
            consoleErrors: previous?.consoleErrors ?? recorded.consoleErrors
          });
        } catch (error) {
          console.warn(`[neo-reporter] Recording a test failed: ${error}`);
        }
        return null;
      }
    },

    afterSpec(spec: Cypress.Spec, results: CypressCommandLine.RunResult): void {
      try {
        warnIfBeforeRunReplaced();
        if (warnFlaky) flakyTestWarnings(ownedSpecPath(owners, toSourceSpecPath(spec.relative)), (results?.tests ?? []).filter(test => toTestState(test) === 'flaky').map(test => test.title)).forEach(line => console.log(line));
        if (!results?.video || !existsSync(results.video)) return;
        recordedSpecVideos.set(spec.absolute, results.video);
        const tests = results.tests ?? [];
        if (!tests.some(test => test.attempts?.some(attempt => attempt.state === 'failed'))) {
          if (!options.keepVideos) rmSync(results.video, { force: true });
          return;
        }
        if (!tools) return;
        const cut = cutFailedTestVideos(tools, results.video, tests, test =>
          recordedTests.get(recordedTestKey(spec.relative, test.title.join(' › ')))?.attempt
        );
        if (options.keepVideos) return;
        if (cut) rmSync(results.video, { force: true });
        else compressVideo(tools.ffmpeg, results.video);
      } catch (error) {
        console.warn(`[neo-reporter] after:spec failed for ${spec.relative}: ${error}`);
      }
    },

    async afterRun(results: CypressCommandLine.CypressRunResult | CypressCommandLine.CypressFailedRunResult | undefined): Promise<void> {
      if (!results || !('runs' in results)) return;
      try {
        await generateReports(results, { ...options, historyLoader });
      } catch (error) {
        console.warn(`[neo-reporter] Writing the report failed: ${error}`);
      }
    }
  };
}

export function neoReporter(
  on: Cypress.PluginEvents,
  config: Cypress.PluginConfigOptions,
  options: NeoReporterOptions = {}
): Cypress.PluginConfigOptions {
  const neo = createNeoReporter(config, options);
  on('before:run', neo.beforeRun);
  on('task', neo.tasks);
  if (config.video || (options.flakyWarnings === true && supportsFlakyWarnings())) on('after:spec', neo.afterSpec);
  on('after:run', neo.afterRun);
  return config;
}
