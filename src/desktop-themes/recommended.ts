import { get as getDockRailRenderer } from '../dock-rail/registry';
import { hasWindowReveal, WINDOW_REVEAL_NONE } from '../reveals/registry';
import { CUSTOM_ACCENT_ID, getAccents } from '../settings/constants';
import { get as getWallpaper } from '../wallpapers/registry';
import { get as getWidget } from '../widgets/registry';
import type { RecommendedOsSettings } from './types';

const ENUMS: Record< string, readonly string[] > = {
	dockSize: [ 'compact', 'default', 'large' ],
	desktopLayout: [ 'classic', 'unified' ],
	dockPlacement: [ 'bottom', 'left', 'right' ],
	windowRadius: [ 'sharp', 'default', 'round' ],
	adminBarMode: [ 'static', 'dynamic', 'hidden' ],
};

const SLUG_FIELDS = [
	'dockRailRenderer',
	'windowReveal',
	'accent',
	'wallpaper',
] as const;

const THEME_WALLPAPER_PREFIX = 'desktop-theme/';

const INT_FIELDS: Record< string, { min: number; max: number } > = {
	windowRevealDuration: { min: 80, max: 4000 },
};

const SLUG_PATTERN = /^[a-z0-9_-]+$/;

const HEX_FIELDS = [ 'accentColor' ] as const;
const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

const MAP_FIELDS: Record< string, readonly string[] > = {
	navPlacement: [ 'rail', 'desktop', 'both', 'hidden' ],
};

const LIST_FIELDS = [ 'widgets' ] as const;

const ID_PATTERN = /^[A-Za-z0-9_/-]{1,128}$/;

export const RECOMMENDED_OS_SETTINGS_KEYS: readonly string[] = [
	...Object.keys( ENUMS ),
	...SLUG_FIELDS,
	...HEX_FIELDS,
	...Object.keys( INT_FIELDS ),
	...Object.keys( MAP_FIELDS ),
	...LIST_FIELDS,
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

export function resolveRecommendedOsSettings(
	recommended: RecommendedOsSettings | undefined | null,
	themeSlug?: string,
): RecommendedOsSettings {
	const clean = sanitizeRecommendedOsSettings( recommended );
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
	if ( clean.widgets && clean.widgets.length > 0 ) {
		const widgets = clean.widgets.filter( ( id ) => getWidget( id ) !== undefined );
		if ( widgets.length > 0 ) {
			clean.widgets = widgets;
		} else {
			delete clean.widgets;
		}
	}
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
