/**
 * Tests for the dock decoration hooks the default `Dock` renderer
 * fires while painting tiles. Plugins extend the rail through these
 * filters/actions without forking the renderer; the contract is part
 * of the public API surface (since 0.18.0) so a regression here
 * means a plugin author finds their decoration silently disappear.
 *
 * Each hook is exercised end-to-end against a real DOM-mounted
 * `Dock` so the behaviour pins the actual subscriber wiring rather
 * than just an internal call site.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	Dock,
	type DockHookContextBase,
	type DockItem,
	type DockRenderContext,
	type DockTileContext,
	type SystemDockItem,
} from '../../src/dock';
import { HOOKS } from '../../src/hooks';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';
import type { WindowManager } from '../../src/window-manager';

function makeManager(): WindowManager {
	return {
		getFocused: () => null,
		getAllByBaseId: () => [],
		getById: () => undefined,
		getActiveDesktopId: () => 'default-1',
	} as unknown as WindowManager;
}

function makeItem( overrides: Partial< DockItem > = {} ): DockItem {
	return {
		id: 'edit.php',
		title: 'Posts',
		icon: 'dashicons-admin-post',
		url: '/wp-admin/edit.php',
		badge: 0,
		submenu: [],
		multi: false,
		isCore: true,
		...overrides,
	};
}

const noopSystem: SystemDockItem = {
	id: 'jorvy',
	title: 'Jorvy',
	icon: 'dashicons-star-filled',
	onOpen: () => {},
};

function mount( items: DockItem[] = [] ): {
	container: HTMLElement;
	dock: Dock;
} {
	const container = document.createElement( 'nav' );
	container.id = 'desktop-mode-dock';
	document.body.appendChild( container );
	const dock = new Dock(
		container,
		makeManager(),
		items,
		'/wp-admin/',
		'bottom',
	);
	return { container, dock };
}

describe( 'dock decoration hooks', () => {
	beforeEach( () => installHooksStub() );
	afterEach( () => {
		clearHooksStub();
		document.body.innerHTML = '';
	} );

	test( 'tile-class filter can add a className per tile', () => {
		const wp = window.wp!;
		wp.hooks.addFilter(
			HOOKS.DOCK_TILE_CLASS,
			'test/decoration',
			( classes: unknown, ctx: unknown ) => {
				const list = Array.isArray( classes ) ? [ ...classes ] : [];
				const tileCtx = ctx as DockTileContext;
				if ( ! tileCtx.isSystem && tileCtx.item.id === 'edit.php' ) {
					list.push( 'plugin-decorated' );
				}
				return list;
			},
		);

		const { container } = mount( [ makeItem() ] );
		const tile = container.querySelector( '[data-menu-slug="edit.php"]' );
		expect( tile ).not.toBeNull();
		expect( tile?.classList.contains( 'plugin-decorated' ) ).toBe( true );
		// Default classes survive — filters must not stomp on the base.
		expect( tile?.classList.contains( 'desktop-mode-dock__item' ) ).toBe(
			true,
		);
	} );

	test( 'tile-element filter can wrap the tile in a custom container', () => {
		const wp = window.wp!;
		wp.hooks.addFilter(
			HOOKS.DOCK_TILE_ELEMENT,
			'test/wrap',
			( el: unknown ) => {
				const wrapper = document.createElement( 'div' );
				wrapper.className = 'plugin-wrap';
				wrapper.appendChild( el as HTMLElement );
				return wrapper;
			},
		);

		const { container } = mount( [ makeItem() ] );
		// Wrapper sits inside the dock's `__scroll` host; the original
		// tile lives inside the wrapper. Plugin contract: the returned
		// element is what gets painted as the tile; the shell still
		// finds `[data-menu-slug]` descendants for active state.
		const wrap = container.querySelector( '.desktop-mode-dock__scroll > .plugin-wrap' );
		expect( wrap ).not.toBeNull();
		expect( wrap?.querySelector( '[data-menu-slug="edit.php"]' ) ).not.toBeNull();
	} );

	test( 'tile-tooltip filter resolves once at bind time', () => {
		const wp = window.wp!;
		const calls: string[] = [];
		wp.hooks.addFilter(
			HOOKS.DOCK_TILE_TOOLTIP,
			'test/tooltip',
			( label: unknown, ctx: unknown ) => {
				calls.push( ( ctx as DockTileContext ).item.id );
				return `${ label as string } ✨`;
			},
		);

		const { container } = mount( [ makeItem() ] );
		const tile = container.querySelector< HTMLElement >(
			'[data-menu-slug="edit.php"]',
		);
		expect( tile?.dataset.dockTooltip ).toBe( 'Posts ✨' );
		expect( calls ).toEqual( [ 'edit.php' ] );

		// Pointerenter / pointerleave must not re-fire the filter — the
		// resolved text comes off the dataset, not the filter chain.
		tile?.dispatchEvent( new Event( 'pointerenter' ) );
		tile?.dispatchEvent( new Event( 'pointerleave' ) );
		expect( calls ).toEqual( [ 'edit.php' ] );
	} );

	test( 'tile-tooltip filter empty string suppresses the tooltip entirely', () => {
		const wp = window.wp!;
		wp.hooks.addFilter(
			HOOKS.DOCK_TILE_TOOLTIP,
			'test/silence',
			() => '',
		);

		const { container } = mount( [ makeItem() ] );
		const tile = container.querySelector< HTMLElement >(
			'[data-menu-slug="edit.php"]',
		);
		expect( tile?.dataset.dockTooltip ).toBe( '' );

		// Even with a pointerenter, the shared tooltip element must not
		// pick up the `--visible` class.
		tile?.dispatchEvent( new Event( 'pointerenter' ) );
		const tooltip = document.querySelector(
			'.desktop-mode-dock__tooltip',
		);
		expect(
			tooltip?.classList.contains( 'desktop-mode-dock__tooltip--visible' ),
		).toBe( false );
	} );

	test( 'before-render and after-render fire on construction with the right context', () => {
		const wp = window.wp!;
		const before = vi.fn();
		const after = vi.fn();
		wp.hooks.addAction(
			HOOKS.DOCK_BEFORE_RENDER,
			'test/before',
			before,
		);
		wp.hooks.addAction(
			HOOKS.DOCK_AFTER_RENDER,
			'test/after',
			after,
		);

		mount( [ makeItem(), makeItem( { id: 'upload.php', title: 'Media' } ) ] );

		expect( before ).toHaveBeenCalledTimes( 1 );
		expect( after ).toHaveBeenCalledTimes( 1 );

		const beforeCtx = before.mock.calls[ 0 ][ 0 ] as DockRenderContext;
		expect( beforeCtx.dockId ).toBe( 'desktop-mode-dock' );
		expect( beforeCtx.orientation ).toBe( 'bottom' );
		expect( beforeCtx.rail ).toBe( 'taskbar' );
		expect( beforeCtx.items ).toHaveLength( 2 );

		const afterCtx = after.mock.calls[ 0 ][ 0 ] as DockRenderContext;
		expect( afterCtx.tileElements.size ).toBe( 2 );
		expect( afterCtx.tileElements.has( 'edit.php' ) ).toBe( true );
	} );

	test( 'tile-rendered fires after each tile lands in the DOM', () => {
		const wp = window.wp!;
		const seen: Array< { id: string; isSystem: boolean; inDom: boolean } > =
			[];
		wp.hooks.addAction(
			HOOKS.DOCK_TILE_RENDERED,
			'test/rendered',
			( payload: unknown ) => {
				const p = payload as DockTileContext & {
					el: HTMLElement;
				};
				seen.push( {
					id: p.item.id,
					isSystem: p.isSystem,
					inDom: document.body.contains( p.el ),
				} );
			},
		);

		const { dock } = mount( [ makeItem() ] );
		dock.appendSystemItem( noopSystem );

		expect( seen.map( ( s ) => s.id ) ).toEqual( [ 'edit.php', 'jorvy' ] );
		expect( seen.every( ( s ) => s.inDom ) ).toBe( true );
		expect(
			seen.find( ( s ) => s.id === 'jorvy' )?.isSystem,
		).toBe( true );
		expect(
			seen.find( ( s ) => s.id === 'edit.php' )?.isSystem,
		).toBe( false );
	} );

	test( 'replaceItems re-fires before-render / tile-rendered / after-render', () => {
		const wp = window.wp!;
		const before = vi.fn();
		const after = vi.fn();
		const tiles = vi.fn();
		wp.hooks.addAction( HOOKS.DOCK_BEFORE_RENDER, 'test/b', before );
		wp.hooks.addAction( HOOKS.DOCK_AFTER_RENDER, 'test/a', after );
		wp.hooks.addAction( HOOKS.DOCK_TILE_RENDERED, 'test/t', tiles );

		const { dock } = mount( [ makeItem() ] );
		// Initial paint counted: 1 before, 1 tile, 1 after.
		expect( before ).toHaveBeenCalledTimes( 1 );
		expect( tiles ).toHaveBeenCalledTimes( 1 );
		expect( after ).toHaveBeenCalledTimes( 1 );

		dock.replaceItems( [
			makeItem( { id: 'edit.php', title: 'Posts' } ),
			makeItem( {
				id: 'upload.php',
				title: 'Media',
				isCore: true,
			} ),
		] );

		// One before, two tile-rendered (one per item), one after.
		expect( before ).toHaveBeenCalledTimes( 2 );
		expect( tiles ).toHaveBeenCalledTimes( 3 );
		expect( after ).toHaveBeenCalledTimes( 2 );
	} );

	test( 'context base carries dockId for left + bottom instances simultaneously', () => {
		const wp = window.wp!;
		const seen: string[] = [];
		wp.hooks.addAction(
			HOOKS.DOCK_BEFORE_RENDER,
			'test/disambig',
			( ctx: unknown ) =>
				seen.push( ( ctx as DockHookContextBase ).dockId ),
		);

		const left = document.createElement( 'nav' );
		left.id = 'desktop-mode-side-dock';
		document.body.appendChild( left );
		new Dock( left, makeManager(), [ makeItem() ], '/wp-admin/', 'left' );

		const bottom = document.createElement( 'nav' );
		bottom.id = 'desktop-mode-dock';
		document.body.appendChild( bottom );
		new Dock( bottom, makeManager(), [ makeItem() ], '/wp-admin/', 'bottom' );

		expect( seen ).toEqual( [
			'desktop-mode-side-dock',
			'desktop-mode-dock',
		] );
	} );
} );
