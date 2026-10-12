/**
 * Recommended OS settings — the shell-side mirror of PHP's
 * `openstation_desktop_theme_recommended_os_settings_schema()`.
 *
 * Two responsibilities, and they are deliberately separate:
 *
 *   - {@link sanitizeRecommendedOsSettings} is PURE. It knows the
 *     closed enums and nothing else, so it can run inside
 *     `normalizeEntry()` on the payload-parsing hot path without
 *     dragging a registry into the leaf module.
 *   - {@link resolveRecommendedOsSettings} adds the one check that
 *     needs the live world: a `dockRailRenderer` id only means
 *     something if a renderer is registered under it. An unresolvable
 *     id is dropped rather than written into user meta, where it would
 *     sit forever looking like a deliberate choice.
 *
 * Keep the enums equal to `DOCK_SIZES` / `DESKTOP_LAYOUTS` /
 * `WINDOW_RADII` / `ADMIN_BAR_MODES` in `src/settings/constants.ts`
 * and to the `OPENSTATION_OS_SETTINGS_*` constants in
 * `includes/os-settings.php`.
 * They are duplicated rather than imported because this module is a
 * leaf of the always-on shell bundle and must not pull the settings
 * module in behind it.
 */

import { get as getDockRailRenderer } from '../dock-rail/registry';
import { hasWindowReveal, WINDOW_REVEAL_NONE } from '../reveals/registry';
// The one import from the settings module, and a deliberate exception
// to the note above: `constants.ts` is itself a leaf — everything it
// imports is type-only — so this pulls in the accent list and nothing
// else. Duplicating the swatch ids here would defeat the point, since
// the list is filterable and the whole check is "does the site still
// offer this one?".
import { CUSTOM_ACCENT_ID, getAccents } from '../settings/constants';
import { get as getWallpaper } from '../wallpapers/registry';
import { get as getWidget } from '../widgets/registry';
import type { RecommendedOsSettings } from './types';

/** Closed enums, keyed by the OS-settings field they belong to. */
const ENUMS: Record< string, readonly string[] > = {
	dockSize: [ 'compact', 'default', 'large' ],
	desktopLayout: [ 'classic', 'unified' ],
	dockPlacement: [ 'bottom', 'left', 'right' ],
	windowRadius: [ 'sharp', 'default', 'round' ],
	adminBarMode: [ 'static', 'dynamic', 'hidden' ],
};

/** Fields whose validity is a runtime registry lookup, not an enum. */
const SLUG_FIELDS = [
	'dockRailRenderer',
	'windowReveal',
	'accent',
	'wallpaper',
] as const;

/** Mirrors `OPENSTATION_DESKTOP_THEME_WALLPAPER_PREFIX`. */
const THEME_WALLPAPER_PREFIX = 'desktop-theme/';

/**
 * Numeric fields, with the range the sanitizer clamps into. Mirrors
 * the `int` grammar in
 * `openstation_desktop_theme_recommended_os_settings_schema()`.
 *
 * Values are clamped rather than dropped: a theme asking for a reveal
 * slower than the shell will play is expressing "slow", and the honest
 * reading of that is the slowest we do play.
 */
const INT_FIELDS: Record< string, { min: number; max: number } > = {
	windowRevealDuration: { min: 80, max: 4000 },
};

/** Slug charset — mirrors PHP's `sanitize_key()`. */
const SLUG_PATTERN = /^[a-z0-9_-]+$/;

/** Colour fields: six-digit hex, the shape the custom accent stores. */
const HEX_FIELDS = [ 'accentColor' ] as const;
const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

/**
 * Maps of ids to a closed set, merged into the user's own map at apply
 * time. Mirrors the `map` grammar.
 */
const MAP_FIELDS: Record< string, readonly string[] > = {
	navPlacement: [ 'rail', 'desktop', 'both', 'hidden' ],
};

/** Lists of registry ids. Mirrors the `ids` grammar. */
const LIST_FIELDS = [ 'widgets' ] as const;

/** Registry ids may be namespaced, so the slash is allowed. */
const ID_PATTERN = /^[A-Za-z0-9_/-]{1,128}$/;

/**
 * Every OS-settings key a theme may recommend, in a stable order.
 * Exported so a UI can describe what an "Apply recommended layout and
 * effects" action is about to touch.
 *
 * @public
 */
export const RECOMMENDED_OS_SETTINGS_KEYS: readonly string[] = [
	...Object.keys( ENUMS ),
	...SLUG_FIELDS,
	...HEX_FIELDS,
	...Object.keys( INT_FIELDS ),
	...Object.keys( MAP_FIELDS ),
	...LIST_FIELDS,
];

/**
 * Coerce an untrusted `recommendedOsSettings` blob into the shape the
 * shell will act on. Unknown keys and out-of-enum values drop; the
 * result is always an object.
 *
 * @internal
 */
export function sanitizeRecommendedOsSettings(
	raw: unknown,
): RecommendedOsSettings {
	if ( ! raw || typeof raw !== 'object' || Array.isArray( raw ) ) {
		return {};
	}
	const source = raw as Record< string, unknown >;
	const out: Record< string, string > = {};
	const ints: Record< string, number > = {};

	for ( const [ key, allowed ] of Object.entries( ENUMS ) ) {
		const value = source[ key ];
		if ( typeof value === 'string' && allowed.includes( value ) ) {
			out[ key ] = value;
		}
	}
	for ( const key of SLUG_FIELDS ) {
		const value = source[ key ];
		if ( typeof value === 'string' && SLUG_PATTERN.test( value ) ) {
			out[ key ] = value;
		}
	}
	for ( const key of HEX_FIELDS ) {
		const value = source[ key ];
		if ( typeof value === 'string' && HEX_PATTERN.test( value ) ) {
			out[ key ] = value.toLowerCase();
		}
	}
	for ( const [ key, range ] of Object.entries( INT_FIELDS ) ) {
		const value = source[ key ];
		if ( typeof value === 'number' && Number.isFinite( value ) ) {
			ints[ key ] = Math.min(
				range.max,
				Math.max( range.min, Math.round( value ) ),
			);
		}
	}

	const maps: Record< string, Record< string, string > > = {};
	for ( const [ key, allowed ] of Object.entries( MAP_FIELDS ) ) {
		const value = source[ key ];
		if ( ! value || typeof value !== 'object' || Array.isArray( value ) ) {
			continue;
		}
		const map: Record< string, string > = {};
		for ( const [ id, placement ] of Object.entries( value ) ) {
			if ( SLUG_PATTERN.test( id ) && typeof placement === 'string' && allowed.includes( placement ) ) {
				map[ id ] = placement;
			}
		}
		if ( Object.keys( map ).length > 0 ) {
			maps[ key ] = map;
		}
	}
	const lists: Record< string, string[] > = {};
	for ( const key of LIST_FIELDS ) {
		const value = source[ key ];
		if ( Array.isArray( value ) ) {
			lists[ key ] = [ ...new Set( value.filter(
				( id ): id is string => typeof id === 'string' && ID_PATTERN.test( id ),
			) ) ];
		}
	}

	return { ...out, ...ints, ...maps, ...lists } as RecommendedOsSettings;
}

/**
 * The subset of a theme's recommendations that is actually applicable
 * right now.
 *
 * Differs from {@link sanitizeRecommendedOsSettings} only in dropping
 * registry ids nothing answers to — a theme that recommends a dock
 * rail renderer shipped by a plugin the site doesn't have keeps every
 * other recommendation it made.
 *
 * @public
 *
 * @param recommended A sanitized recommendation set.
 * @return The applicable subset. May be empty.
 */
export function resolveRecommendedOsSettings(
	recommended: RecommendedOsSettings | undefined | null,
	themeSlug?: string,
): RecommendedOsSettings {
	const clean = sanitizeRecommendedOsSettings( recommended );
	// A theme names its own wallpaper by the id in its manifest; the
	// registry knows it under the theme's prefix.
	if ( typeof clean.wallpaper === 'string' ) {
		const candidates = themeSlug
			? [ `${ THEME_WALLPAPER_PREFIX }${ themeSlug }/${ clean.wallpaper }`, clean.wallpaper ]
			: [ clean.wallpaper ];
		const id = candidates.find( ( c ) => getWallpaper( c ) !== undefined );
		if ( id ) {
			clean.wallpaper = id;
		} else {
			delete clean.wallpaper;
		}
	}
	if (
		typeof clean.dockRailRenderer === 'string' &&
		getDockRailRenderer( clean.dockRailRenderer ) === undefined
	) {
		delete clean.dockRailRenderer;
	}
	// `'none'` is the reveal selector's "no reveal" sentinel, not a
	// registration — a theme recommending a deliberately plain shell
	// must survive this check.
	if (
		typeof clean.windowReveal === 'string' &&
		clean.windowReveal !== WINDOW_REVEAL_NONE &&
		! hasWindowReveal( clean.windowReveal )
	) {
		delete clean.windowReveal;
	}
	// The accent list is filterable in PHP, so a swatch id only means
	// something if the site still offers it.
	if (
		typeof clean.accent === 'string' &&
		! getAccents().some( ( a ) => a.id === clean.accent )
	) {
		delete clean.accent;
	}
	// A widget only counts if something is registered under it. A list
	// that named widgets and kept none is dropped rather than read as
	// "an empty desk", which only `[]` itself means.
	if ( clean.widgets && clean.widgets.length > 0 ) {
		const widgets = clean.widgets.filter( ( id ) => getWidget( id ) !== undefined );
		if ( widgets.length > 0 ) {
			clean.widgets = widgets;
		} else {
			delete clean.widgets;
		}
	}
	// A colour becomes the swatch that already wears it, or the custom
	// accent. Either way it lands on the two settings the picker owns.
	if ( typeof clean.accentColor === 'string' ) {
		if ( typeof clean.accent !== 'string' ) {
			const hex = clean.accentColor;
			const swatch = getAccents().find(
				( a ) => a.value.toLowerCase() === hex,
			);
			if ( swatch ) {
				clean.accent = swatch.id;
			} else {
				clean.accent = CUSTOM_ACCENT_ID;
				clean.customAccent = hex;
			}
		}
		delete clean.accentColor;
	}
	return clean;
}
