/**
 * Persistence + sanitization for `OsSettingsState`.
 *
 * Source-of-truth hierarchy (highest to lowest):
 *   1. Server — `desktopModeConfig.osSettings` loaded from user meta at
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
import { trackedFetch } from '../tracked-fetch';

// -----------------------------------------------------------------------
// Load
// -----------------------------------------------------------------------

/**
 * Resolves the initial state. Prefers the server-provided snapshot
 * (`desktopModeConfig.osSettings`) over the localStorage cache so a
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

/** Read `desktopModeConfig.osSettings` from the global config. */
function _readServerSettings(): Partial<OsSettingsState> | null {
	const config = ( window as unknown as {
		desktopModeConfig?: DesktopConfig;
	} ).desktopModeConfig;
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
		// Unfocus effect — any registry id (`vendor/sub-id` allowed) or
		// the `'none'` sentinel survives; the engine resolves at use
		// time and treats an unknown id as "no effect".
		unfocusEffect:
			typeof parsed.unfocusEffect === 'string' &&
			/^[a-z0-9_/-]+$/.test( parsed.unfocusEffect )
				? parsed.unfocusEffect
				: DEFAULTS.unfocusEffect,
		customGradient: sanitizeCustomGradient( parsed.customGradient ),
		customImage: sanitizeCustomImage( parsed.customImage ),
		libraryHdOnly:
			typeof parsed.libraryHdOnly === 'boolean'
				? parsed.libraryHdOnly
				: DEFAULTS.libraryHdOnly,
		ai: sanitizeAi( parsed.ai ),
		heartbeatRate:
			parsed.heartbeatRate === 15 ||
			parsed.heartbeatRate === 30 ||
			parsed.heartbeatRate === 45 ||
			parsed.heartbeatRate === 60
				? parsed.heartbeatRate
				: DEFAULTS.heartbeatRate,
		nativePostsEnabled:
			typeof parsed.nativePostsEnabled === 'boolean'
				? parsed.nativePostsEnabled
				: DEFAULTS.nativePostsEnabled,
		nativePostsHiddenColumns: Array.isArray( parsed.nativePostsHiddenColumns )
			? parsed.nativePostsHiddenColumns
				.filter( ( v ): v is string => typeof v === 'string' && v !== '' )
			// Cap to a sane upper bound so a corrupted server
			// payload can't memory-bloat the cell. 32 is far
			// more than any plausible column count.
				.slice( 0, 32 )
			: DEFAULTS.nativePostsHiddenColumns.slice(),
		nativePagesEnabled:
			typeof parsed.nativePagesEnabled === 'boolean'
				? parsed.nativePagesEnabled
				: DEFAULTS.nativePagesEnabled,
		nativeUsersEnabled:
			typeof parsed.nativeUsersEnabled === 'boolean'
				? parsed.nativeUsersEnabled
				: DEFAULTS.nativeUsersEnabled,
		nativePluginsEnabled:
			typeof parsed.nativePluginsEnabled === 'boolean'
				? parsed.nativePluginsEnabled
				: DEFAULTS.nativePluginsEnabled,
		nativeCommentsEnabled:
			typeof parsed.nativeCommentsEnabled === 'boolean'
				? parsed.nativeCommentsEnabled
				: DEFAULTS.nativeCommentsEnabled,
		showDesktopOnWallpaperClick:
			typeof parsed.showDesktopOnWallpaperClick === 'boolean'
				? parsed.showDesktopOnWallpaperClick
				: DEFAULTS.showDesktopOnWallpaperClick,
		showPostStatusRibbons:
			typeof parsed.showPostStatusRibbons === 'boolean'
				? parsed.showPostStatusRibbons
				: DEFAULTS.showPostStatusRibbons,
		foldersSharingEnabled:
			typeof parsed.foldersSharingEnabled === 'boolean'
				? parsed.foldersSharingEnabled
				: DEFAULTS.foldersSharingEnabled,
		itemVisibility: sanitizeItemVisibility( parsed.itemVisibility ),
		dockOrder: sanitizeDockOrder( parsed.dockOrder ),
		dockPromotedPositions: sanitizeDockPromotedPositions(
			parsed.dockPromotedPositions,
		),
	};
}

function sanitizeItemVisibility(
	raw: unknown,
): Record< string, import( './types' ).ItemVisibility > {
	if ( ! raw || typeof raw !== 'object' || Array.isArray( raw ) ) {
		return {};
	}
	const allowed: ReadonlyArray< import( './types' ).ItemVisibility > = [
		'both',
		'dock',
		'desktop',
		'hidden',
	];
	const out: Record< string, import( './types' ).ItemVisibility > = {};
	let count = 0;
	for ( const [ k, v ] of Object.entries( raw as Record< string, unknown > ) ) {
		if ( count >= 256 ) {
			break;
		}
		if ( typeof k !== 'string' || k === '' ) {
			continue;
		}
		if ( typeof v !== 'string' ) {
			continue;
		}
		const placement = v as import( './types' ).ItemVisibility;
		if ( ! allowed.includes( placement ) ) {
			continue;
		}
		out[ k ] = placement;
		count++;
	}
	return out;
}

function sanitizeDockOrder( raw: unknown ): string[] {
	if ( ! Array.isArray( raw ) ) {
		return [];
	}
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

/**
 * Coerce an untrusted `dockPromotedPositions` value into the shape
 * the rest of the bundle expects. Caps at 256 entries; rejects any
 * non-finite or absurdly large coordinate so a corrupted blob can't
 * make the synth-placement positioner blow up.
 */
function sanitizeDockPromotedPositions(
	raw: unknown,
): Record< string, { x: number; y: number } > {
	if ( ! raw || typeof raw !== 'object' || Array.isArray( raw ) ) {
		return {};
	}
	const out: Record< string, { x: number; y: number } > = {};
	let count = 0;
	const MAX_COORD = 100_000; // generous; real screens stop in the thousands
	for ( const [ k, v ] of Object.entries( raw as Record< string, unknown > ) ) {
		if ( count >= 256 ) {
			break;
		}
		if ( typeof k !== 'string' || k === '' ) {
			continue;
		}
		if ( ! v || typeof v !== 'object' || Array.isArray( v ) ) {
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

// -----------------------------------------------------------------------
// Save
// -----------------------------------------------------------------------

/** Pending debounce handle for the REST sync. */
let _syncTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Debounce window in ms before a change is flushed to user meta.
 *
 * Short on purpose: click toggles (the most common pattern) feel
 * instant, while still merging high-frequency input events (slider
 * drags, API-key keystrokes) into a single network request. The
 * earlier 1.5s window made every save feel laggy — the user
 * toggled a setting and stared at an idle title bar for over a
 * second before the modem dot kicked in.
 */
const SYNC_DEBOUNCE_MS = 250;

/**
 * Last state the server confirmed it accepted. Used to roll back
 * the local cache + the in-memory `OsSettings.state` when a save
 * fails (offline, REST 4xx/5xx, nonce expired). On boot, callers
 * should prime this via {@link setLastConfirmedState} with the
 * loaded state — the boot snapshot came from user meta and is by
 * definition confirmed.
 */
let _lastConfirmedState: OsSettingsState | null = null;

/**
 * Prime the rollback baseline. Called once after `loadState()` so
 * the FIRST failed save still has somewhere to roll back to.
 *
 * @since 0.8.0
 */
export function setLastConfirmedState( state: OsSettingsState ): void {
	_lastConfirmedState = _cloneState( state );
}

/**
 * Defensive deep-clone so the baseline doesn't share references
 * with the live state and accidentally mutate when the live state
 * is edited next.
 */
function _cloneState( state: OsSettingsState ): OsSettingsState {
	return {
		...state,
		customGradient: { ...state.customGradient },
		customImage: state.customImage ? { ...state.customImage } : null,
		ai: { ...state.ai, apiKeys: { ...state.ai.apiKeys } },
		nativePostsHiddenColumns: state.nativePostsHiddenColumns.slice(),
		itemVisibility: { ...state.itemVisibility },
		dockOrder: state.dockOrder.slice(),
		dockPromotedPositions: Object.fromEntries(
			Object.entries( state.dockPromotedPositions ).map( ( [ k, v ] ) => [
				k,
				{ ...v },
			] ),
		),
	};
}

/**
 * Persist state to localStorage and schedule a debounced sync to user
 * meta via the REST endpoint.
 *
 * localStorage is written synchronously for instant in-session read-back.
 * The REST call is debounced so rapid changes (dragging sliders, typing
 * an API key) collapse into one network request.
 */
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
		/* Quota or private-mode failure — local cache unavailable. */
	}
}

function _scheduleSyncToServer(
	state: OsSettingsState,
	windowId?: string,
): void {
	if ( _syncTimer !== null ) {
		clearTimeout( _syncTimer );
	}
	// Latest call wins for activity attribution. The user's most
	// recent toggle drives which window's title-bar activity dot
	// blinks during the in-flight POST.
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

function _postToServer( state: OsSettingsState, windowId?: string | null ): void {
	const config = ( window as unknown as {
		desktopModeConfig?: DesktopConfig;
	} ).desktopModeConfig;
	const url = config?.osSettingsUrl;
	const nonce = config?.restNonce;
	if ( ! url || ! nonce ) {
		// No REST endpoint configured — the save lives in localStorage
		// only. Treat as success so optimistic indicators don't hang
		// in "saving" forever; we'll re-sync on the next successful
		// save attempt.
		_emitSaveLifecycle( 'saved' );
		return;
	}

	_emitSaveLifecycle( 'saving' );
	// Prefer `wp.desktop.fetch` so the originating window's title-bar
	// activity dot blinks while the save is in flight. The
	// originating window — passed through from the call site that
	// triggered the most recent debounce-collapsed save — defaults to
	// 'desktop-mode-os-settings' when no caller claimed it. That
	// preserves the original behaviour for saves coming from inside
	// the OS Settings panel itself, while letting any other window
	// (Posts column toggles, future native windows that mutate OS
	// state) attribute their own activity.
	const attributedWindowId = windowId || 'desktop-mode-os-settings';
	trackedFetch(
		url,
		{
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-WP-Nonce': nonce,
			},
			body: JSON.stringify( { settings: state } ),
		},
		{ windowId: attributedWindowId },
	)
		.then( ( res ) => {
			if ( ! res.ok ) {
				throw new Error( `${ res.status } ${ res.statusText }` );
			}
			// Server accepted — promote this state to the rollback
			// baseline. Any subsequent save that fails will revert
			// here, not back to whatever the user typed two minutes
			// ago.
			_lastConfirmedState = _cloneState( state );
			_emitSaveLifecycle( 'saved' );
		} )
		.catch( ( err ) => {
			/* Save failed — REVERT both localStorage and the
			 * in-memory state to the last server-confirmed snapshot,
			 * then surface the failure so the OS Settings panel can
			 * repaint with the rolled-back values.
			 *
			 * The emitted snapshot is a FRESH CLONE of
			 * `_lastConfirmedState`. Without the clone, both
			 * `this.state` (in OsSettings) and the rollback baseline
			 * end up pointing at the same object — the user's next
			 * `ctx.state.X = …` would mutate the baseline, which
			 * means subsequent rollbacks would "restore" the
			 * already-mutated state and silently no-op. Rollback
			 * worked the first time; the second time looked broken.
			 * Cloning at the emit boundary makes each rollback hand
			 * out an independent copy.
			 */
			if ( _lastConfirmedState ) {
				_writeLocalStorage( _lastConfirmedState );
				_emitSaveLifecycle(
					'failed',
					err instanceof Error ? err.message : String( err ),
					_cloneState( _lastConfirmedState ),
				);
			} else {
				_emitSaveLifecycle(
					'failed',
					err instanceof Error ? err.message : String( err ),
				);
			}
		} );
}

/**
 * Save lifecycle phases:
 *
 * - `pending` — a change has been made; the debounced REST sync is
 *   queued (250 ms window).
 * - `saving`  — the REST request is in flight.
 * - `saved`   — the REST request returned OK.
 * - `failed`  — the REST request errored. Detail carries the message.
 *
 * Sections subscribe via the matching CustomEvents to render save
 * status indicators. The `failed` phase carries the
 * server-confirmed `rolledBackTo` snapshot — listeners that own
 * UI keyed off `OsSettingsState` (the OS Settings panel is the
 * canonical example) replace their state with this snapshot and
 * re-render so the controls visually revert to the last-confirmed
 * values, not the optimistic ones the user just attempted.
 *
 * @since 0.8.0
 */
export type OsSettingsSavePhase = 'pending' | 'saving' | 'saved' | 'failed';

export interface OsSettingsSaveLifecycleDetail {
	phase: OsSettingsSavePhase;
	error?: string;
	/**
	 * On the `failed` phase, the last server-confirmed snapshot the
	 * caller should restore to. Absent on success / pending /
	 * saving phases. May also be absent on `failed` when no save
	 * has ever succeeded yet (very rare — only on first-load
	 * failure before a successful baseline exists).
	 */
	rolledBackTo?: OsSettingsState;
}

function _emitSaveLifecycle(
	phase: OsSettingsSavePhase,
	error?: string,
	rolledBackTo?: OsSettingsState | null,
): void {
	const detail: OsSettingsSaveLifecycleDetail = { phase };
	if ( error ) {
		detail.error = error;
	}
	if ( rolledBackTo ) {
		detail.rolledBackTo = rolledBackTo;
	}
	document.dispatchEvent(
		new CustomEvent( 'desktop-mode-os-settings-save-lifecycle', { detail } ),
	);
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
		// Clone the collection fields too. A shallow `...DEFAULTS`
		// aliases these nested objects, so a later in-place mutation
		// (e.g. dragging the gradient editor after a Reset, which spreads
		// these defaults into live state) would corrupt the module-level
		// DEFAULTS singleton for the rest of the session.
		itemVisibility: { ...DEFAULTS.itemVisibility },
		dockOrder: [ ...DEFAULTS.dockOrder ],
		dockPromotedPositions: { ...DEFAULTS.dockPromotedPositions },
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
