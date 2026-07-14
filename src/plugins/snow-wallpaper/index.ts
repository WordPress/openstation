/**
 * Snow — wallpaper plugin entry.
 *
 * A PixiJS canvas wallpaper: snowflakes fall, accumulate on the top
 * edge of every visible window (and widget card, taskbar, and the
 * shell floor), then melt away. The simulation lives in `scene.ts`;
 * this file owns the wallpaper def, the shell hook wiring, the OS
 * Settings tile preview, and the settings dialog (`renderConfig`).
 *
 * Publishing pattern (same as animated-logo / living-tree): the
 * bundle's only side effect is writing
 * `window.desktopModeWallpapers['wp-snow']`; the shell's wallpaper
 * `server-sync` reads that global after the script loads. Server
 * registration lives in `includes/wallpapers.php`.
 *
 * First built-in consumer of the per-wallpaper settings surface: the
 * "Wallpaper settings" dialog edits wind, particle count, flake size,
 * and backdrop colour; a mounted instance live-applies them through
 * the `desktop-mode.wallpaper.settings-changed` action.
 *
 * @since 0.9.5
 */

import { __ } from '../../i18n';
import { addAction, removeAction, HOOKS } from '../../hooks';
// Register the tags the config dialog creates — `defineComponent` is
// idempotent, so double-registration with the OS Settings panel
// bundle (which ships the same components) is safe.
import '../../ui/components/wpd-range-field/wpd-range-field';
import '../../ui/components/wpd-color-field/wpd-color-field';
import '../../ui/components/wpd-button/wpd-button';
import type { WallpaperSurface } from '../../wallpapers/surfaces';
import type {
	WallpaperConfigContext,
	WallpaperContext,
	WallpaperDef,
	WallpaperPreviewContext,
	WallpaperTeardown,
} from '../../wallpapers/types';
import { getPixi } from './pixi-types';
import { mountSnowScene, type SnowScene } from './scene';
import {
	sanitizeSnowSettings,
	SNOW_DEFAULTS,
	SNOW_LIMITS,
	backdropCss,
	type SnowSettings,
} from './settings';

/** Stable id — persisted to localStorage as the user's selected wallpaper. */
const WALLPAPER_ID = 'wp-snow';

/** Hook-namespace prefix for every listener this wallpaper registers. */
const NAMESPACE = 'desktop-mode/snow';

/**
 * Swatch preview — pure CSS, shown in OS Settings before PixiJS
 * loads. The same midnight-to-dusk gradient the scene paints behind
 * the transparent canvas (at default settings), so selecting feels
 * continuous.
 */
const PREVIEW = backdropCss( SNOW_DEFAULTS.background );

/**
 * Tile-preview particle count. The full field would read as a
 * blizzard at swatch scale — a few dozen flakes over the same
 * backdrop communicates the wallpaper honestly and keeps the tile's
 * frame cost negligible. Overridable through `previewParams` /
 * the `desktop-mode.wallpaper.preview-params` filter.
 */
const PREVIEW_PARTICLES = 140;

/** Read `wp.desktop.getWallpaperSurfaces` off the public API. */
function surfacesSupplier(): ( () => WallpaperSurface[] ) | null {
	const api = window.wp?.desktop as
		| { getWallpaperSurfaces?: () => WallpaperSurface[] }
		| undefined;
	if ( ! api || typeof api.getWallpaperSurfaces !== 'function' ) {
		return null;
	}
	return () => ( api.getWallpaperSurfaces as () => WallpaperSurface[] )();
}

/**
 * Wire the shell hooks a mounted scene needs and return the matching
 * un-wire function. Kept out of `scene.ts` so the simulation stays a
 * pure function of its inputs.
 */
function wireSceneHooks( scene: SnowScene ): () => void {
	// Pause when the document is hidden or the user switched
	// wallpapers (the shell still has us mounted briefly).
	const visibilityHandler = ( ...args: unknown[] ): void => {
		const detail = args[ 0 ] as
			| { id?: string; state?: 'visible' | 'hidden' }
			| undefined;
		if ( ! detail || detail.id !== WALLPAPER_ID ) {
			return;
		}
		scene.setAnimating( detail.state === 'visible' );
	};
	addAction(
		HOOKS.WALLPAPER_VISIBILITY,
		`${ NAMESPACE }/visibility`,
		visibilityHandler,
	);

	// WINDOW_CLOSING fires *before* the shell detaches the window
	// element, and hands us the live DOM node — so stuck flakes match
	// by identity instead of reverse-engineering the id → selector
	// mapping. Every matching flake detaches back into the falling
	// state: the surface under it is physically disappearing, so the
	// realistic behavior is gravity — not melting in place. Flakes
	// then continue through the normal collision path and may land on
	// whatever window (or the shell floor) sits beneath.
	const detachHandler = ( ...args: unknown[] ): void => {
		const detail = args[ 0 ] as { element?: HTMLElement } | undefined;
		if ( ! detail || ! detail.element ) {
			return;
		}
		scene.detachFlakesAnchoredTo( detail.element );
	};
	addAction(
		HOOKS.WINDOW_CLOSING,
		`${ NAMESPACE }/window-closing`,
		detachHandler,
	);

	// WINDOW_MINIMIZED — the shell hides the window via opacity 0 +
	// transform, NOT display: none, so `offsetParent` stays non-null
	// and the per-frame "start melt if anchor is hidden" heuristic
	// never trips. Without an explicit listener, stuck flakes track
	// the minimize transform off-screen and hang in mid-air for the
	// full stuck lifetime before melting on their natural schedule —
	// visually "snow floating."
	//
	// Detach to FALLING — not melt — because from the user's
	// perspective the window has vanished. Melting in place would
	// freeze flakes at the (now invisible) minimize-transformed
	// coordinates. Falling lets snowfall continue past where the
	// window used to be, naturally re-colliding against whatever
	// surface sits beneath. `detachFlakesAnchoredTo` also flips the
	// surface cache dirty so NEW flakes falling toward the
	// disappeared window's y-coordinate pass through to the next
	// surface beneath instead of landing on nothing.
	addAction(
		HOOKS.WINDOW_MINIMIZED,
		`${ NAMESPACE }/window-minimized`,
		detachHandler,
	);

	// WINDOW_BOUNDS_CHANGED is rAF-coalesced by the shell and fires
	// on drag, resize, snap — anything pointer-driven that moves a
	// window edge. Flipping the dirty bit here short-circuits the
	// scene's 20Hz refresh cadence so the next tick rebuilds the
	// surface cache against the current rects; stuck flakes following
	// the anchor still read DOM rects directly, but *new* collisions
	// get a fresh edge list within one frame.
	const dirtyHandler = (): void => {
		scene.markSurfacesDirty();
	};
	addAction(
		HOOKS.WINDOW_BOUNDS_CHANGED,
		`${ NAMESPACE }/bounds-changed`,
		dirtyHandler,
	);

	// Geometry changes that don't ride WINDOW_BOUNDS_CHANGED — it is
	// pointer-driven, so programmatic state transitions (restore,
	// maximize, unmaximize, fullscreen enter/exit) change a window's
	// solid-surface rect without signaling the cache. Without these,
	// the cache stays stale for up to the 50ms timed refresh, and
	// flakes spawned during that window collide against the OLD edge
	// (e.g. the pre-maximize floating rect).
	addAction(
		HOOKS.WINDOW_RESTORED,
		`${ NAMESPACE }/window-restored`,
		dirtyHandler,
	);
	addAction(
		HOOKS.WINDOW_MAXIMIZED,
		`${ NAMESPACE }/window-maximized`,
		dirtyHandler,
	);
	addAction(
		HOOKS.WINDOW_UNMAXIMIZED,
		`${ NAMESPACE }/window-unmaximized`,
		dirtyHandler,
	);
	addAction(
		HOOKS.WINDOW_FULLSCREEN_ENTERED,
		`${ NAMESPACE }/window-fullscreen-entered`,
		dirtyHandler,
	);
	addAction(
		HOOKS.WINDOW_FULLSCREEN_EXITED,
		`${ NAMESPACE }/window-fullscreen-exited`,
		dirtyHandler,
	);

	// WIDGET_UNMOUNTING fires *before* the widget layer runs the
	// widget's teardown, so the card element is still in the DOM and
	// reachable via `[data-widget-id="…"]` — every stuck flake on it
	// drops into the falling state. Same reasoning as WINDOW_CLOSING.
	// The payload is `{ id }` only (no element), so we query by
	// attribute; if the widget was never actually rendered (fast
	// add/remove) the selector misses and nothing happens — safe
	// no-op.
	const widgetUnmountingHandler = ( ...args: unknown[] ): void => {
		const detail = args[ 0 ] as { id?: string } | undefined;
		if ( ! detail || ! detail.id ) {
			return;
		}
		const safeId =
			window.CSS && typeof CSS.escape === 'function'
				? CSS.escape( detail.id )
				: String( detail.id ).replace( /"/g, '\\"' );
		const card = document.querySelector< HTMLElement >(
			`[data-widget-id="${ safeId }"]`,
		);
		if ( ! card ) {
			return;
		}
		scene.detachFlakesAnchoredTo( card );
	};
	addAction(
		HOOKS.WIDGET_UNMOUNTING,
		`${ NAMESPACE }/widget-unmounting`,
		widgetUnmountingHandler,
	);

	// Live settings — the config dialog publishes through the shell,
	// which fires this action with the full post-merge object.
	const settingsHandler = ( ...args: unknown[] ): void => {
		const detail = args[ 0 ] as
			| { id?: string; settings?: Record< string, unknown > }
			| undefined;
		if ( ! detail || detail.id !== WALLPAPER_ID ) {
			return;
		}
		scene.applySettings( sanitizeSnowSettings( detail.settings ) );
	};
	addAction(
		HOOKS.WALLPAPER_SETTINGS_CHANGED,
		`${ NAMESPACE }/settings-changed`,
		settingsHandler,
	);

	return (): void => {
		removeAction( HOOKS.WALLPAPER_VISIBILITY, `${ NAMESPACE }/visibility` );
		removeAction( HOOKS.WINDOW_CLOSING, `${ NAMESPACE }/window-closing` );
		removeAction( HOOKS.WINDOW_MINIMIZED, `${ NAMESPACE }/window-minimized` );
		removeAction( HOOKS.WINDOW_RESTORED, `${ NAMESPACE }/window-restored` );
		removeAction( HOOKS.WINDOW_MAXIMIZED, `${ NAMESPACE }/window-maximized` );
		removeAction(
			HOOKS.WINDOW_UNMAXIMIZED,
			`${ NAMESPACE }/window-unmaximized`,
		);
		removeAction(
			HOOKS.WINDOW_FULLSCREEN_ENTERED,
			`${ NAMESPACE }/window-fullscreen-entered`,
		);
		removeAction(
			HOOKS.WINDOW_FULLSCREEN_EXITED,
			`${ NAMESPACE }/window-fullscreen-exited`,
		);
		removeAction(
			HOOKS.WINDOW_BOUNDS_CHANGED,
			`${ NAMESPACE }/bounds-changed`,
		);
		removeAction(
			HOOKS.WIDGET_UNMOUNTING,
			`${ NAMESPACE }/widget-unmounting`,
		);
		removeAction(
			HOOKS.WALLPAPER_SETTINGS_CHANGED,
			`${ NAMESPACE }/settings-changed`,
		);
	};
}

/**
 * Build one labelled `<wpd-range-field>` wired to a settings key.
 * Imperative DOM (no templating import) — the dialog is four fields
 * and a reset button; pulling `ui/core` into this bundle for that
 * would be pure weight.
 */
function rangeField(
	label: string,
	limits: { min: number; max: number },
	step: number,
	value: number,
	onChange: ( next: number ) => void,
): HTMLElement {
	const field = document.createElement( 'wpd-range-field' );
	field.setAttribute( 'label', label );
	field.setAttribute( 'min', String( limits.min ) );
	field.setAttribute( 'max', String( limits.max ) );
	field.setAttribute( 'step', String( step ) );
	field.setAttribute( 'value', String( value ) );
	field.addEventListener( 'wpd-range-change', ( e: Event ) => {
		onChange( ( e as CustomEvent< { value: number } > ).detail.value );
	} );
	return field;
}

/**
 * `renderConfig` — the "Wallpaper settings" dialog body. Four
 * controls (wind, particle count, flake size, backdrop colour) that
 * write through `ctx.setSettings` on every edit; the mounted scene
 * live-applies via the settings-changed action, so the dialog acts
 * as a live tuning panel. "Reset to defaults" writes the canonical
 * values back in one shot.
 */
function renderSnowConfig(
	container: HTMLElement,
	ctx: WallpaperConfigContext,
): WallpaperTeardown {
	let current = sanitizeSnowSettings( ctx.settings );

	const set = ( partial: Partial< SnowSettings > ): void => {
		current = { ...current, ...partial };
		ctx.setSettings( partial );
	};

	const windField = rangeField(
		__( 'Wind' ),
		SNOW_LIMITS.wind,
		1,
		current.wind,
		( value ) => set( { wind: value } ),
	);
	const particlesField = rangeField(
		__( 'Snowflakes' ),
		SNOW_LIMITS.particleCount,
		10,
		current.particleCount,
		( value ) => set( { particleCount: Math.round( value ) } ),
	);
	const sizeField = rangeField(
		__( 'Flake size' ),
		SNOW_LIMITS.flakeSize,
		1,
		current.flakeSize,
		( value ) => set( { flakeSize: value } ),
	);

	const colorField = document.createElement( 'wpd-color-field' );
	colorField.setAttribute( 'label', __( 'Background color' ) );
	colorField.setAttribute( 'value', current.background );
	colorField.addEventListener( 'wpd-color-change', ( e: Event ) => {
		const value = ( e as CustomEvent< { value: string } > ).detail.value;
		set( { background: sanitizeSnowSettings( { background: value } ).background } );
	} );

	const reset = document.createElement( 'wpd-button' );
	reset.setAttribute( 'variant', 'ghost' );
	// The dialog body is a stretch-aligned flex column — left-align
	// the button and add a hair of separation so it reads as a footer
	// action, not another form field.
	reset.style.alignSelf = 'flex-start';
	reset.style.marginTop = '4px';
	reset.textContent = __( 'Reset to defaults' );
	reset.addEventListener( 'click', () => {
		set( { ...SNOW_DEFAULTS } );
		windField.setAttribute( 'value', String( SNOW_DEFAULTS.wind ) );
		particlesField.setAttribute(
			'value',
			String( SNOW_DEFAULTS.particleCount ),
		);
		sizeField.setAttribute( 'value', String( SNOW_DEFAULTS.flakeSize ) );
		colorField.setAttribute( 'value', SNOW_DEFAULTS.background );
	} );

	container.appendChild( windField );
	container.appendChild( particlesField );
	container.appendChild( sizeField );
	container.appendChild( colorField );
	container.appendChild( reset );

	// No long-lived resources — listeners die with the dialog DOM.
	return (): void => {
		/* noop */
	};
}

const def: WallpaperDef = {
	id: WALLPAPER_ID,
	label: __( 'Snow' ),
	type: 'canvas',
	preview: PREVIEW,
	previewParams: { particleCount: PREVIEW_PARTICLES },
	/**
	 * Live tile preview for the OS Settings picker — the real
	 * simulation at tile scale, minus surface collision (surface
	 * rects are viewport-space and meaningless inside a tile) and at
	 * a fraction of the field density.
	 */
	renderPreview: async (
		container: HTMLElement,
		ctx: WallpaperPreviewContext,
	): Promise< WallpaperTeardown > => {
		const pixi = getPixi();
		if ( ! pixi ) {
			return (): void => {
				/* noop */
			};
		}
		const settings = sanitizeSnowSettings( ctx.settings );
		const rawCount = ctx.params.particleCount;
		const previewCount =
			typeof rawCount === 'number' && Number.isFinite( rawCount )
				? rawCount
				: PREVIEW_PARTICLES;
		const scene = await mountSnowScene( {
			container,
			pixi,
			settings: sanitizeSnowSettings( {
				...settings,
				particleCount: previewCount,
			} ),
			prefersReducedMotion: ctx.prefersReducedMotion,
			getSurfaces: null,
		} );
		return (): void => scene.destroy();
	},
	needs: [ 'pixijs' ],
	mount: async (
		container: HTMLElement,
		ctx: WallpaperContext,
	): Promise< WallpaperTeardown > => {
		// `needs: ['pixijs']` guarantees `window.PIXI` is set.
		const pixi = getPixi();
		if ( ! pixi ) {
			return (): void => {
				/* noop */
			};
		}
		const scene = await mountSnowScene( {
			container,
			pixi,
			settings: sanitizeSnowSettings( ctx.settings ),
			prefersReducedMotion: ctx.prefersReducedMotion,
			getSurfaces: surfacesSupplier(),
		} );
		const unwireHooks = wireSceneHooks( scene );

		return (): void => {
			unwireHooks();
			scene.destroy();
		};
	},
	renderConfig: renderSnowConfig,
};

declare global {
	interface Window {
		desktopModeWallpapers?: Record< string, WallpaperDef >;
	}
}

window.desktopModeWallpapers = window.desktopModeWallpapers || {};
window.desktopModeWallpapers[ WALLPAPER_ID ] = def;
