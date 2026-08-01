/**
 * Mascot controller — the always-on half that lives in the main
 * bundle: layer ownership, the lazy bundle load, the enable/disable
 * lifecycle, and the config merge chain.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import { MASCOT_DEFAULTS } from '../../src/mascot/config';
import type { MascotHandle, MascotMountOptions } from '../../src/mascot/types';

const loadVendorScript = vi.fn< ( url: string ) => Promise< void > >();

vi.mock( '../../src/wallpapers/vendor-loader', () => ( {
	loadVendorScript: ( url: string ) => loadVendorScript( url ),
} ) );

type ControllerModule = typeof import( '../../src/mascot/controller' );

async function load(): Promise< ControllerModule > {
	return await import( '../../src/mascot/controller' );
}

/**
 * A mount function that records its calls and hands back a stub.
 *
 * Published only once the (mocked) bundle load resolves, mirroring
 * production: the global does not exist until the lazy bundle has
 * actually run. Tests that need it earlier call `install()`.
 */
function stubMount(): {
	calls: MascotMountOptions[];
	handles: MascotHandle[];
	install: () => void;
} {
	const calls: MascotMountOptions[] = [];
	const handles: MascotHandle[] = [];
	const install = (): void => {
		window.desktopModeMountMascot = ( options ) => {
			calls.push( options );
			const handle: MascotHandle = {
				getPosition: () => ( { x: 10, y: 20 } ),
				setPosition: vi.fn(),
				setAnimating: vi.fn(),
				applyConfig: vi.fn(),
				destroy: vi.fn(),
			};
			handles.push( handle );
			return Promise.resolve( handle );
		};
	};
	loadVendorScript.mockImplementation( async () => {
		install();
	} );
	return { calls, handles, install };
}

function shell(): HTMLElement {
	const el = document.createElement( 'div' );
	el.id = 'desktop-mode-shell';
	document.body.appendChild( el );
	return el;
}

beforeEach( () => {
	installHooksStub();
	loadVendorScript.mockReset();
	loadVendorScript.mockResolvedValue( undefined );
	window.localStorage.clear();
} );

afterEach( () => {
	clearHooksStub();
	document.body.innerHTML = '';
	delete window.desktopModeMountMascot;
} );

describe( 'MascotController', () => {
	test( 'stays inert — and downloads nothing — while switched off', async () => {
		const { MascotController } = await load();
		stubMount();
		const controller = new MascotController( {
			shell: shell(),
			bundleUrl: 'https://example.test/mascot.js',
			enabled: false,
			persist: vi.fn(),
		} );
		controller.boot();
		await Promise.resolve();
		expect( loadVendorScript ).not.toHaveBeenCalled();
		expect( document.getElementById( 'desktop-mode-mascot' ) ).toBeNull();
	} );

	test( 'boots straight away when the saved preference is on', async () => {
		const { MascotController, MASCOT_LAYER_ID } = await load();
		const mount = stubMount();
		const controller = new MascotController( {
			shell: shell(),
			bundleUrl: 'https://example.test/mascot.js',
			enabled: true,
			persist: vi.fn(),
		} );
		controller.boot();
		await vi.waitFor( () => expect( mount.calls ).toHaveLength( 1 ) );
		expect( loadVendorScript ).toHaveBeenCalledWith(
			'https://example.test/mascot.js',
		);
		expect( document.getElementById( MASCOT_LAYER_ID ) ).not.toBeNull();
		expect( mount.calls[ 0 ].host.id ).toBe( MASCOT_LAYER_ID );
	} );

	test( 'toggling on persists, mounts, and fires the action', async () => {
		const { MascotController } = await load();
		const mount = stubMount();
		const persist = vi.fn();
		const controller = new MascotController( {
			shell: shell(),
			bundleUrl: 'https://example.test/mascot.js',
			enabled: false,
			persist,
		} );
		const api = controller.api();
		expect( api.isEnabled() ).toBe( false );

		await api.toggle();

		expect( api.isEnabled() ).toBe( true );
		expect( persist ).toHaveBeenCalledWith( true );
		expect( mount.calls ).toHaveLength( 1 );
	} );

	test( 'toggling off destroys the handle and removes the layer', async () => {
		const { MascotController, MASCOT_LAYER_ID } = await load();
		const mount = stubMount();
		const persist = vi.fn();
		const controller = new MascotController( {
			shell: shell(),
			bundleUrl: 'https://example.test/mascot.js',
			enabled: true,
			persist,
		} );
		controller.boot();
		await vi.waitFor( () => expect( mount.handles ).toHaveLength( 1 ) );

		controller.api().disable();

		expect( persist ).toHaveBeenCalledWith( false );
		expect( mount.handles[ 0 ].destroy ).toHaveBeenCalled();
		expect( document.getElementById( MASCOT_LAYER_ID ) ).toBeNull();
	} );

	test( 'a fast on-off-on cycle never leaves two mascots behind', async () => {
		const { MascotController } = await load();
		const mount = stubMount();
		// Hold the bundle load open so the first mount is still in
		// flight when the user changes their mind.
		let release: () => void = () => undefined;
		loadVendorScript.mockImplementation(
			() =>
				new Promise< void >( ( resolve ) => {
					release = () => {
						mount.install();
						resolve();
					};
				} ),
		);

		const controller = new MascotController( {
			shell: shell(),
			bundleUrl: 'https://example.test/mascot.js',
			enabled: false,
			persist: vi.fn(),
		} );
		const api = controller.api();
		const first = api.enable();
		api.disable();
		release();
		await first;

		// The in-flight mount noticed the generation bump and bailed.
		expect( mount.calls ).toHaveLength( 0 );
		expect( api.isEnabled() ).toBe( false );
		expect( document.getElementById( 'desktop-mode-mascot' ) ).toBeNull();
	} );

	test( 'a mount that loses the race cleans up its own layer', async () => {
		const { MascotController, MASCOT_LAYER_ID } = await load();
		const mount = stubMount();
		// The user switches off *while Pixi is booting*, i.e. after
		// the mount call has started. The earlier generation guard
		// has already passed, so this mount has to clean up after
		// itself — layer included.
		mount.install();
		const handles: Array< { destroy: ReturnType< typeof vi.fn > } > = [];
		let disableMidMount: () => void = () => undefined;
		window.desktopModeMountMascot = async () => {
			disableMidMount();
			const handle = {
				getPosition: () => ( { x: 0, y: 0 } ),
				setPosition: vi.fn(),
				setAnimating: vi.fn(),
				applyConfig: vi.fn(),
				destroy: vi.fn(),
			};
			handles.push( handle );
			return handle;
		};

		const controller = new MascotController( {
			shell: shell(),
			bundleUrl: 'https://example.test/mascot.js',
			enabled: false,
			persist: vi.fn(),
		} );
		const api = controller.api();
		disableMidMount = () => api.disable();
		await api.enable();

		expect( handles[ 0 ].destroy ).toHaveBeenCalled();
		expect( document.getElementById( MASCOT_LAYER_ID ) ).toBeNull();
	} );

	test( 'a failed bundle load is not cached — the next toggle retries', async () => {
		const { MascotController } = await load();
		stubMount();
		const warn = vi.spyOn( console, 'warn' ).mockImplementation( () => undefined );
		loadVendorScript.mockRejectedValue( new Error( 'offline' ) );

		const controller = new MascotController( {
			shell: shell(),
			bundleUrl: 'https://example.test/mascot.js',
			enabled: false,
			persist: vi.fn(),
		} );
		const api = controller.api();
		await api.enable();
		expect( loadVendorScript ).toHaveBeenCalledTimes( 1 );

		await api.disable();
		await api.enable();
		expect( loadVendorScript ).toHaveBeenCalledTimes( 2 );
		warn.mockRestore();
	} );

	test( 'server config layers over the defaults and is clamped', async () => {
		const { MascotController } = await load();
		stubMount();
		const controller = new MascotController( {
			shell: shell(),
			bundleUrl: '',
			enabled: false,
			persist: vi.fn(),
			serverConfig: {
				appearance: { radius: 90, hueStart: 200 },
				physics: { magnetStrength: -999 },
			},
		} );
		const config = controller.api().getConfig();
		expect( config.appearance.radius ).toBe( 90 );
		expect( config.appearance.hueStart ).toBe( 200 );
		// Clamped, not rejected.
		expect( config.physics.magnetStrength ).toBe( 0 );
		// Untouched keys keep the reference design.
		expect( config.appearance.hueSpan ).toBe(
			MASCOT_DEFAULTS.appearance.hueSpan,
		);
	} );

	test( 'the desktop-mode.mascot.config filter can restyle the mascot', async () => {
		const { MascotController } = await load();
		stubMount();
		const hooks = ( window.wp as {
			hooks: { addFilter: ( ...a: unknown[] ) => void };
		} ).hooks;
		hooks.addFilter(
			'desktop-mode.mascot.config',
			'test/teal',
			( value ) => {
				const config = value as typeof MASCOT_DEFAULTS;
				return {
					...config,
					appearance: { ...config.appearance, hueStart: 170 },
				};
			},
		);
		const controller = new MascotController( {
			shell: shell(),
			bundleUrl: '',
			enabled: false,
			persist: vi.fn(),
		} );
		expect( controller.api().getConfig().appearance.hueStart ).toBe( 170 );
	} );

	test( 'setConfig live-applies to a mounted mascot', async () => {
		const { MascotController } = await load();
		const mount = stubMount();
		const controller = new MascotController( {
			shell: shell(),
			bundleUrl: 'https://example.test/mascot.js',
			enabled: true,
			persist: vi.fn(),
		} );
		controller.boot();
		await vi.waitFor( () => expect( mount.handles ).toHaveLength( 1 ) );

		controller.api().setConfig( { appearance: { glow: 2 } } );

		expect( controller.api().getConfig().appearance.glow ).toBe( 2 );
		expect( mount.handles[ 0 ].applyConfig ).toHaveBeenCalledWith(
			expect.objectContaining( {
				appearance: expect.objectContaining( { glow: 2 } ),
			} ),
		);
	} );

	test( 'the saved position round-trips through localStorage', async () => {
		const { MascotController } = await load();
		const mount = stubMount();
		window.localStorage.setItem(
			'desktop-mode-mascot-position',
			JSON.stringify( { x: 640, y: 480 } ),
		);
		const controller = new MascotController( {
			shell: shell(),
			bundleUrl: 'https://example.test/mascot.js',
			enabled: true,
			persist: vi.fn(),
		} );
		controller.boot();
		await vi.waitFor( () => expect( mount.calls ).toHaveLength( 1 ) );

		expect( mount.calls[ 0 ].position ).toEqual( { x: 640, y: 480 } );

		mount.calls[ 0 ].savePosition( { x: 12, y: 34 } );
		expect(
			window.localStorage.getItem( 'desktop-mode-mascot-position' ),
		).toBe( JSON.stringify( { x: 12, y: 34 } ) );
	} );

	test( 'a corrupt saved position is ignored rather than thrown', async () => {
		const { MascotController } = await load();
		const mount = stubMount();
		window.localStorage.setItem( 'desktop-mode-mascot-position', 'not-json' );
		const controller = new MascotController( {
			shell: shell(),
			bundleUrl: 'https://example.test/mascot.js',
			enabled: true,
			persist: vi.fn(),
		} );
		controller.boot();
		await vi.waitFor( () => expect( mount.calls ).toHaveLength( 1 ) );
		expect( mount.calls[ 0 ].position ).toBeNull();
	} );
} );
