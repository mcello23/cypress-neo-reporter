export const REPORT_CSS: string = `    :root {
      --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      --font-mono: 'JetBrains Mono', Consolas, Monaco, "Courier New", monospace;

      /* Dark Theme (Default) */
      --bg-canvas: #0E1014;
      --bg-surface: #161920;
      --bg-surface-elevated: #1D2129;
      --bg-surface-hover: #262B35;
      --border-subtle: #272C36;
      --border-strong: #3A404C;
      --text-primary: #E8EAEF;
      --text-secondary: #A2A8B5;
      --text-muted: #7C8296;

      --color-pass: #2BA591;
      --color-pass-glow: rgba(43, 165, 145, 0.16);
      --color-fail: #F0616B;
      --color-fail-glow: rgba(240, 97, 107, 0.16);
      --color-pending: #8A90A8;
      --color-pending-glow: rgba(138, 144, 168, 0.16);
      --color-flaky: #E0A050;
      --color-flaky-glow: rgba(224, 160, 80, 0.16);
      --color-brand: #A3A6FF;
      color-scheme: dark;

      --shadow-card: none;
      --radius-sm: 6px;
      --radius-md: 10px;
      --radius-lg: 10px;
      --radius-pill: 9999px;
    }

    [data-theme="light"] {
      --bg-canvas: #F6F7F9;
      --bg-surface: #FFFFFF;
      --bg-surface-elevated: #F1F2F5;
      --bg-surface-hover: #E4E6EB;
      --border-subtle: #E4E6EB;
      --border-strong: #C9CDD6;
      --text-primary: #16181D;
      --text-secondary: #5A606D;
      --text-muted: #80869A;

      --color-pass: #0B7F7B;
      --color-pass-glow: rgba(11, 127, 123, 0.12);
      --color-fail: #A52830;
      --color-fail-glow: rgba(165, 40, 48, 0.12);
      --color-pending: #6B7186;
      --color-pending-glow: rgba(107, 113, 134, 0.12);
      --color-flaky: #B4610F;
      --color-flaky-glow: rgba(180, 97, 15, 0.12);
      --color-brand: #3D3FD8;
      color-scheme: light;

      --shadow-card: none;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--font-sans);
      background-color: var(--bg-canvas);
      color: var(--text-primary);
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
      padding: 0;
      margin: 0;
      min-height: 100vh;
    }

    .top-bar {
      position: sticky;
      top: 0;
      z-index: 100;
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
      padding: 10px 24px;
      background: var(--bg-canvas);
      border-bottom: 1px solid var(--border-subtle);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 8px;
      background: none;
      border: none;
      color: var(--text-primary);
      font-family: inherit;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      padding: 0;
    }
    .run-meta {
      display: flex;
      align-items: center;
      gap: 14px;
      flex-wrap: wrap;
      padding-left: 16px;
      border-left: 1px solid var(--border-subtle);
    }
    .run-meta-inline {
      padding-left: 0;
      border-left: none;
    }
    .run-meta-item {
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--text-secondary);
      text-decoration: none;
      white-space: nowrap;
    }
    .run-meta-label {
      font-family: var(--font-sans);
      color: var(--text-muted);
    }
    a.run-meta-item:hover {
      color: var(--color-brand);
    }
    .top-bar-right {
      display: flex;
      align-items: center;
      gap: 14px;
      flex-wrap: wrap;
      margin-left: auto;
    }
    .top-count, .outcome-legend-item {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: none;
      border: none;
      font-family: inherit;
      font-size: 13px;
      color: var(--text-secondary);
      cursor: pointer;
      padding: 2px 0;
    }
    .top-count strong, .outcome-legend-item strong {
      font-variant-numeric: tabular-nums;
    }
    .top-count:hover, .outcome-legend-item:hover {
      color: var(--text-primary);
    }
    .count-failed, .count-failed strong { color: var(--color-fail); }
    .count-passed strong { color: var(--color-pass); }
    .count-flaky, .count-flaky strong { color: var(--color-flaky); }
    .count-pending strong { color: var(--text-secondary); }
    .top-duration {
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--text-secondary);
    }
    .search-box {
      position: relative;
      display: flex;
      align-items: center;
    }
    .search-icon {
      position: absolute;
      left: 10px;
      color: var(--text-muted);
      pointer-events: none;
    }
    .search-input {
      width: 260px;
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-sm);
      padding: 7px 44px 7px 32px;
      color: var(--text-primary);
      font-size: 13px;
      font-family: inherit;
      outline: none;
    }
    .search-input:focus {
      border-color: var(--color-brand);
    }
    .search-kbd {
      position: absolute;
      right: 8px;
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text-muted);
      border: 1px solid var(--border-subtle);
      border-radius: 4px;
      padding: 0 5px;
      pointer-events: none;
    }
    .btn-action, .icon-btn {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      color: var(--text-primary);
      padding: 7px 12px;
      border-radius: var(--radius-sm);
      font-size: 13px;
      font-weight: 500;
      font-family: inherit;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .btn-action:hover, .icon-btn:hover {
      border-color: var(--border-strong);
      background: var(--bg-surface-hover);
    }
    .icon-btn {
      padding: 7px;
    }
    [data-theme="dark"] .icon-sun, [data-theme="light"] .icon-moon {
      display: none;
    }
    .menu {
      position: relative;
    }
    .menu summary {
      list-style: none;
    }
    .menu summary::-webkit-details-marker {
      display: none;
    }
    .menu-list {
      position: absolute;
      right: 0;
      top: calc(100% + 6px);
      min-width: 220px;
      background: var(--bg-surface);
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-sm);
      padding: 4px;
      display: flex;
      flex-direction: column;
      z-index: 200;
    }
    .menu-item {
      display: flex;
      align-items: center;
      gap: 10px;
      background: none;
      border: none;
      color: var(--text-primary);
      font-family: inherit;
      font-size: 13px;
      text-align: left;
      padding: 8px 10px;
      border-radius: 4px;
      cursor: pointer;
    }
    .menu-item:hover {
      background: var(--bg-surface-hover);
    }

    .shell {
      display: grid;
      grid-template-columns: 220px minmax(0, 1fr);
      min-height: calc(100vh - var(--top-bar-h, 53px));
    }
    .rail {
      position: sticky;
      top: var(--top-bar-h, 53px);
      align-self: start;
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 16px 10px;
      border-right: 1px solid var(--border-subtle);
      min-height: calc(100vh - var(--top-bar-h, 53px));
    }
    /* Until the page script has run, the menu buttons would do nothing, so they are locked behind a loader. */
    .rail-loader {
      display: none;
    }
    .rail[aria-busy="true"] .rail-item {
      opacity: 0.35;
    }
    .rail[aria-busy="true"] .rail-loader {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 10px;
      color: var(--text-secondary);
      font-size: 13px;
    }
    .rail-item {
      display: flex;
      align-items: center;
      gap: 10px;
      background: none;
      border: none;
      color: var(--text-secondary);
      font-family: inherit;
      font-size: 14px;
      text-align: left;
      padding: 8px 10px;
      border-radius: var(--radius-sm);
      cursor: pointer;
    }
    .rail-item:hover {
      color: var(--text-primary);
      background: var(--bg-surface-hover);
    }
    .rail-item.active {
      color: var(--text-primary);
      background: var(--bg-surface-elevated);
      font-weight: 600;
    }
    .rail-label {
      flex: 1;
    }
    .rail-count {
      font-size: 12px;
      font-variant-numeric: tabular-nums;
      color: var(--text-muted);
    }
    .main {
      padding: 28px 32px 64px;
      max-width: 1440px;
      width: 100%;
    }
    .view-header {
      display: flex;
      align-items: baseline;
      gap: 14px;
      flex-wrap: wrap;
      margin-bottom: 20px;
    }
    .view-title {
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.3px;
    }
    .view-subtitle {
      font-size: 13px;
      color: var(--text-secondary);
    }
    .view-actions {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .accent-fail { --accent: var(--color-fail); --accent-soft: var(--color-fail-glow); }
    .accent-pass { --accent: var(--color-pass); --accent-soft: var(--color-pass-glow); }
    .accent-flaky { --accent: var(--color-flaky); --accent-soft: var(--color-flaky-glow); }
    .accent-ai { --accent: #8B5CF6; --accent-soft: rgba(139, 92, 246, 0.14); }
    .accent-brand { --accent: var(--color-brand); --accent-soft: rgba(59, 130, 246, 0.14); }
    .accent-time { --accent: #06B6D4; --accent-soft: rgba(6, 182, 212, 0.14); }
    .accent-neutral { --accent: var(--border-strong); --accent-soft: transparent; }

    .stat-strip {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 16px;
    }
    @media (max-width: 900px) {
      .stat-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .stat-cell:last-child { grid-column: 1 / -1; }
    }
    .stat-cell {
      padding: 16px 20px;
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-top: 3px solid var(--accent);
      border-radius: var(--radius-lg);
    }
    .stat-label {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-secondary);
    }
    .stat-value {
      font-size: 32px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.5px;
      margin: 4px 0 2px;
    }
    .stat-failed { color: var(--color-fail); }
    .stat-passed { color: var(--color-pass); }
    .stat-flaky { color: var(--color-flaky); }
    .stat-sub {
      font-size: 12px;
      color: var(--text-muted);
    }
    .outcome-bar {
      display: flex;
      gap: 3px;
      height: 10px;
      margin-top: 22px;
    }
    .outcome-segment {
      border-radius: 5px;
      min-width: 6px;
    }
    .segment-passed { background: var(--color-pass); }
    .segment-failed { background: var(--color-fail); }
    .segment-flaky { background: var(--color-flaky); }
    .segment-pending { background: var(--text-muted); }
    .outcome-legend {
      display: flex;
      gap: 18px;
      flex-wrap: wrap;
      margin: 8px 0 20px;
    }

    .panel-grid {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 16px;
    }
    .panel-grid > .panel {
      grid-column: span 2;
    }
    .panel-grid > .panel-half {
      grid-column: span 3;
    }
    .panel-grid > .panel-wide {
      grid-column: 1 / -1;
    }
    @media (max-width: 1200px) {
      .panel-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .panel-grid > .panel, .panel-grid > .panel-half { grid-column: span 1; }
      .panel-grid > .panel-owners, .panel-grid > .panel-wide { grid-column: 1 / -1; }
    }
    @media (max-width: 700px) {
      .panel-grid { grid-template-columns: minmax(0, 1fr); }
    }
    .panel {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-left: 4px solid var(--accent);
      border-radius: var(--radius-lg);
      padding: 18px 20px;
      min-width: 0;
    }
    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }
    .panel-title {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 16px;
      font-weight: 700;
    }
    .panel-icon {
      color: var(--accent);
      flex-shrink: 0;
    }
    .panel-meta {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 13px;
      color: var(--text-secondary);
    }
    .failure-groups {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .failure-group {
      background: var(--bg-surface-elevated);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      padding: 12px 16px;
    }
    .failure-group-header {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      width: 100%;
      background: none;
      border: none;
      color: inherit;
      font-family: inherit;
      text-align: left;
      cursor: pointer;
      padding: 0;
      margin-bottom: 8px;
    }
    .failure-group-header:hover .failure-group-message {
      text-decoration: underline;
    }
    .failure-group-count {
      flex-shrink: 0;
      font-weight: 800;
      font-size: 13px;
      color: var(--color-fail);
      background: var(--color-fail-glow);
      border: 1px solid rgba(239, 68, 68, 0.35);
      border-radius: var(--radius-pill);
      padding: 1px 10px;
    }
    .failure-group-message {
      font-family: var(--font-mono);
      font-size: 12px;
      line-height: 1.6;
      color: var(--text-primary);
      word-break: break-word;
    }
    .failure-group-tests {
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .test-jump {
      background: none;
      border: none;
      color: var(--text-secondary);
      font-family: inherit;
      font-size: 13px;
      text-align: left;
      cursor: pointer;
      padding: 3px 8px;
      border-radius: var(--radius-sm);
    }
    .test-jump:hover {
      background: var(--bg-surface-hover);
      color: var(--text-primary);
    }
    .test-jump-spec, .test-jump-owner {
      color: var(--text-muted);
    }
    .test-jump-more {
      color: var(--color-brand);
    }
    .panel-list {
      display: flex;
      flex-direction: column;
    }
    .panel-row {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      background: none;
      border: none;
      color: var(--text-primary);
      font-family: inherit;
      font-size: 14px;
      text-align: left;
      padding: 7px 6px;
      margin: 0 -6px;
      border-radius: var(--radius-sm);
      cursor: pointer;
    }
    .panel-row:hover {
      background: var(--bg-surface-hover);
    }
    .panel-row + .panel-row {
      border-top: 1px solid var(--border-subtle);
    }
    .panel-row-name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    code.panel-row-name {
      font-family: var(--font-mono);
      font-size: 12px;
    }
    .panel-row-value {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-family: var(--font-mono);
      font-size: 13px;
      color: var(--text-secondary);
      font-variant-numeric: tabular-nums;
    }
    .panel-text {
      font-size: 13px;
      color: var(--text-secondary);
      margin-bottom: 10px;
    }
    .empty-state {
      font-size: 14px;
      color: var(--text-muted);
    }
    .durations-panel > summary {
      cursor: pointer;
      list-style: none;
      margin-bottom: 0;
    }
    .durations-panel > summary::-webkit-details-marker {
      display: none;
    }
    .durations-panel[open] > summary {
      margin-bottom: 14px;
    }
    .waterfall-container {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .waterfall-row {
      display: grid;
      grid-template-columns: 240px 1fr 90px;
      align-items: center;
      gap: 16px;
      cursor: pointer;
      padding: 2px 6px;
      border-radius: var(--radius-sm);
    }
    .waterfall-row:hover {
      background: var(--bg-surface-hover);
    }
    .waterfall-label {
      font-size: 13px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--text-primary);
    }
    .waterfall-track {
      background: var(--bg-surface-elevated);
      height: 20px;
      border-radius: 4px;
      overflow: hidden;
    }
    .waterfall-fill {
      height: 100%;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      padding-right: 8px;
      min-width: 48px;
    }
    .waterfall-time {
      font-size: 11px;
      font-weight: 600;
      font-family: var(--font-mono);
      color: #FFF;
    }
    .waterfall-badge {
      font-size: 12px;
      font-family: var(--font-mono);
      text-align: center;
      padding: 2px 8px;
      border-radius: var(--radius-pill);
    }
    .ai-prompt-details summary {
      cursor: pointer;
      font-size: 13px;
      color: var(--text-secondary);
    }
    .ai-prompt-text {
      width: 100%;
      min-height: 280px;
      margin-top: 10px;
      background: var(--bg-surface);
      color: var(--text-primary);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-sm);
      padding: 12px 14px;
      font-family: var(--font-mono);
      font-size: 12px;
      line-height: 1.6;
      resize: vertical;
    }
    .search-hint {
      font-size: 12px;
      color: var(--text-muted);
      margin-bottom: 16px;
    }
    .search-hint code {
      font-family: var(--font-mono);
      color: var(--text-secondary);
      background: var(--bg-surface-elevated);
      border-radius: 4px;
      padding: 1px 6px;
    }
    .gallery-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 16px;
    }
    .gallery-card {
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-sm);
      overflow: hidden;
      background: var(--bg-surface);
      display: flex;
      flex-direction: column;
    }
    .gallery-media {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      aspect-ratio: 16 / 10;
      background: var(--bg-surface-elevated);
      border: none;
      padding: 0;
      cursor: zoom-in;
      color: var(--text-secondary);
      font-family: inherit;
      font-size: 13px;
    }
    .gallery-media img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: top;
    }
    .gallery-video {
      cursor: pointer;
    }
    .gallery-caption {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      background: none;
      border: none;
      border-top: 1px solid var(--border-subtle);
      color: var(--text-primary);
      font-family: inherit;
      font-size: 13px;
      text-align: left;
      cursor: pointer;
    }
    .gallery-caption:hover {
      background: var(--bg-surface-hover);
    }
    .gallery-caption span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .status-icon {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
    }
    .status-passed { color: var(--color-pass); }
    .status-failed { color: var(--color-fail); }
    .status-flaky { color: var(--color-flaky); }
    .status-pending, .status-skipped { color: var(--text-muted); }

    @media (max-width: 900px) {
      .top-bar { padding: 10px 16px; }
      .run-meta { padding-left: 0; border-left: none; width: 100%; order: 3; }
      .top-bar-right { margin-left: 0; width: 100%; }
      .search-input { width: 100%; }
      .search-box { flex: 1; }
      .shell { grid-template-columns: minmax(0, 1fr); }
      .rail {
        position: relative;
        flex-direction: row;
        overflow-x: auto;
        min-height: 0;
        padding: 8px 16px;
        border-right: none;
        border-bottom: 1px solid var(--border-subtle);
      }
      .rail-item { flex-shrink: 0; }
      .main { padding: 20px 16px 48px; }
      .waterfall-row { grid-template-columns: 120px 1fr 64px; gap: 8px; }
    }

    @media print {
      .top-bar-right, .rail, .panel-ai, .view-actions, .search-hint, [data-view="gallery"] { display: none !important; }
      .shell { display: block; }
      [data-view]:not([data-view="gallery"]) { display: block !important; }
      .durations-panel .waterfall-container { display: flex !important; }
      /* Printed reports always show the full step log, whatever is collapsed on screen. */
      .test-steps-timeline { display: flex !important; }
      .error-copy-btn, .test-link-btn { display: none !important; }
      .steps-toggle-chevron { display: none; }
    }

    /* Spec Cards */
    .specs-list {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .spec-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-lg);
      overflow: hidden;
      box-shadow: var(--shadow-card);
      transition: border-color 0.2s;
    }
    .spec-card.spec-has-failure {
      border-left: 4px solid var(--color-fail);
    }
    .spec-card:not(.spec-has-failure) {
      border-left: 4px solid var(--color-pass);
    }
    .spec-card.spec-has-flaky {
      border-left-color: var(--color-flaky);
    }
    .spec-card-header {
      padding: 20px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      cursor: pointer;
      user-select: none;
      background: var(--bg-surface-elevated);
      border-bottom: 1px solid var(--border-strong);
      transition: background 0.15s;
    }
    .spec-card-header:hover {
      background: var(--bg-surface-hover);
    }
    .spec-title-group {
      display: flex;
      align-items: center;
      gap: 14px;
      min-width: 0;
    }
    .spec-icon {
      font-size: 20px;
      display: flex;
      align-items: center;
    }
    .spec-title-box {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }
    .spec-name-row {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .spec-tag {
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 1px;
      color: var(--color-brand);
      background: rgba(59, 130, 246, 0.14);
      border: 1px solid rgba(59, 130, 246, 0.4);
      padding: 2px 8px;
      border-radius: var(--radius-sm);
    }
    .spec-name {
      font-size: 18px;
      font-weight: 800;
      letter-spacing: -0.2px;
      color: var(--text-primary);
    }
    .spec-path {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      align-self: flex-start;
      max-width: 100%;
      padding: 0;
      border: 0;
      background: none;
      cursor: copy;
      text-align: left;
      overflow-wrap: anywhere;
      font-size: 12px;
      font-family: var(--font-mono);
      color: var(--text-muted);
    }
    .spec-path svg {
      flex-shrink: 0;
      opacity: 0;
      transition: opacity 0.15s;
    }
    .spec-path:hover,
    .spec-path:focus-visible {
      color: var(--color-brand);
    }
    .spec-path:hover svg,
    .spec-path:focus-visible svg {
      opacity: 1;
    }
    .spec-meta-group {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .spec-time-badge {
      font-size: 13px;
      font-family: var(--font-mono);
      color: var(--text-secondary);
      background: var(--bg-surface-elevated);
      padding: 4px 10px;
      border-radius: var(--radius-sm);
    }
    .spec-count-badge {
      font-size: 13px;
      color: var(--text-secondary);
    }
    .collapse-chevron {
      font-size: 12px;
      color: var(--text-muted);
      transition: transform 0.2s;
    }

    /* Badges */
    .badge {
      font-size: 12px;
      font-weight: 700;
      padding: 4px 10px;
      border-radius: var(--radius-pill);
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .badge-pass {
      background: var(--color-pass-glow);
      color: var(--color-pass);
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .badge-fail {
      background: var(--color-fail-glow);
      color: var(--color-fail);
      border: 1px solid rgba(239, 68, 68, 0.3);
    }
    .badge-flaky {
      background: var(--color-flaky-glow);
      color: var(--color-flaky);
      border: 1px solid rgba(234, 179, 8, 0.35);
    }

    /* Test Rows */
    .spec-card-body {
      border-top: 1px solid var(--border-subtle);
      background: var(--bg-canvas);
    }
    .test-row {
      border-bottom: 1px solid var(--border-subtle);
    }
    .test-row:last-child {
      border-bottom: none;
    }
    .test-row-main {
      padding: 14px 24px;
      display: grid;
      grid-template-columns: 28px 1fr auto;
      align-items: center;
      gap: 14px;
      cursor: pointer;
      transition: background 0.15s;
    }
    .test-row-main:hover {
      background: var(--bg-surface-hover);
    }
    .flaky-tag {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--color-flaky);
      background: var(--color-flaky-glow);
      padding: 2px 8px;
      border-radius: var(--radius-pill);
      border: 1px solid rgba(234, 179, 8, 0.35);
    }
    .test-title-col {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .test-title-text {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary);
    }
    .test-suite-crumbs {
      font-size: 12px;
      color: var(--text-muted);
    }
    .test-duration-col {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
    }
    /* Steps Chip & Drawer */
    .steps-chip {
      font-size: 11px;
      font-weight: 600;
      color: var(--text-secondary);
      background: var(--bg-surface-elevated);
      padding: 2px 8px;
      border-radius: var(--radius-pill);
      border: 1px solid var(--border-subtle);
    }
    .duration-chip {
      font-size: 12px;
      font-family: var(--font-mono);
      color: var(--text-secondary);
    }
    .started-at-chip {
      font-size: 12px;
      font-family: var(--font-mono);
      color: var(--text-muted);
      white-space: nowrap;
    }
    .test-link-btn {
      display: flex;
      align-items: center;
      gap: 4px;
      background: none;
      border: 1px solid transparent;
      border-radius: var(--radius-pill);
      color: var(--text-muted);
      font-family: inherit;
      font-size: 11px;
      padding: 2px 8px;
      cursor: pointer;
    }
    .test-link-btn:hover {
      border-color: var(--border-strong);
      color: var(--text-primary);
    }
    .test-row-highlight > .test-row-main {
      box-shadow: inset 4px 0 0 var(--color-brand);
    }
    .chevron-arrow {
      font-size: 10px;
      color: var(--text-muted);
      transition: transform 0.2s;
    }

    /* Test Details Drawer */
    .test-details-drawer {
      display: none;
      padding: 20px 24px 24px 66px;
      background: var(--bg-surface);
      border-top: 1px dashed var(--border-subtle);
    }
    .test-details-drawer.open {
      display: block;
    }

    /* Business Goal Card */
    .business-goal-card {
      background: rgba(99, 102, 241, 0.08);
      border: 1px solid rgba(99, 102, 241, 0.25);
      border-radius: var(--radius-md);
      padding: 12px 16px;
      margin-bottom: 16px;
      display: flex;
      align-items: flex-start;
      gap: 12px;
    }
    .goal-icon {
      flex-shrink: 0;
      margin-top: 2px;
    }
    .goal-body {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .goal-persona {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      color: #818CF8;
      letter-spacing: 0.5px;
    }
    .goal-text {
      font-size: 13px;
      color: var(--text-primary);
      font-weight: 600;
    }

    /* Steps Timeline Section */
    .steps-section {
      margin-bottom: 16px;
    }
    .steps-section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      width: 100%;
      padding: 9px 14px;
      background: var(--bg-surface-elevated);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-sm);
      color: inherit;
      font-family: inherit;
      text-align: left;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
    }
    .steps-section-header:hover {
      background: var(--bg-surface-hover);
      border-color: var(--border-strong);
    }
    .steps-toggle-chevron {
      font-size: 9px;
      color: var(--text-muted);
      display: inline-block;
      transition: transform 0.2s;
    }
    .steps-section.open .steps-toggle-chevron {
      transform: rotate(90deg);
    }
    .steps-section-title {
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: var(--text-secondary);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .steps-section-sub {
      font-size: 11px;
      color: var(--text-muted);
    }
    .test-steps-timeline {
      display: none;
      flex-direction: column;
      gap: 10px;
      position: relative;
      padding-left: 20px;
      margin-top: 14px;
    }
    .steps-section.open .test-steps-timeline {
      display: flex;
    }
    .test-steps-timeline::before {
      content: '';
      position: absolute;
      left: 6px;
      top: 8px;
      bottom: 8px;
      width: 2px;
      background: var(--border-subtle);
    }
    /* Shown while the report is still downloading the steps of a test opened early. */
    .test-steps-timeline:not([data-ready])::after {
      content: 'Loading steps…';
      color: var(--text-muted);
      font-size: 13px;
    }
    .step-item {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      position: relative;
    }
    .step-bullet {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: var(--bg-surface);
      border: 2px solid var(--border-strong);
      flex-shrink: 0;
      margin-top: 4px;
      margin-left: -20px;
      z-index: 1;
    }
    .step-failing .step-bullet {
      border-color: var(--color-fail);
      background: var(--color-fail);
    }
    .step-failing .step-message,
    .step-failing .step-subtext {
      color: var(--color-fail);
    }
    .history-tag {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      padding: 2px 8px;
      border-radius: var(--radius-pill);
      white-space: nowrap;
    }
    .history-tag-new {
      color: #FFF;
      background: var(--color-fail);
    }
    .history-tag-known {
      color: var(--text-secondary);
      background: var(--bg-surface-elevated);
      border: 1px solid var(--border-strong);
    }
    .history-tag-fixed {
      color: var(--color-pass);
      background: var(--color-pass-glow);
      border: 1px solid rgba(16, 185, 129, 0.35);
    }
    .history-strip {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 16px;
      font-size: 13px;
      color: var(--text-secondary);
    }
    .history-strip-label {
      font-weight: 600;
    }
    .history-dots {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .history-dot {
      width: 12px;
      height: 12px;
      border-radius: 3px;
      background: var(--border-subtle);
    }
    .history-dot-P { background: var(--color-pass); }
    .history-dot-F { background: var(--color-fail); }
    .history-dot-S { background: var(--text-muted); }
    .history-dot-none { background: transparent; border: 1px dashed var(--border-strong); }
    .history-dot-current {
      width: 16px;
      height: 16px;
      outline: 2px solid var(--text-primary);
      outline-offset: 1px;
    }
    .history-arrow {
      color: var(--text-muted);
      margin: 0 2px;
    }
    .trend-chart {
      display: flex;
      align-items: stretch;
      gap: 8px;
      height: 170px;
      overflow-x: auto;
    }
    .trend-col {
      flex: 1 0 56px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      color: var(--text-secondary);
      text-decoration: none;
      font-size: 12px;
      border-radius: var(--radius-sm);
      padding: 4px 2px;
    }
    a.trend-col:hover {
      background: var(--bg-surface-hover);
    }
    .trend-value {
      font-family: var(--font-mono);
      font-weight: 700;
      color: var(--text-primary);
    }
    .trend-track {
      flex: 1;
      width: 60%;
      display: flex;
      align-items: flex-end;
    }
    .trend-bar {
      width: 100%;
      background: var(--color-fail);
      opacity: 0.55;
      border-radius: 4px 4px 0 0;
    }
    .trend-current .trend-bar {
      opacity: 1;
    }
    .trend-current .trend-label {
      color: var(--text-primary);
      font-weight: 700;
    }
    .trend-label {
      white-space: nowrap;
      font-size: 11px;
    }
    .step-phase-badge {
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.5px;
      padding: 2px 7px;
      border-radius: var(--radius-sm);
      flex-shrink: 0;
      min-width: 50px;
      text-align: center;
    }
    .phase-VISIT { background: rgba(14, 165, 233, 0.15); color: #38BDF8; border: 1px solid rgba(14, 165, 233, 0.3); }
    .phase-FIND  { background: rgba(245, 158, 11, 0.15); color: #FBBF24; border: 1px solid rgba(245, 158, 11, 0.3); }
    .phase-STEP  { background: rgba(139, 92, 246, 0.15); color: #A78BFA; border: 1px solid rgba(139, 92, 246, 0.3); }
    .phase-CHECK { background: rgba(16, 185, 129, 0.15); color: #34D399; border: 1px solid rgba(16, 185, 129, 0.3); }
    .phase-INFO  { background: rgba(100, 116, 139, 0.15); color: #94A3B8; border: 1px solid rgba(100, 116, 139, 0.3); }
    .step-content {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .step-message {
      font-size: 13px;
      color: var(--text-primary);
      font-weight: 500;
      line-height: 1.4;
      white-space: pre-wrap;
    }
    .step-subtext {
      font-size: 11px;
      color: var(--text-muted);
      font-family: var(--font-mono);
    }
    .steps-section-empty {
      font-size: 13px;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 0;
    }
    .test-error-box {
      background: var(--bg-surface-elevated);
      border: 1px solid var(--border-subtle);
      border-left: 4px solid var(--color-fail);
      border-radius: var(--radius-md);
      padding: 16px;
      margin-bottom: 16px;
    }
    .test-error-box.flaky {
      border-left-color: var(--color-flaky);
    }
    .flaky-note {
      font-size: 13px;
      font-weight: 600;
      color: var(--color-flaky);
      margin-bottom: 10px;
    }
    .error-header {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 14px;
      color: var(--color-fail);
      font-weight: 600;
      margin-bottom: 10px;
    }
    .error-copy-btn {
      margin-left: auto;
      flex-shrink: 0;
    }
    .error-stack {
      background: var(--bg-canvas);
      padding: 12px 16px;
      border-radius: var(--radius-sm);
      overflow-x: auto;
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--text-primary);
      border: 1px solid var(--border-subtle);
      line-height: 1.6;
    }
    .test-code {
      margin-top: 12px;
    }
    .diagnostics-list {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 12px;
    }
    .diagnostics-list li {
      display: grid;
      grid-template-columns: 64px 1fr auto;
      gap: 10px;
      align-items: baseline;
    }
    .diagnostics-list code {
      font-family: var(--font-mono);
      word-break: break-all;
      color: var(--text-primary);
    }
    .diagnostic-status {
      font-family: var(--font-mono);
      font-weight: 700;
      color: var(--color-fail);
    }
    .diagnostic-console {
      color: var(--color-pending);
    }
    .diagnostic-time {
      font-family: var(--font-mono);
      color: var(--text-muted);
      white-space: nowrap;
    }
    .spec-owner-badge {
      font-size: 12px;
      color: var(--text-secondary);
      background: var(--bg-surface-elevated);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-pill);
      padding: 2px 10px;
      white-space: nowrap;
    }
    .search-hint {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 8px;
    }
    .search-hint code {
      font-family: var(--font-mono);
      color: var(--text-secondary);
      background: var(--bg-surface-elevated);
      border-radius: var(--radius-sm);
      padding: 1px 6px;
    }
    .test-ai-prompt {
      margin-top: 16px;
      padding-top: 14px;
      border-top: 1px dashed var(--border-strong);
    }
    .test-ai-prompt-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 10px;
    }
    .test-ai-prompt-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-secondary);
    }
    .btn-action-sm {
      padding: 5px 10px;
      font-size: 12px;
    }
    .test-ai-prompt-text {
      min-height: 200px;
    }
    .test-code summary {
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-secondary);
      margin-bottom: 8px;
    }
    .screenshot-evidence {
      margin-top: 16px;
    }
    .evidence-title {
      font-size: 13px;
      font-weight: 700;
      color: var(--text-secondary);
      margin-bottom: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .screenshot-gallery {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
    }
    .screenshot-thumbnail-wrap {
      position: relative;
      border-radius: var(--radius-md);
      overflow: hidden;
      border: 2px solid var(--border-subtle);
      cursor: pointer;
      max-width: 380px;
      transition: transform 0.2s, border-color 0.2s;
    }
    .screenshot-thumbnail-wrap:hover {
      transform: scale(1.02);
      border-color: var(--color-brand);
    }
    .screenshot-thumb {
      width: 100%;
      height: auto;
      display: block;
    }
    /* Keeps the thumbnail's place while the screenshot is still downloading. */
    .screenshot-thumb:not([src]) {
      width: 380px;
      max-width: 100%;
      aspect-ratio: 16 / 9;
      background: var(--bg-surface-elevated);
      /* The browser would print the file name (alt text) over the loader. */
      color: transparent;
    }
    .screenshot-thumbnail-wrap:has(> img:not([src])) {
      cursor: progress;
    }
    img:not([src]) ~ .zoom-overlay,
    .gallery-media img:not([src]) {
      display: none;
    }
    /* Shown next to a screenshot or recording that has not downloaded yet, so people know to wait. */
    .media-loader {
      display: none;
      align-items: center;
      justify-content: center;
      gap: 8px;
      color: var(--text-secondary);
      font-size: 13px;
    }
    img:not([src]) + .media-loader {
      display: flex;
    }
    .screenshot-thumbnail-wrap .media-loader {
      position: absolute;
      inset: 0;
    }
    .media-spinner,
    .video-player:empty::before {
      width: 16px;
      height: 16px;
      border: 2px solid var(--border-subtle);
      border-top-color: var(--color-brand);
      border-radius: 50%;
      animation: media-spin 0.8s linear infinite;
    }
    @keyframes media-spin {
      to { transform: rotate(360deg); }
    }
    @media (prefers-reduced-motion: reduce) {
      .media-spinner,
      .video-player:empty::before { animation: none; }
    }
    .zoom-overlay {
      position: absolute;
      inset: 0;
      background: rgba(0,0,0,0.6);
      color: #FFF;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      font-size: 13px;
      font-weight: 600;
      opacity: 0;
      transition: opacity 0.2s;
    }
    .screenshot-thumbnail-wrap:hover .zoom-overlay {
      opacity: 1;
    }
    .video-evidence {
      margin-top: 16px;
    }
    .video-player {
      --plyr-color-main: var(--color-brand);
      max-width: 1280px;
      border-radius: var(--radius-md);
      overflow: hidden;
      border: 2px solid var(--border-subtle);
      background: #000;
    }
    /* An empty player is a recording that has not downloaded yet. */
    .video-player:empty {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      aspect-ratio: 16 / 9;
      color: #D1D5DB;
      font-size: 13px;
    }
    .video-player:empty::before {
      content: '';
    }
    .video-player:empty::after {
      content: 'Loading recording…';
    }

    /* Lightbox Modal */
    .modal-lightbox {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.85);
      z-index: 1000;
      backdrop-filter: blur(8px);
      align-items: center;
      justify-content: center;
      padding: 40px;
    }
    .modal-lightbox.open {
      display: flex;
    }
    .lightbox-content {
      max-width: 95vw;
      max-height: 90vh;
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    /* Scrollable frame around the image: the shot grows past it once zoomed in. */
    .lightbox-viewport {
      max-width: 95vw;
      max-height: 82vh;
      overflow: auto;
      display: flex;
      align-items: safe center;
      justify-content: safe center;
    }
    .lightbox-img {
      max-width: 95vw;
      max-height: 82vh;
      flex: none;
      border-radius: var(--radius-md);
      box-shadow: 0 10px 40px rgba(0,0,0,0.8);
      border: 1px solid rgba(255,255,255,0.15);
    }
    .lightbox-img.zoomable {
      cursor: zoom-in;
    }
    /* Zoomed in: full pixel size, panned with the scrollbars of .lightbox-viewport. */
    .lightbox-img.zoomed {
      max-width: none;
      max-height: none;
      border-radius: 0;
      cursor: zoom-out;
    }
    .lightbox-caption {
      margin-top: 14px;
      color: #FFF;
      font-size: 14px;
      font-weight: 500;
    }
    .lightbox-close {
      position: absolute;
      top: -36px;
      right: 0;
      background: none;
      border: none;
      color: #FFF;
      font-size: 28px;
      cursor: pointer;
    }

    /* Footer */
    .footer {
      text-align: center;
      padding: 40px 0;
      border-top: 1px solid var(--border-subtle);
      font-size: 13px;
      color: var(--text-muted);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }`;
