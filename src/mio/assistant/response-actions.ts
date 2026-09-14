/** Executable response controls live only in their owning session, never history. */
import { __ } from '../../i18n';
import { observe } from './operations';
import type { MioChatMessage, MioResponseAction, MioResponseContext, MioWindowContext } from './types';

interface Entry {
	messageId: string;
	turnId: string;
	action: MioResponseAction;
	pending: AbortController | null;
	status: string;
}
export interface MioResponseActionView {
	id: string;
	label: string;
	ariaLabel?: string;
	icon?: string;
	emphasis: 'primary' | 'secondary';
	pending: boolean;
	available: boolean;
	status: string;
}

const boundedText = ( value: unknown, limit: number ): value is string =>
	typeof value === 'string' && value.trim().length > 0 && value.length <= limit;

export class MioResponseActions {
	private entries = new Map<string, Entry>();
	private listeners = new Set<() => void>();
	private disposed = false;

	private context: MioWindowContext;
	private active: () => boolean;
	private messages: () => readonly MioChatMessage[];
	public constructor( context: MioWindowContext, active: () => boolean, messages: () => readonly MioChatMessage[] ) {
		this.context = context; this.active = active; this.messages = messages;
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
			// Bound even a buggy application's descriptor list.
			for ( const candidate of descriptors.slice( 0, 100 ) ) {
				try {
					if ( ! candidate || typeof candidate !== 'object' ) {
						continue;
					}
					const action = { ...candidate } as MioResponseAction;
					if ( ! boundedText( action.id, 80 ) || names.has( action.id ) ||
						! boundedText( action.label, 40 ) || typeof action.run !== 'function' ||
						! [ 'read', 'navigate' ].includes( action.effect ) ||
						( action.emphasis !== undefined && ! [ 'primary', 'secondary' ].includes( action.emphasis ) ) ||
						( action.allowed !== undefined && typeof action.allowed !== 'function' ) ||
						( action.ariaLabel !== undefined && ! boundedText( action.ariaLabel, 160 ) ) ) {
						continue;
					}
					names.add( action.id );
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
					this.entries.set( id, { messageId: context.messageId, turnId: context.summary.turnId, action, pending: null, status: '' } );
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
	private allowed( entry: Entry ): boolean {
		try {
			return ! this.disposed && this.active() && ( entry.action.allowed?.() ?? true );
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
			if ( ! entry || entry.messageId !== message.id ) {
				return [];
			}
			const available = this.allowed( entry );
			if ( ! available && ! entry.status ) {
				return [];
			}
			const { label, ariaLabel, icon, emphasis } = entry.action;
			return [ { id, label, ariaLabel, icon, emphasis: emphasis ?? 'secondary', pending: entry.pending !== null, available, status: entry.status } ];
		} );
	}

	/** Runs synchronously up to the caller's first await to preserve a user gesture. */
	public async run( messageId: string, id: string ): Promise<void> {
		this.prune();
		const entry = this.entries.get( id );
		if ( ! entry || entry.messageId !== messageId || entry.pending ) {
			return;
		}
		if ( ! this.allowed( entry ) ) {
			entry.status = __( 'This action is no longer available.' ); this.notify(); return;
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
		} catch ( error ) {
			entry.status = error instanceof Error ? error.message.slice( 0, 500 ) : __( 'Could not complete this action. Try again.' );
			if ( controller.signal.aborted ) {
				entry.status = '';
			}
		} finally {
			entry.pending = null; this.notify();
		}
	}
	public cancel(): void {
		for ( const entry of this.entries.values() ) {
			entry.pending?.abort();
		}
	}
	public dispose(): void {
		this.disposed = true; this.cancel(); this.entries.clear(); this.listeners.clear();
	}
}
