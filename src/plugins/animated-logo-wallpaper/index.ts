/**
 * Animated WP Logo — wallpaper plugin entry.
 *
 * The first built-in canvas wallpaper. Dogfoods the public
 * `wp.desktop.registerWallpaper` API using only surfaces third-party
 * plugin authors also reach for — `needs: ['pixijs']` lets the shell
 * resolve the library via the module registry; the plugin itself
 * never knows or cares where `pixi.min.js` lives.
 *
 * @since 0.6.0
 */

import { addAction, HOOKS } from '../../hooks';
import type { WallpaperTeardown } from '../../wallpapers/types';
import { mountScene } from './scene';

/** Stable id — persisted to localStorage as the user's selected wallpaper. */
const WALLPAPER_ID = 'wp-animated-logo';

/** Plugin-identity namespace for hook callbacks, per WP convention. */
const NAMESPACE = 'desktop-mode/animated-logo';

/**
 * Swatch preview — rendered in OS Settings before PixiJS is loaded,
 * so it needs to be pure CSS. Uses the same midnight gradient the
 * Pixi scene uses for its backdrop, so selecting feels continuous.
 */
const PREVIEW = 'radial-gradient(circle at 50% 50%, #1e3a8a 0%, #0b0f25 100%)';

addAction(
	HOOKS.INIT,
	NAMESPACE,
	() => {
		const api = window.wp?.desktop;
		if ( ! api || typeof api.registerWallpaper !== 'function' ) {
			return;
		}

		api.registerWallpaper( {
			id: WALLPAPER_ID,
			label: 'Animated WordPress Logo',
			type: 'canvas',
			preview: PREVIEW,
			needs: [ 'pixijs' ],
			mount: async ( container, ctx ): Promise<WallpaperTeardown> => {
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

				const visibilityHandler = ( ...args: unknown[] ): void => {
					const detail = args[ 0 ] as
						| { id?: string; state?: 'visible' | 'hidden' }
						| undefined;
					if ( ! detail || detail.id !== WALLPAPER_ID ) {
						return;
					}
					scene.setAnimating( detail.state === 'visible' );
				};
				api.hooks.addAction(
					HOOKS.WALLPAPER_VISIBILITY,
					`${ NAMESPACE }/visibility`,
					visibilityHandler,
				);

				return (): void => {
					api.hooks.removeAction(
						HOOKS.WALLPAPER_VISIBILITY,
						`${ NAMESPACE }/visibility`,
					);
					scene.destroy();
				};
			},
		} );
	},
);
