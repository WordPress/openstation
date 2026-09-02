/**
 * Wallpaper live previews — mounts `renderPreview` callbacks into the
 * OS Settings swatch grid.
 *
 * Each `<os-swatch>` tile whose wallpaper def declares
 * `renderPreview` gets a light-DOM overlay `<div>` (slotted into the
 * tile button, absolutely positioned over the CSS `preview`
 * background). The preview mounts lazily — only when the tile is
 * actually visible per IntersectionObserver — and tears down when the
 * tile scrolls away, the tab hides, the grid re-renders to a
 * different wallpaper in that slot, or the panel goes away. The CSS
 * `preview` string underneath stays untouched the whole time, so
 * every failure mode degrades to exactly what the picker showed
 * before live previews existed.
 *
 * WebGL contexts are a per-page scarce resource (~8–16 in most
 * browsers, shared with the active wallpaper and other canvas windows), so
 * concurrent live previews are capped at {@link MAX_LIVE_PREVIEWS};
 * tiles beyond the cap keep their CSS fallback until a slot frees up
 * (scroll-away, tab switch).
 */

import { applyFilters, HOOKS } from '../../../src/hooks';
import * as registry from '../../../src/wallpapers/registry';
import { getWallpaperSettings } from '../../../src/wallpapers/settings-store';
import type {
	WallpaperDef,
	WallpaperPreviewContext,
	WallpaperTeardown,
} from '../../../src/wallpapers/types';
import { isPromise } from '../../../src/settings/utils';

/** Ceiling on simultaneously-mounted live previews. */
const MAX_LIVE_PREVIEWS = 4;

/**
 * Minimum tile edge (CSS px) required before a preview mounts. Canvas
 * wallpapers typically initialize with `autoDensity`, which pins the
 * canvas to inline pixel sizes measured at mount — mounting against a
 * zero/transitional layout box (settings window still opening, tab
 * mid-flip) bakes garbage dimensions in permanently. Below this we
 * wait for the ResizeObserver to report a real size.
 */
const MIN_MOUNT_SIZE = 24;

/**
 * How far (CSS px) the tile may drift from its mount-time size before
 * the preview is remounted. Pixi's `resizeTo` only re-measures on
 * BROWSER window resizes; a desktop-window resize / grid reflow leaves
 * the canvas pinned at stale pixels, so the manager heals by
 * remounting at the new size.
 */
const REMOUNT_EPSILON = 4;

/** Debounce for resize-triggered remounts (a drag emits a stream). */
const REMOUNT_DEBOUNCE_MS = 250;

/** Class of the overlay div slotted into each previewing tile. */
export const PREVIEW_OVERLAY_CLASS =
	'os-settings__wallpaper-live-preview';

/** Per-tile mount state. */
interface TilePreview {
	tile: HTMLElement;
	overlay: HTMLElement;
	defId: string;
	/**
	 * Bumped on every unmount/dispose — an async mount that resolves
	 * on a stale generation tears itself down instead of leaking.
	 * Same race guard the WallpaperLayer uses.
	 */
	generation: number;
	teardown: WallpaperTeardown | null;
	/** True while an async mount is in flight (counts against the cap). */
	mounting: boolean;
	/** Currently intersecting per the IntersectionObserver. */
	visible: boolean;
	/** Tile size the live mount was measured against. */
	mountWidth: number;
	mountHeight: number;
	/** Pending debounced remount, if any. */
	remountTimer: ReturnType< typeof setTimeout > | null;
}

export interface WallpaperPreviewManager {
	/**
	 * Reconcile overlays/observers against the tiles currently in the
	 * grid. Call after every grid paint.
	 */
	sync(): void;
	/** Tear down every preview and stop observing. Idempotent. */
	dispose(): void;
}

/** Shape of the bits we need from the public `wp.os` API. */
interface DesktopApiShape {
	loadModules?: ( ids: string[] ) => Promise< void >;
}

function loadNeeds( def: WallpaperDef ): Promise< void > {
	const needs = def.type === 'canvas' ? def.needs : undefined;
	if ( ! needs || needs.length === 0 ) {
		return Promise.resolve();
	}
	const api = ( window.wp as { os?: DesktopApiShape } | undefined )
		?.os;
	if ( ! api?.loadModules ) {
		return Promise.reject(
			new Error(
				`[openstation] Wallpaper "${ def.id }" declares needs ` +
					`but wp.os.loadModules is unavailable.`,
			),
		);
	}
	return api.loadModules( needs );
}

/** Plugin base URL — same source the shell hands to WallpaperLayer. */
function pluginUrl(): string {
	const config = (
		window as unknown as { openStationConfig?: { pluginUrl?: string } }
	).openStationConfig;
	return config?.pluginUrl ?? '';
}

function prefersReducedMotion(): boolean {
	return (
		typeof window.matchMedia === 'function' &&
		window.matchMedia( '( prefers-reduced-motion: reduce )' ).matches
	);
}

/**
 * Build the preview params for a def: the author's `previewParams`
 * seed run through the `os.wallpaper.preview-params` filter.
 * A filter returning a non-object is ignored (seed wins) — same
 * defensive posture as the registry's non-array filter guard.
 */
function previewParams( def: WallpaperDef ): Record< string, unknown > {
	const seed: Record< string, unknown > = { ...( def.previewParams ?? {} ) };
	const filtered = applyFilters< Record< string, unknown > >(
		HOOKS.WALLPAPER_PREVIEW_PARAMS,
		seed,
		def.id,
	);
	if ( ! filtered || typeof filtered !== 'object' ) {
		return seed;
	}
	return filtered;
}

/**
 * Create a preview manager bound to `root` (the wallpaper section
 * wrapper — tiles are found via `os-swatch[data-wallpaper-id]`
 * inside it).
 *
 * Lifecycle: the caller invokes `sync()` after each grid paint and
 * `dispose()` when replacing the section. The manager additionally
 * self-disposes when any desktop window closes while `root` is no
 * longer connected — that's the "user closed OS Settings" signal, and
 * it's what keeps preview WebGL contexts from outliving the panel.
 */
export function createWallpaperPreviewManager(
	root: HTMLElement,
): WallpaperPreviewManager {
	const previews = new Map< HTMLElement, TilePreview >();
	let disposed = false;

	const liveCount = (): number => {
		let n = 0;
		previews.forEach( ( p ) => {
			if ( p.teardown || p.mounting ) {
				n++;
			}
		} );
		return n;
	};

	const clearRemountTimer = ( p: TilePreview ): void => {
		if ( p.remountTimer !== null ) {
			clearTimeout( p.remountTimer );
			p.remountTimer = null;
		}
	};

	const unmount = ( p: TilePreview ): void => {
		p.generation++;
		p.mounting = false;
		clearRemountTimer( p );
		if ( p.teardown ) {
			const teardown = p.teardown;
			p.teardown = null;
			try {
				teardown();
			} catch ( err ) {
				if ( typeof console !== 'undefined' ) {
					console.error(
						`[openstation] Wallpaper "${ p.defId }" preview teardown threw:`,
						err,
					);
				}
			}
		}
		p.overlay.innerHTML = '';
	};

	/**
	 * Mount if every precondition holds: visible, not already live,
	 * under the cap, and (when a ResizeObserver is available to tell
	 * us otherwise later) laid out at a real size. Callers that flip
	 * one of the preconditions call this rather than mount directly.
	 */
	const maybeMount = ( p: TilePreview ): void => {
		if ( disposed || ! p.visible || p.teardown || p.mounting ) {
			return;
		}
		if (
			resizeObserver &&
			( p.tile.clientWidth < MIN_MOUNT_SIZE ||
				p.tile.clientHeight < MIN_MOUNT_SIZE )
		) {
			// Transitional layout (window still opening, tab mid-flip).
			// The ResizeObserver fires again once the box is real.
			return;
		}
		mount( p );
	};

	const mount = ( p: TilePreview ): void => {
		const def = registry.get( p.defId );
		if ( ! def?.renderPreview ) {
			return;
		}
		if ( liveCount() >= MAX_LIVE_PREVIEWS ) {
			// Over the WebGL budget — the CSS `preview` fallback stays.
			return;
		}
		const gen = ++p.generation;
		p.mounting = true;
		p.mountWidth = p.tile.clientWidth;
		p.mountHeight = p.tile.clientHeight;

		const ctx: WallpaperPreviewContext = {
			id: def.id,
			pluginUrl: pluginUrl(),
			prefersReducedMotion: prefersReducedMotion(),
			visible: ! document.hidden,
			settings: getWallpaperSettings( def.id ),
			params: previewParams( def ),
			width: p.mountWidth,
			height: p.mountHeight,
		};

		const onResolve = ( teardown: WallpaperTeardown ): void => {
			if ( gen !== p.generation || disposed ) {
				// A stale mount — the tile scrolled away (or the grid
				// re-rendered) while we were loading. Release
				// immediately; don't track.
				try {
					teardown();
				} catch {
					/* already racing; best-effort */
				}
				return;
			}
			p.mounting = false;
			p.teardown = teardown;
			// The tile may have settled at a different size while the
			// async mount was in flight (window-open animation) — no
			// further ResizeObserver event will fire for that, so
			// check the drift here.
			if ( sizeDrifted( p ) ) {
				scheduleRemount( p );
			}
		};

		const onError = ( err: unknown ): void => {
			if ( gen !== p.generation ) {
				return;
			}
			p.mounting = false;
			p.overlay.innerHTML = '';
			if ( typeof console !== 'undefined' ) {
				console.error(
					`[openstation] Wallpaper "${ def.id }" renderPreview failed:`,
					err,
				);
			}
		};

		loadNeeds( def ).then( () => {
			if ( gen !== p.generation || disposed ) {
				return;
			}
			let result;
			try {
				result = def.renderPreview!( p.overlay, ctx );
			} catch ( err ) {
				onError( err );
				return;
			}
			if ( isPromise( result ) ) {
				result.then( onResolve, onError );
				return;
			}
			onResolve( result );
		}, onError );
	};

	/** Has the tile moved > epsilon from the size the mount measured? */
	const sizeDrifted = ( p: TilePreview ): boolean =>
		Math.abs( p.tile.clientWidth - p.mountWidth ) > REMOUNT_EPSILON ||
		Math.abs( p.tile.clientHeight - p.mountHeight ) > REMOUNT_EPSILON;

	/**
	 * Debounced remount after a tile-size change. A window-resize drag
	 * emits a stream of ResizeObserver events; we only remount once the
	 * size has been stable for {@link REMOUNT_DEBOUNCE_MS} and still
	 * differs from what the live mount was measured against.
	 */
	const scheduleRemount = ( p: TilePreview ): void => {
		clearRemountTimer( p );
		p.remountTimer = setTimeout( () => {
			p.remountTimer = null;
			if ( disposed || ! p.teardown || ! sizeDrifted( p ) ) {
				return;
			}
			unmount( p );
			maybeMount( p );
		}, REMOUNT_DEBOUNCE_MS );
	};

	// Visibility-driven mount/unmount. `null` when the environment has
	// no IntersectionObserver (old browsers, some test harnesses) —
	// tiles then simply keep their CSS preview.
	const onIntersect = ( entries: IntersectionObserverEntry[] ): void => {
		for ( const entry of entries ) {
			const p = previews.get( entry.target as HTMLElement );
			if ( ! p ) {
				continue;
			}
			p.visible = entry.isIntersecting;
			if ( entry.isIntersecting ) {
				maybeMount( p );
			} else {
				unmount( p );
			}
		}
	};
	const observer =
		typeof IntersectionObserver === 'function'
			? new IntersectionObserver( onIntersect, { threshold: 0.1 } )
			: null;

	// Size-driven (re)mounts: mounts deferred by MIN_MOUNT_SIZE fire
	// once the tile gets a real box; live previews whose tile drifted
	// (desktop-window resize, grid reflow) heal via scheduleRemount.
	// Pixi's own `resizeTo` can't do this — it only re-measures on
	// BROWSER window resizes, and `autoDensity` pins the canvas to
	// mount-time pixels otherwise.
	const onTileResize = ( entries: ResizeObserverEntry[] ): void => {
		for ( const entry of entries ) {
			const p = previews.get( entry.target as HTMLElement );
			if ( ! p || disposed ) {
				continue;
			}
			if ( ! p.teardown && ! p.mounting ) {
				maybeMount( p );
			} else if ( p.teardown && sizeDrifted( p ) ) {
				scheduleRemount( p );
			}
		}
	};
	const resizeObserver =
		typeof ResizeObserver === 'function'
			? new ResizeObserver( onTileResize )
			: null;

	const remove = ( p: TilePreview ): void => {
		unmount( p );
		observer?.unobserve( p.tile );
		resizeObserver?.unobserve( p.tile );
		p.overlay.remove();
		previews.delete( p.tile );
	};

	const sync = (): void => {
		if ( disposed ) {
			return;
		}
		const tiles = root.querySelectorAll< HTMLElement >(
			'os-swatch[data-wallpaper-id]',
		);
		const seen = new Set< HTMLElement >();
		tiles.forEach( ( tile ) => {
			seen.add( tile );
			const defId = tile.dataset.wallpaperId ?? '';
			const def = registry.get( defId );
			const wants = !! def?.renderPreview && !! observer;
			const existing = previews.get( tile );

			if ( existing && ( existing.defId !== defId || ! wants ) ) {
				// The unkeyed grid re-render repurposed this tile for a
				// different wallpaper, or the def lost its preview
				// (plugin deactivated). Drop and re-create below.
				remove( existing );
			}
			if ( ! wants || previews.has( tile ) ) {
				return;
			}

			const overlay = document.createElement( 'div' );
			overlay.className = PREVIEW_OVERLAY_CLASS;
			overlay.setAttribute( 'aria-hidden', 'true' );
			tile.appendChild( overlay );
			previews.set( tile, {
				tile,
				overlay,
				defId,
				generation: 0,
				teardown: null,
				mounting: false,
				visible: false,
				mountWidth: 0,
				mountHeight: 0,
				remountTimer: null,
			} );
			observer!.observe( tile );
			resizeObserver?.observe( tile );
		} );

		// Tiles that fell out of the grid entirely (wallpaper
		// unregistered and the grid shrank).
		previews.forEach( ( p, tile ) => {
			if ( ! seen.has( tile ) ) {
				remove( p );
			}
		} );
	};

	const dispose = (): void => {
		if ( disposed ) {
			return;
		}
		disposed = true;
		previews.forEach( ( p ) => unmount( p ) );
		previews.clear();
		observer?.disconnect();
		resizeObserver?.disconnect();
		document.removeEventListener(
			'os-window-closed',
			onWindowClosed,
		);
	};

	// Closing the OS Settings window doesn't re-render the section, so
	// nothing calls sync()/dispose() on that path. Any window close is
	// a cheap moment to check whether our DOM is gone.
	const onWindowClosed = (): void => {
		if ( ! root.isConnected ) {
			dispose();
		}
	};
	document.addEventListener( 'os-window-closed', onWindowClosed );

	return { sync, dispose };
}
