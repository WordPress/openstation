import { createSharedStore } from '../shared-store';
import { trackedFetch } from '../tracked-fetch';
import { restErrorFromResponse } from '../core/api-client';
import { sanitizeRecommendedOsSettings } from './recommended';
import type { DesktopThemeEntry, DesktopThemeState } from './types';

const SLUG_PATTERN = /^[a-z0-9_-]+$/;

const MAX_ICON_SLOTS = 128;

function isPaintableIcon( value: unknown ): value is string {
	if ( typeof value !== 'string' || value === '' || value.length > 2048 ) {
		return false;
	}
	return (
		value.startsWith( 'dashicons-' ) ||
		value.startsWith( 'https://' ) ||
		value.startsWith( 'http://' ) ||
		value.startsWith( 'data:image/' )
	);
}

export function normalizeEntry( raw: unknown ): DesktopThemeEntry | null {
	if ( ! raw || typeof raw !== 'object' ) {
		return null;
	}
	const source = raw as Record< string, unknown >;
	const slug = typeof source.slug === 'string' ? source.slug : '';
	if ( ! SLUG_PATTERN.test( slug ) ) {
		return null;
	}

	const icons: Record< string, string > = {};
	if ( source.icons && typeof source.icons === 'object' ) {
		let count = 0;
		for ( const [ slot, value ] of Object.entries(
			source.icons as Record< string, unknown >,
		) ) {
			if ( count >= MAX_ICON_SLOTS ) {
				break;
			}
			if ( slot === '' || ! isPaintableIcon( value ) ) {
				continue;
			}
			icons[ slot ] = value;
			count += 1;
		}
	}

	const tokens: Record< string, string > = {};
	if ( source.tokens && typeof source.tokens === 'object' ) {
		for ( const [ key, value ] of Object.entries(
			source.tokens as Record< string, unknown >,
		) ) {
			if ( typeof value === 'string' ) {
				tokens[ key ] = value;
			}
		}
	}

	const fonts: string[] = [];
	if ( Array.isArray( source.fonts ) ) {
		for ( const family of source.fonts as unknown[] ) {
			if ( typeof family === 'string' && family !== '' ) {
				fonts.push( family );
			}
		}
	}

	const iconColors: Record< string, string > = {};
	if ( source.iconColors && typeof source.iconColors === 'object' ) {
		let colorCount = 0;
		for ( const [ slot, value ] of Object.entries(
			source.iconColors as Record< string, unknown >,
		) ) {
			if ( colorCount >= MAX_ICON_SLOTS ) {
				break;
			}
			if ( slot === '' || typeof value !== 'string' || value === '' ) {
				continue;
			}
			iconColors[ slot ] = value;
			colorCount += 1;
		}
	}

	const str = ( key: string ): string =>
		typeof source[ key ] === 'string' ? ( source[ key ] as string ) : '';

	return {
		id: str( 'id' ) || slug,
		slug,
		name: str( 'name' ) || slug,
		version: str( 'version' ),
		author: str( 'author' ),
		description: str( 'description' ),
		previewUrl: str( 'previewUrl' ),
		cssUrl: str( 'cssUrl' ),
		cssText: str( 'cssText' ),
		tokens,
		fonts,
		icons,
		iconColors,
		recommendedOsSettings: sanitizeRecommendedOsSettings(
			source.recommendedOsSettings,
		),
		installedAt:
			typeof source.installedAt === 'number' ? source.installedAt : 0,
		source: source.source === 'code' ? 'code' : 'upload',
		cssDeferred: source.cssDeferred === true,
	};
}

function seed(): DesktopThemeState {
	const globals = window as unknown as {
		openStationConfig?: { serverDesktopThemes?: unknown };
	};
	const raw = globals.openStationConfig?.serverDesktopThemes;

	const themes: DesktopThemeEntry[] = [];
	if ( Array.isArray( raw ) ) {
		for ( const item of raw ) {
			const entry = normalizeEntry( item );
			if ( entry ) {
				themes.push( entry );
			}
		}
	}
	return { themes, activeId: null, activeIcons: null, activeIconColors: null };
}

const store = createSharedStore< DesktopThemeState >(
	'desktop-mode/desktop-themes',
	seed,
);

export function getStore() {
	return store;
}

export function listDesktopThemes(): DesktopThemeEntry[] {
	return store.getState().themes.slice();
}

export function getDesktopTheme( id: string ): DesktopThemeEntry | null {
	if ( typeof id !== 'string' || id === '' ) {
		return null;
	}
	const slug = id.replace( /\//g, '-' );
	return (
		store.getState().themes.find(
			( theme ) => theme.slug === slug || theme.id === id,
		) ?? null
	);
}

export function getActiveDesktopThemeId(): string | null {
	return store.getState().activeId;
}

export function upsertDesktopTheme( raw: unknown ): DesktopThemeEntry | null {
	const entry = normalizeEntry( raw );
	if ( ! entry ) {
		return null;
	}
	const themes = store.state.themes.slice();
	const index = themes.findIndex( ( theme ) => theme.slug === entry.slug );
	if ( index >= 0 ) {
		themes[ index ] = entry;
	} else {
		themes.push( entry );
	}
	themes.sort( ( a, b ) => a.name.localeCompare( b.name ) );
	store.setState( { themes } );
	return entry;
}

let fullLibraryFetch: Promise< void > | null = null;

export function ensureFullDesktopThemes(): Promise< void > {
	if ( fullLibraryFetch ) {
		return fullLibraryFetch;
	}
	const url = (
		window as unknown as {
			openStationConfig?: { desktopThemesUrl?: string };
		}
	).openStationConfig?.desktopThemesUrl;
	if ( ! url ) {
		return Promise.resolve();
	}
	fullLibraryFetch = trackedFetch(
		url,
		{ method: 'GET', credentials: 'same-origin' },
		{ source: 'desktop-mode/desktop-themes' },
	)
		.then( async ( response ) => {
			if ( ! response.ok ) {
				throw await restErrorFromResponse( response );
			}
			return response.json();
		} )
		.then( ( body: { themes?: unknown[] } ) => {
			for ( const raw of body?.themes ?? [] ) {
				upsertDesktopTheme( raw );
			}
		} )
		.catch( () => {
			fullLibraryFetch = null;
		} );
	return fullLibraryFetch;
}

export function __resetFullDesktopThemesFetchForTests(): void {
	fullLibraryFetch = null;
}

export function removeDesktopTheme( slug: string ): void {
	const themes = store.state.themes.filter( ( theme ) => theme.slug !== slug );
	if ( themes.length !== store.state.themes.length ) {
		store.setState( { themes } );
	}
}

export function setDesktopThemes( list: readonly unknown[] ): void {
	const themes: DesktopThemeEntry[] = [];
	for ( const item of list ) {
		const entry = normalizeEntry( item );
		if ( entry ) {
			themes.push( entry );
		}
	}
	store.setState( { themes } );
}

export function subscribeDesktopThemes(
	cb: ( state: Readonly< DesktopThemeState > ) => void,
): () => void {
	return store.subscribe( cb );
}
