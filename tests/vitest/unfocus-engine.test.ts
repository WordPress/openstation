import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';
import type { OsSettings } from '../../src/settings';
import type { OsSettingsSnapshot } from '../../src/settings/registry';
import type { WindowManager } from '../../src/window-manager';
import type { Window as DesktopWindow } from '../../src/window';

const DARKEN_CLASS = 'os-window--fx-darken';

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
	element.className = 'os-window';
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

	test( 'does not apply to windows hosting a WebGL <canvas> (Pixi scenes)', async () => {
		const { engine } = await loadModules();
		const pixi = makeWin( 'graph', false );

		pixi.element.appendChild( document.createElement( 'canvas' ) );
		const plain = makeWin( 'posts', false );
		const { osSettings } = makeOsSettings( 'darken' );

		engine.startUnfocusEngine( {
			manager: makeManager( [ pixi, plain ] ),
			osSettings,
		} );

		expect( pixi.element.classList.contains( DARKEN_CLASS ) ).toBe( false );
		expect(
			pixi.element.hasAttribute( 'data-desktop-unfocus-effect' ),
		).toBe( false );
		expect( plain.element.classList.contains( DARKEN_CLASS ) ).toBe( true );
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

	test( 'does not apply to windows in split view', async () => {
		const { engine } = await loadModules();

		const left = makeWin( 'left', true, 'snapped-left' );
		const right = makeWin( 'right', false, 'snapped-right' );
		const floating = makeWin( 'floating', false );
		const { osSettings } = makeOsSettings( 'darken' );

		engine.startUnfocusEngine( {
			manager: makeManager( [ left, right, floating ] ),
			osSettings,
		} );

		expect( right.element.classList.contains( DARKEN_CLASS ) ).toBe(
			false,
		);
		expect(
			right.element.hasAttribute( 'data-desktop-unfocus-effect' ),
		).toBe( false );

		expect( floating.element.classList.contains( DARKEN_CLASS ) ).toBe(
			true,
		);
	} );

	test( 'a half-screen tile is exempt even with the opposite half empty', async () => {
		const { engine } = await loadModules();
		const snapped = makeWin( 'snapped', false, 'snapped-left' );
		const { osSettings } = makeOsSettings( 'darken' );

		engine.startUnfocusEngine( {
			manager: makeManager( [ makeWin( 'a', true ), snapped ] ),
			osSettings,
		} );

		expect( snapped.element.classList.contains( DARKEN_CLASS ) ).toBe(
			false,
		);
	} );

	test( 'recomputes on a state change (un-snapping restores the effect)', async () => {
		const { engine } = await loadModules();
		const snapped = makeWin( 'b', false, 'snapped-right' );
		const { osSettings } = makeOsSettings( 'darken' );

		engine.startUnfocusEngine( {
			manager: makeManager( [ makeWin( 'a', true ), snapped ] ),
			osSettings,
		} );
		expect( snapped.element.classList.contains( DARKEN_CLASS ) ).toBe(
			false,
		);

		snapped.state = 'normal';
		document.dispatchEvent(
			new CustomEvent( 'os-window-changed', {
				detail: { windowId: 'b', reason: 'state', state: 'normal' },
			} ),
		);

		expect( snapped.element.classList.contains( DARKEN_CLASS ) ).toBe(
			true,
		);
	} );

	test( 'ignores the chatty geometry reasons on os-window-changed', async () => {
		const { engine } = await loadModules();
		const b = makeWin( 'b', false );
		const manager = makeManager( [ makeWin( 'a', true ), b ] );
		const getAll = vi.spyOn( manager, 'getAll' );
		const { osSettings } = makeOsSettings( 'darken' );

		engine.startUnfocusEngine( { manager, osSettings } );
		const afterBoot = getAll.mock.calls.length;

		document.dispatchEvent(
			new CustomEvent( 'os-window-changed', {
				detail: { windowId: 'b', reason: 'moved' },
			} ),
		);
		document.dispatchEvent(
			new CustomEvent( 'os-window-changed', {
				detail: { windowId: 'b', reason: 'resized' },
			} ),
		);

		expect( getAll.mock.calls.length ).toBe( afterBoot );
		getAll.mockRestore();
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

		a.focused = false;
		b.focused = true;
		document.dispatchEvent(
			new CustomEvent( 'os-window-focused', {
				detail: { windowId: 'b' },
			} ),
		);

		expect( a.element.classList.contains( DARKEN_CLASS ) ).toBe( true );
		expect( b.element.classList.contains( DARKEN_CLASS ) ).toBe( false );
	} );

	test( 'removes the applied class even after the effect is unregistered', async () => {
		const { engine, registry } = await loadModules();
		const pluginClass = 'plugin-fx-glow';
		registry.registerUnfocusEffect( {
			id: 'plugin/glow',
			label: 'Glow',
			className: pluginClass,
			owner: 'plugin-a',
		} );
		const unfocused = makeWin( 'b', false );

		const { osSettings } = makeOsSettings( 'plugin/glow' );

		engine.startUnfocusEngine( {
			manager: makeManager( [ unfocused ] ),
			osSettings,
		} );
		expect( unfocused.element.classList.contains( pluginClass ) ).toBe(
			true,
		);

		registry.unregisterUnfocusEffectsByOwner( 'plugin-a' );

		expect( unfocused.element.classList.contains( pluginClass ) ).toBe(
			false,
		);
		expect(
			unfocused.element.hasAttribute(
				'data-desktop-unfocus-effect-class',
			),
		).toBe( false );
	} );

	test( 'a second startUnfocusEngine call is a no-op (no doubled listeners)', async () => {
		const { engine } = await loadModules();
		const { osSettings } = makeOsSettings( 'darken' );
		const manager = makeManager( [ makeWin( 'a', true ) ] );

		const spy = vi.spyOn( document, 'addEventListener' );

		engine.startUnfocusEngine( { manager, osSettings } );
		const afterFirst = spy.mock.calls.length;

		engine.startUnfocusEngine( { manager, osSettings } );
		const afterSecond = spy.mock.calls.length;

		expect( afterFirst ).toBeGreaterThan( 0 );
		expect( afterSecond ).toBe( afterFirst );

		spy.mockRestore();
	} );
} );
