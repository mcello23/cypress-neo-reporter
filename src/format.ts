import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { EmbeddedFile } from './types';

/** Rounded down, so a run with even one failure never reads as 100%. */
export function computePassRate(passed: number, total: number): number {
  return Math.floor((passed / Math.max(total, 1)) * 100);
}

export function deriveSuiteLabel(reportName?: string): string {
  return reportName?.trim() ?? '';
}

/**
 * Format milliseconds into human-readable duration (e.g. "5h 30m 23s", "1m 32s" or "450ms")
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
  return `${mins}m ${secs}s`;
}

export function machineTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function assertTimeZone(timeZone?: string): void {
  if (!timeZone) return;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    throw new Error(`[neo-reporter] Unknown timeZone "${timeZone}". Use an IANA name such as Europe/Paris or America/New_York.`);
  }
}

/**
 * Format an ISO timestamp in the report time zone (e.g. "2026-09-30T08:34:47")
 */
export function formatTimestamp(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString('sv-SE', { timeZone, hourCycle: 'h23' }).replace(' ', 'T');
}

/**
 * Escape HTML special characters
 */
export function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

export function toSourceSpecPath(specPath: string): string {
  return specPath.replace(/\\/g, '/');
}

const ANSI_SEQUENCE = /\u001b\[[0-9;]*[A-Za-z]/g;
const INVALID_XML_CHARS = /[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_SEQUENCE, '');
}

/**
 * Escape XML special characters
 */
export function escapeXml(str: string): string {
  return str.replace(INVALID_XML_CHARS, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function firstLine(text?: string | null): string {
  return (
    (text ?? '')
      .split('\n')
      .find(line => line.trim())
      ?.trim() ?? ''
  );
}

const FILENAME_UNSAFE_CHARS = /[/?<>\\:*|"]/g;

export function toScreenshotSafeName(title: string): string {
  return title.replace(FILENAME_UNSAFE_CHARS, '').toLowerCase();
}

export function toEmbeddedFile(filePath: string, mimeType: string): EmbeddedFile {
  const name = basename(filePath);
  try {
    return { name, path: filePath, base64: `data:${mimeType};base64,${readFileSync(filePath).toString('base64')}` };
  } catch {
    return { name, path: filePath };
  }
}
