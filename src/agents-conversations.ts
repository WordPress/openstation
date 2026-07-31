/**
 * Agents — persisted chat conversations, client side.
 *
 * REST wrappers over `/desktop-mode/v1/agents/conversations` plus the
 * auto-save primitive the dispatcher calls after every completed
 * exchange. Conversations are owner-only server-side; this module
 * only ever sees the current user's rows.
 *
 * @public
 */

import { trackedFetch } from './tracked-fetch';
import { joinRestUrl } from './rest-url';
import {
	agentsChatStore,
	type AgentChatAgent,
	type AgentChatMessage,
} from './agents-chat-store';

export interface AgentConversationSummary {
	id: number;
	agentId: number;
	agentName: string;
	agentDescription: string;
	agentAvatarUrl: string;
	title: string;
	messageCount: number;
	createdAt: string;
	updatedAt: string;
}

export interface AgentConversation extends AgentConversationSummary {
	messages: AgentChatMessage[];
}

export interface RestAuth {
	restRoot: string;
	restNonce: string;
}

const BASE = 'desktop-mode/v1/agents/conversations';

async function request< T >(
	rest: RestAuth,
	path: string,
	init: RequestInit = {},
): Promise< T > {
	const res = await trackedFetch(
		joinRestUrl( rest.restRoot, path ),
		{
			...init,
			headers: {
				'Content-Type': 'application/json',
				'X-WP-Nonce': rest.restNonce,
				...( init.headers ?? {} ),
			},
		},
		{ source: 'desktop-mode/agents', silent: true },
	);
	const body = ( await res.json().catch( () => null ) ) as
		| ( T & { message?: string } )
		| null;
	if ( ! res.ok ) {
		const detail =
			body && typeof body === 'object' && typeof body.message === 'string'
				? body.message
				: `HTTP ${ res.status }`;
		throw new Error( detail );
	}
	return body as T;
}

/** The caller's conversations, most recently updated first. */
export async function listConversations(
	rest: RestAuth,
): Promise< AgentConversationSummary[] > {
	const rows = await request< unknown >( rest, BASE );
	return Array.isArray( rows ) ? ( rows as AgentConversationSummary[] ) : [];
}

/** One conversation with its messages. */
export function getConversation(
	rest: RestAuth,
	id: number,
): Promise< AgentConversation > {
	return request< AgentConversation >( rest, `${ BASE }/${ id }` );
}

/** Delete one conversation. */
export function deleteConversation(
	rest: RestAuth,
	id: number,
): Promise< unknown > {
	return request( rest, `${ BASE }/${ id }`, { method: 'DELETE' } );
}

function storableMessages( transcript: AgentChatMessage[] ): AgentChatMessage[] {
	return transcript.filter( ( row ) => ! row.pending );
}

/**
 * Persist the agent's current transcript: create the conversation on
 * the first completed exchange, replace its messages afterwards.
 * Never throws — persistence must not break the chat itself.
 *
 * @public
 */
export async function persistAgentTranscript(
	agent: AgentChatAgent,
	rest: RestAuth,
): Promise< void > {
	const state = agentsChatStore.state;
	const messages = storableMessages( state.transcripts[ agent.id ] ?? [] );
	if ( messages.length === 0 ) {
		return;
	}
	if ( ! state.conversationIds ) {
		state.conversationIds = {};
	}

	try {
		const existing = state.conversationIds[ agent.id ];
		if ( existing ) {
			await request( rest, `${ BASE }/${ existing }`, {
				method: 'PUT',
				body: JSON.stringify( { messages } ),
			} );
		} else {
			const created = await request< AgentConversation >( rest, BASE, {
				method: 'POST',
				body: JSON.stringify( { agentId: agent.id, messages } ),
			} );
			state.conversationIds[ agent.id ] = created.id;
		}
		state.conversationsRev = ( state.conversationsRev ?? 0 ) + 1;
		agentsChatStore.notify();
	} catch ( err ) {
		// eslint-disable-next-line no-console
		console.warn( '[desktop-mode/agents] conversation save failed:', err );
	}
}

/**
 * Load a persisted conversation into the store and make its agent the
 * active one — the sidebar's row-click handler.
 *
 * @public
 */
export async function openConversation(
	rest: RestAuth,
	id: number,
): Promise< void > {
	const conversation = await getConversation( rest, id );
	const state = agentsChatStore.state;
	state.activeAgent = {
		id: conversation.agentId,
		name: conversation.agentName,
		description: conversation.agentDescription,
		avatarUrl: conversation.agentAvatarUrl,
	};
	state.transcripts[ conversation.agentId ] = Array.isArray(
		conversation.messages,
	)
		? conversation.messages
		: [];
	if ( ! state.conversationIds ) {
		state.conversationIds = {};
	}
	state.conversationIds[ conversation.agentId ] = conversation.id;
	agentsChatStore.notify();
}
