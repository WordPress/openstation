/**
 * Electron Adapter — new windows opened inside a freed window.
 *
 * A freed window runs the shell in **solo mode**: one window painted,
 * no dock, no taskbar, no desk. That is exactly right for the window
 * the user set free, and exactly wrong for a second one.
 *
 * Anything that opens another window there — launching a game from a
 * freed Games hub, opening a post from a freed list, a plugin calling
 * `wp.os.openWindow()` — lands in a surface with nowhere to put it.
 * Solo's CSS stretches every `.os-window` to fill the viewport, so the
 * newcomer covers the window the user was using, and with no dock and
 * no window controls there is no way back to either. That is the bug
 * this module exists to prevent, and it is silent: two windows in the
 * DOM, one visible, no error anywhere.
 *
 * So the answer is not to suppress the second window but to **put it
 * where it belongs**: on the real desktop, as its own native window.
 * Under a desktop host, "open a new window" should mean a new window of
 * the desktop.
 *
 * The result is a sibling, not a child. Freed windows are peers;
 * closing one says nothing about the others.
 */

import { freedWindowUrl } from './host';
import type { AdapterConfig, DesktopFrameBridge } from './types';

/** The slice of the shell this module needs. */
export interface SoloShellApi {
	config: { adminUrl: string; soloWindow?: string };
	HOOKS: Record< string, string >;
	hooks: {
		addAction(
			name: string,
			namespace: string,
			cb: ( payload: { windowId?: string } ) => void,
		): void;
	};
	windowManager: {
		getById( id: string ): unknown;
	};
}

/** A window as this module reads it. */
interface OpenedWindow {
	id: string;
	config: { native?: boolean; title?: string; url?: string };
	element?: { getBoundingClientRect(): { width: number; height: number } };
	getCurrentUrl?: () => string;
	close?: () => void;
}

/**
 * Whether two URLs address the same window.
 *
 * Compares path and query with the flags that describe *how* a page is
 * rendered removed, so a URL and its chromeless twin compare equal —
 * forwarding one to the other is a loop.
 *
 * `openstation_solo` is deliberately NOT removed. It looks like a
 * rendering flag and is the opposite: it names *which window* the
 * shell paints, so it is the identity of a solo URL rather than its
 * chrome. Strip it and every solo URL collapses onto every other, the
 * guard matches everything, and a freed Games window silently refuses
 * to hand its game to the desktop.
 *
 * @param a First URL.
 * @param b Second URL.
 * @return True when both address the same window.
 */
export function sameDocument( a: string, b: string ): boolean {
	const strip = ( raw: string ): string => {
		try {
			const url = new URL( raw, window.location.origin );
			for ( const flag of [
				'openstation_chromeless',
				'desktop_mode_portal',
				'desktop_mode_portal_intent',
			] ) {
				url.searchParams.delete( flag );
			}
			url.searchParams.sort();
			return `${ url.origin }${ url.pathname }?${ url.searchParams.toString() }`;
		} catch {
			return raw;
		}
	};
	return strip( a ) === strip( b );
}

/**
 * Forward every window opened beyond the solo one to the host.
 *
 * @param frame  The freed-window bridge.
 * @param os     The shell API.
 * @param config The adapter's PHP config.
 */
export function installSoloForwarder(
	frame: Pick< DesktopFrameBridge, 'isFreedWindow' > & {
		openWindow?: ( req: {
			windowId: string;
			url: string;
			title?: string;
			width?: number;
			height?: number;
			native?: boolean;
		} ) => Promise< { ok: boolean; error?: string } >;
	},
	os: SoloShellApi,
	config: AdapterConfig,
): void {
	if ( 'function' !== typeof frame.openWindow ) {
		// An older host. Leaving the window where it is beats closing it
		// and having nowhere to send it.
		return;
	}

	const soloId = String( os.config.soloWindow || '' );

	os.hooks.addAction(
		os.HOOKS.WINDOW_OPENED,
		'openstation-electron/solo-forwarder',
		( payload ) => {
			const windowId = payload?.windowId;
			if ( ! windowId || windowId === soloId ) {
				return;
			}

			const win = os.windowManager.getById( windowId ) as
				| OpenedWindow
				| undefined
				| null;
			if ( ! win ) {
				return;
			}

			const url = freedWindowUrl(
				{
					id: win.id,
					config: win.config,
					// At `WINDOW_OPENED` an iframe window may not have
					// navigated yet, so fall back to the URL it was
					// configured with rather than to solo mode.
					getCurrentUrl: () =>
						( win.getCurrentUrl ? win.getCurrentUrl() : '' ) ||
						win.config.url ||
						'',
				},
				{
					adminUrl: os.config.adminUrl,
					soloParam: config.soloParam,
					origin: window.location.origin,
				},
			);
			if ( ! url ) {
				return;
			}

			/*
			 * Never forward a window that resolves to the page this
			 * surface is already showing.
			 *
			 * That would open a native window onto the same URL, whose
			 * shell would open the same window again, and forward it
			 * again. The core opener no longer substitutes a window it
			 * cannot resolve, which is what used to produce this — but
			 * a self-referential forward is cheap to detect and
			 * expensive to debug, so it is checked here too.
			 */
			if ( sameDocument( url, window.location.href ) ) {
				return;
			}

			const rect = win.element?.getBoundingClientRect();

			void frame
				.openWindow!( {
					windowId,
					url,
					title: win.config.title,
					width: rect ? Math.round( rect.width ) : undefined,
					height: rect ? Math.round( rect.height ) : undefined,
					native: !! win.config.native,
				} )
				.then( ( result ) => {
					if ( ! result?.ok ) {
						// The host refused. Keep the local window: a
						// stacked window the user can at least see beats
						// a closed one that went nowhere.
						console.error(
							'[openstation-electron] host refused to open a window:',
							result?.error,
						);
						return;
					}
					// It lives on the desktop now. Close the local copy
					// so this surface keeps painting exactly one window.
					win.close?.();
				} )
				.catch( ( err ) => {
					console.error(
						'[openstation-electron] could not forward a window to the host:',
						err,
					);
				} );
		},
	);
}
