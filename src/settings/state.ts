/**
 * Persistence + sanitization for `OsSettingsState`.
 *
 * Source-of-truth hierarchy (highest to lowest):
 *   1. Server — `wpDesktopConfig.osSettings` loaded from user meta at
 *      page boot. Wins over localStorage so a setting changed on another
 *      device/browser is honoured on the next page load.
 *   2. localStorage — fast local cache; written on every change for
 *      instant subsequent reads within the same session.
 *   3. Defaults — compile-time fallback when both are absent.
 *
 * Writes:
 *   - localStorage: synchronous, every `saveState()` call.
 *   - User meta (REST): debounced 1 500 ms after the last change via
 *     `scheduleSyncToServer()`. The JS layer fires `saveState()` on every
 *     preference change so the debounce collapse rapid edits (e.g. dragging
 *     the gradient angle slider) into a single network request.
 */

import type { DesktopConfig } from '../types';
import {
	getAiProviders,
	AI_TRANSPORTS,
	DEFAULTS,
	DESKTOP_LAYOUTS,
	DOCK_SIZES,
	STORAGE_KEY,
	getAccents,
	getDefaultWallpaperId,
} from './constants';
import type {
	AccentId,
	AiSettings,
	AiTransportId,
	CustomGradient,
	CustomImage,
	DesktopLayoutId,
	DockSizeId,
	OsSettingsState,
} from './types';
import { isHexColor } from './utils';

// -----------------------------------------------------------------------
// Load
// -----------------------------------------------------------------------

/**
 * Resolves the initial state. Prefers the server-provided snapshot
 * (`wpDesktopConfig.osSettings`) over the localStorage cache so a
 * preference changed in another browser shows up on the next page load
 * without the user having to manually refresh.
 *
 * If the server snapshot is absent (older PHP build, first ever load
 * before the feature existed, etc.) the localStorage cache is used.
 * If both are absent the compile-time defaults are returned.
 *
 * After reading from the server, the result is written to localStorage so
 * subsequent in-session reads are instant without a round-trip.
 */
export function loadState(): OsSettingsState {
	// 1. Server snapshot — most authoritative.
	const serverRaw = _readServerSettings();
	if ( serverRaw ) {
		const state = _parseRaw( serverRaw );
		// Prime the local cache so mid-session reads don't re-parse JSON.
		_writeLocalStorage( state );
		return state;
	}

	// 2. localStorage cache.
	try {
		const cached = window.localStorage.getItem( STORAGE_KEY );
		if ( cached ) {
			return _parseRaw( JSON.parse( cached ) as Partial<OsSettingsState> );
		}
	} catch {
		/* Quota / parse error — fall through to defaults. */
	}

	// 3. Defaults.
	return structuredDefaults();
}

/** Read `wpDesktopConfig.osSettings` from the global config. */
function _readServerSettings(): Partial<OsSettingsState> | null {
	const config = ( window as unknown as {
		wpDesktopConfig?: DesktopConfig;
	} ).wpDesktopConfig;
	const raw = config?.osSettings;
	if ( ! raw || typeof raw !== 'object' || Array.isArray( raw ) ) {
		return null;
	}
	return raw as Partial<OsSettingsState>;
}

/** Coerce an untrusted shape into a fully-populated `OsSettingsState`. */
function _parseRaw( parsed: Partial<OsSettingsState> ): OsSettingsState {
	const accents = getAccents();
	return {
		wallpaper:
			typeof parsed.wallpaper === 'string' && parsed.wallpaper !== ''
				? parsed.wallpaper
				: getDefaultWallpaperId(),
		accent: accents.some( ( a ) => a.id === parsed.accent )
			? ( parsed.accent as AccentId )
			: DEFAULTS.accent,
		dockSize: DOCK_SIZES.some( ( d ) => d.id === parsed.dockSize )
			? ( parsed.dockSize as DockSizeId )
			: DEFAULTS.dockSize,
		desktopLayout: DESKTOP_LAYOUTS.some(
			( l ) => l.id === parsed.desktopLayout,
		)
			? ( parsed.desktopLayout as DesktopLayoutId )
			: DEFAULTS.desktopLayout,
		// Dock rail renderer — any sanitize_key()-clean string
		// survives; the registry resolves at use time and falls back
		// to `'default'` when the picked renderer isn't registered.
		dockRailRenderer:
			typeof parsed.dockRailRenderer === 'string' &&
			/^[a-z0-9_-]+$/.test( parsed.dockRailRenderer )
				? parsed.dockRailRenderer
				: DEFAULTS.dockRailRenderer,
		customGradient: sanitizeCustomGradient( parsed.customGradient ),
		customImage: sanitizeCustomImage( parsed.customImage ),
		libraryHdOnly:
			typeof parsed.libraryHdOnly === 'boolean'
				? parsed.libraryHdOnly
				: DEFAULTS.libraryHdOnly,
		ai: sanitizeAi( parsed.ai ),
	};
}

// -----------------------------------------------------------------------
// Save
// -----------------------------------------------------------------------

/** Pending debounce handle for the REST sync. */
let _syncTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounce window in ms before a change is flushed to user meta. */
const SYNC_DEBOUNCE_MS = 1500;

/**
 * Persist state to localStorage and schedule a debounced sync to user
 * meta via the REST endpoint.
 *
 * localStorage is written synchronously for instant in-session read-back.
 * The REST call is debounced so rapid changes (dragging sliders, typing
 * an API key) collapse into one network request.
 */
export function saveState( state: OsSettingsState ): void {
	_writeLocalStorage( state );
	_scheduleSyncToServer( state );
}

function _writeLocalStorage( state: OsSettingsState ): void {
	try {
		window.localStorage.setItem( STORAGE_KEY, JSON.stringify( state ) );
	} catch {
		/* Quota or private-mode failure — local cache unavailable. */
	}
}

function _scheduleSyncToServer( state: OsSettingsState ): void {
	if ( _syncTimer !== null ) {
		clearTimeout( _syncTimer );
	}
	_syncTimer = setTimeout( () => {
		_syncTimer = null;
		_postToServer( state );
	}, SYNC_DEBOUNCE_MS );
}

function _postToServer( state: OsSettingsState ): void {
	const config = ( window as unknown as {
		wpDesktopConfig?: DesktopConfig;
	} ).wpDesktopConfig;
	const url = config?.osSettingsUrl;
	const nonce = config?.restNonce;
	if ( ! url || ! nonce ) {
		return;
	}

	fetch( url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-WP-Nonce': nonce,
		},
		body: JSON.stringify( { settings: state } ),
	} ).catch( () => {
		/* Network failure — the localStorage copy remains intact.
		 * The next successful save will re-sync. */
	} );
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

export function structuredDefaults(): OsSettingsState {
	return {
		...DEFAULTS,
		customGradient: { ...DEFAULTS.customGradient },
		customImage: null,
		ai: { ...DEFAULTS.ai },
	};
}

export function sanitizeAi( raw: unknown ): AiSettings {
	if ( ! raw || typeof raw !== 'object' ) {
		return { ...DEFAULTS.ai, apiKeys: {} };
	}
	const { enabled, provider, apiKey, apiKeys, transport } = raw as Partial< AiSettings >;
	const known = getAiProviders();
	const validProvider =
		typeof provider === 'string' && known.some( ( p ) => p.id === provider )
			? provider
			: DEFAULTS.ai.provider;

	const cleanKeys: Record< string, string > = {};
	if ( apiKeys && typeof apiKeys === 'object' ) {
		for ( const [ pid, val ] of Object.entries( apiKeys ) ) {
			if ( typeof val === 'string' ) {
				cleanKeys[ pid ] = val.slice( 0, 512 );
			}
		}
	}

	const validTransport: AiTransportId =
		typeof transport === 'string' &&
		AI_TRANSPORTS.some( ( t ) => t.id === transport )
			? ( transport as AiTransportId )
			: DEFAULTS.ai.transport;

	return {
		enabled: typeof enabled === 'boolean' ? enabled : DEFAULTS.ai.enabled,
		provider: validProvider,
		apiKey: typeof apiKey === 'string' ? apiKey : DEFAULTS.ai.apiKey,
		apiKeys: cleanKeys,
		transport: validTransport,
	};
}

export function sanitizeCustomGradient( raw: unknown ): CustomGradient {
	if ( ! raw || typeof raw !== 'object' ) {
		return { ...DEFAULTS.customGradient };
	}
	const { from, to, angle } = raw as Partial<CustomGradient>;
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
	if ( ! raw || typeof raw !== 'object' ) {
		return null;
	}
	const { id, url } = raw as Partial<CustomImage>;
	if ( typeof id !== 'number' || ! Number.isFinite( id ) || id <= 0 ) {
		return null;
	}
	if ( typeof url !== 'string' || ! /^https?:\/\//i.test( url ) ) {
		return null;
	}
	return { id, url };
}
