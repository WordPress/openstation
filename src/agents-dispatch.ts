import { __, sprintf } from './i18n';
import { agentRequestId, runAgentJob } from './agents-jobs';
import {
	agentsChatStore,
	openAgentChat,
	type AgentChatAgent,
	type AgentChatAttachment,
	type AgentChatMessage,
} from './agents-chat-store';
import { persistAgentTranscript } from './agents-conversations';

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

export function agentAcceptsDrop(
	dragKinds: string[] | null | undefined,
	entity: DroppedEntity | null,
	agentId?: number,
): boolean {
	if ( ! entity ) {
		return false;
	}

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

export function composeDropMessage( entity: DroppedEntity ): string {
	return sprintf(

		__(
			'The user dropped the %1$s "%2$s" (id %3$s) onto you. Handle it according to your instructions, using your tools as needed.',
			'desktop-mode',
		),
		entity.kind,
		entity.title,
		String( entity.id ),
	);
}

export function composeSendToMessage( entity: DroppedEntity ): string {
	return sprintf(

		__(
			'The user sent you the %1$s "%2$s" (id %3$s) from the "Send to" menu. Handle it according to your instructions, using your tools as needed.',
			'desktop-mode',
		),
		entity.kind,
		entity.title,
		String( entity.id ),
	);
}

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
		attachmentFromEntity( entity ),
	);
}

function attachmentFromEntity( entity: DroppedEntity ): AgentChatAttachment {
	return { kind: entity.kind, id: entity.id, title: entity.title };
}

export function openAgentChatWindow(
	agent: AgentChatAgent,
	source = 'agents',
): void {
	openAgentChat( agent );
	const openWindow = (
		window as unknown as {
			wp?: {
				os?: {
					openWindow?: (
						id: string,
						opts?: { source?: string },
					) => boolean;
				};
			};
		}
	).wp?.os?.openWindow;
	if ( typeof openWindow === 'function' ) {
		openWindow( 'desktop-mode-agent-run', { source } );
	}
}

export async function invokeAgentIntoTranscript(
	agent: AgentChatAgent,
	message: string,
	rest: { restRoot: string; restNonce: string },
	source: 'chat' | 'drag' | 'send-to',
	attachment?: AgentChatAttachment,
): Promise< void > {
	openAgentChat( agent );
	const transcript = agentsChatStore.state.transcripts[ agent.id ];

	const noTextAnswer = __(
		'The agent finished without a text answer.',
		'desktop-mode',
	);
	const history = transcript
		.filter(
			( row ) =>
				! row.pending &&
				row.role !== 'error' &&
				! ( row.role === 'agent' && row.text === noTextAnswer ),
		)
		.map( ( row ) => ( { role: row.role, text: row.text } ) );

	transcript.push( { role: 'user', text: message, at: Date.now(), attachment } );
	const pending: AgentChatMessage = {
		role: 'agent',
		text: __( 'Working…', 'desktop-mode' ),
		at: Date.now(),
		pending: true,
	};
	transcript.push( pending );
	agentsChatStore.notify();

	try {
		const result = await runAgentJob(
			agent.id,
			{ message, source, history },
			rest,
			agentRequestId(),
			( status ) => {
				const labels = {
					queued: __( 'Queued — waiting for a WordPress worker…', 'desktop-mode' ),
					reconnecting: __( 'Reconnecting to the background job…', 'desktop-mode' ),
					running: __( 'Working in the background…', 'desktop-mode' ),
				};
				pending.text = labels[ status ];
				agentsChatStore.notify();
			},
		);
		if ( result.text?.trim() ) {
			pending.text = result.text;
		} else {
			pending.role = 'error';
			pending.text = noTextAnswer;
		}
		pending.toolCalls = result.toolCalls;
		if (
			Array.isArray( result.callToActions ) &&
			result.callToActions.length > 0
		) {
			pending.callToActions = result.callToActions;
		}
	} catch ( err ) {
		pending.role = 'error';
		pending.text = err instanceof Error ? err.message : String( err );
	}
	pending.pending = false;
	agentsChatStore.notify();

	void persistAgentTranscript( agent, rest );
}

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
		attachmentFromEntity( entity ),
	);
}
