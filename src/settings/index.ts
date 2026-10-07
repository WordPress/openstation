import type { WallpaperLayer } from '../wallpapers/layer';
import * as registry from '../wallpapers/registry';
import { seedWallpaperSettings } from '../wallpapers/settings-store';
import {
	ADMIN_BAR_MODES,
	CUSTOM_ACCENT_ID,
	DEFAULT_WALLPAPER_ID,
	DOCK_BEHAVIORS,
	DOCK_SIZES,
	OS_SETTINGS_WINDOW_ID,
	WINDOW_RADII,
	getAccents,
	getDefaultWallpaperId,
} from './constants';
import { refreshWorkArea } from '../work-area';
import {
	DOCK_BEHAVIOR_ATTR,
	PRIMARY_DOCK_ID,
	refreshDockBehavior,
	SIDE_DOCK_ID,
} from '../dock-behavior';
import {
	cloneState,
	loadState,
	OS_SETTINGS_KEYS,
	PRESENTATION_KEYS,
	sanitizeSettings,
	saveState,
	structuredDefaults,
	type OsSettingsSaveLifecycleDetail,
} from './state';
import { setActiveDockRailRenderer } from '../dock-rail';
import { applyDesktopTheme } from '../desktop-themes/apply';
import { applyThemeRecommendations } from './theme-recommendations';
import type { RecommendedOsSettings } from '../desktop-themes';
import type { OsSettingsState } from './types';
import type { OsSettingsSnapshot } from './registry';
import {
	registerCustomGradient,
	registerCustomImageIfPresent,
} from './wallpaper-defs';

export function accentWantsDarkInk( hex: string ): boolean {
	const match = /^#?([0-9a-f]{6})$/i.exec( hex.trim() );
	if ( ! match ) {
		return false;
	}
	const linear = ( pair: string ): number => {
		const s = parseInt( pair, 16 ) / 255;
		return s <= 0.03928 ? s / 12.92 : ( ( s + 0.055 ) / 1.055 ) ** 2.4;
	};
	const hexRgb = match[ 1 ];
	const luminance =
		0.2126 * linear( hexRgb.slice( 0, 2 ) ) +
		0.7152 * linear( hexRgb.slice( 2, 4 ) ) +
		0.0722 * linear( hexRgb.slice( 4, 6 ) );
	return luminance > 0.35;
}

export interface OsSettingsUpdateOptions {

	windowId?: string;
}

function cloneSettingsPatch< T extends Partial< OsSettingsState > >( patch: T ): T {
	return JSON.parse( JSON.stringify( patch ) ) as T;
}

function sameSettingsValue( a: unknown, b: unknown ): boolean {
	if ( a === b ) {
		return true;
	}
	if ( 'object' !== typeof a || 'object' !== typeof b || null === a || null === b ) {
		return false;
	}
	return JSON.stringify( a ) === JSON.stringify( b );
}

export class OsSettings {
	public state: OsSettingsState;
	public layer: WallpaperLayer;

	private listeners = new Set<( snapshot: OsSettingsSnapshot ) => void>();

	constructor( layer: WallpaperLayer ) {
		this.layer = layer;

		this.state = loadState();

		document.addEventListener(
			'os-settings-save-lifecycle',
			( e: Event ) => {
				const detail = ( e as CustomEvent< OsSettingsSaveLifecycleDetail > )
					.detail;
				if ( ! detail ) {
					return;
				}
				const manager = window.wp?.os?.windowManager;
				manager
					?.getById( OS_SETTINGS_WINDOW_ID )
					?.markActivity( detail.phase, { error: detail.error } );
				if ( detail.phase !== 'failed' || ! detail.rolledBackTo ) {
					return;
				}
				this.state = detail.rolledBackTo;
				this.apply();
				this.notify();
			},
		);

		registerCustomGradient( () => this.state );
	}

	public getOsSettingsSnapshot(): OsSettingsSnapshot {
		return cloneState( this.state );
	}

	public subscribeOsSettings(
		cb: ( snapshot: OsSettingsSnapshot ) => void,
	): () => void {
		this.listeners.add( cb );
		return () => {
			this.listeners.delete( cb );
		};
	}

	public apply(): void {
		const shell = document.getElementById( 'os-shell' );
		if ( ! shell ) {
			return;
		}

		seedWallpaperSettings( this.state.wallpaperSettings );

		registerCustomImageIfPresent( this.state );

		const def =
			registry.get( this.state.wallpaper ) ||
			registry.get( getDefaultWallpaperId() ) ||
			registry.get( DEFAULT_WALLPAPER_ID ) ||
			registry.all()[ 0 ];
		if ( def ) {
			this.layer.apply( def );
		}

		const accents = getAccents();

		const preset =
			accents.find( ( a ) => a.id === this.state.accent ) ?? accents[ 0 ];
		const accentValue =
			this.state.accent === CUSTOM_ACCENT_ID
				? this.state.customAccent
				: preset.value;
		const dockSize =
			DOCK_SIZES.find( ( d ) => d.id === this.state.dockSize ) ?? DOCK_SIZES[ 1 ];
		const windowRadius =
			WINDOW_RADII.find( ( r ) => r.id === this.state.windowRadius ) ??
			WINDOW_RADII[ 1 ];

		const root = document.body;
		root.style.setProperty( '--wp-admin-theme-color', accentValue );

		root.style.setProperty( '--os-ui-accent', accentValue );

		const accentInk = accentWantsDarkInk( accentValue ) ? '#0c0b0f' : '#fffbff';
		root.style.setProperty( '--os-ui-accent-ink', accentInk );

		const BRAND_ACCENT = '#f252fc';
		const accentDim =
			accentValue.toLowerCase() === BRAND_ACCENT
				? null
				: `color-mix( in srgb, ${ accentValue } 88%, #000 )`;
		if ( accentDim === null ) {
			root.style.removeProperty( '--os-ui-accent-dim' );
		} else {
			root.style.setProperty( '--os-ui-accent-dim', accentDim );
		}

		shell.style.setProperty( '--os-ui-accent', accentValue );
		shell.style.setProperty( '--os-ui-accent-ink', accentInk );
		if ( accentDim === null ) {
			shell.style.removeProperty( '--os-ui-accent-dim' );
		} else {
			shell.style.setProperty( '--os-ui-accent-dim', accentDim );
		}
		root.style.setProperty( '--os-dock-width', `${ dockSize.width }px` );
		root.style.setProperty( '--os-dock-icon-size', `${ dockSize.icon }px` );

		shell.style.setProperty( '--os-dock-width', `${ dockSize.width }px` );
		shell.style.setProperty( '--os-dock-icon-size', `${ dockSize.icon }px` );
		root.style.setProperty(
			'--os-window-radius',
			`${ windowRadius.value }px`,
		);

		shell.style.setProperty(
			'--os-window-radius',
			`${ windowRadius.value }px`,
		);

		const adminBarMode =
			ADMIN_BAR_MODES.find( ( m ) => m.id === this.state.adminBarMode ) ??
			ADMIN_BAR_MODES[ 0 ];
		for ( const mode of ADMIN_BAR_MODES ) {
			document.body.classList.toggle(
				`os-admin-bar-${ mode.id }`,
				mode.id === adminBarMode.id,
			);
		}

		const behaviorOf = ( id: string ): string =>
			( DOCK_BEHAVIORS.find( ( b ) => b.id === id ) ?? DOCK_BEHAVIORS[ 0 ] ).id;
		document
			.getElementById( PRIMARY_DOCK_ID )
			?.setAttribute( DOCK_BEHAVIOR_ATTR, behaviorOf( this.state.dockBehavior ) );
		document
			.getElementById( SIDE_DOCK_ID )
			?.setAttribute( DOCK_BEHAVIOR_ATTR, behaviorOf( this.state.sideDockBehavior ) );
		refreshDockBehavior();
		refreshWorkArea();

		shell.setAttribute(
			'data-os-layout',
			this.state.desktopLayout,
		);

		setActiveDockRailRenderer( this.state.dockRailRenderer );

		applyDesktopTheme( this.state.desktopTheme );
	}

	private baseState: OsSettingsState | null = null;

	private overridePatch: Partial< OsSettingsState > | null = null;

	public setWorkspaceAppearance(
		patch: Partial< OsSettingsState > | null,
	): void {
		const base = this.baseState ?? this.state;
		const empty = ! patch || Object.keys( patch ).length === 0;
		if ( empty ) {
			if ( ! this.baseState ) {
				return;
			}
			this.state = base;
			this.baseState = null;
			this.overridePatch = null;
		} else {
			this.baseState = base;

			this.overridePatch = cloneSettingsPatch( patch );
			this.state = { ...base, ...cloneSettingsPatch( patch ) };
		}
		this.apply();

		this.notify();
	}

	public save( opts: OsSettingsUpdateOptions = {} ): void {
		const persistable = this._persistableState();

		if ( this.baseState ) {
			this.baseState = cloneState( persistable );
		}
		saveState( persistable, opts );
		this.notify();
	}

	private _persistableState(): OsSettingsState {
		const base = this.baseState;
		const patch = this.overridePatch;
		if ( ! base || ! patch ) {
			return this.state;
		}

		const out = { ...this.state } as unknown as Record< string, unknown >;
		const source = patch as Record< string, unknown >;
		const original = base as unknown as Record< string, unknown >;
		for ( const key of Object.keys( source ) ) {
			if ( sameSettingsValue( out[ key ], source[ key ] ) ) {
				out[ key ] = original[ key ];
			}
		}
		return out as unknown as OsSettingsState;
	}

	public update(
		patch: Partial< OsSettingsState >,
		opts: OsSettingsUpdateOptions = {},
	): void {
		const incoming: Record< string, unknown > = { ...patch };
		delete incoming.appliedThemeRecommendations;

		delete incoming.adminAssetCacheEnabled;
		delete incoming.windowPrewarmEnabled;

		const next = sanitizeSettings( incoming, this.state );
		const touched = OS_SETTINGS_KEYS.filter( ( key ) => key in incoming );

		Object.assign( this.state, next );

		this.save( opts );
		if ( touched.some( ( key ) => PRESENTATION_KEYS.has( key ) ) ) {
			this.apply();
		}
	}

	public applyThemeRecommendations( themeId: string ): RecommendedOsSettings {
		const applied = applyThemeRecommendations( this.state, themeId, {
			force: true,
		} );
		if ( Object.keys( applied ).length > 0 ) {
			this.save();
			this.apply();
		}
		return applied;
	}

	public reset( opts: OsSettingsUpdateOptions = {} ): void {
		const next = structuredDefaults();
		next.wallpaper = getDefaultWallpaperId();
		next.customImage = this.state.customImage;
		next.adminAssetCacheEnabled = this.state.adminAssetCacheEnabled;
		next.windowPrewarmEnabled = this.state.windowPrewarmEnabled;
		Object.assign( this.state, next );
		this.save( opts );
		this.apply();
	}

	private notify(): void {
		if ( this.listeners.size === 0 ) {
			return;
		}
		const snapshot = this.getOsSettingsSnapshot();
		for ( const cb of Array.from( this.listeners ) ) {
			try {
				cb( snapshot );
			} catch ( err ) {
				if ( typeof console !== 'undefined' ) {
					console.error( '[openstation] os-settings listener threw:', err );
				}
			}
		}
	}
}
