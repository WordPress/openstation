/**
 * Agents — cross-bundle chat store.
 *
 * The contract between the site folder's agents renderer (which picks
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
import type {
	AgentCallToAction,
	AgentToolCall,
} from './my-wordpress/agents-types';

/** The slice of an agent the chat window needs to paint its header. */
export interface AgentChatAgent {
	id: number;
	name: string;
	description: string;
	avatarUrl: string;
}

/**
 * The entity a message carried into the conversation — a drag drop or
 * a "Send to" pick. Stored as the identity triple only; the chat
 * resolves the object's admin URL at click time, so an old transcript
 * never holds a stale link.
 */
export interface AgentChatAttachment {
	kind: 'post' | 'page' | 'media' | 'user' | 'comment';
	id: number;
	title: string;
}

/** One transcript row. */
export interface AgentChatMessage {
	role: 'user' | 'agent' | 'error';
	text: string;
	/** Object the user handed the agent with this message, if any. */
	attachment?: AgentChatAttachment;
	toolCalls?: AgentToolCall[];
	/** Confirmation buttons the answer carries (agent rows only). */
	callToActions?: AgentCallToAction[];
	/** True once one of the buttons was pressed — they stay disabled. */
	ctaUsed?: boolean;
	at: number;
	/** True while the invocation round-trip is in flight. */
	pending?: boolean;
}

export interface AgentsChatState {
	/** Agent the chat window should show. Null until an opener seeds it. */
	activeAgent: AgentChatAgent | null;
	/** Per-agent transcript, keyed by agent user id. */
	transcripts: Record< number, AgentChatMessage[] >;
	/**
	 * Persisted-conversation id backing each agent's live transcript,
	 * keyed by agent user id. Null/absent = an unsaved conversation
	 * (created server-side on the first completed exchange).
	 */
	conversationIds: Record< number, number | null >;
	/**
	 * Bumped after every conversation save/delete so the sidebar knows
	 * to refetch its list without polling.
	 */
	conversationsRev: number;
}

export const agentsChatStore = createSharedStore< AgentsChatState >(
	'desktop-mode/agents-chat',
	() => ( {
		activeAgent: null,
		transcripts: {},
		conversationIds: {},
		conversationsRev: 0,
	} ),
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
	if ( ! agentsChatStore.state.conversationIds ) {
		// Defensive: an older bundle may have seeded the store before
		// this shape landed; heal in place.
		agentsChatStore.state.conversationIds = {};
		agentsChatStore.state.conversationsRev = 0;
	}
	agentsChatStore.notify();
}
