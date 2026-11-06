import { existsSync, rmSync } from 'node:fs';
import { readCiInfo } from './ci';
import { createHistoryLoader } from './history';
import { generateReports, needsHistory } from './output';
import { recordedTestKey, recordedTests } from './summary';
import { PLUGIN_FLAG, RECORD_TASK } from './task';
import { REPORT_OUTPUTS, type HistoryLoader, type NeoReporterOptions, type RecordedTestPayload } from './types';
import { validateOptions } from './validate';
import { bundledVideoTools, compressVideo, cutFailedTestVideos, recordedSpecVideos } from './video';

const KNOWN_LIMITATIONS_URL = 'https://github.com/mcello23/cypress-neo-reporter#known-limitations';

export function createNeoReporter(config: Cypress.PluginConfigOptions, options: NeoReporterOptions = {}) {
  validateOptions(options);
  if (config.expose) config.expose[PLUGIN_FLAG] = true;
  else config.env[PLUGIN_FLAG] = true;
  let historyLoader: HistoryLoader | null | undefined;
  let beforeRunSeen = false;

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
        if (needsHistory(options.outputs ?? REPORT_OUTPUTS)) {
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
  if (config.video) on('after:spec', neo.afterSpec);
  on('after:run', neo.afterRun);
  return config;
}
