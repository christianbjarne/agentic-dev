import type { GitHubRepository, GitHubBranchView, GitHubFile } from '@rayfin-app/shared';
import { asArray, asRecord, describeFailure, request, str } from './http.js';

const API = 'https://api.github.com';
function repoPath(repository: string): string {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('Select a valid GitHub repository.');
  return `/repos/${repository}`;
}
async function get(token: string, path: string): Promise<unknown> {
  const result = await request('GET', `${API}${path}`, `Bearer ${token}`, undefined, {
    'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Fabric-Agent-Command-Center',
  }, 20000);
  if (!result.ok) throw new Error(describeFailure('GitHub read', result));
  return result.body;
}
async function pages(token: string, path: string, field?: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (let page = 1; page <= 10; page++) {
    const body = await get(token, `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    const values = asArray(field ? asRecord(body)[field] : body).map(asRecord);
    rows.push(...values);
    if (values.length < 100) return rows;
  }
  throw new Error('GitHub returned more than 1,000 entries. Narrow this credential to the repositories needed by this app.');
}
export async function githubRepositories(token: string): Promise<GitHubRepository[]> {
  // Installation tokens use a different catalog route than user credentials.
  const probe = await request('GET', `${API}/user`, `Bearer ${token}`, undefined, { 'User-Agent': 'Fabric-Agent-Command-Center' });
  const installation = probe.status === 401 || probe.status === 403;
  const rows = await pages(token, installation ? '/installation/repositories' : '/user/repos?sort=updated', installation ? 'repositories' : undefined);
  return rows.map((row) => ({ name: str(row.full_name, 250), url: str(row.html_url, 500), defaultBranch: str(row.default_branch, 250) }));
}
export async function githubBranches(token: string, repository: string): Promise<string[]> {
  return (await pages(token, `${repoPath(repository)}/branches`)).map((row) => str(row.name, 250));
}
export async function githubBranchView(token: string, repository: string, branch: string): Promise<GitHubBranchView> {
  if (!branch || branch.length > 250) throw new Error('Select a branch.');
  const path = repoPath(repository);
  const owner = repository.split('/')[0];
  const [commits, pulls] = await Promise.all([
    get(token, `${path}/commits?sha=${encodeURIComponent(branch)}&per_page=15`),
    get(token, `${path}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}&per_page=30`),
  ]);
  return {
    commits: asArray(commits).map(asRecord).map((row) => {
      const commit = asRecord(row.commit);
      const author = asRecord(commit.author);
      return { sha: str(row.sha, 64), url: str(row.html_url, 500), message: str(commit.message, 4000), author: str(author.name, 200), date: str(author.date, 40) };
    }),
    pulls: asArray(pulls).map(asRecord).map((row) => ({
      number: Number(row.number), title: str(row.title, 300), url: str(row.html_url, 500), state: str(row.state, 32),
    })),
  };
}
export async function githubCommitFiles(token: string, repository: string, sha: string): Promise<GitHubFile[]> {
  if (!/^[a-f0-9]{40}$/i.test(sha)) throw new Error('Select a valid commit SHA.');
  const files = await pages(token, `${repoPath(repository)}/commits/${sha}`, 'files');
  return files.map((row) => ({
    filename: str(row.filename, 1000), status: str(row.status, 40), additions: Number(row.additions), deletions: Number(row.deletions),
    patch: typeof row.patch === 'string' ? str(row.patch, 30000) : undefined, url: str(row.blob_url, 2000) || undefined,
  }));
}
