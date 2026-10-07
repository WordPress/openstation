export const SPECULATIVE_TTL_MS = 30_000;

export const SPECULATIVE_MAX = 6;

interface Entry {
	at: number;
	res: Promise< Response | null >;
}

export class SpeculativeStore {
	private entries = new Map< string, Entry >();

	private now: () => number;

	constructor( now: () => number = () => Date.now() ) {
		this.now = now;
	}

	public has( url: string ): boolean {
		return this.entries.has( url );
	}

	public get size(): number {
		return this.entries.size;
	}

	public put( url: string, res: Promise< Response | null > ): void {
		this.entries.set( url, { at: this.now(), res } );
		this.prune();
	}

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

	public clear(): void {
		this.entries.clear();
	}
}
