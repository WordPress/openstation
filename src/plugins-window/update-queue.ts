/**
 * Native Plugins window — single-flight update queue.
 *
 * Mirrors Core's `wp.updates.ajaxLocked` + `wp.updates.queue` semantics
 * (see `wp-admin/js/updates.js`): plugin updates MUST run one at a
 * time. The `update_plugins` site transient is a single mutable
 * snapshot — `Plugin_Upgrader` writes to it on completion, so two
 * concurrent updates can interleave and corrupt each other's view of
 * pending updates. Core enforces this with a global lock and a FIFO
 * queue; we do the same, scoped to this window.
 *
 * Exposed as a thin Promise wrapper: callers just `await
 * enqueueUpdateJob( () => updateInstalledPlugin( row ) )` and get the
 * result. Cancellation is intentionally NOT supported — once an
 * update is in flight the upgrader is past the point of safe abort.
 *
 * @public
 * @since 0.18.0
 */

interface Job< T > {
	run: () => Promise< T >;
	resolve: ( value: T ) => void;
	reject: ( error: unknown ) => void;
}

const queue: Array< Job< unknown > > = [];
let inFlight = false;

/**
 * Enqueue a plugin-update job. The returned Promise resolves /
 * rejects with the result of `run()` once every job ahead of it
 * has settled. Errors are isolated — one failed update does not
 * cancel queued jobs (matches Core's behavior; failed updates leave
 * a `notice-error` on the row and the queue drains the rest).
 */
export function enqueueUpdateJob< T >( run: () => Promise< T > ): Promise< T > {
	return new Promise< T >( ( resolve, reject ) => {
		queue.push( {
			run: run as () => Promise< unknown >,
			resolve: resolve as ( v: unknown ) => void,
			reject,
		} );
		void drain();
	} );
}

/** Number of jobs waiting (excludes the one currently running). */
export function pendingUpdateJobs(): number {
	return queue.length;
}

/** True while a job is mid-flight. */
export function isUpdateInFlight(): boolean {
	return inFlight;
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
	try {
		const value = await job.run();
		job.resolve( value );
	} catch ( err ) {
		job.reject( err );
	} finally {
		inFlight = false;
		// Yield to the microtask queue so the resolver's
		// `.then` handlers run before the next job begins —
		// keeps the "row finishes, next row spinner appears"
		// transition crisp in the UI.
		void Promise.resolve().then( drain );
	}
}
