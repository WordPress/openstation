import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { Bounds } from './protocol';

export interface StoreState {
	siteUrl: string;
	hostId: string;

	openIn: '' | 'app' | 'browser';
	shellBounds: Bounds | null;
	freedBounds: Record< string, Bounds >;
}

const DEFAULTS: StoreState = {
	siteUrl: '',
	hostId: '',
	openIn: '',
	shellBounds: null,
	freedBounds: {},
};

export class Store {
	private readonly file: string;
	private cache: StoreState | null = null;

	private sessionToken = '';

	constructor( dir: string, filename = 'openstation-desktop.json' ) {
		this.file = join( dir, filename );
	}

	private all(): StoreState {
		if ( this.cache ) {
			return this.cache;
		}
		let parsed: unknown = {};
		try {
			parsed = JSON.parse( readFileSync( this.file, 'utf8' ) );
		} catch {

			parsed = {};
		}
		this.cache = {
			...DEFAULTS,
			...( parsed && 'object' === typeof parsed ? ( parsed as Partial< StoreState > ) : {} ),
		};
		return this.cache;
	}

	private flush(): void {
		const tmp = `${ this.file }.tmp`;
		try {
			mkdirSync( dirname( this.file ), { recursive: true } );
			writeFileSync( tmp, JSON.stringify( this.all(), null, '\t' ), 'utf8' );
			renameSync( tmp, this.file );
		} catch ( err ) {

			console.error( '[openstation-desktop] could not persist state:', err );
		}
	}

	get< K extends keyof StoreState >( key: K ): StoreState[ K ] {
		return this.all()[ key ];
	}

	set< K extends keyof StoreState >( key: K, value: StoreState[ K ] ): void {
		this.all()[ key ] = value;
		this.flush();
	}

	hostId(): string {
		let id = this.get( 'hostId' );
		if ( ! id ) {
			id = randomBytes( 16 ).toString( 'hex' );
			this.set( 'hostId', id );
		}
		return id;
	}

	agentToken(): string {
		if ( ! this.sessionToken ) {
			this.sessionToken = randomBytes( 32 ).toString( 'hex' );
		}
		return this.sessionToken;
	}

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

	setFreedBounds( windowId: string, bounds: Bounds ): void {
		const all = { ...( this.get( 'freedBounds' ) || {} ) };
		all[ windowId ] = bounds;
		this.set( 'freedBounds', all );
	}
}
