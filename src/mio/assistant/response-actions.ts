/** Executable response controls live only in their owning session, never history. */
import { __ } from '../../i18n';
import { MIO_LIMITS, observe, outcomeOf } from './operations';
import type { MioOperations } from './operations';
import type { MioCallContext, MioChatMessage, MioOperation, MioResponseAction, MioResponseActionEffect, MioResponseContext, MioWindowContext } from './types';

/** What this shell renders; apps read it from the lease before offering a write. */
export const MIO_RESPONSE_ACTION_EFFECTS: readonly MioResponseActionEffect[] = Object.freeze( [ 'read', 'navigate', 'write' ] );

interface Entry {
	/** The opaque action id this entry is registered under. */
	key: string;
	messageId: string;
	turnId: string;
	action: MioResponseAction;
	pending: AbortController | null;
	status: string;
	/** Settled for good: keeps its status and never runs again. */
	retired: boolean;
	/** Withdrawn because a sibling in its group was chosen. */
	hidden: boolean;
	/** Writes only: one logical operation across retries. */
	idempotencyKey?: string;
	attempts: number;
	/** Writes only: the ledger identity of the attempt in flight. */
	call?: MioCallContext;
}
export interface MioResponseActionView {
	id: string;
	label: string;
	ariaLabel?: string;
	icon?: string;
	emphasis: 'primary' | 'secondary';
	effect: MioResponseActionEffect;
	description?: string;
	pending: boolean;
	available: boolean;
	status: string;
}
/** Shell-authored evidence for the next turn; no callback, URL or receipt body. */
interface MioResponseActionRecord {
	/** Lease-local; stripped before the record reaches history. */
	entryId: string;
	source: 'response-action';
	label: string;
	effect: MioResponseActionEffect;
	status: 'completed' | 'confirmed' | 'unknown' | 'rejected';
}

const boundedText = ( value: unknown, limit: number ): value is string =>
	typeof value === 'string' && value.trim().length > 0 && value.length <= limit;

export class MioResponseActions {
	private entries = new Map<string, Entry>();
	private listeners = new Set<() => void>();
	private records: MioResponseActionRecord[] = [];
	private disposed = false;

	private context: MioWindowContext;
	private active: () => boolean;
	private messages: () => readonly MioChatMessage[];
	private operations: MioOperations;
	public constructor( context: MioWindowContext, active: () => boolean, messages: () => readonly MioChatMessage[], operations: MioOperations ) {
		this.context = context; this.active = active; this.messages = messages; this.operations = operations;
	}

	public subscribe( listener: () => void ): () => void {
		this.listeners.add( listener );
		return () => {
			this.listeners.delete( listener );
		};
	}
	private notify(): void {
		for ( const listener of this.listeners ) {
			observe( listener, undefined );
		}
	}
	public create( context: MioResponseContext ): string[] {
		const ids: string[] = [];
		if ( this.disposed ) {
			return ids;
		}
		try {
			const descriptors = this.context.responseActions?.( context );
			if ( ! Array.isArray( descriptors ) || this.disposed ) {
				return ids;
			}
			const names = new Set<string>();
			let primary = false;
			let write = false;
			let described = false;
			// Bound even a buggy application's descriptor list.
			for ( const candidate of descriptors.slice( 0, 100 ) ) {
				try {
					if ( ! candidate || typeof candidate !== 'object' ) {
						continue;
					}
					const action = { ...candidate } as MioResponseAction;
					if ( ! boundedText( action.id, 80 ) || names.has( action.id ) ||
						! boundedText( action.label, 40 ) || typeof action.run !== 'function' ||
						! MIO_RESPONSE_ACTION_EFFECTS.includes( action.effect ) ||
						( action.emphasis !== undefined && ! [ 'primary', 'secondary' ].includes( action.emphasis ) ) ||
						( action.allowed !== undefined && typeof action.allowed !== 'function' ) ||
						( action.ariaLabel !== undefined && ! boundedText( action.ariaLabel, 160 ) ) ||
						( action.group !== undefined && ! boundedText( action.group, 80 ) ) ||
						( action.description !== undefined && ! boundedText( action.description, 160 ) ) ) {
						continue;
					}
					// One message offers at most one write; later ones are dropped.
					if ( action.effect === 'write' ) {
						if ( write ) {
							continue;
						}
						write = true;
					}
					names.add( action.id );
					// One consequence line per message: later descriptions are dropped.
					if ( action.description !== undefined ) {
						if ( described ) {
							delete action.description;
						}
						described = true;
					}
					// The kit resolves only Dashicons; unknown names produce no glyph.
					if ( action.icon !== undefined && ( typeof action.icon !== 'string' || ! /^(?:dashicons-)?[a-z][a-z0-9-]{0,63}$/.test( action.icon ) ) ) {
						delete action.icon;
					}
					if ( action.emphasis === 'primary' && ! primary ) {
						primary = true;
					} else {
						action.emphasis = 'secondary';
					}
					const id = crypto.randomUUID();
					const turnId = context.summary.turnId;
					this.entries.set( id, { key: id, messageId: context.messageId, turnId, action, pending: null, status: '', retired: false, hidden: false, attempts: 0,
						...( action.effect === 'write' ? { idempotencyKey: `${ turnId }:response:${ id }` } : {} ) } );
					ids.push( id );
					if ( ids.length === 3 ) {
						break;
					}
				} catch { /* One malformed descriptor cannot discard the reply. */ }
			}
		} catch { /* An app callback failure never changes a save outcome. */ }
		return ids;
	}

	/** Also removes callbacks evicted by a custom store. At most 40 messages own actions. */
	public prune(): void {
		const live = new Set( this.messages().slice( -40 ).flatMap( ( message ) =>
			message.role === 'assistant' ? ( message.actionIds ?? [] ).map( ( id ) => `${ message.id }/${ id }` ) : [] ) );
		for ( const [ id, entry ] of this.entries ) {
			if ( ! live.has( `${ entry.messageId }/${ id }` ) ) {
				entry.pending?.abort(); this.entries.delete( id );
			}
		}
	}

	/**
	 * A new user message retires every write that has not started, and every
	 * other action in its choice group: a decision the conversation has moved
	 * past cannot be answered either way.
	 */
	public retireWrites(): void {
		let changed = false;
		for ( const entry of this.entries.values() ) {
			if ( entry.action.effect !== 'write' ) {
				continue;
			}
			for ( const member of [ entry, ...this.siblings( entry ) ] ) {
				if ( ! member.pending && ! member.retired && ! member.hidden ) {
					member.retired = true; member.status = __( 'No longer available.' ); changed = true;
				}
			}
		}
		if ( changed ) {
			this.notify();
		}
	}

	/** Settled choices since the previous turn, for the model-facing history. */
	public drain(): MioResponseActionRecord[] {
		const records = this.records; this.records = [];
		return records;
	}
	/** Puts back records a turn drained but never sent, ahead of any newer ones. */
	public restore( records: readonly MioResponseActionRecord[] ): void {
		if ( this.disposed ) {
			return;
		}
		const newer = new Set( this.records.map( ( record ) => record.entryId ) );
		this.records = [ ...records.filter( ( record ) => ! newer.has( record.entryId ) ), ...this.records ].slice( -20 );
	}
	/** One record per action: a retry that settles replaces its earlier rejection. */
	private remember( entry: Entry, status: MioResponseActionRecord['status'] ): void {
		const entryId = entry.key;
		this.records = [ ...this.records.filter( ( record ) => record.entryId !== entryId ),
			{ entryId, source: 'response-action' as const, label: entry.action.label, effect: entry.action.effect, status } ].slice( -20 );
	}

	private siblings( entry: Entry ): Entry[] {
		if ( entry.action.group === undefined ) {
			return [];
		}
		return Array.from( this.entries.values() ).filter( ( other ) => other !== entry &&
			other.messageId === entry.messageId && other.action.group === entry.action.group );
	}
	/** A completed choice is final: the chosen action keeps its status, the rest disappear. */
	private choose( entry: Entry ): void {
		if ( entry.action.group === undefined ) {
			return;
		}
		entry.retired = true;
		for ( const other of this.siblings( entry ) ) {
			other.hidden = true;
		}
	}
	/** Writes belong to the newest assistant message only, until the conversation moves on. */
	private latest( entry: Entry ): boolean {
		const messages = this.messages();
		const last = messages[ messages.length - 1 ];
		return last?.role === 'assistant' && last.id === entry.messageId;
	}
	private allowed( entry: Entry ): boolean {
		try {
			return ! this.disposed && ! entry.retired && ! entry.hidden && this.active() &&
				( entry.action.effect !== 'write' || this.latest( entry ) ) && ( entry.action.allowed?.() ?? true );
		} catch {
			return false;
		}
	}
	public list( message: MioChatMessage ): MioResponseActionView[] {
		this.prune();
		if ( message.role !== 'assistant' ) {
			return [];
		}
		return ( message.actionIds ?? [] ).flatMap( ( id ) => {
			const entry = this.entries.get( id );
			if ( ! entry || entry.messageId !== message.id || entry.hidden ) {
				return [];
			}
			const allowed = this.allowed( entry );
			if ( ! allowed && ! entry.status && ! entry.pending ) {
				return [];
			}
			// A sibling in flight disables this choice without withdrawing it.
			const available = allowed && ! this.siblings( entry ).some( ( other ) => other.pending );
			const { label, ariaLabel, icon, emphasis, effect } = entry.action;
			// A settled action's consequence is history, not a warning.
			const description = entry.retired ? undefined : entry.action.description;
			return [ { id, label, ariaLabel, icon, emphasis: emphasis ?? 'secondary', effect, description, pending: entry.pending !== null, available, status: entry.status } ];
		} );
	}

	/**
	 * Runs synchronously up to the caller's first await to preserve a user gesture.
	 * A write runs only for a trusted click event; nothing else can invoke it.
	 */
	public async run( messageId: string, id: string, event?: Event ): Promise<void> {
		this.prune();
		const entry = this.entries.get( id );
		if ( ! entry || entry.messageId !== messageId || entry.pending || entry.retired || entry.hidden ||
			this.siblings( entry ).some( ( other ) => other.pending ) ) {
			return;
		}
		if ( entry.action.effect === 'write' && event?.isTrusted !== true ) {
			return;
		}
		if ( ! this.allowed( entry ) ) {
			entry.status = __( 'This action is no longer available.' ); this.notify(); return;
		}
		if ( entry.action.effect === 'write' ) {
			return this.write( entry, messageId );
		}
		const controller = new AbortController();
		entry.pending = controller; entry.status = __( 'Working…' );
		this.notify();
		try {
			// Rendering observers may synchronously close the chat or revoke access.
			controller.signal.throwIfAborted();
			if ( ! this.allowed( entry ) ) {
				throw new Error( __( 'This action is no longer available.' ) );
			}
			await entry.action.run( { signal: controller.signal, messageId, turnId: entry.turnId } );
			// Opening a destination may focus it and close this chat. No post-run
			// ownership guard: successful navigation must not turn into a failure.
			entry.status = __( 'Done.' );
			if ( entry.action.group !== undefined ) {
				this.choose( entry ); this.remember( entry, 'completed' );
			}
		} catch ( error ) {
			entry.status = error instanceof Error ? error.message.slice( 0, 500 ) : __( 'Could not complete this action. Try again.' );
			if ( controller.signal.aborted ) {
				entry.status = '';
			}
		} finally {
			entry.pending = null; this.notify();
		}
	}

	/** Cancellation is not rollback: a started write is recorded however it settles. */
	private async write( entry: Entry, messageId: string ): Promise<void> {
		const controller = new AbortController();
		const ability = `response:${ entry.action.id }`;
		let revision: string | undefined;
		try {
			revision = this.context.revision?.();
		} catch { /* The server enforces the revision; the ledger copy is evidence only. */ }
		entry.attempts++;
		const call: MioCallContext = {
			turnId: entry.turnId, callId: `${ entry.idempotencyKey! }:${ entry.attempts }`, idempotencyKey: entry.idempotencyKey!,
			windowId: this.context.windowId, revision, signal: controller.signal,
			limits: MIO_LIMITS, validationFailures: 0, validationRemaining: 0, effect: 'write',
		};
		entry.pending = controller; entry.call = call; entry.status = __( 'Working…' );
		this.record( call, ability, 'running' );
		this.notify();
		try {
			// Ledger and rendering observers may synchronously close the chat or revoke access.
			controller.signal.throwIfAborted();
			if ( ! this.allowed( entry ) ) {
				throw new Error( __( 'This action is no longer available.' ) );
			}
		} catch ( error ) {
			// Nothing has run, so nothing was written.
			if ( ! this.disposed ) {
				this.record( call, ability, 'rejected' );
			}
			entry.status = ! controller.signal.aborted && error instanceof Error ? error.message : '';
			entry.pending = null; entry.call = undefined; this.notify();
			return;
		}
		let result: unknown;
		try {
			result = await entry.action.run( { signal: controller.signal, messageId, turnId: entry.turnId, callId: call.callId, idempotencyKey: call.idempotencyKey } );
		} catch {
			// A throw never proves that nothing was written.
			result = undefined;
		}
		entry.pending = null; entry.call = undefined;
		// Disposal has already recorded this attempt as unknown.
		if ( this.disposed ) {
			return;
		}
		const outcome = outcomeOf( result );
		if ( outcome?.effect === 'none' && outcome.status === 'rejected' ) {
			this.record( call, ability, 'rejected' );
			const message = outcome.errors.find( ( error ) => boundedText( error?.message, 500 ) )?.message;
			entry.status = message ?? __( 'Could not complete this action. Try again.' );
			// Only a retryable rejection invites another deliberate click.
			entry.retired = outcome.retryable !== true;
			this.remember( entry, 'rejected' );
		} else if ( outcome?.effect === 'write' && outcome.status === 'confirmed' && this.record( call, ability, 'confirmed', outcome.receipt ) === 'confirmed' ) {
			entry.status = __( 'Done.' ); entry.retired = true;
			this.choose( entry ); this.remember( entry, 'confirmed' );
		} else {
			// Unknown, missing, malformed, a throw, or a receipt the ledger refused.
			if ( outcome?.effect !== 'write' || outcome.status !== 'confirmed' ) {
				this.record( call, ability, 'unknown' );
			}
			entry.status = __( 'Could not confirm the result. Check before trying again.' ); entry.retired = true;
			this.remember( entry, 'unknown' );
		}
		this.notify();
	}
	/** Returns the status the ledger kept; a duplicate receipt degrades to unknown. */
	private record( call: MioCallContext, ability: string, status: MioOperation['status'], receipt?: string ): MioOperation['status'] {
		try {
			return this.operations.record( call, ability, status, receipt, 'response-action' ).status;
		} catch {
			return 'unknown';
		}
	}

	public cancel(): void {
		for ( const entry of this.entries.values() ) {
			entry.pending?.abort();
		}
	}
	public dispose(): void {
		this.disposed = true;
		for ( const entry of this.entries.values() ) {
			if ( entry.call ) {
				this.record( entry.call, `response:${ entry.action.id }`, 'unknown' );
			}
		}
		this.cancel(); this.entries.clear(); this.listeners.clear(); this.records = [];
	}
}
