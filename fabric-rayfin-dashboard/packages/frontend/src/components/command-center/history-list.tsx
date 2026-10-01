import { History, MessageSquarePlus } from 'lucide-react';

import { EmptyState, ErrorNote, SkeletonRows } from './panel';

import type { ConversationSummary } from '@/hooks/use-command-center';
import { cn } from '@/lib/utils';

function relative(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return date.toLocaleDateString();
}

export function HistoryList({
  items,
  loading,
  error,
  activeId,
  onSelect,
  onNew,
}: {
  items: ConversationSummary[];
  loading: boolean;
  error: string | null;
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <nav aria-label="Conversation history" className="flex min-h-0 flex-col gap-300">
      <button
        type="button"
        onClick={onNew}
        className="inline-flex items-center justify-center gap-200 rounded-lg border border-border bg-secondary px-300 py-200 font-semibold text-[length:var(--text-300)] hover:bg-hover focus-visible:outline-2 focus-visible:outline-ring"
      >
        <MessageSquarePlus aria-hidden className="icon-size-200" />
        New conversation
      </button>
      {error && <ErrorNote message={error} />}
      {loading && !items.length ? (
        <SkeletonRows rows={4} />
      ) : !items.length ? (
        <EmptyState icon={<History aria-hidden className="icon-size-400" />} title="No conversations yet" />
      ) : (
        <ul className="flex min-h-0 flex-col gap-100 overflow-y-auto">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                aria-current={item.id === activeId ? 'true' : undefined}
                onClick={() => onSelect(item.id)}
                className={cn(
                  'flex w-full flex-col gap-100 rounded-lg px-300 py-200 text-left transition-colors',
                  'hover:bg-hover focus-visible:outline-2 focus-visible:outline-ring',
                  item.id === activeId && 'bg-working-soft',
                )}
              >
                <span className="line-clamp-1 font-semibold text-[length:var(--text-300)]">{item.title}</span>
                <span className="text-[length:var(--text-200)] text-muted-foreground">{relative(item.updatedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
