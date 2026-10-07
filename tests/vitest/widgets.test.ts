import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	clearHooksStub,
	installHooksStub,
	recordActions,
	type FakeWpHooks,
} from './helpers/hooks-stub';

const WIDGET_HOOKS = [
	'os.widget.mounting',
	'os.widget.mounted',
	'os.widget.unmounting',
	'os.widget.mount-failed',
	'os.widget.added',
	'os.widget.removed',
] as const;

describe( 'widgets/registry', () => {
	let hooks: FakeWpHooks;

	beforeEach( async () => {
		hooks = installHooksStub();
		vi.resetModules();

		try {
			window.localStorage.removeItem( 'desktop-mode-widgets' );
		} catch {

		}
	} );

	afterEach( () => {
		clearHooksStub();
	} );

	test( 'register stores a valid def; all() returns it', async () => {
		const registry = await import( '../../src/widgets/registry' );
		registry.register( {
			id: 'a',
			label: 'A',
			description: 'alpha',
			icon: 'dashicons-star-filled',
			mount: () => () => undefined,
		} );
		const list = registry.all();
		expect( list.map( ( w ) => w.id ) ).toEqual( [ 'a' ] );
	} );

	test( 'register throws RegistrationError on invalid defs', async () => {
		const registry = await import( '../../src/widgets/registry' );
		expect( () =>
			registry.register( {
				id: '',
				label: 'x',
				description: '',
				icon: 'i',
				mount: () => () => undefined,
			} as unknown as never ),
		).toThrow( /Widget registration rejected/ );
	} );

	test( 'register late-wins on id conflict', async () => {
		const registry = await import( '../../src/widgets/registry' );
		const first = {
			id: 'x',
			label: 'First',
			description: '',
			icon: 'dashicons-clock',
			mount: () => () => undefined,
		};
		const second = { ...first, label: 'Second' };
		registry.register( first );
		registry.register( second );
		expect( registry.get( 'x' )?.label ).toBe( 'Second' );
	} );

	test( 'plugins can filter the registry via os.widgets', async () => {
		const registry = await import( '../../src/widgets/registry' );
		registry.register( {
			id: 'keep',
			label: 'Keep',
			description: '',
			icon: 'dashicons-star-filled',
			mount: () => () => undefined,
		} );
		registry.register( {
			id: 'drop',
			label: 'Drop',
			description: '',
			icon: 'dashicons-trash',
			mount: () => () => undefined,
		} );
		hooks.addFilter(
			'os.widgets',
			'test/filter',
			( list: unknown ) =>
				( list as Array<{ id: string }> ).filter(
					( w ) => w.id !== 'drop',
				),
		);
		expect( registry.all().map( ( w ) => w.id ) ).toEqual( [ 'keep' ] );
	} );
} );

describe( 'widgets/layer', () => {
	let hooks: FakeWpHooks;
	let host: HTMLElement;

	beforeEach( async () => {
		hooks = installHooksStub();
		vi.resetModules();
		try {
			window.localStorage.removeItem( 'desktop-mode-widgets' );
			window.localStorage.removeItem( 'desktop-mode-widgets-geometry' );
			window.localStorage.removeItem(
				'desktop-mode-widgets-docked-heights',
			);
		} catch {

		}
		host = document.createElement( 'aside' );
		document.body.appendChild( host );
	} );

	afterEach( () => {
		host.remove();
		clearHooksStub();
	} );

	test( 'hydrate on first run seeds the clock default if registered', async () => {
		const registry = await import( '../../src/widgets/registry' );
		const { WidgetLayer } = await import( '../../src/widgets/layer' );
		registry.register( {
			id: 'clock',
			label: 'Clock',
			description: '',
			icon: 'dashicons-clock',
			mount: ( body ) => {
				body.textContent = 'tick';
				return () => undefined;
			},
		} );
		const log = recordActions( hooks, WIDGET_HOOKS );

		const layer = new WidgetLayer( host, 'http://example.test/plugin' );
		layer.hydrate();

		expect( layer.getEnabledIds() ).toEqual( [ 'clock' ] );
		const names = log.map( ( e ) => e.name );
		expect( names ).toContain( 'os.widget.mounting' );
		expect( names ).toContain( 'os.widget.mounted' );
		expect( host.querySelector( '.os-widgets__card' ) ).not.toBeNull();
		expect( host.textContent ).toContain( 'tick' );
	} );

	test( 'hydrate preserves an empty saved list (user removed default)', async () => {
		window.localStorage.setItem( 'desktop-mode-widgets', '[]' );
		const registry = await import( '../../src/widgets/registry' );
		const { WidgetLayer } = await import( '../../src/widgets/layer' );
		registry.register( {
			id: 'clock',
			label: 'Clock',
			description: '',
			icon: 'dashicons-clock',
			mount: () => () => undefined,
		} );

		const layer = new WidgetLayer( host, '' );
		layer.hydrate();

		expect( layer.getEnabledIds() ).toEqual( [] );
		expect( host.querySelector( '.os-widgets__card' ) ).toBeNull();
	} );

	test( 'add mounts + fires added + persists', async () => {
		const registry = await import( '../../src/widgets/registry' );
		const { WidgetLayer } = await import( '../../src/widgets/layer' );
		registry.register( {
			id: 'stats',
			label: 'Stats',
			description: '',
			icon: 'dashicons-chart-bar',
			mount: ( body ) => {
				body.textContent = 'stats';
				return () => undefined;
			},
		} );
		const layer = new WidgetLayer( host, '' );
		layer.hydrate();
		layer.remove( 'clock' );
		const log = recordActions( hooks, WIDGET_HOOKS );

		layer.add( 'stats' );

		expect( layer.getEnabledIds() ).toContain( 'stats' );
		expect(
			JSON.parse( window.localStorage.getItem( 'desktop-mode-widgets' )! ),
		).toContain( 'stats' );
		const names = log.map( ( e ) => e.name );
		expect( names ).toContain( 'os.widget.added' );
		expect( names ).toContain( 'os.widget.mounting' );
		expect( names ).toContain( 'os.widget.mounted' );
	} );

	test( 'add is idempotent — calling twice fires only one added + mounts once', async () => {
		const registry = await import( '../../src/widgets/registry' );
		const { WidgetLayer } = await import( '../../src/widgets/layer' );
		registry.register( {
			id: 'x',
			label: 'X',
			description: '',
			icon: 'dashicons-star-filled',
			mount: () => () => undefined,
		} );
		const layer = new WidgetLayer( host, '' );
		layer.hydrate();
		layer.remove( 'clock' );
		const log = recordActions( hooks, WIDGET_HOOKS );

		layer.add( 'x' );
		layer.add( 'x' );

		const addedCount = log.filter(
			( e ) => e.name === 'os.widget.added',
		).length;
		const mountedCount = log.filter(
			( e ) => e.name === 'os.widget.mounted',
		).length;
		expect( addedCount ).toBe( 1 );
		expect( mountedCount ).toBe( 1 );
	} );

	test( 'remove tears down + fires removed + persists', async () => {
		const registry = await import( '../../src/widgets/registry' );
		const { WidgetLayer } = await import( '../../src/widgets/layer' );
		let teardownFired = false;
		registry.register( {
			id: 'x',
			label: 'X',
			description: '',
			icon: 'dashicons-star-filled',
			mount: () => () => {
				teardownFired = true;
			},
		} );
		const layer = new WidgetLayer( host, '' );
		layer.hydrate();
		layer.remove( 'clock' );
		layer.add( 'x' );
		const log = recordActions( hooks, WIDGET_HOOKS );

		layer.remove( 'x' );

		expect( teardownFired ).toBe( true );
		expect( layer.getEnabledIds() ).not.toContain( 'x' );
		const names = log.map( ( e ) => e.name );
		expect( names ).toContain( 'os.widget.unmounting' );
		expect( names ).toContain( 'os.widget.removed' );
	} );

	test( 'async mount rejection fires mount-failed (not mounted)', async () => {
		const registry = await import( '../../src/widgets/registry' );
		const { WidgetLayer } = await import( '../../src/widgets/layer' );
		const err = new Error( 'no network' );
		registry.register( {
			id: 'bad',
			label: 'Bad',
			description: '',
			icon: 'dashicons-warning',
			mount: () => Promise.reject( err ),
		} );

		const errSpy = vi
			.spyOn( console, 'error' )
			.mockImplementation( () => {} );
		const layer = new WidgetLayer( host, '' );
		layer.hydrate();
		layer.remove( 'clock' );
		const log = recordActions( hooks, WIDGET_HOOKS );

		layer.add( 'bad' );
		await Promise.resolve();
		await Promise.resolve();

		const names = log.map( ( e ) => e.name );
		expect( names ).toContain( 'os.widget.mount-failed' );
		expect( names ).not.toContain( 'os.widget.mounted' );
		errSpy.mockRestore();
	} );

	test( 'movable widget renders a chrome header with drag grip', async () => {
		const registry = await import( '../../src/widgets/registry' );
		const { WidgetLayer } = await import( '../../src/widgets/layer' );
		registry.register( {
			id: 'mov',
			label: 'Mov',
			description: '',
			icon: 'dashicons-star-filled',
			movable: true,
			mount: () => () => undefined,
		} );
		window.localStorage.setItem( 'desktop-mode-widgets', '[]' );

		const layer = new WidgetLayer( host, '' );
		layer.hydrate();
		layer.add( 'mov' );

		const card = host.querySelector( '.os-widgets__card' );
		expect( card ).not.toBeNull();
		expect( card!.classList.contains( 'os-widgets__card--movable' ) ).toBe( true );
		expect( card!.querySelector( '.os-widgets__chrome' ) ).not.toBeNull();
		expect( card!.querySelector( '.os-widgets__grip' ) ).not.toBeNull();
	} );

	test( 'non-movable widget has no chrome; close sits in the corner', async () => {
		const registry = await import( '../../src/widgets/registry' );
		const { WidgetLayer } = await import( '../../src/widgets/layer' );
		registry.register( {
			id: 'static',
			label: 'Static',
			description: '',
			icon: 'dashicons-star-filled',
			mount: () => () => undefined,
		} );
		window.localStorage.setItem( 'desktop-mode-widgets', '[]' );

		const layer = new WidgetLayer( host, '' );
		layer.hydrate();
		layer.add( 'static' );

		const card = host.querySelector( '.os-widgets__card' )!;
		expect( card.classList.contains( 'os-widgets__card--movable' ) ).toBe( false );
		expect( card.querySelector( '.os-widgets__chrome' ) ).toBeNull();

		expect(
			card.querySelector( '.os-widgets__card-close--corner' ),
		).not.toBeNull();
	} );

	test( 'resizable widget renders resize handles', async () => {
		const registry = await import( '../../src/widgets/registry' );
		const { WidgetLayer } = await import( '../../src/widgets/layer' );
		registry.register( {
			id: 'res',
			label: 'Res',
			description: '',
			icon: 'dashicons-star-filled',
			resizable: true,
			mount: () => () => undefined,
		} );
		window.localStorage.setItem( 'desktop-mode-widgets', '[]' );

		const layer = new WidgetLayer( host, '' );
		layer.hydrate();
		layer.add( 'res' );

		const card = host.querySelector( '.os-widgets__card' )!;
		expect( card.classList.contains( 'os-widgets__card--resizable' ) ).toBe( true );
		expect( card.querySelectorAll( '.os-widgets__resize' ).length ).toBe( 8 );
	} );

	test( 'persisted geometry mounts a movable widget floating', async () => {
		const registry = await import( '../../src/widgets/registry' );
		const { WidgetLayer } = await import( '../../src/widgets/layer' );
		registry.register( {
			id: 'mov',
			label: 'Mov',
			description: '',
			icon: 'dashicons-star-filled',
			movable: true,
			mount: () => () => undefined,
		} );
		window.localStorage.setItem( 'desktop-mode-widgets', '["mov"]' );
		window.localStorage.setItem(
			'desktop-mode-widgets-geometry',
			JSON.stringify( { mov: { x: 50, y: 70, width: 240, height: 120 } } ),
		);

		const layer = new WidgetLayer( host, '' );
		layer.hydrate();

		const card = document.body.querySelector<HTMLElement>(
			'.os-widgets__card',
		)!;
		expect( card.classList.contains( 'os-widgets__card--floating' ) ).toBe( true );
		expect( card.style.left ).toBe( '50px' );
		expect( card.style.top ).toBe( '70px' );
		expect( card.style.width ).toBe( '240px' );
		expect( card.style.height ).toBe( '120px' );

		layer.disposeAll();
	} );

	test( 'liberating a docked widget preserves its CURRENT rendered size, not the registered default', async () => {

		const registry = await import( '../../src/widgets/registry' );
		const { WidgetLayer } = await import( '../../src/widgets/layer' );
		registry.register( {
			id: 'compact-mov',
			label: 'Compact movable',
			description: '',
			icon: 'dashicons-star-filled',
			movable: true,

			defaultWidth: 310,
			defaultHeight: 230,
			mount: () => () => undefined,
		} );
		window.localStorage.setItem( 'desktop-mode-widgets', '["compact-mov"]' );

		const layer = new WidgetLayer( host, '' );
		layer.hydrate();
		const card = host.querySelector< HTMLElement >(
			'.os-widgets__card',
		)!;
		expect( card ).toBeTruthy();

		card.getBoundingClientRect = (): DOMRect => ( {
			x: 100, y: 200, width: 310, height: 88,
			top: 200, left: 100, right: 410, bottom: 288,
			toJSON: () => ( {} ),
		} );
		Object.defineProperty( card, 'offsetWidth', { configurable: true, get: () => 310 } );
		Object.defineProperty( card, 'offsetHeight', { configurable: true, get: () => 88 } );
		document.body.getBoundingClientRect = (): DOMRect => ( {
			x: 0, y: 0, width: 1024, height: 768,
			top: 0, left: 0, right: 1024, bottom: 768,
			toJSON: () => ( {} ),
		} );

		const ptr = ( type: string, x: number, y: number ): Event => {
			const e = new Event( type, { bubbles: true } );
			Object.defineProperty( e, 'pointerId', { value: 1 } );
			Object.defineProperty( e, 'button', { value: 0 } );
			Object.defineProperty( e, 'clientX', { value: x } );
			Object.defineProperty( e, 'clientY', { value: y } );
			return e;
		};
		const chrome = card.querySelector< HTMLElement >(
			'.os-widgets__chrome',
		)!;

		( chrome as unknown as { setPointerCapture: () => void } ).setPointerCapture = () => undefined;
		( chrome as unknown as { releasePointerCapture: () => void } ).releasePointerCapture = () => undefined;
		chrome.dispatchEvent( ptr( 'pointerdown', 110, 210 ) );
		chrome.dispatchEvent( ptr( 'pointermove', 200, 300 ) );
		chrome.dispatchEvent( ptr( 'pointerup', 200, 300 ) );

		expect( card.classList.contains( 'os-widgets__card--floating' ) ).toBe( true );
		expect( card.style.height ).toBe( '88px' );
		expect( card.style.width ).toBe( '310px' );

		const geom = JSON.parse(
			window.localStorage.getItem( 'desktop-mode-widgets-geometry' ) || '{}',
		);
		expect( geom[ 'compact-mov' ].height ).toBe( 88 );

		layer.disposeAll();
	} );

	test( 'removing a widget drops its persisted geometry', async () => {
		const registry = await import( '../../src/widgets/registry' );
		const { WidgetLayer } = await import( '../../src/widgets/layer' );
		registry.register( {
			id: 'mov',
			label: 'Mov',
			description: '',
			icon: 'dashicons-star-filled',
			movable: true,
			mount: () => () => undefined,
		} );
		window.localStorage.setItem( 'desktop-mode-widgets', '["mov"]' );
		window.localStorage.setItem(
			'desktop-mode-widgets-geometry',
			JSON.stringify( { mov: { x: 10, y: 20, width: 200, height: 100 } } ),
		);

		const layer = new WidgetLayer( host, '' );
		layer.hydrate();
		layer.remove( 'mov' );

		const geom = JSON.parse(
			window.localStorage.getItem( 'desktop-mode-widgets-geometry' ) || '{}',
		);
		expect( geom.mov ).toBeUndefined();
	} );

	test( 'computeResize clamps to parent + respects minima', async () => {
		const { computeResize } = await import( '../../src/widgets/frame' );
		const parent = document.createElement( 'div' );
		Object.defineProperty( parent, 'clientWidth', { value: 1000, configurable: true } );
		Object.defineProperty( parent, 'clientHeight', { value: 600, configurable: true } );

		const def = {
			id: 'x',
			label: 'X',
			description: '',
			icon: 'dashicons-star-filled',
			minWidth: 120,
			minHeight: 80,
			mount: () => () => undefined,
		};

		const bigDrag = computeResize(
			'se',
			1000,
			1000,
			100,
			100,
			300,
			200,
			def,
			parent,
			true,
		);
		expect( bigDrag.width ).toBe( 1000 - 100 );
		expect( bigDrag.height ).toBe( 600 - 100 );

		const tinyDrag = computeResize(
			'se',
			-1000,
			-1000,
			100,
			100,
			300,
			200,
			def,
			parent,
			true,
		);
		expect( tinyDrag.width ).toBe( 120 );
		expect( tinyDrag.height ).toBe( 80 );

		const docked = computeResize(
			'se',
			200,
			200,
			100,
			100,
			300,
			200,
			def,
			parent,
			false,
		);
		expect( docked.width ).toBe( 300 );
		expect( docked.x ).toBe( 100 );
		expect( docked.height ).toBe( 400 );
	} );

	test( 'computeResize keeps a floating widget origin on the snap grid', async () => {
		const { computeResize } = await import( '../../src/widgets/frame' );
		const parent = document.createElement( 'div' );
		Object.defineProperty( parent, 'clientWidth', { value: 1000, configurable: true } );
		Object.defineProperty( parent, 'clientHeight', { value: 600, configurable: true } );

		const def = {
			id: 'x',
			label: 'X',
			description: '',
			icon: 'dashicons-star-filled',
			minWidth: 120,
			minHeight: 80,
			mount: () => () => undefined,
		};

		const nudge = computeResize(
			'nw', -7, 9, 140, 100, 300, 200, def, parent, true,
		);
		expect( nudge.x % 20 ).toBe( 0 );
		expect( nudge.y % 20 ).toBe( 0 );
		expect( nudge.x + nudge.width ).toBe( 440 );
		expect( nudge.y + nudge.height ).toBe( 300 );

		const west = computeResize(
			'w', -33, 0, 140, 100, 300, 200, def, parent, true,
		);
		expect( west.x ).toBe( 100 );
		expect( west.width ).toBe( 340 );

		const squeezed = computeResize(
			'w', 1000, 0, 140, 100, 305, 200, def, parent, true,
		);
		expect( squeezed.x ).toBe( 320 );
		expect( squeezed.width ).toBe( 125 );

		const corner = computeResize(
			'se', 13, -6, 140, 100, 300, 200, def, parent, true,
		);
		expect( corner.x ).toBe( 140 );
		expect( corner.y ).toBe( 100 );
		expect( corner.width ).toBe( 320 );
		expect( corner.height ).toBe( 200 );

		const east = computeResize(
			'e', 28, 0, 140, 100, 300, 200, def, parent, true,
		);
		expect( east.width ).toBe( 320 );
		expect( east.x + east.width ).toBe( 460 );

		const capped = computeResize(
			'e', 1000, 0, 140, 100, 300, 200,
			{ ...def, maxWidth: 265 }, parent, true,
		);
		expect( capped.width ).toBe( 260 );

		const dockedNorth = computeResize(
			'n', 0, -7, 140, 100, 300, 200, def, parent, false,
		);
		expect( dockedNorth.height ).toBe( 207 );
		const dockedSouth = computeResize(
			's', 0, 7, 140, 100, 300, 200, def, parent, false,
		);
		expect( dockedSouth.height ).toBe( 207 );
	} );

	test( 're-docking then resizing keeps the card in the column (no stale floating state)', async () => {

		const registry = await import( '../../src/widgets/registry' );
		const { WidgetLayer } = await import( '../../src/widgets/layer' );
		registry.register( {
			id: 'redock-rs',
			label: 'Redock resize',
			description: '',
			icon: 'dashicons-star-filled',
			movable: true,
			resizable: true,
			mount: () => () => undefined,
		} );
		window.localStorage.setItem( 'desktop-mode-widgets', '["redock-rs"]' );
		window.localStorage.setItem(
			'desktop-mode-widgets-geometry',
			JSON.stringify( {
				'redock-rs': { x: 400, y: 300, width: 300, height: 200 },
			} ),
		);

		const layer = new WidgetLayer( host, '' );
		layer.hydrate();

		const card = document.querySelector< HTMLElement >(
			'[data-widget-id="redock-rs"]',
		)!;
		expect( card ).toBeTruthy();
		expect(
			card.classList.contains( 'os-widgets__card--floating' ),
		).toBe( true );

		layer.redock( 'redock-rs' );
		expect(
			card.classList.contains( 'os-widgets__card--floating' ),
		).toBe( false );
		expect( card.style.left ).toBe( '' );

		card.getBoundingClientRect = (): DOMRect => ( {
			x: 1200, y: 40, width: 300, height: 200,
			top: 40, left: 1200, right: 1500, bottom: 240,
			toJSON: () => ( {} ),
		} );
		document.body.getBoundingClientRect = (): DOMRect => ( {
			x: 0, y: 0, width: 1536, height: 800,
			top: 0, left: 0, right: 1536, bottom: 800,
			toJSON: () => ( {} ),
		} );
		const ptr = ( type: string, x: number, y: number ): Event => {
			const e = new Event( type, { bubbles: true } );
			Object.defineProperty( e, 'pointerId', { value: 1 } );
			Object.defineProperty( e, 'button', { value: 0 } );
			Object.defineProperty( e, 'clientX', { value: x } );
			Object.defineProperty( e, 'clientY', { value: y } );
			return e;
		};
		const handle = card.querySelector< HTMLElement >(
			'.os-widgets__resize--s',
		)!;
		( handle as unknown as { setPointerCapture: () => void } ).setPointerCapture = () => undefined;
		( handle as unknown as { releasePointerCapture: () => void } ).releasePointerCapture = () => undefined;
		handle.dispatchEvent( ptr( 'pointerdown', 1350, 240 ) );
		handle.dispatchEvent( ptr( 'pointermove', 1350, 300 ) );
		handle.dispatchEvent( ptr( 'pointerup', 1350, 300 ) );

		expect( card.style.height ).toBe( '260px' );

		expect( card.style.left ).toBe( '' );
		expect( card.style.top ).toBe( '' );

		const geom = JSON.parse(
			window.localStorage.getItem( 'desktop-mode-widgets-geometry' ) ||
				'{}',
		);
		expect( geom[ 'redock-rs' ] ).toBeUndefined();

		layer.disposeAll();
	} );

	test( 'docked height resize persists and re-applies on the next boot', async () => {
		const registry = await import( '../../src/widgets/registry' );
		const { WidgetLayer } = await import( '../../src/widgets/layer' );
		registry.register( {
			id: 'dock-rs',
			label: 'Dock resize',
			description: '',
			icon: 'dashicons-star-filled',
			movable: true,
			resizable: true,
			mount: () => () => undefined,
		} );
		window.localStorage.setItem( 'desktop-mode-widgets', '["dock-rs"]' );

		const layer = new WidgetLayer( host, '' );
		layer.hydrate();
		const card = host.querySelector< HTMLElement >(
			'[data-widget-id="dock-rs"]',
		)!;
		expect( card ).toBeTruthy();

		card.getBoundingClientRect = (): DOMRect => ( {
			x: 1200, y: 40, width: 300, height: 200,
			top: 40, left: 1200, right: 1500, bottom: 240,
			toJSON: () => ( {} ),
		} );
		Object.defineProperty( card, 'offsetHeight', {
			configurable: true,
			get: () => parseFloat( card.style.height ) || 200,
		} );
		document.body.getBoundingClientRect = (): DOMRect => ( {
			x: 0, y: 0, width: 1536, height: 800,
			top: 0, left: 0, right: 1536, bottom: 800,
			toJSON: () => ( {} ),
		} );
		const ptr = ( type: string, x: number, y: number ): Event => {
			const e = new Event( type, { bubbles: true } );
			Object.defineProperty( e, 'pointerId', { value: 1 } );
			Object.defineProperty( e, 'button', { value: 0 } );
			Object.defineProperty( e, 'clientX', { value: x } );
			Object.defineProperty( e, 'clientY', { value: y } );
			return e;
		};
		const handle = card.querySelector< HTMLElement >(
			'.os-widgets__resize--s',
		)!;
		( handle as unknown as { setPointerCapture: () => void } ).setPointerCapture = () => undefined;
		( handle as unknown as { releasePointerCapture: () => void } ).releasePointerCapture = () => undefined;
		handle.dispatchEvent( ptr( 'pointerdown', 1350, 240 ) );
		handle.dispatchEvent( ptr( 'pointermove', 1350, 300 ) );
		handle.dispatchEvent( ptr( 'pointerup', 1350, 300 ) );

		expect( card.style.height ).toBe( '260px' );
		const saved = JSON.parse(
			window.localStorage.getItem(
				'desktop-mode-widgets-docked-heights',
			) || '{}',
		);
		expect( saved[ 'dock-rs' ] ).toBe( 260 );

		const geom = JSON.parse(
			window.localStorage.getItem( 'desktop-mode-widgets-geometry' ) ||
				'{}',
		);
		expect( geom[ 'dock-rs' ] ).toBeUndefined();

		layer.disposeAll();

		const layer2 = new WidgetLayer( host, '' );
		layer2.hydrate();
		const card2 = host.querySelector< HTMLElement >(
			'[data-widget-id="dock-rs"]',
		)!;
		expect( card2.style.height ).toBe( '260px' );
		expect(
			card2.classList.contains( 'os-widgets__card--floating' ),
		).toBe( false );
		layer2.disposeAll();
	} );

	test( 'persisted off-screen geometry is clamped back into view at mount', async () => {
		const registry = await import( '../../src/widgets/registry' );
		const { WidgetLayer } = await import( '../../src/widgets/layer' );
		registry.register( {
			id: 'lost',
			label: 'Lost',
			description: '',
			icon: 'dashicons-star-filled',
			movable: true,
			mount: () => () => undefined,
		} );
		window.localStorage.setItem( 'desktop-mode-widgets', '["lost"]' );

		window.localStorage.setItem(
			'desktop-mode-widgets-geometry',
			JSON.stringify( {
				lost: { x: 5000, y: 4000, width: 300, height: 200 },
			} ),
		);

		Object.defineProperty( document.body, 'clientWidth', {
			value: 1000,
			configurable: true,
		} );
		Object.defineProperty( document.body, 'clientHeight', {
			value: 600,
			configurable: true,
		} );

		try {
			const layer = new WidgetLayer( host, '' );
			layer.hydrate();
			const card = document.querySelector< HTMLElement >(
				'[data-widget-id="lost"]',
			)!;

			expect( card.style.left ).toBe( `${ 1000 - 300 - 20 }px` );
			expect( card.style.top ).toBe( `${ 600 - 200 - 20 }px` );
			layer.disposeAll();
		} finally {

			delete ( document.body as unknown as Record< string, unknown > )
				.clientWidth;
			delete ( document.body as unknown as Record< string, unknown > )
				.clientHeight;
		}
	} );

	test( 'add-then-remove before async mount resolves discards the stale mount', async () => {
		const registry = await import( '../../src/widgets/registry' );
		const { WidgetLayer } = await import( '../../src/widgets/layer' );
		let teardownCalled = false;
		let resolveMount: ( ( cb: () => void ) => void ) | null = null;
		registry.register( {
			id: 'slow',
			label: 'Slow',
			description: '',
			icon: 'dashicons-star-filled',
			mount: () =>
				new Promise( ( res ) => {
					resolveMount = res;
				} ),
		} );
		const layer = new WidgetLayer( host, '' );
		layer.hydrate();
		layer.remove( 'clock' );
		layer.add( 'slow' );
		layer.remove( 'slow' );
		const log = recordActions( hooks, WIDGET_HOOKS );

		resolveMount!( () => {
			teardownCalled = true;
		} );
		await Promise.resolve();
		await Promise.resolve();

		expect( teardownCalled ).toBe( true );
		expect(
			log.some( ( e ) => e.name === 'os.widget.mounted' ),
		).toBe( false );
	} );

	test( 'public redock() un-floats a card, clears geometry, and reparents into the column', async () => {
		const registry = await import( '../../src/widgets/registry' );
		const { WidgetLayer } = await import( '../../src/widgets/layer' );
		registry.register( {
			id: 'roam',
			label: 'Roamer',
			description: '',
			icon: 'dashicons-star-filled',
			movable: true,
			mount: () => () => undefined,
		} );
		window.localStorage.setItem( 'desktop-mode-widgets', '["roam"]' );
		window.localStorage.setItem(
			'desktop-mode-widgets-geometry',
			JSON.stringify( { roam: { x: 50, y: 60, width: 220, height: 110 } } ),
		);

		const layer = new WidgetLayer( host, '' );
		layer.hydrate();
		const card = host.parentElement!.querySelector< HTMLElement >(
			'.os-widgets__card',
		);
		expect( card ).toBeTruthy();
		expect(
			card!.classList.contains( 'os-widgets__card--floating' ),
		).toBe( true );

		layer.redock( 'roam' );

		expect(
			card!.classList.contains( 'os-widgets__card--floating' ),
		).toBe( false );
		expect( card!.style.left ).toBe( '' );
		expect( card!.style.top ).toBe( '' );
		expect( card!.style.width ).toBe( '' );
		expect( card!.style.height ).toBe( '' );
		const geom = JSON.parse(
			window.localStorage.getItem( 'desktop-mode-widgets-geometry' ) || '{}',
		);
		expect( geom.roam ).toBeUndefined();

		expect(
			host.querySelector( '.os-widgets__list .os-widgets__card' ),
		).toBe( card );

		expect( () => layer.redock( 'roam' ) ).not.toThrow();

		expect( () => layer.redock( 'never-registered' ) ).not.toThrow();

		layer.disposeAll();
	} );

	test( 'picking a widget closes the picker and hands focus back to the pill', async () => {
		const registry = await import( '../../src/widgets/registry' );
		const { WidgetLayer } = await import( '../../src/widgets/layer' );
		for ( const id of [ 'pick-a', 'pick-b' ] ) {
			registry.register( {
				id,
				label: id,
				description: '',
				icon: 'dashicons-star-filled',
				mount: () => () => undefined,
			} );
		}
		window.localStorage.setItem( 'desktop-mode-widgets', '[]' );

		const layer = new WidgetLayer( host, '' );
		layer.hydrate();
		layer.openPicker();

		expect( document.querySelector( '.os-widget-picker' ) ).not.toBeNull();
		expect(
			host.classList.contains( 'os-widgets--picking' ),
		).toBe( true );

		const entry = document.querySelector< HTMLButtonElement >(
			'.os-widget-picker__entry:not([disabled])',
		)!;
		entry.click();

		expect( layer.getEnabledIds() ).toEqual( [ 'pick-a' ] );

		expect( document.querySelector( '.os-widget-picker' ) ).toBeNull();
		expect(
			host.classList.contains( 'os-widgets--picking' ),
		).toBe( false );
		expect( document.activeElement ).toBe(
			host.querySelector( '.os-widgets__add' ),
		);

		layer.openPicker();
		expect( document.querySelector( '.os-widget-picker' ) ).not.toBeNull();
		document
			.querySelector< HTMLButtonElement >(
				'.os-widget-picker__entry:not([disabled])',
			)!
			.click();
		expect( layer.getEnabledIds() ).toEqual( [ 'pick-a', 'pick-b' ] );

		layer.disposeAll();
	} );

	test( 'the add-widget pill reveals only while the pointer is near the column', async () => {
		const registry = await import( '../../src/widgets/registry' );
		const { WidgetLayer } = await import( '../../src/widgets/layer' );
		registry.register( {
			id: 'near',
			label: 'Near',
			description: '',
			icon: 'dashicons-star-filled',
			mount: () => () => undefined,
		} );
		window.localStorage.setItem( 'desktop-mode-widgets', '["near"]' );

		host.getBoundingClientRect = (): DOMRect => ( {
			x: 704, y: 16, width: 320, height: 736,
			top: 16, left: 704, right: 1024, bottom: 752,
			toJSON: () => ( {} ),
		} );

		const layer = new WidgetLayer( host, '' );
		layer.hydrate();
		expect( host.classList.contains( 'os-widgets--hovered' ) ).toBe( false );

		const move = ( x: number, y: number ): void => {
			const e = new Event( 'pointermove', { bubbles: true } );
			Object.defineProperty( e, 'clientX', { value: x } );
			Object.defineProperty( e, 'clientY', { value: y } );
			document.dispatchEvent( e );
		};

		move( 120, 400 );
		expect( host.classList.contains( 'os-widgets--hovered' ) ).toBe( false );

		move( 800, 400 );
		expect( host.classList.contains( 'os-widgets--hovered' ) ).toBe( true );

		move( 680, 400 );
		expect( host.classList.contains( 'os-widgets--hovered' ) ).toBe( true );

		move( 600, 400 );
		expect( host.classList.contains( 'os-widgets--hovered' ) ).toBe( false );

		layer.disposeAll();
		move( 800, 400 );
		expect( host.classList.contains( 'os-widgets--hovered' ) ).toBe( false );
	} );

	test( 'the add pill trails the lowest widget standing in the column', async () => {
		const registry = await import( '../../src/widgets/registry' );
		const { WidgetLayer } = await import( '../../src/widgets/layer' );
		registry.register( {
			id: 'docked',
			label: 'Docked',
			description: '',
			icon: 'dashicons-star-filled',
			mount: () => () => undefined,
		} );
		registry.register( {
			id: 'parked',
			label: 'Parked',
			description: '',
			icon: 'dashicons-star-filled',
			movable: true,
			mount: () => () => undefined,
		} );
		registry.register( {
			id: 'elsewhere',
			label: 'Elsewhere',
			description: '',
			icon: 'dashicons-star-filled',
			movable: true,
			mount: () => () => undefined,
		} );
		window.localStorage.setItem(
			'desktop-mode-widgets',
			'["docked","parked","elsewhere"]',
		);

		window.localStorage.setItem(
			'desktop-mode-widgets-geometry',
			JSON.stringify( {
				parked: { x: 704, y: 300, width: 320, height: 200 },
				elsewhere: { x: 40, y: 600, width: 320, height: 200 },
			} ),
		);

		const col = { top: 16, left: 704, right: 1024, bottom: 752 };
		host.getBoundingClientRect = (): DOMRect => ( {
			x: col.left, y: col.top, width: 320, height: 736,
			...col, toJSON: () => ( {} ),
		} );

		const layer = new WidgetLayer( host, '' );
		layer.hydrate();

		const list = host.querySelector< HTMLElement >(
			'.os-widgets__list',
		)!;
		Object.defineProperty( list, 'offsetHeight', {
			configurable: true,
			get: () => 120,
		} );
		const rectFor = ( card: HTMLElement, box: DOMRect ) => {
			card.getBoundingClientRect = (): DOMRect => box;
		};
		const byLabel = ( label: string ): HTMLElement =>
			[
				...document.body.querySelectorAll< HTMLElement >(
					'.os-widgets__card--floating',
				),
			].find( ( c ) => c.textContent?.includes( label ) )!;

		rectFor( byLabel( 'Parked' ), {
			x: 704, y: 300, width: 320, height: 200,
			top: 300, left: 704, right: 1024, bottom: 500,
			toJSON: () => ( {} ),
		} as DOMRect );

		rectFor( byLabel( 'Elsewhere' ), {
			x: 40, y: 600, width: 320, height: 200,
			top: 600, left: 40, right: 360, bottom: 800,
			toJSON: () => ( {} ),
		} as DOMRect );

		const tile = host.querySelector< HTMLElement >(
			'.os-widgets__add',
		)!;

		const move = ( x: number, y: number ): void => {
			const e = new Event( 'pointermove', { bubbles: true } );
			Object.defineProperty( e, 'clientX', { value: x } );
			Object.defineProperty( e, 'clientY', { value: y } );
			document.dispatchEvent( e );
		};
		move( 800, 400 );
		await new Promise( ( resolve ) =>
			requestAnimationFrame( () => resolve( undefined ) ),
		);

		expect( tile.style.top ).toBe( '496px' );

		layer.disposeAll();
	} );

	test( 'the add pill follows a docked card that grows after it was placed', async () => {

		const callbacks: Array< () => void > = [];
		const observed: Element[] = [];
		class FakeResizeObserver {
			constructor( cb: () => void ) {
				callbacks.push( cb );
			}
			observe( el: Element ): void {
				observed.push( el );
			}
			unobserve(): void {}
			disconnect(): void {}
		}
		vi.stubGlobal( 'ResizeObserver', FakeResizeObserver );
		try {
			const registry = await import( '../../src/widgets/registry' );
			const { WidgetLayer } = await import( '../../src/widgets/layer' );
			registry.register( {
				id: 'growing',
				label: 'Growing',
				description: '',
				icon: 'dashicons-star-filled',
				mount: () => () => undefined,
			} );
			window.localStorage.setItem( 'desktop-mode-widgets', '["growing"]' );
			host.getBoundingClientRect = (): DOMRect => ( {
				x: 704, y: 16, width: 320, height: 736,
				top: 16, left: 704, right: 1024, bottom: 752,
				toJSON: () => ( {} ),
			} );

			const layer = new WidgetLayer( host, '' );
			layer.hydrate();

			const list = host.querySelector< HTMLElement >(
				'.os-widgets__list',
			)!;
			const card = host.querySelector< HTMLElement >(
				'.os-widgets__card',
			)!;
			expect( observed ).toContain( card );

			let height = 120;
			Object.defineProperty( list, 'offsetHeight', {
				configurable: true,
				get: () => height,
			} );
			const tile = host.querySelector< HTMLElement >(
				'.os-widgets__add',
			)!;
			callbacks.forEach( ( cb ) => cb() );
			expect( tile.style.top ).toBe( '132px' );

			height = 300;
			callbacks.forEach( ( cb ) => cb() );
			expect( tile.style.top ).toBe( '312px' );

			layer.disposeAll();
		} finally {
			vi.unstubAllGlobals();
		}
	} );

	test( 'dragging a floating widget snaps its position to the grid', async () => {
		const registry = await import( '../../src/widgets/registry' );
		const { WidgetLayer } = await import( '../../src/widgets/layer' );
		registry.register( {
			id: 'snappy',
			label: 'Snappy',
			description: '',
			icon: 'dashicons-star-filled',
			movable: true,
			mount: () => () => undefined,
		} );
		window.localStorage.setItem( 'desktop-mode-widgets', '["snappy"]' );
		window.localStorage.setItem(
			'desktop-mode-widgets-geometry',
			JSON.stringify( {
				snappy: { x: 100, y: 100, width: 240, height: 120 },
			} ),
		);

		const layer = new WidgetLayer( host, '' );
		layer.hydrate();

		const card = document.body.querySelector< HTMLElement >(
			'.os-widgets__card',
		)!;
		Object.defineProperty( card, 'offsetWidth', {
			configurable: true,
			get: () => 240,
		} );
		Object.defineProperty( card, 'offsetHeight', {
			configurable: true,
			get: () => 120,
		} );
		document.body.getBoundingClientRect = (): DOMRect => ( {
			x: 0, y: 0, width: 1024, height: 768,
			top: 0, left: 0, right: 1024, bottom: 768,
			toJSON: () => ( {} ),
		} );

		const ptr = ( type: string, x: number, y: number ): Event => {
			const e = new Event( type, { bubbles: true } );
			Object.defineProperty( e, 'pointerId', { value: 1 } );
			Object.defineProperty( e, 'button', { value: 0 } );
			Object.defineProperty( e, 'clientX', { value: x } );
			Object.defineProperty( e, 'clientY', { value: y } );
			return e;
		};
		const chrome = card.querySelector< HTMLElement >(
			'.os-widgets__chrome',
		)!;
		( chrome as unknown as { setPointerCapture: () => void } ).setPointerCapture = () => undefined;
		( chrome as unknown as { releasePointerCapture: () => void } ).releasePointerCapture = () => undefined;

		chrome.dispatchEvent( ptr( 'pointerdown', 0, 0 ) );
		chrome.dispatchEvent( ptr( 'pointermove', 37, -23 ) );
		chrome.dispatchEvent( ptr( 'pointerup', 37, -23 ) );

		expect( card.style.left ).toBe( '140px' );
		expect( card.style.top ).toBe( '80px' );

		chrome.dispatchEvent( ptr( 'pointerdown', 0, 0 ) );
		chrome.dispatchEvent( ptr( 'pointermove', 5000, 5000 ) );
		chrome.dispatchEvent( ptr( 'pointerup', 5000, 5000 ) );

		expect( card.style.left ).toBe( '760px' );
		expect( card.style.top ).toBe( '620px' );

		layer.disposeAll();
	} );

	test( 'setVisibleIds mounts and unmounts without writing the enabled list', async () => {
		const registry = await import( '../../src/widgets/registry' );
		const { WidgetLayer } = await import( '../../src/widgets/layer' );
		for ( const id of [ 'clock', 'stats', 'notes' ] ) {
			registry.register( {
				id,
				label: id,
				description: '',
				icon: 'dashicons-star-filled',
				mount: ( body ) => {
					body.textContent = id;
					return () => undefined;
				},
			} );
		}
		window.localStorage.setItem(
			'desktop-mode-widgets',
			'["clock","notes"]',
		);
		const layer = new WidgetLayer( host, '' );
		layer.hydrate();
		const mountedIds = (): string[] =>
			Array.from(
				host.querySelectorAll< HTMLElement >( '.os-widgets__card' ),
			).map( ( el ) => el.dataset.widgetId ?? '' );
		expect( mountedIds().sort() ).toEqual( [ 'clock', 'notes' ] );

		layer.setVisibleIds( [ 'stats' ] );
		expect( mountedIds() ).toEqual( [ 'stats' ] );
		expect( layer.getEnabledIds().sort() ).toEqual( [ 'clock', 'notes' ] );
		expect( window.localStorage.getItem( 'desktop-mode-widgets' ) ).toBe(
			'["clock","notes"]',
		);

		layer.setVisibleIds( null );
		expect( mountedIds().sort() ).toEqual( [ 'clock', 'notes' ] );
		expect( window.localStorage.getItem( 'desktop-mode-widgets' ) ).toBe(
			'["clock","notes"]',
		);

		layer.disposeAll();
	} );

	test( 'the × works on a widget a workspace mounted, and leaves the user’s list alone', async () => {
		const registry = await import( '../../src/widgets/registry' );
		const { WidgetLayer } = await import( '../../src/widgets/layer' );
		for ( const id of [ 'clock', 'stats' ] ) {
			registry.register( {
				id,
				label: id,
				description: '',
				icon: 'dashicons-star-filled',
				mount: () => () => undefined,
			} );
		}
		window.localStorage.setItem( 'desktop-mode-widgets', '["clock"]' );
		const layer = new WidgetLayer( host, '' );
		layer.hydrate();
		const log = recordActions( hooks, WIDGET_HOOKS );

		layer.setVisibleIds( [ 'stats' ] );
		expect( layer.getMountedIds() ).toEqual( [ 'stats' ] );

		layer.openPicker();
		const addedLabels = (): string[] =>
			Array.from(
				document.querySelectorAll(
					'.os-widget-picker__entry--added .os-widget-picker__entry-label',
				),
			).map( ( el ) => el.textContent ?? '' );
		expect( addedLabels() ).toEqual( [ 'stats' ] );
		document.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Escape' } ),
		);

		layer.remove( 'stats' );
		expect( layer.getMountedIds() ).toEqual( [] );
		expect( log.map( ( e ) => e.name ) ).toContain( 'os.widget.removed' );

		expect( layer.getEnabledIds() ).toEqual( [ 'clock' ] );
		expect( window.localStorage.getItem( 'desktop-mode-widgets' ) ).toBe( '["clock"]' );

		layer.add( 'stats' );
		expect( layer.getMountedIds() ).toEqual( [ 'stats' ] );
		expect( layer.getEnabledIds() ).toEqual( [ 'clock' ] );

		layer.setVisibleIds( null );
		expect( layer.getMountedIds() ).toEqual( [ 'clock' ] );
		layer.disposeAll();
	} );

	test( 'a widget arriving late lands only on the desk that names it', async () => {
		const registry = await import( '../../src/widgets/registry' );
		const { WidgetLayer } = await import( '../../src/widgets/layer' );
		registry.register( {
			id: 'clock',
			label: 'Clock',
			description: '',
			icon: 'dashicons-clock',
			mount: () => () => undefined,
		} );
		window.localStorage.setItem( 'desktop-mode-widgets', '["clock","late"]' );
		const layer = new WidgetLayer( host, '' );
		layer.hydrate();
		layer.setVisibleIds( [ 'clock' ] );

		registry.register( {
			id: 'late',
			label: 'Late',
			description: '',
			icon: 'dashicons-star-filled',
			mount: () => () => undefined,
		} );
		layer.mountIfEnabled( 'late' );
		expect( layer.getMountedIds() ).toEqual( [ 'clock' ] );

		layer.setVisibleIds( null );
		layer.mountIfEnabled( 'late' );
		expect( layer.getMountedIds().sort() ).toEqual( [ 'clock', 'late' ] );
		layer.disposeAll();
	} );

	test( 'setVisibleIds skips an id no plugin registers', async () => {
		const registry = await import( '../../src/widgets/registry' );
		const { WidgetLayer } = await import( '../../src/widgets/layer' );
		registry.register( {
			id: 'clock',
			label: 'Clock',
			description: '',
			icon: 'dashicons-clock',
			mount: () => () => undefined,
		} );
		window.localStorage.setItem( 'desktop-mode-widgets', '[]' );
		const layer = new WidgetLayer( host, '' );
		layer.hydrate();

		layer.setVisibleIds( [ 'clock', 'gone-with-its-plugin' ] );

		expect(
			host.querySelectorAll( '.os-widgets__card' ),
		).toHaveLength( 1 );

		layer.disposeAll();
	} );
} );

describe( 'widgets/picker placement', () => {
	test( 'caps the panel to the taller side when neither side fits', async () => {
		const { placeWidgetPicker } = await import( '../../src/widgets/picker' );

		const bounds = { top: 8, right: 1272, bottom: 628, left: 8 };
		const anchor = { top: 374, right: 1170, bottom: 410, left: 1037 };
		const placed = placeWidgetPicker( anchor, { width: 342, height: 454 }, bounds );
		expect( placed ).toEqual( { left: 828, top: 8, maxHeight: 360 } );

		const low = placeWidgetPicker(
			{ top: 40, right: 400, bottom: 76, left: 270 },
			{ width: 342, height: 454 },
			{ top: 8, right: 300, bottom: 400, left: 8 },
		);
		expect( low ).toEqual( { left: 8, top: 82, maxHeight: 318 } );
	} );
} );
