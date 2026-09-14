/** Per-turn execution identities and a bounded, content-free operation ledger. */
import type { MioCallContext, MioOperation, MioOperationOutcome, MioTurnSummary, MioWindowContext } from './types';

export const MIO_LIMITS = Object.freeze( { rounds: 8, calls: 16, validationFailures: 3, repeatedReads: 4 } );

export class MioValidationError extends Error {
	public constructor( public readonly errors: import( './types' ).MioArgumentError[], public readonly retryable = true ) {
		super( errors.map( ( error ) => `${ error.path }: ${ error.message }` ).join( '; ' ) );
		this.name = 'MioValidationError';
	}
}

/** Observer failures cannot replay or obscure an operation. */
export function observe<T>( callback: ( ( event: T ) => void ) | undefined, value: T ): void {
	try {
		callback?.( value );
	} catch { /* Application observers do not control execution. */ }
}

export function outcomeOf( value: unknown ): MioOperationOutcome | null {
	if ( ! value || typeof value !== 'object' ) {
		return null;
	}
	const outcome = value as MioOperationOutcome;
	if ( outcome.effect === 'none' && outcome.status === 'completed' ) {
		return outcome;
	}
	if ( outcome.effect === 'none' && outcome.status === 'rejected' && Array.isArray( outcome.errors ) ) {
		return outcome;
	}
	if ( outcome.effect === 'write' && outcome.status === 'confirmed' && typeof outcome.receipt === 'string' && outcome.receipt.length > 0 && outcome.receipt.length <= 500 ) {
		return outcome;
	}
	if ( outcome.effect === 'write' && outcome.status === 'unknown' ) {
		return outcome;
	}
	return null;
}

export class MioOperations {
	private records = new Map<string, MioOperation>();
	private inspectors = new Map<string, NonNullable<MioWindowContext['operationStatus']>>();
	private receipts = new Map<string, string>();
	private context: MioWindowContext;
	public constructor( context: MioWindowContext ) {
		this.context = context;
	}

	public list(): MioOperation[] {
		return Array.from( this.records.values(), ( entry ) => structuredClone( entry ) );
	}

	public record( call: MioCallContext, ability: string, status: MioOperation['status'], receipt?: string ): MioOperation {
		const existing = this.records.get( call.callId );
		// A late abort or network error cannot erase an authoritative receipt.
		if ( existing?.status === 'confirmed' && status !== 'confirmed' ) {
			return structuredClone( existing );
		}
		if ( existing?.receipt && receipt && existing.receipt !== receipt ) {
			throw new Error( 'MIO operation receipt changed unexpectedly.' );
		}
		const duplicate = receipt && this.receipts.has( receipt ) && this.receipts.get( receipt ) !== call.callId;
		const entry: MioOperation = { turnId: call.turnId, callId: call.callId, idempotencyKey: call.idempotencyKey, windowId: call.windowId, revision: call.revision, ability, effect: call.effect, status: duplicate ? 'unknown' : status, ...( receipt ? { receipt } : {} ) };
		if ( receipt && ! duplicate ) {
			this.receipts.set( receipt, call.callId );
		}
		this.records.set( call.callId, entry );
		if ( this.context.operationStatus ) {
			this.inspectors.set( call.callId, this.context.operationStatus );
		}
		while ( this.records.size > 64 ) {
			const key = this.records.keys().next().value!;
			const old = this.records.get( key );
			if ( old?.receipt && this.receipts.get( old.receipt ) === key ) {
				this.receipts.delete( old.receipt );
			}
			this.records.delete( key ); this.inspectors.delete( key );
		}
		observe( this.context.onOperation, structuredClone( entry ) );
		if ( duplicate ) {
			throw new Error( 'MIO received a duplicate write receipt; inspect the operation status before continuing.' );
		}
		return structuredClone( entry );
	}

	/** Only calls the caller's read-only status resolver; never re-executes run. */
	public async inspect( callId: string, signal: AbortSignal ): Promise<MioOperation> {
		const entry = this.records.get( callId );
		const inspect = this.inspectors.get( callId );
		if ( ! entry ) {
			throw new Error( 'Unknown MIO operation.' );
		}
		if ( entry.effect !== 'write' || entry.status === 'confirmed' || ! inspect ) {
			return structuredClone( entry );
		}
		signal.throwIfAborted();
		const result = outcomeOf( await inspect( structuredClone( entry ), signal ) );
		signal.throwIfAborted();
		if ( result?.effect === 'write' && result.status === 'confirmed' ) {
			return this.record( { ...entry, signal, limits: MIO_LIMITS, validationFailures: 0, validationRemaining: 0 }, entry.ability, 'confirmed', result.receipt );
		}
		if ( result?.effect === 'none' && result.status === 'rejected' ) {
			return this.record( { ...entry, signal, limits: MIO_LIMITS, validationFailures: 0, validationRemaining: 0 }, entry.ability, 'rejected' );
		}
		return structuredClone( entry );
	}
}

export function failureSummary( summary: MioTurnSummary ): string {
	return `Reads: ${ summary.reads }; rejected candidates: ${ summary.rejected }; confirmed writes: ${ summary.confirmedWrites }; unknown write outcomes: ${ summary.unknownWrites }. Completed writes are not rolled back.`;
}
