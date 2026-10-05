import { Activity, Bot, History, LayoutDashboard, Moon, Network, Sun } from 'lucide-react';
import { useCallback, useState } from 'react';

import { AgentGraph } from './components/command-center/agent-graph';
import { ChatPanel } from './components/command-center/chat-panel';
import { HistoryList } from './components/command-center/history-list';
import { LiveFeed } from './components/command-center/live-feed';
import { IconButton, Panel } from './components/command-center/panel';
import { WorkspaceLivePanel } from './components/command-center/workspace-panels';
import { GitHubPanel } from './components/command-center/repository-panel';
import {
  useConversation,
  useConversations,
  useIdentity,
  useLiveFeed,
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
  const { identity, error: identityError } = useIdentity();
  // null = still checking. If whoAmI keeps failing, let the server-side guard decide.
  const canCreateOsmos = identity ? identity.callerIsAppIdentity : identityError ? true : null;
  const [historyOpen, setHistoryOpen] = useState(false);

  const graphEvents = chat.pollingPaused ? [] : chat.runs.length ? chat.runs.flatMap((run) => run.events) : feed.events;
  const activeTitle = conversations.items.find((item) => item.id === chat.conversationId)?.title;

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background">
      <a
        href="#chat-title"
        className="sr-only focus:not-sr-only focus:absolute focus:left-400 focus:top-400 focus:z-10 focus:rounded-lg focus:bg-card focus:px-300 focus:py-200"
      >
        Skip to chat
      </a>
      <header className="shrink-0 border-b border-border bg-card">
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

      <main className="mx-auto grid min-h-0 w-full max-w-[1800px] flex-1 grid-cols-1 gap-300 overflow-y-auto p-300 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)_minmax(0,1fr)] lg:overflow-hidden">
        <Panel
          id="chat"
          title={activeTitle ? `Chat · ${activeTitle}` : 'Chat with the orchestrator'}
          icon={<Bot aria-hidden className="icon-size-300" />}
          className="h-[70dvh] lg:row-span-2 lg:h-auto"
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
          <div className="flex min-h-0 flex-1 gap-300 overflow-hidden">
            <div
              id="history-drawer"
              className={historyOpen ? 'flex min-h-0 w-1/3 shrink-0 flex-col overflow-y-auto border-r border-border pr-200' : 'hidden'}
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
              canCreateOsmos={canCreateOsmos}
              pollingPaused={chat.pollingPaused}
              onResume={chat.resumePolling}
              onSend={chat.send}
            />
          </div>
        </Panel>

        <Panel id="graph" title="Agent graph" icon={<Network aria-hidden className="icon-size-300" />} className="h-[50dvh] lg:col-start-2 lg:row-start-1 lg:h-auto">
          <div className="min-h-0 overflow-y-auto">
            {chat.pollingPaused && <p role="status" className="text-muted-foreground">Run monitoring paused. Resume in chat to retrieve live agent status.</p>}
            <AgentGraph events={graphEvents} />
          </div>
        </Panel>

        <Panel id="feed" title="Live feed" icon={<Activity aria-hidden className="icon-size-300" />} className="h-[45dvh] lg:col-start-2 lg:row-start-2 lg:h-auto">
          <div className="min-h-0 overflow-y-auto">
            <LiveFeed events={feed.events} loading={feed.loading} error={feed.error} />
          </div>
        </Panel>

        <div className="grid h-[100dvh] min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-300 lg:col-start-3 lg:row-span-2 lg:row-start-1 lg:h-auto">
          <GitHubPanel />
          <WorkspaceLivePanel />
        </div>
      </main>
    </div>
  );
}

export default App;
