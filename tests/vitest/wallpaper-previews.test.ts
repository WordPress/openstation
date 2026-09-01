/**
 * Wallpaper live previews — the OS Settings picker's lazy
 * `renderPreview` mounts (settings/sections/wallpaper-previews.ts).
 *
 * Covers: overlay creation only for defs that declare `renderPreview`,
 * visibility-driven mount/teardown, the `previewParams` seed + the
 * `os.wallpaper.preview-params` filter, the concurrency cap,
 * tile repurposing on grid re-render, the async-mount race guard, and
 * dispose (both direct and via the window-closed self-clean).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import type { FakeWpHooks } from './helpers/hooks-stub';
import * as registry from '../../src/wallpapers/registry';
import {
	createWallpaperPreviewManager,
	PREVIEW_OVERLAY_CLASS,
	type WallpaperPreviewManager,
} from '../../apps/os-settings/parts/wallpaper-previews';
import type {
	WallpaperPreviewContext,
	WallpaperTeardown,
} from '../../src/wallpapers/types';

/**
 * Controllable IntersectionObserver double. The manager treats "no
 * IntersectionObserver" as "no live previews", so tests install this
 * before creating a manager and drive visibility by hand.
 */
class FakeIntersectionObserver {
	static instances: FakeIntersectionObserver[] = [];
	observed: Element[] = [];
	private cb: IntersectionObserverCallback;

	constructor( cb: IntersectionObserverCallback ) {
		this.cb = cb;
		FakeIntersectionObserver.instances.push( this );
	}
	observe( el: Element ): void {
		this.observed.push( el );
	}
	unobserve( el: Element ): void {
		this.observed = this.observed.filter( ( o ) => o !== el );
	}
	disconnect(): void {
		this.observed = [];
	}
	trigger( targets: Element[], isIntersecting: boolean ): void {
		this.cb(
			targets.map( ( target ) => ( {
				target,
				isIntersecting,
			} ) ) as unknown as IntersectionObserverEntry[],
			this as unknown as IntersectionObserver,
		);
	}
}

const observerFor = (): FakeIntersectionObserver => {
	const instance = FakeIntersectionObserver.instances.at( -1 );
	if ( ! instance ) {
		throw new Error( 'no IntersectionObserver was constructed' );
	}
	return instance;
};

/** Let pending mount promise chains settle. */
const flush = (): Promise< void > =>
	new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

function makeTile( root: HTMLElement, id: string ): HTMLElement {
	const tile = document.createElement( 'os-swatch' );
	tile.dataset.wallpaperId = id;
	root.appendChild( tile );
	return tile;
}

function registerLiveDef(
	id: string,
	overrides: Partial< {
		previewParams: Record< string, unknown >;
		renderPreview: (
			container: HTMLElement,
			ctx: WallpaperPreviewContext,
		) => WallpaperTeardown | Promise< WallpaperTeardown >;
	} > = {},
): { renderPreview: ReturnType< typeof vi.fn >; teardown: ReturnType< typeof vi.fn > } {
	const teardown = vi.fn();
	const renderPreview = vi.fn(
		overrides.renderPreview ?? ( (): WallpaperTeardown => teardown ),
	);
	registry.register( {
		id,
		label: id,
		type: 'canvas',
		preview: '#000',
		mount: () => () => {},
		renderPreview,
		previewParams: overrides.previewParams,
	} );
	return { renderPreview, teardown };
}

let hooks: FakeWpHooks;
let root: HTMLElement;
let managers: WallpaperPreviewManager[];

/** Create a manager and track it for afterEach disposal. */
function makeManager(): WallpaperPreviewManager {
	const manager = createWallpaperPreviewManager( root );
	managers.push( manager );
	return manager;
}

beforeEach( () => {
	hooks = installHooksStub();
	FakeIntersectionObserver.instances = [];
	vi.stubGlobal( 'IntersectionObserver', FakeIntersectionObserver );
	root = document.createElement( 'div' );
	document.body.appendChild( root );
	managers = [];
} );

afterEach( () => {
	managers.forEach( ( m ) => m.dispose() );
	for ( const def of registry.all() ) {
		if ( def.id.startsWith( 'test-' ) ) {
			registry.unregister( def.id );
		}
	}
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
	clearHooksStub();
} );

describe( 'overlay reconciliation (sync)', () => {
	test( 'creates an overlay only for defs that declare renderPreview', () => {
		registerLiveDef( 'test-live' );
		registry.register( {
			id: 'test-flat',
			label: 'flat',
			type: 'css',
			value: '#111',
			preview: '#111',
		} );
		const liveTile = makeTile( root, 'test-live' );
		const flatTile = makeTile( root, 'test-flat' );

		makeManager().sync();

		expect(
			liveTile.querySelector( `.${ PREVIEW_OVERLAY_CLASS }` ),
		).not.toBeNull();
		expect(
			flatTile.querySelector( `.${ PREVIEW_OVERLAY_CLASS }` ),
		).toBeNull();
		expect( observerFor().observed ).toContain( liveTile );
		expect( observerFor().observed ).not.toContain( flatTile );
	} );

	test( 'a repurposed tile (grid re-render) drops the old preview', async () => {
		const a = registerLiveDef( 'test-a' );
		registerLiveDef( 'test-b' );
		const tile = makeTile( root, 'test-a' );
		const manager = makeManager();
		manager.sync();
		observerFor().trigger( [ tile ], true );
		await flush();
		expect( a.renderPreview ).toHaveBeenCalledTimes( 1 );

		// The unkeyed grid re-render now shows wallpaper B in this slot.
		tile.dataset.wallpaperId = 'test-b';
		manager.sync();

		expect( a.teardown ).toHaveBeenCalledTimes( 1 );
		// A fresh overlay exists for the new def, awaiting visibility.
		expect(
			tile.querySelectorAll( `.${ PREVIEW_OVERLAY_CLASS }` ),
		).toHaveLength( 1 );
	} );

	test( 'a tile that leaves the grid is torn down on the next sync', async () => {
		const a = registerLiveDef( 'test-a' );
		const tile = makeTile( root, 'test-a' );
		const manager = makeManager();
		manager.sync();
		observerFor().trigger( [ tile ], true );
		await flush();

		tile.remove();
		manager.sync();

		expect( a.teardown ).toHaveBeenCalledTimes( 1 );
	} );
} );

describe( 'visibility-driven mount / teardown', () => {
	test( 'mounts when the tile intersects, tears down when it leaves', async () => {
		const { renderPreview, teardown } = registerLiveDef( 'test-live' );
		const tile = makeTile( root, 'test-live' );
		makeManager().sync();

		expect( renderPreview ).not.toHaveBeenCalled();

		observerFor().trigger( [ tile ], true );
		await flush();
		expect( renderPreview ).toHaveBeenCalledTimes( 1 );
		const [ container, ctx ] = renderPreview.mock.calls[ 0 ] as [
			HTMLElement,
			WallpaperPreviewContext,
		];
		expect( container.classList.contains( PREVIEW_OVERLAY_CLASS ) ).toBe(
			true,
		);
		expect( ctx.id ).toBe( 'test-live' );

		observerFor().trigger( [ tile ], false );
		expect( teardown ).toHaveBeenCalledTimes( 1 );

		// Back into view → a fresh mount.
		observerFor().trigger( [ tile ], true );
		await flush();
		expect( renderPreview ).toHaveBeenCalledTimes( 2 );
	} );

	test( 'an async mount resolving after the tile left tears down immediately', async () => {
		const teardown = vi.fn();
		let resolveMount!: ( t: WallpaperTeardown ) => void;
		registerLiveDef( 'test-slow', {
			renderPreview: () =>
				new Promise< WallpaperTeardown >( ( resolve ) => {
					resolveMount = resolve;
				} ),
		} );
		const tile = makeTile( root, 'test-slow' );
		makeManager().sync();

		observerFor().trigger( [ tile ], true );
		await flush();
		observerFor().trigger( [ tile ], false ); // left before resolve

		resolveMount( teardown );
		await flush();
		expect( teardown ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'a throwing renderPreview leaves the CSS fallback (empty overlay), no crash', async () => {
		registerLiveDef( 'test-boom', {
			renderPreview: () => {
				throw new Error( 'boom' );
			},
		} );
		const tile = makeTile( root, 'test-boom' );
		makeManager().sync();
		const consoleError = vi
			.spyOn( console, 'error' )
			.mockImplementation( () => {} );

		observerFor().trigger( [ tile ], true );
		await flush();

		const overlay = tile.querySelector( `.${ PREVIEW_OVERLAY_CLASS }` );
		expect( overlay?.childNodes ).toHaveLength( 0 );
		expect( consoleError ).toHaveBeenCalled();
		consoleError.mockRestore();
	} );
} );

describe( 'preview params', () => {
	test( 'ctx.params carries the def’s previewParams seed', async () => {
		const { renderPreview } = registerLiveDef( 'test-live', {
			previewParams: { siteAgeDays: 540 },
		} );
		const tile = makeTile( root, 'test-live' );
		makeManager().sync();
		observerFor().trigger( [ tile ], true );
		await flush();

		const ctx = renderPreview.mock
			.calls[ 0 ][ 1 ] as WallpaperPreviewContext;
		expect( ctx.params ).toEqual( { siteAgeDays: 540 } );
	} );

	test( 'the preview-params filter can override per wallpaper id', async () => {
		const { renderPreview } = registerLiveDef( 'test-live', {
			previewParams: { siteAgeDays: 540 },
		} );
		hooks.addFilter(
			'os.wallpaper.preview-params',
			'vitest/override',
			( ( params: Record< string, unknown >, id: string ) =>
				id === 'test-live'
					? { ...params, siteAgeDays: 0 }
					: params ) as ( ...a: unknown[] ) => unknown,
		);
		const tile = makeTile( root, 'test-live' );
		makeManager().sync();
		observerFor().trigger( [ tile ], true );
		await flush();

		const ctx = renderPreview.mock
			.calls[ 0 ][ 1 ] as WallpaperPreviewContext;
		expect( ctx.params ).toEqual( { siteAgeDays: 0 } );
	} );

	test( 'a filter returning garbage is ignored — the seed wins', async () => {
		const { renderPreview } = registerLiveDef( 'test-live', {
			previewParams: { siteAgeDays: 540 },
		} );
		hooks.addFilter(
			'os.wallpaper.preview-params',
			'vitest/garbage',
			( () => undefined ) as ( ...a: unknown[] ) => unknown,
		);
		const tile = makeTile( root, 'test-live' );
		makeManager().sync();
		observerFor().trigger( [ tile ], true );
		await flush();

		const ctx = renderPreview.mock
			.calls[ 0 ][ 1 ] as WallpaperPreviewContext;
		expect( ctx.params ).toEqual( { siteAgeDays: 540 } );
	} );
} );

describe( 'concurrency cap', () => {
	test( 'at most 4 previews mount; the rest keep the CSS fallback', async () => {
		const defs = [ 1, 2, 3, 4, 5, 6 ].map( ( n ) =>
			registerLiveDef( `test-cap-${ n }` ),
		);
		const tiles = [ 1, 2, 3, 4, 5, 6 ].map( ( n ) =>
			makeTile( root, `test-cap-${ n }` ),
		);
		makeManager().sync();
		observerFor().trigger( tiles, true );
		await flush();

		const mounted = defs.filter(
			( d ) => d.renderPreview.mock.calls.length > 0,
		);
		expect( mounted ).toHaveLength( 4 );

		// A slot frees up → a capped tile can mount on its next
		// intersection tick.
		observerFor().trigger( [ tiles[ 0 ] ], false );
		observerFor().trigger( [ tiles[ 4 ] ], true );
		observerFor().trigger( [ tiles[ 5 ] ], true );
		await flush();
		const mountedAfter = defs.filter(
			( d ) => d.renderPreview.mock.calls.length > 0,
		);
		expect( mountedAfter ).toHaveLength( 5 );
	} );
} );

/**
 * Controllable ResizeObserver double, mirroring the IO one. When
 * installed, the manager defers mounts until tiles have a real size
 * and remounts on post-mount size drift.
 */
class FakeResizeObserver {
	static instances: FakeResizeObserver[] = [];
	observed: Element[] = [];
	private cb: ResizeObserverCallback;

	constructor( cb: ResizeObserverCallback ) {
		this.cb = cb;
		FakeResizeObserver.instances.push( this );
	}
	observe( el: Element ): void {
		this.observed.push( el );
	}
	unobserve( el: Element ): void {
		this.observed = this.observed.filter( ( o ) => o !== el );
	}
	disconnect(): void {
		this.observed = [];
	}
	trigger( targets: Element[] ): void {
		this.cb(
			targets.map( ( target ) => ( {
				target,
			} ) ) as unknown as ResizeObserverEntry[],
			this as unknown as ResizeObserver,
		);
	}
}

function setTileSize( tile: HTMLElement, width: number, height: number ): void {
	Object.defineProperty( tile, 'clientWidth', {
		value: width,
		configurable: true,
	} );
	Object.defineProperty( tile, 'clientHeight', {
		value: height,
		configurable: true,
	} );
}

describe( 'size-aware mounting (ResizeObserver available)', () => {
	beforeEach( () => {
		FakeResizeObserver.instances = [];
		vi.stubGlobal( 'ResizeObserver', FakeResizeObserver );
	} );

	test( 'defers the mount until the tile has a real layout box', async () => {
		const { renderPreview } = registerLiveDef( 'test-live' );
		const tile = makeTile( root, 'test-live' ); // clientWidth 0 in jsdom
		makeManager().sync();

		observerFor().trigger( [ tile ], true );
		await flush();
		// Visible but zero-sized (settings window still opening) — the
		// mount must NOT run against the transitional box.
		expect( renderPreview ).not.toHaveBeenCalled();

		setTileSize( tile, 180, 101 );
		FakeResizeObserver.instances[ 0 ].trigger( [ tile ] );
		await flush();
		expect( renderPreview ).toHaveBeenCalledTimes( 1 );
		const ctx = renderPreview.mock
			.calls[ 0 ][ 1 ] as WallpaperPreviewContext;
		expect( ctx.width ).toBe( 180 );
		expect( ctx.height ).toBe( 101 );
	} );

	test( 'remounts (debounced) when the tile size drifts after mount', async () => {
		vi.useFakeTimers();
		try {
			const { renderPreview, teardown } = registerLiveDef( 'test-live' );
			const tile = makeTile( root, 'test-live' );
			setTileSize( tile, 180, 101 );
			makeManager().sync();
			observerFor().trigger( [ tile ], true );
			await vi.advanceTimersByTimeAsync( 0 );
			expect( renderPreview ).toHaveBeenCalledTimes( 1 );

			// The user resizes the OS Settings window → grid reflows.
			setTileSize( tile, 260, 146 );
			FakeResizeObserver.instances[ 0 ].trigger( [ tile ] );
			// Not yet — debounce window still open.
			await vi.advanceTimersByTimeAsync( 100 );
			expect( teardown ).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync( 300 );
			expect( teardown ).toHaveBeenCalledTimes( 1 );
			expect( renderPreview ).toHaveBeenCalledTimes( 2 );
			const ctx = renderPreview.mock
				.calls[ 1 ][ 1 ] as WallpaperPreviewContext;
			expect( ctx.width ).toBe( 260 );
		} finally {
			vi.useRealTimers();
		}
	} );

	test( 'a sub-epsilon wiggle does not remount', async () => {
		vi.useFakeTimers();
		try {
			const { renderPreview, teardown } = registerLiveDef( 'test-live' );
			const tile = makeTile( root, 'test-live' );
			setTileSize( tile, 180, 101 );
			makeManager().sync();
			observerFor().trigger( [ tile ], true );
			await vi.advanceTimersByTimeAsync( 0 );

			setTileSize( tile, 183, 101 ); // < 4px drift
			FakeResizeObserver.instances[ 0 ].trigger( [ tile ] );
			await vi.advanceTimersByTimeAsync( 500 );
			expect( teardown ).not.toHaveBeenCalled();
			expect( renderPreview ).toHaveBeenCalledTimes( 1 );
		} finally {
			vi.useRealTimers();
		}
	} );
} );

describe( 'dispose', () => {
	test( 'tears down every live preview and disconnects the observer', async () => {
		const a = registerLiveDef( 'test-a' );
		const b = registerLiveDef( 'test-b' );
		const tiles = [ makeTile( root, 'test-a' ), makeTile( root, 'test-b' ) ];
		const manager = makeManager();
		manager.sync();
		observerFor().trigger( tiles, true );
		await flush();

		manager.dispose();

		expect( a.teardown ).toHaveBeenCalledTimes( 1 );
		expect( b.teardown ).toHaveBeenCalledTimes( 1 );
		expect( observerFor().observed ).toHaveLength( 0 );
	} );

	test( 'self-disposes when a window closes and the root left the DOM', async () => {
		const a = registerLiveDef( 'test-a' );
		const tile = makeTile( root, 'test-a' );
		const manager = makeManager();
		manager.sync();
		observerFor().trigger( [ tile ], true );
		await flush();

		root.remove(); // panel body torn down with the window
		document.dispatchEvent(
			new CustomEvent( 'os-window-closed' ),
		);

		expect( a.teardown ).toHaveBeenCalledTimes( 1 );

		// Idempotent — a later explicit dispose is a no-op.
		manager.dispose();
		expect( a.teardown ).toHaveBeenCalledTimes( 1 );
	} );
} );
