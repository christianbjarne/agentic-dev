import { date, entity, role, text, uuid } from '@microsoft/rayfin-core';

/**
 * One prompt sent to the Foundry fabric-orchestrator and its outcome.
 * The response text is stored in ordered `RunOutput` chunks because MSSQL
 * text columns must stay bounded (see known limitations).
 */
@entity()
@role('authenticated', '*', {
  policy: (claims, item) => claims.sub.eq(item.owner_id),
})
export class AgentRun {
  @uuid() id!: string;
  @text({ max: 64 }) runKey!: string;
  @text({ max: 64 }) conversationKey!: string;
  @text({ min: 1, max: 4000 }) prompt!: string;
  @text({ max: 32 }) status!: string;
  @text({ optional: true, max: 200 }) responseId?: string;
  @text({ optional: true, max: 2000 }) error?: string;
  @text({ optional: true, max: 4000 }) handoff?: string;
  @text({ optional: true, max: 64 }) osmosTaskId?: string;
  @text({ optional: true, max: 32 }) osmosStatus?: string;
  @date() createdAt!: Date;
  @date() updatedAt!: Date;
  @text({ max: 200 }) owner_id!: string;
}
