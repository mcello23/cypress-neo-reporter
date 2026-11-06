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

function readPullRequestHeadSha(eventPath: string): string | undefined {
  try {
    const event = JSON.parse(readFileSync(eventPath, 'utf-8')) as { pull_request?: { head?: { sha?: string } } };
    return event.pull_request?.head?.sha;
  } catch {
    return undefined;
  }
}

export function readCiInfo(projectDir: string): CiInfo {
  const env = process.env;
  if (env.GITHUB_ACTIONS) {
    const repositoryUrl = `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}`;
    const commit = (env.GITHUB_EVENT_PATH && readPullRequestHeadSha(env.GITHUB_EVENT_PATH)) || env.GITHUB_SHA;
    return {
      branch: env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME,
      commit,
      commitUrl: commit ? `${repositoryUrl}/commit/${commit}` : undefined,
      build: env.GITHUB_RUN_NUMBER ? `#${env.GITHUB_RUN_NUMBER}` : undefined,
      buildUrl: `${repositoryUrl}/actions/runs/${env.GITHUB_RUN_ID}`
    };
  }
  if (env.GITLAB_CI) {
    return {
      branch: env.CI_MERGE_REQUEST_SOURCE_BRANCH_NAME || env.CI_COMMIT_REF_NAME,
      commit: env.CI_COMMIT_SHA,
      commitUrl: env.CI_COMMIT_SHA && env.CI_PROJECT_URL ? `${env.CI_PROJECT_URL}/-/commit/${env.CI_COMMIT_SHA}` : undefined,
      build: env.CI_PIPELINE_ID ? `#${env.CI_PIPELINE_ID}` : undefined,
      buildUrl: env.CI_PIPELINE_URL
    };
  }
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
