import { __ } from '../../i18n';
import { addAction, removeAction, HOOKS } from '../../hooks';

import '../../ui/components/os-range-field/os-range-field';
import '../../ui/components/os-color-field/os-color-field';
import '../../ui/components/os-button/os-button';
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

const WALLPAPER_ID = 'wp-snow';

const NAMESPACE = 'desktop-mode/snow';

const PREVIEW = backdropCss( SNOW_DEFAULTS.background );

const PREVIEW_PARTICLES = 140;

function surfacesSupplier(): ( () => WallpaperSurface[] ) | null {
	const api = window.wp?.os as
		| { getWallpaperSurfaces?: () => WallpaperSurface[] }
		| undefined;
	if ( ! api || typeof api.getWallpaperSurfaces !== 'function' ) {
		return null;
	}
	return () => ( api.getWallpaperSurfaces as () => WallpaperSurface[] )();
}

function wireSceneHooks( scene: SnowScene ): () => void {
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

	addAction(
		HOOKS.WINDOW_MINIMIZED,
		`${ NAMESPACE }/window-minimized`,
		detachHandler,
	);

	const dirtyHandler = (): void => {
		scene.markSurfacesDirty();
	};
	addAction(
		HOOKS.WINDOW_BOUNDS_CHANGED,
		`${ NAMESPACE }/bounds-changed`,
		dirtyHandler,
	);

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

function rangeField(
	label: string,
	limits: { min: number; max: number },
	step: number,
	value: number,
	onChange: ( next: number ) => void,
): HTMLElement {
	const field = document.createElement( 'os-range-field' );
	field.setAttribute( 'label', label );
	field.setAttribute( 'min', String( limits.min ) );
	field.setAttribute( 'max', String( limits.max ) );
	field.setAttribute( 'step', String( step ) );
	field.setAttribute( 'value', String( value ) );
	field.addEventListener( 'os-range-change', ( e: Event ) => {
		onChange( ( e as CustomEvent< { value: number } > ).detail.value );
	} );
	return field;
}

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

	const colorField = document.createElement( 'os-color-field' );
	colorField.setAttribute( 'label', __( 'Background color' ) );
	colorField.setAttribute( 'value', current.background );
	colorField.addEventListener( 'os-color-change', ( e: Event ) => {
		const value = ( e as CustomEvent< { value: string } > ).detail.value;
		set( { background: sanitizeSnowSettings( { background: value } ).background } );
	} );

	const reset = document.createElement( 'os-button' );
	reset.setAttribute( 'variant', 'ghost' );

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

	return (): void => {

	};
}

const def: WallpaperDef = {
	id: WALLPAPER_ID,
	label: __( 'Snow' ),
	type: 'canvas',
	preview: PREVIEW,
	previewParams: { particleCount: PREVIEW_PARTICLES },

	renderPreview: async (
		container: HTMLElement,
		ctx: WallpaperPreviewContext,
	): Promise< WallpaperTeardown > => {
		const pixi = getPixi();
		if ( ! pixi ) {
			return (): void => {

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
		const pixi = getPixi();
		if ( ! pixi ) {
			return (): void => {

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
		openStationWallpapers?: Record< string, WallpaperDef >;
	}
}

window.openStationWallpapers = window.openStationWallpapers || {};
window.openStationWallpapers[ WALLPAPER_ID ] = def;
