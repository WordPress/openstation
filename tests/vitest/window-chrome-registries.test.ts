/**
 * Phase A foundation tests for the four window-chrome registries:
 * themes, controls, slots, and (Experimental) custom chrome.
 *
 * The registries are pure storage at this phase — no rendering yet.
 * These tests cover the contract every registry shares:
 *
 *   - register / re-register / unregister round-trips
 *   - id validation (non-empty, lowercase alphanum + `-_/`)
 *   - field validation (required fields present, callbacks are
 *     functions, slot names known)
 *   - owner-based bulk teardown
 *   - subscribe / notify fan-out on every mutation
 *   - match-predicate filtering (themes via `resolveWindowTheme`,
 *     controls/slots via `controlsForWindow` / `slotsForWindow`)
 *   - throwing match predicates are isolated (skipped, not crashed)
 *
 * @since 0.6.0
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

import {
	registerWindowTheme,
	unregisterWindowTheme,
	unregisterWindowThemesByOwner,
	listWindowThemes,
	resolveWindowTheme,
	subscribeWindowThemes,
	_resetWindowThemeRegistryForTests,
} from '../../src/window-chrome/themes/registry';

import {
	registerWindowControl,
	unregisterWindowControl,
	unregisterWindowControlsByOwner,
	listWindowControls,
	controlsForWindow,
	subscribeWindowControls,
	_resetWindowControlRegistryForTests,
} from '../../src/window-chrome/controls/registry';

import {
	registerWindowSlot,
	unregisterWindowSlot,
	unregisterWindowSlotsByOwner,
	listWindowSlots,
	slotsForWindow,
	subscribeWindowSlots,
	_resetWindowSlotRegistryForTests,
} from '../../src/window-chrome/slots/registry';

import {
	registerWindowChrome,
	unregisterWindowChrome,
	unregisterWindowChromesByOwner,
	listWindowChromes,
	getWindowChrome,
	subscribeWindowChromes,
	_resetWindowChromeRegistryForTests,
} from '../../src/window-chrome/chrome/registry';

import { RegistrationError } from '../../src/registration-errors';

/**
 * Fake window — the registries only call `match( window )`, so any
 * shape with the fields the predicate inspects works. We never touch
 * the actual `Window` class in these unit tests.
 */
function fakeWin( id: string, opts: { native?: boolean } = {} ): unknown {
	return {
		id,
		config: { id, native: opts.native ?? false },
	};
}

beforeEach( () => {
	installHooksStub();
	_resetWindowThemeRegistryForTests();
	_resetWindowControlRegistryForTests();
	_resetWindowSlotRegistryForTests();
	_resetWindowChromeRegistryForTests();
} );
afterEach( () => {
	clearHooksStub();
	_resetWindowThemeRegistryForTests();
	_resetWindowControlRegistryForTests();
	_resetWindowSlotRegistryForTests();
	_resetWindowChromeRegistryForTests();
} );

// ---------------------------------------------------------------------------
// Themes (Layer 1)
// ---------------------------------------------------------------------------

describe( 'WindowTheme registry', () => {
	test( 'register stores entry and round-trips through list', () => {
		registerWindowTheme( {
			id: 'plug/sunrise',
			tokens: { '--wp-desktop-titlebar-bg': '#fa0' },
			match: () => true,
		} );
		expect( listWindowThemes().map( ( d ) => d.id ) ).toEqual( [
			'plug/sunrise',
		] );
	} );

	test( 'register replaces an entry with the same id', () => {
		registerWindowTheme( {
			id: 'plug/x',
			tokens: { '--wp-desktop-titlebar-bg': '#000' },
			match: () => true,
		} );
		registerWindowTheme( {
			id: 'plug/x',
			tokens: { '--wp-desktop-titlebar-bg': '#fff' },
			match: () => true,
		} );
		expect( listWindowThemes() ).toHaveLength( 1 );
		expect( listWindowThemes()[ 0 ].tokens[ '--wp-desktop-titlebar-bg' ] ).toBe(
			'#fff',
		);
	} );

	test( 'register throws RegistrationError on missing id', () => {
		expect( () =>
			registerWindowTheme( {
				id: '',
				tokens: { '--x': 'y' },
				match: () => true,
			} ),
		).toThrow( RegistrationError );
	} );

	test( 'register throws on token keys that do not start with --', () => {
		expect( () =>
			registerWindowTheme( {
				id: 'plug/y',
				tokens: { 'wp-desktop-titlebar-bg': '#fa0' },
				match: () => true,
			} ),
		).toThrow( RegistrationError );
	} );

	test( 'register throws on non-function match', () => {
		expect( () =>
			registerWindowTheme( {
				id: 'plug/z',
				tokens: { '--x': 'y' },
				// @ts-expect-error — runtime validation
				match: 'not-a-function',
			} ),
		).toThrow( RegistrationError );
	} );

	test( 'register normalizes id to lowercase', () => {
		registerWindowTheme( {
			id: 'Plug/UPPER',
			tokens: { '--x': 'y' },
			match: () => true,
		} );
		expect( listWindowThemes().map( ( d ) => d.id ) ).toEqual( [
			'plug/upper',
		] );
	} );

	test( 'register throws on id with disallowed characters', () => {
		expect( () =>
			registerWindowTheme( {
				id: 'plug spaces',
				tokens: { '--x': 'y' },
				match: () => true,
			} ),
		).toThrow( RegistrationError );
	} );

	test( 'unregisterByOwner drops only matching owners', () => {
		registerWindowTheme( {
			id: 'a',
			tokens: { '--x': 'y' },
			match: () => true,
			owner: 'plug-1',
		} );
		registerWindowTheme( {
			id: 'b',
			tokens: { '--x': 'y' },
			match: () => true,
			owner: 'plug-1',
		} );
		registerWindowTheme( {
			id: 'c',
			tokens: { '--x': 'y' },
			match: () => true,
			owner: 'plug-2',
		} );
		expect( unregisterWindowThemesByOwner( 'plug-1' ) ).toBe( 2 );
		expect( listWindowThemes().map( ( d ) => d.id ) ).toEqual( [ 'c' ] );
	} );

	test( 'resolve returns highest-priority match', () => {
		registerWindowTheme( {
			id: 'low',
			tokens: { '--x': 'low' },
			match: () => true,
			priority: 10,
		} );
		registerWindowTheme( {
			id: 'high',
			tokens: { '--x': 'high' },
			match: () => true,
			priority: 200,
		} );
		const won = resolveWindowTheme(
			fakeWin( 'w-1' ) as Parameters< typeof resolveWindowTheme >[ 0 ],
		);
		expect( won?.id ).toBe( 'high' );
	} );

	test( 'resolve skips themes whose match throws', () => {
		registerWindowTheme( {
			id: 'thrower',
			tokens: { '--x': 'y' },
			match: () => {
				throw new Error( 'boom' );
			},
			priority: 200,
		} );
		registerWindowTheme( {
			id: 'survivor',
			tokens: { '--x': 'y' },
			match: () => true,
			priority: 10,
		} );
		const won = resolveWindowTheme(
			fakeWin( 'w-1' ) as Parameters< typeof resolveWindowTheme >[ 0 ],
		);
		expect( won?.id ).toBe( 'survivor' );
	} );

	test( 'subscribe fires on register, unregister, and bulk teardown', () => {
		let calls = 0;
		const stop = subscribeWindowThemes( () => {
			calls++;
		} );
		registerWindowTheme( {
			id: 'a',
			tokens: { '--x': 'y' },
			match: () => true,
			owner: 'plug-1',
		} );
		expect( calls ).toBe( 1 );
		unregisterWindowTheme( 'a' );
		expect( calls ).toBe( 2 );
		registerWindowTheme( {
			id: 'b',
			tokens: { '--x': 'y' },
			match: () => true,
			owner: 'plug-1',
		} );
		unregisterWindowThemesByOwner( 'plug-1' );
		expect( calls ).toBe( 4 );
		stop();
	} );
} );

// ---------------------------------------------------------------------------
// Controls (Layer 2)
// ---------------------------------------------------------------------------

describe( 'WindowControl registry', () => {
	test( 'register stores entry and partitions by placement', () => {
		registerWindowControl( {
			id: 'core/close',
			label: 'Close',
			icon: 'close',
			placement: 'controls',
			match: () => true,
			onClick: () => {},
			core: true,
		} );
		registerWindowControl( {
			id: 'plug/star',
			label: 'Star',
			icon: 'dashicons-star-filled',
			placement: 'left',
			match: () => true,
			onClick: () => {},
			owner: 'plug',
		} );
		const buckets = controlsForWindow(
			fakeWin( 'w-1' ) as Parameters< typeof controlsForWindow >[ 0 ],
		);
		expect( buckets.controls.map( ( c ) => c.id ) ).toEqual( [ 'core/close' ] );
		expect( buckets.left.map( ( c ) => c.id ) ).toEqual( [ 'plug/star' ] );
		expect( buckets.right ).toHaveLength( 0 );
	} );

	test( 'register throws when neither onClick nor render is supplied', () => {
		expect( () =>
			registerWindowControl( {
				id: 'plug/dud',
				label: 'X',
				icon: 'close',
				match: () => true,
			} ),
		).toThrow( RegistrationError );
	} );

	test( 'register throws when icon is missing and render is omitted', () => {
		expect( () =>
			registerWindowControl( {
				id: 'plug/no-icon',
				label: 'X',
				match: () => true,
				onClick: () => {},
			} ),
		).toThrow( RegistrationError );
	} );

	test( 'register accepts custom render without icon', () => {
		registerWindowControl( {
			id: 'plug/custom',
			label: 'X',
			match: () => true,
			render: () => {},
		} );
		expect( listWindowControls().map( ( c ) => c.id ) ).toEqual( [
			'plug/custom',
		] );
	} );

	test( 'register throws on invalid placement', () => {
		expect( () =>
			registerWindowControl( {
				id: 'plug/x',
				label: 'X',
				icon: 'close',
				// @ts-expect-error — runtime validation
				placement: 'top',
				match: () => true,
				onClick: () => {},
			} ),
		).toThrow( RegistrationError );
	} );

	test( 'unregisterByOwner drops only matching owners', () => {
		registerWindowControl( {
			id: 'plug/a',
			label: 'A',
			icon: 'close',
			match: () => true,
			onClick: () => {},
			owner: 'plug-1',
		} );
		registerWindowControl( {
			id: 'plug/b',
			label: 'B',
			icon: 'close',
			match: () => true,
			onClick: () => {},
			owner: 'plug-2',
		} );
		expect( unregisterWindowControlsByOwner( 'plug-1' ) ).toBe( 1 );
		expect( listWindowControls().map( ( c ) => c.id ) ).toEqual( [ 'plug/b' ] );
	} );

	test( 'controlsForWindow skips controls whose match throws', () => {
		registerWindowControl( {
			id: 'plug/boom',
			label: 'X',
			icon: 'close',
			placement: 'controls',
			match: () => {
				throw new Error( 'x' );
			},
			onClick: () => {},
		} );
		registerWindowControl( {
			id: 'plug/ok',
			label: 'X',
			icon: 'close',
			placement: 'controls',
			match: () => true,
			onClick: () => {},
		} );
		const buckets = controlsForWindow(
			fakeWin( 'w-1' ) as Parameters< typeof controlsForWindow >[ 0 ],
		);
		expect( buckets.controls.map( ( c ) => c.id ) ).toEqual( [ 'plug/ok' ] );
	} );

	test( 'subscribe fires on register and unregister', () => {
		let calls = 0;
		const stop = subscribeWindowControls( () => {
			calls++;
		} );
		registerWindowControl( {
			id: 'a',
			label: 'A',
			icon: 'close',
			match: () => true,
			onClick: () => {},
		} );
		expect( calls ).toBe( 1 );
		unregisterWindowControl( 'a' );
		expect( calls ).toBe( 2 );
		stop();
	} );
} );

// ---------------------------------------------------------------------------
// Slots (Layer 3)
// ---------------------------------------------------------------------------

describe( 'WindowSlot registry', () => {
	test( 'register stores entry; slotsForWindow filters by slot + match', () => {
		registerWindowSlot( {
			id: 'plug/title-prefix',
			slot: 'title',
			match: () => true,
			render: () => {},
		} );
		registerWindowSlot( {
			id: 'plug/icon-watermark',
			slot: 'icon',
			match: () => true,
			render: () => {},
		} );
		const titleSlots = slotsForWindow(
			fakeWin( 'w-1' ) as Parameters< typeof slotsForWindow >[ 0 ],
			'title',
		);
		expect( titleSlots.map( ( d ) => d.id ) ).toEqual( [ 'plug/title-prefix' ] );
	} );

	test( 'register throws on unknown slot name', () => {
		expect( () =>
			registerWindowSlot( {
				id: 'plug/x',
				// @ts-expect-error — runtime validation
				slot: 'not-a-slot',
				match: () => true,
				render: () => {},
			} ),
		).toThrow( RegistrationError );
	} );

	test( 'register throws when render is missing', () => {
		expect( () =>
			registerWindowSlot( {
				// @ts-expect-error — runtime validation
				id: 'plug/x',
				slot: 'title',
				match: () => true,
			} ),
		).toThrow( RegistrationError );
	} );

	test( 'unregisterByOwner drops only matching owners', () => {
		registerWindowSlot( {
			id: 'a',
			slot: 'title',
			match: () => true,
			render: () => {},
			owner: 'plug-1',
		} );
		registerWindowSlot( {
			id: 'b',
			slot: 'title',
			match: () => true,
			render: () => {},
			owner: 'plug-2',
		} );
		expect( unregisterWindowSlotsByOwner( 'plug-1' ) ).toBe( 1 );
		expect( listWindowSlots().map( ( d ) => d.id ) ).toEqual( [ 'b' ] );
	} );

	test( 'list sorted by (order, id)', () => {
		registerWindowSlot( {
			id: 'b',
			slot: 'title',
			order: 50,
			match: () => true,
			render: () => {},
		} );
		registerWindowSlot( {
			id: 'a',
			slot: 'title',
			order: 50,
			match: () => true,
			render: () => {},
		} );
		registerWindowSlot( {
			id: 'c',
			slot: 'title',
			order: 10,
			match: () => true,
			render: () => {},
		} );
		expect( listWindowSlots().map( ( d ) => d.id ) ).toEqual( [
			'c',
			'a',
			'b',
		] );
	} );
} );

// ---------------------------------------------------------------------------
// Custom chrome (Layer 4 — Experimental)
// ---------------------------------------------------------------------------

describe( 'WindowChrome registry (Experimental)', () => {
	test( 'register stores entry; getWindowChrome returns it', () => {
		registerWindowChrome( {
			id: 'plug/macos',
			match: () => true,
			render: () => ( { destroy: () => {} } ),
		} );
		expect( getWindowChrome( 'plug/macos' )?.id ).toBe( 'plug/macos' );
		expect( getWindowChrome( 'plug/missing' ) ).toBeNull();
	} );

	test( 'register throws when render is missing', () => {
		expect( () =>
			registerWindowChrome( {
				id: 'plug/x',
				match: () => true,
				// @ts-expect-error — runtime validation
				render: undefined,
			} ),
		).toThrow( RegistrationError );
	} );

	test( 'unregisterByOwner drops only matching owners', () => {
		registerWindowChrome( {
			id: 'a',
			match: () => true,
			render: () => ( { destroy: () => {} } ),
			owner: 'plug-1',
		} );
		registerWindowChrome( {
			id: 'b',
			match: () => true,
			render: () => ( { destroy: () => {} } ),
			owner: 'plug-2',
		} );
		expect( unregisterWindowChromesByOwner( 'plug-1' ) ).toBe( 1 );
		expect( listWindowChromes().map( ( d ) => d.id ) ).toEqual( [ 'b' ] );
	} );

	test( 'subscribe fires on every mutation', () => {
		let calls = 0;
		const stop = subscribeWindowChromes( () => {
			calls++;
		} );
		registerWindowChrome( {
			id: 'a',
			match: () => true,
			render: () => ( { destroy: () => {} } ),
			owner: 'plug-1',
		} );
		registerWindowChrome( {
			id: 'b',
			match: () => true,
			render: () => ( { destroy: () => {} } ),
			owner: 'plug-1',
		} );
		unregisterWindowChromesByOwner( 'plug-1' );
		expect( calls ).toBe( 3 );
		stop();
	} );
} );
