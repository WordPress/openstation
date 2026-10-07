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
				'--os-titlebar-bg': '#1a1a2e',
				'--os-titlebar-color-focused': '#fafafa',
			},
			match: () => true,
		} );

		const win = fakeWin( 'w-1' );
		applyWindowTheme( win as Parameters< typeof applyWindowTheme >[ 0 ] );

		const el = ( win as { element: HTMLElement } ).element;
		expect( el.style.getPropertyValue( '--os-titlebar-bg' ) ).toBe(
			'#1a1a2e',
		);
		expect(
			el.style.getPropertyValue( '--os-titlebar-color-focused' ),
		).toBe( '#fafafa' );
	} );

	test( 'inline override bypasses the registry', () => {
		registerWindowTheme( {
			id: 'plug/registered',
			tokens: { '--os-titlebar-bg': '#000' },
			match: () => true,
		} );
		const win = fakeWin( 'w-1' );
		applyWindowTheme( win as Parameters< typeof applyWindowTheme >[ 0 ], {
			tokens: { '--os-titlebar-bg': '#fff' },
		} );
		const el = ( win as { element: HTMLElement } ).element;
		expect( el.style.getPropertyValue( '--os-titlebar-bg' ) ).toBe(
			'#fff',
		);
	} );

	test( 'themeId override resolves through the registry', () => {
		registerWindowTheme( {
			id: 'plug/blue',
			tokens: { '--os-titlebar-bg': '#00f' },
			match: () => false,
		} );
		const win = fakeWin( 'w-1' );
		applyWindowTheme( win as Parameters< typeof applyWindowTheme >[ 0 ], {
			themeId: 'plug/blue',
		} );
		const el = ( win as { element: HTMLElement } ).element;
		expect( el.style.getPropertyValue( '--os-titlebar-bg' ) ).toBe(
			'#00f',
		);
	} );

	test( 're-apply removes stale tokens from a previous theme', () => {
		registerWindowTheme( {
			id: 'plug/a',
			tokens: {
				'--os-titlebar-bg': '#000',
				'--os-window-radius': '8px',
			},
			match: () => true,
			priority: 200,
		} );
		const win = fakeWin( 'w-1' );
		applyWindowTheme( win as Parameters< typeof applyWindowTheme >[ 0 ] );

		_resetWindowThemeRegistryForTests();
		registerWindowTheme( {
			id: 'plug/b',
			tokens: { '--os-titlebar-bg': '#fff' },
			match: () => true,
			priority: 200,
		} );
		applyWindowTheme( win as Parameters< typeof applyWindowTheme >[ 0 ] );

		const el = ( win as { element: HTMLElement } ).element;
		expect( el.style.getPropertyValue( '--os-titlebar-bg' ) ).toBe(
			'#fff',
		);

		expect( el.style.getPropertyValue( '--os-window-radius' ) ).toBe(
			'',
		);
	} );

	test( 'no matching theme leaves the element untouched', () => {
		const win = fakeWin( 'w-1' );
		applyWindowTheme( win as Parameters< typeof applyWindowTheme >[ 0 ] );
		const el = ( win as { element: HTMLElement } ).element;
		expect( el.style.getPropertyValue( '--os-titlebar-bg' ) ).toBe(
			'',
		);
	} );

	test( 'os.window.chrome.theme filter mutates resolved tokens', () => {
		registerWindowTheme( {
			id: 'plug/x',
			tokens: { '--os-titlebar-bg': '#000' },
			match: () => true,
		} );

		window.wp!.hooks!.addFilter(
			'os.window.chrome.theme',
			'test/brand',
			( ( tokens: Record< string, string > ) => ( {
				...tokens,
				'--os-accent-color': '#ff00ff',
			} ) ) as ( ...a: unknown[] ) => unknown,
		);

		const win = fakeWin( 'w-1' );
		applyWindowTheme( win as Parameters< typeof applyWindowTheme >[ 0 ] );

		const el = ( win as { element: HTMLElement } ).element;
		expect( el.style.getPropertyValue( '--os-accent-color' ) ).toBe(
			'#ff00ff',
		);
	} );

	test( 'theme-changed action fires after each apply', () => {
		const seen: Array< { themeId: string | null } > = [];
		window.wp!.hooks!.addAction(
			'os.window.chrome.theme-changed',
			'test/listener',
			( ( payload: { themeId: string | null } ) => {
				seen.push( { themeId: payload.themeId } );
			} ) as ( ...a: unknown[] ) => void,
		);

		registerWindowTheme( {
			id: 'plug/x',
			tokens: { '--os-titlebar-bg': '#000' },
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
				'--os-titlebar-bg': '#000',
				'--os-window-radius': '8px',
			},
			match: () => true,
		} );
		const win = fakeWin( 'w-1' );
		applyWindowTheme( win as Parameters< typeof applyWindowTheme >[ 0 ] );
		clearWindowTheme( win as Parameters< typeof clearWindowTheme >[ 0 ] );
		const el = ( win as { element: HTMLElement } ).element;
		expect( el.style.getPropertyValue( '--os-titlebar-bg' ) ).toBe(
			'',
		);
		expect( el.style.getPropertyValue( '--os-window-radius' ) ).toBe(
			'',
		);
	} );
} );
