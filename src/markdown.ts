import { appendFileSync, writeFileSync } from 'node:fs';
import { ciSourceLine } from './ci';
import { firstLine, formatDuration, reportHtmlFile } from './format';
import {
  collectFailureGroups,
  collectTestsByState,
  historyStatus,
  testPathWithOwner,
  type FailureGroup,
  type HistoryStatus
} from './prompts';
import type { LaneSummary, ReportSummary } from './types';

function markdownCell(text: string): string {
  return text
    .replace(/[\\`*_{}[\]()#+!<>@~]/g, '\\$&')
    .replace(/\|/g, '\\|')
    .replace(/\s*\n\s*/g, ' ');
}

const MARKDOWN_ROW_LIMIT = 50;

export interface MarkdownExtras {
  link?: { label: string; url: string };
  appendix?: string;
  publish?: boolean;
}

function fillReportFile(url: string, file: string): string {
  return url.split('{file}').join(file);
}

function laneStatusIcon(lane: LaneSummary): string {
  return lane.failed > 0 ? '❌' : lane.flaky > 0 ? '⚠️' : '✅';
}

function laneTableLines(lanes: LaneSummary[], reportUrl?: string): string[] {
  const laneLabel = (lane: LaneSummary) =>
    reportUrl?.includes('{file}') ? `[${markdownCell(lane.label)}](${fillReportFile(reportUrl, lane.file)})` : markdownCell(lane.label);
  return [
    '#### Lanes',
    '',
    '| Lane | Failed | Flaky | Passed | Total | Pass rate | Duration |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...lanes.map(
      lane =>
        `| ${laneStatusIcon(lane)} ${laneLabel(lane)} | ${lane.failed} | ${lane.flaky} | ${lane.passed} | ${lane.total} | ${lane.passRate}% | ${formatDuration(lane.durationMs)} |`
    )
  ];
}

function laneTextLines(lanes: LaneSummary[]): string[] {
  const width = Math.max(...lanes.map(lane => lane.label.length));
  return [
    `Lanes: ${lanes.length}`,
    ...lanes.map(
      lane =>
        `  ${laneStatusIcon(lane)} ${lane.label.padEnd(width)}  ${String(lane.failed).padStart(3)} failed  ${String(lane.flaky).padStart(3)} flaky  ${String(lane.passed).padStart(4)}/${String(lane.total).padEnd(4)}  ${`${lane.passRate}%`.padStart(4)}  ${formatDuration(lane.durationMs)}`
    )
  ];
}

function markdownSummary(summary: ReportSummary, reportUrl?: string, link?: MarkdownExtras['link']): string {
  const groups = collectFailureGroups(summary);
  const flaky = collectTestsByState(summary, 'flaky');
  const failed = groups.reduce((count, group) => count + group.tests.length, 0);
  const passed = summary.totalPassed - flaky.length;
  const title = summary.suiteLabel ? `${summary.projectName} - ${summary.suiteLabel}` : summary.projectName;
  const source = ciSourceLine(summary.ci);
  const allTests = summary.specs.flatMap(spec => spec.tests.map(test => ({ spec, test })));
  const historyCounts = (status: HistoryStatus) => allTests.filter(test => historyStatus(summary, test) === status).length;
  const lines = [
    `### ${failed > 0 ? '❌' : flaky.length > 0 ? '⚠️' : '✅'} ${title}`,
    '',
    `**${failed} failed · ${flaky.length} flaky · ${passed} passed** of ${summary.totalTests} tests (${summary.passRate}% pass rate) · ${formatDuration(summary.totalDurationMs)}`,
    '',
    [source, summary.environment && `Target: ${summary.environment}`, summary.teamName].filter(Boolean).join(' · ')
  ];
  const reportHref = reportUrl && fillReportFile(reportUrl, reportHtmlFile(summary));
  if (reportHref) lines.push('', `[📄 Open the full HTML report](${reportHref})`);
  if (link) lines.push('', `[${markdownCell(link.label)}](${link.url})`);
  if (summary.history) {
    lines.push(
      '',
      `History vs the last ${summary.history.runs.length} runs of "${summary.history.family}": **${historyCounts('new')} new failures** · ${historyCounts('known')} known · ${historyCounts('fixed')} fixed`
    );
  }
  if (summary.lanes?.length) lines.push('', ...laneTableLines(summary.lanes, reportUrl));
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

export function generateMarkdownSummary(summary: ReportSummary, reportUrl?: string): string {
  return markdownSummary(summary, reportUrl);
}

export function reportLink(summary: ReportSummary, reportUrl?: string): string | undefined {
  return (reportUrl && fillReportFile(reportUrl, reportHtmlFile(summary))) || (process.env.GITHUB_ACTIONS ? summary.ci?.buildUrl : undefined);
}

export function writeMarkdownSummary(filePath: string, summary: ReportSummary, reportUrl?: string, extras: MarkdownExtras = {}): void {
  const own = markdownSummary(summary, reportUrl || (process.env.GITHUB_ACTIONS ? summary.ci?.buildUrl : undefined), extras.link);
  const markdown = extras.appendix ? `${own}\n---\n\n${extras.appendix}` : own;
  writeFileSync(filePath, markdown, 'utf-8');
  if (extras.publish === false) return;
  if (process.env.TF_BUILD) console.log(`##vso[task.uploadsummary]${filePath}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown, 'utf-8');
}

export function buildRunSummaryText(summary: ReportSummary, title: string, groups: FailureGroup[]): string {
  const flaky = collectTestsByState(summary, 'flaky');
  const failed = groups.reduce((count, group) => count + group.tests.length, 0);
  const source = ciSourceLine(summary.ci);
  const lines = [`${title}: ${failed} failed, ${flaky.length} flaky of ${summary.totalTests} tests (${summary.passRate}% pass rate)`];
  if (source) lines.push(source);
  if (summary.lanes?.length) lines.push('', ...laneTextLines(summary.lanes));
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
