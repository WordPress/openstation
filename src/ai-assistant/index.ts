/**
 * Desktop Mode — AI Assistant public-API barrel.
 *
 * Two responsibilities:
 *   1. Re-export the type surface so consumers (api/facade.ts,
 *      desktop.ts) can `import type { AiAssistantApi } from
 *      '../ai-assistant'` without specifying the inner file.
 *   2. Re-export the lazy stub class so `desktop.ts` can construct
 *      it with the same `new AiAssistant( … )` shape it used before
 *      the split. Renamed at the import site to `AiAssistant` for a
 *      drop-in.
 *
 * The full implementation (`impl.ts`) is NOT re-exported here. That
 * keeps the impl out of every bundle that just wants the API
 * surface — only the entry bundle (`entry.ts`) and the lazy script
 * load reach it.
 */

export type {
	AiAssistantApi,
	AiAssistantConfig,
	AiAssistantFactory,
} from './types';
export { AiAssistantStub } from './stub';
