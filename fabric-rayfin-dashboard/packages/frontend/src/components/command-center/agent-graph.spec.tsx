import { describe, expect, it } from 'vitest';
import { agentStatuses } from './agent-graph';
import type { RunEventView } from '@rayfin-app/shared';

function event(runKey: string, status: RunEventView['status'], offset: number): RunEventView {
  return { runKey, agent: 'data_engineer', status, task: 'Actual task', createdAt: new Date(Date.now() + offset).toISOString() };
}
describe('agent lifecycle evidence', () => {
  it('a newer terminal event replaces an earlier working event from the same run', () => {
    expect(agentStatuses([event('run', 'working', -2000), event('run', 'completed', -1000)]).data_engineer.status).toBe('completed');
    expect(agentStatuses([event('run', 'cancelled', -1000), event('run', 'working', -2000)]).data_engineer.status).toBe('cancelled');
  });
  it('a genuinely active different run may still show working', () => {
    expect(agentStatuses([event('new', 'working', -2000), event('old', 'completed', -1000)]).data_engineer.status).toBe('working');
  });
  it('preserves actual terminal states when an older conversation is restored', () => {
    expect(agentStatuses([event('history', 'completed', -60 * 60_000)]).data_engineer.status).toBe('completed');
    expect(agentStatuses([event('history', 'failed', -24 * 60 * 60_000)]).data_engineer.status).toBe('failed');
  });
  it('does not show deleted specialists or Osmos notebook jobs as Foundry agents', () => {
    expect(agentStatuses([{ ...event('run', 'working', -1000), agent: 'release_intelligence' }])).toEqual({});
    expect(agentStatuses([{ ...event('run', 'working', -1000), agent: 'osmos_task' }])).toEqual({});
  });
});
