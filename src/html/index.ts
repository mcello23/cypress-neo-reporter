import { escapeHtml, firstLine, formatDuration, formatTimestamp, machineTimeZone } from '../format';
import { buildRunSummaryText } from '../markdown';
import {
  buildAiTriagePrompt,
  buildSingleTestPrompt,
  collectFailureGroups,
  collectTestsByState,
  failingStreak,
  historySentence,
  historyStatus,
  testDomId,
  testHistoryCodes,
  testSummaryLine,
  type FailedTest,
  type HistoryStatus,
  type PromptKind
} from '../prompts';
import { hasFailureEvidence } from '../summary';
import type { ReportSummary, SpecData, TestData } from '../types';
import { packageVersion, readPlyrAssets } from './assets';
import { REPORT_CSS } from './styles';

const STATUS_LABELS: Record<TestData['state'], string> = {
  passed: 'Passed',
  failed: 'Failed',
  flaky: 'Flaky',
  pending: 'Skipped',
  skipped: 'Skipped'
};

/**
 * Icons repeated on every test row. They are drawn once in the page (iconSprite) and referenced with <use>,
 * because thousands of inline copies made up a third of the test list's size.
 */
const ROW_ICONS: Record<string, string> = {
  'status-failed': `<circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M15 9l-6 6M9 9l6 6" stroke="#FFF" stroke-width="2.5" stroke-linecap="round"/>`,
  'status-passed': `<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 12.5l2.7 2.7L16.5 9.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`,
  'status-flaky': `<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2a10 10 0 0 1 0 20z" fill="currentColor"/>`,
  'status-pending': `<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3.5 3"/>`,
  'status-skipped': `<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3.5 3"/>`,
  link: `<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>`,
  steps: `<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>`
};

function iconSprite(): string {
  return `<svg>${Object.entries(ROW_ICONS)
    .map(([id, shapes]) => `<symbol id="icon-${id}" viewBox="0 0 24 24">${shapes}</symbol>`)
    .join('')}</svg>`;
}

function statusIcon(state: TestData['state']): string {
  return `<svg class="status-icon status-${state}" viewBox="0 0 24 24" role="img" aria-label="${STATUS_LABELS[state]}"><title>${STATUS_LABELS[state]}</title><use href="#icon-status-${state}"/></svg>`;
}

/**
 * Steps, screenshots and recordings are written as data blocks after the page script, so the report can be used
 * as soon as the test list is in, while the heavy part still downloads. The page fills a test in when it is opened.
 * The order follows how the report is used: open Failures, then open each test for its screenshots and video.
 * Steps of passing tests are rarely opened, so they come last.
 */
const PAYLOAD_ORDER = ['failureSteps', 'screenshots', 'videos', 'steps'] as const;
type PayloadKind = (typeof PAYLOAD_ORDER)[number];

function dataBlock(id: string, content: string): string {
  return `<script type="application/octet-stream" id="${id}">${content}</script>`;
}

/** JSON inside a script tag must never contain "</script" or "<!--", so every "<" is escaped. */
function scriptSafeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/**
 * Generate the interactive HTML report
 */
export function generateHtmlReport(summary: ReportSummary): string {
  const suiteLabel = summary.suiteLabel ?? '';
  const pageTitle = suiteLabel ? `${summary.projectName} - ${suiteLabel}` : summary.projectName;
  const timeZone = summary.timeZone ?? machineTimeZone();
  const teamName = summary.teamName?.trim();
  const theme = summary.theme ?? 'auto';
  const version = packageVersion();
  const downloadFileName = `${pageTitle.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')}.html`;
  const formattedDuration = formatDuration(summary.totalDurationMs);
  const formattedDate = new Date(summary.timestamp).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone
  });

  const failedTests = collectTestsByState(summary, 'failed');
  const flakyTests = collectTestsByState(summary, 'flaky');
  const flakyCount = summary.specs.reduce((count, spec) => count + spec.tests.filter(t => t.state === 'flaky').length, 0);
  const plyrAssets = summary.specs.some(spec => spec.video?.base64 || spec.tests.some(t => t.video?.base64)) ? readPlyrAssets() : null;
  const aiPrompt = buildAiTriagePrompt(summary, 'failed');
  const aiFlakyPrompt = buildAiTriagePrompt(summary, 'flaky');
  const copyIconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
  const linkIconSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="#icon-link"/></svg>`;
  const failureGroups = collectFailureGroups(summary);

  const groupIndexByTest = new Map<TestData, number>();
  failureGroups.forEach((group, idx) => group.tests.forEach(({ test }) => groupIndexByTest.set(test, idx + 1)));

  const payloads: Record<PayloadKind, string[]> = { failureSteps: [], screenshots: [], steps: [], videos: [] };
  // The history dots of a test are drawn when it is opened; with a dot per run on every row they were a third of the test list.
  const historyRunTitles = (summary.history?.runs ?? []).map(
    run => `${run.label} · ${run.date ? formatTimestamp(run.date, timeZone).slice(0, 10) : ''}`
  );

  // Generate Waterfall Bar items
  const maxSpecDuration = Math.max(...summary.specs.map(s => s.duration), 1);
  const waterfallBarsHtml = summary.specs
    .map(spec => {
      const pct = Math.max(8, Math.round((spec.duration / maxSpecDuration) * 100));
      const hasFail = spec.failures > 0;
      const hasFlaky = !hasFail && spec.tests.some(t => t.state === 'flaky');
      const barColor = hasFail ? 'var(--color-fail)' : hasFlaky ? 'var(--color-flaky)' : 'var(--color-pass)';
      return `
      <div class="waterfall-row" onclick="filterBySpec('${escapeHtml(spec.specName)}')">
        <div class="waterfall-label" title="${escapeHtml(spec.specName)}">
          ${escapeHtml(spec.specName)}
        </div>
        <div class="waterfall-track">
          <div class="waterfall-fill" style="width: ${pct}%; background: ${barColor};">
            <span class="waterfall-time">${formatDuration(spec.duration)}</span>
          </div>
        </div>
        <div class="waterfall-badge ${hasFail ? 'badge-fail' : hasFlaky ? 'badge-flaky' : 'badge-pass'}">
          ${spec.passes}/${spec.total}
        </div>
      </div>
    `;
    })
    .join('\n');

  // Generate Spec cards
  const specCardsHtml = summary.specs
    .map((spec, specIdx) => {
      const hasFailures = spec.failures > 0;
      const specFlakyCount = spec.tests.filter(t => t.state === 'flaky').length;
      const statusBadge = hasFailures
        ? `<span class="badge badge-fail"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> ${spec.failures} FAILED</span>`
        : specFlakyCount > 0
          ? `<span class="badge badge-flaky"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> ${specFlakyCount} FLAKY</span>`
          : `<span class="badge badge-pass"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> PASSED</span>`;

      const testsHtml = spec.tests
        .map((t, testIdx) => {
          const isFail = t.state === 'failed';
          const isFlaky = t.state === 'flaky';
          const stateBadge = statusIcon(t.state);
          const attemptCount = t.attempts?.length ?? 1;
          const flakyTag = isFlaky
            ? `<span class="flaky-tag" title="Failed on attempt 1, passed on attempt ${attemptCount}">Flaky</span>`
            : '';
          const testHistoryStatus = historyStatus(summary, t);
          const historyCodes = testHistoryCodes(summary, t);
          const historyTag =
            testHistoryStatus === 'new'
              ? `<span class="history-tag history-tag-new" title="${escapeHtml(historySentence(summary, t) ?? '')}">New failure</span>`
              : testHistoryStatus === 'known'
                ? `<span class="history-tag history-tag-known" title="${escapeHtml(historySentence(summary, t) ?? '')}">Failing ${failingStreak(historyCodes ?? '') + 1}×</span>`
                : testHistoryStatus === 'fixed'
                  ? `<span class="history-tag history-tag-fixed" title="${escapeHtml(historySentence(summary, t) ?? '')}">Fixed</span>`
                  : '';
          const historyStripHtml =
            summary.history && historyCodes
              ? `
            <div class="history-strip">
              <span class="history-strip-label">Last ${summary.history.runs.length} runs</span>
              <span class="history-dots" data-codes="${historyCodes}" data-current="${isFail ? 'F' : t.state === 'passed' || isFlaky ? 'P' : 'S'}" data-current-label="${STATUS_LABELS[t.state]}"></span>
              <span class="history-strip-text">${escapeHtml(historySentence(summary, t) ?? '')}</span>
            </div>`
              : '';

          const stepsCount = t.steps?.length ?? 0;
          const stepsBadge =
            stepsCount > 0 ? `<span class="steps-chip" title="${stepsCount} executed test steps">${stepsCount} steps</span>` : '';

          const businessGoalHtml = t.businessGoal
            ? `
            <div class="business-goal-card">
              <div class="goal-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6366F1" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
              </div>
              <div class="goal-body">
                <div class="goal-persona">${escapeHtml(t.businessGoal.persona ?? 'Business User')} · Business Objective</div>
                <div class="goal-text">${escapeHtml(t.businessGoal.goal)}</div>
              </div>
            </div>
          `
            : '';

          if (stepsCount > 0) {
            const steps = t.steps?.map(({ phase, message, durationMs }) => ({ phase, message, durationMs }));
            payloads[hasFailureEvidence(t) ? 'failureSteps' : 'steps'].push(
              dataBlock(`steps-data-${specIdx}-${testIdx}`, scriptSafeJson(steps))
            );
          }
          if (t.video?.base64) payloads.videos.push(dataBlock(`test-video-${specIdx}-${testIdx}`, t.video.base64));
          const stepsListHtml =
            stepsCount > 0
              ? `
            <div class="steps-section" id="steps-${specIdx}-${testIdx}">
              <button type="button" class="steps-section-header" aria-expanded="false" aria-controls="steps-body-${specIdx}-${testIdx}" onclick="toggleSteps('steps-${specIdx}-${testIdx}')">
                <span class="steps-section-title">
                  <span class="steps-toggle-chevron">&#9654;</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="#icon-steps"/></svg>
                  Execution Steps (${stepsCount})
                </span>
                <span class="steps-section-sub">Sequential action log</span>
              </button>
              <div class="test-steps-timeline" id="steps-body-${specIdx}-${testIdx}" data-steps-id="steps-data-${specIdx}-${testIdx}"${isFail ? ' data-failed' : ''}></div>
            </div>
          `
              : `
            <div class="steps-section-empty">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
              <span>All Cypress DOM assertions and network validations passed cleanly.</span>
            </div>
          `;

          const failureDetailsHtml = hasFailureEvidence(t)
            ? `
          <div class="test-error-box${isFlaky ? ' flaky' : ''}">
            ${isFlaky ? `<div class="flaky-note">Failed on attempt 1, passed on attempt ${attemptCount}. Error, screenshots and recording below are from the first failure.</div>` : ''}
            <div class="error-header">
              <span class="error-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>
              <strong>${escapeHtml(firstLine(t.displayError) || 'Assertion Failure')}</strong>
              <button class="btn-action btn-action-sm error-copy-btn" data-copy="${escapeHtml(testSummaryLine({ spec, test: t }))}" onclick="copyDataText(this)">${copyIconSvg}<span class="copy-label">Copy summary</span></button>
            </div>
            ${t.displayError ? `<pre class="error-stack"><code>${escapeHtml(t.displayError)}</code></pre>` : ''}
            ${
              t.network?.length || t.consoleErrors?.length
                ? `<details class="test-code test-diagnostics" open><summary>Failed requests & console errors (${(t.network?.length ?? 0) + (t.consoleErrors?.length ?? 0)})</summary><ul class="diagnostics-list">${(
                    t.network ?? []
                  )
                    .map(
                      request =>
                        `<li><span class="diagnostic-status">${request.status}</span><code>${escapeHtml(request.url)}</code><span class="diagnostic-time">${formatTimestamp(request.timestamp, timeZone)}</span></li>`
                    )
                    .join(
                      ''
                    )}${(t.consoleErrors ?? []).map(message => `<li><span class="diagnostic-status diagnostic-console">console</span><code>${escapeHtml(message)}</code></li>`).join('')}</ul></details>`
                : ''
            }
            ${t.code ? `<details class="test-code"><summary>Test code</summary><pre class="error-stack"><code>${escapeHtml(t.code)}</code></pre></details>` : ''}
            <div class="test-ai-prompt">
              <div class="test-ai-prompt-header">
                <span class="test-ai-prompt-title">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" stroke-width="2"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 17l.7 2.3L22 20l-2.3.7L19 23l-.7-2.3L16 20l2.3-.7z"/></svg>
                  ${isFlaky ? 'AI Flaky Triage Prompt' : 'AI Triage Prompt'} for this test
                </span>
                <button class="btn-action btn-action-sm" onclick="copyAiPrompt(this, 'test-prompt-${specIdx}-${testIdx}')">${copyIconSvg}<span class="ai-copy-label">Copy prompt</span></button>
              </div>
              <details class="ai-prompt-details">
                <summary>Preview and edit before copying</summary>
                <textarea id="test-prompt-${specIdx}-${testIdx}" class="ai-prompt-text test-ai-prompt-text" spellcheck="false">${escapeHtml(
                  buildSingleTestPrompt(summary, { spec, test: t })
                )}</textarea>
              </details>
            </div>
            ${
              t.screenshots && t.screenshots.length > 0
                ? `
              <div class="screenshot-evidence">
                <div class="evidence-title">Automated Failure Evidence:</div>
                <div class="screenshot-gallery">
                  ${t.screenshots
                    .map((s, shotIdx) => {
                      const mediaId = `shot-${specIdx}-${testIdx}-${shotIdx}`;
                      if (s.base64) payloads.screenshots.push(dataBlock(mediaId, s.base64));
                      return `
                    <div class="screenshot-thumbnail-wrap" data-caption="${escapeHtml(t.fullTitle)}" onclick="openLightbox(this.querySelector('img').src, this.dataset.caption)">
                      <img ${s.base64 ? `data-media-id="${mediaId}"` : `src="${escapeHtml(s.path)}"`} alt="${escapeHtml(s.name)}" class="screenshot-thumb" />
                      ${s.base64 ? '<div class="media-loader"><span class="media-spinner"></span>Loading screenshot…</div>' : ''}
                      <div class="zoom-overlay"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg> Click to Zoom</div>
                    </div>
                  `;
                    })
                    .join('')}
                </div>
              </div>
            `
                : ''
            }
            ${
              t.video?.base64
                ? `
              <div class="video-evidence">
                <div class="evidence-title">Test Recording:</div>
                <div class="video-player" data-video-id="test-video-${specIdx}-${testIdx}"></div>
              </div>
            `
                : t.video
                  ? `
              <div class="video-evidence">
                <div class="evidence-title">Test Recording:</div>
                <div>${escapeHtml(t.video.name)} is not embedded (report size limit); see the run's videos folder.</div>
              </div>
            `
                  : spec.video?.base64
                    ? `
              <div class="video-evidence">
                <div class="evidence-title">Spec Recording:</div>
                <div class="video-player" data-video-id="spec-video-${specIdx}"></div>
              </div>
            `
                    : spec.video
                      ? `
              <div class="video-evidence">
                <div class="evidence-title">Spec Recording:</div>
                <div>${escapeHtml(spec.video.name)} is not embedded (report size limit); see the run's videos folder.</div>
              </div>
            `
                      : ''
            }
          </div>
        `
            : '';

          return `
          <div class="test-row state-${t.state}" data-state="${t.state}" data-title="${escapeHtml(t.fullTitle.toLowerCase())}" data-error="${escapeHtml(firstLine(t.displayError).toLowerCase())}" data-group="${groupIndexByTest.get(t) ?? ''}" data-history="${testHistoryStatus ?? ''}">
            <div class="test-row-main" onclick="toggleTestDetails('test-${specIdx}-${testIdx}')">
              <div class="test-state-col">
                ${stateBadge}
              </div>
              <div class="test-title-col">
                <div class="test-title-text">${escapeHtml(t.title[t.title.length - 1])}</div>
                ${t.title.length > 1 ? `<div class="test-suite-crumbs">${escapeHtml(t.title.slice(0, -1).join(' › '))}</div>` : ''}
              </div>
              <div class="test-duration-col">
                ${historyTag}
                ${flakyTag}
                ${stepsBadge}
                ${t.startedAt ? `<span class="started-at-chip" title="Test started at (${escapeHtml(timeZone)})">${formatTimestamp(t.startedAt, timeZone)}</span>` : ''}
                <span class="duration-chip">${formatDuration(t.duration)}</span>
                <button type="button" class="test-link-btn" title="Copy a link that opens this test" onclick="copyTestLink(event, this, 'test-${specIdx}-${testIdx}')">${linkIconSvg}<span class="copy-label">Link</span></button>
                <span class="chevron-arrow" id="chevron-test-${specIdx}-${testIdx}">▼</span>
              </div>
            </div>
            <div id="test-${specIdx}-${testIdx}" class="test-details-drawer">
              ${historyStripHtml}
              ${businessGoalHtml}
              ${stepsListHtml}
              ${failureDetailsHtml}
            </div>
          </div>
        `;
        })
        .join('\n');
      if (spec.video?.base64) payloads.videos.push(dataBlock(`spec-video-${specIdx}`, spec.video.base64));

      return `
      <div class="spec-card ${hasFailures ? 'spec-has-failure' : specFlakyCount > 0 ? 'spec-has-flaky' : ''}" data-spec-name="${escapeHtml(spec.specName.toLowerCase())}" data-owner="${escapeHtml((spec.owner ?? '').toLowerCase())}">
        <div class="spec-card-header" onclick="toggleSpecCollapse('spec-body-${specIdx}')">
          <div class="spec-title-group">
            <span class="spec-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span>
            <div class="spec-title-box">
              <span class="spec-name-row">
                <span class="spec-tag">SPEC</span>
                <span class="spec-name">${escapeHtml(spec.specName)}</span>
              </span>
              <button type="button" class="spec-path" title="Copy spec path" data-path="${escapeHtml(spec.specFile)}" onclick="copySpecPath(event, this)"><span class="spec-path-label">${escapeHtml(spec.specFile)}</span>${copyIconSvg}</button>
            </div>
          </div>
          <div class="spec-meta-group">
            ${spec.owner ? `<span class="spec-owner-badge" title="Author with the most commits to this spec">${escapeHtml(spec.owner)}</span>` : ''}
            <span class="spec-time-badge">${formatDuration(spec.duration)}</span>
            <span class="spec-count-badge">${spec.passes}/${spec.total} passed</span>
            ${statusBadge}
            <span class="collapse-chevron" id="chevron-spec-body-${specIdx}">▼</span>
          </div>
        </div>
        <div class="spec-card-body" id="spec-body-${specIdx}" style="display: none">
          ${testsHtml}
        </div>
      </div>
    `;
    })
    .join('\n')
    // Template indentation was a quarter of a big report. Every text value is escaped, so ">  <" is always between tags.
    .replace(/>\s+</g, '>\n<');

  const ci = summary.ci ?? {};
  const runMetaItems: Array<[string, string | undefined, string | undefined]> = [
    ['Branch', ci.branch, undefined],
    ['Commit', ci.commit?.slice(0, 8), ci.commitUrl],
    ['Build', ci.build, ci.buildUrl],
    ['Release', ci.release, ci.releaseUrl]
  ];
  const renderRunMeta = (items: typeof runMetaItems) =>
    items
      .filter(([, value]) => value)
      .map(([label, value, url]) => {
        const text = `<span class="run-meta-label">${label}</span> ${escapeHtml(value ?? '')}`;
        return url
          ? `<a class="run-meta-item" href="${escapeHtml(url)}" target="_blank" rel="noopener">${text}</a>`
          : `<span class="run-meta-item">${text}</span>`;
      })
      .join('');
  const runMetaHtml = renderRunMeta(runMetaItems.slice(0, 2));
  const buildMetaHtml = renderRunMeta(runMetaItems.slice(2));

  const passedCount = summary.totalPassed - flakyCount;
  const skippedCount = summary.totalPending + summary.totalSkipped;
  const outcomeSegments: Array<{ state: TestData['state']; filter: string; count: number; label: string }> = [
    { state: 'passed', filter: 'passed', count: passedCount, label: 'passed' },
    { state: 'failed', filter: 'failed', count: failedTests.length, label: 'failed' },
    { state: 'flaky', filter: 'flaky', count: flakyCount, label: 'flaky' },
    { state: 'pending', filter: 'pending', count: skippedCount, label: 'skipped' }
  ];
  const topCountsHtml = outcomeSegments
    .filter(segment => segment.count > 0 || segment.state === 'failed' || segment.state === 'passed')
    .map(
      segment =>
        `<button type="button" class="top-count count-${segment.state}" onclick="setFilter('${segment.filter}')">${statusIcon(segment.state)}<strong>${segment.count}</strong> ${segment.label}</button>`
    )
    .join('');
  const outcomeBarHtml = `
      <div class="outcome-bar" role="img" aria-label="${outcomeSegments.map(segment => `${segment.count} ${segment.label}`).join(', ')}">
        ${outcomeSegments
          .filter(segment => segment.count > 0)
          .map(
            segment =>
              `<span class="outcome-segment segment-${segment.state}" style="flex-grow: ${segment.count}" title="${segment.count} ${segment.label}"></span>`
          )
          .join('')}
      </div>
      <div class="outcome-legend">
        ${outcomeSegments
          .map(
            segment =>
              `<button type="button" class="outcome-legend-item count-${segment.state}" onclick="setFilter('${segment.filter}')"><strong>${segment.count}</strong> ${segment.label}</button>`
          )
          .join('')}
      </div>`;

  const statCells: Array<{ label: string; value: string; sub: string; tone?: string; accent: string }> = [
    {
      accent: failedTests.length ? 'fail' : 'pass',
      tone: failedTests.length ? 'failed' : 'passed',
      label: 'Pass rate',
      value: `${summary.passRate}%`,
      sub: `${summary.totalPassed} of ${summary.totalTests} passed${flakyCount ? ` · ${flakyCount} on a retry` : ''}`
    },
    {
      accent: failedTests.length ? 'fail' : 'neutral',
      label: 'Failed',
      value: String(failedTests.length),
      sub: !failedTests.length
        ? 'None this run'
        : summary.history
          ? `${failedTests.filter(({ test }) => historyStatus(summary, test) === 'new').length} new · ${failedTests.filter(({ test }) => historyStatus(summary, test) === 'known').length} known`
          : `${failureGroups.length} distinct error${failureGroups.length === 1 ? '' : 's'}`,
      tone: failedTests.length ? 'failed' : undefined
    },
    {
      accent: flakyCount ? 'flaky' : 'neutral',
      label: 'Flaky',
      value: String(flakyCount),
      sub: flakyCount ? 'Passed on a retry' : 'None this run',
      tone: flakyCount ? 'flaky' : undefined
    },
    {
      accent: 'brand',
      label: 'Tests',
      value: String(summary.totalTests),
      sub: `${summary.totalSpecs} specs${skippedCount ? ` · ${skippedCount} skipped` : ''}`
    },
    { accent: 'time', label: 'Duration', value: formattedDuration, sub: `${summary.browser} · ${summary.resolution}` }
  ];
  const statStripHtml = statCells
    .map(
      cell => `
        <div class="stat-cell accent-${cell.accent}">
          <div class="stat-label">${cell.label}</div>
          <div class="stat-value${cell.tone ? ` stat-${cell.tone}` : ''}">${escapeHtml(cell.value)}</div>
          <div class="stat-sub">${escapeHtml(cell.sub)}</div>
        </div>`
    )
    .join('');

  const emptyState = (text: string) => `<p class="empty-state">${text}</p>`;

  const panelIcons = {
    groups: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
    ai: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 17l.7 2.3L22 20l-2.3.7L19 23l-.7-2.3L16 20l2.3-.7z"/>',
    owners:
      '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    bars: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>'
  };
  const panelTitle = (title: string, icon: string) =>
    `<h2 class="panel-title"><svg class="panel-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>${title}</h2>`;

  const panel = (title: string, icon: string, accent: string, meta: string, body: string, extraClass = '') => `
        <section class="panel accent-${accent}${extraClass}">
          <div class="panel-header">
            ${panelTitle(title, icon)}
            <div class="panel-meta">${meta}</div>
          </div>
          ${body}
        </section>`;

  const GROUP_TESTS_SHOWN = 5;
  const failureGroupsPanelHtml = panel(
    'Failure groups',
    panelIcons.groups,
    failureGroups.length ? 'fail' : 'neutral',
    failureGroups.length
      ? `${failedTests.length} failure${failedTests.length === 1 ? '' : 's'} · ${failureGroups.length} distinct error${failureGroups.length === 1 ? '' : 's'} <button class="btn-action btn-action-sm" data-copy="${escapeHtml(buildRunSummaryText(summary, pageTitle, failureGroups))}" onclick="copyDataText(this)">${copyIconSvg}<span class="copy-label">Copy summary</span></button>`
      : '',
    failureGroups.length
      ? `<div class="failure-groups">${failureGroups
          .map(
            (group, idx) => `
            <div class="failure-group">
              <button type="button" class="failure-group-header" title="Show only these failures" onclick="showGroup(${idx + 1})">
                <span class="failure-group-count">${group.tests.length}×</span>
                <code class="failure-group-message">${escapeHtml(group.message)}</code>
              </button>
              <div class="failure-group-tests">${group.tests
                .slice(0, GROUP_TESTS_SHOWN)
                .map(
                  failure =>
                    `<button type="button" class="test-jump" onclick="openTest('${testDomId(summary, failure)}')"><span class="test-jump-spec">${escapeHtml(failure.spec.specName)}</span> › ${escapeHtml(failure.test.fullTitle)}${failure.spec.owner ? `<span class="test-jump-owner"> · ${escapeHtml(failure.spec.owner)}</span>` : ''}</button>`
                )
                .join('')}${
                group.tests.length > GROUP_TESTS_SHOWN
                  ? `<button type="button" class="test-jump test-jump-more" onclick="showGroup(${idx + 1})">and ${group.tests.length - GROUP_TESTS_SHOWN} more…</button>`
                  : ''
              }</div>
            </div>`
          )
          .join('')}</div>`
      : emptyState('No failures this run.'),
    ' panel-wide'
  );

  const slowestTests = summary.specs
    .flatMap(spec => spec.tests.filter(test => test.duration > 0).map(test => ({ spec, test })))
    .sort((a, b) => b.test.duration - a.test.duration)
    .slice(0, 5);
  const slowestSpecs = [...summary.specs].sort((a, b) => b.duration - a.duration).slice(0, 5);
  const specState = (spec: SpecData): TestData['state'] =>
    spec.failures > 0 ? 'failed' : spec.tests.some(t => t.state === 'flaky') ? 'flaky' : 'passed';

  const slowestTestsPanelHtml = panel(
    'Slowest tests',
    panelIcons.clock,
    'time',
    '',
    slowestTests.length
      ? `<div class="panel-list">${slowestTests
          .map(
            failure =>
              `<button type="button" class="panel-row" title="${escapeHtml(`${failure.spec.specName} › ${failure.test.fullTitle}`)}" onclick="openTest('${testDomId(summary, failure)}')">${statusIcon(failure.test.state)}<span class="panel-row-name">${escapeHtml(failure.test.title[failure.test.title.length - 1])}</span><span class="panel-row-value">${formatDuration(failure.test.duration)}</span></button>`
          )
          .join('')}</div>`
      : emptyState('No timed tests this run.'),
    ' panel-half'
  );

  const slowestSpecsPanelHtml = panel(
    'Slowest specs',
    panelIcons.clock,
    'time',
    '',
    slowestSpecs.length
      ? `<div class="panel-list">${slowestSpecs
          .map(
            spec =>
              `<button type="button" class="panel-row" title="${escapeHtml(spec.specFile)}" onclick="filterBySpec('${escapeHtml(spec.specName)}')">${statusIcon(specState(spec))}<span class="panel-row-name">${escapeHtml(spec.specName)}</span><span class="panel-row-value">${formatDuration(spec.duration)}</span></button>`
          )
          .join('')}</div>`
      : emptyState('No specs ran.'),
    ' panel-half'
  );

  const ownerCounts = new Map<string, { failed: number; flaky: number }>();
  for (const { spec, test } of [...failedTests, ...flakyTests]) {
    if (!spec.owner) continue;
    const counts = ownerCounts.get(spec.owner) ?? { failed: 0, flaky: 0 };
    if (test.state === 'failed') counts.failed++;
    else counts.flaky++;
    ownerCounts.set(spec.owner, counts);
  }
  const hasOwners = summary.specs.some(spec => spec.owner);
  const ownersPanelHtml = panel(
    'Owners',
    panelIcons.owners,
    'brand',
    hasOwners ? 'failed · flaky' : '',
    ownerCounts.size
      ? `<div class="panel-list">${[...ownerCounts]
          .sort((a, b) => b[1].failed - a[1].failed || b[1].flaky - a[1].flaky)
          .map(
            ([owner, counts]) =>
              `<button type="button" class="panel-row" onclick="searchAll('owner:&quot;${escapeHtml(owner.toLowerCase())}&quot;')"><span class="panel-row-name">${escapeHtml(owner)}</span><span class="panel-row-value"><span class="count-failed">${counts.failed}</span> · <span class="count-flaky">${counts.flaky}</span></span></button>`
          )
          .join('')}</div>`
      : emptyState(
          hasOwners ? 'No failed or flaky tests this run.' : 'No owner data: git history was not available when the report was built.'
        ),
    ' panel-owners'
  );

  const aiPanel = (kind: PromptKind, prompt: string, count: number) =>
    panel(
      kind === 'flaky' ? 'AI flaky triage' : 'AI failure triage',
      panelIcons.ai,
      kind === 'flaky' ? 'flaky' : 'ai',
      prompt
        ? `<button class="btn-action btn-action-sm" onclick="copyAiPrompt(this, '${kind === 'flaky' ? 'aiFlakyPromptText' : 'aiPromptText'}')">${copyIconSvg}<span class="ai-copy-label">Copy prompt</span></button>`
        : '',
      prompt
        ? `<p class="panel-text">${count} ${kind === 'flaky' ? `flaky test${count === 1 ? '' : 's'}` : `failure${count === 1 ? '' : 's'}`} · ${(prompt.length / 1000).toFixed(1)}k chars · paste into Claude, Copilot or ChatGPT.</p>
          <details class="ai-prompt-details">
            <summary>Preview and edit before copying</summary>
            <textarea id="${kind === 'flaky' ? 'aiFlakyPromptText' : 'aiPromptText'}" class="ai-prompt-text" spellcheck="false">${escapeHtml(prompt)}</textarea>
          </details>`
        : emptyState(kind === 'flaky' ? 'No flaky tests this run.' : 'No failures to triage.'),
      ' panel-ai'
    );

  const allTestsWithSpec = summary.specs.flatMap(spec => spec.tests.map(test => ({ spec, test })));
  const testsWithStatus = (status: HistoryStatus) => allTestsWithSpec.filter(({ test }) => historyStatus(summary, test) === status);

  const testRowButton = (failure: FailedTest, value: string) =>
    `<button type="button" class="panel-row" title="${escapeHtml(`${failure.spec.specName} › ${failure.test.fullTitle}`)}" onclick="openTest('${testDomId(summary, failure)}')">${statusIcon(failure.test.state)}<span class="panel-row-name">${escapeHtml(failure.test.title[failure.test.title.length - 1])}</span><span class="panel-row-value">${value}</span></button>`;

  const historyListPanel = (
    title: string,
    accent: string,
    items: FailedTest[],
    value: (failure: FailedTest) => string,
    empty: string,
    meta = ''
  ) =>
    panel(
      title,
      panelIcons.clock,
      accent,
      meta || (items.length ? String(items.length) : ''),
      items.length ? `<div class="panel-list">${items.map(item => testRowButton(item, value(item))).join('')}</div>` : emptyState(empty)
    );

  const history = summary.history;
  const trendPoints = [
    ...(history?.runs ?? []).map(run => ({
      label: run.label,
      failed: run.failed,
      total: run.total,
      date: run.date,
      url: run.url,
      current: false
    })),
    { label: 'This run', failed: failedTests.length, total: summary.totalTests, date: summary.timestamp, url: undefined, current: true }
  ];
  const maxTrendFailed = Math.max(1, ...trendPoints.map(point => point.failed));
  const historyPanelsHtml = history
    ? `${panel(
        'Run history',
        panelIcons.bars,
        'brand',
        `Failed tests per run · last ${history.runs.length} runs of “${escapeHtml(history.family)}” in Azure DevOps`,
        `<div class="trend-chart">${trendPoints
          .map(point => {
            const body = `<span class="trend-value">${point.failed}</span><span class="trend-track"><span class="trend-bar" style="height: ${Math.max(3, Math.round((point.failed / maxTrendFailed) * 100))}%"></span></span><span class="trend-label">${escapeHtml(point.label)}</span>`;
            const tooltip = escapeHtml(
              `${point.label} · ${point.date ? formatTimestamp(point.date, timeZone).slice(0, 10) : ''} · ${point.failed} failed of ${point.total}`
            );
            return point.url
              ? `<a class="trend-col" href="${escapeHtml(point.url)}" target="_blank" rel="noopener" title="${tooltip}">${body}</a>`
              : `<span class="trend-col${point.current ? ' trend-current' : ''}" title="${tooltip}">${body}</span>`;
          })
          .join('')}</div>`,
        ' panel-wide'
      )}
      ${historyListPanel('New failures', 'fail', testsWithStatus('new'), () => 'new', 'None: every failure also failed in the previous run.')}
      ${historyListPanel('Fixed since last run', 'pass', testsWithStatus('fixed'), () => 'fixed', 'Nothing that failed last run passes now.')}
      ${historyListPanel(
        'Most unstable',
        'flaky',
        allTestsWithSpec
          .map(item => ({ item, codes: testHistoryCodes(summary, item.test) ?? '' }))
          .filter(({ codes }) => codes.split('F').length - 1 >= 2)
          .sort((a, b) => b.codes.split('F').length - a.codes.split('F').length)
          .slice(0, 5)
          .map(({ item }) => item),
        item => {
          const codes = testHistoryCodes(summary, item.test) ?? '';
          return `${codes.split('F').length - 1}/${codes.replace(/-/g, '').length}`;
        },
        'No test failed twice in the last runs.',
        'failed in last runs'
      )}`
    : panel(
        'Run history',
        panelIcons.bars,
        'neutral',
        '',
        `<p class="empty-state">Not loaded for this report. History comes from past Azure DevOps test runs. In a pipeline, map <code>SYSTEM_ACCESSTOKEN</code> into the Cypress step. On your machine, set <code>AZURE_DEVOPS_PAT</code> (Test Management, read) plus <code>history.organization</code> and <code>history.project</code> in the reporter options.</p>`,
        ' panel-wide'
      );

  const durationsPanelHtml = `
        <details class="panel panel-wide accent-brand durations-panel">
          <summary class="panel-header">
            ${panelTitle('Spec durations', panelIcons.bars)}
            <div class="panel-meta">${summary.specs.length} spec${summary.specs.length === 1 ? '' : 's'} · click a bar to open its tests</div>
          </summary>
          <div class="waterfall-container">
            ${waterfallBarsHtml}
          </div>
        </details>`;

  const galleryCount = summary.specs.reduce(
    (count, spec) =>
      count +
      spec.tests.reduce(
        (testCount, t) =>
          testCount +
          (hasFailureEvidence(t) ? (t.screenshots?.length ?? 0) + (t.video?.base64 || (!t.video && spec.video?.base64) ? 1 : 0) : 0),
        0
      ),
    0
  );

  const railItems: Array<{ nav: string; label: string; count?: number; onclick: string; icon: string }> = [
    {
      nav: 'insights',
      label: 'Insights',
      onclick: "showView('insights')",
      icon: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>'
    },
    {
      nav: 'failed',
      label: 'Failures',
      count: failedTests.length,
      onclick: "setFilter('failed')",
      icon: '<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/>'
    },
    {
      nav: 'flaky',
      label: 'Flaky',
      count: flakyCount,
      onclick: "setFilter('flaky')",
      icon: '<path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>'
    },
    {
      nav: 'all',
      label: 'All tests',
      count: summary.totalTests,
      onclick: "setFilter('all')",
      icon: '<path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>'
    },
    {
      nav: 'gallery',
      label: 'Gallery',
      count: galleryCount,
      onclick: "showView('gallery')",
      icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>'
    }
  ];
  const railHtml = railItems
    .map(
      item =>
        `<button type="button" class="rail-item" data-nav="${item.nav}" onclick="${item.onclick}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${item.icon}</svg><span class="rail-label">${item.label}</span>${item.count === undefined ? '' : `<span class="rail-count">${item.count}</span>`}</button>`
    )
    .join('');

  const menuItemsHtml = [
    aiPrompt
      ? `<button type="button" class="menu-item" onclick="copyAiPrompt(this, 'aiPromptText')">${copyIconSvg}<span class="ai-copy-label">Copy failure AI prompt</span></button>`
      : '',
    aiFlakyPrompt
      ? `<button type="button" class="menu-item" onclick="copyAiPrompt(this, 'aiFlakyPromptText')">${copyIconSvg}<span class="ai-copy-label">Copy flaky AI prompt</span></button>`
      : '',
    failureGroups.length || flakyCount
      ? `<button type="button" class="menu-item" data-copy="${escapeHtml(buildRunSummaryText(summary, pageTitle, failureGroups))}" onclick="copyDataText(this)">${copyIconSvg}<span class="copy-label">Copy run summary</span></button>`
      : '',
    `<button type="button" class="menu-item" onclick="saveReportAsHtml(this)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg><span class="save-html-label">Save as HTML</span></button>`,
    `<button type="button" class="menu-item" onclick="printReport()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg><span>Print</span></button>`
  ].join('');

  return `<!DOCTYPE html>
<html lang="en" data-theme="${theme === 'light' ? 'light' : 'dark'}" data-default-theme="${theme}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(teamName ? `${pageTitle} · ${teamName}` : pageTitle)}</title>
  <script>
    (function () {
      var root = document.documentElement;
      var saved = null;
      try {
        saved = localStorage.getItem('neo-report-theme');
      } catch (e) {}
      var preferred = root.getAttribute('data-default-theme');
      var system = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
      root.setAttribute('data-theme', saved || (preferred === 'auto' ? system : preferred));
    })();
  </script>
  <style>
${REPORT_CSS}
  </style>
  ${plyrAssets ? `<style>${plyrAssets.css}</style>` : ''}
</head>
<body>
  ${plyrAssets ? `<div hidden>${plyrAssets.sprite}</div>` : ''}
  <div hidden>${iconSprite()}</div>
  <header class="top-bar">
    <button type="button" class="brand" onclick="showView('insights')" title="Back to Insights">
      <svg width="20" height="20" viewBox="0 0 28 28" aria-hidden="true"><rect width="28" height="28" rx="8" fill="var(--text-primary)"/><path d="M8.5 19.5v-11l11 11v-11" fill="none" stroke="var(--bg-canvas)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="22.5" cy="5.5" r="2.5" fill="var(--color-brand)"/></svg>
      ${escapeHtml(pageTitle)}
    </button>
    ${runMetaHtml ? `<div class="run-meta">${runMetaHtml}</div>` : ''}
    <div class="top-bar-right">
      ${topCountsHtml}
      <span class="top-duration" title="Suite duration">${formattedDuration}</span>
      <label class="search-box">
        <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" id="searchInput" class="search-input" placeholder="Search tests…" aria-label="Search tests" oninput="handleSearch(this.value)" />
        <span class="search-kbd">Ctrl K</span>
      </label>
      <button type="button" class="icon-btn" onclick="toggleTheme()" title="Switch light or dark theme" aria-label="Switch light or dark theme">
        <svg class="icon-moon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
        <svg class="icon-sun" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
      </button>
      <details class="menu" id="actionsMenu">
        <summary class="btn-action">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Actions
        </summary>
        <div class="menu-list">${menuItemsHtml}</div>
      </details>
    </div>
  </header>

  <div class="shell">
    <nav class="rail" aria-label="Report views" aria-busy="true" inert>${railHtml}<div class="rail-loader"><span class="media-spinner"></span>Loading report…</div></nav>

    <main class="main">
      <section data-view="insights">
        <div class="view-header">
          <h1 class="view-title">Insights</h1>
          <span class="view-subtitle">${teamName ? `${escapeHtml(teamName)} · ` : ''}Run of ${escapeHtml(formattedDate)} (${escapeHtml(timeZone)}) · Target: ${escapeHtml(summary.environment || 'n/a')}</span>
          ${buildMetaHtml ? `<div class="run-meta run-meta-inline">${buildMetaHtml}</div>` : ''}
        </div>
        <div class="stat-strip">${statStripHtml}</div>
        ${outcomeBarHtml}
        <div class="panel-grid">
          ${failureGroupsPanelHtml}
          ${historyPanelsHtml}
          ${aiPanel('failed', aiPrompt, failedTests.length)}
          ${aiPanel('flaky', aiFlakyPrompt, flakyTests.length)}
          ${ownersPanelHtml}
          ${slowestTestsPanelHtml}
          ${slowestSpecsPanelHtml}
          ${durationsPanelHtml}
        </div>
      </section>

      <section data-view="tests" hidden>
        <div class="view-header">
          <h1 class="view-title" id="testsViewTitle">All tests</h1>
          <span class="view-subtitle" id="testsViewCount"></span>
          <div class="view-actions">
            <button class="btn-action" onclick="toggleAllSpecs()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path id="expand-collapse-icon" d="M7 13l5 5 5-5M7 6l5 5 5-5"/></svg>
              <span id="expand-collapse-text">Expand All</span>
            </button>
          </div>
        </div>
        <div class="search-hint">Search filters: <code>status:failed</code> <code>spec:checkout</code> <code>error:timed out</code> <code>owner:name</code> <code>group:2</code> <code>history:new</code> · quote values with spaces, e.g. <code>error:"never found"</code></div>
        <section class="specs-list" id="specsList">
          ${specCardsHtml}
        </section>
        <p class="empty-state" id="testsEmpty" hidden>No tests match this view.</p>
      </section>

      <section data-view="gallery" hidden>
        <div class="view-header">
          <h1 class="view-title">Gallery</h1>
          <span class="view-subtitle">Screenshots and recordings from failed and flaky tests</span>
        </div>
        <div class="gallery-grid" id="galleryGrid"></div>
      </section>

      <footer class="footer">
        <div>Generated by <a href="https://github.com/mcello23/cypress-neo-reporter" target="_blank" rel="noopener"><strong>Cypress Neo Reporter</strong></a>${version ? ` ${escapeHtml(version)}` : ''}</div>
        <div>Run executed on ${escapeHtml(formattedDate)} (${escapeHtml(timeZone)}) · Target: ${escapeHtml(summary.environment || 'n/a')}</div>
      </footer>
    </main>
  </div>

  <!-- Lightbox Modal for Screenshots -->
  <div id="lightboxModal" class="modal-lightbox" onclick="closeLightbox()">
    <div class="lightbox-content" onclick="event.stopPropagation()">
      <button class="lightbox-close" onclick="closeLightbox()">&times;</button>
      <div id="lightboxViewport" class="lightbox-viewport">
        <img id="lightboxImg" class="lightbox-img" src="" alt="Screenshot" onclick="toggleLightboxZoom(event)" onload="markLightboxZoomable()" />
      </div>
      <div id="lightboxCaption" class="lightbox-caption"></div>
    </div>
  </div>

  ${plyrAssets ? `<script>${plyrAssets.js}</script>` : ''}
  <script>
    let currentFilter = 'all';
    let searchQuery = '';
    let currentView = 'insights';
    const FILTER_TITLES = { all: 'All tests', failed: 'Failures', flaky: 'Flaky', passed: 'Passed', pending: 'Skipped' };
    const VIEW_HASHES = ['insights', 'gallery', ...Object.keys(FILTER_TITLES)];

    function toggleTheme() {
      const html = document.documentElement;
      const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      html.setAttribute('data-theme', next);
      try {
        localStorage.setItem('neo-report-theme', next);
      } catch (e) {}
    }

    function showView(view, keepScroll) {
      currentView = view;
      document.querySelectorAll('[data-view]').forEach(section => (section.hidden = section.getAttribute('data-view') !== view));
      const activeNav = view === 'tests' ? currentFilter : view;
      document.querySelectorAll('.rail-item').forEach(item => item.classList.toggle('active', item.getAttribute('data-nav') === activeNav));
      if (view === 'gallery') buildGallery();
      if (view !== 'tests') history.replaceState(null, '', '#' + view);
      if (!keepScroll) window.scrollTo({ top: 0 });
    }

    function setFilter(filter) {
      currentFilter = filter;
      setSearch('');
      showView('tests');
      history.replaceState(null, '', '#' + filter);
      if (filter === 'failed' || filter === 'flaky') {
        document.querySelectorAll('.spec-card').forEach(card => {
          if (card.style.display !== 'none') revealCard(card, true);
        });
      }
    }

    function setSearch(query) {
      document.getElementById('searchInput').value = query;
      searchQuery = query.trim().toLowerCase();
      applyFilters();
    }

    function searchAll(query) {
      currentFilter = 'all';
      setSearch(query);
      showView('tests');
    }

    function showGroup(groupIndex) {
      currentFilter = 'failed';
      setSearch('group:' + groupIndex);
      showView('tests');
      document.querySelectorAll('.spec-card').forEach(card => {
        if (card.style.display !== 'none') revealCard(card, true);
      });
    }

    function handleSearch(query) {
      searchQuery = query.trim().toLowerCase();
      applyFilters();
      if (currentView !== 'tests') showView('tests');
    }

    function filterBySpec(specName) {
      searchAll(specName);
      const card = Array.from(document.querySelectorAll('.spec-card')).find(
        c => c.getAttribute('data-spec-name') === specName.toLowerCase()
      );
      if (card) revealCard(card);
    }

    function revealCard(card, skipScroll) {
      const body = card.querySelector('.spec-card-body');
      if (body && body.style.display === 'none') toggleSpecCollapse(body.id);
      if (!skipScroll) scrollToCard(card);
    }

    function scrollToCard(card) {
      const topBar = document.querySelector('.top-bar');
      const offset = (topBar ? topBar.getBoundingClientRect().height : 0) + 16;
      const top = card.getBoundingClientRect().top + window.pageYOffset - offset;
      window.scrollTo({ top: Math.max(top, 0), behavior: 'smooth' });
    }

    const SEARCH_TOKEN_PATTERN = /(status|spec|error|owner|group|history):("[^"]*"|\\S*)|"([^"]*)"|(\\S+)/g;

    function parseSearch(query) {
      const tokens = {};
      const words = [];
      for (const match of query.matchAll(SEARCH_TOKEN_PATTERN)) {
        if (match[1]) {
          const value = match[2].replace(/^"|"$/g, '');
          if (value) (tokens[match[1]] = tokens[match[1]] || []).push(value);
        } else {
          words.push(match[3] ?? match[4]);
        }
      }
      return { tokens, text: words.join(' ').trim() };
    }

    function matchesTokens(tokens, fields) {
      return Object.keys(tokens).every(key =>
        tokens[key].some(value =>
          key === 'status'
            ? fields.status === value || (value === 'skipped' && fields.status === 'pending')
            : key === 'group' || key === 'history'
              ? fields[key] === value
              : fields[key].includes(value)
        )
      );
    }

    function applyFilters() {
      const specCards = document.querySelectorAll('.spec-card');
      const search = parseSearch(searchQuery);
      let visibleTotal = 0;

      specCards.forEach(card => {
        const specName = card.getAttribute('data-spec-name') || '';
        const owner = card.getAttribute('data-owner') || '';
        const testRows = card.querySelectorAll('.test-row');
        let visibleTestsCount = 0;

        testRows.forEach(row => {
          const state = row.getAttribute('data-state');
          const title = row.getAttribute('data-title') || '';
          const error = row.getAttribute('data-error') || '';
          const group = row.getAttribute('data-group') || '';
          const history = row.getAttribute('data-history') || '';

          const matchesFilter = (currentFilter === 'all') || (state === currentFilter) || (currentFilter === 'pending' && state === 'skipped');
          const matchesSearch =
            matchesTokens(search.tokens, { status: state, spec: specName, error, owner, group, history }) &&
            (!search.text || title.includes(search.text) || specName.includes(search.text));

          if (matchesFilter && matchesSearch) {
            row.style.display = '';
            visibleTestsCount++;
          } else {
            row.style.display = 'none';
          }
        });

        if (visibleTestsCount > 0) {
          card.style.display = '';
        } else {
          card.style.display = 'none';
        }
        visibleTotal += visibleTestsCount;
      });

      document.getElementById('testsViewTitle').textContent = FILTER_TITLES[currentFilter] || 'All tests';
      document.getElementById('testsViewCount').textContent =
        visibleTotal + ' test' + (visibleTotal === 1 ? '' : 's') + (searchQuery ? ' matching "' + searchQuery + '"' : '');
      document.getElementById('testsEmpty').hidden = visibleTotal > 0;
    }

    function toggleSpecCollapse(bodyId) {
      const body = document.getElementById(bodyId);
      const chevron = document.getElementById('chevron-' + bodyId);
      if (!body) return;
      if (body.style.display === 'none') {
        body.style.display = '';
        if (chevron) chevron.textContent = '▲';
      } else {
        body.style.display = 'none';
        if (chevron) chevron.textContent = '▼';
      }
    }

    let allExpanded = false;
    function toggleAllSpecs() {
      allExpanded = !allExpanded;
      const bodies = document.querySelectorAll('.spec-card-body');
      const chevrons = document.querySelectorAll('.collapse-chevron');
      const drawers = document.querySelectorAll('.test-details-drawer');
      const testChevrons = document.querySelectorAll('.chevron-arrow');
      bodies.forEach(b => (b.style.display = allExpanded ? '' : 'none'));
      chevrons.forEach(c => (c.textContent = allExpanded ? '▲' : '▼'));
      drawers.forEach(d => {
        d.classList.toggle('open', allExpanded);
        if (allExpanded) fillTestDetails(d);
      });
      testChevrons.forEach(tc => (tc.textContent = allExpanded ? '▲' : '▼'));
      document.querySelectorAll('.steps-section').forEach(s => setStepsOpen(s, allExpanded));
      document.getElementById('expand-collapse-text').textContent = allExpanded ? 'Collapse All' : 'Expand All';
      const expandIcon = document.getElementById('expand-collapse-icon');
      if (expandIcon) expandIcon.setAttribute('d', allExpanded ? EXPAND_ICON_UP : EXPAND_ICON_DOWN);
    }

    function setStepsOpen(section, open) {
      section.classList.toggle('open', open);
      const header = section.querySelector('.steps-section-header');
      if (header) header.setAttribute('aria-expanded', String(open));
    }

    function toggleSteps(sectionId) {
      const section = document.getElementById(sectionId);
      if (!section) return;
      setStepsOpen(section, !section.classList.contains('open'));
    }

    function toggleTestDetails(detailsId) {
      const drawer = document.getElementById(detailsId);
      const chevron = document.getElementById('chevron-' + detailsId);
      if (!drawer) return;
      const isOpen = drawer.classList.toggle('open');
      if (isOpen) fillTestDetails(drawer);
      if (chevron) {
        chevron.textContent = isOpen ? '▲' : '▼';
      }
    }

    /* Steps, screenshots and recordings are data blocks after this script, so the page works before they download.
       Returns null while a block has not fully arrived: the next sibling only exists once its closing tag is parsed. */
    function readPayload(id) {
      const block = document.getElementById(id);
      if (!block || (document.readyState === 'loading' && !block.nextSibling)) return null;
      return block.textContent;
    }

    /* Anything not downloaded yet keeps its loader here and is filled in later by fillOpenTests. */
    function fillTestDetails(scope) {
      scope.querySelectorAll('.history-dots[data-codes]:not([data-ready])').forEach(renderHistoryDots);
      scope.querySelectorAll('.test-steps-timeline:not([data-ready])').forEach(renderSteps);
      scope.querySelectorAll('img[data-media-id]:not([src])').forEach(img => {
        const src = readPayload(img.getAttribute('data-media-id'));
        if (src) img.src = src;
      });
    }

    const HISTORY_RUN_TITLES = ${scriptSafeJson(historyRunTitles)};
    const HISTORY_OUTCOMES = { P: 'Passed', F: 'Failed', S: 'Skipped', '-': 'Not run' };

    function renderHistoryDots(dots) {
      [...dots.getAttribute('data-codes')].forEach((code, index) => {
        const dot = createElement('span', 'history-dot history-dot-' + (code === '-' ? 'none' : code));
        dot.title = HISTORY_RUN_TITLES[index] + ' · ' + HISTORY_OUTCOMES[code];
        dots.appendChild(dot);
      });
      const current = createElement('span', 'history-dot history-dot-current history-dot-' + dots.getAttribute('data-current'));
      current.title = 'This run · ' + dots.getAttribute('data-current-label');
      dots.append(createElement('span', 'history-arrow', '→'), current);
      dots.setAttribute('data-ready', '');
    }

    function renderSteps(timeline) {
      const data = readPayload(timeline.getAttribute('data-steps-id'));
      if (!data) return;
      const steps = JSON.parse(data);
      const testFailed = timeline.hasAttribute('data-failed');
      steps.forEach((step, index) => {
        const isFailingStep = testFailed && index === steps.length - 1;
        const content = createElement('div', 'step-content');
        content.append(
          createElement('div', 'step-message', step.message),
          createElement('div', 'step-subtext', 'Step ' + (index + 1) + (step.durationMs ? ' · ' + step.durationMs + 'ms' : '') + (isFailingStep ? ' · Last step reached before the failure' : ''))
        );
        const item = createElement('div', 'step-item' + (isFailingStep ? ' step-failing' : ''));
        item.append(createElement('div', 'step-bullet'), createElement('span', 'step-phase-badge phase-' + step.phase, step.phase), content);
        timeline.appendChild(item);
      });
      timeline.setAttribute('data-ready', '');
    }

    function createElement(tag, className, text) {
      const el = document.createElement(tag);
      el.className = className;
      if (text !== undefined) el.textContent = text;
      return el;
    }

    function copyAiPrompt(btn, textareaId) {
      const textarea = document.getElementById(textareaId || 'aiPromptText');
      if (!textarea) return;
      const label = btn.querySelector('.ai-copy-label');
      const done = () => flashLabel(label, 'Copied!');
      const fallback = () => {
        textarea.closest('details').open = true;
        textarea.select();
        document.execCommand('copy');
        done();
      };
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(textarea.value).then(done, fallback);
      } else {
        fallback();
      }
    }

    function writeClipboard(text, done) {
      const fallback = () => {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
        done();
      };
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(done, fallback);
      } else {
        fallback();
      }
    }

    function copySpecPath(event, btn) {
      event.stopPropagation();
      writeClipboard(btn.getAttribute('data-path'), () => flashLabel(btn.querySelector('.spec-path-label'), 'Copied!'));
    }

    function copyDataText(btn) {
      writeClipboard(btn.getAttribute('data-copy'), () => flashLabel(btn.querySelector('.copy-label'), 'Copied!'));
    }

    function copyTestLink(event, btn, testId) {
      event.stopPropagation();
      writeClipboard(location.href.split('#')[0] + '#' + testId, () => flashLabel(btn.querySelector('.copy-label'), 'Copied!'));
    }

    function openTest(testId) {
      const drawer = document.getElementById(testId);
      if (!drawer || !drawer.classList.contains('test-details-drawer')) return;
      const row = drawer.closest('.test-row');
      const card = drawer.closest('.spec-card');
      if (currentView !== 'tests' || row.style.display === 'none' || card.style.display === 'none') {
        currentFilter = 'all';
        setSearch('');
      }
      showView('tests', true);
      const body = card.querySelector('.spec-card-body');
      if (body.style.display === 'none') toggleSpecCollapse(body.id);
      if (!drawer.classList.contains('open')) toggleTestDetails(testId);
      history.replaceState(null, '', '#' + testId);
      document.querySelectorAll('.test-row-highlight').forEach(el => el.classList.remove('test-row-highlight'));
      row.classList.add('test-row-highlight');
      scrollToCard(row);
    }

    let galleryBuilt = false;
    function buildGallery() {
      if (galleryBuilt) return;
      galleryBuilt = true;
      const grid = document.getElementById('galleryGrid');
      /* Only failed and flaky tests carry screenshots or recordings. */
      document.querySelectorAll('.test-row[data-state="failed"], .test-row[data-state="flaky"]').forEach(row => {
        const testId = row.querySelector('.test-details-drawer').id;
        const title = row.querySelector('.test-title-text').textContent.trim();
        const specName = row.closest('.spec-card').querySelector('.spec-name').textContent.trim();
        const state = row.getAttribute('data-state');
        row.querySelectorAll('img.screenshot-thumb').forEach(thumb => {
          grid.appendChild(galleryCard(testId, title, specName, state, thumb));
        });
        if (row.querySelector('.video-player')) grid.appendChild(galleryCard(testId, title, specName, state, null));
      });
      if (!grid.children.length) {
        const empty = document.createElement('p');
        empty.className = 'empty-state';
        empty.textContent = 'No screenshots or recordings this run.';
        grid.appendChild(empty);
      }
      fillTestDetails(grid);
    }

    function galleryCard(testId, title, specName, state, thumb) {
      const card = document.createElement('div');
      card.className = 'gallery-card';
      const media = document.createElement('button');
      media.type = 'button';
      media.className = 'gallery-media' + (thumb ? '' : ' gallery-video');
      if (thumb) {
        const img = document.createElement('img');
        const mediaId = thumb.getAttribute('data-media-id');
        if (mediaId) img.setAttribute('data-media-id', mediaId);
        else img.src = thumb.src;
        img.alt = title;
        img.loading = 'lazy';
        media.appendChild(img);
        const loader = thumb.parentElement.querySelector('.media-loader');
        if (loader) media.appendChild(loader.cloneNode(true));
        media.onclick = () => openLightbox(img.src, specName + ' › ' + title);
      } else {
        media.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
        media.append('Recording');
        media.onclick = () => openTest(testId);
      }
      const caption = document.createElement('button');
      caption.type = 'button';
      caption.className = 'gallery-caption';
      caption.title = 'Open ' + specName + ' › ' + title;
      const icon = document.querySelector('.test-row[data-state="' + state + '"] .status-icon');
      if (icon) caption.appendChild(icon.cloneNode(true));
      const label = document.createElement('span');
      label.textContent = title;
      caption.appendChild(label);
      caption.onclick = () => openTest(testId);
      card.append(media, caption);
      return card;
    }

    function printReport() {
      document.getElementById('actionsMenu').open = false;
      window.print();
    }

    function openLightbox(src, caption) {
      /* A screenshot that has not downloaded yet has no src. */
      if (!src) return;
      resetLightboxZoom();
      document.getElementById('lightboxImg').src = src;
      document.getElementById('lightboxCaption').textContent = caption;
      document.getElementById('lightboxModal').classList.add('open');
      /* A cached screenshot can be ready right away and never fire load, so size it up here too. */
      if (document.getElementById('lightboxImg').complete) markLightboxZoomable();
    }

    /* Chrome-style viewer: one click blows the shot up to full size, the next click fits it back. */
    function toggleLightboxZoom(event) {
      const img = document.getElementById('lightboxImg');
      if (img.classList.contains('zoomed')) {
        resetLightboxZoom();
        return;
      }
      if (!canZoomImage(img)) return;
      const clicked = clickRatioOnImage(img, event);
      img.classList.add('zoomed');
      scrollViewportTo(img, clicked);
    }

    /* Where the click landed, as a 0-1 ratio, so that same spot stays in view after zooming. */
    function clickRatioOnImage(img, event) {
      const bounds = img.getBoundingClientRect();
      return {
        x: (event.clientX - bounds.left) / bounds.width,
        y: (event.clientY - bounds.top) / bounds.height
      };
    }

    function scrollViewportTo(img, ratio) {
      const viewport = document.getElementById('lightboxViewport');
      viewport.scrollLeft = ratio.x * img.offsetWidth - viewport.clientWidth / 2;
      viewport.scrollTop = ratio.y * img.offsetHeight - viewport.clientHeight / 2;
    }

    function resetLightboxZoom() {
      const viewport = document.getElementById('lightboxViewport');
      document.getElementById('lightboxImg').classList.remove('zoomed');
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
      markLightboxZoomable();
    }

    /* A shot small enough to be shown whole already reveals every pixel, so it never zooms. */
    function canZoomImage(img) {
      return img.naturalWidth > img.clientWidth || img.naturalHeight > img.clientHeight;
    }

    /* Only the fitted image says whether detail is still hidden, so never measure a zoomed one. */
    function markLightboxZoomable() {
      const img = document.getElementById('lightboxImg');
      if (img.classList.contains('zoomed')) return;
      img.classList.toggle('zoomable', canZoomImage(img));
    }

    const REPORT_FILE_NAME = '${downloadFileName}';
    const EXPAND_ICON_DOWN = 'M7 13l5 5 5-5M7 6l5 5 5-5';
    const EXPAND_ICON_UP = 'M7 11l5-5 5 5M7 18l5-5 5 5';

    /* Snapshot of the whole report, so a filtered view is never what gets emailed out. */
    function buildShareableHtml() {
      const clone = document.documentElement.cloneNode(true);
      clone.querySelectorAll('.spec-card, .test-row').forEach(el => el.style.removeProperty('display'));
      clone.querySelector('#galleryGrid').replaceChildren();
      clone.querySelector('#actionsMenu').removeAttribute('open');
      clone.querySelector('#searchInput').removeAttribute('value');
      clone.querySelectorAll('.video-player').forEach(player => player.replaceChildren());
      /* What was drawn on open is rebuilt from the data blocks, which are already in the file; keeping it would double it. */
      clone.querySelectorAll('[data-ready]').forEach(el => {
        el.replaceChildren();
        el.removeAttribute('data-ready');
      });
      clone.querySelectorAll('img[data-media-id]').forEach(img => img.removeAttribute('src'));
      const clonedRail = clone.querySelector('.rail');
      clonedRail.setAttribute('inert', '');
      clonedRail.setAttribute('aria-busy', 'true');
      clone.querySelectorAll('.test-row-highlight').forEach(row => row.classList.remove('test-row-highlight'));
      return '<!DOCTYPE html>' + String.fromCharCode(10) + clone.outerHTML;
    }

    function downloadHtml(html) {
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = REPORT_FILE_NAME;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function flashLabel(label, text) {
      if (!label) return;
      const original = label.textContent;
      label.textContent = text;
      setTimeout(() => (label.textContent = original), 2000);
    }

    async function saveReportAsHtml(btn) {
      const label = btn.querySelector('.save-html-label');
      if (document.readyState === 'loading') {
        flashLabel(label, 'Still loading…');
        return;
      }
      const html = buildShareableHtml();
      if (window.showSaveFilePicker) {
        try {
          const handle = await window.showSaveFilePicker({
            suggestedName: REPORT_FILE_NAME,
            types: [{ description: 'HTML report', accept: { 'text/html': ['.html'] } }]
          });
          const writable = await handle.createWritable();
          await writable.write(html);
          await writable.close();
          flashLabel(label, 'Saved!');
          return;
        } catch (err) {
          if (err && err.name === 'AbortError') return;
        }
      }
      downloadHtml(html);
      flashLabel(label, 'Saved!');
    }

    function closeLightbox() {
      resetLightboxZoom();
      document.getElementById('lightboxModal').classList.remove('open');
    }

    document.addEventListener('keydown', e => {
      const input = document.getElementById('searchInput');
      if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA')) {
        e.preventDefault();
        input.focus();
        input.select();
      } else if (e.key === 'Escape') {
        closeLightbox();
        document.getElementById('actionsMenu').open = false;
        if (document.activeElement === input) input.blur();
      }
    });

    function syncTopBarHeight() {
      document.documentElement.style.setProperty('--top-bar-h', document.querySelector('.top-bar').offsetHeight + 'px');
    }
    window.addEventListener('resize', syncTopBarHeight);
    syncTopBarHeight();

    document.addEventListener('click', e => {
      const menu = document.getElementById('actionsMenu');
      if (menu.open && !menu.contains(e.target)) menu.open = false;
    });

    const videoUrls = {};
    function videoUrl(id) {
      if (!videoUrls[id]) {
        const dataUri = readPayload(id);
        if (!dataUri) return null;
        const binary = atob(dataUri.slice(dataUri.indexOf(',') + 1));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        videoUrls[id] = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
      }
      return videoUrls[id];
    }

    function mountVideo(player) {
      const src = videoUrl(player.getAttribute('data-video-id'));
      if (!src) return false;
      const video = document.createElement('video');
      video.src = src;
      video.preload = 'metadata';
      video.setAttribute('playsinline', '');
      player.appendChild(video);
      new Plyr(video, { loadSprite: false });
      return true;
    }

    const videoObserver = new IntersectionObserver(
      entries => entries.forEach(entry => {
        if (entry.isIntersecting && mountVideo(entry.target)) videoObserver.unobserve(entry.target);
      }),
      { rootMargin: '200px' }
    );
    document.querySelectorAll('.video-player').forEach(player => videoObserver.observe(player));

    /* Fills what is open with whatever has downloaded since it was opened. */
    function fillOpenTests() {
      document.querySelectorAll('.test-details-drawer.open, #galleryGrid').forEach(fillTestDetails);
      /* Observing again re-checks a player that came into view before its recording had downloaded. */
      document.querySelectorAll('.video-player:empty').forEach(player => {
        videoObserver.unobserve(player);
        videoObserver.observe(player);
      });
    }

    /* While the page still downloads, each screenshot and recording replaces its loader as soon as it arrives. */
    const fillTimer = setInterval(fillOpenTests, 500);
    document.addEventListener('DOMContentLoaded', () => {
      clearInterval(fillTimer);
      fillOpenTests();
    });

    applyFilters();
    const initialHash = location.hash.slice(1);
    if (initialHash.startsWith('test-')) {
      openTest(initialHash);
      window.addEventListener('load', () => setTimeout(() => openTest(initialHash), 0));
    }
    else if (FILTER_TITLES[initialHash]) setFilter(initialHash);
    else showView(VIEW_HASHES.includes(initialHash) ? initialHash : 'insights');

    /* Everything above has run, so the menu works from here on, even while screenshots and recordings still download. */
    const rail = document.querySelector('.rail');
    rail.removeAttribute('inert');
    rail.removeAttribute('aria-busy');
  </script>
${PAYLOAD_ORDER.map(kind => payloads[kind].join('\n')).join('\n')}
</body>
</html>`;
}
