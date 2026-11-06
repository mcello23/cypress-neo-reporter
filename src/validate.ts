import { assertTimeZone } from './format';
import { REPORT_OUTPUTS, REPORT_THEMES, type MergeOptions } from './types';

const KNOWN_OPTION_KEYS = [
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
  'keepVideos'
];

export const MERGE_OPTION_KEYS = [...KNOWN_OPTION_KEYS, 'reportRoot', 'summaryFiles', 'baseline'];

const HISTORY_PROVIDERS = ['azure-devops', 'file'];

const ASSET_MODES = ['inline', 'folder'];

function assertPositiveInteger(name: string, value: unknown): void {
  if (value === undefined || (Number.isInteger(value) && (value as number) > 0)) return;
  throw new Error(`[neo-reporter] ${name} must be a whole number above 0, got ${JSON.stringify(value)}.`);
}

function isValidRedact(redact: unknown): boolean {
  if (redact === undefined || redact === false) return true;
  if (typeof redact !== 'object' || redact === null) return false;
  const { patterns, replace } = redact as { patterns?: unknown; replace?: unknown };
  return (
    (patterns === undefined || (Array.isArray(patterns) && patterns.every(pattern => pattern instanceof RegExp))) &&
    (replace === undefined || typeof replace === 'function')
  );
}

export function validateOptions(options: MergeOptions, knownKeys: readonly string[] = KNOWN_OPTION_KEYS): void {
  const unknown = Object.keys(options).filter(key => !knownKeys.includes(key));
  if (unknown.length) {
    console.warn(`[neo-reporter] Ignoring unknown option ${unknown.map(key => `"${key}"`).join(', ')}. Known options: ${knownKeys.join(', ')}.`);
  }
  const { outputs, theme, history, assets, maxEmbedMb, redact } = options;
  if (outputs !== undefined) {
    if (!Array.isArray(outputs)) {
      throw new Error(`[neo-reporter] outputs must be an array such as ['html', 'junit'], got ${JSON.stringify(outputs)}.`);
    }
    const invalid = outputs.filter(output => !REPORT_OUTPUTS.includes(output));
    if (invalid.length) {
      throw new Error(`[neo-reporter] Unknown output ${invalid.map(output => JSON.stringify(output)).join(', ')}. Use any of ${REPORT_OUTPUTS.join(', ')}.`);
    }
  }
  if (theme !== undefined && !REPORT_THEMES.includes(theme)) {
    throw new Error(`[neo-reporter] Unknown theme ${JSON.stringify(theme)}. Use ${REPORT_THEMES.join(', ')}.`);
  }
  if (assets !== undefined && !ASSET_MODES.includes(assets)) {
    throw new Error(`[neo-reporter] Unknown assets ${JSON.stringify(assets)}. Use ${ASSET_MODES.join(' or ')}.`);
  }
  if (maxEmbedMb !== undefined && !(typeof maxEmbedMb === 'number' && maxEmbedMb >= 0)) {
    throw new Error(`[neo-reporter] maxEmbedMb must be a number of 0 or more, got ${JSON.stringify(maxEmbedMb)}.`);
  }
  if (!isValidRedact(redact)) {
    throw new Error(`[neo-reporter] redact must be false or an object with optional patterns (an array of RegExp) and replace (a function), got ${JSON.stringify(redact)}.`);
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
