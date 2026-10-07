export const DEFAULT_UPDATE_TIMEOUT_MS = 60_000;

interface Job< T > {
	run: () => Promise< T >;
	resolve: ( value: T ) => void;
	reject: ( error: unknown ) => void;
	timeoutMs: number;
}

const queue: Array< Job< unknown > > = [];
let inFlight = false;

export function enqueueUpdateJob< T >(
	run: () => Promise< T >,
	timeoutMs = DEFAULT_UPDATE_TIMEOUT_MS,
): Promise< T > {
	return new Promise< T >( ( resolve, reject ) => {
		queue.push( {
			run: run as () => Promise< unknown >,
			resolve: resolve as ( v: unknown ) => void,
			reject,
			timeoutMs,
		} );
		void drain();
	} );
}

export function resetUpdateQueueForTest(): void {
	queue.length = 0;
	inFlight = false;
}

async function drain(): Promise< void > {
	if ( inFlight ) {
		return;
	}
	const job = queue.shift();
	if ( ! job ) {
		return;
	}
	inFlight = true;
	let timer: ReturnType< typeof setTimeout > | null = null;
	try {
		const timeoutPromise = new Promise< never >( ( _, reject ) => {
			timer = setTimeout( () => {
				reject( new Error( 'Update request timed out' ) );
			}, job.timeoutMs );
		} );
		const value = await Promise.race( [ job.run(), timeoutPromise ] );
		job.resolve( value );
	} catch ( err ) {
		job.reject( err );
	} finally {
		if ( timer !== null ) {
			clearTimeout( timer );
		}
		inFlight = false;

		void Promise.resolve().then( drain );
	}
}
