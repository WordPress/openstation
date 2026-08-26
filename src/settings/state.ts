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
 */

import type { DesktopConfig } from '../types';
import {
	ADMIN_BAR_MODES,
	CUSTOM_ACCENT_ID,
	DEFAULTS,
	DESKTOP_LAYOUTS,
	DOCK_PLACEMENTS,
	DOCK_SIZES,
	STORAGE_KEY,
	WINDOW_RADII,
	getAccents,
	getDefaultWallpaperId,
} from './constants';
import type {
	AccentId,
	AdminBarModeId,
	AiSettings,
	CustomGradient,
	CustomImage,
	DesktopLayoutId,
	DockPlacementId,
	DockSizeId,
	OsSettingsState,
	WindowRadiusId,
} from './types';
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
		const state = _parseRaw( serverRaw );
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
			return _parseRaw( JSON.parse( cached ) as Partial<OsSettingsState> );
		}
	} catch {
		/* Quota / parse error — fall through to defaults. */
	}

	// 3. Defaults.
	return structuredDefaults();
}

/** Read `openStationConfig.osSettings` from the global config. */
function _readServerSettings(): Partial<OsSettingsState> | null {
	const config = ( window as unknown as {
		openStationConfig?: DesktopConfig;
	} ).openStationConfig;
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
		// `custom` is a valid selection that is deliberately absent from
		// the preset list, so it has to be allowed explicitly or a saved
		// custom accent would be discarded as unknown on every load.
		accent:
			parsed.accent === CUSTOM_ACCENT_ID ||
			accents.some( ( a ) => a.id === parsed.accent )
				? ( parsed.accent as AccentId )
				: DEFAULTS.accent,
		// Untrusted input painted straight into a CSS custom property,
		// so it is validated as a hex triplet rather than merely
		// type-checked as a string.
		customAccent:
			typeof parsed.customAccent === 'string' &&
			/^#[0-9a-fA-F]{6}$/.test( parsed.customAccent )
				? parsed.customAccent
				: DEFAULTS.customAccent,
		dockSize: DOCK_SIZES.some( ( d ) => d.id === parsed.dockSize )
			? ( parsed.dockSize as DockSizeId )
			: DEFAULTS.dockSize,
		windowRadius: WINDOW_RADII.some( ( r ) => r.id === parsed.windowRadius )
			? ( parsed.windowRadius as WindowRadiusId )
			: DEFAULTS.windowRadius,
		adminBarMode: ADMIN_BAR_MODES.some(
			( m ) => m.id === parsed.adminBarMode,
		)
			? ( parsed.adminBarMode as AdminBarModeId )
			: DEFAULTS.adminBarMode,
		desktopLayout: DESKTOP_LAYOUTS.some(
			( l ) => l.id === parsed.desktopLayout,
		)
			? ( parsed.desktopLayout as DesktopLayoutId )
			: DEFAULTS.desktopLayout,
		dockPlacement: DOCK_PLACEMENTS.some(
			( p ) => p.id === parsed.dockPlacement,
		)
			? ( parsed.dockPlacement as DockPlacementId )
			: DEFAULTS.dockPlacement,
		// Dock rail renderer — any sanitize_key()-clean string
		// survives; the registry resolves at use time and falls back
		// to `'default'` when the picked renderer isn't registered.
		dockRailRenderer:
			typeof parsed.dockRailRenderer === 'string' &&
			/^[a-z0-9_-]+$/.test( parsed.dockRailRenderer )
				? parsed.dockRailRenderer
				: DEFAULTS.dockRailRenderer,
		// Desktop theme — mirrors the PHP sanitizer exactly: a
		// `sanitize_key()`-clean slug, or the empty string for the
		// system default. Note the `*` quantifier (not `+`): unlike
		// every other id field here, EMPTY IS A REAL VALUE, and a `+`
		// would silently rewrite "System default" to whatever the
		// default happened to be.
		desktopTheme:
			typeof parsed.desktopTheme === 'string' &&
			/^[a-z0-9_-]*$/.test( parsed.desktopTheme )
				? parsed.desktopTheme
				: DEFAULTS.desktopTheme,
		// Seeded-theme ledger — `sanitize_key()`-clean slugs, capped at
		// the most recent 64 (the same end PHP trims from; the writer
		// appends, so keeping the head would discard the entry just
		// written and re-arm that theme's one-time seed). Slugs of
		// themes that are no longer installed survive on purpose:
		// forgetting one would let a reinstall re-seed over settings
		// the user has since chosen.
		appliedThemeRecommendations: Array.isArray(
			parsed.appliedThemeRecommendations,
		)
			? Array.from(
				new Set(
					parsed.appliedThemeRecommendations.filter(
						( v ): v is string =>
							typeof v === 'string' && /^[a-z0-9_-]+$/.test( v ),
					),
				),
			).slice( -64 )
			: DEFAULTS.appliedThemeRecommendations.slice(),
		// Unfocus effect — any registry id (`vendor/sub-id` allowed) or
		// the `'none'` sentinel survives; the engine resolves at use
		// time and treats an unknown id as "no effect".
		unfocusEffect:
			typeof parsed.unfocusEffect === 'string' &&
			/^[a-z0-9_/-]+$/.test( parsed.unfocusEffect )
				? parsed.unfocusEffect
				: DEFAULTS.unfocusEffect,
		// Window reveal — same id charset as unfocus effects; the
		// surface resolves at play time and treats an unknown id as
		// "no reveal".
		windowReveal:
			typeof parsed.windowReveal === 'string' &&
			/^[a-z0-9_/-]+$/.test( parsed.windowReveal )
				? parsed.windowReveal
				: DEFAULTS.windowReveal,
		// Reveal duration override — 0 (or anything out of range) means
		// "use each reveal's own timing"; the surface clamps the rest.
		windowRevealDuration:
			typeof parsed.windowRevealDuration === 'number' &&
			Number.isFinite( parsed.windowRevealDuration ) &&
			parsed.windowRevealDuration > 0
				? Math.min( 4000, Math.max( 80, Math.round( parsed.windowRevealDuration ) ) )
				: DEFAULTS.windowRevealDuration,
		// Window-link renderer — same id charset as unfocus effects;
		// the render host resolves at use time and falls back to the
		// built-in `svg-splines` for unknown ids.
		windowLinkRenderer:
			typeof parsed.windowLinkRenderer === 'string' &&
			/^[a-z0-9_/-]+$/.test( parsed.windowLinkRenderer )
				? parsed.windowLinkRenderer
				: DEFAULTS.windowLinkRenderer,
		windowLinkVisibility:
			parsed.windowLinkVisibility === 'focus' ||
			parsed.windowLinkVisibility === 'always' ||
			parsed.windowLinkVisibility === 'off'
				? parsed.windowLinkVisibility
				: DEFAULTS.windowLinkVisibility,
		windowLinksEnabled:
			typeof parsed.windowLinksEnabled === 'boolean'
				? parsed.windowLinksEnabled
				: DEFAULTS.windowLinksEnabled,
		windowLinkRaiseOnFocus:
			typeof parsed.windowLinkRaiseOnFocus === 'boolean'
				? parsed.windowLinkRaiseOnFocus
				: DEFAULTS.windowLinkRaiseOnFocus,
		windowLinkHighlight:
			typeof parsed.windowLinkHighlight === 'boolean'
				? parsed.windowLinkHighlight
				: DEFAULTS.windowLinkHighlight,
		customGradient: sanitizeCustomGradient( parsed.customGradient ),
		customImage: sanitizeCustomImage( parsed.customImage ),
		wallpaperSettings: sanitizeWallpaperSettings( parsed.wallpaperSettings ),
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
		stationHomeEnabled:
			typeof parsed.stationHomeEnabled === 'boolean'
				? parsed.stationHomeEnabled
				: DEFAULTS.stationHomeEnabled,
		adminAssetCacheEnabled:
			typeof parsed.adminAssetCacheEnabled === 'boolean'
				? parsed.adminAssetCacheEnabled
				: DEFAULTS.adminAssetCacheEnabled,
		windowPrewarmEnabled:
			typeof parsed.windowPrewarmEnabled === 'boolean'
				? parsed.windowPrewarmEnabled
				: DEFAULTS.windowPrewarmEnabled,
		showDesktopOnWallpaperClick:
			typeof parsed.showDesktopOnWallpaperClick === 'boolean'
				? parsed.showDesktopOnWallpaperClick
				: DEFAULTS.showDesktopOnWallpaperClick,
		mioEnabled:
			typeof parsed.mioEnabled === 'boolean'
				? parsed.mioEnabled
				: DEFAULTS.mioEnabled,
		// Shape check only — what a *legal* hue or silhouette is stays
		// `sanitizeMioConfig`'s call, and it runs on everything headed
		// for the simulation whatever route it arrived by.
		mioStyle: sanitizeMioLook( parsed.mioStyle ),
		showPostStatusRibbons:
			typeof parsed.showPostStatusRibbons === 'boolean'
				? parsed.showPostStatusRibbons
				: DEFAULTS.showPostStatusRibbons,
		developerModeEnabled:
			typeof parsed.developerModeEnabled === 'boolean'
				? parsed.developerModeEnabled
				: DEFAULTS.developerModeEnabled,
		foldersSharingEnabled:
			typeof parsed.foldersSharingEnabled === 'boolean'
				? parsed.foldersSharingEnabled
				: DEFAULTS.foldersSharingEnabled,
		navPlacement: sanitizeNavPlacement( parsed.navPlacement ),
		navOrder: sanitizeNavOrder( parsed.navOrder ),
		dockPromotedPositions: sanitizeDockPromotedPositions(
			parsed.dockPromotedPositions,
		),
	};
}

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
	if ( ! raw || typeof raw !== 'object' || Array.isArray( raw ) ) {
		return {};
	}
	const out: Record<
		string,
		Record< string, string | number | boolean >
	> = {};
	let idCount = 0;
	for ( const [ id, bag ] of Object.entries(
		raw as Record< string, unknown >,
	) ) {
		if ( idCount >= 64 ) {
			break;
		}
		if (
			typeof id !== 'string' ||
			id === '' ||
			! /^[a-z0-9_/-]+$/.test( id )
		) {
			continue;
		}
		if ( ! bag || typeof bag !== 'object' || Array.isArray( bag ) ) {
			continue;
		}
		const clean: Record< string, string | number | boolean > = {};
		let keyCount = 0;
		for ( const [ key, value ] of Object.entries(
			bag as Record< string, unknown >,
		) ) {
			if ( keyCount >= 32 ) {
				break;
			}
			if (
				typeof key !== 'string' ||
				key === '' ||
				! /^[a-zA-Z0-9_-]+$/.test( key )
			) {
				continue;
			}
			if ( typeof value === 'boolean' ) {
				clean[ key ] = value;
			} else if (
				typeof value === 'number' &&
				Number.isFinite( value )
			) {
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

function sanitizeNavPlacement(
	raw: unknown,
): Record< string, import( '../nav/types' ).NavPlacement > {
	if ( ! raw || typeof raw !== 'object' || Array.isArray( raw ) ) {
		return {};
	}
	const allowed: ReadonlyArray<
		import( '../nav/types' ).NavPlacement
	> = [ 'both', 'rail', 'desktop', 'hidden' ];
	const out: Record<
		string,
		import( '../nav/types' ).NavPlacement
	> = {};
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
		const placement = v as import( '../nav/types' ).NavPlacement;
		if ( ! allowed.includes( placement ) ) {
			continue;
		}
		out[ k ] = placement;
		count++;
	}
	return out;
}

function sanitizeNavOrder( raw: unknown ): string[] {
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

function _postToServer( state: OsSettingsState, windowId?: string | null ): void {
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
	// Prefer `wp.os.fetch` so the originating window's title-bar
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
			// The FULL state is promoted even though only the diff
			// was sent: the fields left out are the ones this
			// session never touched, and its record of them is
			// exactly what must not be posted again.
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
	return {
		...DEFAULTS,
		customGradient: { ...DEFAULTS.customGradient },
		customImage: null,
		wallpaperSettings: { ...DEFAULTS.wallpaperSettings },
		ai: { ...DEFAULTS.ai },
		// Clone the collection fields too. A shallow `...DEFAULTS`
		// aliases these nested objects, so a later in-place mutation
		// (e.g. dragging the gradient editor after a Reset, which spreads
		// these defaults into live state) would corrupt the module-level
		// DEFAULTS singleton for the rest of the session.
		//
		// These are one-level clones, which is sufficient *because* all
		// three defaults are empty (`{}` / `[]`) — there are no inner
		// objects to share. If `DEFAULTS.dockPromotedPositions` ever
		// ships seeded entries, its `{ x, y }` values would need a
		// deeper clone here.
		appliedThemeRecommendations: [ ...DEFAULTS.appliedThemeRecommendations ],
		navPlacement: { ...DEFAULTS.navPlacement },
		navOrder: [ ...DEFAULTS.navOrder ],
		dockPromotedPositions: { ...DEFAULTS.dockPromotedPositions },
	};
}

export function sanitizeAi( raw: unknown ): AiSettings {
	if ( ! raw || typeof raw !== 'object' ) {
		return { ...DEFAULTS.ai };
	}
	const { enabled } = raw as Partial< AiSettings >;
	return {
		enabled: typeof enabled === 'boolean' ? enabled : DEFAULTS.ai.enabled,
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
