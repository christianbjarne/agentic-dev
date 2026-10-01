import { date, entity, role, text, uuid } from '@microsoft/rayfin-core';

/**
 * A specialist delegation (or orchestrator lifecycle) event. These rows feed
 * the agent graph and the live activity timeline.
 */
@entity()
@role('authenticated', '*', {
  policy: (claims, item) => claims.sub.eq(item.owner_id),
})
export class RunEvent {
  @uuid() id!: string;
  @text({ max: 64 }) runKey!: string;
  @text({ max: 200 }) eventKey!: string;
  @text({ max: 64 }) agent!: string;
  @text({ max: 32 }) status!: string;
  @text({ max: 1000 }) task!: string;
  @text({ optional: true, max: 2000 }) summary?: string;
  @date() createdAt!: Date;
  @date() updatedAt!: Date;
  @text({ max: 200 }) owner_id!: string;
}
