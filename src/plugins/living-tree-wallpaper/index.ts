import type {
	WallpaperContext,
	WallpaperDef,
	WallpaperPreviewContext,
	WallpaperTeardown,
} from '../../wallpapers/types';
import { trackedFetch } from '../../tracked-fetch';
import { mountScene } from './scene';
import type { TreeSnapshot } from './types';

const WALLPAPER_ID = 'wp-living-tree';

const PREVIEW =
	'linear-gradient(180deg, #24304a 0%, #6b4a63 70%, #b5744f 100%)';

function restRoot(): string {
	const settings = ( window as unknown as {
		wpApiSettings?: { root?: string };
	} ).wpApiSettings;
	return settings?.root ?? '/wp-json/';
}

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

function numParam( params: Record< string, unknown >, key: string ): number {
	const value = params[ key ];
	return typeof value === 'number' && Number.isFinite( value )
		? value
		: PREVIEW_PARAMS[ key ];
}

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

		const NAMESPACE = 'desktop-mode/living-tree';
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
		api?.hooks?.addAction( HOOK, `${ NAMESPACE }/visibility`, visibilityHandler );

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
