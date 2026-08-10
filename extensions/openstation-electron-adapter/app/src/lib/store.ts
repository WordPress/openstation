/**
 * OpenStation Desktop — tiny JSON store.
 *
 * Holds the connected site URL, the generated host id, and per-window
 * geometry for freed windows. Deliberately not `electron-store`: one
 * file, a handful of call sites, no dependency worth the supply chain.
 *
 * The directory is injected rather than read from `app.getPath()`, so
 * the store is testable against a temp dir and `main.ts` stays the only
 * file that knows where Electron keeps user data.
 *
 * Writes are atomic (write to `.tmp`, rename) so a crash mid-write
 * cannot leave a truncated JSON the app then refuses to boot from. A
 * corrupt file is treated as "no state" rather than a fatal error — the
 * worst case is the user re-entering their site address, which is
 * strictly better than an app that will not start.
 */

import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { Bounds } from './protocol';

/** Shape of the persisted blob. */
export interface StoreState {
	siteUrl: string;
	hostId: string;
	shellBounds: Bounds | null;
	freedBounds: Record< string, Bounds >;
}

const DEFAULTS: StoreState = {
	siteUrl: '',
	hostId: '',
	shellBounds: null,
	freedBounds: {},
};

export class Store {
	private readonly file: string;
	private cache: StoreState | null = null;

	/**
	 * @param dir      Directory to keep the state file in.
	 * @param filename State file name.
	 */
	constructor( dir: string, filename = 'openstation-desktop.json' ) {
		this.file = join( dir, filename );
	}

	/** @return The whole persisted blob, defaults merged in. */
	private all(): StoreState {
		if ( this.cache ) {
			return this.cache;
		}
		let parsed: unknown = {};
		try {
			parsed = JSON.parse( readFileSync( this.file, 'utf8' ) );
		} catch {
			// Missing or corrupt — start from defaults. See the file
			// docblock: an unreadable preferences file must not be
			// the reason an app will not open.
			parsed = {};
		}
		this.cache = {
			...DEFAULTS,
			...( parsed && 'object' === typeof parsed ? ( parsed as Partial< StoreState > ) : {} ),
		};
		return this.cache;
	}

	/** Persist the in-memory blob. */
	private flush(): void {
		const tmp = `${ this.file }.tmp`;
		try {
			mkdirSync( dirname( this.file ), { recursive: true } );
			writeFileSync( tmp, JSON.stringify( this.all(), null, '\t' ), 'utf8' );
			renameSync( tmp, this.file );
		} catch ( err ) {
			// Losing preferences is annoying, not fatal. Surface it for
			// anyone running `npm start` and carry on.
			console.error( '[openstation-desktop] could not persist state:', err );
		}
	}

	/**
	 * @param key Top-level key.
	 * @return Stored value.
	 */
	get< K extends keyof StoreState >( key: K ): StoreState[ K ] {
		return this.all()[ key ];
	}

	/**
	 * @param key   Top-level key.
	 * @param value Value to persist.
	 */
	set< K extends keyof StoreState >( key: K, value: StoreState[ K ] ): void {
		this.all()[ key ] = value;
		this.flush();
	}

	/**
	 * Stable per-installation identifier, generated once and reused.
	 *
	 * Lets the site tell "the same Mac reconnecting" from "a second
	 * machine" without this app ever collecting anything identifying:
	 * it is random bytes, not a fingerprint.
	 *
	 * @return 32-char hex id.
	 */
	hostId(): string {
		let id = this.get( 'hostId' );
		if ( ! id ) {
			id = randomBytes( 16 ).toString( 'hex' );
			this.set( 'hostId', id );
		}
		return id;
	}

	/**
	 * Remembered bounds for a freed window, keyed by OpenStation window
	 * id so reopening "Posts" lands where the user last left it.
	 *
	 * @param windowId OpenStation window id.
	 * @return Bounds, or null when nothing usable is stored.
	 */
	freedBounds( windowId: string ): Bounds | null {
		const entry = ( this.get( 'freedBounds' ) || {} )[ windowId ];
		if (
			entry &&
			'number' === typeof entry.width &&
			'number' === typeof entry.height
		) {
			return entry;
		}
		return null;
	}

	/**
	 * @param windowId OpenStation window id.
	 * @param bounds   Bounds to remember.
	 */
	setFreedBounds( windowId: string, bounds: Bounds ): void {
		const all = { ...( this.get( 'freedBounds' ) || {} ) };
		all[ windowId ] = bounds;
		this.set( 'freedBounds', all );
	}
}
