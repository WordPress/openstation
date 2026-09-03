/**
 * Tests for the display half of `src/mode/` — `standalone` versus
 * `browser`.
 *
 * Pins:
 * - `resolveDisplay()` is the one rule: the display-mode query, else
 *   Safari's `navigator.standalone`, else `browser`;
 * - `installMode()` stamps `data-os-display` on the root at once,
 *   re-stamps when the query flips (an install while the tab is
 *   open), and exposes it as `getDisplay()` / `isStandalone()`;
 * - the leaf stamp helpers read what the head stamp wrote;
 * - `dispose()` lets go of the query.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { installMode, resolveDisplay, STANDALONE_QUERY } from '../../src/mode';
import {
	DISPLAY_ATTRIBUTE,
	isStandaloneStamped,
	readStampedDisplay,
	stampDisplay,
} from '../../src/mode/stamp';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

/** A `matchMedia` whose display-mode answer can be flipped from the test. */
function fakeMatchMedia( standalone: { value: boolean } ) {
	const listeners = new Set< ( e: MediaQueryListEvent ) => void >();
	let displayList: MediaQueryList | null = null;
	const matchMedia = ( query: string ): MediaQueryList => {
		const isDisplay = query === STANDALONE_QUERY;
		const mql = {
			media: query,
			get matches() {
				return isDisplay ? standalone.value : false;
			},
			onchange: null,
			addEventListener: ( _t: string, cb: ( e: MediaQueryListEvent ) => void ) => {
				if ( isDisplay ) {
					listeners.add( cb );
				}
			},
			removeEventListener: ( _t: string, cb: ( e: MediaQueryListEvent ) => void ) => {
				listeners.delete( cb );
			},
			dispatchEvent: () => true,
		} as unknown as MediaQueryList;
		if ( isDisplay ) {
			displayList = mql;
		}
		return mql;
	};
	return {
		matchMedia,
		flip( next: boolean ) {
			standalone.value = next;
			for ( const cb of listeners ) {
				cb( { matches: next, media: STANDALONE_QUERY } as MediaQueryListEvent );
			}
		},
		get listenerCount() {
			return listeners.size;
		},
		get displayList() {
			return displayList;
		},
	};
}

describe( 'resolveDisplay', () => {
	test( 'the display-mode query wins', () => {
		const fake = fakeMatchMedia( { value: true } );
		expect( resolveDisplay( { matchMedia: fake.matchMedia }, {} ) ).toBe( 'standalone' );
	} );

	test( "Safari's navigator.standalone is the fallback signal", () => {
		const fake = fakeMatchMedia( { value: false } );
		expect( resolveDisplay( { matchMedia: fake.matchMedia }, { standalone: true } ) ).toBe(
			'standalone',
		);
		expect( resolveDisplay( undefined, { standalone: true } ) ).toBe( 'standalone' );
	} );

	test( 'a tab is a browser', () => {
		const fake = fakeMatchMedia( { value: false } );
		expect( resolveDisplay( { matchMedia: fake.matchMedia }, { standalone: false } ) ).toBe(
			'browser',
		);
		expect( resolveDisplay( undefined, undefined ) ).toBe( 'browser' );
	} );
} );

describe( 'installMode — the display stamp', () => {
	let root: HTMLElement;

	beforeEach( () => {
		installHooksStub();
		root = document.createElement( 'div' );
	} );

	afterEach( () => {
		clearHooksStub();
	} );

	test( 'stamps the display at once and exposes it on the API', () => {
		const fake = fakeMatchMedia( { value: true } );
		const ctl = installMode( {
			root,
			win: { matchMedia: fake.matchMedia, innerWidth: 1200 },
			nav: {},
		} );
		expect( root.getAttribute( DISPLAY_ATTRIBUTE ) ).toBe( 'standalone' );
		expect( ctl.api.getDisplay() ).toBe( 'standalone' );
		expect( ctl.api.isStandalone() ).toBe( true );
		ctl.dispose();
	} );

	test( 'a tab is stamped browser, whatever the mode', () => {
		const fake = fakeMatchMedia( { value: false } );
		const ctl = installMode( {
			root,
			win: { matchMedia: fake.matchMedia, innerWidth: 390 },
			nav: {},
		} );
		expect( root.getAttribute( 'data-os-mode' ) ).toBe( 'mobile' );
		expect( root.getAttribute( DISPLAY_ATTRIBUTE ) ).toBe( 'browser' );
		expect( ctl.api.isStandalone() ).toBe( false );
		ctl.dispose();
	} );

	test( 're-stamps when the display-mode query flips', () => {
		const fake = fakeMatchMedia( { value: false } );
		const ctl = installMode( {
			root,
			win: { matchMedia: fake.matchMedia, innerWidth: 1200 },
			nav: {},
		} );
		expect( ctl.api.getDisplay() ).toBe( 'browser' );
		fake.flip( true );
		expect( root.getAttribute( DISPLAY_ATTRIBUTE ) ).toBe( 'standalone' );
		expect( ctl.api.getDisplay() ).toBe( 'standalone' );
		ctl.dispose();
	} );

	test( 'dispose lets go of the query', () => {
		const fake = fakeMatchMedia( { value: false } );
		const ctl = installMode( {
			root,
			win: { matchMedia: fake.matchMedia, innerWidth: 1200 },
			nav: {},
		} );
		expect( fake.listenerCount ).toBe( 1 );
		ctl.dispose();
		expect( fake.listenerCount ).toBe( 0 );
	} );
} );

describe( 'the leaf stamp helpers', () => {
	test( 'read what the head stamp wrote', () => {
		const root = document.createElement( 'div' );
		expect( readStampedDisplay( root ) ).toBeNull();
		expect( isStandaloneStamped( root ) ).toBe( false );
		root.setAttribute( DISPLAY_ATTRIBUTE, 'standalone' );
		expect( readStampedDisplay( root ) ).toBe( 'standalone' );
		expect( isStandaloneStamped( root ) ).toBe( true );
		root.setAttribute( DISPLAY_ATTRIBUTE, 'kiosk' );
		expect( readStampedDisplay( root ) ).toBeNull();
	} );

	test( 'stampDisplay writes only on change', () => {
		const root = document.createElement( 'div' );
		stampDisplay( root, 'browser' );
		expect( root.getAttribute( DISPLAY_ATTRIBUTE ) ).toBe( 'browser' );
		stampDisplay( root, 'standalone' );
		expect( root.getAttribute( DISPLAY_ATTRIBUTE ) ).toBe( 'standalone' );
	} );
} );
