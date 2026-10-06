import { date, entity, role, text, uuid } from '@microsoft/rayfin-core';

/**
 * One orchestrator conversation. Owner-scoped: a signed-in user only sees
 * their own conversations, enforced by the Rayfin data API, not the UI.
 */
@entity()
@role('authenticated', '*', {
  policy: (claims, item) => claims.sub.eq(item.owner_id),
})
export class Conversation {
  @uuid() id!: string;
  @text({ min: 1, max: 200 }) title!: string;
  @text({ max: 500 }) lastPrompt!: string;
  @text({ optional: true, max: 200 }) previousResponseId?: string;
  @text({ optional: true, max: 200 }) agentSessionId?: string;
  @text({ optional: true, max: 64 }) activeRunKey?: string;
  @date() createdAt!: Date;
  @date() updatedAt!: Date;
  @text({ max: 200 }) owner_id!: string;
}
