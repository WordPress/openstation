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
	tile.className = 'os-dock__item';
	if ( multi ) {
		tile.classList.add( 'os-dock__item--multi' );
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

function makeWindowStub(
	title: string,
	baseId: string,
	state: 'normal' | 'minimized' = 'normal',
) {
	const win: {
		id: string;
		state: string;
		restore: ReturnType< typeof vi.fn >;
		minimize: ReturnType< typeof vi.fn >;
		config: { title: string; icon: string; baseId: string };
	} = {
		id: baseId,
		state,
		restore: vi.fn( () => {
			win.state = 'normal';
		} ),
		minimize: vi.fn( () => {
			win.state = 'minimized';
		} ),
		config: {
			title,
			icon: 'dashicons-admin-post',
			baseId,
		},
	};
	return win;
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
		expect( document.querySelector( '.os-dock-peek' ) ).toBeNull();
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
		const peek = document.querySelector( '.os-dock-peek' );
		expect( peek ).not.toBeNull();
		expect(
			peek!.querySelectorAll( '.os-dock-peek__card--instance' )
				.length,
		).toBe( 1 );
		expect(
			peek!.querySelectorAll( '.os-dock-peek__card--ghost' )
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
		expect( document.querySelector( '.os-dock-peek' ) ).toBeNull();
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

		const peek = document.querySelector( '.os-dock-peek' )!;
		expect( peek ).not.toBeNull();
		expect(
			peek.querySelectorAll( '.os-dock-peek__card--instance' )
				.length,
		).toBe( 2 );
		const ghosts = peek.querySelectorAll(
			'.os-dock-peek__card--ghost',
		);
		expect( ghosts.length ).toBe( 1 );
		const allCards = peek.querySelectorAll( '.os-dock-peek__card' );
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
			'os.dock.peek-card-content',
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
			'.os-dock-peek__card--instance',
		)!;
		expect( card.querySelector( '.plugin-owned-thumb' ) ).not.toBeNull();
		expect( card.querySelector( '.plugin-owned-thumb' )?.getAttribute( 'data-window-id' ) ).toBe( 'edit-php' );
		expect( card.querySelectorAll( '.os-dock-peek__card-line' ).length ).toBe( 0 );
		const customBody = card.querySelector(
			'.os-dock-peek__card-body--custom',
		);
		expect( customBody ).not.toBeNull();

		wpHooks.removeFilter(
			'os.dock.peek-card-content',
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
			'.os-dock-peek__card--instance',
		)!;
		expect(
			card.querySelectorAll( '.os-dock-peek__card-dots i' ).length,
		).toBe( 3 );
		expect(
			card.querySelector( '.os-dock-peek__card-label' )
				?.textContent,
		).toBe( 'All Posts' );
		expect(
			card.querySelectorAll( '.os-dock-peek__card-line' ).length,
		).toBe( 3 );
		expect( card.style.getPropertyValue( '--peek-card-hue' ) ).toMatch(
			/^\d+$/,
		);
	} );

	test( 'hovering an instance card raises that window to front (preview mode)', () => {
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
			'.os-dock-peek__card--instance',
		);
		pointerEnter( cards[ 1 ] );
		expect( focus ).toHaveBeenCalledTimes( 1 );
		expect( focus ).toHaveBeenCalledWith( winB );
		expect( cards[ 1 ].dataset.preview ).toBe( '' );
	} );

	// Preview snap-back: after hovering an instance card, leaving
	// returns focus to the previously-focused window.
	test( 'hovering a non-minimized instance card then leaving returns focus to the previous window', () => {
		const tile = makeTile( true );
		const winA = makeWindowStub( 'All Posts', 'edit-php' );
		const winB = makeWindowStub( 'Editing post 42', 'edit-php' );
		const focus = vi.fn();
		const getById = vi.fn(
			( id: string ) => ( id === winA.id ? winA : undefined ),
		);
		attachDockPeek(
			makeDeps( {
				tile,
				getInstances: () => [ winA, winB ],
				windowManager: {
					getFocused: () => winA,
					focus,
					getById,
				} as unknown as Deps[ 'windowManager' ],
			} ),
		);
		pointerEnter( tile );
		vi.advanceTimersByTime( 500 );

		const cards = document.querySelectorAll< HTMLElement >(
			'.os-dock-peek__card--instance',
		);

		// Hover winB → preview.
		pointerEnter( cards[ 1 ] );
		expect( focus ).toHaveBeenCalledTimes( 1 );
		expect( focus ).toHaveBeenCalledWith( winB );
		expect( cards[ 1 ].dataset.preview ).toBe( '' );

		// Leave → focus returns to winA.
		focus.mockClear();
		pointerLeave( cards[ 1 ] );
		expect( getById ).toHaveBeenCalledWith( winA.id );
		expect( focus ).toHaveBeenCalledWith( winA );
		expect( cards[ 1 ].dataset.preview ).toBeUndefined();
	} );

	// Hovering a minimized card restores it so the user can see it.
	test( 'hovering a minimized instance card restores the window', () => {
		const tile = makeTile( true );
		const win = makeWindowStub( 'All Posts', 'edit-php', 'minimized' );
		const focus = vi.fn();
		attachDockPeek(
			makeDeps( {
				tile,
				getInstances: () => [ win ],
				windowManager: {
					getFocused: () => undefined,
					focus,
				} as unknown as Deps[ 'windowManager' ],
			} ),
		);
		pointerEnter( tile );
		vi.advanceTimersByTime( 500 );

		const card = document.querySelector< HTMLElement >(
			'.os-dock-peek__card--instance',
		)!;
		pointerEnter( card );
		expect( win.restore ).toHaveBeenCalledTimes( 1 );
		expect( focus ).not.toHaveBeenCalled();
		expect( card.dataset.preview ).toBe( '' );
		expect( card.dataset.state ).toBeUndefined();
	} );

	// Preview snap-back: a minimized window that was preview-restored
	// snaps back to minimized when the pointer leaves the card.
	test( 'hovering a minimized instance card then leaving snaps it back', () => {
		const tile = makeTile( true );
		const win = makeWindowStub( 'All Posts', 'edit-php', 'minimized' );
		const focus = vi.fn();
		attachDockPeek(
			makeDeps( {
				tile,
				getInstances: () => [ win ],
				windowManager: {
					getFocused: () => undefined,
					focus,
				} as unknown as Deps[ 'windowManager' ],
			} ),
		);
		pointerEnter( tile );
		vi.advanceTimersByTime( 500 );

		const card = document.querySelector< HTMLElement >(
			'.os-dock-peek__card--instance',
		)!;

		// Hover → preview restores.
		pointerEnter( card );
		expect( win.restore ).toHaveBeenCalledTimes( 1 );
		expect( card.dataset.preview ).toBe( '' );
		expect( card.dataset.state ).toBeUndefined();

		// Leave → snap back to minimized.
		pointerLeave( card );
		expect( win.minimize ).toHaveBeenCalledTimes( 1 );
		expect( card.dataset.preview ).toBeUndefined();
		expect( card.dataset.state ).toBe( 'minimized' );
	} );

	test( 'clicking a previewed card commits the preview permanently (no snap-back)', () => {
		const tile = makeTile( true );
		const win = makeWindowStub( 'All Posts', 'edit-php', 'minimized' );
		const focus = vi.fn();
		attachDockPeek(
			makeDeps( {
				tile,
				getInstances: () => [ win ],
				windowManager: {
					getFocused: () => undefined,
					focus,
				} as unknown as Deps[ 'windowManager' ],
			} ),
		);
		pointerEnter( tile );
		vi.advanceTimersByTime( 500 );

		const card = document.querySelector< HTMLElement >(
			'.os-dock-peek__card--instance',
		)!;

		// Hover → preview active.
		pointerEnter( card );
		expect( card.dataset.preview ).toBe( '' );

		// Click → commit the preview (focus + restore), no snap-back.
		card.click();
		// restore was called once from the pointerenter preview;
		// the second call from spawnFocusViewTransition is a no-op
		// because the window is no longer minimized at that point.
		expect( win.restore ).toHaveBeenCalledTimes( 1 );
		expect( focus ).toHaveBeenCalledTimes( 1 );
		expect( focus ).toHaveBeenCalledWith( win );
	} );

	test( 'hovering an already-focused card does not enter preview mode', () => {
		const tile = makeTile( true );
		const win = makeWindowStub( 'All Posts', 'edit-php' );
		const focus = vi.fn();
		attachDockPeek(
			makeDeps( {
				tile,
				getInstances: () => [ win ],
				windowManager: {
					getFocused: () => win,
					focus,
				} as unknown as Deps[ 'windowManager' ],
			} ),
		);
		pointerEnter( tile );
		vi.advanceTimersByTime( 500 );

		const card = document.querySelector< HTMLElement >(
			'.os-dock-peek__card--instance',
		)!;

		// Hover the already-focused card → no preview.
		pointerEnter( card );
		expect( focus ).not.toHaveBeenCalled();
		expect( card.dataset.preview ).toBeUndefined();

		// Leave should also be a no-op.
		pointerLeave( card );
		expect( focus ).not.toHaveBeenCalled();
	} );

	// Collapsed preview: minimized cards get data-state="minimized" for CSS.
	test( 'minimized instance card gets data-state="minimized" attribute', () => {
		const tile = makeTile( true );
		const win = makeWindowStub( 'All Posts', 'edit-php', 'minimized' );
		attachDockPeek(
			makeDeps( {
				tile,
				getInstances: () => [ win ],
				windowManager: {
					getFocused: () => undefined,
					focus: vi.fn(),
				} as unknown as Deps[ 'windowManager' ],
			} ),
		);
		pointerEnter( tile );
		vi.advanceTimersByTime( 500 );

		const card = document.querySelector< HTMLElement >(
			'.os-dock-peek__card--instance',
		)!;
		expect( card.dataset.state ).toBe( 'minimized' );
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
			'os.dock.peek-card-element',
			'test/whole-card',
			() => {
				const replacement = document.createElement( 'div' );
				replacement.className =
					'os-dock-peek__card plugin-replaced-card';
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
			document.querySelector( '.os-dock-peek__card-titlebar' ),
		).toBeNull();

		wpHooks.removeFilter(
			'os.dock.peek-card-element',
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
			'.os-dock-peek__card--instance',
		)!;
		instanceCard.click();
		expect( focus ).toHaveBeenCalledTimes( 1 );
		expect( focus ).toHaveBeenCalledWith( instances[ 0 ] );
	} );

	test( 'clicking a minimized instance card restores and focuses that window', () => {
		const tile = makeTile( true );
		const win = makeWindowStub( 'All Posts', 'edit-php', 'minimized' );
		const focus = vi.fn();
		attachDockPeek(
			makeDeps( {
				tile,
				getInstances: () => [ win ],
				windowManager: {
					getFocused: () => undefined,
					focus,
				} as unknown as Deps[ 'windowManager' ],
			} ),
		);
		pointerEnter( tile );
		vi.advanceTimersByTime( 500 );

		const instanceCard = document.querySelector< HTMLElement >(
			'.os-dock-peek__card--instance',
		)!;
		instanceCard.click();
		expect( focus ).toHaveBeenCalledTimes( 1 );
		expect( focus ).toHaveBeenCalledWith( win );
		expect( win.restore ).toHaveBeenCalledTimes( 1 );
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
			'.os-dock-peek__card--ghost',
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
		expect( document.querySelector( '.os-dock-peek' ) ).not.toBeNull();

		pointerLeave( tile );
		vi.advanceTimersByTime( 500 );
		expect( document.querySelector( '.os-dock-peek' ) ).toBeNull();
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
		expect( document.querySelector( '.os-dock-peek' ) ).not.toBeNull();

		detach();
		expect( document.querySelector( '.os-dock-peek' ) ).toBeNull();

		pointerEnter( tile );
		vi.advanceTimersByTime( 500 );
		expect( document.querySelector( '.os-dock-peek' ) ).toBeNull();
	} );
} );
