/**
 * The Living Tree — wallpaper plugin entry.
 *
 * A canvas wallpaper that renders the site as a living plant organism —
 * a tree whose shape is the visual fingerprint of the site's life (posts,
 * comments, tags, online users, traffic). See
 * `docs/living-tree-algorithm.md` for the full algorithm.
 *
 * Publishing pattern (same as animated-logo): the bundle's only side
 * effect is writing `window.desktopModeWallpapers['wp-living-tree']`; the
 * shell's wallpaper `server-sync` reads that global after the script
 * loads. Server registration lives in `includes/living-tree/wallpaper.php`.
 *
 * @since 0.9.4
 */

import type {
	WallpaperContext,
	WallpaperDef,
	WallpaperTeardown,
} from '../../wallpapers/types';
import { trackedFetch } from '../../tracked-fetch';
import { mountScene } from './scene';
import type { TreeSnapshot } from './types';

/** Stable id — persisted to localStorage as the user's selected wallpaper. */
const WALLPAPER_ID = 'wp-living-tree';

/**
 * Swatch preview — pure CSS, shown in OS Settings before PixiJS loads.
 * A dusk gradient matching the scene backdrop so selecting feels
 * continuous.
 */
const PREVIEW =
	'linear-gradient(180deg, #24304a 0%, #6b4a63 70%, #b5744f 100%)';

/** REST root, falling back to the default when `wpApiSettings` is absent. */
function restRoot(): string {
	const settings = ( window as unknown as {
		wpApiSettings?: { root?: string };
	} ).wpApiSettings;
	return settings?.root ?? '/wp-json/';
}

/**
 * Fetch the site DNA. Routes through the framework fetch so the request
 * feeds the activity bus; `silent` because the user didn't initiate it.
 * Returns `null` on any failure — the scene renders a sprout.
 */
async function fetchSnapshot(): Promise< TreeSnapshot | null > {
	try {
		const res = await trackedFetch(
			`${ restRoot() }desktop-mode/v1/living-tree/snapshot`,
			undefined,
			{ source: 'desktop-mode/living-tree', silent: true },
		);
		if ( ! res.ok ) {
			return null;
		}
		return ( await res.json() ) as TreeSnapshot;
	} catch {
		return null;
	}
}

const def: WallpaperDef = {
	id: WALLPAPER_ID,
	label: 'Living Tree',
	type: 'canvas',
	preview: PREVIEW,
	needs: [ 'pixijs' ],
	mount: async (
		container: HTMLElement,
		ctx: WallpaperContext,
	): Promise< WallpaperTeardown > => {
		const snapshot = await fetchSnapshot();
		const scene = await mountScene( {
			container,
			snapshot,
			prefersReducedMotion: ctx.prefersReducedMotion,
		} );

		// Pause/resume the ticker when the wallpaper is hidden (a window
		// covers the whole desktop, tab backgrounded). Same public hook
		// surface the animated-logo wallpaper uses.
		const NAMESPACE = 'desktop-mode/living-tree';
		const HOOK = 'desktop-mode.wallpaper.visibility';
		const api = window.wp?.desktop;
		const visibilityHandler = ( ...args: unknown[] ): void => {
			const detail = args[ 0 ] as
				| { id?: string; state?: 'visible' | 'hidden' }
				| undefined;
			if ( ! detail || detail.id !== WALLPAPER_ID ) {
				return;
			}
			scene.setAnimating( detail.state === 'visible' );
		};
		api?.hooks?.addAction( HOOK, `${ NAMESPACE }/visibility`, visibilityHandler );

		return (): void => {
			api?.hooks?.removeAction( HOOK, `${ NAMESPACE }/visibility` );
			scene.destroy();
		};
	},
};

declare global {
	interface Window {
		desktopModeWallpapers?: Record< string, WallpaperDef >;
	}
}

window.desktopModeWallpapers = window.desktopModeWallpapers || {};
window.desktopModeWallpapers[ WALLPAPER_ID ] = def;
