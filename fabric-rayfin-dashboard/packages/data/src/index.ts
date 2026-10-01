import { AgentRun } from './AgentRun.js';
import { Conversation } from './Conversation.js';
import { RunEvent } from './RunEvent.js';
import { RunOutput } from './RunOutput.js';
import type { UniversalAppSchema } from '@rayfin-app/shared';

/**
 * The command center's Rayfin data schema (Fabric SQL database).
 * Keep `schema` and `UniversalAppSchema` in `@rayfin-app/shared` in step.
 */
export type { UniversalAppSchema };
export { AgentRun, Conversation, RunEvent, RunOutput };

export const schema = [Conversation, AgentRun, RunEvent, RunOutput];
