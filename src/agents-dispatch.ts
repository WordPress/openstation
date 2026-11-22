/**
 * Agents — drop dispatch: drag payload → entity → invocation.
 *
 * Shared by every drag intake surface (agent rows in WP Explorer's
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
import {
	agentRequestId,
	JobRequestError,
	resumeAgentJob,
	runAgentJob,
	type AgentJobProgress,
	type AgentJobStatusListener,
} from './agents-jobs';
import {
	agentsChatStore,
	openAgentChat,
	type AgentChatAgent,
	type AgentChatAttachment,
	type AgentChatMessage,
} from './agents-chat-store';
import { persistAgentTranscript } from './agents-conversations';
import type { AgentInvokeResult, AgentToolCall } from './agents-types';

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
 * Handles the two in-tree entity carriers: `'shortcut'` (WP Explorer
 * tiles, os-tile drag-out) and `'desktop-file'` (wallpaper tiles).
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
 * window, queue the invocation and poll for its result.
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
		attachmentFromEntity( entity ),
	);
}

/**
 * The stored, chat-renderable form of a dropped / sent entity.
 * Spelled out field by field so the transcript payload stays a stable
 * triple even if {@link DroppedEntity} grows.
 */
function attachmentFromEntity( entity: DroppedEntity ): AgentChatAttachment {
	return { kind: entity.kind, id: entity.id, title: entity.title };
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

/**
 * A job's progress as chat tool calls. Progress never carries outputs,
 * and the renderer and the transcript store already accept a call
 * without them.
 */
function progressToolCalls(
	progress: AgentJobProgress | null | undefined,
): AgentToolCall[] {
	return ( progress?.toolCalls ?? [] ).map( ( call ) => ( {
		callId: '',
		name: call.name,
		args: call.args,
		output: null,
		error: call.error,
	} ) );
}

/** The row text of a run that ended without answer text. */
function noTextAnswerText(): string {
	return __( 'The agent finished without a text answer.', 'desktop-mode' );
}

/** A thrown run error as row text. */
function runErrorText( err: unknown ): string {
	return err instanceof Error ? err.message : String( err );
}

/**
 * Paint one non-terminal job status onto the pending row: the status
 * label, then the tool calls the job has made so far.
 */
function applyJobStatus(
	row: AgentChatMessage,
	status: Parameters< AgentJobStatusListener >[ 0 ],
	progress?: AgentJobProgress | null,
): void {
	const labels = {
		queued: __( 'Queued — waiting for a WordPress worker…', 'desktop-mode' ),
		reconnecting: __( 'Reconnecting to the background job…', 'desktop-mode' ),
		running: __( 'Working in the background…', 'desktop-mode' ),
	};
	row.text = labels[ status ];
	const calls = progressToolCalls( progress );
	if ( calls.length > 0 ) {
		row.toolCalls = calls;
	}
	agentsChatStore.notify();
}

/**
 * Wait for a run and settle its pending row on the outcome: the answer
 * (with its call-to-action buttons), the no-text error, or the error
 * the run threw. The row stops being pending and drops its job id.
 */
async function settleJobRow(
	row: AgentChatMessage,
	run: Promise< AgentInvokeResult >,
	errorText: ( err: unknown ) => string = runErrorText,
): Promise< void > {
	try {
		const result = await run;
		if ( result.text?.trim() ) {
			row.text = result.text;
		} else {
			row.role = 'error';
			row.text = noTextAnswerText();
		}
		row.toolCalls = result.toolCalls;
		if (
			Array.isArray( result.callToActions ) &&
			result.callToActions.length > 0
		) {
			row.callToActions = result.callToActions;
		}
	} catch ( err ) {
		row.role = 'error';
		row.text = errorText( err );
		// Keep what the run called. Without the failed job's progress
		// (a client-side timeout), the last progress seen stays on the row.
		const calls = progressToolCalls(
			err instanceof JobRequestError ? err.progress : null,
		);
		if ( calls.length > 0 ) {
			row.toolCalls = calls;
		}
	}
	row.pending = false;
	delete row.jobId;
	agentsChatStore.notify();
}

/**
 * Run one invocation with the message appended to the agent's chat
 * transcript — the chat window (already subscribed to the store)
 * paints the run live.
 *
 * The transcript is saved twice: once the server has accepted the job
 * (its first `queued` or `running` status), with the pending row and
 * its job id, so a reload can resume the poll; and again when the run
 * ends.
 *
 * @public
 */
export async function invokeAgentIntoTranscript(
	agent: AgentChatAgent,
	message: string,
	rest: { restRoot: string; restNonce: string },
	source: 'chat' | 'drag' | 'send-to',
	attachment?: AgentChatAttachment,
): Promise< void > {
	openAgentChat( agent );
	const transcript = agentsChatStore.state.transcripts[ agent.id ];
	// Snapshot the conversation BEFORE this message joins it. Without
	// replaying it the run is contextless: a follow-up like "yes, do
	// it" would resolve against nothing and the agent could act on a
	// completely different entity than the one just discussed.
	// A run that produced no answer text is stored as an `error` row,
	// never as something the agent said; replaying it as "You: …"
	// would tell the model it once answered with a UI placeholder.
	// An `agent` row whose text is exactly the placeholder is legacy
	// data from the same situation, so it is skipped by text.
	const noTextAnswer = noTextAnswerText();
	const history = transcript
		.filter(
			( row ) =>
				! row.pending &&
				row.role !== 'error' &&
				! ( row.role === 'agent' && row.text === noTextAnswer ),
		)
		.map( ( row ) => ( { role: row.role, text: row.text } ) );
	// The attachment rides ALONGSIDE the composed sentence, never
	// instead of it: the model keeps reading the same prose it always
	// did, the chat gains an object it can open.
	transcript.push( { role: 'user', text: message, at: Date.now(), attachment } );
	const jobId = agentRequestId();
	const pending: AgentChatMessage = {
		role: 'agent',
		text: __( 'Working…', 'desktop-mode' ),
		at: Date.now(),
		pending: true,
		jobId,
	};
	transcript.push( pending );
	agentsChatStore.notify();

	let acceptedSave: Promise< void > | null = null;
	await settleJobRow(
		pending,
		runAgentJob(
			agent.id,
			{ message, source, history },
			rest,
			jobId,
			( status, progress ) => {
				applyJobStatus( pending, status, progress );
				if ( ! acceptedSave && status !== 'reconnecting' ) {
					acceptedSave = persistAgentTranscript( agent, rest );
				}
			},
		),
	);

	// Persist the exchange (create on first save, replace afterwards).
	// Fire-and-forget by design: the chat already painted the answer,
	// and the persist helper swallows its own failures. It waits for
	// the accepted-job save, which may still be creating the
	// conversation: two overlapping first saves would create two.
	void Promise.resolve( acceptedSave ).then( () =>
		persistAgentTranscript( agent, rest ),
	);
}

/**
 * Resume the job a pending row in `agent`'s transcript is waiting on —
 * a conversation saved before a reload and opened again. Status reads
 * only: it sends no message and never submits the job again. The row
 * updates the way a live run's does, then the transcript is saved.
 *
 * @public
 */
export async function resumeAgentJobIntoTranscript(
	agent: AgentChatAgent,
	rest: { restRoot: string; restNonce: string },
): Promise< void > {
	const row = ( agentsChatStore.state.transcripts[ agent.id ] ?? [] ).find(
		( message ) => message.pending && message.jobId,
	);
	if ( ! row?.jobId ) {
		return;
	}
	await settleJobRow(
		row,
		resumeAgentJob( agent.id, rest, row.jobId, ( status, progress ) =>
			applyJobStatus( row, status, progress ),
		),
		( err ) =>
			// Jobs are deleted a day after they start, and a job the
			// server never stored answers the same way.
			err instanceof JobRequestError && err.status === 404
				? __(
					'The result of this run is no longer available. Some work may already have been applied. Check the site before submitting the task again.',
					'desktop-mode',
				)
				: runErrorText( err ),
	);
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
		attachmentFromEntity( entity ),
	);
}
