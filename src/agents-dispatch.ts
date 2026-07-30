/**
 * Agents — drop dispatch: drag payload → entity → invocation.
 *
 * Shared by every drag intake surface (agent rows in the site folder's
 * Agents section, agent user tiles on the wallpaper, the open Agent
 * chat window). A drop is a chat whose message carries the dropped
 * entity: the dispatcher composes the message, seeds the cross-bundle
 * chat store, opens the chat window, and runs the `/invoke`
 * round-trip so the conversation shows the run live.
 *
 * Gating: an agent accepts drops only when its triggers include a
 * `drag` row; the row's `entityKinds` narrows the accepted kinds
 * (empty list = every kind). {@link agentAcceptsDrop} implements the
 * rule; the wallpaper tile handler reads the kinds inlined into the
 * user-file payload (`agentDragKinds`), the Agents section reads them
 * from the agent's triggers.
 *
 * @public
 */

import { __, sprintf } from './i18n';
import { trackedFetch } from './tracked-fetch';
import { joinRestUrl } from './rest-url';
import {
	agentsChatStore,
	openAgentChat,
	type AgentChatAgent,
	type AgentChatMessage,
} from './agents-chat-store';
import { persistAgentTranscript } from './agents-conversations';
import type { AgentInvokeResult } from './my-wordpress/agents-types';

/** Entity kinds agents understand — mirrors the trigger config enum. */
export type DroppedEntityKind = 'post' | 'page' | 'media' | 'user' | 'comment';

export interface DroppedEntity {
	kind: DroppedEntityKind;
	id: number;
	title: string;
}

interface DragPayloadLike {
	type: string;
	data: Record< string, unknown >;
}

const KIND_BY_SHORTCUT: Record< string, DroppedEntityKind > = {
	post: 'post',
	page: 'page',
	attachment: 'media',
	media: 'media',
	user: 'user',
	comment: 'comment',
};

function toId( raw: unknown ): number {
	const id = Number.parseInt( String( raw ?? '' ), 10 );
	return Number.isFinite( id ) && id > 0 ? id : 0;
}

/**
 * Normalize a drag payload into the entity it references, or null when
 * the payload doesn't reference a single entity agents understand.
 * Handles the two in-tree entity carriers: `'shortcut'` (site folder
 * tiles, wpd-tile drag-out) and `'desktop-file'` (wallpaper tiles).
 *
 * @public
 */
export function describeDragEntity(
	payload: DragPayloadLike,
): DroppedEntity | null {
	if ( payload.type === 'shortcut' ) {
		const data = payload.data as {
			kind?: unknown;
			ref?: unknown;
			title?: unknown;
			bridgePayload?: { postType?: unknown };
		};
		let kind = KIND_BY_SHORTCUT[ String( data.kind ?? '' ) ];
		if ( kind === 'post' && data.bridgePayload?.postType === 'page' ) {
			kind = 'page';
		}
		const id = toId( data.ref );
		if ( ! kind || ! id ) {
			return null;
		}
		return {
			kind,
			id,
			title: String( data.title ?? '' ) || `#${ id }`,
		};
	}

	if ( payload.type === 'desktop-file' ) {
		const placement = ( payload.data as {
			placement?: {
				file?: { type?: unknown; ref?: unknown; title?: unknown };
			};
		} ).placement;
		const file = placement?.file;
		if ( ! file ) {
			return null;
		}
		const kind = KIND_BY_SHORTCUT[ String( file.type ?? '' ) ];
		const id = toId( file.ref );
		if ( ! kind || ! id ) {
			return null;
		}
		return {
			kind,
			id,
			title: String( file.title ?? '' ) || `#${ id }`,
		};
	}

	return null;
}

/**
 * Extract the drag-trigger entity kinds from an agent's triggers.
 * Null = no drag trigger configured (the agent rejects drops);
 * [] = drag trigger present with no filter (accepts every kind).
 *
 * @public
 */
export function dragKindsFromTriggers(
	triggers: Array< { kind: string; config: Record< string, unknown > } >,
): string[] | null {
	const trigger = triggers.find( ( t ) => t.kind === 'drag' );
	if ( ! trigger ) {
		return null;
	}
	const kinds = trigger.config?.entityKinds;
	return Array.isArray( kinds ) ? kinds.map( String ) : [];
}

/**
 * The drop-gating rule shared by every intake surface.
 *
 * @public
 */
export function agentAcceptsDrop(
	dragKinds: string[] | null | undefined,
	entity: DroppedEntity | null,
	agentId?: number,
): boolean {
	if ( ! entity ) {
		return false;
	}
	// Dropping the agent's own user tile onto itself is never useful.
	if ( agentId && entity.kind === 'user' && entity.id === agentId ) {
		return false;
	}
	if ( dragKinds === null || dragKinds === undefined ) {
		return false;
	}
	if ( dragKinds.length === 0 ) {
		return true;
	}
	return dragKinds.includes( entity.kind );
}

/**
 * The message an invocation receives for a dropped entity.
 *
 * @public
 */
export function composeDropMessage( entity: DroppedEntity ): string {
	return sprintf(
		/* translators: 1: entity kind (post, media, …), 2: entity title, 3: numeric id. */
		__(
			'The user dropped the %1$s "%2$s" (id %3$s) onto you. Handle it according to your instructions, using your tools as needed.',
			'desktop-mode',
		),
		entity.kind,
		entity.title,
		String( entity.id ),
	);
}

/**
 * The message an invocation receives for a "Send to" pick.
 *
 * @public
 */
export function composeSendToMessage( entity: DroppedEntity ): string {
	return sprintf(
		/* translators: 1: entity kind (post, media, …), 2: entity title, 3: numeric id. */
		__(
			'The user sent you the %1$s "%2$s" (id %3$s) from the "Send to" menu. Handle it according to your instructions, using your tools as needed.',
			'desktop-mode',
		),
		entity.kind,
		entity.title,
		String( entity.id ),
	);
}

/**
 * Full "Send to" dispatch: seed the chat store, surface the chat
 * window, run the invocation.
 *
 * @public
 */
export function dispatchAgentSendTo(
	agent: AgentChatAgent,
	entity: DroppedEntity,
	rest: { restRoot: string; restNonce: string },
): Promise< void > {
	openAgentChatWindow( agent, 'agents-send-to' );
	return invokeAgentIntoTranscript(
		agent,
		composeSendToMessage( entity ),
		rest,
		'send-to',
	);
}

/**
 * Seed the chat store for `agent` and surface the Agent chat window.
 * The shared "open a conversation with this agent" primitive — used
 * by the drop dispatch and by the desktop tile opener.
 *
 * @public
 */
export function openAgentChatWindow(
	agent: AgentChatAgent,
	source = 'agents',
): void {
	openAgentChat( agent );
	const openWindow = (
		window as unknown as {
			wp?: {
				desktop?: {
					openWindow?: (
						id: string,
						opts?: { source?: string },
					) => boolean;
				};
			};
		}
	).wp?.desktop?.openWindow;
	if ( typeof openWindow === 'function' ) {
		openWindow( 'desktop-mode-agent-run', { source } );
	}
}

/**
 * Run one invocation with the message appended to the agent's chat
 * transcript — the chat window (already subscribed to the store)
 * paints the run live.
 *
 * @public
 */
export async function invokeAgentIntoTranscript(
	agent: AgentChatAgent,
	message: string,
	rest: { restRoot: string; restNonce: string },
	source: 'chat' | 'drag' | 'send-to',
): Promise< void > {
	openAgentChat( agent );
	const transcript = agentsChatStore.state.transcripts[ agent.id ];
	// Snapshot the conversation BEFORE this message joins it. Without
	// replaying it the run is contextless: a follow-up like "yes, do
	// it" would resolve against nothing and the agent could act on a
	// completely different entity than the one just discussed.
	const history = transcript
		.filter( ( row ) => ! row.pending && row.role !== 'error' )
		.map( ( row ) => ( { role: row.role, text: row.text } ) );
	transcript.push( { role: 'user', text: message, at: Date.now() } );
	const pending: AgentChatMessage = {
		role: 'agent',
		text: __( 'Working…', 'desktop-mode' ),
		at: Date.now(),
		pending: true,
	};
	transcript.push( pending );
	agentsChatStore.notify();

	try {
		const res = await trackedFetch(
			joinRestUrl(
				rest.restRoot,
				`desktop-mode/v1/agents/${ agent.id }/invoke`,
			),
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-WP-Nonce': rest.restNonce,
				},
				body: JSON.stringify( { message, source, history } ),
			},
			{ source: 'desktop-mode/agents' },
		);
		const body = ( await res.json().catch( () => null ) ) as
			| ( AgentInvokeResult & { message?: string } )
			| { message?: string }
			| null;
		if ( ! res.ok ) {
			const detail =
				body &&
				typeof body === 'object' &&
				typeof body.message === 'string'
					? body.message
					: `HTTP ${ res.status }`;
			throw new Error( detail );
		}
		const result = body as AgentInvokeResult;
		pending.text =
			result.text ||
			__( 'The agent finished without a text answer.', 'desktop-mode' );
		pending.toolCalls = result.toolCalls;
	} catch ( err ) {
		pending.role = 'error';
		pending.text = err instanceof Error ? err.message : String( err );
	}
	pending.pending = false;
	agentsChatStore.notify();

	// Persist the exchange (create on first save, replace afterwards).
	// Fire-and-forget by design: the chat already painted the answer,
	// and the persist helper swallows its own failures.
	void persistAgentTranscript( agent, rest );
}

/**
 * Full drop dispatch: seed the chat store, surface the chat window,
 * and run the invocation.
 *
 * @public
 */
export function dispatchAgentDrop(
	agent: AgentChatAgent,
	entity: DroppedEntity,
	rest: { restRoot: string; restNonce: string },
): Promise< void > {
	openAgentChatWindow( agent, 'agents-drop' );
	return invokeAgentIntoTranscript(
		agent,
		composeDropMessage( entity ),
		rest,
		'drag',
	);
}
