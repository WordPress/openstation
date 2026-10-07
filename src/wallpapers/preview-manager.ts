import { applyFilters, HOOKS } from '../hooks';
import * as registry from './registry';
import { getWallpaperSettings } from './settings-store';
import type {
	WallpaperDef,
	WallpaperPreviewContext,
	WallpaperTeardown,
} from './types';
import { isPromise } from '../settings/utils';

const MAX_LIVE_PREVIEWS = 4;

const MIN_MOUNT_SIZE = 24;

const REMOUNT_EPSILON = 4;

const REMOUNT_DEBOUNCE_MS = 250;

export const PREVIEW_OVERLAY_CLASS =
	'os-settings__wallpaper-live-preview';

interface TilePreview {
	tile: HTMLElement;
	overlay: HTMLElement;
	defId: string;

	generation: number;
	teardown: WallpaperTeardown | null;

	mounting: boolean;

	visible: boolean;

	mountWidth: number;
	mountHeight: number;

	remountTimer: ReturnType< typeof setTimeout > | null;
}

export interface WallpaperPreviewManager {

	sync(): void;

	dispose(): void;
}

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

	const maybeMount = ( p: TilePreview ): void => {
		if ( disposed || ! p.visible || p.teardown || p.mounting ) {
			return;
		}
		if (
			resizeObserver &&
			( p.tile.clientWidth < MIN_MOUNT_SIZE ||
				p.tile.clientHeight < MIN_MOUNT_SIZE )
		) {
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
				try {
					teardown();
				} catch {

				}
				return;
			}
			p.mounting = false;
			p.teardown = teardown;

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

	const sizeDrifted = ( p: TilePreview ): boolean =>
		Math.abs( p.tile.clientWidth - p.mountWidth ) > REMOUNT_EPSILON ||
		Math.abs( p.tile.clientHeight - p.mountHeight ) > REMOUNT_EPSILON;

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

	const onWindowClosed = (): void => {
		if ( ! root.isConnected ) {
			dispose();
		}
	};
	document.addEventListener( 'os-window-closed', onWindowClosed );

	return { sync, dispose };
}
