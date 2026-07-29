/**
 * Applying a desktop theme's recommended OS settings.
 *
 * A theme may ship a `recommendedOsSettings` block — the dock size,
 * desktop layout, window radius and dock rail renderer its author
 * designed it against. The contract, in one sentence: **a
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
 * "Apply recommended layout" action calls in here with
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

/** Options for {@link applyThemeRecommendations}. */
export interface ApplyThemeRecommendationsOptions {
	/**
	 * Re-apply even when this theme's recommendations were already
	 * seeded for this user. This is the "Apply recommended layout"
	 * button, and it is the ONLY way a second application happens.
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
	const theme = getDesktopTheme( themeId );
	if ( ! theme ) {
		return {};
	}

	const alreadySeeded = state.appliedThemeRecommendations.includes(
		theme.slug,
	);
	if ( alreadySeeded && ! opts.force ) {
		return {};
	}

	const recommended = resolveRecommendedOsSettings(
		theme.recommendedOsSettings,
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
	// `desktop_mode_desktop_theme_recommended_os_settings_schema`
	// reaches its own key too. Two guards keep that safe: the key must
	// already exist on the state object, and the incoming value must
	// be a string — so a recommendation can never introduce a setting
	// or flip a boolean feature switch.
	const target = state as unknown as Record< string, unknown >;
	const applied: Record< string, string > = {};
	for ( const key of keys ) {
		const value = ( recommended as Record< string, unknown > )[ key ];
		if ( typeof value !== 'string' || ! ( key in state ) ) {
			continue;
		}
		if ( typeof target[ key ] !== 'string' ) {
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
			theme.slug,
		].slice( -LEDGER_CAP );
	}

	return applied as RecommendedOsSettings;
}

/**
 * Whether this theme has an arrangement to offer that the shell can
 * actually apply right now — the question the "Apply recommended
 * layout" button asks before rendering itself.
 *
 * @public
 *
 * @param themeId Theme slug or id.
 */
export function hasApplicableThemeRecommendations( themeId: string ): boolean {
	const theme = getDesktopTheme( themeId );
	if ( ! theme ) {
		return false;
	}
	return (
		Object.keys( resolveRecommendedOsSettings( theme.recommendedOsSettings ) )
			.length > 0
	);
}
