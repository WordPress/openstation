/**
 * Mio controller — the always-on half that lives in the main
 * bundle: layer ownership, the lazy bundle load, the enable/disable
 * lifecycle, and the config merge chain.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import { MIO_DEFAULTS } from '../../src/mio/config';
import type { MioHandle, MioMountOptions } from '../../src/mio/types';

const loadVendorScript = vi.fn< ( url: string ) => Promise< void > >();

vi.mock( '../../src/wallpapers/vendor-loader', () => ( {
	loadVendorScript: ( url: string ) => loadVendorScript( url ),
} ) );

type ControllerModule = typeof import( '../../src/mio/controller' );

async function load(): Promise< ControllerModule > {
	return await import( '../../src/mio/controller' );
}

/**
 * A mount function that records its calls and hands back a stub.
 *
 * Published only once the (mocked) bundle load resolves, mirroring
 * production: the global does not exist until the lazy bundle has
 * actually run. Tests that need it earlier call `install()`.
 */
function stubMount(): {
	calls: MioMountOptions[];
	handles: MioHandle[];
	install: () => void;
} {
	const calls: MioMountOptions[] = [];
	const handles: MioHandle[] = [];
	const install = (): void => {
		window.desktopModeMountMio = ( options ) => {
			calls.push( options );
			const handle: MioHandle = {
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
	delete window.desktopModeMountMio;
} );

describe( 'MioController', () => {
	test( 'stays inert — and downloads nothing — while switched off', async () => {
		const { MioController } = await load();
		stubMount();
		const controller = new MioController( {
			shell: shell(),
			bundleUrl: 'https://example.test/mio.js',
			enabled: false,
			persist: vi.fn(),
		} );
		controller.boot();
		await Promise.resolve();
		expect( loadVendorScript ).not.toHaveBeenCalled();
		expect( document.getElementById( 'desktop-mode-mio' ) ).toBeNull();
	} );

	test( 'boots straight away when the saved preference is on', async () => {
		const { MioController, MIO_LAYER_ID } = await load();
		const mount = stubMount();
		const controller = new MioController( {
			shell: shell(),
			bundleUrl: 'https://example.test/mio.js',
			enabled: true,
			persist: vi.fn(),
		} );
		controller.boot();
		await vi.waitFor( () => expect( mount.calls ).toHaveLength( 1 ) );
		expect( loadVendorScript ).toHaveBeenCalledWith(
			'https://example.test/mio.js',
		);
		expect( document.getElementById( MIO_LAYER_ID ) ).not.toBeNull();
		expect( mount.calls[ 0 ].host.id ).toBe( MIO_LAYER_ID );
	} );

	test( 'toggling on persists, mounts, and fires the action', async () => {
		const { MioController } = await load();
		const mount = stubMount();
		const persist = vi.fn();
		const controller = new MioController( {
			shell: shell(),
			bundleUrl: 'https://example.test/mio.js',
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

	test( 'setStyle persists and survives a remount', async () => {
		const { MioController } = await load();
		const mount = stubMount();
		const persistLook = vi.fn();
		const controller = new MioController( {
			shell: shell(),
			bundleUrl: 'https://example.test/mio.js',
			enabled: true,
			persist: vi.fn(),
			persistLook,
		} );
		controller.boot();
		await vi.waitFor( () => expect( mount.handles ).toHaveLength( 1 ) );

		controller.api().setStyle( { glow: 2.5 } );
		expect( controller.api().getConfig().appearance.glow ).toBe( 2.5 );
		expect( mount.handles[ 0 ].applyConfig ).toHaveBeenCalled();
		expect( persistLook ).toHaveBeenCalledWith( {
			appearance: { glow: 2.5 },
			physics: {},
		} );

		// A fresh controller handed what was stored — i.e. the next page
		// load, with the look coming back from user meta.
		const next = new MioController( {
			shell: shell(),
			bundleUrl: 'https://example.test/mio.js',
			enabled: false,
			persist: vi.fn(),
			savedLook: persistLook.mock.calls[ 0 ][ 0 ],
		} );
		expect( next.api().getConfig().appearance.glow ).toBe( 2.5 );
	} );

	test( 'setStyle splits a flat look into appearance and physics', async () => {
		const { MioController } = await load();
		const persistLook = vi.fn();
		const controller = new MioController( {
			shell: shell(),
			bundleUrl: 'https://example.test/mio.js',
			enabled: false,
			persist: vi.fn(),
			persistLook,
		} );

		// The stiffness rides along in the same object and must be
		// dropped: the panel is not a way into the springs.
		controller.api().setStyle( {
			glow: 2,
			shapePreset: 'star',
			idleWobble: 0,
			radialStiffness: 4,
		} as never );

		const config = controller.api().getConfig();
		expect( config.appearance.glow ).toBe( 2 );
		expect( config.physics.shapePreset ).toBe( 'star' );
		expect( config.physics.idleWobble ).toBe( 0 );
		expect( config.physics.radialStiffness ).toBe(
			MIO_DEFAULTS.physics.radialStiffness,
		);
		expect( persistLook ).toHaveBeenCalledWith( {
			appearance: { glow: 2 },
			physics: { shapePreset: 'star', idleWobble: 0 },
		} );
	} );

	test( 'a saved look is clamped like any other untrusted input', async () => {
		const { MioController } = await load();
		const controller = new MioController( {
			shell: shell(),
			bundleUrl: 'https://example.test/mio.js',
			enabled: false,
			persist: vi.fn(),
			savedLook: {
				appearance: { glow: 999, saturation: -4 },
				physics: { shapePreset: 'nonsense', shapeAmount: 40 },
			},
		} );
		const { appearance, physics } = controller.api().getConfig();
		expect( appearance.glow ).toBe( 3 );
		expect( appearance.saturation ).toBe( 0 );
		// An unknown preset falls back rather than throwing.
		expect( physics.shapePreset ).toBe( MIO_DEFAULTS.physics.shapePreset );
		expect( physics.shapeAmount ).toBe( 1.4 );
	} );

	test( 'a corrupt saved look is ignored, not fatal', async () => {
		const { MioController } = await load();
		for ( const savedLook of [
			'{{{not json',
			42,
			[ 'nope' ],
			{ appearance: 'nope' },
			null,
		] ) {
			const controller = new MioController( {
				shell: shell(),
				bundleUrl: 'https://example.test/mio.js',
				enabled: false,
				persist: vi.fn(),
				savedLook,
			} );
			expect( controller.api().getConfig().appearance.glow ).toBe(
				MIO_DEFAULTS.appearance.glow,
			);
		}
	} );

	test( 'resetStyle forgets the saved look and restores the site default', async () => {
		const { MioController } = await load();
		const mount = stubMount();
		const persistLook = vi.fn();
		const controller = new MioController( {
			shell: shell(),
			bundleUrl: 'https://example.test/mio.js',
			enabled: true,
			persist: vi.fn(),
			persistLook,
		} );
		controller.boot();
		await vi.waitFor( () => expect( mount.handles ).toHaveLength( 1 ) );

		controller.api().setStyle( { glow: 0 } );
		controller.api().setStyle( { shapePreset: 'heart' } );
		controller.api().resetStyle();

		expect( controller.api().getConfig().appearance.glow ).toBe(
			MIO_DEFAULTS.appearance.glow,
		);
		expect( controller.api().getConfig().physics.shapePreset ).toBe(
			MIO_DEFAULTS.physics.shapePreset,
		);
		// The empty look is written too — "Restore Mio" has to travel to
		// the user's other devices, and only a save can carry it.
		expect( persistLook ).toHaveBeenLastCalledWith( {
			appearance: {},
			physics: {},
		} );
	} );

	test( 'setConfig does NOT persist — only setStyle does', async () => {
		// The programmatic surface must stay programmatic: a plugin
		// nudging Mio for a moment shouldn't silently become the user's
		// saved look.
		const { MioController } = await load();
		const persistLook = vi.fn();
		const controller = new MioController( {
			shell: shell(),
			bundleUrl: 'https://example.test/mio.js',
			enabled: false,
			persist: vi.fn(),
			persistLook,
		} );
		controller.api().setConfig( { appearance: { glow: 0.25 } } );
		expect( persistLook ).not.toHaveBeenCalled();
		expect( controller.api().getLook() ).toEqual( {
			appearance: {},
			physics: {},
		} );
	} );

	test( 'commitStyle writes the current look on demand', async () => {
		const { MioController } = await load();
		const persistLook = vi.fn();
		const controller = new MioController( {
			shell: shell(),
			bundleUrl: 'https://example.test/mio.js',
			enabled: false,
			persist: vi.fn(),
			persistLook,
		} );
		controller.api().setStyle( { glow: 1 } );
		persistLook.mockClear();

		controller.api().commitStyle();
		expect( persistLook ).toHaveBeenCalledWith( {
			appearance: { glow: 1 },
			physics: {},
		} );
	} );

	test( 'the look survives a controller with nowhere to persist it', async () => {
		// `persistLook` is optional — a host that hasn't wired storage
		// should still get a working panel for the session.
		const { MioController } = await load();
		const controller = new MioController( {
			shell: shell(),
			bundleUrl: 'https://example.test/mio.js',
			enabled: false,
			persist: vi.fn(),
		} );
		controller.api().setStyle( { glow: 1.5 } );
		controller.api().commitStyle();
		expect( controller.api().getConfig().appearance.glow ).toBe( 1.5 );
	} );

	test( 'toggling off parks the instance rather than destroying it', async () => {
		// Releasing a WebGL context makes the browser re-rasterise the
		// whole shell, which is what surfaced as a white flash. No
		// toggle may do it — the instance is stopped and hidden instead.
		const { MioController, MIO_LAYER_ID } = await load();
		const mount = stubMount();
		const persist = vi.fn();
		const controller = new MioController( {
			shell: shell(),
			bundleUrl: 'https://example.test/mio.js',
			enabled: true,
			persist,
		} );
		controller.boot();
		await vi.waitFor( () => expect( mount.handles ).toHaveLength( 1 ) );

		controller.api().disable();

		expect( persist ).toHaveBeenCalledWith( false );
		expect( mount.handles[ 0 ].destroy ).not.toHaveBeenCalled();
		expect( mount.handles[ 0 ].setAnimating ).toHaveBeenCalledWith( false );
		// The layer stays in the DOM, hidden and inert.
		const layer = document.getElementById( MIO_LAYER_ID );
		expect( layer?.style.display ).toBe( 'none' );
	} );

	test( 'disabling records where Mio was, not where hiding leaves it', async () => {
		// Regression: hiding the layer makes the host report zero size,
		// and every position derived from a zero-size host is the
		// top-left corner. The resting place has to be read first.
		const { MioController } = await load();
		const mount = stubMount();
		const controller = new MioController( {
			shell: shell(),
			bundleUrl: 'https://example.test/mio.js',
			enabled: true,
			persist: vi.fn(),
		} );
		controller.boot();
		await vi.waitFor( () => expect( mount.handles ).toHaveLength( 1 ) );

		controller.api().disable();

		// The stub handle rests at (10, 20) — that, not a corner.
		expect(
			JSON.parse(
				window.localStorage.getItem( 'desktop-mode-mio-position' ) ??
					'null',
			),
		).toEqual( { x: 10, y: 20 } );
	} );

	test( 're-enabling wakes the parked instance, it does not build a new one', async () => {
		// The payoff of parking, and the thing that proves no second
		// WebGL context was created: `mount` is never called twice.
		const { MioController, MIO_LAYER_ID } = await load();
		const mount = stubMount();
		const controller = new MioController( {
			shell: shell(),
			bundleUrl: 'https://example.test/mio.js',
			enabled: true,
			persist: vi.fn(),
		} );
		controller.boot();
		await vi.waitFor( () => expect( mount.handles ).toHaveLength( 1 ) );

		controller.api().disable();
		await controller.api().enable();

		expect( mount.calls ).toHaveLength( 1 );
		expect( mount.handles[ 0 ].setAnimating ).toHaveBeenLastCalledWith(
			true,
		);
		const layer = document.getElementById( MIO_LAYER_ID );
		expect( layer?.isConnected ).toBe( true );
		expect( layer?.style.display ).toBe( '' );
	} );

	test( 'a fast on-off-on cycle never leaves two mios behind', async () => {
		const { MioController } = await load();
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

		const controller = new MioController( {
			shell: shell(),
			bundleUrl: 'https://example.test/mio.js',
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
		expect( document.getElementById( 'desktop-mode-mio' ) ).toBeNull();
	} );

	test( 'a mount that loses the race cleans up its own layer', async () => {
		const { MioController, MIO_LAYER_ID } = await load();
		const mount = stubMount();
		// The user switches off *while Pixi is booting*, i.e. after
		// the mount call has started. The earlier generation guard
		// has already passed, so this mount has to clean up after
		// itself — layer included.
		mount.install();
		const handles: Array< { destroy: ReturnType< typeof vi.fn > } > = [];
		let disableMidMount: () => void = () => undefined;
		window.desktopModeMountMio = async () => {
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

		const controller = new MioController( {
			shell: shell(),
			bundleUrl: 'https://example.test/mio.js',
			enabled: false,
			persist: vi.fn(),
		} );
		const api = controller.api();
		disableMidMount = () => api.disable();
		await api.enable();

		expect( handles[ 0 ].destroy ).toHaveBeenCalled();
		expect( document.getElementById( MIO_LAYER_ID ) ).toBeNull();
	} );

	test( 'a failed bundle load is not cached — the next toggle retries', async () => {
		const { MioController } = await load();
		stubMount();
		const warn = vi.spyOn( console, 'warn' ).mockImplementation( () => undefined );
		loadVendorScript.mockRejectedValue( new Error( 'offline' ) );

		const controller = new MioController( {
			shell: shell(),
			bundleUrl: 'https://example.test/mio.js',
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
		const { MioController } = await load();
		stubMount();
		const controller = new MioController( {
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
			MIO_DEFAULTS.appearance.hueSpan,
		);
	} );

	test( 'the desktop-mode.mio.config filter can restyle Mio', async () => {
		const { MioController } = await load();
		stubMount();
		const hooks = ( window.wp as {
			hooks: { addFilter: ( ...a: unknown[] ) => void };
		} ).hooks;
		hooks.addFilter(
			'desktop-mode.mio.config',
			'test/teal',
			( value ) => {
				const config = value as typeof MIO_DEFAULTS;
				return {
					...config,
					appearance: { ...config.appearance, hueStart: 170 },
				};
			},
		);
		const controller = new MioController( {
			shell: shell(),
			bundleUrl: '',
			enabled: false,
			persist: vi.fn(),
		} );
		expect( controller.api().getConfig().appearance.hueStart ).toBe( 170 );
	} );

	test( 'setConfig live-applies to a mounted mio', async () => {
		const { MioController } = await load();
		const mount = stubMount();
		const controller = new MioController( {
			shell: shell(),
			bundleUrl: 'https://example.test/mio.js',
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
		const { MioController } = await load();
		const mount = stubMount();
		window.localStorage.setItem(
			'desktop-mode-mio-position',
			JSON.stringify( { x: 640, y: 480 } ),
		);
		const controller = new MioController( {
			shell: shell(),
			bundleUrl: 'https://example.test/mio.js',
			enabled: true,
			persist: vi.fn(),
		} );
		controller.boot();
		await vi.waitFor( () => expect( mount.calls ).toHaveLength( 1 ) );

		expect( mount.calls[ 0 ].position ).toEqual( { x: 640, y: 480 } );

		mount.calls[ 0 ].savePosition( { x: 12, y: 34 } );
		expect(
			window.localStorage.getItem( 'desktop-mode-mio-position' ),
		).toBe( JSON.stringify( { x: 12, y: 34 } ) );
	} );

	test( 'a corrupt saved position is ignored rather than thrown', async () => {
		const { MioController } = await load();
		const mount = stubMount();
		window.localStorage.setItem( 'desktop-mode-mio-position', 'not-json' );
		const controller = new MioController( {
			shell: shell(),
			bundleUrl: 'https://example.test/mio.js',
			enabled: true,
			persist: vi.fn(),
		} );
		controller.boot();
		await vi.waitFor( () => expect( mount.calls ).toHaveLength( 1 ) );
		expect( mount.calls[ 0 ].position ).toBeNull();
	} );
} );
