import { ciSourceLine } from './ci';
import { firstLine, formatDuration } from './format';
import { reportLink } from './markdown';
import { collectFailureGroups, collectTestsByState, historyStatus, type HistoryStatus } from './prompts';
import type { ReportSummary } from './types';

export const NOTIFY_TIMEOUT_MS = 15_000;
const TOP_FAILURE_GROUPS = 5;
const MESSAGE_LENGTH = 200;

export interface Webhooks {
  slack?: string;
  teams?: string;
}

interface RunDigest {
  title: string;
  lines: string[];
  failures: string[];
  reportUrl?: string;
}

function clip(text: string): string {
  return text.length > MESSAGE_LENGTH ? `${text.slice(0, MESSAGE_LENGTH - 1)}…` : text;
}

function runDigest(summary: ReportSummary, reportUrl?: string): RunDigest {
  const groups = collectFailureGroups(summary);
  const flaky = collectTestsByState(summary, 'flaky').length;
  const failed = groups.reduce((count, group) => count + group.tests.length, 0);
  const tests = summary.specs.flatMap(spec => spec.tests.map(test => ({ spec, test })));
  const historyCount = (status: HistoryStatus) => tests.filter(test => historyStatus(summary, test) === status).length;
  const name = summary.suiteLabel ? `${summary.projectName} - ${summary.suiteLabel}` : summary.projectName;
  const failures = groups.slice(0, TOP_FAILURE_GROUPS).map(group => `${group.tests.length}× ${clip(group.message)}`);
  if (groups.length > TOP_FAILURE_GROUPS) failures.push(`…and ${groups.length - TOP_FAILURE_GROUPS} more failure groups`);
  return {
    title: `${failed > 0 ? '❌' : flaky > 0 ? '⚠️' : '✅'} ${name}`,
    lines: [
      `${failed} failed · ${flaky} flaky · ${summary.totalPassed - flaky} passed of ${summary.totalTests} tests (${summary.passRate}% pass rate) · ${formatDuration(summary.totalDurationMs)}`,
      summary.history ? `${historyCount('new')} new failures · ${historyCount('known')} known · ${historyCount('fixed')} fixed` : '',
      ciSourceLine(summary.ci)
    ].filter(Boolean),
    failures,
    reportUrl
  };
}

function slackText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function slackPayload({ title, lines, failures, reportUrl }: RunDigest) {
  const text = [`*${slackText(title)}*`, ...lines.map(slackText)];
  if (failures.length) text.push('', '*Top failures*', ...failures.map(failure => `• ${slackText(failure)}`));
  if (reportUrl) text.push('', `<${reportUrl}|Open the full report>`);
  return {
    text: slackText(`${title}: ${lines[0]}`),
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text: text.join('\n') } }]
  };
}

function teamsPayload({ title, lines, failures, reportUrl }: RunDigest) {
  const textBlock = (text: string, style: Record<string, string> = {}) => ({ type: 'TextBlock', text, wrap: true, ...style });
  const plainBlock = (text: string) => ({ type: 'RichTextBlock', spacing: 'None', inlines: [{ type: 'TextRun', text }] });
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            textBlock(title, { size: 'Medium', weight: 'Bolder' }),
            ...lines.map(line => textBlock(line, { spacing: 'None' })),
            ...(failures.length ? [textBlock('Top failures', { weight: 'Bolder' }), ...failures.map(failure => plainBlock(`• ${failure}`))] : [])
          ],
          actions: reportUrl ? [{ type: 'Action.OpenUrl', title: 'Open the full report', url: reportUrl }] : undefined
        }
      }
    ]
  };
}

export async function notify(summary: ReportSummary, webhooks: Webhooks, reportUrl?: string): Promise<boolean> {
  const digest = runDigest(summary, reportLink(summary, reportUrl));
  const targets = [
    ['Slack', webhooks.slack, slackPayload],
    ['Microsoft Teams', webhooks.teams, teamsPayload]
  ] as const;
  let ok = true;
  for (const [name, url, payload] of targets) {
    if (!url) continue;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload(digest)),
        signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS)
      });
      const body = await response.text();
      if (!response.ok) throw new Error(`answered ${response.status} ${response.statusText}${body ? `: ${clip(firstLine(body))}` : ''}`);
      console.log(`[neo-reporter] Posted the run summary to ${name}`);
    } catch (error) {
      ok = false;
      const failure = (error as { cause?: unknown }).cause ?? error;
      const reason = (failure instanceof Error ? failure.message : String(failure)).replaceAll(url, '[webhook URL]');
      console.warn(`[neo-reporter] Posting the run summary to ${name} failed: ${reason}`);
    }
  }
  return ok;
}
