import { applyFilters, doAction, HOOKS } from '../../hooks';
import {
	getWindowChrome,
	type ChromeRenderHandle,
	type ChromeRenderState,
} from './registry';

import type { Window as DesktopWindow } from '../../window';

export const STANDARD_CHROME_ID = 'core/standard';

export const CUSTOM_CHROME_CLASS = 'os-window--custom-chrome';

export function resolveChromeId( win: DesktopWindow ): string {
	const inline = win.config.appearance?.chrome ?? STANDARD_CHROME_ID;
	const id = applyFilters<
		string,
		[ { windowId: string; config: DesktopWindow[ 'config' ] } ]
	>(
		HOOKS.WINDOW_CHROME_RENDER,
		inline,
		{ windowId: win.id, config: win.config },
	);
	return id;
}

export function captureChromeState( win: DesktopWindow ): ChromeRenderState {
	return {
		title: win.config.title,
		icon: win.config.icon,
		focused: win.element.classList.contains( 'os-window--focused' ),
		state: win.state,
	};
}

export function mountWindowChrome(
	win: DesktopWindow,
): { id: string; handle: ChromeRenderHandle } | null {
	const id = resolveChromeId( win );
	if ( id === STANDARD_CHROME_ID ) {
		return null;
	}
	const def = getWindowChrome( id );
	if ( ! def ) {
		return null;
	}
	try {
		if ( def.match && ! def.match( win ) ) {
			return null;
		}
	} catch {
		return null;
	}

	win.element.classList.add( CUSTOM_CHROME_CLASS );
	let handle: ChromeRenderHandle;
	try {
		handle = def.render( win.element, {
			window: win,
			state: captureChromeState( win ),
		} );
	} catch ( err ) {
		win.element.classList.remove( CUSTOM_CHROME_CLASS );
		doAction( HOOKS.SHELL_ERROR, {
			scope: 'window-chrome-render',
			windowId: win.id,
			chromeId: id,
			error: err,
		} );
		return null;
	}
	doAction( HOOKS.WINDOW_CHROME_APPLIED, {
		windowId: win.id,
		layer: 'chrome',
		chromeId: id,
	} );
	return { id, handle };
}
