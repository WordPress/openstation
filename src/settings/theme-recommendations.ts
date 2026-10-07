import {
	getDesktopTheme,
	resolveRecommendedOsSettings,
	type RecommendedOsSettings,
} from '../desktop-themes';
import type { OsSettingsState } from './types';

const LEDGER_CAP = 64;

export const SYSTEM_DEFAULT_THEME = '';

const SYSTEM_DEFAULT_LEDGER_KEY = 'system-default';

const SYSTEM_DEFAULT_RECOMMENDATIONS: RecommendedOsSettings = {
	accent: 'pulse',
	desktopLayout: 'unified',
	dockPlacement: 'bottom',
};

export interface ApplyThemeRecommendationsOptions {

	force?: boolean;
}

export function applyThemeRecommendations(
	state: OsSettingsState,
	themeId: string,
	opts: ApplyThemeRecommendationsOptions = {},
): RecommendedOsSettings {
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
		return {};
	}

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
