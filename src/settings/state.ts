/**
 * Persistence + sanitization for `OsSettingsState`.
 *
 * Source-of-truth hierarchy (highest to lowest):
 *   1. Server — `openStationConfig.osSettings` loaded from user meta at
 *      page boot. Wins over localStorage so a setting changed on another
 *      device/browser is honoured on the next page load.
 *   2. localStorage — fast local cache; written on every change for
 *      instant subsequent reads within the same session.
 *   3. Defaults — compile-time fallback when both are absent.
 *
 * Writes:
 *   - localStorage: synchronous, every `saveState()` call. Always the
 *     complete state — it's this session's cache of its own view.
 *   - User meta (REST): debounced 250 ms after the last change via
 *     `_scheduleSyncToServer()`. The JS layer fires `saveState()` on every
 *     preference change so the debounce collapse rapid edits (e.g. dragging
 *     the gradient angle slider) into a single network request. Only the
 *     fields that actually changed are sent — see `_buildPayload()`.
 *
 * Sanitization is ONE table, {@link SANITIZERS}: a coercion per key,
 * each taking the raw value and a fallback. The same table reads a
 * whole snapshot out of user meta (fallback = the shipped defaults)
 * and admits a partial patch from the public API (fallback = the
 * current value, so an invalid field is ignored rather than reset).
 * Two callers, one set of rules — a key that is valid on load is valid
 * on write, and a key added here is writable everywhere at once.
 */

import type { DesktopConfig } from '../types';
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

// -----------------------------------------------------------------------
// Load
// -----------------------------------------------------------------------

/**
 * Resolves the initial state. Prefers the server-provided snapshot
 * (`openStationConfig.osSettings`) over the localStorage cache so a
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
		const state = sanitizeSettings( serverRaw, liveDefaults() );
		// Prime the local cache so mid-session reads don't re-parse JSON.
		_writeLocalStorage( state );
		// This branch — and only this branch — read the state out of
		// user meta, so it is the only one that may claim the server
		// has agreed to it. See `setLastConfirmedState()` for what
		// goes wrong when the other two make that claim.
		setLastConfirmedState( state );
		return state;
	}

	// 2. localStorage cache.
	try {
		const cached = window.localStorage.getItem( STORAGE_KEY );
		if ( cached ) {
			return sanitizeSettings(
				JSON.parse( cached ) as Partial< OsSettingsState >,
				liveDefaults(),
			);
		}
	} catch {
		/* Quota / parse error — fall through to defaults. */
	}

	// 3. Defaults.
	return liveDefaults();
}

/**
 * The shipped defaults, with the one value PHP decides at runtime:
 * the default wallpaper comes from `openstation_default_wallpaper`,
 * not from the compile-time constant.
 */
function liveDefaults(): OsSettingsState {
	const defaults = structuredDefaults();
	defaults.wallpaper = getDefaultWallpaperId();
	return defaults;
}

/** Read `openStationConfig.osSettings` from the global config. */
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

// -----------------------------------------------------------------------
// Sanitize
// -----------------------------------------------------------------------

type Sanitizer< T > = ( raw: unknown, fallback: T ) => T;

type Sanitizers = {
	[ K in keyof OsSettingsState ]: Sanitizer< OsSettingsState[ K ] >;
};

const isObject = ( raw: unknown ): raw is Record< string, unknown > =>
	!! raw && typeof raw === 'object' && ! Array.isArray( raw );

const bool: Sanitizer< boolean > = ( raw, fallback ) =>
	typeof raw === 'boolean' ? raw : fallback;

/** One of a fixed option list, by `id`. */
const oneOf =
	< T extends string >( list: ReadonlyArray< { id: T } > ): Sanitizer< T > =>
		( raw, fallback ) =>
			list.some( ( option ) => option.id === raw ) ? ( raw as T ) : fallback;

/** A string matching a charset. */
const matching =
	( pattern: RegExp ): Sanitizer< string > =>
		( raw, fallback ) =>
			typeof raw === 'string' && pattern.test( raw ) ? raw : fallback;

/**
 * Registry ids: `vendor/sub-id` slashes allowed, mirroring the PHP
 * sanitizer, which lower-cases and strips to this charset rather than
 * `sanitize_key()` (that would drop the slash and break a namespaced
 * id on round-trip). No allow-list: each engine resolves at use time
 * and treats an unknown id as "none".
 */
const REGISTRY_ID = /^[a-z0-9_/-]+$/;

/**
 * The coercion for every key. Order follows `OsSettingsState`.
 *
 * A sanitizer returns the FALLBACK for a value it rejects. On load the
 * fallback is the shipped default; on a public-API patch it is the
 * current value — which is what makes a rejected field a no-op rather
 * than a reset, and why the table takes the fallback as an argument
 * instead of reading `DEFAULTS` itself.
 */
const SANITIZERS: Sanitizers = {
	wallpaper: ( raw, fallback ) =>
		typeof raw === 'string' && raw !== '' ? raw : fallback,
	// `custom` is a valid selection that is deliberately absent from
	// the preset list, so it has to be allowed explicitly or a saved
	// custom accent would be discarded as unknown on every load.
	accent: ( raw, fallback ) =>
		raw === CUSTOM_ACCENT_ID || getAccents().some( ( a ) => a.id === raw )
			? ( raw as string )
			: fallback,
	// Untrusted input painted straight into a CSS custom property, so
	// it is validated as a hex triplet rather than merely type-checked.
	customAccent: matching( /^#[0-9a-fA-F]{6}$/ ),
	dockSize: oneOf( DOCK_SIZES ),
	windowRadius: oneOf( WINDOW_RADII ),
	adminBarMode: oneOf( ADMIN_BAR_MODES ),
	desktopLayout: oneOf( DESKTOP_LAYOUTS ),
	dockPlacement: oneOf( DOCK_PLACEMENTS ),
	dockBehavior: oneOf( DOCK_BEHAVIORS ),
	sideDockBehavior: oneOf( DOCK_BEHAVIORS ),
	// Any sanitize_key()-clean string survives; the registry resolves
	// at use time and falls back to `'default'` when unregistered.
	dockRailRenderer: matching( /^[a-z0-9_-]+$/ ),
	// Mirrors the PHP sanitizer exactly: a `sanitize_key()`-clean slug,
	// or the empty string for the system default. Note the `*`
	// quantifier: unlike every other id here, EMPTY IS A REAL VALUE.
	desktopTheme: matching( /^[a-z0-9_-]*$/ ),
	// The seeded-theme ledger — `sanitize_key()`-clean slugs, capped at
	// the most recent 64 (the same end PHP trims from; the writer
	// appends, so keeping the head would discard the entry just written
	// and re-arm that theme's one-time seed). Slugs of themes that are
	// no longer installed survive on purpose: forgetting one would let
	// a reinstall re-seed over settings the user has since chosen.
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
	// 0 (or anything out of range) means "use each reveal's own
	// timing"; the surface clamps the rest.
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
	// `null` is a real value — "no image" — not a rejected one.
	customImage: ( raw, fallback ) =>
		raw === null || isObject( raw ) ? sanitizeCustomImage( raw ) : fallback,
	wallpaperSettings: ( raw, fallback ) =>
		isObject( raw ) ? sanitizeWallpaperSettings( raw ) : fallback,
	libraryHdOnly: bool,
	ai: ( raw, fallback ) => sanitizeAi( raw, fallback ),
	heartbeatRate: ( raw, fallback ) =>
		raw === 15 || raw === 30 || raw === 45 || raw === 60 ? raw : fallback,
	nativePostsEnabled: bool,
	// Cap to a sane upper bound so a corrupted server payload can't
	// memory-bloat the cell. 32 is far more than any plausible count.
	nativePostsHiddenColumns: ( raw, fallback ) =>
		Array.isArray( raw )
			? raw
				.filter( ( v ): v is string => typeof v === 'string' && v !== '' )
				.slice( 0, 32 )
			: fallback.slice(),
	nativePagesEnabled: bool,
	nativeUsersEnabled: bool,
	nativePluginsEnabled: bool,
	nativeCommentsEnabled: bool,
	stationHomeEnabled: bool,
	adminAssetCacheEnabled: bool,
	windowPrewarmEnabled: bool,
	showDesktopOnWallpaperClick: bool,
	confirmCloseAllWindows: bool,
	mioEnabled: bool,
	// Shape check only — what a *legal* hue or silhouette is stays
	// `sanitizeMioConfig`'s call, and it runs on everything headed for
	// the simulation whatever route it arrived by.
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

/** Every key of the state, in schema order. */
export const OS_SETTINGS_KEYS = Object.keys( SANITIZERS ) as Array<
	keyof OsSettingsState
>;

/**
 * Coerce an untrusted shape over a base state.
 *
 * Keys absent from `raw` keep the base value; keys present are run
 * through their sanitizer with the base value as the fallback. Load
 * calls this with the defaults as the base; a public-API patch calls
 * it with the current state, so an invalid value is ignored and an
 * unknown key never lands.
 */
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
	return out as unknown as OsSettingsState;
}

/**
 * Keys whose change has to be PAINTED, not just saved — the ones
 * `OsSettings.apply()` reads. A patch that touches none of them skips
 * the apply pass: `unfocusEffect`, `windowReveal` and the window-link
 * knobs reach their engines through `subscribeOsSettings` instead,
 * and every other key is state-only.
 */
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

/**
 * Coerce an untrusted `wallpaperSettings` value into per-wallpaper
 * scalar bags. Non-scalar values are dropped; ids follow the
 * wallpaper-id charset (`vendor/sub-id` slashes allowed, mirroring
 * the unfocus-effect ids); keys follow the JS identifier-ish charset
 * wallpaper authors use (`camelCase`, hyphens, underscores). Capped
 * at 64 wallpapers × 32 keys with 256-char string values so a
 * corrupted server payload can't bloat the cell.
 */
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

/**
 * Coerce an untrusted `dockPromotedPositions` value into the shape
 * the rest of the bundle expects. Caps at 256 entries; rejects any
 * non-finite or absurdly large coordinate so a corrupted blob can't
 * make the synth-placement positioner blow up.
 */
function sanitizeDockPromotedPositions(
	raw: Record< string, unknown >,
): Record< string, { x: number; y: number } > {
	const out: Record< string, { x: number; y: number } > = {};
	let count = 0;
	const MAX_COORD = 100_000; // generous; real screens stop in the thousands
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

// -----------------------------------------------------------------------
// Save
// -----------------------------------------------------------------------

/** Pending debounce handle for the REST sync. */
let _syncTimer: ReturnType< typeof setTimeout > | null = null;

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
 * Last state the server confirmed it accepted. Two jobs:
 *
 *   1. Roll back the local cache + the in-memory `OsSettings.state`
 *      when a save fails (offline, REST 4xx/5xx, nonce expired).
 *   2. Serve as the baseline `_buildPayload()` diffs against, which
 *      decides what a save is allowed to say anything about.
 *
 * Job 2 is why this must only ever hold state the server really did
 * accept. `loadState()` primes it from the server snapshot and from
 * nothing else: the localStorage cache can hold values a previous
 * session never got as far as saving, and treating those as
 * confirmed would mean never sending them — a field silently stuck
 * locally, which is a quieter version of the bug the diff exists to
 * fix. Left unprimed, the first save posts the full snapshot and the
 * divergence heals itself.
 */
let _lastConfirmedState: OsSettingsState | null = null;

/**
 * Prime the rollback + diff baseline. `loadState()` calls this on
 * the server-snapshot path so the FIRST failed save already has
 * somewhere to roll back to. Exported for tests and for any caller
 * that has genuinely server-confirmed state in hand — do not call it
 * with values the server hasn't accepted.
 */
export function setLastConfirmedState( state: OsSettingsState ): void {
	_lastConfirmedState = cloneState( state );
}

/**
 * Deep-clone a state so a copy never shares references with the live
 * object and cannot be mutated through it — the rollback baseline, the
 * public snapshot, and the sanitizer's working copy all rely on it.
 */
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

/**
 * Build the REST payload: only the top-level fields whose value
 * differs from the last state the server confirmed.
 *
 * Sending the complete snapshot is what let two open sessions
 * overwrite each other. Session B boots, session A changes the
 * wallpaper, then B changes only its accent — and B's POST carried
 * its own stale wallpaper alongside the accent, silently undoing A.
 * A payload built from the diff cannot do that: B never touched the
 * wallpaper, so the key is absent, and the server keeps whatever it
 * holds. (The route merges partial payloads over stored values;
 * see `openstation_rest_save_os_settings()`.)
 *
 * The baseline is deliberately what THIS session last agreed with
 * the server about, not the server's current truth. Diffing against
 * fresh server state would re-introduce the bug from the other
 * side: B would notice A's wallpaper differs from its own stale
 * copy, treat that as a local change, and post the old value back.
 *
 * Comparison is by serialization, which is exact for the shapes
 * here and errs the safe way — a key that only *looks* changed
 * (rebuilt object, different insertion order) is simply sent, which
 * is what every save did before.
 *
 * @param state Live state to persist.
 * @return The fields to send, or `null` when nothing changed.
 */
function _buildPayload(
	state: OsSettingsState,
): Partial< OsSettingsState > | null {
	// No baseline (boot priming skipped) — nothing to diff against,
	// so fall back to the full snapshot.
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
		// Assigned through `Object.assign` because indexing a
		// `Partial<T>` with a union key isn't assignable in TS.
		Object.assign( payload, { [ key ]: state[ key ] } );
		changed = true;
	}
	return changed ? payload : null;
}

/**
 * Whether a save is in flight, and the newest state waiting behind it.
 *
 * **Saves must not overlap.** `_buildPayload()` diffs against
 * `_lastConfirmedState`, which only advances when a response comes
 * back. Two changes a few hundred milliseconds apart — far enough apart
 * to survive the debounce, close enough that the first is still in
 * flight — therefore both diff against the same stale baseline, and the
 * server keeps whichever response happens to land last. Measured: set
 * `dockSize: large`, then `windowRadius: sharp` 400 ms later; the
 * lifecycle reported pending → saving → pending → saved → saved and the
 * local snapshot held both, while user meta ended with `dockSize:
 * large, windowRadius: round`. The second change was reported saved and
 * was not.
 *
 * Queuing one request behind the other fixes it at the root: the
 * follow-up diffs against a baseline the first save has already
 * confirmed, and lands after it. Only the NEWEST queued state is kept —
 * an intermediate snapshot that was never sent has nothing to
 * contribute, since each payload is a diff against the confirmed
 * baseline rather than a delta on the one before it.
 */
let _saveInFlight = false;
let _queuedSave: { state: OsSettingsState; windowId?: string | null } | null =
	null;

function _postToServer( state: OsSettingsState, windowId?: string | null ): void {
	if ( _saveInFlight ) {
		_queuedSave = { state, windowId };
		// Still pending from the user's point of view: their change is
		// real, in localStorage, and about to be sent.
		_emitSaveLifecycle( 'pending' );
		return;
	}
	const config = ( window as unknown as {
		openStationConfig?: DesktopConfig;
	} ).openStationConfig;
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

	const payload = _buildPayload( state );
	if ( ! payload ) {
		// Nothing moved since the last confirmed save. Skipping the
		// request keeps a re-render or a set-to-the-same-value from
		// costing a round trip, and — more importantly — from being
		// one more chance to post a stale field.
		_emitSaveLifecycle( 'saved' );
		return;
	}

	_emitSaveLifecycle( 'saving' );
	_saveInFlight = true;
	// Snapshot what this request actually represents, now.
	//
	// `state` is the live settings object and callers mutate it in
	// place, so by the time the response lands it may already carry
	// changes this payload never included. Promoting the live object
	// as the confirmed baseline would then mark those unsent fields
	// as agreed with the server, and the next diff would find nothing
	// to send — the change would be silently dropped rather than
	// saved.
	const sentSnapshot = cloneState( state );
	// Prefer `wp.os.fetch` so the originating window's title-bar
	// activity dot blinks while the save is in flight. The
	// originating window — passed through from the call site that
	// triggered the most recent debounce-collapsed save — defaults to
	// OpenStation Preferences when no caller claimed it. That
	// preserves the original behaviour for saves coming from inside
	// the Preferences app itself, while letting any other window
	// (Posts column toggles, future native windows that mutate OS
	// state) attribute their own activity.
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
		.then( ( res ) => {
			if ( ! res.ok ) {
				throw new Error( `${ res.status } ${ res.statusText }` );
			}
			// Server accepted — promote this state to the rollback
			// baseline. Any subsequent save that fails will revert
			// here, not back to whatever the user typed two minutes
			// ago.
			//
			// The full snapshot AS SENT is promoted even though only
			// the diff travelled: the fields left out are the ones
			// this session never touched, and its record of them is
			// exactly what must not be posted again. Taken at
			// request time, not here — see `sentSnapshot`.
			_lastConfirmedState = sentSnapshot;
			_emitSaveLifecycle( 'saved' );
		} )
		.catch( ( err ) => {
			/* Save failed — REVERT both localStorage and the
			 * in-memory state to the last server-confirmed snapshot,
			 * then surface the failure so the Preferences app can
			 * repaint with the rolled-back values.
			 *
			 * The emitted snapshot is a FRESH CLONE of
			 * `_lastConfirmedState`. Without the clone, both
			 * `this.state` (in OsSettings) and the rollback baseline
			 * end up pointing at the same object — the user's next
			 * write would mutate the baseline, which means subsequent
			 * rollbacks would "restore" the already-mutated state and
			 * silently no-op. Rollback worked the first time; the
			 * second time looked broken. Cloning at the emit boundary
			 * makes each rollback hand out an independent copy.
			 */
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
			// Release whatever queued up behind this one. It diffs
			// against the baseline this response just confirmed, so it
			// carries only what actually changed since — and it cannot
			// race the request it was waiting for.
			//
			// After a FAILED save the queued state is dropped: the
			// failure path has already rolled state and localStorage
			// back to `_lastConfirmedState` and told listeners to
			// repaint, so sending the superseded snapshot would post
			// values the user has just been shown as reverted.
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

/** Set by the catch above so `finally` can tell how the save ended. */
let _saveFailed = false;

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
 * UI keyed off `OsSettingsState` (the Preferences app is the
 * canonical example) replace their state with this snapshot and
 * re-render so the controls visually revert to the last-confirmed
 * values, not the optimistic ones the user just attempted.
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
		new CustomEvent( 'os-settings-save-lifecycle', { detail } ),
	);
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

export function structuredDefaults(): OsSettingsState {
	// A deep clone, so a reset (or a boot from defaults) can never
	// alias — and later corrupt — the module-level DEFAULTS singleton
	// through an in-place edit of a nested object.
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
