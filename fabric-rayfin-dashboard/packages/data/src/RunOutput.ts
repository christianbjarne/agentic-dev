import { entity, int, role, text, uuid } from '@microsoft/rayfin-core';

/** An ordered chunk of an orchestrator response (max 4000 characters each). */
@entity()
@role('authenticated', '*', {
  policy: (claims, item) => claims.sub.eq(item.owner_id),
})
export class RunOutput {
  @uuid() id!: string;
  @text({ max: 64 }) runKey!: string;
  @int() seq!: number;
  @text({ max: 4000 }) content!: string;
  @text({ max: 200 }) owner_id!: string;
}
