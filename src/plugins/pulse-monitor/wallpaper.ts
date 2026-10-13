/**
 * Pulse Monitor — the wallpaper face (`wp-pulse`).
 *
 * The whole desk as a heart monitor: {@link mountMonitor} in its
 * `wallpaper` variant, plus the shell hooks a canvas wallpaper owes
 * (visibility, live settings) and a synthetic OS Settings tile preview.
 */

import { __ } from '../../i18n';
import { addAction, removeAction, HOOKS } from '../../hooks';
import type {
	WallpaperContext,
	WallpaperDef,
	WallpaperPreviewContext,
	WallpaperTeardown,
} from '../../wallpapers/types';
import { renderPulseConfig } from './config';
import { mountMonitor } from './monitor';
import { getPixi } from './pixi-types';
import { Rhythm } from './rhythm';
import { mountPulseScene } from './scene';
import { PULSE_DEFAULTS, sanitizePulseSettings } from './settings';

/** Stable id — persisted as the user's selected wallpaper, and the key of the shared settings bag. */
export const WALLPAPER_ID = 'wp-pulse';

const NAMESPACE = 'desktop-mode/pulse';

const noop = (): void => {
	/* noop */
};

async function mountWallpaper( container: HTMLElement, ctx: WallpaperContext ): Promise< WallpaperTeardown > {
	const pixi = getPixi();
	if ( ! pixi ) {
		return noop;
	}
	const monitor = await mountMonitor( {
		container,
		pixi,
		settings: sanitizePulseSettings( ctx.settings ),
		prefersReducedMotion: ctx.prefersReducedMotion,
		variant: 'wallpaper',
	} );

	// Pause while the document is hidden or the shell suspends us.
	addAction( HOOKS.WALLPAPER_VISIBILITY, `${ NAMESPACE }/visibility`, ( ...args: unknown[] ) => {
		const detail = args[ 0 ] as { id?: string; state?: 'visible' | 'hidden' } | undefined;
		if ( detail?.id === WALLPAPER_ID ) {
			monitor.setAnimating( detail.state === 'visible' );
		}
	} );
	addAction( HOOKS.WALLPAPER_SETTINGS_CHANGED, `${ NAMESPACE }/settings-changed`, ( ...args: unknown[] ) => {
		const detail = args[ 0 ] as { id?: string; settings?: Record< string, unknown > } | undefined;
		if ( detail?.id === WALLPAPER_ID ) {
			monitor.applySettings( sanitizePulseSettings( detail.settings ) );
		}
	} );

	return (): void => {
		removeAction( HOOKS.WALLPAPER_VISIBILITY, `${ NAMESPACE }/visibility` );
		removeAction( HOOKS.WALLPAPER_SETTINGS_CHANGED, `${ NAMESPACE }/settings-changed` );
		monitor.destroy();
	};
}

/**
 * Tile preview: the real scene, fed by a synthetic site — a resting
 * rhythm plus a scatter of requests, visitors and clicks — because a
 * swatch should not tap the shell's real traffic.
 */
async function mountPreview( container: HTMLElement, ctx: WallpaperPreviewContext ): Promise< WallpaperTeardown > {
	const pixi = getPixi();
	if ( ! pixi ) {
		return noop;
	}
	const settings = { ...sanitizePulseSettings( ctx.settings ), echoes: 3, speed: 90, lineWidth: 1.5 };
	const rhythm = new Rhythm( { restingBpm: 72 } );
	const scene = await mountPulseScene( {
		container,
		pixi,
		settings,
		prefersReducedMotion: ctx.prefersReducedMotion,
		rhythm,
		variant: 'preview',
	} );
	const sources = [ 'requests', 'visitors', 'input', 'assets', 'heartbeat' ];
	const timer = window.setInterval( () => {
		if ( Math.random() < 0.5 ) {
			rhythm.push( { source: sources[ Math.floor( Math.random() * sources.length ) ] } );
		}
	}, 700 );
	return (): void => {
		window.clearInterval( timer );
		scene.destroy();
	};
}

export const wallpaperDef: WallpaperDef = {
	id: WALLPAPER_ID,
	label: __( 'Pulse Monitor' ),
	type: 'canvas',
	preview: PULSE_DEFAULTS.background,
	needs: [ 'pixijs' ],
	renderPreview: mountPreview,
	mount: mountWallpaper,
	renderConfig: renderPulseConfig,
};
