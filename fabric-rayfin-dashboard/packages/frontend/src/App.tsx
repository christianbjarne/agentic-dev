import { Activity, Bot, History, LayoutDashboard, Moon, Network, Sun } from 'lucide-react';
import { useCallback, useState } from 'react';

import { AgentGraph } from './components/command-center/agent-graph';
import { ChatPanel } from './components/command-center/chat-panel';
import { HistoryList } from './components/command-center/history-list';
import { LiveFeed } from './components/command-center/live-feed';
import { IconButton, Panel } from './components/command-center/panel';
import { GitPanel, WorkspaceJobsPanel } from './components/command-center/workspace-panels';
import {
  useConversation,
  useConversations,
  useIdentity,
  useLiveFeed,
  useWorkspaceStatus,
} from './hooks/use-command-center';
import { useTheme } from './hooks/theme.context';

/** Fabric agent command center: chat, agent graph, live feed and workspace status. */
function App() {
  const { isDark, toggleTheme } = useTheme();
  const conversations = useConversations();
  const refreshConversations = conversations.refresh;
  const onConversationChange = useCallback(() => void refreshConversations(), [refreshConversations]);
  const chat = useConversation(onConversationChange);
  const feed = useLiveFeed();
  const workspace = useWorkspaceStatus();
  const { identity } = useIdentity();
  const [historyOpen, setHistoryOpen] = useState(false);

  const graphEvents = chat.runs.some((run) => run.status === 'working' || run.status === 'queued')
    ? [...feed.events, ...chat.runs.flatMap((run) => run.events)]
    : feed.events;
  const activeTitle = conversations.items.find((item) => item.id === chat.conversationId)?.title;

  return (
    <div className="min-h-full bg-background">
      <a
        href="#chat-title"
        className="sr-only focus:not-sr-only focus:absolute focus:left-400 focus:top-400 focus:z-10 focus:rounded-lg focus:bg-card focus:px-300 focus:py-200"
      >
        Skip to chat
      </a>
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-300 px-600 py-300">
          <div className="flex items-center gap-300">
            <span className="flex size-[36px] items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <LayoutDashboard aria-hidden className="icon-size-300" />
            </span>
            <div>
              <h1 className="font-[family-name:var(--font-heading)] font-semibold text-[length:var(--text-500)] leading-500">
                Agent command center
              </h1>
              <p className="text-[length:var(--text-200)] text-muted-foreground">
                Foundry fabric-orchestrator · running inside Microsoft Fabric
              </p>
            </div>
          </div>
          <div className="flex items-center gap-300">
            {identity && (
              <span
                className="hidden text-right text-[length:var(--text-200)] text-muted-foreground sm:block"
                title={identity.appIdentity?.upn ? `App identity: ${identity.appIdentity.upn}` : undefined}
              >
                <span className="block font-semibold text-foreground">
                  {identity.caller.name ?? identity.caller.email ?? 'Signed in'}
                </span>
                Signed in with Fabric
              </span>
            )}
            <IconButton label={isDark ? 'Switch to light theme' : 'Switch to dark theme'} onClick={toggleTheme}>
              {isDark ? <Sun aria-hidden className="icon-size-200" /> : <Moon aria-hidden className="icon-size-200" />}
            </IconButton>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1600px] grid-cols-1 gap-500 px-600 py-500 lg:grid-cols-3">
        <Panel
          id="chat"
          title={activeTitle ? `Chat · ${activeTitle}` : 'Chat with the orchestrator'}
          icon={<Bot aria-hidden className="icon-size-300" />}
          className="lg:col-span-2 lg:row-span-2"
          actions={
            <button
              type="button"
              aria-expanded={historyOpen}
              aria-controls="history-drawer"
              onClick={() => setHistoryOpen((open) => !open)}
              className="inline-flex items-center gap-100 rounded-lg px-200 py-100 text-[length:var(--text-300)] text-muted-foreground hover:bg-hover focus-visible:outline-2 focus-visible:outline-ring"
            >
              <History aria-hidden className="icon-size-200" />
              History
            </button>
          }
        >
          <div className="flex min-h-[560px] flex-1 gap-500">
            <div
              id="history-drawer"
              className={historyOpen ? 'flex w-full max-w-[260px] shrink-0 flex-col border-r border-border pr-400' : 'hidden'}
            >
              <HistoryList
                items={conversations.items}
                loading={conversations.loading}
                error={conversations.error}
                activeId={chat.conversationId}
                onSelect={(id) => chat.select(id)}
                onNew={() => chat.select(null)}
              />
            </div>
            <ChatPanel
              runs={chat.runs}
              loading={chat.loading}
              sending={chat.sending}
              busy={chat.busy}
              error={chat.error}
              canCreateOsmos={identity?.callerIsAppIdentity ?? false}
              onSend={chat.send}
            />
          </div>
        </Panel>

        <Panel id="graph" title="Agent graph" icon={<Network aria-hidden className="icon-size-300" />}>
          <AgentGraph events={graphEvents} />
        </Panel>

        <Panel id="feed" title="Live feed" icon={<Activity aria-hidden className="icon-size-300" />} className="max-h-[640px]">
          <div className="min-h-0 overflow-y-auto">
            <LiveFeed events={feed.events} loading={feed.loading} error={feed.error} />
          </div>
        </Panel>

        <WorkspaceJobsPanel
          status={workspace.status}
          loading={workspace.loading}
          error={workspace.error}
          onRefresh={() => void workspace.refresh()}
        />
        <GitPanel status={workspace.status} loading={workspace.loading} />
      </main>
    </div>
  );
}

export default App;
