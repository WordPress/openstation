/**
 * Widget registry + layer behaviour.
 *
 * Covers:
 *   - registry validation, late-wins on id conflict, filter passthrough
 *   - layer first-run seeds the clock default
 *   - add / remove idempotency + persistence
 *   - mount lifecycle hook firings (mounting → mounted)
 *   - async mount rejection fires mount-failed (not mounted)
 *   - rapid add-then-remove discards the stale mount
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	clearHooksStub,
	installHooksStub,
	recordActions,
	type FakeWpHooks,
} from './helpers/hooks-stub';

const WIDGET_HOOKS = [
	'desktop-mode.widget.mounting',
	'desktop-mode.widget.mounted',
	'desktop-mode.widget.unmounting',
	'desktop-mode.widget.mount-failed',
	'desktop-mode.widget.added',
	'desktop-mode.widget.removed',
] as const;

describe( 'widgets/registry', () => {
	let hooks: FakeWpHooks;

	beforeEach( async () => {
		hooks = installHooksStub();
		vi.resetModules();
		// Clear any persisted state between files.
		try {
			window.localStorage.removeItem( 'desktop-mode-widgets' );
		} catch {
			/* jsdom always supports localStorage */
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

	test( 'plugins can filter the registry via desktop-mode.widgets', async () => {
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
			'desktop-mode.widgets',
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
		} catch {
			/* jsdom */
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
		expect( names ).toContain( 'desktop-mode.widget.mounting' );
		expect( names ).toContain( 'desktop-mode.widget.mounted' );
		expect( host.querySelector( '.desktop-mode-widgets__card' ) ).not.toBeNull();
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
		expect( host.querySelector( '.desktop-mode-widgets__card' ) ).toBeNull();
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
		layer.remove( 'clock' ); // ensure clean
		const log = recordActions( hooks, WIDGET_HOOKS );

		layer.add( 'stats' );

		expect( layer.getEnabledIds() ).toContain( 'stats' );
		expect(
			JSON.parse( window.localStorage.getItem( 'desktop-mode-widgets' )! ),
		).toContain( 'stats' );
		const names = log.map( ( e ) => e.name );
		expect( names ).toContain( 'desktop-mode.widget.added' );
		expect( names ).toContain( 'desktop-mode.widget.mounting' );
		expect( names ).toContain( 'desktop-mode.widget.mounted' );
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
			( e ) => e.name === 'desktop-mode.widget.added',
		).length;
		const mountedCount = log.filter(
			( e ) => e.name === 'desktop-mode.widget.mounted',
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
		expect( names ).toContain( 'desktop-mode.widget.unmounting' );
		expect( names ).toContain( 'desktop-mode.widget.removed' );
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
		// Silence the error log — mount-failed intentionally logs.
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
		expect( names ).toContain( 'desktop-mode.widget.mount-failed' );
		expect( names ).not.toContain( 'desktop-mode.widget.mounted' );
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

		const card = host.querySelector( '.desktop-mode-widgets__card' );
		expect( card ).not.toBeNull();
		expect( card!.classList.contains( 'desktop-mode-widgets__card--movable' ) ).toBe( true );
		expect( card!.querySelector( '.desktop-mode-widgets__chrome' ) ).not.toBeNull();
		expect( card!.querySelector( '.desktop-mode-widgets__grip' ) ).not.toBeNull();
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

		const card = host.querySelector( '.desktop-mode-widgets__card' )!;
		expect( card.classList.contains( 'desktop-mode-widgets__card--movable' ) ).toBe( false );
		expect( card.querySelector( '.desktop-mode-widgets__chrome' ) ).toBeNull();
		// Corner-close stays in the DOM with the --corner modifier.
		expect(
			card.querySelector( '.desktop-mode-widgets__card-close--corner' ),
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

		const card = host.querySelector( '.desktop-mode-widgets__card' )!;
		expect( card.classList.contains( 'desktop-mode-widgets__card--resizable' ) ).toBe( true );
		expect( card.querySelectorAll( '.desktop-mode-widgets__resize' ).length ).toBe( 8 );
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

		// Parent for floating host — layer defaults to root.parentElement
		// which is document.body here. That's fine for the test.
		const layer = new WidgetLayer( host, '' );
		layer.hydrate();

		const card = document.body.querySelector<HTMLElement>(
			'.desktop-mode-widgets__card',
		)!;
		expect( card.classList.contains( 'desktop-mode-widgets__card--floating' ) ).toBe( true );
		expect( card.style.left ).toBe( '50px' );
		expect( card.style.top ).toBe( '70px' );
		expect( card.style.width ).toBe( '240px' );
		expect( card.style.height ).toBe( '120px' );

		layer.disposeAll();
	} );

	test( 'liberating a docked widget preserves its CURRENT rendered size, not the registered default', async () => {
		// Reproduces the user-reported "Heartbeat widget loses its
		// 88 px compact height on drag-out" bug. The previous
		// `def.defaultWidth ?? rect.width` precedence stretched the
		// widget back to its registered defaultHeight even when the
		// widget had mutated its own column-mode height (compact
		// toggle, dynamic-content shrink, etc.). After the fix, the
		// on-screen rect wins.
		const registry = await import( '../../src/widgets/registry' );
		const { WidgetLayer } = await import( '../../src/widgets/layer' );
		registry.register( {
			id: 'compact-mov',
			label: 'Compact movable',
			description: '',
			icon: 'dashicons-star-filled',
			movable: true,
			// Mimic the Heartbeat widget: registered with 310 × 230
			// but in column mode the widget collapses to 88 high.
			defaultWidth: 310,
			defaultHeight: 230,
			mount: () => () => undefined,
		} );
		window.localStorage.setItem( 'desktop-mode-widgets', '["compact-mov"]' );

		const layer = new WidgetLayer( host, '' );
		layer.hydrate();
		const card = host.querySelector< HTMLElement >(
			'.desktop-mode-widgets__card',
		)!;
		expect( card ).toBeTruthy();

		// jsdom returns zero from getBoundingClientRect /
		// offsetWidth / offsetHeight by default — stub both on the
		// card so the liberate snapshot AND the post-drag
		// currentGeometry() read real numbers.
		card.getBoundingClientRect = (): DOMRect => ( {
			x: 100, y: 200, width: 310, height: 88, // ← compact height
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

		// Synthesize the drag: pointerdown on the chrome, move past
		// the 5 px threshold, release. jsdom doesn't have a
		// PointerEvent constructor — use a plain Event with the
		// fields the frame reads (same trick `drag-manager.test.ts`
		// uses).
		const ptr = ( type: string, x: number, y: number ): Event => {
			const e = new Event( type, { bubbles: true } );
			Object.defineProperty( e, 'pointerId', { value: 1 } );
			Object.defineProperty( e, 'button', { value: 0 } );
			Object.defineProperty( e, 'clientX', { value: x } );
			Object.defineProperty( e, 'clientY', { value: y } );
			return e;
		};
		const chrome = card.querySelector< HTMLElement >(
			'.desktop-mode-widgets__chrome',
		)!;
		// jsdom lacks setPointerCapture / releasePointerCapture; the
		// frame calls both on the chrome element during a drag. Stub
		// them as no-ops so the synthesized pointer flow doesn't
		// throw mid-test.
		( chrome as unknown as { setPointerCapture: () => void } ).setPointerCapture = () => undefined;
		( chrome as unknown as { releasePointerCapture: () => void } ).releasePointerCapture = () => undefined;
		chrome.dispatchEvent( ptr( 'pointerdown', 110, 210 ) );
		chrome.dispatchEvent( ptr( 'pointermove', 200, 300 ) );
		chrome.dispatchEvent( ptr( 'pointerup', 200, 300 ) );

		// After liberation the card's inline height must reflect the
		// pre-drag on-screen height (88) — NOT the registered 230.
		expect( card.classList.contains( 'desktop-mode-widgets__card--floating' ) ).toBe( true );
		expect( card.style.height ).toBe( '88px' );
		expect( card.style.width ).toBe( '310px' );

		// Persisted geometry mirrors it.
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

		// South-east corner drag by (+1000, +1000) — both axes clamp to
		// the parent bounds from the starting (100, 100) + (300, 200).
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
		expect( bigDrag.width ).toBe( 1000 - 100 ); // parentWidth - startLeft
		expect( bigDrag.height ).toBe( 600 - 100 ); // parentHeight - startTop

		// Shrinking past min clamps at minima, not negative.
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

		// Non-floating (docked) widget: width/x axes are locked even
		// though the handle was a south-east corner.
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

		// Resolve the stale mount. Its teardown MUST run (so the
		// widget has a chance to tidy up) but no 'mounted' hook
		// should fire for the discarded record.
		resolveMount!( () => {
			teardownCalled = true;
		} );
		await Promise.resolve();
		await Promise.resolve();

		expect( teardownCalled ).toBe( true );
		expect(
			log.some( ( e ) => e.name === 'desktop-mode.widget.mounted' ),
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
			'.desktop-mode-widgets__card',
		);
		expect( card ).toBeTruthy();
		expect(
			card!.classList.contains( 'desktop-mode-widgets__card--floating' ),
		).toBe( true );

		layer.redock( 'roam' );

		expect(
			card!.classList.contains( 'desktop-mode-widgets__card--floating' ),
		).toBe( false );
		expect( card!.style.left ).toBe( '' );
		expect( card!.style.top ).toBe( '' );
		expect( card!.style.width ).toBe( '' );
		expect( card!.style.height ).toBe( '' );
		const geom = JSON.parse(
			window.localStorage.getItem( 'desktop-mode-widgets-geometry' ) || '{}',
		);
		expect( geom.roam ).toBeUndefined();
		// Re-parented under the column list, not the floating host.
		expect(
			host.querySelector( '.desktop-mode-widgets__list .desktop-mode-widgets__card' ),
		).toBe( card );

		// Idempotent — docked widget no-ops.
		expect( () => layer.redock( 'roam' ) ).not.toThrow();
		// Unknown id is silently ignored.
		expect( () => layer.redock( 'never-registered' ) ).not.toThrow();

		layer.disposeAll();
	} );
} );
