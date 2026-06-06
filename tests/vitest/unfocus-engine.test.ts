/**
 * Unit tests for `src/effects/unfocus-engine.ts`.
 *
 * The engine applies the user's chosen unfocus effect to every window
 * that isn't focused, and keeps it in sync with focus changes, the OS
 * Settings selection, and the effect registry. We drive it with fake
 * `WindowManager` / `OsSettings` doubles and real DOM nodes so we can
 * assert the class toggling on each window root.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';
import type { OsSettings } from '../../src/settings';
import type { OsSettingsSnapshot } from '../../src/settings/registry';
import type { WindowManager } from '../../src/window-manager';
import type { Window as DesktopWindow } from '../../src/window';

const DARKEN_CLASS = 'desktop-mode-window--fx-darken';

type Engine = typeof import( '../../src/effects/unfocus-engine' );
type Registry = typeof import( '../../src/effects/registry' );

async function loadModules(): Promise< { engine: Engine; registry: Registry } > {
	_resetAllSharedStoresForTests();
	vi.resetModules();
	const engine = await import( '../../src/effects/unfocus-engine' );
	const registry = await import( '../../src/effects/registry' );
	return { engine, registry };
}

interface FakeWin {
	id: string;
	element: HTMLElement;
	state: string;
	focused: boolean;
}

function makeWin( id: string, focused: boolean, state = 'normal' ): FakeWin {
	const element = document.createElement( 'div' );
	element.className = 'desktop-mode-window';
	return { id, element, state, focused };
}

function makeManager( wins: FakeWin[] ): WindowManager {
	return {
		getAll: () =>
			wins.map(
				( w ) =>
					( {
						id: w.id,
						element: w.element,
						state: w.state,
						isFocused: () => w.focused,
					} as unknown as DesktopWindow ),
			),
	} as unknown as WindowManager;
}

function makeOsSettings( initial: string ): {
	osSettings: OsSettings;
	setEffect: ( id: string ) => void;
} {
	let snapshot = { unfocusEffect: initial } as unknown as OsSettingsSnapshot;
	let cb: ( ( s: OsSettingsSnapshot ) => void ) | null = null;
	const osSettings = {
		getOsSettingsSnapshot: () => snapshot,
		subscribeOsSettings: ( fn: ( s: OsSettingsSnapshot ) => void ) => {
			cb = fn;
			return () => {
				cb = null;
			};
		},
	} as unknown as OsSettings;
	const setEffect = ( id: string ): void => {
		snapshot = { unfocusEffect: id } as unknown as OsSettingsSnapshot;
		cb?.( snapshot );
	};
	return { osSettings, setEffect };
}

describe( 'effects/unfocus-engine.ts', () => {
	beforeEach( () => {
		installHooksStub();
	} );
	afterEach( () => {
		clearHooksStub();
	} );

	test( 'applies the effect class to unfocused windows only', async () => {
		const { engine } = await loadModules();
		const focused = makeWin( 'a', true );
		const unfocused = makeWin( 'b', false );
		const { osSettings } = makeOsSettings( 'darken' );

		engine.startUnfocusEngine( {
			manager: makeManager( [ focused, unfocused ] ),
			osSettings,
		} );

		expect( focused.element.classList.contains( DARKEN_CLASS ) ).toBe( false );
		expect( unfocused.element.classList.contains( DARKEN_CLASS ) ).toBe( true );
		expect(
			unfocused.element.getAttribute( 'data-desktop-unfocus-effect' ),
		).toBe( 'darken' );
	} );

	test( 'does not apply to minimized windows', async () => {
		const { engine } = await loadModules();
		const minimized = makeWin( 'm', false, 'minimized' );
		const { osSettings } = makeOsSettings( 'darken' );

		engine.startUnfocusEngine( {
			manager: makeManager( [ minimized ] ),
			osSettings,
		} );

		expect( minimized.element.classList.contains( DARKEN_CLASS ) ).toBe(
			false,
		);
	} );

	test( 'clears the effect when the setting switches to "none"', async () => {
		const { engine } = await loadModules();
		const unfocused = makeWin( 'b', false );
		const { osSettings, setEffect } = makeOsSettings( 'darken' );

		engine.startUnfocusEngine( {
			manager: makeManager( [ unfocused ] ),
			osSettings,
		} );
		expect( unfocused.element.classList.contains( DARKEN_CLASS ) ).toBe( true );

		setEffect( 'none' );
		expect( unfocused.element.classList.contains( DARKEN_CLASS ) ).toBe(
			false,
		);
		expect(
			unfocused.element.hasAttribute( 'data-desktop-unfocus-effect' ),
		).toBe( false );
	} );

	test( 'reacts to a focus change event', async () => {
		const { engine } = await loadModules();
		const a = makeWin( 'a', true );
		const b = makeWin( 'b', false );
		const { osSettings } = makeOsSettings( 'darken' );

		engine.startUnfocusEngine( {
			manager: makeManager( [ a, b ] ),
			osSettings,
		} );
		expect( a.element.classList.contains( DARKEN_CLASS ) ).toBe( false );
		expect( b.element.classList.contains( DARKEN_CLASS ) ).toBe( true );

		// Focus moves to b.
		a.focused = false;
		b.focused = true;
		document.dispatchEvent(
			new CustomEvent( 'desktop-mode-window-focused', {
				detail: { windowId: 'b' },
			} ),
		);

		expect( a.element.classList.contains( DARKEN_CLASS ) ).toBe( true );
		expect( b.element.classList.contains( DARKEN_CLASS ) ).toBe( false );
	} );
} );
