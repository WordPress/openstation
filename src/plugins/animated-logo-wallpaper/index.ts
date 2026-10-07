import type {
	WallpaperContext,
	WallpaperDef,
	WallpaperPreviewContext,
	WallpaperTeardown,
} from '../../wallpapers/types';
import { mountScene } from './scene';

const WALLPAPER_ID = 'wp-animated-logo';

const PREVIEW = 'radial-gradient(circle at 50% 50%, #1e3a8a 0%, #0b0f25 100%)';

const def: WallpaperDef = {
	id: WALLPAPER_ID,
	label: 'Animated WordPress Logo',
	type: 'canvas',
	preview: PREVIEW,

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
		const logoUrl = `${ ctx.pluginUrl }/assets/images/wp-logo.png`;
		const scene = await mountScene( {
			container,
			logoUrl,
			prefersReducedMotion: ctx.prefersReducedMotion,
		} );

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
