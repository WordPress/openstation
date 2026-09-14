/** A bounded, cancellable tool loop. Only this window's live allowlist can run. */
import { mioHelpAbilities, searchMioHelp } from './help';
import type { MioChatMessage, MioConversationStore, MioTransport, MioWindowContext } from './types';

export function memoryMioConversation(): MioConversationStore {
	let messages: MioChatMessage[] = [];
	return {
		read: () => messages.map( ( message ) => ( { ...message } ) ),
		write: ( next ) => {
			messages = next.slice( -40 ).map( ( message ) => ( { ...message } ) );
		},
		clear: () => {
			messages = [];
		},
	};
}

export class MioSession {
	private pending: AbortController | null = null;
	private thinkingListeners = new Set<( thinking: boolean ) => void>();

	public subscribeThinking( listener: ( thinking: boolean ) => void ): () => void {
		this.thinkingListeners.add( listener );
		listener( this.pending !== null );
		return () => {
			this.thinkingListeners.delete( listener );
		};
	}

	private notifyThinking(): void {
		for ( const listener of this.thinkingListeners ) {
			listener( this.pending !== null );
		}
	}
	public constructor(
		private context: MioWindowContext,
		private transport: MioTransport,
		private active: () => boolean,
		public readonly conversation = memoryMioConversation(),
	) {
		this.conversation = conversation;
	}

	public cancel(): void {
		this.pending?.abort();
		this.pending = null;
		this.notifyThinking();
	}

	public dispose(): void {
		this.cancel();
		this.conversation.clear();
		this.thinkingListeners.clear();
	}

	public async ask( query: string ): Promise<string> {
		if ( this.pending ) {
			throw new Error( 'MIO is already answering.' );
		}
		if ( ! query.trim() || query.length > 4000 ) {
			throw new Error( 'Write a message of 1–4000 characters.' );
		}
		const controller = new AbortController();
		this.pending = controller;
		this.notifyThinking();
		const { signal } = controller;
		const guard = (): void => {
			if ( signal.aborted || ! this.active() ) {
				throw new DOMException( 'The window context changed.', 'AbortError' );
			}
		};
		const messages = [ ...this.conversation.read(), { role: 'user' as const, text: query } ];
		this.conversation.write( messages );
		const outcomes: unknown[] = [];
		const completed = new Set<string>();
		const abilities = () =>
			[ ...mioHelpAbilities( this.context.documents ), ...this.context.abilities() ].filter(
				( ability ) => ! ability.allowed || ability.allowed(),
			);
		try {
			for ( let round = 0; round < 8; round++ ) {
				guard();
				const offered = abilities();
				if ( new Set( offered.map( ( a ) => a.name ) ).size !== offered.length ) {
					throw new Error( 'MIO ability names must be unique within a window.' );
				}
				const prompt = await this.context.prompt();
				guard();
				const turn = await this.transport(
					{
						prompt,
						transcript: JSON.stringify( {
							messages: messages.slice( -20 ),
							help: searchMioHelp( this.context.documents, query ),
							outcomes,
						} ),
						tools: offered.map( ( { name, description, parameters } ) => ( {
							name,
							description,
							parameters,
						} ) ),
					},
					signal,
				);
				guard();
				if ( ! Array.isArray( turn.calls ) || turn.calls.length > 16 ) {
					throw new Error( 'Invalid MIO tool response.' );
				}
				if ( turn.calls.length === 0 ) {
					if ( typeof turn.message !== 'string' || ! turn.message.trim() ) {
						throw new Error( 'MIO returned no answer.' );
					}
					this.conversation.write( [
						...messages,
						{ role: 'assistant', text: turn.message },
					] );
					return turn.message;
				}
				for ( const call of turn.calls ) {
					guard();
					const ability = abilities().find( ( a ) => a.name === call.name );
					if ( ! ability || ! offered.some( ( a ) => a.name === call.name ) ) {
						throw new Error( 'MIO requested an unavailable action.' );
					}
					const args: unknown = JSON.parse( call.arguments );
					if (
						! args ||
						typeof args !== 'object' ||
						Array.isArray( args ) ||
						! ability.validate( args as Record<string, unknown> )
					) {
						throw new Error( `Invalid arguments for ${ call.name }.` );
					}
					if ( completed.size >= 16 ) {
						throw new Error( 'MIO reached its action limit. Review the changes before continuing.' );
					}
					const key = JSON.stringify( [ call.name, args ] );
					if ( completed.has( key ) ) {
						throw new Error( 'MIO repeated an action; stopped to avoid a loop.' );
					}
					completed.add( key );
					guard();
					const result = await ability.run( args as Record<string, unknown>, signal );
					guard();
					// Freeze historical evidence: a read tool may return a live store object.
					outcomes.push( JSON.parse( JSON.stringify( { name: call.name, args, result } ) ) );
				}
			}
			throw new Error( 'MIO reached its action limit. Review the changes before continuing.' );
		} catch ( error ) {
			if ( this.pending === controller ) {
				const failure = error instanceof Error ? error.message : String( error );
				const detail = signal.aborted
					? 'Stopped; any already-submitted save may still complete.'
					: failure;
				this.conversation.write( [
					...messages,
					{
						role: 'assistant',
						text: `${ detail }${ outcomes.length ? ` ${ outcomes.length } earlier actions completed; they were not rolled back.` : '' }`,
					},
				] );
			}
			throw error;
		} finally {
			if ( this.pending === controller ) {
				this.pending = null;
				this.notifyThinking();
			}
		}
	}
}
