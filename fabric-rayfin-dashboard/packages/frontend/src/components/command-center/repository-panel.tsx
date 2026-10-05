import { GitBranch, RefreshCw, ExternalLink } from 'lucide-react';
import { useCallback, useState } from 'react';
import { getRayfinClient } from '@/lib/rayfin-client';
import { useRead } from '@/hooks/use-read';
import { EmptyState, ErrorNote, IconButton, Panel, SkeletonRows } from './panel';

export const SELECT_CLASS = 'w-full min-w-0 rounded-lg border border-input bg-background px-200 py-200 text-[length:var(--text-200)] focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50';

export function GitHubPanel() {
  const [selectedRepo, setSelectedRepo] = useState(() => localStorage.getItem('command-center.repository') ?? '');
  const [selection, setSelection] = useState({ repository: '', branch: '' });
  const [commitSelection, setCommitSelection] = useState({ key: '', sha: '' });
  const readRepos = useCallback(async () => (await getRayfinClient()).functions.getGitHubRepositories.invoke(), []);
  const repos = useRead('github-repositories', readRepos);
  const repository = repos.data?.find((repo) => repo.name === selectedRepo) ?? repos.data?.[0];
  const repoName = repository?.name ?? '';
  const readBranches = useCallback(async () => (await getRayfinClient()).functions.getGitHubBranches.invoke({ repository: repoName }), [repoName]);
  const branches = useRead(repoName, readBranches);
  const preferred = selection.repository === repoName ? selection.branch
    : localStorage.getItem(`command-center.branch.${repoName}`) ?? repository?.defaultBranch ?? '';
  const branch = branches.data?.includes(preferred) ? preferred : branches.data?.[0] ?? '';
  const branchKey = repoName && branch ? `${repoName}:${branch}` : '';
  const readBranch = useCallback(async () => (await getRayfinClient()).functions.getGitHubBranch.invoke({ repository: repoName, branch }), [repoName, branch]);
  const view = useRead(branchKey, readBranch, 45000);
  const sha = commitSelection.key === branchKey && view.data?.commits.some((commit) => commit.sha === commitSelection.sha)
    ? commitSelection.sha : view.data?.commits[0]?.sha ?? '';
  const readFiles = useCallback(async () => (await getRayfinClient()).functions.getGitHubCommit.invoke({ repository: repoName, sha }), [repoName, sha]);
  const files = useRead(sha ? `${repoName}:${sha}` : '', readFiles);
  const error = repos.error ?? branches.error ?? view.error ?? files.error;
  return (
    <Panel id="github" title="GitHub" icon={<GitBranch aria-hidden className="icon-size-300" />}
      actions={<IconButton label="Refresh GitHub" onClick={() => { repos.refresh(); branches.refresh(); view.refresh(); files.refresh(); }} disabled={repos.loading || view.loading}>
        <RefreshCw aria-hidden className="icon-size-200" />
      </IconButton>}>
      <div className="flex min-h-0 flex-1 flex-col gap-300">
        <div className="grid shrink-0 grid-cols-2 gap-200">
          <label className="min-w-0 text-[length:var(--text-200)]">Repository
            <select aria-label="GitHub repository" className={SELECT_CLASS} value={repoName} disabled={repos.loading || !repos.data?.length}
              onChange={(event) => { setSelectedRepo(event.target.value); localStorage.setItem('command-center.repository', event.target.value); }}>
              {!repos.data?.length && <option value="">{repos.loading ? 'Loading repositories...' : 'No accessible repositories'}</option>}
              {repos.data?.map((repo) => <option key={repo.name} value={repo.name}>{repo.name}</option>)}
            </select>
          </label>
          <label className="min-w-0 text-[length:var(--text-200)]">Branch
            <select aria-label="GitHub branch" className={SELECT_CLASS} value={branch} disabled={branches.loading || !branches.data?.length}
              onChange={(event) => { setSelection({ repository: repoName, branch: event.target.value }); localStorage.setItem(`command-center.branch.${repoName}`, event.target.value); }}>
              {!branches.data?.length && <option value="">{branches.loading ? 'Loading branches...' : 'No branches'}</option>}
              {branches.data?.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
        </div>
        {error && <ErrorNote message={error} />}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {view.loading && !view.data ? <SkeletonRows rows={3} /> : view.data && <>
            <h3 className="font-semibold text-[length:var(--text-300)]">Open PRs for this branch</h3>
            {view.data.pulls.length ? <ul className="mb-300 text-[length:var(--text-200)]">
              {view.data.pulls.map((pull) => <li key={pull.number}><a href={pull.url} target="_blank" rel="noreferrer" className="text-brand-foreground underline">#{pull.number} {pull.title}</a></li>)}
            </ul> : <p className="mb-300 text-[length:var(--text-200)] text-muted-foreground">No open PRs.</p>}
            <h3 className="font-semibold text-[length:var(--text-300)]">Recent commits (latest 15)</h3>
            {!view.data.commits.length && <EmptyState icon={<GitBranch aria-hidden />} title="No commits on this branch" />}
            <ol className="flex flex-col gap-200 py-200">
              {view.data.commits.map((commit) => <li key={commit.sha} className={`rounded-lg border p-200 ${commit.sha === sha ? 'border-brand bg-secondary' : 'border-border'}`}>
                <button type="button" onClick={() => setCommitSelection({ key: branchKey, sha: commit.sha })}
                  aria-pressed={commit.sha === sha} className="w-full text-left text-[length:var(--text-200)] focus-visible:outline-2 focus-visible:outline-ring">
                  <span className="block truncate font-semibold">{commit.message.split('\n')[0]}</span>
                  <span className="text-muted-foreground">{commit.author} · {new Date(commit.date).toLocaleString()}</span>
                </button>
                <a href={commit.url} target="_blank" rel="noreferrer" className="text-[length:var(--text-200)] text-brand-foreground underline">{commit.sha.slice(0, 8)}</a>
              </li>)}
            </ol>
            {sha && <section aria-label="Commit changed files" className="border-t border-border pt-300">
              <h3 className="font-semibold text-[length:var(--text-300)]">Changed files · {sha.slice(0, 8)}</h3>
              {files.loading ? <SkeletonRows rows={2} /> : files.data?.map((file) => <details key={file.filename} className="border-b border-border py-200">
                <summary className="cursor-pointer break-all text-[length:var(--text-200)]">
                  {file.filename} <span className="text-muted-foreground">({file.status}, +{file.additions} / -{file.deletions})</span>
                </summary>
                {file.patch ? <pre className="max-h-[24rem] overflow-auto rounded-lg bg-background p-200 text-[length:var(--text-200)]">{file.patch}</pre>
                  : <p className="text-[length:var(--text-200)] text-muted-foreground">GitHub did not return a text patch (binary, large file, or empty change).</p>}
                {file.url && <a href={file.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-100 text-[length:var(--text-200)] text-brand-foreground underline">View on GitHub <ExternalLink aria-hidden className="icon-size-100" /></a>}
              </details>)}
            </section>}
          </>}
          {!repos.loading && !repos.data?.length && !error && <p>No accessible repositories for the configured GitHub identity.</p>}
        </div>
        <p className="shrink-0 text-[length:var(--text-200)] text-muted-foreground">Read-only · configured GitHub identity · refreshes every 45s. Text patches are bounded to 30,000 characters; use GitHub for full diffs.</p>
      </div>
    </Panel>
  );
}
