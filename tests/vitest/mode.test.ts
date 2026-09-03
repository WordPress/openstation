/**
 * Tests for `src/mode/` — the responsive mode.
 *
 * Pins:
 * - `resolveMode()` is the one rule: a forced preference wins, else
 *   the width is compared with the two breakpoints (inclusive);
 * - breakpoints are sanitized to `0 < mobile < tablet`;
 * - `installMode()` stamps `data-os-mode` on the root at once, fires
 *   `os.mode.changed` + `os-mode-changed` only on a real crossing,
 *   and re-resolves when the preference changes;
 * - the leaf stamp helpers read what the head stamp wrote.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { HOOKS } from '../../src/hooks';
import {
	DEFAULT_BREAKPOINTS,
	installMode,
	resolveMode,
	sanitizeBreakpoints,
	sanitizeModePreference,
} from '../../src/mode';
import { isMobileStamped, MODE_ATTRIBUTE, readStampedMode, stampMode } from '../../src/mode/stamp';
import { clearHooksStub, installHooksStub, recordActions } from './helpers/hooks-stub';

/** A `matchMedia` whose queries can be flipped from the test. */
function fakeMatchMedia( width: { value: number } ) {
	const lists: Array< { px: number; mql: MediaQueryList; fire: () => void } > = [];
	const matchMedia = ( query: string ): MediaQueryList => {
		const px = Number( /max-width:\s*(\d+)px/.exec( query )?.[ 1 ] ?? 0 );
		const listeners = new Set< ( e: MediaQueryListEvent ) => void >();
		const mql = {
			media: query,
			get matches() {
				return width.value <= px;
			},
			onchange: null,
			addEventListener: ( _t: string, cb: ( e: MediaQueryListEvent ) => void ) => listeners.add( cb ),
			removeEventListener: ( _t: string, cb: ( e: MediaQueryListEvent ) => void ) => listeners.delete( cb ),
			addListener: ( cb: ( e: MediaQueryListEvent ) => void ) => listeners.add( cb ),
			removeListener: ( cb: ( e: MediaQueryListEvent ) => void ) => listeners.delete( cb ),
			dispatchEvent: () => true,
		} as unknown as MediaQueryList;
		lists.push( {
			px,
			mql,
			fire: () => {
				for ( const cb of listeners ) {
					cb( { matches: width.value <= px, media: query } as MediaQueryListEvent );
				}
			},
		} );
		return mql;
	};
	return {
		matchMedia,
		/** Resize and notify every query, as a browser would on a crossing. */
		resize( next: number ) {
			width.value = next;
			for ( const l of lists ) {
				l.fire();
			}
		},
		lists,
	};
}

describe( 'resolveMode', () => {
	test( 'the bands are inclusive at their upper edge', () => {
		expect( resolveMode( 767 ) ).toBe( 'mobile' );
		expect( resolveMode( 768 ) ).toBe( 'tablet' );
		expect( resolveMode( 1024 ) ).toBe( 'tablet' );
		expect( resolveMode( 1025 ) ).toBe( 'desktop' );
	} );

	test( 'a forced preference wins regardless of width', () => {
		expect( resolveMode( 390, 'desktop' ) ).toBe( 'desktop' );
		expect( resolveMode( 1920, 'mobile' ) ).toBe( 'mobile' );
	} );

	test( 'custom breakpoints move the bands', () => {
		expect( resolveMode( 800, 'auto', { mobile: 900, tablet: 1200 } ) ).toBe( 'mobile' );
		expect( resolveMode( 1100, 'auto', { mobile: 900, tablet: 1200 } ) ).toBe( 'tablet' );
	} );
} );

describe( 'sanitizers', () => {
	test( 'preference falls back to auto', () => {
		expect( sanitizeModePreference( 'mobile' ) ).toBe( 'mobile' );
		expect( sanitizeModePreference( 'phone' ) ).toBe( 'auto' );
		expect( sanitizeModePreference( undefined ) ).toBe( 'auto' );
	} );

	test( 'breakpoints keep 0 < mobile < tablet', () => {
		expect( sanitizeBreakpoints( undefined ) ).toEqual( DEFAULT_BREAKPOINTS );
		expect( sanitizeBreakpoints( { mobile: 900, tablet: 800 } ) ).toEqual( { mobile: 900, tablet: 901 } );
		expect( sanitizeBreakpoints( { mobile: -5, tablet: 'x' } ) ).toEqual( DEFAULT_BREAKPOINTS );
		expect( sanitizeBreakpoints( { mobile: '600', tablet: 1000 } ) ).toEqual( { mobile: 600, tablet: 1000 } );
	} );
} );

describe( 'stamp helpers', () => {
	test( 'stampMode / readStampedMode / isMobileStamped agree', () => {
		const root = document.createElement( 'html' );
		expect( readStampedMode( root ) ).toBeNull();
		stampMode( root, 'mobile' );
		expect( root.getAttribute( MODE_ATTRIBUTE ) ).toBe( 'mobile' );
		expect( readStampedMode( root ) ).toBe( 'mobile' );
		expect( isMobileStamped( root ) ).toBe( true );
		root.setAttribute( MODE_ATTRIBUTE, 'phone' );
		expect( readStampedMode( root ) ).toBeNull();
	} );
} );

describe( 'installMode', () => {
	let hooks: ReturnType< typeof installHooksStub >;
	let root: HTMLElement;

	beforeEach( () => {
		hooks = installHooksStub();
		root = document.createElement( 'div' );
	} );
	afterEach( () => {
		clearHooksStub();
	} );

	test( 'stamps the initial mode and reports it', () => {
		const width = { value: 390 };
		const mm = fakeMatchMedia( width );
		const ctl = installMode( { root, win: { matchMedia: mm.matchMedia, innerWidth: width.value } } );
		expect( root.getAttribute( MODE_ATTRIBUTE ) ).toBe( 'mobile' );
		expect( ctl.api.get() ).toBe( 'mobile' );
		expect( ctl.api.isMobile() ).toBe( true );
		expect( ctl.api.getPreference() ).toBe( 'auto' );
		expect( mm.lists.map( ( l ) => l.px ) ).toEqual( [ 767, 1024 ] );
		ctl.dispose();
	} );

	test( 'a crossing fires the hook, the event and subscribers exactly once', () => {
		const width = { value: 390 };
		const mm = fakeMatchMedia( width );
		const win = { matchMedia: mm.matchMedia, get innerWidth() { return width.value; } };
		const ctl = installMode( { root, win } );
		const log = recordActions( hooks, [ HOOKS.MODE_CHANGED ] );
		const events: unknown[] = [];
		document.addEventListener( 'os-mode-changed', ( e ) => events.push( ( e as CustomEvent ).detail ) );
		const cb = vi.fn();
		ctl.api.subscribe( cb );

		mm.resize( 1300 );

		expect( root.getAttribute( MODE_ATTRIBUTE ) ).toBe( 'desktop' );
		expect( log ).toHaveLength( 1 );
		expect( log[ 0 ].args[ 0 ] ).toEqual( { mode: 'desktop', previous: 'mobile', preference: 'auto' } );
		expect( events ).toHaveLength( 1 );
		expect( cb ).toHaveBeenCalledTimes( 1 );

		// A resize inside the same band notifies nobody.
		mm.resize( 1400 );
		expect( log ).toHaveLength( 1 );
		expect( cb ).toHaveBeenCalledTimes( 1 );
		ctl.dispose();
	} );

	test( 'setPreference re-resolves; immediate subscribers get the current mode', () => {
		const width = { value: 1300 };
		const mm = fakeMatchMedia( width );
		const ctl = installMode( { root, win: { matchMedia: mm.matchMedia, innerWidth: width.value } } );
		const cb = vi.fn();
		ctl.api.subscribe( cb, { immediate: true } );
		expect( cb ).toHaveBeenCalledWith( { mode: 'desktop', previous: 'desktop', preference: 'auto' } );

		ctl.setPreference( 'mobile' );
		expect( ctl.api.get() ).toBe( 'mobile' );
		expect( root.getAttribute( MODE_ATTRIBUTE ) ).toBe( 'mobile' );
		expect( cb ).toHaveBeenLastCalledWith( { mode: 'mobile', previous: 'desktop', preference: 'mobile' } );

		// Same preference again: no transition.
		ctl.setPreference( 'mobile' );
		expect( cb ).toHaveBeenCalledTimes( 2 );

		// Junk is coerced to auto, which on a wide viewport is desktop.
		ctl.setPreference( 'phone' as never );
		expect( ctl.api.get() ).toBe( 'desktop' );
		ctl.dispose();
	} );

	test( 'a listener that throws does not stop the others', () => {
		const width = { value: 390 };
		const mm = fakeMatchMedia( width );
		const win = { matchMedia: mm.matchMedia, get innerWidth() { return width.value; } };
		const ctl = installMode( { root, win } );
		const spy = vi.spyOn( console, 'error' ).mockImplementation( () => undefined );
		const second = vi.fn();
		ctl.api.subscribe( () => {
			throw new Error( 'boom' );
		} );
		ctl.api.subscribe( second );
		mm.resize( 1300 );
		expect( second ).toHaveBeenCalledTimes( 1 );
		expect( spy ).toHaveBeenCalled();
		spy.mockRestore();
		ctl.dispose();
	} );
} );
