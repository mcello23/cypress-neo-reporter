import { assertTimeZone } from './format';
import { REPORT_OUTPUTS, type MergeOptions, type ReportTheme } from './types';

export const KNOWN_OPTION_KEYS: string[] = [
  'projectName',
  'reportName',
  'teamName',
  'showTeamName',
  'timeZone',
  'theme',
  'outputDir',
  'outputs',
  'history',
  'reportUrl',
  'redact',
  'includeTestCode',
  'maxEmbedMb',
  'assets',
  'keepVideos',
  'reportRoot',
  'summaryFiles',
  'baseline'
];

const HISTORY_PROVIDERS = ['azure-devops', 'file'];

const THEMES: readonly ReportTheme[] = ['auto', 'light', 'dark'];

const ASSET_MODES = ['inline', 'folder'];

function assertPositiveInteger(name: string, value: unknown): void {
  if (value === undefined || (Number.isInteger(value) && (value as number) > 0)) return;
  throw new Error(`[neo-reporter] ${name} must be a whole number above 0, got ${JSON.stringify(value)}.`);
}

export function validateOptions(options: MergeOptions): void {
  const unknown = Object.keys(options).filter(key => !KNOWN_OPTION_KEYS.includes(key));
  if (unknown.length) {
    console.warn(`[neo-reporter] Ignoring unknown option ${unknown.map(key => `"${key}"`).join(', ')}. Known options: ${KNOWN_OPTION_KEYS.join(', ')}.`);
  }
  const { outputs, theme, history, assets, maxEmbedMb } = options;
  if (outputs !== undefined) {
    if (!Array.isArray(outputs)) {
      throw new Error(`[neo-reporter] outputs must be an array such as ['html', 'junit'], got ${JSON.stringify(outputs)}.`);
    }
    const invalid = outputs.filter(output => !REPORT_OUTPUTS.includes(output));
    if (invalid.length) {
      throw new Error(`[neo-reporter] Unknown output ${invalid.map(output => JSON.stringify(output)).join(', ')}. Use any of ${REPORT_OUTPUTS.join(', ')}.`);
    }
  }
  if (theme !== undefined && !THEMES.includes(theme)) {
    throw new Error(`[neo-reporter] Unknown theme ${JSON.stringify(theme)}. Use ${THEMES.join(', ')}.`);
  }
  if (assets !== undefined && !ASSET_MODES.includes(assets)) {
    throw new Error(`[neo-reporter] Unknown assets ${JSON.stringify(assets)}. Use ${ASSET_MODES.join(' or ')}.`);
  }
  if (maxEmbedMb !== undefined && !(typeof maxEmbedMb === 'number' && maxEmbedMb >= 0)) {
    throw new Error(`[neo-reporter] maxEmbedMb must be a number of 0 or more, got ${JSON.stringify(maxEmbedMb)}.`);
  }
  if (history) {
    if (history.provider !== undefined && !HISTORY_PROVIDERS.includes(history.provider)) {
      throw new Error(`[neo-reporter] Unknown history.provider ${JSON.stringify(history.provider)}. Use ${HISTORY_PROVIDERS.join(' or ')}.`);
    }
    assertPositiveInteger('history.runs', history.runs);
    assertPositiveInteger('history.maxWeeks', history.maxWeeks);
  }
  assertTimeZone(options.timeZone);
}
