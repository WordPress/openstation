/**
 * Deferred Core command-palette runtime — the client replay.
 *
 * The server ships an ordered manifest
 * (`openStationConfig.commandPalette`); `ensureCommandPaletteAssets()`
 * replays it on the first palette invocation. What these tests pin:
 * strict dependency-order execution, the skip for handles another
 * plugin already delivered at boot (re-running `wp-data` would wipe
 * every registered store), inline-only aggregator handles running at
 * their slot, the single-flight memo (with retry after a failed
 * load), the ready event the shell harvester re-installs on, and the
 * graceful no-op on a site with no manifest at all.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as vendorLoader from '../../src/wallpapers/vendor-loader';
import {
	ensureCommandPaletteAssets,
	PALETTE_ASSETS_READY_EVENT,
	__resetCommandPaletteAssetsForTests,
} from '../../src/commands/palette-assets';

type ConfigCarrier = {
	openStationConfig?: {
		commandPalette?: {
			scripts: Array< {
				handle: string;
				url: string;
				before?: string[];
				after?: string[];
				l10n?: string[];
				translations?: string;
			} >;
			styles: Array< { handle: string; url: string; inline?: string[] } >;
		} | null;
	};
};

function setManifest(
	manifest: NonNullable<
		NonNullable< ConfigCarrier[ 'openStationConfig' ] >[ 'commandPalette' ]
	> | null,
): void {
	( window as unknown as ConfigCarrier ).openStationConfig = {
		commandPalette: manifest,
	};
}

describe( 'ensureCommandPaletteAssets', () => {
	let loaded: string[];
	let inline: string[];

	beforeEach( () => {
		__resetCommandPaletteAssetsForTests();
		loaded = [];
		inline = [];
		vi.spyOn( vendorLoader, 'loadVendorScript' ).mockImplementation(
			async ( url: string ) => {
				loaded.push( url );
			},
		);
		vi.spyOn( vendorLoader, 'injectInlineScript' ).mockImplementation(
			( code: string ) => {
				inline.push( code );
			},
		);
		vi.spyOn( vendorLoader, 'findScriptByPath' ).mockReturnValue( null );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
		delete ( window as unknown as ConfigCarrier ).openStationConfig;
		document.head
			.querySelectorAll( '[data-os-palette-style], link[rel="preload"]' )
			.forEach( ( el ) => el.remove() );
	} );

	test( 'replays the manifest in order and fires the ready event', async () => {
		const ready = vi.fn();
		document.addEventListener( PALETTE_ASSETS_READY_EVENT, ready, {
			once: true,
		} );
		setManifest( {
			scripts: [
				{ handle: 'wp-data', url: 'https://example.test/data.js' },
				{ handle: 'wp-commands', url: 'https://example.test/commands.js' },
			],
			styles: [
				{ handle: 'wp-commands', url: 'https://example.test/commands.css' },
			],
		} );

		await expect( ensureCommandPaletteAssets() ).resolves.toBe( true );

		expect( loaded ).toEqual( [
			'https://example.test/data.js',
			'https://example.test/commands.js',
		] );
		expect( ready ).toHaveBeenCalledTimes( 1 );
		expect(
			document.head.querySelector(
				'link[rel="stylesheet"][data-os-palette-style="wp-commands"]',
			),
		).not.toBeNull();
	} );

	test( 'skips handles another plugin already put on the page', async () => {
		vi.mocked( vendorLoader.findScriptByPath ).mockImplementation(
			( url: string ) =>
				url.includes( 'data.js' )
					? ( {} as HTMLScriptElement )
					: null,
		);
		setManifest( {
			scripts: [
				{ handle: 'wp-data', url: 'https://example.test/data.js' },
				{ handle: 'wp-commands', url: 'https://example.test/commands.js' },
			],
			styles: [],
		} );

		await ensureCommandPaletteAssets();

		expect( loaded ).toEqual( [ 'https://example.test/commands.js' ] );
	} );

	test( 'src-less aggregator handles run their inline data at their slot', async () => {
		const order: string[] = [];
		vi.mocked( vendorLoader.loadVendorScript ).mockImplementation(
			async ( url: string ) => {
				order.push( `src:${ url }` );
			},
		);
		vi.mocked( vendorLoader.injectInlineScript ).mockImplementation(
			( code: string ) => {
				order.push( `inline:${ code }` );
			},
		);
		setManifest( {
			scripts: [
				{ handle: 'wp-a', url: 'https://example.test/a.js' },
				{ handle: 'wp-agg', url: '', after: [ 'window.agg=1;' ] },
				{ handle: 'wp-b', url: 'https://example.test/b.js' },
			],
			styles: [],
		} );

		await ensureCommandPaletteAssets();

		expect( order ).toEqual( [
			'src:https://example.test/a.js',
			'inline:window.agg=1;',
			'src:https://example.test/b.js',
		] );
	} );

	test( 'single flight — repeat calls share one replay', async () => {
		setManifest( {
			scripts: [ { handle: 'wp-a', url: 'https://example.test/a.js' } ],
			styles: [],
		} );

		await Promise.all( [
			ensureCommandPaletteAssets(),
			ensureCommandPaletteAssets(),
		] );
		await ensureCommandPaletteAssets();

		expect( loaded ).toEqual( [ 'https://example.test/a.js' ] );
	} );

	test( 'a failed load clears the memo so the next open retries', async () => {
		vi.mocked( vendorLoader.loadVendorScript ).mockRejectedValueOnce(
			new Error( 'offline' ),
		);
		setManifest( {
			scripts: [ { handle: 'wp-a', url: 'https://example.test/a.js' } ],
			styles: [],
		} );

		await expect( ensureCommandPaletteAssets() ).rejects.toThrow( 'offline' );
		await expect( ensureCommandPaletteAssets() ).resolves.toBe( true );
		expect( loaded ).toEqual( [ 'https://example.test/a.js' ] );
	} );

	test( 'no manifest is a graceful no-op', async () => {
		setManifest( null );

		await expect( ensureCommandPaletteAssets() ).resolves.toBe( false );
		expect( loaded ).toEqual( [] );
	} );

	test( 'a handle listed twice executes once', async () => {
		// The manifest is assembled from two passes — Core's chain,
		// then the plugin contributors the shell hoists onto it — and
		// they overlap by construction, since every contributor
		// depends on `wp-commands`. Re-executing a handle is not
		// harmless: running `wp-data` twice wipes every store
		// registered against the first copy.
		setManifest( {
			scripts: [
				{ handle: 'wp-data', url: 'https://example.test/data.js' },
				{ handle: 'wp-commands', url: 'https://example.test/commands.js' },
				{ handle: 'wp-data', url: 'https://example.test/data.js' },
			],
			styles: [],
		} );

		await ensureCommandPaletteAssets();

		expect( loaded ).toEqual( [
			'https://example.test/data.js',
			'https://example.test/commands.js',
		] );
	} );

	test( 'de-duplication preserves the first occurrence, so order still holds', async () => {
		setManifest( {
			scripts: [
				{ handle: 'wp-a', url: 'https://example.test/a.js' },
				{ handle: 'wp-b', url: 'https://example.test/b.js' },
				{ handle: 'wp-a', url: 'https://example.test/a.js' },
				{ handle: 'wp-c', url: 'https://example.test/c.js' },
			],
			styles: [],
		} );

		await ensureCommandPaletteAssets();

		expect( loaded ).toEqual( [
			'https://example.test/a.js',
			'https://example.test/b.js',
			'https://example.test/c.js',
		] );
	} );
} );
