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
import { getAccents } from '../settings/constants';
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
const SLUG_FIELDS = [ 'dockRailRenderer', 'windowReveal', 'accent' ] as const;

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
	...Object.keys( INT_FIELDS ),
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
	for ( const [ key, range ] of Object.entries( INT_FIELDS ) ) {
		const value = source[ key ];
		if ( typeof value === 'number' && Number.isFinite( value ) ) {
			ints[ key ] = Math.min(
				range.max,
				Math.max( range.min, Math.round( value ) ),
			);
		}
	}

	return { ...out, ...ints } as RecommendedOsSettings;
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
): RecommendedOsSettings {
	const clean = sanitizeRecommendedOsSettings( recommended );
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
	return clean;
}
