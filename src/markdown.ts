import { writeFileSync } from 'node:fs';
import { ciSourceLine } from './ci';
import { firstLine, formatDuration } from './format';
import {
  collectFailureGroups,
  collectTestsByState,
  historyStatus,
  testPathWithOwner,
  type FailureGroup,
  type HistoryStatus
} from './prompts';
import type { ReportSummary } from './types';

function markdownCell(text: string): string {
  return text
    .replace(/[\\`*_{}[\]()#+!<>@~]/g, '\\$&')
    .replace(/\|/g, '\\|')
    .replace(/\s*\n\s*/g, ' ');
}

const MARKDOWN_ROW_LIMIT = 50;

export function generateMarkdownSummary(summary: ReportSummary, reportUrl?: string): string {
  const groups = collectFailureGroups(summary);
  const flaky = collectTestsByState(summary, 'flaky');
  const failed = groups.reduce((count, group) => count + group.tests.length, 0);
  const passed = summary.totalPassed - flaky.length;
  const title = summary.suiteLabel ? `${summary.projectName} - ${summary.suiteLabel}` : summary.projectName;
  const source = ciSourceLine(summary.ci);
  const allTests = summary.specs.flatMap(spec => spec.tests);
  const historyCounts = (status: HistoryStatus) => allTests.filter(test => historyStatus(summary, test) === status).length;
  const lines = [
    `### ${failed > 0 ? '❌' : flaky.length > 0 ? '⚠️' : '✅'} ${title}`,
    '',
    `**${failed} failed · ${flaky.length} flaky · ${passed} passed** of ${summary.totalTests} tests (${summary.passRate}% pass rate) · ${formatDuration(summary.totalDurationMs)}`,
    '',
    [source, summary.environment && `Target: ${summary.environment}`, summary.teamName].filter(Boolean).join(' · ')
  ];
  if (reportUrl) lines.push('', `[📄 Open the full HTML report](${reportUrl})`);
  if (summary.history) {
    lines.push(
      '',
      `History vs the last ${summary.history.runs.length} runs of "${summary.history.family}": **${historyCounts('new')} new failures** · ${historyCounts('known')} known · ${historyCounts('fixed')} fixed`
    );
  }
  if (groups.length > 0) {
    lines.push('', '#### Failure groups', '', '| Count | Error | Tests |', '| --- | --- | --- |');
    groups
      .slice(0, MARKDOWN_ROW_LIMIT)
      .forEach(group =>
        lines.push(
          `| ${group.tests.length}× | ${markdownCell(group.message)} | ${group.tests.map(failure => markdownCell(testPathWithOwner(failure, summary))).join('<br>')} |`
        )
      );
    if (groups.length > MARKDOWN_ROW_LIMIT) lines.push('', `…and ${groups.length - MARKDOWN_ROW_LIMIT} more groups in the HTML report.`);
  }
  if (flaky.length > 0) {
    lines.push('', '#### Flaky tests', '', '| Test | First error |', '| --- | --- |');
    flaky
      .slice(0, MARKDOWN_ROW_LIMIT)
      .forEach(failure =>
        lines.push(
          `| ${markdownCell(testPathWithOwner(failure, summary))} | ${markdownCell(firstLine(failure.test.displayError) || 'No error message captured')} |`
        )
      );
    if (flaky.length > MARKDOWN_ROW_LIMIT) lines.push('', `…and ${flaky.length - MARKDOWN_ROW_LIMIT} more flaky tests in the HTML report.`);
  }
  return lines.join('\n') + '\n';
}

export function writeMarkdownSummary(filePath: string, summary: ReportSummary, reportUrl?: string): void {
  writeFileSync(filePath, generateMarkdownSummary(summary, reportUrl), 'utf-8');
  if (process.env.TF_BUILD) console.log(`##vso[task.uploadsummary]${filePath}`);
}

export function buildRunSummaryText(summary: ReportSummary, title: string, groups: FailureGroup[]): string {
  const flaky = collectTestsByState(summary, 'flaky');
  const failed = groups.reduce((count, group) => count + group.tests.length, 0);
  const source = ciSourceLine(summary.ci);
  const lines = [`${title}: ${failed} failed, ${flaky.length} flaky of ${summary.totalTests} tests (${summary.passRate}% pass rate)`];
  if (source) lines.push(source);
  for (const group of groups) {
    lines.push('', `${group.tests.length}× ${group.message}`);
    group.tests.forEach(failure => lines.push(`  - ${testPathWithOwner(failure, summary)}`));
  }
  if (flaky.length > 0) {
    lines.push('', 'Flaky:');
    flaky.forEach(failure => lines.push(`  - ${testPathWithOwner(failure, summary)}`));
  }
  return lines.join('\n');
}
