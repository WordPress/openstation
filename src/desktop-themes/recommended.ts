/**
 * Recommended OS settings — the shell-side mirror of PHP's
 * `desktop_mode_desktop_theme_recommended_os_settings_schema()`.
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
 * and to the `DESKTOP_MODE_OS_SETTINGS_*` constants in
 * `includes/os-settings.php`.
 * They are duplicated rather than imported because this module is a
 * leaf of the always-on shell bundle and must not pull the settings
 * module in behind it.
 */

import { get as getDockRailRenderer } from '../dock-rail/registry';
import type { RecommendedOsSettings } from './types';

/** Closed enums, keyed by the OS-settings field they belong to. */
const ENUMS: Record< string, readonly string[] > = {
	dockSize: [ 'compact', 'default', 'large' ],
	desktopLayout: [ 'classic', 'unified', 'spatial' ],
	windowRadius: [ 'sharp', 'default', 'round' ],
	adminBarMode: [ 'static', 'dynamic', 'hidden' ],
};

/** Fields whose validity is a runtime registry lookup, not an enum. */
const SLUG_FIELDS = [ 'dockRailRenderer' ] as const;

/** Slug charset — mirrors PHP's `sanitize_key()`. */
const SLUG_PATTERN = /^[a-z0-9_-]+$/;

/**
 * Every OS-settings key a theme may recommend, in a stable order.
 * Exported so a UI can describe what an "Apply recommended layout"
 * action is about to touch.
 *
 * @public
 */
export const RECOMMENDED_OS_SETTINGS_KEYS: readonly string[] = [
	...Object.keys( ENUMS ),
	...SLUG_FIELDS,
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

	return out as RecommendedOsSettings;
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
	return clean;
}
