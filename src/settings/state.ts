import type { DesktopConfig } from '../types';
import { restErrorFromResponse } from '../core/api-client';
import {
	ADMIN_BAR_MODES,
	CUSTOM_ACCENT_ID,
	DEFAULTS,
	DESKTOP_LAYOUTS,
	DOCK_BEHAVIORS,
	DOCK_PLACEMENTS,
	DOCK_SIZES,
	OS_SETTINGS_WINDOW_ID,
	STORAGE_KEY,
	WINDOW_RADII,
	OPEN_WINDOWS_AS,
	getAccents,
	getDefaultWallpaperId,
} from './constants';
import type {
	AiSettings,
	CustomGradient,
	CustomImage,
	OsSettingsState,
} from './types';
import type { NavPlacement } from '../nav/types';
import { isHexColor } from './utils';
import { sanitizeMioLook } from '../mio/look';
import { trackedFetch } from '../tracked-fetch';

export function loadState(): OsSettingsState {
	const serverRaw = _readServerSettings();
	if ( serverRaw ) {
		const state = sanitizeSettings( serverRaw, liveDefaults() );

		_writeLocalStorage( state );

		setLastConfirmedState( state );
		return state;
	}

	try {
		const cached = window.localStorage.getItem( STORAGE_KEY );
		if ( cached ) {
			return sanitizeSettings(
				JSON.parse( cached ) as Partial< OsSettingsState >,
				liveDefaults(),
			);
		}
	} catch {

	}

	return liveDefaults();
}

function liveDefaults(): OsSettingsState {
	const defaults = structuredDefaults();
	defaults.wallpaper = getDefaultWallpaperId();
	return defaults;
}

function _readServerSettings(): Partial< OsSettingsState > | null {
	const config = ( window as unknown as {
		openStationConfig?: DesktopConfig;
	} ).openStationConfig;
	const raw = config?.osSettings;
	if ( ! raw || typeof raw !== 'object' || Array.isArray( raw ) ) {
		return null;
	}
	return raw as Partial< OsSettingsState >;
}

type Sanitizer< T > = ( raw: unknown, fallback: T ) => T;

type Sanitizers = {
	[ K in keyof OsSettingsState ]: Sanitizer< OsSettingsState[ K ] >;
};

const isObject = ( raw: unknown ): raw is Record< string, unknown > =>
	!! raw && typeof raw === 'object' && ! Array.isArray( raw );

const bool: Sanitizer< boolean > = ( raw, fallback ) =>
	typeof raw === 'boolean' ? raw : fallback;

const oneOf =
	< T extends string >( list: ReadonlyArray< { id: T } > ): Sanitizer< T > =>
		( raw, fallback ) =>
			list.some( ( option ) => option.id === raw ) ? ( raw as T ) : fallback;

const matching =
	( pattern: RegExp ): Sanitizer< string > =>
		( raw, fallback ) =>
			typeof raw === 'string' && pattern.test( raw ) ? raw : fallback;

const REGISTRY_ID = /^[a-z0-9_/-]+$/;

const SANITIZERS: Sanitizers = {
	wallpaper: ( raw, fallback ) =>
		typeof raw === 'string' && raw !== '' ? raw : fallback,

	accent: ( raw, fallback ) =>
		raw === CUSTOM_ACCENT_ID || getAccents().some( ( a ) => a.id === raw )
			? ( raw as string )
			: fallback,

	customAccent: matching( /^#[0-9a-fA-F]{6}$/ ),
	dockSize: oneOf( DOCK_SIZES ),
	windowRadius: oneOf( WINDOW_RADII ),
	openWindowsAs: oneOf( OPEN_WINDOWS_AS ),
	adminBarMode: oneOf( ADMIN_BAR_MODES ),
	desktopLayout: oneOf( DESKTOP_LAYOUTS ),
	dockPlacement: oneOf( DOCK_PLACEMENTS ),
	dockBehavior: oneOf( DOCK_BEHAVIORS ),
	sideDockBehavior: oneOf( DOCK_BEHAVIORS ),

	dockRailRenderer: matching( /^[a-z0-9_-]+$/ ),

	desktopTheme: matching( /^[a-z0-9_-]*$/ ),

	appliedThemeRecommendations: ( raw, fallback ) =>
		Array.isArray( raw )
			? Array.from(
				new Set(
					raw.filter(
						( v ): v is string =>
							typeof v === 'string' && /^[a-z0-9_-]+$/.test( v ),
					),
				),
			).slice( -64 )
			: fallback.slice(),
	unfocusEffect: matching( REGISTRY_ID ),
	windowReveal: matching( REGISTRY_ID ),

	windowRevealDuration: ( raw, fallback ) => {
		if ( typeof raw !== 'number' || ! Number.isFinite( raw ) ) {
			return fallback;
		}
		return raw > 0 ? Math.min( 4000, Math.max( 80, Math.round( raw ) ) ) : 0;
	},
	windowLinkRenderer: matching( REGISTRY_ID ),
	windowLinkVisibility: ( raw, fallback ) =>
		raw === 'focus' || raw === 'always' || raw === 'off' ? raw : fallback,
	windowLinksEnabled: bool,
	windowLinkRaiseOnFocus: bool,
	windowLinkHighlight: bool,
	customGradient: ( raw, fallback ) =>
		isObject( raw ) ? sanitizeCustomGradient( raw ) : { ...fallback },

	customImage: ( raw, fallback ) =>
		raw === null || isObject( raw ) ? sanitizeCustomImage( raw ) : fallback,
	wallpaperSettings: ( raw, fallback ) =>
		isObject( raw ) ? sanitizeWallpaperSettings( raw ) : fallback,
	libraryHdOnly: bool,
	ai: ( raw, fallback ) => sanitizeAi( raw, fallback ),
	heartbeatRate: ( raw, fallback ) =>
		raw === 15 || raw === 30 || raw === 45 || raw === 60 ? raw : fallback,
	nativePostsEnabled: bool,

	nativePostsHiddenColumns: ( raw, fallback ) =>
		Array.isArray( raw )
			? raw
				.filter( ( v ): v is string => typeof v === 'string' && v !== '' )
				.slice( 0, 32 )
			: fallback.slice(),
	nativePagesEnabled: bool,
	nativePagesHiddenColumns: ( raw, fallback ) =>
		Array.isArray( raw )
			? raw
				.filter( ( v ): v is string => typeof v === 'string' && v !== '' )
				.slice( 0, 32 )
			: fallback.slice(),
	nativeUsersEnabled: bool,
	nativePluginsEnabled: bool,
	nativeCommentsEnabled: bool,
	stationHomeEnabled: bool,
	adminAssetCacheEnabled: bool,
	windowPrewarmEnabled: bool,
	showDesktopOnWallpaperClick: bool,
	confirmCloseAllWindows: bool,
	mioEnabled: bool,
	mioApiEnabled: bool,
	mioShowOnWallpaper: bool,

	mioStyle: ( raw, fallback ) =>
		isObject( raw ) ? sanitizeMioLook( raw ) : fallback,
	showPostStatusRibbons: bool,
	developerModeEnabled: bool,
	foldersSharingEnabled: bool,
	navPlacement: ( raw, fallback ) =>
		isObject( raw ) ? sanitizeNavPlacement( raw ) : fallback,
	navOrder: ( raw, fallback ) =>
		Array.isArray( raw ) ? sanitizeNavOrder( raw ) : fallback,
	mobileLayout: ( raw, fallback ) =>
		raw === 'auto' || raw === 'desktop' || raw === 'mobile' ? raw : fallback,
	mobileTabs: ( raw, fallback ) =>
		Array.isArray( raw ) ? sanitizeNavOrder( raw ).slice( 0, 3 ) : fallback,
	dockPromotedPositions: ( raw, fallback ) =>
		isObject( raw ) ? sanitizeDockPromotedPositions( raw ) : fallback,
};

export const OS_SETTINGS_KEYS = Object.keys( SANITIZERS ) as Array<
	keyof OsSettingsState
>;

export function sanitizeSettings(
	raw: Partial< OsSettingsState > | Record< string, unknown >,
	base: OsSettingsState,
): OsSettingsState {
	const out = cloneState( base ) as unknown as Record< string, unknown >;
	const source = raw as Record< string, unknown >;
	const table = SANITIZERS as unknown as Record<
		string,
		( value: unknown, fallback: unknown ) => unknown
	>;
	for ( const key of OS_SETTINGS_KEYS ) {
		if ( ! ( key in source ) ) {
			continue;
		}
		out[ key ] = table[ key ]( source[ key ], out[ key ] );
	}

	if ( typeof source.mioEnabled === 'boolean' ) {
		out.mioEnabled = source.mioEnabled;
	} else if ( typeof source.mioApiEnabled === 'boolean' ) {
		out.mioEnabled = source.mioApiEnabled;
	}
	out.mioApiEnabled = out.mioEnabled;
	return out as unknown as OsSettingsState;
}

export const PRESENTATION_KEYS: ReadonlySet< keyof OsSettingsState > = new Set<
	keyof OsSettingsState
>( [
	'wallpaper',
	'accent',
	'customAccent',
	'customGradient',
	'customImage',
	'wallpaperSettings',
	'dockSize',
	'windowRadius',
	'adminBarMode',
	'desktopLayout',
	'dockPlacement',
	'dockBehavior',
	'sideDockBehavior',
	'dockRailRenderer',
	'desktopTheme',
] );

export function sanitizeWallpaperSettings(
	raw: unknown,
): Record< string, Record< string, string | number | boolean > > {
	if ( ! isObject( raw ) ) {
		return {};
	}
	const out: Record<
		string,
		Record< string, string | number | boolean >
	> = {};
	let idCount = 0;
	for ( const [ id, bag ] of Object.entries( raw ) ) {
		if ( idCount >= 64 ) {
			break;
		}
		if ( id === '' || ! REGISTRY_ID.test( id ) || ! isObject( bag ) ) {
			continue;
		}
		const clean: Record< string, string | number | boolean > = {};
		let keyCount = 0;
		for ( const [ key, value ] of Object.entries( bag ) ) {
			if ( keyCount >= 32 ) {
				break;
			}
			if ( key === '' || ! /^[a-zA-Z0-9_-]+$/.test( key ) ) {
				continue;
			}
			if ( typeof value === 'boolean' ) {
				clean[ key ] = value;
			} else if ( typeof value === 'number' && Number.isFinite( value ) ) {
				clean[ key ] = value;
			} else if ( typeof value === 'string' ) {
				clean[ key ] = value.slice( 0, 256 );
			} else {
				continue;
			}
			keyCount++;
		}
		if ( keyCount === 0 ) {
			continue;
		}
		out[ id ] = clean;
		idCount++;
	}
	return out;
}

function sanitizeNavPlacement( raw: Record< string, unknown > ): Record< string, NavPlacement > {
	const allowed: ReadonlyArray< NavPlacement > = [ 'both', 'rail', 'desktop', 'hidden' ];
	const out: Record< string, NavPlacement > = {};
	let count = 0;
	for ( const [ k, v ] of Object.entries( raw ) ) {
		if ( count >= 256 ) {
			break;
		}
		if ( k === '' || typeof v !== 'string' || ! allowed.includes( v as NavPlacement ) ) {
			continue;
		}
		out[ k ] = v as NavPlacement;
		count++;
	}
	return out;
}

function sanitizeNavOrder( raw: unknown[] ): string[] {
	const out: string[] = [];
	const seen = new Set< string >();
	for ( const id of raw ) {
		if ( typeof id !== 'string' || id === '' || seen.has( id ) ) {
			continue;
		}
		seen.add( id );
		out.push( id );
		if ( out.length >= 256 ) {
			break;
		}
	}
	return out;
}

function sanitizeDockPromotedPositions(
	raw: Record< string, unknown >,
): Record< string, { x: number; y: number } > {
	const out: Record< string, { x: number; y: number } > = {};
	let count = 0;
	const MAX_COORD = 100_000;
	for ( const [ k, v ] of Object.entries( raw ) ) {
		if ( count >= 256 ) {
			break;
		}
		if ( k === '' || ! isObject( v ) ) {
			continue;
		}
		const pos = v as { x?: unknown; y?: unknown };
		if (
			typeof pos.x !== 'number' ||
			typeof pos.y !== 'number' ||
			! Number.isFinite( pos.x ) ||
			! Number.isFinite( pos.y ) ||
			Math.abs( pos.x ) > MAX_COORD ||
			Math.abs( pos.y ) > MAX_COORD
		) {
			continue;
		}
		out[ k ] = { x: pos.x, y: pos.y };
		count++;
	}
	return out;
}

let _syncTimer: ReturnType< typeof setTimeout > | null = null;

const SYNC_DEBOUNCE_MS = 250;

let _lastConfirmedState: OsSettingsState | null = null;

export function setLastConfirmedState( state: OsSettingsState ): void {
	_lastConfirmedState = cloneState( state );
}

export function cloneState( state: OsSettingsState ): OsSettingsState {
	return {
		...state,
		customGradient: { ...state.customGradient },
		customImage: state.customImage ? { ...state.customImage } : null,
		wallpaperSettings: Object.fromEntries(
			Object.entries( state.wallpaperSettings ).map( ( [ k, v ] ) => [
				k,
				{ ...v },
			] ),
		),
		ai: { ...state.ai },
		mioStyle: {
			appearance: { ...state.mioStyle.appearance },
			physics: { ...state.mioStyle.physics },
		},
		appliedThemeRecommendations: state.appliedThemeRecommendations.slice(),
		nativePostsHiddenColumns: state.nativePostsHiddenColumns.slice(),
		nativePagesHiddenColumns: state.nativePagesHiddenColumns.slice(),
		navPlacement: { ...state.navPlacement },
		navOrder: state.navOrder.slice(),
		dockPromotedPositions: Object.fromEntries(
			Object.entries( state.dockPromotedPositions ).map( ( [ k, v ] ) => [
				k,
				{ ...v },
			] ),
		),
	};
}

export function saveState(
	state: OsSettingsState,
	opts: { windowId?: string } = {},
): void {
	_writeLocalStorage( state );
	_scheduleSyncToServer( state, opts.windowId );
}

function _writeLocalStorage( state: OsSettingsState ): void {
	try {
		window.localStorage.setItem( STORAGE_KEY, JSON.stringify( state ) );
	} catch {

	}
}

function _scheduleSyncToServer(
	state: OsSettingsState,
	windowId?: string,
): void {
	if ( _syncTimer !== null ) {
		clearTimeout( _syncTimer );
	}

	if ( windowId ) {
		_pendingActivityWindowId = windowId;
	}
	_emitSaveLifecycle( 'pending' );
	_syncTimer = setTimeout( () => {
		_syncTimer = null;
		const id = _pendingActivityWindowId;
		_pendingActivityWindowId = null;
		_postToServer( state, id );
	}, SYNC_DEBOUNCE_MS );
}

let _pendingActivityWindowId: string | null = null;

function _buildPayload(
	state: OsSettingsState,
): Partial< OsSettingsState > | null {
	if ( ! _lastConfirmedState ) {
		return { ...state };
	}
	const baseline = _lastConfirmedState;
	const payload: Partial< OsSettingsState > = {};
	let changed = false;
	for ( const key of Object.keys( state ) as ( keyof OsSettingsState )[] ) {
		if (
			JSON.stringify( state[ key ] ) === JSON.stringify( baseline[ key ] )
		) {
			continue;
		}

		Object.assign( payload, { [ key ]: state[ key ] } );
		changed = true;
	}
	return changed ? payload : null;
}

let _saveInFlight = false;
let _queuedSave: { state: OsSettingsState; windowId?: string | null } | null =
	null;

function _postToServer( state: OsSettingsState, windowId?: string | null ): void {
	if ( _saveInFlight ) {
		_queuedSave = { state, windowId };

		_emitSaveLifecycle( 'pending' );
		return;
	}
	const config = ( window as unknown as {
		openStationConfig?: DesktopConfig;
	} ).openStationConfig;
	const url = config?.osSettingsUrl;
	const nonce = config?.restNonce;
	if ( ! url || ! nonce ) {
		_emitSaveLifecycle( 'saved', undefined, undefined, state );
		return;
	}

	const payload = _buildPayload( state );
	if ( ! payload ) {
		_emitSaveLifecycle( 'saved', undefined, undefined, state );
		return;
	}

	_emitSaveLifecycle( 'saving' );
	_saveInFlight = true;

	const sentSnapshot = cloneState( state );

	const attributedWindowId = windowId || OS_SETTINGS_WINDOW_ID;
	trackedFetch(
		url,
		{
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-WP-Nonce': nonce,
			},
			body: JSON.stringify( { settings: payload } ),
		},
		{ windowId: attributedWindowId },
	)
		.then( async ( res ) => {
			if ( ! res.ok ) {
				throw await restErrorFromResponse( res );
			}

			_lastConfirmedState = sentSnapshot;
			_emitSaveLifecycle( 'saved', undefined, undefined, sentSnapshot );
		} )
		.catch( ( err ) => {
			_saveFailed = true;
			if ( _lastConfirmedState ) {
				_writeLocalStorage( _lastConfirmedState );
				_emitSaveLifecycle(
					'failed',
					err instanceof Error ? err.message : String( err ),
					cloneState( _lastConfirmedState ),
				);
			} else {
				_emitSaveLifecycle(
					'failed',
					err instanceof Error ? err.message : String( err ),
				);
			}
		} )
		.finally( () => {
			_saveInFlight = false;

			const queued = _queuedSave;
			_queuedSave = null;
			if ( queued && _saveFailed ) {
				_saveFailed = false;
				return;
			}
			_saveFailed = false;
			if ( queued ) {
				_postToServer( queued.state, queued.windowId );
			}
		} );
}

let _saveFailed = false;

export type OsSettingsSavePhase = 'pending' | 'saving' | 'saved' | 'failed';

export interface OsSettingsSaveLifecycleDetail {
	phase: OsSettingsSavePhase;
	error?: string;

	rolledBackTo?: OsSettingsState;

	savedSettings?: OsSettingsState;
}

function _emitSaveLifecycle(
	phase: OsSettingsSavePhase,
	error?: string,
	rolledBackTo?: OsSettingsState | null,
	savedSettings?: OsSettingsState,
): void {
	const detail: OsSettingsSaveLifecycleDetail = { phase };
	if ( savedSettings ) {
		detail.savedSettings = cloneState( savedSettings );
	}
	if ( error ) {
		detail.error = error;
	}
	if ( rolledBackTo ) {
		detail.rolledBackTo = rolledBackTo;
	}
	document.dispatchEvent(
		new CustomEvent( 'os-settings-save-lifecycle', { detail } ),
	);
}

export function structuredDefaults(): OsSettingsState {
	return cloneState( DEFAULTS );
}

export function sanitizeAi(
	raw: unknown,
	fallback: AiSettings = DEFAULTS.ai,
): AiSettings {
	if ( ! isObject( raw ) ) {
		return { ...fallback };
	}
	const { enabled } = raw as Partial< AiSettings >;
	return {
		enabled: typeof enabled === 'boolean' ? enabled : fallback.enabled,
	};
}

export function sanitizeCustomGradient( raw: unknown ): CustomGradient {
	if ( ! isObject( raw ) ) {
		return { ...DEFAULTS.customGradient };
	}
	const { from, to, angle } = raw as Partial< CustomGradient >;
	return {
		from: isHexColor( from ) ? ( from as string ) : DEFAULTS.customGradient.from,
		to: isHexColor( to ) ? ( to as string ) : DEFAULTS.customGradient.to,
		angle:
			typeof angle === 'number' && Number.isFinite( angle ) && angle >= 0 && angle <= 360
				? angle
				: DEFAULTS.customGradient.angle,
	};
}

export function sanitizeCustomImage( raw: unknown ): CustomImage | null {
	if ( ! isObject( raw ) ) {
		return null;
	}
	const { id, url } = raw as Partial< CustomImage >;
	if ( typeof id !== 'number' || ! Number.isFinite( id ) || id <= 0 ) {
		return null;
	}
	if ( typeof url !== 'string' || ! /^https?:\/\//i.test( url ) ) {
		return null;
	}
	return { id, url };
}
