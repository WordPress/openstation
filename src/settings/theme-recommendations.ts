/**
 * Applying a desktop theme's recommended OS settings.
 *
 * A theme may ship a `recommendedOsSettings` block — the dock size,
 * desktop layout, window radius, dock rail renderer, and window-reveal
 * style and speed its author designed it against. The contract, in one sentence: **a
 * recommendation is applied once, when the user first activates the
 * theme, and never again.**
 *
 * That "once" is what keeps this from being a theme reaching into a
 * user's preferences on every page load. The ledger lives in
 * `state.appliedThemeRecommendations`; a slug in that list is a
 * promise that this user has already been offered this theme's
 * arrangement and whatever they are wearing now is their own choice.
 *
 * The one way back is deliberate and user-initiated: the Themes tab's
 * "Apply recommended layout and effects" action calls in here with
 * `{ force: true }`.
 *
 * This module mutates the state object it is given and does NOT
 * persist — the caller owns `save()` / `apply()`, because it also
 * owns whatever else it is changing in the same gesture (the active
 * theme, typically).
 */

import {
	getDesktopTheme,
	resolveRecommendedOsSettings,
	type RecommendedOsSettings,
} from '../desktop-themes';
import type { OsSettingsState } from './types';

/** How many theme slugs the ledger remembers. Mirrors the PHP cap. */
const LEDGER_CAP = 64;

/**
 * The "no theme" card's id — the shell's own look, which OS Settings
 * shows as **OpenStation**.
 *
 * @public
 */
export const SYSTEM_DEFAULT_THEME = '';

/** Ledger key for the system default, which has no theme slug. */
const SYSTEM_DEFAULT_LEDGER_KEY = 'system-default';

/**
 * What the shell's own look recommends.
 *
 * It is a theme in every way that matters to this module — a palette
 * with an arrangement it was designed against — but it has no manifest
 * to declare that in, because it IS the default and lives in
 * `assets/css/variables.css`. So its recommendations are spelled out
 * here: the accent it was drawn against, and the layout it was drawn
 * for.
 *
 * The accent has to be a recommendation rather than part of the
 * palette because it is a user setting written as an inline style,
 * which no stylesheet can reach. Without this, picking OpenStation
 * after wearing Legacy would leave WordPress blue on every focus ring
 * and tab underline of a magenta-accented station.
 */
const SYSTEM_DEFAULT_RECOMMENDATIONS: RecommendedOsSettings = {
	accent: 'pulse',
	desktopLayout: 'classic',
};

/** Options for {@link applyThemeRecommendations}. */
export interface ApplyThemeRecommendationsOptions {
	/**
	 * Re-apply even when this theme's recommendations were already
	 * seeded for this user. This is the "Apply recommended layout and
	 * effects" button, and it is the ONLY way a second application
	 * happens.
	 */
	force?: boolean;
}

/**
 * Seed one theme's recommended OS settings into `state`.
 *
 * @public
 *
 * @param state   Live settings state. Mutated in place.
 * @param themeId Theme slug or id.
 * @param opts    See {@link ApplyThemeRecommendationsOptions}.
 * @return The keys actually written. Empty when the theme is unknown,
 *         recommends nothing applicable, or was already seeded.
 */
export function applyThemeRecommendations(
	state: OsSettingsState,
	themeId: string,
	opts: ApplyThemeRecommendationsOptions = {},
): RecommendedOsSettings {
	// The system default is not in the registry — it has no manifest —
	// but it recommends the accent its palette was drawn against, and
	// the ledger has to remember that it already offered it.
	const isSystem = themeId === SYSTEM_DEFAULT_THEME;
	const theme = isSystem ? null : getDesktopTheme( themeId );
	if ( ! isSystem && ! theme ) {
		return {};
	}
	const ledgerKey = isSystem ? SYSTEM_DEFAULT_LEDGER_KEY : theme!.slug;

	const alreadySeeded =
		state.appliedThemeRecommendations.includes( ledgerKey );
	if ( alreadySeeded && ! opts.force ) {
		return {};
	}

	const recommended = resolveRecommendedOsSettings(
		isSystem ? SYSTEM_DEFAULT_RECOMMENDATIONS : theme!.recommendedOsSettings,
	);
	const keys = Object.keys( recommended );
	if ( keys.length === 0 ) {
		// Nothing to seed. Deliberately NOT recorded in the ledger: if
		// the author adds recommendations in a later version, the next
		// activation should get to offer them.
		return {};
	}

	// Written generically rather than key-by-key so a site that has
	// widened the schema through
	// `open_station_desktop_theme_recommended_os_settings_schema`
	// reaches its own key too. Three guards keep that safe: the value
	// must be a string or a number, the key must already exist on the
	// state object, and the two types must MATCH — so a recommendation
	// can never introduce a setting, retype an existing one, or flip a
	// boolean feature switch.
	const target = state as unknown as Record< string, unknown >;
	const applied: Record< string, string | number > = {};
	for ( const key of keys ) {
		const value = ( recommended as Record< string, unknown > )[ key ];
		if ( typeof value !== 'string' && typeof value !== 'number' ) {
			continue;
		}
		if ( ! ( key in state ) || typeof target[ key ] !== typeof value ) {
			continue;
		}
		target[ key ] = value;
		applied[ key ] = value;
	}

	if ( Object.keys( applied ).length === 0 ) {
		return {};
	}

	if ( ! alreadySeeded ) {
		state.appliedThemeRecommendations = [
			...state.appliedThemeRecommendations,
			ledgerKey,
		].slice( -LEDGER_CAP );
	}

	return applied as RecommendedOsSettings;
}

/**
 * Whether this theme has an arrangement to offer that the shell can
 * actually apply right now — the question the "Apply recommended
 * layout and effects" button asks before rendering itself.
 *
 * @public
 *
 * @param themeId Theme slug or id.
 */
export function hasApplicableThemeRecommendations( themeId: string ): boolean {
	if ( themeId === SYSTEM_DEFAULT_THEME ) {
		return (
			Object.keys(
				resolveRecommendedOsSettings( SYSTEM_DEFAULT_RECOMMENDATIONS ),
			).length > 0
		);
	}
	const theme = getDesktopTheme( themeId );
	if ( ! theme ) {
		return false;
	}
	return (
		Object.keys( resolveRecommendedOsSettings( theme.recommendedOsSettings ) )
			.length > 0
	);
}
