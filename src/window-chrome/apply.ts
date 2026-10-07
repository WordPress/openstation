import { applyFilters, doAction, HOOKS } from '../hooks';
import { listWindowThemes, resolveWindowTheme } from './themes/registry';

import type { Window as DesktopWindow } from '../window';
import type { WindowThemeRef } from '../types';

interface AppliedThemeRecord {
	themeId: string | null;
	keys: Set< string >;
}

const applied = new WeakMap< HTMLElement, AppliedThemeRecord >();

export function resolveActiveTheme(
	win: DesktopWindow,
	override?: WindowThemeRef,
): { themeId: string | null; tokens: Record< string, string > } {
	let themeId: string | null = null;
	let tokens: Record< string, string > = {};

	if ( override && 'tokens' in override && override.tokens ) {
		themeId = null;
		tokens = { ...override.tokens };
	} else if ( override && 'themeId' in override && override.themeId ) {
		const list = resolveByThemeId( override.themeId );
		if ( list ) {
			themeId = list.id;
			tokens = { ...list.tokens };
		}
	} else {
		const winner = resolveWindowTheme( win );
		if ( winner ) {
			themeId = winner.id;
			tokens = { ...winner.tokens };
		}
	}

	const filtered = applyFilters<
		Record< string, string >,
		[ { windowId: string; themeId: string | null; config: DesktopWindow[ 'config' ] } ]
	>(
		HOOKS.WINDOW_CHROME_THEME,
		tokens,
		{ windowId: win.id, themeId, config: win.config },
	);

	return { themeId, tokens: filtered };
}

export function applyWindowTheme(
	win: DesktopWindow,
	override?: WindowThemeRef,
): void {
	const element = win.element;
	if ( ! element ) {
		return;
	}

	const previous = applied.get( element );
	const { themeId, tokens } = resolveActiveTheme( win, override );

	if ( previous ) {
		for ( const key of previous.keys ) {
			if ( ! ( key in tokens ) ) {
				try {
					element.style.removeProperty( key );
				} catch {

				}
			}
		}
	}

	const keys = new Set< string >();
	for ( const [ key, value ] of Object.entries( tokens ) ) {
		try {
			element.style.setProperty( key, value );
			keys.add( key );
		} catch ( err ) {
			doAction( HOOKS.SHELL_ERROR, {
				scope: 'window-theme-apply',
				windowId: win.id,
				key,
				error: err,
			} );
		}
	}
	applied.set( element, { themeId, keys } );

	doAction( HOOKS.WINDOW_CHROME_THEME_CHANGED, {
		windowId: win.id,
		themeId,
		tokens,
	} );
}

export function clearWindowTheme( win: DesktopWindow ): void {
	const element = win.element;
	if ( ! element ) {
		return;
	}
	const previous = applied.get( element );
	if ( ! previous ) {
		return;
	}
	for ( const key of previous.keys ) {
		try {
			element.style.removeProperty( key );
		} catch {

		}
	}
	applied.delete( element );
}

function resolveByThemeId(
	id: string,
): { id: string; tokens: Record< string, string > } | null {
	for ( const def of listWindowThemes() ) {
		if ( def.id === id ) {
			return { id: def.id, tokens: def.tokens };
		}
	}
	return null;
}
