/** A bounded, cancellable tool loop. Only this window's live allowlist can run. */
import { MioResponseActions } from './response-actions';
import { mioHelpAbilities, searchMioHelp } from './help';
import { assertMioRequestBudget } from './budget';
import { MIO_LIMITS, MioOperations, MioValidationError, observe, outcomeOf, failureSummary } from './operations';
import { parseMioArguments, mioArgumentKey, validationErrors } from './validation';
import type { MioCallContext, MioChatMessage, MioConversationStore, MioTransport, MioWindowContext, MioTurnContext, MioTurnSummary, MioHistoryEntry } from './types';

export function memoryMioConversation(): MioConversationStore {
	let messages: MioChatMessage[] = [];
	return {
		read: () => messages.map( ( message ) => ( { ...message, ...( message.actionIds ? { actionIds: [ ...message.actionIds ] } : {} ) } ) ),
		write: ( next ) => {
			messages = next.slice( -40 ).map( ( message ) => ( { ...message, ...( message.actionIds ? { actionIds: [ ...message.actionIds ] } : {} ) } ) );
		},
		clear: () => {
			messages = [];
		},
	};
}

export class MioSession {
	private disposed = false;
	private pending: AbortController | null = null;
	private abortTurn: ( () => void ) | null = null;
	private thinkingListeners = new Set<( thinking: boolean ) => void>();
	public readonly operations: MioOperations;
	public readonly responseActions: MioResponseActions;

	public constructor(
		private context: MioWindowContext,
		private transport: MioTransport,
		private active: () => boolean,
		public readonly conversation = memoryMioConversation(),
	) {
		this.operations = new MioOperations( context );
		this.responseActions = new MioResponseActions( context, () => ! this.disposed && active(), () => conversation.read() );
	}

	public subscribeThinking( listener: ( thinking: boolean ) => void ): () => void {
		this.thinkingListeners.add( listener ); listener( this.pending !== null );
		return () => {
			this.thinkingListeners.delete( listener );
		};
	}
	private notifyThinking(): void {
		for ( const listener of this.thinkingListeners ) {
			observe( listener, this.pending !== null );
		}
	}
	public cancel(): void {
		this.responseActions.cancel();
		this.pending?.abort(); this.abortTurn?.(); this.abortTurn = null;
		this.pending = null; this.notifyThinking();
	}
	public dispose(): void {
		this.disposed = true; this.responseActions.dispose(); this.cancel(); this.conversation.clear(); this.thinkingListeners.clear();
	}

	public async ask( query: string ): Promise<string> {
		if ( this.disposed ) {
			throw new Error( 'This MIO window session is disposed.' );
		}
		if ( this.pending ) {
			throw new Error( 'MIO is already answering.' );
		}
		if ( ! query.trim() || query.length > 4000 ) {
			throw new Error( 'Write a message of 1–4000 characters.' );
		}
		const controller = new AbortController();
		const { signal } = controller;
		const turnId = crypto.randomUUID();
		let calls = 0; let rejected = 0; let reads = 0; let aborted = false;
		let revision: string | undefined;
		let status: MioTurnSummary['status'] = 'failed';
		let running: { context: MioCallContext; name: string } | null = null;
		const turnContext = (): MioTurnContext => ( {
			turnId, windowId: this.context.windowId, revision, signal,
			limits: MIO_LIMITS, validationFailures: rejected, validationRemaining: Math.max( 0, MIO_LIMITS.validationFailures - rejected ),
		} );
		const summary = (): MioTurnSummary => {
			const operations = this.operations.list().filter( ( entry ) => entry.turnId === turnId );
			return { ...turnContext(), status, reads, rejected, calls,
				confirmedWrites: operations.filter( ( entry ) => entry.status === 'confirmed' ).length,
				unknownWrites: operations.filter( ( entry ) => entry.effect === 'write' && ( entry.status === 'unknown' || entry.status === 'running' ) ).length };
		};
		const abort = (): void => {
			if ( aborted ) {
				return;
			} aborted = true; status = 'aborted';
			if ( running?.context.effect === 'write' ) {
				this.operations.record( running.context, running.name, 'unknown' );
			}
			observe( this.context.onTurnAbort, turnContext() );
		};
		const guard = (): void => {
			if ( signal.aborted || ! this.active() ) {
				controller.abort(); abort(); throw new DOMException( 'The window context changed.', 'AbortError' );
			}
		};
		this.pending = controller; this.abortTurn = abort; this.notifyThinking();
		const messages = [ ...this.conversation.read().slice( -39 ), { role: 'user' as const, text: query, id: crypto.randomUUID() } ];
		this.conversation.write( messages ); this.responseActions.prune();
		const finish = ( text: string ): void => {
			const message: MioChatMessage = { role: 'assistant', text, id: crypto.randomUUID() };
			const actionIds = this.responseActions.create( Object.freeze( {
				messageId: message.id!, summary: Object.freeze( summary() ),
				operations: Object.freeze( this.operations.list().filter( ( entry ) => entry.turnId === turnId ).map( ( entry ) => Object.freeze( entry ) ) ),
			} ) );
			if ( actionIds.length ) {
				message.actionIds = actionIds;
			}
			// The app callback can close this window synchronously.
			if ( this.disposed || this.pending !== controller ) {
				this.responseActions.prune(); return;
			}
			this.conversation.write( [ ...messages, message ].slice( -40 ) );
			this.responseActions.prune();
		};
		const outcomes: unknown[] = [];
		const attemptedWrites = new Set<string>();
		const repeats = new Map<string, number>();
		const abilities = () => [ ...mioHelpAbilities( this.context.documents ), ...this.context.abilities() ].filter( ( ability ) => ! ability.allowed || ability.allowed() );
		const reject = ( error: MioValidationError, call: MioCallContext, name: string, data?: unknown ): void => {
			rejected++;
			this.operations.record( call, name, 'rejected' );
			const errors = validationErrors( error.errors );
			outcomes.push( JSON.parse( JSON.stringify( { name, callId: call.callId, effect: 'none', status: 'rejected', result: { effect: 'none', status: 'rejected', errors, data, retryable: error.retryable, validationRemaining: Math.max( 0, MIO_LIMITS.validationFailures - rejected ) } } ) ) );
			if ( ! error.retryable ) {
				throw new Error( `MIO validation is terminal: ${ error.message }` );
			}
			if ( rejected >= MIO_LIMITS.validationFailures ) {
				throw new Error( 'MIO validation retry budget exhausted; no further candidates will run in this turn.' );
			}
		};
		try {
			guard(); revision = this.context.revision?.(); observe( this.context.onTurnBegin, turnContext() );
			for ( let round = 0; round < MIO_LIMITS.rounds; round++ ) {
				guard();
				const offered = abilities();
				if ( new Set( offered.map( ( a ) => a.name ) ).size !== offered.length ) {
					throw new Error( 'MIO ability names must be unique within a window.' );
				}
				revision = this.context.revision?.();
				const prompt = await this.context.prompt(); guard();
				const history = { messages: messages.slice( -20 ).map( ( { role, text } ) => ( { role, text } ) ), help: searchMioHelp( this.context.documents, query ), outcomes };
				const request = { prompt, transcript: JSON.stringify( this.context.compactHistory ? this.context.compactHistory( structuredClone( history ), turnContext() ) : history ), tools: offered.map( ( { name, description, parameters, effect } ) => ( { name, description: `[Effect: ${ effect ?? 'write' }] ${ description }`, parameters } ) ) };
				assertMioRequestBudget( request ); guard();
				const turn = await this.transport( request, signal ); guard();
				if ( ! Array.isArray( turn.calls ) || turn.calls.length > MIO_LIMITS.calls ) {
					throw new Error( 'Invalid MIO tool response.' );
				}
				if ( ! turn.calls.length ) {
					if ( typeof turn.message !== 'string' || ! turn.message.trim() ) {
						throw new Error( 'MIO returned no answer.' );
					}
					status = 'completed'; finish( turn.message ); return turn.message;
				}
				for ( const call of turn.calls ) {
					guard();
					if ( calls >= MIO_LIMITS.calls ) {
						throw new Error( 'MIO reached its action limit. Review the changes before continuing.' );
					}
					calls++;
					const ability = abilities().find( ( a ) => a.name === call.name );
					if ( ! ability || ! offered.some( ( a ) => a.name === call.name ) ) {
						throw new Error( 'MIO requested an unavailable action.' );
					}
					revision = this.context.revision?.();
					const callId = `${ turnId }:${ calls }`;
					const context: MioCallContext = { ...turnContext(), callId, idempotencyKey: callId, effect: ability.effect ?? 'write' };
					let args: Record<string, unknown>;
					try {
						args = parseMioArguments( call.arguments, ability, context );
					} catch ( error ) {
						if ( error instanceof MioValidationError ) {
							reject( error, context, call.name ); break;
						}
						throw error;
					}
					const key = mioArgumentKey( [ call.name, args ] );
					if ( context.effect === 'write' && attemptedWrites.has( key ) ) {
						throw new Error( 'MIO repeated an action; stopped to avoid replaying a write.' );
					}
					if ( context.effect !== 'write' ) {
						const count = ( repeats.get( key ) ?? 0 ) + 1; repeats.set( key, count );
						if ( count > MIO_LIMITS.repeatedReads ) {
							throw new Error( 'MIO repeated-read budget exhausted.' );
						}
					}
					guard();
					if ( ability.allowed && ! ability.allowed() ) {
						throw new Error( 'MIO requested an unavailable action.' );
					}
					if ( context.effect === 'write' ) {
						attemptedWrites.add( key );
					}
					running = { context, name: call.name }; this.operations.record( context, call.name, 'running' );
					// Observers can synchronously close the window or revoke its permission.
					try {
						guard();
						if ( ability.allowed && ! ability.allowed() ) {
							throw new Error( 'MIO requested an unavailable action.' );
						}
					} catch ( error ) {
						running = null;
						this.operations.record( context, call.name, 'rejected' );
						throw error;
					}
					let result: unknown;
					try {
						result = await ability.run( args, signal, context );
					} catch ( error ) {
						this.operations.record( context, call.name, context.effect === 'write' ? 'unknown' : 'rejected' ); running = null;
						// A run exception never proves that no write was submitted.
						throw error;
					}
					const outcome = outcomeOf( result );
					if ( outcome?.effect === 'none' && outcome.status === 'rejected' ) {
						this.operations.record( context, call.name, 'rejected' );
						running = null;
						// An explicit no-effect result is not a completed write.
						attemptedWrites.delete( key ); guard();
						const feedback = ability.history ? ability.history( { name: call.name, callId, args, result: outcome }, context ) : outcome.data;
						reject( new MioValidationError( outcome.errors, outcome.retryable ), context, call.name, feedback ); break;
					}
					if ( outcome?.effect === 'none' && outcome.status === 'completed' ) {
						this.operations.record( context, call.name, 'completed' ); running = null;
					} else if ( context.effect === 'write' ) {
						// saved:true is the existing explicit acknowledgement contract.
						const legacySaved = ! outcome && !! result && typeof result === 'object' && ( result as { saved?: unknown } ).saved === true;
						const receipt = outcome?.effect === 'write' && outcome.status === 'confirmed' ? outcome.receipt : undefined;
						this.operations.record( context, call.name, receipt || legacySaved ? 'confirmed' : 'unknown', receipt ?? ( legacySaved ? callId : undefined ) );
						running = null;
						if ( ! receipt && ! legacySaved ) {
							throw new Error( 'MIO write outcome is unknown; inspect its status before making another change.' );
						}
					} else {
						this.operations.record( context, call.name, 'completed' ); if ( context.effect === 'read' ) {
							reads++;
						} running = null;
					}
					guard();
					const entry: MioHistoryEntry = { name: call.name, callId, args, result };
					// Default history omits input documents; the result is the evidence.
					const compact = ability.history ? ability.history( entry, context ) : { result };
					const operation = this.operations.list().find( ( item ) => item.callId === callId );
					outcomes.push( JSON.parse( JSON.stringify( { ...compact, name: call.name, callId, effect: outcome?.effect ?? context.effect, status: operation?.status, receipt: operation?.receipt } ) ) );
				}
			}
			throw new Error( 'MIO reached its action limit. Review the changes before continuing.' );
		} catch ( error ) {
			if ( this.pending === controller ) {
				const detail = error instanceof Error ? error.message : String( error );
				finish( `${ detail } ${ failureSummary( summary() ) }` );
			}
			throw error;
		} finally {
			observe( this.context.onTurnEnd, summary() );
			if ( this.pending === controller ) {
				this.pending = null; this.abortTurn = null; this.notifyThinking();
			}
		}
	}
}
