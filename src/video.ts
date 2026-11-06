import { mkdirSync, existsSync, rmSync, renameSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { toScreenshotSafeName } from './format';
import type { RecordedTestsMap } from './types';

export const MAX_EMBEDDED_VIDEO_CHARS = 150 * 1024 * 1024;
const FAILED_VIDEO_CRF = 30;
const CLIP_LEAD_MS = 0;
const CLIP_TAIL_MS = 1000;
export const recordedSpecVideos = new Map<string, string>();

interface VideoTools {
  ffmpeg: string;
  ffprobe: string | null;
}

function bundledBinaryPath(cypressBinaryRoot: string, pkg: string, name: string): string | null {
  const binary = process.platform === 'win32' ? `${name}.exe` : name;
  const candidate = join(cypressBinaryRoot, 'node_modules', pkg, `${process.platform}-${process.arch}`, binary);
  return existsSync(candidate) ? candidate : null;
}

export function bundledVideoTools(cypressBinaryRoot: string): VideoTools | null {
  const ffmpeg = bundledBinaryPath(cypressBinaryRoot, '@ffmpeg-installer', 'ffmpeg');
  return ffmpeg ? { ffmpeg, ffprobe: bundledBinaryPath(cypressBinaryRoot, '@ffprobe-installer', 'ffprobe') } : null;
}

function readVideoDurationMs(ffprobePath: string | null, videoPath: string): number | null {
  if (!ffprobePath) return null;
  const args = ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', videoPath];
  const result = spawnSync(ffprobePath, args, { encoding: 'utf-8' });
  const seconds = Number(result.stdout?.trim());
  return result.status === 0 && seconds > 0 ? seconds * 1000 : null;
}

function runFfmpeg(ffmpegPath: string, args: string[]): boolean {
  return spawnSync(ffmpegPath, ['-y', ...args], { stdio: 'ignore' }).status === 0;
}

function cutClip(ffmpegPath: string, inputPath: string, outputPath: string, range: { start: number; end: number }): boolean {
  const seek = ['-ss', String(range.start), '-t', String(range.end - range.start)];
  return runFfmpeg(ffmpegPath, [...seek, '-i', inputPath, '-c', 'copy', outputPath]);
}

function testVideoDir(specVideoPath: string): string {
  return specVideoPath.replace(/\.mp4$/i, '');
}

export function testVideoPath(specVideoPath: string, title: string[]): string {
  return join(testVideoDir(specVideoPath), `${toScreenshotSafeName(title.join(' '))}.mp4`);
}

export function compressVideo(ffmpegPath: string, videoPath: string): void {
  const tmpPath = `${videoPath}.compressing.mp4`;
  if (runFfmpeg(ffmpegPath, ['-i', videoPath, '-c:v', 'libx264', '-preset', 'fast', '-crf', String(FAILED_VIDEO_CRF), tmpPath])) {
    renameSync(tmpPath, videoPath);
  } else {
    rmSync(tmpPath, { force: true });
    console.warn(`[neo-reporter] Video compression failed for ${videoPath}; keeping it uncompressed.`);
  }
}

export function cutFailedTestVideos(
  tools: VideoTools,
  specVideoPath: string,
  tests: CypressCommandLine.TestResult[],
  recorded: RecordedTestsMap
): boolean {
  const testsMs = tests.reduce((sum, test) => sum + (test.duration || 0), 0);
  if (testsMs === 0) return false;
  const videoMs = readVideoDurationMs(tools.ffprobe, specVideoPath);
  const preRollMs = videoMs ? Math.max(0, videoMs - testsMs) : 0;
  const clips: Array<{ path: string; start: number; end: number }> = [];
  let elapsedMs = preRollMs;
  for (const test of tests) {
    const durationMs = test.duration || 0;
    if (test.attempts?.some(attempt => attempt.state === 'failed')) {
      const firstAttempt = test.attempts.length > 1 ? recorded[test.title.join(' › ')]?.attempt : undefined;
      const clipMs = firstAttempt ? firstAttempt.leadMs + firstAttempt.durationMs : durationMs;
      clips.push({
        path: testVideoPath(specVideoPath, test.title),
        start: Math.max(0, elapsedMs - CLIP_LEAD_MS) / 1000,
        end: (elapsedMs + clipMs + CLIP_TAIL_MS) / 1000
      });
    }
    elapsedMs += durationMs;
  }
  if (clips.length === 0) return false;
  const clipDir = testVideoDir(specVideoPath);
  mkdirSync(clipDir, { recursive: true });
  if (clips.every(clip => cutClip(tools.ffmpeg, specVideoPath, clip.path, clip))) return true;
  rmSync(clipDir, { recursive: true, force: true });
  return false;
}
