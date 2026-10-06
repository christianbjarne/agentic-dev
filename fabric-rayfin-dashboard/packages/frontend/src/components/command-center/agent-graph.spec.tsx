import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { mergeRunUpdate, type RunEventView, type RunStatus } from '@rayfin-app/shared';
import { AgentGraph, agentStatuses, type GraphRun } from './agent-graph';

afterEach(cleanup);

function event(runKey: string, status: RunEventView['status'], offset: number, agent = 'data_engineer'): RunEventView {
  return { runKey, agent, status, task: 'Actual task', createdAt: new Date(Date.now() + offset).toISOString() };
}
function run(runKey: string, status: RunStatus, offset: number): GraphRun {
  return { runKey, status, createdAt: new Date(Date.now() + offset).toISOString() };
}
function animation(container: HTMLElement) {
  return {
    dashed: container.querySelectorAll('line[stroke-dasharray]').length,
    pulses: container.querySelectorAll('.agent-pulse').length,
    spinners: container.querySelectorAll('.animate-spin').length,
    live: container.querySelector('[aria-live]')?.textContent,
  };
}
const STILL = { dashed: 0, pulses: 0, spinners: 0, live: 'No agents are working.' };

describe('agent lifecycle evidence', () => {
  it('a newer terminal event replaces an earlier working event from the same run', () => {
    expect(agentStatuses([event('run', 'working', -2000), event('run', 'completed', -1000)]).data_engineer.status).toBe('completed');
    expect(agentStatuses([event('run', 'cancelled', -1000), event('run', 'working', -2000)]).data_engineer.status).toBe('cancelled');
  });
  it('does not show deleted specialists or Osmos notebook jobs as Foundry agents', () => {
    expect(agentStatuses([{ ...event('run', 'working', -1000), agent: 'release_intelligence' }])).toEqual({});
    expect(agentStatuses([{ ...event('run', 'working', -1000), agent: 'osmos_task' }])).toEqual({});
  });
});

describe('graph renders running only for genuinely active runs', () => {
  it('completed run: dangling working events render static terminal states', () => {
    const events = [event('r1', 'working', -5000, 'fabric_orchestrator'), event('r1', 'working', -4000), event('r1', 'completed', -3000, 'fabric_architect')];
    const statuses = agentStatuses(events, [run('r1', 'completed', -6000)]);
    expect(statuses.fabric_orchestrator.status).toBe('completed');
    expect(statuses.data_engineer.status).toBe('incomplete');
    expect(statuses.fabric_architect.status).toBe('completed');
    const { container } = render(<AgentGraph events={events} runs={[run('r1', 'completed', -6000)]} />);
    expect(animation(container)).toEqual(STILL);
  });

  it('failed run: orchestrator shows failed and nothing animates', () => {
    const events = [event('r1', 'working', -5000, 'fabric_orchestrator'), event('r1', 'working', -4000)];
    const statuses = agentStatuses(events, [run('r1', 'failed', -6000)]);
    expect(statuses.fabric_orchestrator.status).toBe('failed');
    expect(statuses.data_engineer.status).toBe('incomplete');
    const { container } = render(<AgentGraph events={events} runs={[run('r1', 'failed', -6000)]} />);
    expect(animation(container)).toEqual(STILL);
    expect(container.querySelector('line[data-status="working"]')).toBeNull();
  });

  it('reloaded history: an older run with a dangling working event cannot outrank newer outcomes', () => {
    const events = [
      event('old', 'working', -60 * 60_000),
      event('old', 'working', -60 * 60_000, 'fabric_orchestrator'),
      event('new', 'completed', -60_000, 'fabric_orchestrator'),
      event('new', 'completed', -50_000, 'guideline_auditor'),
    ];
    const runs = [run('old', 'incomplete', -61 * 60_000), run('new', 'completed', -70_000)];
    const statuses = agentStatuses(events, runs);
    expect(statuses.data_engineer.status).toBe('incomplete');
    expect(statuses.fabric_orchestrator.status).toBe('completed');
    expect(statuses.guideline_auditor.status).toBe('completed');
    const { container } = render(<AgentGraph events={events} runs={runs} />);
    expect(animation(container)).toEqual(STILL);
  });

  it('actual active delegation: only the in-progress run and its delegated specialist animate', () => {
    const events = [
      event('done', 'completed', -10_000),
      event('live', 'working', -2000, 'fabric_orchestrator'),
      event('live', 'working', -1000, 'power_bi'),
    ];
    const runs = [run('done', 'completed', -20_000), run('live', 'working', -3000)];
    const statuses = agentStatuses(events, runs);
    expect(statuses.fabric_orchestrator.status).toBe('working');
    expect(statuses.power_bi.status).toBe('working');
    expect(statuses.data_engineer.status).toBe('completed');
    const { container } = render(<AgentGraph events={events} runs={runs} />);
    const state = animation(container);
    expect(state.dashed).toBe(1);
    expect(state.pulses).toBe(2);
    expect(state.live).toBe('2 agent(s) working.');
  });

  it('a completed orchestrator stays static while an Osmos/Fabric job runs separately', () => {
    const events = [event('r1', 'completed', -5000, 'fabric_orchestrator'), event('r1', 'working', -1000, 'osmos_task')];
    const { container, getByRole } = render(<AgentGraph events={events} runs={[run('r1', 'completed', -6000)]} backgroundJobs={1} />);
    expect(animation(container)).toEqual(STILL);
    expect(getByRole('status').textContent).toMatch(/Orchestrator completed; 1 Osmos\/Fabric job/);
  });

  it('stale poll race: an older non-terminal poll cannot overwrite a newer terminal state', () => {
    const terminal = { runKey: 'r1', status: 'completed', updatedAt: '2025-01-01T00:00:10Z' };
    const stale = { runKey: 'r1', status: 'working', updatedAt: '2025-01-01T00:00:05Z' };
    expect(mergeRunUpdate([terminal], stale)).toEqual([terminal]);
    expect(mergeRunUpdate([terminal], { ...stale, updatedAt: '2025-01-01T00:00:20Z' })).toEqual([terminal]);
    const older = { runKey: 'r1', status: 'working', updatedAt: '2025-01-01T00:00:10Z' };
    expect(mergeRunUpdate([older], { ...terminal, updatedAt: '2025-01-01T00:00:15Z' })[0].status).toBe('completed');
    expect(mergeRunUpdate([older], { ...older, updatedAt: '2025-01-01T00:00:01Z' })).toEqual([older]);
  });

  it('the status legend never animates', () => {
    const { container } = render(<AgentGraph events={[]} />);
    expect(animation(container)).toEqual(STILL);
  });
});
