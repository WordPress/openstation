/**
 * OpenStation — the speculative document store.
 *
 * Split out of `sw.ts` so it can be tested directly: the worker file
 * reaches for `self`, `fetch` and `caches` at module scope, which a
 * unit test cannot host, while everything that actually decides
 * behaviour here is a Map, a clock and a few rules.
 *
 * Three of those rules are load-bearing, and each exists because
 * getting it wrong is invisible until it is expensive:
 *
 *   - **Entries hold a promise, not a settled response.** A navigation
 *     that lands mid-fetch must join the request already running. The
 *     first implementation stored only finished responses, so a click
 *     arriving early found nothing and issued a *second* request for
 *     the same screen — full price for the user, double load for the
 *     server. Measured at the time: 5 ms when the fetch had landed,
 *     1,001 ms when it had not.
 *   - **Taking is single-use.** A document carries nonces and a
 *     moment-in-time view of a screen; replaying it twice would show
 *     someone a page that has already been superseded.
 *   - **Entries expire.** Same reason, bounded by wall-clock instead
 *     of by use.
 */

/** How long a fetched document may sit before it is stale. */
export const SPECULATIVE_TTL_MS = 30_000;

/** Cap on held documents — the shell only ever asks for a handful. */
export const SPECULATIVE_MAX = 6;

interface Entry {
	at: number;
	res: Promise< Response | null >;
}

/**
 * A bounded, expiring, single-use store of in-flight documents.
 *
 * `now` is injected so tests can move the clock without waiting.
 */
export class SpeculativeStore {
	private entries = new Map< string, Entry >();

	private now: () => number;

	constructor( now: () => number = () => Date.now() ) {
		this.now = now;
	}

	/** Whether a document for this exact URL is already on its way. */
	public has( url: string ): boolean {
		return this.entries.has( url );
	}

	public get size(): number {
		return this.entries.size;
	}

	/**
	 * Record an in-flight fetch. Registering before it resolves is the
	 * whole point — see the class docblock.
	 */
	public put( url: string, res: Promise< Response | null > ): void {
		this.entries.set( url, { at: this.now(), res } );
		this.prune();
	}

	/**
	 * Claim the document waiting for this URL, if any.
	 *
	 * Removes the entry whether or not it turned out to be fresh: a
	 * stale entry has no second chance either.
	 */
	public take( url: string ): Promise< Response | null > | null {
		const entry = this.entries.get( url );
		if ( ! entry ) {
			return null;
		}
		this.entries.delete( url );
		if ( this.now() - entry.at > SPECULATIVE_TTL_MS ) {
			return null;
		}
		return entry.res;
	}

	/** Drop expired entries, then the oldest until back under the cap. */
	public prune(): void {
		const now = this.now();
		for ( const [ url, entry ] of this.entries ) {
			if ( now - entry.at > SPECULATIVE_TTL_MS ) {
				this.entries.delete( url );
			}
		}
		while ( this.entries.size > SPECULATIVE_MAX ) {
			const oldest = this.entries.keys().next().value;
			if ( oldest === undefined ) {
				break;
			}
			this.entries.delete( oldest );
		}
	}

	/**
	 * Drop everything, now.
	 *
	 * For a session boundary rather than housekeeping: held entries are
	 * fully rendered admin pages belonging to whoever was signed in, and
	 * they must not outlive that session by even the normal TTL.
	 */
	public clear(): void {
		this.entries.clear();
	}
}
