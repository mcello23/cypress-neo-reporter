import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { readCiInfo } from './ci';
import { assertTimeZone } from './format';
import { createHistoryLoader } from './history';
import { generateReports, needsHistory, resolveOutputDir } from './output';
import { readRecordedTests } from './summary';
import { RECORD_TASK } from './task';
import { REPORT_OUTPUTS, STEPS_FILE_NAME, type HistoryLoader, type NeoReporterOptions, type RecordedTestPayload } from './types';
import { bundledVideoTools, compressVideo, cutFailedTestVideos, recordedSpecVideos } from './video';

export function neoReporter(on: Cypress.PluginEvents, config: Cypress.PluginConfigOptions, options: NeoReporterOptions = {}): void {
  assertTimeZone(options.timeZone);
  const outputDir = resolveOutputDir(config.projectRoot, options.outputDir);
  const stepsFilePath = join(outputDir, STEPS_FILE_NAME);
  let historyLoader: HistoryLoader | null = null;

  on('before:run', () => {
    rmSync(stepsFilePath, { force: true });
    if (needsHistory(options.outputs ?? REPORT_OUTPUTS)) {
      historyLoader = createHistoryLoader(options.history, readCiInfo(config.projectRoot).branch);
    }
  });

  on('task', {
    [RECORD_TASK](data: RecordedTestPayload) {
      historyLoader?.warm(data.fullTitle.replace(/ › /g, ' '));
      mkdirSync(outputDir, { recursive: true });
      const map = readRecordedTests([stepsFilePath]);
      const { fullTitle, ...recorded } = data;
      map[fullTitle] = {
        ...recorded,
        attempt: map[fullTitle]?.attempt ?? recorded.attempt,
        code: map[fullTitle]?.code ?? recorded.code,
        firstError: map[fullTitle]?.firstError ?? recorded.firstError,
        network: map[fullTitle]?.network ?? recorded.network,
        consoleErrors: map[fullTitle]?.consoleErrors ?? recorded.consoleErrors
      };
      writeFileSync(stepsFilePath, JSON.stringify(map, null, 2), 'utf-8');
      return null;
    }
  });

  if (config.video) {
    const tools = bundledVideoTools(config.cypressBinaryRoot);
    if (!tools) {
      console.warn(`[neo-reporter] ffmpeg not found under ${config.cypressBinaryRoot}; failed-spec videos stay uncompressed.`);
    }

    on('after:spec', (spec, results) => {
      if (!results?.video || !existsSync(results.video)) return;
      recordedSpecVideos.set(spec.absolute, results.video);
      const tests = results.tests ?? [];
      if (!tests.some(test => test.attempts?.some(attempt => attempt.state === 'failed'))) {
        rmSync(results.video, { force: true });
        return;
      }
      if (!tools) return;
      if (cutFailedTestVideos(tools, results.video, tests, readRecordedTests([stepsFilePath]))) rmSync(results.video, { force: true });
      else compressVideo(tools.ffmpeg, results.video);
    });
  }

  on('after:run', async results => {
    if ('runs' in results) {
      await generateReports(results, { ...options, outputDir, stepsFilePath, historyLoader });
      rmSync(stepsFilePath, { force: true });
    }
  });
}
