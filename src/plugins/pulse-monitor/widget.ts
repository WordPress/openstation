/**
 * Pulse Monitor — the widget face (`desktop-mode/pulse`).
 *
 * The same monitor as the wallpaper — same engine, same signal hub,
 * same diagnosis, same settings bag — drawn into a widget card: a
 * smaller trace with taller beats and a slower sweep, the numbers
 * along its bottom edge, and a gear that opens the shared settings
 * form. Wallpaper and widget can run together; the hub wires the
 * signal taps once for both.
 */

import { __ } from '../../i18n';
import { addAction, removeAction, HOOKS } from '../../hooks';
import '../../ui/components/os-modal/os-modal';
import '../../ui/components/os-button/os-button';
import { osIconSvg } from '../../ui/icons';
import {
	getWallpaperSettings,
	publishWallpaperSettings,
	type WallpaperSettings,
} from '../../wallpapers/settings-store';
import type { WidgetContext, WidgetTeardown } from '../../widgets/types';
import { renderPulseConfig } from './config';
import { mountMonitor, type Monitor } from './monitor';
import { getPixi } from './pixi-types';
import { sanitizePulseSettings } from './settings';
import { WALLPAPER_ID } from './wallpaper';

export const WIDGET_ID = 'desktop-mode/pulse';

const STYLE_ID = 'os-pulse-widget-style';

function ensureStyle(): void {
	if ( document.getElementById( STYLE_ID ) ) {
		return;
	}
	const style = document.createElement( 'style' );
	style.id = STYLE_ID;
	style.textContent = `
.os-widget-pulse { position: relative; height: 100%; min-height: 120px; }
.os-widget-pulse__screen {
	position: absolute;
	inset: 0;
	overflow: hidden;
	border-radius: 10px;
}
.os-widget-pulse__gear {
	position: absolute;
	inset-block-start: 6px;
	inset-inline-end: 6px;
	z-index: 2;
	inline-size: 24px;
	block-size: 24px;
	padding: 0;
	border: 0;
	border-radius: 6px;
	background: rgb(255 255 255 / 0.08);
	color: rgb(255 255 255 / 0.7);
	cursor: pointer;
	display: grid;
	place-items: center;
	opacity: 0;
	transition: opacity 120ms ease;
}
.os-widget-pulse:hover .os-widget-pulse__gear,
.os-widget-pulse__gear:focus-visible { opacity: 1; }
.os-widget-pulse__form { display: flex; flex-direction: column; gap: 12px; }
@media (prefers-reduced-motion: reduce) {
	.os-widget-pulse__gear { transition: none; }
}
`;
	document.head.appendChild( style );
}

/** Load PixiJS through the shell's module registry (widgets have no `needs`). */
async function loadPixi(): Promise< void > {
	const load = ( window.wp as unknown as { os?: { loadModules?: ( ids: string[] ) => Promise< void > } } | undefined )?.os
		?.loadModules;
	if ( typeof load !== 'function' ) {
		throw new Error( 'wp.os.loadModules is not available.' );
	}
	await load( [ 'pixijs' ] );
}

/**
 * Write a partial into the shared `wp-pulse` settings bag — the same
 * path the OS Settings dialog takes: persist through the OS Settings
 * store, then publish so every mounted monitor live-applies.
 */
function writeSettings( partial: WallpaperSettings ): void {
	const merged: WallpaperSettings = { ...getWallpaperSettings( WALLPAPER_ID ), ...partial };
	const api = ( window.wp as unknown as {
		os?: {
			getOsSettings?: () => { wallpaperSettings?: Record< string, WallpaperSettings > };
			updateOsSettings?: ( patch: Record< string, unknown > ) => void;
		};
	} | undefined )?.os;
	const all = api?.getOsSettings?.().wallpaperSettings ?? {};
	api?.updateOsSettings?.( { wallpaperSettings: { ...all, [ WALLPAPER_ID ]: merged } } );
	publishWallpaperSettings( WALLPAPER_ID, merged );
}

/** The gear's dialog: the shared settings form in an `<os-modal>`. */
function openSettings(): void {
	const modal = document.createElement( 'os-modal' );
	modal.setAttribute( 'size', 'sm' );
	modal.setAttribute( 'title', __( 'Pulse Monitor settings' ) );
	const body = document.createElement( 'div' );
	body.className = 'os-widget-pulse__form';
	modal.appendChild( body );
	const done = document.createElement( 'os-button' );
	done.setAttribute( 'slot', 'footer' );
	done.setAttribute( 'variant', 'primary' );
	done.textContent = __( 'Done' );
	modal.appendChild( done );

	const teardown = renderPulseConfig( body, {
		settings: getWallpaperSettings( WALLPAPER_ID ),
		setSettings: writeSettings,
	} );
	const close = (): void => {
		teardown();
		modal.remove();
	};
	done.addEventListener( 'click', close );
	modal.addEventListener( 'os-modal-cancel', close );
	document.body.appendChild( modal );
	modal.setAttribute( 'open', '' );
}

export async function mountWidget( container: HTMLElement, ctx: WidgetContext ): Promise< WidgetTeardown > {
	ensureStyle();
	container.classList.add( 'os-widget-pulse' );
	try {
		await loadPixi();
	} catch ( err ) {
		container.textContent = ( err as Error ).message;
		return (): void => undefined;
	}
	const pixi = getPixi();
	if ( ! pixi ) {
		return (): void => undefined;
	}

	const screen = document.createElement( 'div' );
	screen.className = 'os-widget-pulse__screen';
	container.appendChild( screen );

	const gear = document.createElement( 'button' );
	gear.type = 'button';
	gear.className = 'os-widget-pulse__gear';
	// Static SVG markup from the icon set — no user content involved.
	gear.innerHTML = osIconSvg( 'settings', { size: 16 } );
	gear.setAttribute( 'aria-label', __( 'Pulse Monitor settings' ) );
	gear.addEventListener( 'click', openSettings );
	container.appendChild( gear );

	const monitor: Monitor = await mountMonitor( {
		container: screen,
		pixi,
		settings: sanitizePulseSettings( getWallpaperSettings( WALLPAPER_ID ) ),
		prefersReducedMotion: window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches ?? false,
		variant: 'widget',
	} );

	const ns = `${ ctx.id }/pulse-settings`;
	addAction( HOOKS.WALLPAPER_SETTINGS_CHANGED, ns, ( ...args: unknown[] ) => {
		const detail = args[ 0 ] as { id?: string; settings?: Record< string, unknown > } | undefined;
		if ( detail?.id === WALLPAPER_ID ) {
			monitor.applySettings( sanitizePulseSettings( detail.settings ) );
		}
	} );
	// Widgets get no visibility hook; follow the document like the
	// wallpaper's own suspend does.
	const onVisibility = (): void => monitor.setAnimating( document.visibilityState === 'visible' );
	document.addEventListener( 'visibilitychange', onVisibility );
	onVisibility();

	return (): void => {
		removeAction( HOOKS.WALLPAPER_SETTINGS_CHANGED, ns );
		document.removeEventListener( 'visibilitychange', onVisibility );
		gear.removeEventListener( 'click', openSettings );
		monitor.destroy();
		screen.remove();
		gear.remove();
		container.classList.remove( 'os-widget-pulse' );
	};
}
