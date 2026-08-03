/**
 * Animated WP Logo — wallpaper plugin entry.
 *
 * The first built-in canvas wallpaper. This plugin ships
 * as its own Vite-built bundle (`assets/js/animated-logo-wallpaper[.min].js`)
 * that is only loaded when the matching `open_station_register_wallpaper`
 * server registration tells the shell to inject the script handle —
 * i.e. only for users who have selected this wallpaper, or who open
 * OS Settings → Wallpaper and the picker pulls the def in.
 *
 * Publishing pattern: the shell's wallpaper `server-sync` reads
 * `window.openStationWallpapers[<id>]` after the script loads, so the
 * bundle's only side effect is writing that global. No reliance on
 * `wp.os.registerWallpaper` from inside the bundle — the def is
 * registered via the WordPress `open_station_register_wallpaper()`
 * server API in `includes/wallpapers.php`.
 */

import type {
	WallpaperContext,
	WallpaperDef,
	WallpaperPreviewContext,
	WallpaperTeardown,
} from '../../wallpapers/types';
import { mountScene } from './scene';

/** Stable id — persisted to localStorage as the user's selected wallpaper. */
const WALLPAPER_ID = 'wp-animated-logo';

/**
 * Swatch preview — rendered in OS Settings before PixiJS is loaded,
 * so it needs to be pure CSS. Uses the same midnight gradient the
 * Pixi scene uses for its backdrop, so selecting feels continuous.
 */
const PREVIEW = 'radial-gradient(circle at 50% 50%, #1e3a8a 0%, #0b0f25 100%)';

const def: WallpaperDef = {
	id: WALLPAPER_ID,
	label: 'Animated WordPress Logo',
	type: 'canvas',
	preview: PREVIEW,
	/**
	 * Live tile preview for the OS Settings picker — the real particle
	 * scene at tile scale. The scene sizes itself to its container, so
	 * no dedicated preview path is needed; the swatch just gets a small
	 * swarm.
	 */
	renderPreview: async (
		container: HTMLElement,
		ctx: WallpaperPreviewContext,
	): Promise< WallpaperTeardown > => {
		const scene = await mountScene( {
			container,
			logoUrl: `${ ctx.pluginUrl }/assets/images/wp-logo.png`,
			prefersReducedMotion: ctx.prefersReducedMotion,
		} );
		return (): void => scene.destroy();
	},
	needs: [ 'pixijs' ],
	mount: async (
		container: HTMLElement,
		ctx: WallpaperContext,
	): Promise< WallpaperTeardown > => {
		// `needs: ['pixijs']` guarantees `window.PIXI` is set.
		// The scene fetches the official WP wmark PNG from the
		// plugin's asset dir and rasterizes it to build the
		// particle home positions — `ctx.pluginUrl` is the
		// authoritative base URL the shell hands us.
		const logoUrl = `${ ctx.pluginUrl }/assets/images/wp-logo.png`;
		const scene = await mountScene( {
			container,
			logoUrl,
			prefersReducedMotion: ctx.prefersReducedMotion,
		} );

		// Listen to the wallpaper-visibility hook to pause/resume the
		// PIXI ticker when the wallpaper is hidden (e.g. window covers
		// the whole desktop). Reaching `wp.os.hooks` is the public
		// surface — works whether this bundle is in-shell or lazy-loaded.
		const NAMESPACE = 'desktop-mode/animated-logo';
		const HOOK = 'os.wallpaper.visibility';
		const api = window.wp?.os;
		const visibilityHandler = ( ...args: unknown[] ): void => {
			const detail = args[ 0 ] as
				| { id?: string; state?: 'visible' | 'hidden' }
				| undefined;
			if ( ! detail || detail.id !== WALLPAPER_ID ) {
				return;
			}
			scene.setAnimating( detail.state === 'visible' );
		};
		api?.hooks?.addAction(
			HOOK,
			`${ NAMESPACE }/visibility`,
			visibilityHandler,
		);

		return (): void => {
			api?.hooks?.removeAction( HOOK, `${ NAMESPACE }/visibility` );
			scene.destroy();
		};
	},
};

declare global {
	interface Window {
		openStationWallpapers?: Record< string, WallpaperDef >;
	}
}

window.openStationWallpapers = window.openStationWallpapers || {};
window.openStationWallpapers[ WALLPAPER_ID ] = def;
