import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/hooks/use-command-center', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-command-center')>();
  const idle = { loading: false, error: null };
  return {
    ...actual,
    useConversations: () => ({ ...idle, items: [], refresh: async () => {} }),
    useConversation: () => ({
      ...idle,
      conversationId: null,
      runs: [],
      sending: false,
      busy: false,
      select: () => {},
      send: async () => true,
    }),
    useLiveFeed: () => ({ ...idle, events: [] }),
    useWorkspaceStatus: () => ({ ...idle, status: null, refresh: async () => {} }),
    useIdentity: () => ({ identity: null, error: null }),
  };
});
import App from '@/App';

describe('App', () => {
  it('renders the command center shell', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Agent command center' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Agent graph' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Fabric jobs' })).toBeInTheDocument();
  });

  it('shows every specialist in the agent graph', () => {
    render(<App />);
    expect(screen.getByRole('img', { name: /Guideline auditor: Idle/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Fabric orchestrator: Idle/ })).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: /: Idle/ })).toHaveLength(12);
  });
});
