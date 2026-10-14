/**
 * Pulse Monitor — the widget face (`desktop-mode/pulse`).
 *
 * The same monitor as the wallpaper — same engine, same signal hub,
 * same diagnosis — drawn into a widget card: a smaller trace with
 * taller beats and a slower sweep, the numbers along its bottom edge,
 * and a gear that opens the settings form. Its settings are its own,
 * kept in the widget's store, so the widget and the wallpaper can
 * look and listen differently. Wallpaper and widget can run together;
 * the hub wires the signal taps once for both.
 */

import { __ } from '../../i18n';
import '../../ui/components/os-modal/os-modal';
import '../../ui/components/os-button/os-button';
import { osIconSvg } from '../../ui/icons';
import type { WallpaperSettings } from '../../wallpapers/settings-store';
import type { WidgetContext, WidgetTeardown } from '../../widgets/types';
import { renderPulseConfig } from './config';
import { mountMonitor, type Monitor } from './monitor';
import { getPixi } from './pixi-types';
import { sanitizePulseSettings } from './settings';

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
/* Placement and reveal only; the look is <os-button variant="ghost">'s. */
.os-widget-pulse__gear {
	position: absolute;
	inset-block-start: 6px;
	inset-inline-end: 6px;
	z-index: 2;
	--os-ui-button-padding: 4px;
	opacity: 0;
	transition: opacity 120ms ease;
}
.os-widget-pulse__gear svg { display: block; }
.os-widget-pulse:hover .os-widget-pulse__gear,
.os-widget-pulse__gear:focus-within { opacity: 1; }
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

/** The widget's own settings, in its per-widget store (`ctx.storage`). */
const SETTINGS_KEY = 'settings';

/**
 * The gear's dialog: the settings form in an `<os-modal>`.
 *
 * @return Closes the dialog (a no-op once it is closed).
 */
function openSettings( current: () => WallpaperSettings, write: ( partial: WallpaperSettings ) => void ): () => void {
	const modal = document.createElement( 'os-modal' );
	modal.setAttribute( 'size', 'sm' );
	modal.setAttribute( 'title', __( 'Pulse Monitor widget settings' ) );
	const body = document.createElement( 'div' );
	body.className = 'os-widget-pulse__form';
	modal.appendChild( body );
	const done = document.createElement( 'os-button' );
	done.setAttribute( 'slot', 'footer' );
	done.setAttribute( 'variant', 'primary' );
	done.textContent = __( 'Done' );
	modal.appendChild( done );

	const teardown = renderPulseConfig( body, { settings: current(), setSettings: write, face: 'widget' } );
	let open = true;
	const close = (): void => {
		if ( ! open ) {
			return;
		}
		open = false;
		teardown();
		modal.remove();
	};
	done.addEventListener( 'click', close );
	modal.addEventListener( 'os-modal-cancel', close );
	document.body.appendChild( modal );
	modal.setAttribute( 'open', '' );
	return close;
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

	const gear = document.createElement( 'os-button' );
	gear.setAttribute( 'variant', 'ghost' );
	gear.className = 'os-widget-pulse__gear';
	// Static SVG markup from the icon set — no user content involved.
	gear.innerHTML = osIconSvg( 'settings', { size: 16 } );
	gear.setAttribute( 'aria-label', __( 'Pulse Monitor settings' ) );
	let stored: WallpaperSettings = ctx.storage.get< WallpaperSettings >( SETTINGS_KEY ) ?? {};
	let monitor: Monitor | null = null;
	const write = ( partial: WallpaperSettings ): void => {
		stored = { ...stored, ...partial };
		ctx.storage.set( SETTINGS_KEY, stored );
		monitor?.applySettings( sanitizePulseSettings( stored ) );
	};
	// The open dialog, so removing the widget can take it down too.
	let closeSettings: ( () => void ) | null = null;
	const onGear = (): void => {
		closeSettings?.();
		closeSettings = openSettings( () => stored, write );
	};
	gear.addEventListener( 'click', onGear );
	container.appendChild( gear );

	const mounted: Monitor = await mountMonitor( {
		container: screen,
		pixi,
		settings: sanitizePulseSettings( stored ),
		prefersReducedMotion: window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches ?? false,
		variant: 'widget',
	} );

	monitor = mounted;
	// Widgets get no visibility hook; follow the document like the
	// wallpaper's own suspend does.
	const onVisibility = (): void => mounted.setAnimating( document.visibilityState === 'visible' );
	document.addEventListener( 'visibilitychange', onVisibility );
	onVisibility();

	return (): void => {
		document.removeEventListener( 'visibilitychange', onVisibility );
		gear.removeEventListener( 'click', onGear );
		closeSettings?.();
		mounted.destroy();
		monitor = null;
		screen.remove();
		gear.remove();
		container.classList.remove( 'os-widget-pulse' );
	};
}
