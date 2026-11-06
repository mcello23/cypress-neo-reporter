import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { SPEC_OWNERS_FILE_NAME, type CiInfo } from './types';

function readGit(projectDir: string, args: string[]): string | undefined {
  const result = spawnSync('git', args, { cwd: projectDir, encoding: 'utf-8', timeout: 5000 });
  const output = result.status === 0 ? result.stdout.trim() : '';
  return output && output !== 'HEAD' ? output : undefined;
}

export function adoCollectionUrl(): string | undefined {
  const url = process.env.SYSTEM_TEAMFOUNDATIONCOLLECTIONURI || process.env.SYSTEM_COLLECTIONURI;
  return url?.replace(/\/?$/, '/');
}

export function readCiInfo(projectDir: string): CiInfo {
  const env = process.env;
  const collectionUrl = adoCollectionUrl();
  const commit = env.BUILD_SOURCEVERSION || readGit(projectDir, ['rev-parse', 'HEAD']);
  return {
    branch: env.BUILD_SOURCEBRANCH?.replace(/^refs\/heads\//, '') || readGit(projectDir, ['rev-parse', '--abbrev-ref', 'HEAD']),
    commit,
    commitUrl: commit && env.BUILD_REPOSITORY_URI ? `${env.BUILD_REPOSITORY_URI}/commit/${commit}` : undefined,
    build: env.BUILD_BUILDNUMBER,
    buildUrl:
      collectionUrl && env.SYSTEM_TEAMPROJECT && env.BUILD_BUILDID
        ? `${collectionUrl}${encodeURIComponent(env.SYSTEM_TEAMPROJECT)}/_build/results?buildId=${env.BUILD_BUILDID}`
        : undefined,
    release: env.RELEASE_RELEASENAME,
    releaseUrl: env.RELEASE_RELEASEWEBURL
  };
}

export function readSpecOwners(projectDir: string, specFiles: string[]): Map<string, string> {
  const owners = new Map<string, string>();
  const baseDir = [projectDir, dirname(projectDir)].find(dir => specFiles.length > 0 && existsSync(join(dir, specFiles[0])));
  if (!baseDir || readGit(baseDir, ['rev-parse', '--is-shallow-repository']) !== 'false') return owners;
  const result = spawnSync('git', ['log', '--no-merges', '--format=%x00%an', '--name-only', '--relative', '--', ...specFiles], {
    cwd: baseDir,
    encoding: 'utf-8',
    timeout: 60_000,
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.status !== 0) return owners;
  const commitsByFile = new Map<string, Map<string, number>>();
  let author = '';
  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('\0')) {
      author = line.slice(1);
    } else if (line.trim() && author) {
      const authors = commitsByFile.get(line) ?? new Map<string, number>();
      authors.set(author, (authors.get(author) ?? 0) + 1);
      commitsByFile.set(line, authors);
    }
  }
  for (const [file, authors] of commitsByFile) {
    owners.set(file, [...authors].sort((a, b) => b[1] - a[1])[0][0]);
  }
  return owners;
}

export function readSpecOwnersFile(projectDir: string): Map<string, string> | null {
  const filePath = join(projectDir, SPEC_OWNERS_FILE_NAME);
  if (!existsSync(filePath)) return null;
  try {
    return new Map(Object.entries(JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, string>));
  } catch (error) {
    console.warn(`[neo-reporter] Skipping unreadable ${filePath}: ${error}`);
    return null;
  }
}

export function ciSourceLine(ci?: CiInfo): string {
  return [
    ci?.branch && `Branch: ${ci.branch}`,
    ci?.commit && `Commit: ${ci.commit.slice(0, 8)}`,
    ci?.build && `Build: ${ci.build}`,
    ci?.release && `Release: ${ci.release}`
  ]
    .filter(Boolean)
    .join(' · ');
}
