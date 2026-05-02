/**
 * Tests for the dock hover-peek — the fan-out popover that replaces
 * the legacy "+" chip on multi-instance dock tiles AND surfaces
 * thumbnails for native-window system tiles.
 *
 * Covers the surface that's worth pinning: trigger condition (≥1
 * open instance), card composition (one per instance + an optional
 * Ghost Card), and the click handlers (focus existing vs spawn new).
 * Animation timing is intentionally elided — the show-delay is
 * driven by `setTimeout`, which `vi.useFakeTimers` flushes.
 *
 * @group dock
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { attachDockPeek } from '../../src/dock-peek';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';

function makeTile( multi: boolean ): HTMLElement {
	const tile = document.createElement( 'div' );
	tile.className = 'wp-desktop-dock__item';
	if ( multi ) {
		tile.classList.add( 'wp-desktop-dock__item--multi' );
	}
	tile.dataset.menuSlug = 'edit.php';
	tile.dataset.dockTooltip = 'Posts';
	Object.defineProperty( tile, 'getBoundingClientRect', {
		value: () =>
			( {
				left: 10,
				top: 100,
				right: 50,
				bottom: 140,
				width: 40,
				height: 40,
				x: 10,
				y: 100,
				toJSON: () => ( {} ),
			} ) as DOMRect,
	} );
	document.body.appendChild( tile );
	return tile;
}

function makeWindowStub( title: string, baseId: string ) {
	return {
		id: baseId,
		config: {
			title,
			icon: 'dashicons-admin-post',
			baseId,
		},
	};
}

function pointerEnter( el: HTMLElement, opts: { type?: string } = {} ): void {
	const evt = new Event( 'pointerenter' );
	Object.defineProperty( evt, 'pointerType', {
		value: opts.type ?? 'mouse',
	} );
	el.dispatchEvent( evt );
}

function pointerLeave( el: HTMLElement ): void {
	const evt = new Event( 'pointerleave' );
	Object.defineProperty( evt, 'relatedTarget', { value: null } );
	el.dispatchEvent( evt );
}

type Deps = Parameters< typeof attachDockPeek >[ 0 ];

/**
 * Build a fully-stubbed deps object — tests override only the keys
 * they care about. Keeps the test file focused on behavior, not
 * scaffolding.
 */
function makeDeps( overrides: Partial< Deps > = {} ): Deps {
	const tile = overrides.tile ?? makeTile( true );
	return {
		tile,
		item: { id: 'edit.php', title: 'Posts', icon: 'dashicons-admin-post', url: '/' },
		getInstances: () => [],
		enableGhost: true,
		windowManager: {
			focus: vi.fn(),
			getFocused: () => undefined,
		} as unknown as Deps[ 'windowManager' ],
		getOrientation: () => 'left',
		openNew: vi.fn(),
		suppressTooltip: () => undefined,
		...overrides,
	};
}

describe( 'dock-peek', () => {
	beforeEach( () => {
		installHooksStub();
		vi.useFakeTimers();
	} );

	afterEach( () => {
		vi.useRealTimers();
		document.body.innerHTML = '';
		clearHooksStub();
	} );

	test( 'does not show on tiles with zero open instances', () => {
		const tile = makeTile( true );
		attachDockPeek( makeDeps( { tile, getInstances: () => [] } ) );
		pointerEnter( tile );
		vi.advanceTimersByTime( 500 );
		expect( document.querySelector( '.wp-desktop-dock-peek' ) ).toBeNull();
	} );

	test( 'native-window (system) tile peek shows a thumbnail card without a Ghost Card', () => {
		// Native windows are singletons by convention — OS Settings,
		// Jorvy, plugin-registered native windows. The peek shows
		// their live thumbnail when open but suppresses the Ghost
		// Card since "open another OS Settings" is meaningless.
		const tile = makeTile( false );
		const win = makeWindowStub( 'OS Settings', 'os-settings' );
		attachDockPeek(
			makeDeps( {
				tile,
				item: {
					id: 'os-settings',
					title: 'OS Settings',
					icon: 'dashicons-admin-settings',
					url: '',
				},
				getInstances: () => [ win ],
				enableGhost: false,
			} ),
		);
		pointerEnter( tile );
		vi.advanceTimersByTime( 500 );
		const peek = document.querySelector( '.wp-desktop-dock-peek' );
		expect( peek ).not.toBeNull();
		expect(
			peek!.querySelectorAll( '.wp-desktop-dock-peek__card--instance' )
				.length,
		).toBe( 1 );
		expect(
			peek!.querySelectorAll( '.wp-desktop-dock-peek__card--ghost' )
				.length,
		).toBe( 0 );
	} );

	test( 'does not show on touch / pen pointers', () => {
		const tile = makeTile( true );
		attachDockPeek(
			makeDeps( {
				tile,
				getInstances: () => [ makeWindowStub( 'Posts #1', 'edit-php' ) ],
			} ),
		);
		pointerEnter( tile, { type: 'touch' } );
		vi.advanceTimersByTime( 500 );
		expect( document.querySelector( '.wp-desktop-dock-peek' ) ).toBeNull();
	} );

	test( 'fans out one card per instance + a trailing Ghost Card', () => {
		const tile = makeTile( true );
		const instances = [
			makeWindowStub( 'All Posts', 'edit-php' ),
			makeWindowStub( 'Editing post 42', 'edit-php' ),
		];
		attachDockPeek(
			makeDeps( { tile, getInstances: () => instances } ),
		);
		pointerEnter( tile );
		vi.advanceTimersByTime( 500 );

		const peek = document.querySelector( '.wp-desktop-dock-peek' )!;
		expect( peek ).not.toBeNull();
		expect(
			peek.querySelectorAll( '.wp-desktop-dock-peek__card--instance' )
				.length,
		).toBe( 2 );
		const ghosts = peek.querySelectorAll(
			'.wp-desktop-dock-peek__card--ghost',
		);
		expect( ghosts.length ).toBe( 1 );
		const allCards = peek.querySelectorAll( '.wp-desktop-dock-peek__card' );
		expect( allCards[ allCards.length - 1 ] ).toBe( ghosts[ 0 ] );
	} );

	test( 'plugins can replace the card body via the content filter', () => {
		const wpHooks = (
			window as unknown as {
				wp: {
					hooks: {
						addFilter: (
							hookName: string,
							ns: string,
							cb: ( ...a: unknown[] ) => unknown,
						) => void;
						removeFilter: ( hookName: string, ns: string ) => number;
					};
				};
			}
		).wp.hooks;

		wpHooks.addFilter(
			'wp-desktop.dock.peek-card-content',
			'test/dock-peek-filter',
			( body, ctx ) => {
				const replacement = document.createElement( 'div' );
				replacement.className = 'plugin-owned-thumb';
				replacement.dataset.windowId = (
					ctx as { window: { id: string } }
				).window.id;
				return replacement;
			},
		);

		const tile = makeTile( true );
		attachDockPeek(
			makeDeps( {
				tile,
				getInstances: () => [ makeWindowStub( 'All Posts', 'edit-php' ) ],
			} ),
		);
		pointerEnter( tile );
		vi.advanceTimersByTime( 500 );

		const card = document.querySelector< HTMLElement >(
			'.wp-desktop-dock-peek__card--instance',
		)!;
		expect( card.querySelector( '.plugin-owned-thumb' ) ).not.toBeNull();
		expect( card.querySelector( '.plugin-owned-thumb' )?.getAttribute( 'data-window-id' ) ).toBe( 'edit-php' );
		expect( card.querySelectorAll( '.wp-desktop-dock-peek__card-line' ).length ).toBe( 0 );
		const customBody = card.querySelector(
			'.wp-desktop-dock-peek__card-body--custom',
		);
		expect( customBody ).not.toBeNull();

		wpHooks.removeFilter(
			'wp-desktop.dock.peek-card-content',
			'test/dock-peek-filter',
		);
	} );

	test( 'instance cards render the mini-window chrome', () => {
		const tile = makeTile( true );
		attachDockPeek(
			makeDeps( {
				tile,
				getInstances: () => [ makeWindowStub( 'All Posts', 'edit-php' ) ],
			} ),
		);
		pointerEnter( tile );
		vi.advanceTimersByTime( 500 );

		const card = document.querySelector< HTMLElement >(
			'.wp-desktop-dock-peek__card--instance',
		)!;
		expect(
			card.querySelectorAll( '.wp-desktop-dock-peek__card-dots i' ).length,
		).toBe( 3 );
		expect(
			card.querySelector( '.wp-desktop-dock-peek__card-label' )
				?.textContent,
		).toBe( 'All Posts' );
		expect(
			card.querySelectorAll( '.wp-desktop-dock-peek__card-line' ).length,
		).toBe( 3 );
		expect( card.style.getPropertyValue( '--peek-card-hue' ) ).toMatch(
			/^\d+$/,
		);
	} );

	test( 'hovering an instance card raises that window to front', () => {
		const tile = makeTile( true );
		const winA = makeWindowStub( 'All Posts', 'edit-php' );
		const winB = makeWindowStub( 'Editing post 42', 'edit-php' );
		const focus = vi.fn();
		attachDockPeek(
			makeDeps( {
				tile,
				getInstances: () => [ winA, winB ],
				windowManager: {
					getFocused: () => winA,
					focus,
				} as unknown as Deps[ 'windowManager' ],
			} ),
		);
		pointerEnter( tile );
		vi.advanceTimersByTime( 500 );

		const cards = document.querySelectorAll< HTMLElement >(
			'.wp-desktop-dock-peek__card--instance',
		);
		pointerEnter( cards[ 1 ] );
		expect( focus ).toHaveBeenCalledTimes( 1 );
		expect( focus ).toHaveBeenCalledWith( winB );
	} );

	test( 'whole-card filter can replace the entire card', () => {
		const wpHooks = (
			window as unknown as {
				wp: {
					hooks: {
						addFilter: (
							hookName: string,
							ns: string,
							cb: ( ...a: unknown[] ) => unknown,
						) => void;
						removeFilter: ( hookName: string, ns: string ) => number;
					};
				};
			}
		).wp.hooks;

		wpHooks.addFilter(
			'wp-desktop.dock.peek-card-element',
			'test/whole-card',
			() => {
				const replacement = document.createElement( 'div' );
				replacement.className =
					'wp-desktop-dock-peek__card plugin-replaced-card';
				return replacement;
			},
		);

		const tile = makeTile( true );
		attachDockPeek(
			makeDeps( {
				tile,
				getInstances: () => [ makeWindowStub( 'All Posts', 'edit-php' ) ],
			} ),
		);
		pointerEnter( tile );
		vi.advanceTimersByTime( 500 );

		expect(
			document.querySelector( '.plugin-replaced-card' ),
		).not.toBeNull();
		expect(
			document.querySelector( '.wp-desktop-dock-peek__card-titlebar' ),
		).toBeNull();

		wpHooks.removeFilter(
			'wp-desktop.dock.peek-card-element',
			'test/whole-card',
		);
	} );

	test( 'clicking an instance card focuses that window', () => {
		const tile = makeTile( true );
		const instances = [ makeWindowStub( 'All Posts', 'edit-php' ) ];
		const focus = vi.fn();
		attachDockPeek(
			makeDeps( {
				tile,
				getInstances: () => instances,
				windowManager: {
					getFocused: () => undefined,
					focus,
				} as unknown as Deps[ 'windowManager' ],
			} ),
		);
		pointerEnter( tile );
		vi.advanceTimersByTime( 500 );

		const instanceCard = document.querySelector< HTMLElement >(
			'.wp-desktop-dock-peek__card--instance',
		)!;
		instanceCard.click();
		expect( focus ).toHaveBeenCalledTimes( 1 );
		expect( focus ).toHaveBeenCalledWith( instances[ 0 ] );
	} );

	test( 'clicking the Ghost Card calls openNew', () => {
		const tile = makeTile( true );
		const openNew = vi.fn();
		attachDockPeek(
			makeDeps( {
				tile,
				getInstances: () => [ makeWindowStub( 'All Posts', 'edit-php' ) ],
				openNew,
			} ),
		);
		pointerEnter( tile );
		vi.advanceTimersByTime( 500 );

		const ghost = document.querySelector< HTMLElement >(
			'.wp-desktop-dock-peek__card--ghost',
		)!;
		ghost.click();
		expect( openNew ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'leaving the tile (with no relatedTarget into popover) tears down', () => {
		const tile = makeTile( true );
		attachDockPeek(
			makeDeps( {
				tile,
				getInstances: () => [ makeWindowStub( 'All Posts', 'edit-php' ) ],
			} ),
		);
		pointerEnter( tile );
		vi.advanceTimersByTime( 500 );
		expect( document.querySelector( '.wp-desktop-dock-peek' ) ).not.toBeNull();

		pointerLeave( tile );
		vi.advanceTimersByTime( 500 );
		expect( document.querySelector( '.wp-desktop-dock-peek' ) ).toBeNull();
	} );

	test( 'teardown function detaches listeners + removes popover', () => {
		const tile = makeTile( true );
		const detach = attachDockPeek(
			makeDeps( {
				tile,
				getInstances: () => [ makeWindowStub( 'All Posts', 'edit-php' ) ],
			} ),
		);
		pointerEnter( tile );
		vi.advanceTimersByTime( 500 );
		expect( document.querySelector( '.wp-desktop-dock-peek' ) ).not.toBeNull();

		detach();
		expect( document.querySelector( '.wp-desktop-dock-peek' ) ).toBeNull();

		pointerEnter( tile );
		vi.advanceTimersByTime( 500 );
		expect( document.querySelector( '.wp-desktop-dock-peek' ) ).toBeNull();
	} );
} );
