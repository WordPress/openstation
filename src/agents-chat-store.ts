/**
 * Agents — cross-bundle chat store.
 *
 * The contract between the My WordPress agents renderer (which picks
 * the agent and opens the chat window) and the `agent-run-window`
 * bundle (which paints the conversation and posts to `/invoke`). Both
 * bundles compile their own copy of this module; `createSharedStore`
 * guarantees they share one live state object.
 *
 * Transcripts are session-only — nothing here persists.
 *
 * @public
 */

import { createSharedStore } from './shared-store';
import type { AgentToolCall } from './my-wordpress/agents-types';

/** The slice of an agent the chat window needs to paint its header. */
export interface AgentChatAgent {
	id: number;
	name: string;
	description: string;
	avatarUrl: string;
}

/** One transcript row. */
export interface AgentChatMessage {
	role: 'user' | 'agent' | 'error';
	text: string;
	toolCalls?: AgentToolCall[];
	at: number;
	/** True while the invocation round-trip is in flight. */
	pending?: boolean;
}

export interface AgentsChatState {
	/** Agent the chat window should show. Null until an opener seeds it. */
	activeAgent: AgentChatAgent | null;
	/** Per-agent transcript, keyed by agent user id. Session-only. */
	transcripts: Record< number, AgentChatMessage[] >;
}

export const agentsChatStore = createSharedStore< AgentsChatState >(
	'desktop-mode/agents-chat',
	() => ( { activeAgent: null, transcripts: {} } ),
);

/**
 * Seed the store for a chat with the given agent (keeping any
 * transcript from earlier in the session) — call before opening the
 * chat window.
 *
 * @public
 */
export function openAgentChat( agent: AgentChatAgent ): void {
	agentsChatStore.state.activeAgent = agent;
	if ( ! agentsChatStore.state.transcripts[ agent.id ] ) {
		agentsChatStore.state.transcripts[ agent.id ] = [];
	}
	agentsChatStore.notify();
}
