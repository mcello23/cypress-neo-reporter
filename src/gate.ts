import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computePassRate } from './format';
import { historyStatus, testPath, type FailedTest } from './prompts';
import type { ReportSummary } from './types';

export const FAIL_ON = ['new', 'failed'] as const;
export const QUARANTINE_FILE_NAME = 'quarantine.json';

export type FailOn = (typeof FAIL_ON)[number];

export interface GateOptions {
  failOn?: FailOn;
  minPassRate?: number;
  quarantine?: Map<string, string>;
}

export function readQuarantine(file?: string): Map<string, string> {
  const filePath = resolve(file ?? QUARANTINE_FILE_NAME);
  if (!file && !existsSync(filePath)) return new Map();
  const entries = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown;
  if (!entries || typeof entries !== 'object' || Array.isArray(entries) || Object.values(entries).some(reason => typeof reason !== 'string')) {
    throw new Error(`${filePath} must map spec files or "spec › test" names to a reason, such as {"cypress/e2e/cart.cy.ts": "JIRA-123"}`);
  }
  return new Map(Object.entries(entries as Record<string, string>));
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

export function checkGate(summary: ReportSummary, { failOn, minPassRate, quarantine = new Map() }: GateOptions): boolean {
  if (failOn === 'new' && !summary.history?.runs.length) {
    throw new Error(
      '--fail-on new needs run history to tell new failures from known ones, and this report has none. Turn run history on (Azure DevOps or the file provider, with the html or markdown output) or use --fail-on failed.'
    );
  }
  const reason = (test: FailedTest) => quarantine.get(testPath(test)) ?? quarantine.get(test.spec.specFile);
  const tests = summary.specs.flatMap(spec => spec.tests.map(test => ({ spec, test })));
  const quarantined = tests.filter(test => reason(test) !== undefined);
  const failed = tests.filter(test => test.test.state === 'failed' && reason(test) === undefined);
  const failing = failOn === 'new' ? failed.filter(test => historyStatus(summary, test) === 'new') : failOn ? failed : [];
  const passRate = computePassRate(
    summary.totalPassed - quarantined.filter(({ test }) => test.state === 'passed' || test.state === 'flaky').length,
    summary.totalTests - quarantined.length
  );
  const passed = failing.length === 0 && (minPassRate === undefined || passRate >= minPassRate);
  const print = (heading: string, items: FailedTest[] = []) =>
    console.log([`[neo-reporter] ${heading}`, ...items.map(item => `  ${testPath(item)}${reason(item) ? ` (${reason(item)})` : ''}`)].join('\n'));

  const quarantinedFailures = quarantined.filter(({ test }) => test.state === 'failed');
  if (quarantinedFailures.length) print(`${plural(quarantinedFailures.length, 'quarantined failure')} not counted:`, quarantinedFailures);
  if (failOn === 'new' && failed.length > failing.length) print(`${plural(failed.length - failing.length, 'known failure')} not counted`);
  if (failOn) {
    const noun = failOn === 'new' ? 'new failure' : 'failure';
    print(failing.length ? `${plural(failing.length, noun)}:` : `No ${noun}s`, failing);
  }
  if (minPassRate !== undefined) {
    print(
      `Pass rate ${passRate}%${quarantined.length ? ' without quarantined tests' : ''} ${passRate < minPassRate ? 'is below' : 'meets'} the minimum of ${minPassRate}%`
    );
  }
  print(passed ? 'Gate passed' : 'Gate failed');
  return passed;
}
