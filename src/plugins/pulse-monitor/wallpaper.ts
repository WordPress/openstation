/**
 * Pulse Monitor — the wallpaper face (`wp-pulse`).
 *
 * The whole desk as a heart monitor: {@link mountMonitor} in its
 * `wallpaper` variant, plus the shell hooks a canvas wallpaper owes
 * (visibility, live settings) and a synthetic OS Settings tile preview.
 *
 * Two layouts (`settings.layout`):
 *
 *   - `full`: the trace runs across the whole wallpaper, under the desk.
 *   - `band`: the shell reserves a strip along the top
 *     (`reserveWorkArea()`), so no window, icon or widget can be put
 *     there — maximize, snapping, dragging and resizing all stop at
 *     it. The trace and its numbers mount on a layer over that strip;
 *     with nothing able to cover it, the numbers become a button that
 *     opens the Issues window. The rest of the wallpaper is the plain
 *     background colour. Never on a phone: in the shell's mobile mode
 *     apps are full-screen, so the band falls back to `full` and comes
 *     back when the mode does.
 */

import { __ } from '../../i18n';
import { addAction, removeAction, HOOKS } from '../../hooks';
import { reservedRectOf, reserveWorkArea, subscribeWorkArea } from '../../work-area';
import type {
	WallpaperContext,
	WallpaperDef,
	WallpaperPreviewContext,
	WallpaperTeardown,
} from '../../wallpapers/types';
import { renderPulseConfig } from './config';
import { mountMonitor, type Monitor } from './monitor';
import { getPixi } from './pixi-types';
import { Rhythm } from './rhythm';
import { mountPulseScene } from './scene';
import { PULSE_DEFAULTS, sanitizePulseSettings, type PulseSettings } from './settings';

/** Stable id — persisted as the user's selected wallpaper, and the key of its settings bag. */
export const WALLPAPER_ID = 'wp-pulse';

const NAMESPACE = 'desktop-mode/pulse';

/** Work-area reservation id for the band layout. */
export const BAND_RESERVATION = 'desktop-mode/pulse';

const STYLE_ID = 'os-pulse-band-style';

function ensureStyle(): void {
	if ( document.getElementById( STYLE_ID ) ) {
		return;
	}
	const style = document.createElement( 'style' );
	style.id = STYLE_ID;
	style.textContent = `
/* Full layout: the monitor fills the wallpaper layer. */
.os-pulse-stage { position: absolute; inset: 0; }
/* The reserved band's layer: above the desk area and anything stacked in
   it (nothing may be placed in the band, so it covers nothing), under
   Mío and the docks; a fullscreen window still covers it. Click-through
   except for the numbers. */
.os-pulse-band {
	position: absolute;
	z-index: calc( var( --os-z-mio, 190 ) - 10 );
	overflow: hidden;
	pointer-events: none;
	box-shadow: inset 0 -1px 0 rgb(255 255 255 / 0.08);
}
`;
	document.head.appendChild( style );
}

const noop = (): void => {
	/* noop */
};

async function mountWallpaper( container: HTMLElement, ctx: WallpaperContext ): Promise< WallpaperTeardown > {
	const pixi = getPixi();
	if ( ! pixi ) {
		return noop;
	}
	ensureStyle();
	const shell = container.closest< HTMLElement >( '#os-shell' );
	const priorBackground = container.style.background;
	let settings: PulseSettings = sanitizePulseSettings( ctx.settings );
	let monitor: Monitor | null = null;
	let stage: HTMLElement | null = null;
	let releaseBand = noop;
	let offWorkArea = noop;
	let animating = true;
	let generation = 0;
	let destroyed = false;

	// Phones: apps open full-screen, so a reserved strip only takes room
	// from them.
	const mobile = (): boolean => {
		const mode = ( window.wp as unknown as { os?: { mode?: { isMobile?: () => boolean } } } | undefined )?.os?.mode;
		return mode?.isMobile?.() ?? document.documentElement.dataset.osMode === 'mobile';
	};
	const banded = (): boolean => settings.layout === 'band' && shell !== null && ! mobile();
	let builtBanded = false;

	const placeBand = (): void => {
		const rect = reservedRectOf( BAND_RESERVATION );
		if ( ! stage || ! shell || ! rect ) {
			return;
		}
		const origin = shell.getBoundingClientRect();
		stage.style.left = `${ rect.x - origin.left }px`;
		stage.style.top = `${ rect.y - origin.top }px`;
		stage.style.width = `${ rect.width }px`;
		stage.style.height = `${ rect.height }px`;
	};

	const teardownStage = (): void => {
		monitor?.destroy();
		monitor = null;
		offWorkArea();
		offWorkArea = noop;
		releaseBand();
		releaseBand = noop;
		stage?.remove();
		stage = null;
		container.style.background = priorBackground;
	};

	const build = async (): Promise< void > => {
		teardownStage();
		const mine = ++generation;
		const band = banded();
		builtBanded = band;
		const host = document.createElement( 'div' );
		stage = host;
		if ( band && shell ) {
			host.className = 'os-pulse-band';
			// Below the band the wallpaper is plain background.
			container.style.background = settings.background;
			releaseBand = reserveWorkArea( BAND_RESERVATION, { edge: 'top', size: settings.bandHeight } );
			shell.appendChild( host );
			placeBand();
			offWorkArea = subscribeWorkArea( placeBand );
		} else {
			host.className = 'os-pulse-stage';
			container.appendChild( host );
		}
		const next = await mountMonitor( {
			container: host,
			pixi,
			settings,
			prefersReducedMotion: ctx.prefersReducedMotion,
			variant: band ? 'band' : 'wallpaper',
		} );
		// A layout switch (or the unmount) raced the mount.
		if ( destroyed || mine !== generation ) {
			next.destroy();
			return;
		}
		monitor = next;
		monitor.setAnimating( animating );
	};

	await build();

	// Pause while the document is hidden or the shell suspends us.
	addAction( HOOKS.WALLPAPER_VISIBILITY, `${ NAMESPACE }/visibility`, ( ...args: unknown[] ) => {
		const detail = args[ 0 ] as { id?: string; state?: 'visible' | 'hidden' } | undefined;
		if ( detail?.id === WALLPAPER_ID ) {
			animating = detail.state === 'visible';
			monitor?.setAnimating( animating );
		}
	} );
	// Entering or leaving mobile mode switches the band off or on.
	addAction( HOOKS.MODE_CHANGED, `${ NAMESPACE }/mode`, () => {
		if ( banded() !== builtBanded ) {
			void build();
		}
	} );
	addAction( HOOKS.WALLPAPER_SETTINGS_CHANGED, `${ NAMESPACE }/settings-changed`, ( ...args: unknown[] ) => {
		const detail = args[ 0 ] as { id?: string; settings?: Record< string, unknown > } | undefined;
		if ( detail?.id !== WALLPAPER_ID ) {
			return;
		}
		const previous = settings;
		settings = sanitizePulseSettings( detail.settings );
		if ( settings.layout !== previous.layout || banded() !== builtBanded ) {
			void build();
			return;
		}
		if ( banded() ) {
			if ( settings.bandHeight !== previous.bandHeight ) {
				// Same id: the band is resized in place.
				releaseBand = reserveWorkArea( BAND_RESERVATION, { edge: 'top', size: settings.bandHeight } );
				placeBand();
			}
			container.style.background = settings.background;
		}
		monitor?.applySettings( settings );
	} );

	return (): void => {
		destroyed = true;
		removeAction( HOOKS.WALLPAPER_VISIBILITY, `${ NAMESPACE }/visibility` );
		removeAction( HOOKS.MODE_CHANGED, `${ NAMESPACE }/mode` );
		removeAction( HOOKS.WALLPAPER_SETTINGS_CHANGED, `${ NAMESPACE }/settings-changed` );
		teardownStage();
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
