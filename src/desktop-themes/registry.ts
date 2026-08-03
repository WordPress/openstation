/**
 * Desktop-theme registry.
 *
 * Backed by `createSharedStore` rather than module-level state,
 * because the library is written by the always-on shell bundle and
 * read by the lazily-loaded OS Settings panel bundle. Two bundles,
 * two compiled copies of any plain module state — the exact class of
 * bug documented in AGENTS.md → "Cross-bundle state".
 */

import { createSharedStore } from '../shared-store';
import { sanitizeRecommendedOsSettings } from './recommended';
import type { DesktopThemeEntry, DesktopThemeState } from './types';

/** Slug charset — mirrors PHP's `sanitize_key()`. */
const SLUG_PATTERN = /^[a-z0-9_-]+$/;

/** Upper bound on icon slots we accept from one theme. */
const MAX_ICON_SLOTS = 128;

/**
 * Whether a payload icon value is something we're willing to paint.
 *
 * PHP already validated these, but the shell must not assume the
 * payload is trustworthy: a filter (`desktop_mode_desktop_themes`)
 * runs after sanitization and can put anything in.
 */
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

/**
 * Coerce one raw payload entry into a `DesktopThemeEntry`, or return
 * `null` when it is too malformed to use.
 *
 * @internal
 */
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
	};
}

/**
 * Read + sanitize the boot payload. Runs once, inside the store's
 * seed thunk, so a bundle that never touches themes never pays for
 * it.
 */
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

/** The shared store handle. Exported for `apply.ts` and tests. */
export function getStore() {
	return store;
}

/**
 * Every theme in the library, in payload order.
 *
 * @public
 */
export function listDesktopThemes(): DesktopThemeEntry[] {
	return store.getState().themes.slice();
}

/**
 * One theme by slug (or by full id — `vendor/neon` resolves to the
 * `vendor-neon` slug, matching what PHP stored).
 *
 * @public
 */
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

/**
 * Slug of the active theme, or `null` for the system default.
 *
 * @public
 */
export function getActiveDesktopThemeId(): string | null {
	return store.getState().activeId;
}

/**
 * Insert or replace one library entry. Used by the upload flow so a
 * freshly-installed theme appears in the picker without waiting for
 * the next payload refresh.
 *
 * @public
 */
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

/**
 * Drop one library entry.
 *
 * Does NOT deactivate it — that is `applyDesktopTheme( '' )`'s job,
 * and the caller decides (deleting a theme the CURRENT user isn't
 * using shouldn't disturb their shell).
 *
 * @public
 */
export function removeDesktopTheme( slug: string ): void {
	const themes = store.state.themes.filter( ( theme ) => theme.slug !== slug );
	if ( themes.length !== store.state.themes.length ) {
		store.setState( { themes } );
	}
}

/**
 * Replace the whole library (server-sync path).
 *
 * @internal
 */
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

/**
 * Subscribe to library / active-theme changes.
 *
 * @public
 *
 * @param cb Called on every mutation with the live state.
 * @return Unsubscribe function.
 */
export function subscribeDesktopThemes(
	cb: ( state: Readonly< DesktopThemeState > ) => void,
): () => void {
	return store.subscribe( cb );
}
