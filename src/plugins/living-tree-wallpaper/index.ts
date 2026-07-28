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
 */

import type {
	WallpaperContext,
	WallpaperDef,
	WallpaperPreviewContext,
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

/**
 * Default preview parameters — a site in its prime, so the OS Settings
 * tile shows what the wallpaper can become rather than the sprout a
 * day-old site would render. Every key is overridable through the
 * `desktop-mode.wallpaper.preview-params` filter; non-numeric
 * overrides fall back to these values.
 */
const PREVIEW_PARAMS: Record< string, number > = {
	siteAgeDays: 540,
	totalPosts: 120,
	totalPages: 8,
	totalCategories: 6,
	totalTags: 24,
	totalComments: 260,
	activeUsers: 3,
	traffic: 420,
	seoHealth: 0.85,
	performance: 0.9,
};

/** Read a numeric param, falling back to the showcase default. */
function numParam( params: Record< string, unknown >, key: string ): number {
	const value = params[ key ];
	return typeof value === 'number' && Number.isFinite( value )
		? value
		: PREVIEW_PARAMS[ key ];
}

/**
 * Build the synthetic snapshot the preview grows from. No REST fetch —
 * the preview must work offline, instantly, and identically on every
 * site regardless of its real age. The seed (`siteUrl` + `siteName` +
 * `installEpoch`) is held constant so the preview individual is stable
 * across opens; the metrics come from params.
 */
function showcaseSnapshot(
	params: Record< string, unknown >,
): TreeSnapshot {
	return {
		siteUrl: window.location.origin,
		siteName:
			typeof params.siteName === 'string' && params.siteName !== ''
				? params.siteName
				: 'living-tree-preview',
		installEpoch: 0,
		siteAgeDays: numParam( params, 'siteAgeDays' ),
		totalPosts: numParam( params, 'totalPosts' ),
		totalPages: numParam( params, 'totalPages' ),
		totalCategories: numParam( params, 'totalCategories' ),
		totalTags: numParam( params, 'totalTags' ),
		totalComments: numParam( params, 'totalComments' ),
		activeUsers: numParam( params, 'activeUsers' ),
		traffic: numParam( params, 'traffic' ),
		seoHealth: numParam( params, 'seoHealth' ),
		performance: numParam( params, 'performance' ),
		branches: [],
	};
}

const def: WallpaperDef = {
	id: WALLPAPER_ID,
	label: 'Living Tree',
	type: 'canvas',
	preview: PREVIEW,
	previewParams: PREVIEW_PARAMS,
	/**
	 * Live tile preview for the OS Settings picker. Grows a showcase
	 * tree from {@link showcaseSnapshot} — never the real site DNA, so
	 * a brand-new site still previews the wallpaper at full glory. The
	 * reveal animation plays at normal speed (a mature tree grows in a
	 * couple of seconds), which doubles as the preview's motion.
	 */
	renderPreview: async (
		container: HTMLElement,
		ctx: WallpaperPreviewContext,
	): Promise< WallpaperTeardown > => {
		const scene = await mountScene( {
			container,
			snapshot: showcaseSnapshot( ctx.params ),
			prefersReducedMotion: ctx.prefersReducedMotion,
		} );
		return (): void => scene.destroy();
	},
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
