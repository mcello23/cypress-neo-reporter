import { BLOB_FOLDER_RULE, parseBlobFolder } from './blob';
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
  'keepVideos',
  'css',
  'flakyWarnings',
  'summaryDir',
  'remoteLanes',
  'fileName',
  'failedRequestStatuses'
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
  const { patterns, replace, keepQuery } = redact as { patterns?: unknown; replace?: unknown; keepQuery?: unknown };
  return (
    (patterns === undefined || (Array.isArray(patterns) && patterns.every(pattern => pattern instanceof RegExp))) &&
    (replace === undefined || typeof replace === 'function') &&
    (keepQuery === undefined || typeof keepQuery === 'boolean')
  );
}

const isNonEmptyString = (value: unknown): boolean => typeof value === 'string' && value.trim() !== '';

function isBlobFolder(url: unknown): boolean {
  if (typeof url !== 'string') return false;
  try {
    parseBlobFolder(url);
    return true;
  } catch {
    return false;
  }
}

function assertRemoteLanes(remoteLanes: unknown): void {
  if (remoteLanes === undefined) return;
  if (typeof remoteLanes !== 'object' || remoteLanes === null || Array.isArray(remoteLanes)) {
    throw new Error('[neo-reporter] remoteLanes must be an object with an azureBlob URL.');
  }
  const lanes = remoteLanes as Record<string, unknown>;
  if (!isBlobFolder(lanes.azureBlob)) throw new Error(`[neo-reporter] remoteLanes.azureBlob ${BLOB_FOLDER_RULE}`);
  for (const name of ['sas', 'run', 'reportName', 'fileName', 'projectName', 'releaseStage']) {
    if (lanes[name] !== undefined && !isNonEmptyString(lanes[name])) throw new Error(`[neo-reporter] remoteLanes.${name} must be a non-empty string.`);
  }
  const junit = lanes.junit as { path?: unknown; testName?: unknown } | null | undefined;
  if (
    junit !== undefined &&
    !(typeof junit === 'object' && junit !== null && isNonEmptyString(junit.path) && (junit.testName === undefined || isNonEmptyString(junit.testName)))
  ) {
    throw new Error('[neo-reporter] remoteLanes.junit must be { path, testName? } with non-empty strings.');
  }
}

export function validateOptions(options: MergeOptions, knownKeys: readonly string[] = KNOWN_OPTION_KEYS): void {
  const unknown = Object.keys(options).filter(key => !knownKeys.includes(key));
  if (unknown.length) {
    console.warn(`[neo-reporter] Ignoring unknown option ${unknown.map(key => `"${key}"`).join(', ')}. Known options: ${knownKeys.join(', ')}.`);
  }
  const { outputs, theme, history, assets, maxEmbedMb, redact, css, flakyWarnings, summaryDir, fileName, failedRequestStatuses } = options;
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
    throw new Error(`[neo-reporter] redact must be false or an object with optional patterns (an array of RegExp), replace (a function) and keepQuery (a boolean), got ${JSON.stringify(redact)}.`);
  }
  if (css !== undefined && typeof css !== 'string') {
    throw new Error(`[neo-reporter] css must be a string of CSS, got ${JSON.stringify(css)}.`);
  }
  if (flakyWarnings !== undefined && typeof flakyWarnings !== 'boolean') {
    throw new Error(`[neo-reporter] flakyWarnings must be true or false, got ${JSON.stringify(flakyWarnings)}.`);
  }
  if (summaryDir !== undefined && !isNonEmptyString(summaryDir)) {
    throw new Error(`[neo-reporter] summaryDir must be a non-empty string, got ${JSON.stringify(summaryDir)}.`);
  }
  if (fileName !== undefined && !isNonEmptyString(fileName)) {
    throw new Error(`[neo-reporter] fileName must be a non-empty string, got ${JSON.stringify(fileName)}.`);
  }
  if (
    failedRequestStatuses !== undefined &&
    !(Array.isArray(failedRequestStatuses) && failedRequestStatuses.every(status => Number.isInteger(status) && status >= 100 && status <= 599))
  ) {
    throw new Error(`[neo-reporter] failedRequestStatuses must be an array of HTTP status codes from 100 to 599, such as [401, 429], got ${JSON.stringify(failedRequestStatuses)}.`);
  }
  assertRemoteLanes(options.remoteLanes);
  if (history) {
    if (history.provider !== undefined && !HISTORY_PROVIDERS.includes(history.provider)) {
      throw new Error(`[neo-reporter] Unknown history.provider ${JSON.stringify(history.provider)}. Use ${HISTORY_PROVIDERS.join(' or ')}.`);
    }
    assertPositiveInteger('history.runs', history.runs);
    assertPositiveInteger('history.maxWeeks', history.maxWeeks);
  }
  assertTimeZone(options.timeZone);
}
