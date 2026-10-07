import { get as getDockRailRenderer } from '../dock-rail/registry';
import { hasWindowReveal, WINDOW_REVEAL_NONE } from '../reveals/registry';

import { getAccents } from '../settings/constants';
import type { RecommendedOsSettings } from './types';

const ENUMS: Record< string, readonly string[] > = {
	dockSize: [ 'compact', 'default', 'large' ],
	desktopLayout: [ 'classic', 'unified' ],
	dockPlacement: [ 'bottom', 'left', 'right' ],
	windowRadius: [ 'sharp', 'default', 'round' ],
	adminBarMode: [ 'static', 'dynamic', 'hidden' ],
};

const SLUG_FIELDS = [ 'dockRailRenderer', 'windowReveal', 'accent' ] as const;

const INT_FIELDS: Record< string, { min: number; max: number } > = {
	windowRevealDuration: { min: 80, max: 4000 },
};

const SLUG_PATTERN = /^[a-z0-9_-]+$/;

export const RECOMMENDED_OS_SETTINGS_KEYS: readonly string[] = [
	...Object.keys( ENUMS ),
	...SLUG_FIELDS,
	...Object.keys( INT_FIELDS ),
];

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

	if (
		typeof clean.windowReveal === 'string' &&
		clean.windowReveal !== WINDOW_REVEAL_NONE &&
		! hasWindowReveal( clean.windowReveal )
	) {
		delete clean.windowReveal;
	}

	if (
		typeof clean.accent === 'string' &&
		! getAccents().some( ( a ) => a.id === clean.accent )
	) {
		delete clean.accent;
	}
	return clean;
}
