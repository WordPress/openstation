/**
 * Tests for the Layer-1 theme application pipeline:
 *
 *   - `applyWindowTheme()` writes tokens to the element's inline
 *     style via `setProperty`.
 *   - Re-applying with different tokens removes stale keys (a window
 *     can switch from theme-A to theme-B without theme-A's variables
 *     leaking).
 *   - The `wp-desktop.window.chrome.theme` filter mutates the
 *     resolved tokens.
 *   - The `wp-desktop.window.chrome.theme-changed` action fires after
 *     a successful apply.
 *   - `clearWindowTheme()` removes every previously-written variable.
 *
 * The `Window` class is heavy (drag, resize, observers, …) — these
 * tests use a minimal duck-typed stand-in. The application pipeline
 * only reads `id`, `config`, and `element`, so the stub is fine.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

import {
	registerWindowTheme,
	_resetWindowThemeRegistryForTests,
} from '../../src/window-chrome/themes/registry';
import {
	applyWindowTheme,
	clearWindowTheme,
} from '../../src/window-chrome/apply';

/**
 * Minimal Window stub. The apply pipeline only needs id/config/element.
 */
function fakeWin( id: string ): unknown {
	return {
		id,
		config: { id, native: false, title: id, icon: '' },
		element: document.createElement( 'div' ),
	};
}

beforeEach( () => {
	installHooksStub();
	_resetWindowThemeRegistryForTests();
} );

afterEach( () => {
	_resetWindowThemeRegistryForTests();
	clearHooksStub();
} );

describe( 'applyWindowTheme', () => {
	test( 'writes registered theme tokens to element.style', () => {
		registerWindowTheme( {
			id: 'plug/midnight',
			tokens: {
				'--wp-desktop-titlebar-bg': '#1a1a2e',
				'--wp-desktop-titlebar-color-focused': '#fafafa',
			},
			match: () => true,
		} );

		const win = fakeWin( 'w-1' );
		applyWindowTheme( win as Parameters< typeof applyWindowTheme >[ 0 ] );

		const el = ( win as { element: HTMLElement } ).element;
		expect( el.style.getPropertyValue( '--wp-desktop-titlebar-bg' ) ).toBe(
			'#1a1a2e',
		);
		expect(
			el.style.getPropertyValue( '--wp-desktop-titlebar-color-focused' ),
		).toBe( '#fafafa' );
	} );

	test( 'inline override bypasses the registry', () => {
		registerWindowTheme( {
			id: 'plug/registered',
			tokens: { '--wp-desktop-titlebar-bg': '#000' },
			match: () => true,
		} );
		const win = fakeWin( 'w-1' );
		applyWindowTheme( win as Parameters< typeof applyWindowTheme >[ 0 ], {
			tokens: { '--wp-desktop-titlebar-bg': '#fff' },
		} );
		const el = ( win as { element: HTMLElement } ).element;
		expect( el.style.getPropertyValue( '--wp-desktop-titlebar-bg' ) ).toBe(
			'#fff',
		);
	} );

	test( 'themeId override resolves through the registry', () => {
		registerWindowTheme( {
			id: 'plug/blue',
			tokens: { '--wp-desktop-titlebar-bg': '#00f' },
			match: () => false, // would NOT match by predicate; the explicit id pin wins.
		} );
		const win = fakeWin( 'w-1' );
		applyWindowTheme( win as Parameters< typeof applyWindowTheme >[ 0 ], {
			themeId: 'plug/blue',
		} );
		const el = ( win as { element: HTMLElement } ).element;
		expect( el.style.getPropertyValue( '--wp-desktop-titlebar-bg' ) ).toBe(
			'#00f',
		);
	} );

	test( 're-apply removes stale tokens from a previous theme', () => {
		registerWindowTheme( {
			id: 'plug/a',
			tokens: {
				'--wp-desktop-titlebar-bg': '#000',
				'--wp-desktop-window-radius': '8px',
			},
			match: () => true,
			priority: 200,
		} );
		const win = fakeWin( 'w-1' );
		applyWindowTheme( win as Parameters< typeof applyWindowTheme >[ 0 ] );

		// Switch to a theme that doesn't carry --wp-desktop-window-radius.
		_resetWindowThemeRegistryForTests();
		registerWindowTheme( {
			id: 'plug/b',
			tokens: { '--wp-desktop-titlebar-bg': '#fff' },
			match: () => true,
			priority: 200,
		} );
		applyWindowTheme( win as Parameters< typeof applyWindowTheme >[ 0 ] );

		const el = ( win as { element: HTMLElement } ).element;
		expect( el.style.getPropertyValue( '--wp-desktop-titlebar-bg' ) ).toBe(
			'#fff',
		);
		// The radius from theme-A must NOT linger on the element.
		expect( el.style.getPropertyValue( '--wp-desktop-window-radius' ) ).toBe(
			'',
		);
	} );

	test( 'no matching theme leaves the element untouched', () => {
		const win = fakeWin( 'w-1' );
		applyWindowTheme( win as Parameters< typeof applyWindowTheme >[ 0 ] );
		const el = ( win as { element: HTMLElement } ).element;
		expect( el.style.getPropertyValue( '--wp-desktop-titlebar-bg' ) ).toBe(
			'',
		);
	} );

	test( 'wp-desktop.window.chrome.theme filter mutates resolved tokens', () => {
		registerWindowTheme( {
			id: 'plug/x',
			tokens: { '--wp-desktop-titlebar-bg': '#000' },
			match: () => true,
		} );
		// Stub-side filter: forcibly add a brand colour to every theme.
		window.wp!.hooks!.addFilter(
			'wp-desktop.window.chrome.theme',
			'test/brand',
			( ( tokens: Record< string, string > ) => ( {
				...tokens,
				'--wp-desktop-accent-color': '#ff00ff',
			} ) ) as ( ...a: unknown[] ) => unknown,
		);

		const win = fakeWin( 'w-1' );
		applyWindowTheme( win as Parameters< typeof applyWindowTheme >[ 0 ] );

		const el = ( win as { element: HTMLElement } ).element;
		expect( el.style.getPropertyValue( '--wp-desktop-accent-color' ) ).toBe(
			'#ff00ff',
		);
	} );

	test( 'theme-changed action fires after each apply', () => {
		const seen: Array< { themeId: string | null } > = [];
		window.wp!.hooks!.addAction(
			'wp-desktop.window.chrome.theme-changed',
			'test/listener',
			( ( payload: { themeId: string | null } ) => {
				seen.push( { themeId: payload.themeId } );
			} ) as ( ...a: unknown[] ) => void,
		);

		registerWindowTheme( {
			id: 'plug/x',
			tokens: { '--wp-desktop-titlebar-bg': '#000' },
			match: () => true,
		} );
		const win = fakeWin( 'w-1' );
		applyWindowTheme( win as Parameters< typeof applyWindowTheme >[ 0 ] );
		expect( seen.at( -1 )?.themeId ).toBe( 'plug/x' );
	} );

	test( 'clearWindowTheme removes every variable previously written', () => {
		registerWindowTheme( {
			id: 'plug/x',
			tokens: {
				'--wp-desktop-titlebar-bg': '#000',
				'--wp-desktop-window-radius': '8px',
			},
			match: () => true,
		} );
		const win = fakeWin( 'w-1' );
		applyWindowTheme( win as Parameters< typeof applyWindowTheme >[ 0 ] );
		clearWindowTheme( win as Parameters< typeof clearWindowTheme >[ 0 ] );
		const el = ( win as { element: HTMLElement } ).element;
		expect( el.style.getPropertyValue( '--wp-desktop-titlebar-bg' ) ).toBe(
			'',
		);
		expect( el.style.getPropertyValue( '--wp-desktop-window-radius' ) ).toBe(
			'',
		);
	} );
} );
