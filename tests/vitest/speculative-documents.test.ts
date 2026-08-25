/**
 * Speculative documents — the load-bearing parts.
 *
 * Three things here are the difference between the feature working and
 * quietly not working, and none of them are visible in a screenshot:
 *
 *   1. **The safety predicate.** Speculation fetches a URL before the
 *      user has clicked anything. If it ever accepted a URL that
 *      *acts*, a hover would activate a plugin or empty a trash.
 *   2. **The store's promise semantics.** Holding the settled response
 *      instead of the in-flight promise made a click landing mid-fetch
 *      issue a second request for the same screen — the "5 ms vs
 *      1,001 ms" split that burned the first implementation.
 *   3. **The shell-side throttle.** A permanent "already asked" set is
 *      the obvious de-duplication and silently disables the feature
 *      after first use, because the worker's copy is single-use and
 *      expires. Repeat visits to the same screen are exactly what the
 *      feature is for.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { isSpeculatableDocument } from '../../src/pwa/sw-policy';
import {
	SPECULATIVE_MAX,
	SPECULATIVE_TTL_MS,
	SpeculativeStore,
} from '../../src/pwa/speculative-store';
import {
	_resetSpeculation,
	rememberRestoreTargets,
	speculateDocument,
} from '../../src/pwa/speculate';

const CHROMELESS = '?openstation_chromeless=1';

describe( 'isSpeculatableDocument', () => {
	test( 'accepts a plain chromeless admin screen', () => {
		expect(
			isSpeculatableDocument(
				new URL( 'https://site.test/wp-admin/options-writing.php' + CHROMELESS ),
			),
		).toBe( true );
	} );

	test( 'requires the chromeless flag', () => {
		// Without it the server may not render the chromeless variant,
		// and serving the result to an iframe would be unsafe.
		expect(
			isSpeculatableDocument(
				new URL( 'https://site.test/wp-admin/options-writing.php' ),
			),
		).toBe( false );
	} );

	test( 'refuses anything outside wp-admin', () => {
		expect(
			isSpeculatableDocument( new URL( 'https://site.test/' + CHROMELESS ) ),
		).toBe( false );
	} );

	test( 'refuses every URL that acts', () => {
		// A hover must never activate a plugin, empty a trash, or apply
		// an update.
		const acting = [
			'action=activate&plugin=foo/foo.php',
			'action2=delete',
			'_wpnonce=abc123',
			'nonce=abc123',
			'delete_all=1',
		];
		for ( const query of acting ) {
			const url = new URL(
				`https://site.test/wp-admin/plugins.php${ CHROMELESS }&${ query }`,
			);
			expect(
				isSpeculatableDocument( url ),
				`${ query } must never be speculated`,
			).toBe( false );
		}
	} );
} );

describe( 'SpeculativeStore', () => {
	const res = ( tag: string ) =>
		Promise.resolve( new Response( tag ) as Response | null );

	test( 'holds the in-flight promise, not the settled response', async () => {
		const store = new SpeculativeStore();
		let settle: ( r: Response | null ) => void = () => undefined;
		const pending = new Promise< Response | null >( ( r ) => {
			settle = r;
		} );

		store.put( '/a', pending );
		// Claimed while still in flight — this is the case that used to
		// start a duplicate request.
		const taken = store.take( '/a' );
		expect( taken ).not.toBeNull();

		settle( new Response( 'late' ) );
		expect( await ( taken as Promise< Response | null > )?.then( ( r ) => r?.text() ) ).toBe(
			'late',
		);
	} );

	test( 'a document is served once and only once', async () => {
		const store = new SpeculativeStore();
		store.put( '/a', res( 'one' ) );

		expect( store.take( '/a' ) ).not.toBeNull();
		// A document carries nonces and a moment-in-time view; replaying
		// it would show a page that has already been superseded.
		expect( store.take( '/a' ) ).toBeNull();
	} );

	test( 'an expired document is refused and dropped', () => {
		let now = 1_000;
		const store = new SpeculativeStore( () => now );
		store.put( '/a', res( 'one' ) );

		now += SPECULATIVE_TTL_MS + 1;
		expect( store.take( '/a' ) ).toBeNull();
		expect( store.has( '/a' ) ).toBe( false );
	} );

	test( 'reports what it is already holding, so callers do not refetch', () => {
		const store = new SpeculativeStore();
		store.put( '/a', res( 'one' ) );
		expect( store.has( '/a' ) ).toBe( true );
		expect( store.has( '/b' ) ).toBe( false );
	} );

	test( 'evicts oldest-first past the cap', () => {
		let now = 1_000;
		const store = new SpeculativeStore( () => now );
		for ( let i = 0; i < SPECULATIVE_MAX + 2; i++ ) {
			now += 1;
			store.put( `/u${ i }`, res( String( i ) ) );
		}

		expect( store.size ).toBe( SPECULATIVE_MAX );
		expect( store.has( '/u0' ) ).toBe( false );
		expect( store.has( '/u1' ) ).toBe( false );
		expect( store.has( `/u${ SPECULATIVE_MAX + 1 }` ) ).toBe( true );
	} );

	test( 'prunes expired entries without being asked for them', () => {
		let now = 1_000;
		const store = new SpeculativeStore( () => now );
		store.put( '/old', res( 'old' ) );
		now += SPECULATIVE_TTL_MS + 1;
		store.put( '/new', res( 'new' ) );

		expect( store.has( '/old' ) ).toBe( false );
		expect( store.has( '/new' ) ).toBe( true );
	} );
} );

describe( 'speculateDocument', () => {
	let posted: Array< Record< string, unknown > >;

	beforeEach( () => {
		posted = [];
		_resetSpeculation();
		Object.defineProperty( navigator, 'serviceWorker', {
			value: {
				controller: {
					postMessage: ( m: Record< string, unknown > ) => posted.push( m ),
				},
			},
			configurable: true,
		} );
	} );

	afterEach( () => {
		delete ( navigator as unknown as { serviceWorker?: unknown } )
			.serviceWorker;
		vi.useRealTimers();
	} );

	test( 'asks the worker for a same-origin document', () => {
		speculateDocument( '/wp-admin/options-writing.php' + CHROMELESS );

		expect( posted ).toHaveLength( 1 );
		expect( posted[ 0 ].type ).toBe( 'os-speculate-doc' );
		expect( String( posted[ 0 ].url ) ).toContain( 'options-writing.php' );
	} );

	test( 'throttles a burst over one tab, then lets a later visit through', () => {
		vi.useFakeTimers();
		vi.setSystemTime( new Date( 2_000_000 ) );
		const url = '/wp-admin/options-writing.php' + CHROMELESS;

		// A pointer crossing a tab's icon and label fires repeatedly.
		speculateDocument( url );
		speculateDocument( url );
		speculateDocument( url );
		expect( posted ).toHaveLength( 1 );

		// The worker's copy is single-use and expires, so a genuine
		// return visit must be able to ask again. A permanent "seen"
		// set would silently make every repeat visit a no-op.
		vi.advanceTimersByTime( 5_000 );
		speculateDocument( url );
		expect( posted ).toHaveLength( 2 );
	} );

	test( 'never asks about another origin', () => {
		speculateDocument( 'https://evil.test/wp-admin/index.php' + CHROMELESS );
		expect( posted ).toHaveLength( 0 );
	} );

	test( 'is a silent no-op with no controlling worker', () => {
		Object.defineProperty( navigator, 'serviceWorker', {
			value: { controller: null },
			configurable: true,
		} );
		expect( () =>
			speculateDocument( '/wp-admin/index.php' + CHROMELESS ),
		).not.toThrow();
		expect( posted ).toHaveLength( 0 );
	} );
} );

describe( 'rememberRestoreTargets', () => {
	let posted: Array< Record< string, unknown > >;

	beforeEach( () => {
		posted = [];
		Object.defineProperty( navigator, 'serviceWorker', {
			value: {
				controller: {
					postMessage: ( m: Record< string, unknown > ) => posted.push( m ),
				},
			},
			configurable: true,
		} );
	} );

	afterEach( () => {
		delete ( navigator as unknown as { serviceWorker?: unknown } )
			.serviceWorker;
	} );

	test( 'sends nothing at all when the opt-in is off', async () => {
		// "Off by default" has to mean a user who never touched the
		// setting does not pay so much as a postMessage. The gate lives
		// in the session saver, so exercise it the way the saver does.
		const { createSessionSaver } = await import(
			'../../src/boot/session-saver'
		);
		const { installHooksStub, clearHooksStub } = await import(
			'./helpers/hooks-stub'
		);
		installHooksStub();
		const wp = ( window as unknown as { wp?: Record< string, unknown > } )
			.wp as Record< string, unknown >;
		// Merge rather than replace — the saver's error path needs the
		// hooks stub installed above to still be reachable.
		wp.os = {
			getOsSettings: () => ( { windowPrewarmEnabled: false } ),
			// The saver persists through `wp.os.fetch`; stub it so this
			// test exercises the gate, not the network.
			fetch: async () => new Response( '{}' ),
		};
		const manager = {
			snapshot: () => ( {
				windows: [ { id: 'a', url: '/wp-admin/index.php', native: false } ],
				desktops: [],
				activeDesktop: '',
				focused: '',
				updated: 0,
			} ),
		};
		const save = createSessionSaver(
			manager as never,
			{ sessionUrl: '/x', restNonce: 'n' } as never,
		);
		save();
		await new Promise( ( r ) => setTimeout( r, 800 ) );

		expect( posted.filter( ( m ) => m.type === 'os-remember-session' ) )
			.toHaveLength( 0 );
		clearHooksStub();
		delete ( wp as { os?: unknown } ).os;
	} );

	test( 'sends the restore list absolute, dropping foreign origins', () => {
		rememberRestoreTargets( [
			'/wp-admin/index.php' + CHROMELESS,
			'https://evil.test/wp-admin/index.php' + CHROMELESS,
			'/wp-admin/options-general.php' + CHROMELESS,
		] );

		expect( posted ).toHaveLength( 1 );
		expect( posted[ 0 ].type ).toBe( 'os-remember-session' );
		const urls = posted[ 0 ].urls as string[];
		expect( urls ).toHaveLength( 2 );
		expect( urls.every( ( u ) => u.startsWith( 'http://localhost' ) ) ).toBe(
			true,
		);
	} );
} );
