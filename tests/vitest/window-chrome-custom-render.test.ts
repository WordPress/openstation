/**
 * Phase F tests — Layer 4 (Experimental) custom-chrome mount/swap.
 *
 *   - `mountWindowChrome` returns null for the standard chrome
 *     (no-op — Layer 1-3 already painted).
 *   - Resolving a registered chrome calls its `render(host, ctx)`
 *     once and returns the handle.
 *   - The `wp-desktop.window.chrome.render` filter can swap the
 *     resolved id.
 *   - `wp-desktop.window.chrome.applied` action fires with
 *     `layer: 'chrome'` on successful mount.
 *   - A throwing render is isolated — null returns, framework
 *     keeps the standard chrome in place.
 *   - The `match` predicate filters which chromes a window can
 *     mount.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

import {
	registerWindowChrome,
	_resetWindowChromeRegistryForTests,
} from '../../src/window-chrome/chrome/registry';
import {
	mountWindowChrome,
	resolveChromeId,
	STANDARD_CHROME_ID,
} from '../../src/window-chrome/chrome/apply';

function fakeWin( id: string, chromeId?: string ): unknown {
	return {
		id,
		config: {
			id,
			native: false,
			title: id,
			icon: 'dashicons-admin-generic',
			appearance: chromeId ? { chrome: chromeId } : undefined,
		},
		element: document.createElement( 'div' ),
		state: 'normal',
	};
}

beforeEach( () => {
	installHooksStub();
	_resetWindowChromeRegistryForTests();
} );

afterEach( () => {
	_resetWindowChromeRegistryForTests();
	clearHooksStub();
} );

describe( 'mountWindowChrome', () => {
	test( 'returns null for the standard chrome (default)', () => {
		const win = fakeWin( 'edit-post' );
		expect(
			mountWindowChrome( win as Parameters< typeof mountWindowChrome >[ 0 ] ),
		).toBeNull();
	} );

	test( 'mounts a registered chrome and returns its handle', () => {
		const destroy = vi.fn();
		const update = vi.fn();
		const render = vi.fn( () => ( { destroy, update } ) );
		registerWindowChrome( {
			id: 'plug/macos',
			match: () => true,
			render,
		} );

		const win = fakeWin( 'edit-post', 'plug/macos' );
		const mounted = mountWindowChrome(
			win as Parameters< typeof mountWindowChrome >[ 0 ],
		);
		expect( mounted ).not.toBeNull();
		expect( mounted!.id ).toBe( 'plug/macos' );
		expect( render ).toHaveBeenCalledTimes( 1 );
		expect( render.mock.calls[ 0 ][ 0 ] ).toBe(
			( win as { element: HTMLElement } ).element,
		);
	} );

	test( 'returns null when the chrome id is not registered', () => {
		const win = fakeWin( 'edit-post', 'plug/missing' );
		expect(
			mountWindowChrome( win as Parameters< typeof mountWindowChrome >[ 0 ] ),
		).toBeNull();
	} );

	test( 'returns null when the registered chrome match() returns false', () => {
		registerWindowChrome( {
			id: 'plug/native-only',
			match: ( w ) => w.config.native ?? false,
			render: () => ( { destroy: () => {} } ),
		} );
		const win = fakeWin( 'edit-post', 'plug/native-only' );
		expect(
			mountWindowChrome( win as Parameters< typeof mountWindowChrome >[ 0 ] ),
		).toBeNull();
	} );

	test( 'wp-desktop.window.chrome.render filter can swap the resolved id', () => {
		registerWindowChrome( {
			id: 'plug/swapped',
			match: () => true,
			render: () => ( { destroy: () => {} } ),
		} );
		window.wp!.hooks!.addFilter(
			'wp-desktop.window.chrome.render',
			'test/swap',
			( () => 'plug/swapped' ) as ( ...a: unknown[] ) => unknown,
		);
		const win = fakeWin( 'edit-post' ); // no inline chrome
		expect(
			resolveChromeId( win as Parameters< typeof resolveChromeId >[ 0 ] ),
		).toBe( 'plug/swapped' );
		const mounted = mountWindowChrome(
			win as Parameters< typeof mountWindowChrome >[ 0 ],
		);
		expect( mounted?.id ).toBe( 'plug/swapped' );
	} );

	test( 'fires wp-desktop.window.chrome.applied with layer: chrome', () => {
		const seen: Array< { layer?: string; chromeId?: string } > = [];
		window.wp!.hooks!.addAction(
			'wp-desktop.window.chrome.applied',
			'test/applied',
			( ( payload: { layer?: string; chromeId?: string } ) => {
				seen.push( payload );
			} ) as ( ...a: unknown[] ) => void,
		);
		registerWindowChrome( {
			id: 'plug/x',
			match: () => true,
			render: () => ( { destroy: () => {} } ),
		} );
		mountWindowChrome(
			fakeWin( 'edit-post', 'plug/x' ) as Parameters<
				typeof mountWindowChrome
			>[ 0 ],
		);
		expect( seen.some( ( s ) => s.layer === 'chrome' && s.chromeId === 'plug/x' ) ).toBe(
			true,
		);
	} );

	test( 'a throwing render is isolated — returns null, no exception bubbles', () => {
		registerWindowChrome( {
			id: 'plug/bad',
			match: () => true,
			render: () => {
				throw new Error( 'boom' );
			},
		} );
		const win = fakeWin( 'edit-post', 'plug/bad' );
		expect( () =>
			mountWindowChrome( win as Parameters< typeof mountWindowChrome >[ 0 ] ),
		).not.toThrow();
		expect(
			mountWindowChrome( win as Parameters< typeof mountWindowChrome >[ 0 ] ),
		).toBeNull();
	} );

	test( 'STANDARD_CHROME_ID is the default resolved id', () => {
		const win = fakeWin( 'edit-post' );
		expect(
			resolveChromeId( win as Parameters< typeof resolveChromeId >[ 0 ] ),
		).toBe( STANDARD_CHROME_ID );
	} );
} );
