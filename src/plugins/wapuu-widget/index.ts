/**
 * Desktop Mode — Wapuu widget (lazy bundle).
 *
 * A pocket Wapuu that lives on the desktop: he breathes, blinks,
 * follows the cursor with his eyes, twitches his ears, wags his tail,
 * and dozes off when left alone. Click him for a pet (hearts!). Built
 * on PixiJS v8 from the original-art rig.
 *
 * Ships as its own Vite target (`widget-wapuu`) — both the JS and the
 * widget's CSS leave the main `desktop.min.js` bundle. PHP registers
 * the widget via `desktop_mode_register_widget()` with the script
 * handle `desktop-mode-wapuu-widget`; the shell's widgets `server-sync`
 * loads this bundle the first time the picker renders or the widget
 * mounts. The bundle's only side effect is publishing a mount callback
 * on `window.desktopModeWidgets[ 'desktop-mode/wapuu' ]`.
 *
 * @since 0.19.0
 */

// Side-effect CSS import — Vite emits a separate `widget-wapuu[.min].css`
// chunk next to the JS. PHP eagerly enqueues that stylesheet on shell
// pages so the card chrome paints before the (lazy) JS runs.
import './styles.css';

import type { Application } from 'pixi.js';
import { __ } from '../../i18n';
import { buildWapuu } from './rig';
import { startWapuuPet } from './pet';
import type { PetController } from './pet';
import type { WidgetContext, WidgetTeardown } from '../../widgets/types';

/** Widget id — must match the PHP `desktop_mode_register_widget()` id. */
const WIDGET_ID = 'desktop-mode/wapuu';

declare global {
	interface Window {
		PIXI?: typeof import( 'pixi.js' );
	}
}

/**
 * Bridge to the main bundle's lazy module loader. Each IIFE bundle has
 * its OWN copy of `src/modules/registry.ts` — the `pixijs` module is
 * registered in the main bundle's copy (see `desktop.ts`), not ours.
 * We reach the public `wp.desktop.loadModules()` API that lives on the
 * main bundle. Mirrors the heartbeat widget's `loadPixi`.
 */
async function loadPixi(): Promise< void > {
	const wp = (
		window as unknown as {
			wp?: { desktop?: { loadModules?: ( ids: string[] ) => Promise< void > } };
		}
	).wp;
	const fn = wp?.desktop?.loadModules;
	if ( typeof fn !== 'function' ) {
		throw new Error(
			'wp.desktop.loadModules is not available — main shell may not have booted yet.',
		);
	}
	await fn( [ 'pixijs' ] );
}

function renderFallback( container: HTMLElement, message: string ): void {
	container.classList.add( 'desktop-mode-widget-wapuu' );
	container.classList.add( 'desktop-mode-widget-wapuu--fallback' );
	const wrap = document.createElement( 'div' );
	wrap.className = 'desktop-mode-widget-wapuu__fallback';
	wrap.textContent = message || __( 'Wapuu could not wake up.' );
	container.appendChild( wrap );
}

/**
 * Mount callback. The framework's widget `server-sync` reads this from
 * `window.desktopModeWidgets` after the bundle loads and pairs it with
 * the server-supplied metadata from `desktop_mode_register_widget()`.
 * Sizing constraints live on the PHP side.
 */
const mount = async (
	container: HTMLElement,
	_ctx: WidgetContext,
): Promise< WidgetTeardown > => {
	try {
		await loadPixi();
	} catch ( e ) {
		renderFallback( container, ( e as Error ).message );
		return () => undefined;
	}
	return mountWithPixi( container );
};

async function mountWithPixi(
	container: HTMLElement,
): Promise< WidgetTeardown > {
	const pixi = window.PIXI;
	if ( ! pixi ) {
		renderFallback( container, 'PIXI not available.' );
		return () => undefined;
	}

	container.classList.add( 'desktop-mode-widget-wapuu' );
	// Strip the card frame down to nothing — "just the pet". The class
	// lives on the card wrapper, not the body, so the stylesheet can
	// drop the glass background / border / shadow for this widget only.
	const card = container.closest< HTMLElement >( '.desktop-mode-widgets__card' );
	card?.classList.add( 'desktop-mode-widgets__card--wapuu' );
	// The card's height is owned by CSS now: a `min-height` floor on the
	// docked card keeps it from collapsing (its only flow content is an
	// absolutely-positioned stage), and it survives the framework's
	// `redock()` clearing inline geometry. Floating uses the registered
	// default size.

	const stage = document.createElement( 'div' );
	stage.className = 'desktop-mode-widget-wapuu__stage';
	container.appendChild( stage );

	const app: Application = new pixi.Application();
	await app.init( {
		resizeTo: stage,
		backgroundAlpha: 0,
		antialias: true,
		autoDensity: true,
		resolution: Math.min( window.devicePixelRatio || 1, 2 ),
	} );
	stage.appendChild( app.canvas );

	let controller: PetController | null = null;
	try {
		const { root, parts } = await buildWapuu( pixi );
		controller = startWapuuPet( { app, parts, root, pixi, stage, card } );
	} catch ( e ) {
		// Rig build failed (rare — denied 2D context, bad raster). Park
		// the half-built app's render loop, detach it, undo the
		// frame-stripping classes so the fallback reads on a normal
		// card, then show the message.
		stopAndDetach( app );
		stage.remove();
		container.classList.remove( 'desktop-mode-widget-wapuu' );
		card?.classList.remove( 'desktop-mode-widgets__card--wapuu' );
		renderFallback( container, ( e as Error ).message );
		return () => {
			container.classList.remove( 'desktop-mode-widget-wapuu' );
			container.classList.remove( 'desktop-mode-widget-wapuu--fallback' );
			card?.classList.remove( 'desktop-mode-widgets__card--wapuu' );
		};
	}

	// Pointer wiring. The framework already attaches the whole-widget
	// drag to the chrome; for Wapuu the stylesheet stretches that chrome
	// over the ENTIRE card (a transparent overlay above the canvas), so
	// dragging anywhere on Wapuu moves the widget. A drag past the
	// framework's threshold moves the card; a press that doesn't move is
	// a pet — so the two never fight.
	const chrome =
		card?.querySelector< HTMLElement >( '.desktop-mode-widgets__chrome' ) ?? null;
	const TAP_SLOP = 5;
	let downX = 0;
	let downY = 0;
	const onChromeDown = ( e: PointerEvent ): void => {
		downX = e.clientX;
		downY = e.clientY;
	};
	const onChromeUp = ( e: PointerEvent ): void => {
		const target = e.target as HTMLElement | null;
		// Buttons (close / re-dock) are their own controls — never a pet.
		if (
			target?.closest(
				'.desktop-mode-widgets__card-close, .desktop-mode-widgets__card-redock',
			)
		) {
			return;
		}
		const moved =
			Math.hypot( e.clientX - downX, e.clientY - downY ) > TAP_SLOP;
		if ( ! moved ) {
			controller?.pet();
		}
	};
	if ( chrome ) {
		chrome.addEventListener( 'pointerdown', onChromeDown );
		chrome.addEventListener( 'pointerup', onChromeUp );
	}

	// Eye-look tracks the cursor ANYWHERE on screen (like the original
	// full-screen pet), so we listen on the document, not just over the
	// card. `setPointer` also wakes Wapuu, so he only dozes off once the
	// mouse goes still — "leave him be" — not the instant it leaves the
	// widget.
	const onDocPointerMove = ( e: PointerEvent ): void =>
		controller?.setPointer( e.clientX, e.clientY );
	document.addEventListener( 'pointermove', onDocPointerMove, { passive: true } );

	return () => {
		document.removeEventListener( 'pointermove', onDocPointerMove );
		if ( chrome ) {
			chrome.removeEventListener( 'pointerdown', onChromeDown );
			chrome.removeEventListener( 'pointerup', onChromeUp );
		}
		controller?.destroy();
		stopAndDetach( app );
		container.classList.remove( 'desktop-mode-widget-wapuu' );
		card?.classList.remove( 'desktop-mode-widgets__card--wapuu' );
	};
}

/**
 * Park a PixiJS Application and detach its canvas WITHOUT calling
 * `app.destroy()`. We avoid `destroy()` because it triggers a known
 * Pixi v8 multi-Application batcher race that corrupts any other live
 * app on the page (Content Graph, the heartbeat widget, …). But the
 * Application's auto-started render ticker keeps re-rendering the
 * detached scene every frame unless we stop it first — so we
 * `ticker.stop()` (parking the render loop), then remove the canvas
 * and let GC reclaim once references drop. Matches the teardown in
 * `posts-window/categories-mindmap.ts` and `tags-cloud.ts`.
 */
function stopAndDetach( app: Application ): void {
	try {
		app.ticker?.stop();
	} catch {
		// Best-effort.
	}
	try {
		( app as unknown as { canvas?: { remove(): void } } ).canvas?.remove();
	} catch {
		// Best-effort.
	}
}

// Side-effect: publish on the framework's well-known global so
// `widgets/server-sync.ts` pairs us with the PHP-side def.
const w = window as unknown as {
	desktopModeWidgets?: Record<
		string,
		(
			container: HTMLElement,
			ctx: WidgetContext,
		) => WidgetTeardown | Promise< WidgetTeardown >
	>;
};
w.desktopModeWidgets = w.desktopModeWidgets || {};
w.desktopModeWidgets[ WIDGET_ID ] = mount;
