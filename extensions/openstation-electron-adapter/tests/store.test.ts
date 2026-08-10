/**
 * The JSON state file.
 *
 * Small, but it is the thing standing between "the app remembers your
 * site" and "the app will not start". The corrupt-file case matters
 * more than the happy path.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { Store } from '../app/src/lib/store';

let dir: string;

beforeEach( () => {
	dir = mkdtempSync( join( tmpdir(), 'openstation-store-' ) );
} );

afterEach( () => {
	rmSync( dir, { recursive: true, force: true } );
} );

describe( 'persistence', () => {
	test( 'round-trips a value across instances', () => {
		new Store( dir ).set( 'siteUrl', 'https://example.test' );
		expect( new Store( dir ).get( 'siteUrl' ) ).toBe( 'https://example.test' );
	} );

	test( 'returns defaults for a store that has never been written', () => {
		const store = new Store( dir );
		expect( store.get( 'siteUrl' ) ).toBe( '' );
		expect( store.get( 'shellBounds' ) ).toBeNull();
		expect( store.get( 'freedBounds' ) ).toEqual( {} );
	} );

	test( 'treats a corrupt file as no state rather than failing to boot', () => {
		// The worst case has to be re-entering a site address, not an
		// app that will not open.
		writeFileSync( join( dir, 'openstation-desktop.json' ), '{ not json', 'utf8' );

		expect( new Store( dir ).get( 'siteUrl' ) ).toBe( '' );
	} );

	test( 'merges defaults over a partial file', () => {
		writeFileSync(
			join( dir, 'openstation-desktop.json' ),
			JSON.stringify( { siteUrl: 'https://example.test' } ),
			'utf8',
		);
		const store = new Store( dir );
		expect( store.get( 'siteUrl' ) ).toBe( 'https://example.test' );
		expect( store.get( 'freedBounds' ) ).toEqual( {} );
	} );
} );

describe( 'hostId', () => {
	test( 'generates once and reuses forever', () => {
		const store = new Store( dir );
		const first = store.hostId();

		expect( first ).toMatch( /^[0-9a-f]{32}$/ );
		expect( store.hostId() ).toBe( first );
		expect( new Store( dir ).hostId() ).toBe( first );
	} );

	test( 'differs between installations', () => {
		const other = mkdtempSync( join( tmpdir(), 'openstation-store-' ) );
		try {
			expect( new Store( dir ).hostId() ).not.toBe( new Store( other ).hostId() );
		} finally {
			rmSync( other, { recursive: true, force: true } );
		}
	} );
} );

describe( 'freed-window bounds', () => {
	test( 'remembers geometry per window id', () => {
		const store = new Store( dir );
		store.setFreedBounds( 'edit-php', { x: 1, y: 2, width: 800, height: 600 } );
		store.setFreedBounds( 'os-files', { x: 9, y: 9, width: 500, height: 400 } );

		expect( store.freedBounds( 'edit-php' ) ).toEqual( {
			x: 1,
			y: 2,
			width: 800,
			height: 600,
		} );
		expect( store.freedBounds( 'os-files' )?.width ).toBe( 500 );
	} );

	test( 'is null for a window never opened', () => {
		expect( new Store( dir ).freedBounds( 'nope' ) ).toBeNull();
	} );

	test( 'rejects a stored entry missing dimensions', () => {
		writeFileSync(
			join( dir, 'openstation-desktop.json' ),
			JSON.stringify( { freedBounds: { 'edit-php': { x: 1, y: 2 } } } ),
			'utf8',
		);
		expect( new Store( dir ).freedBounds( 'edit-php' ) ).toBeNull();
	} );
} );
