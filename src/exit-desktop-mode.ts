/**
 * Exit Desktop Mode dock tile.
 *
 * Builds the {@link SystemDockItem} for the "Exit Desktop Mode" entry on
 * the primary dock rail and the click handler that disables the user's
 * desktop-mode preference and routes them back to classic admin.
 *
 * Reuses the existing `save-desktop-mode` AJAX endpoint
 * (`includes/ajax.php`) via the `window.desktopModeAdminBar` global
 * already published by `includes/admin-bar.php` for the admin-bar
 * toggle. Same nonce, same redirect contract — no new PHP surface.
 *
 * @since 0.7.3
 */

import type { SystemDockItem } from './dock';
import { __ } from './i18n';

export const EXIT_DESKTOP_MODE_TILE_ID = 'desktop-mode-exit';

interface AdminBarConfig {
	nonce?: string;
	classicUrl?: string;
	ajaxUrl?: string;
}

declare global {
	interface Window {
		desktopModeAdminBar?: AdminBarConfig;
	}
}

/**
 * Build the dock-tile definition. Kept as a factory so desktop.ts can
 * register it the same way the OS Settings / Bug Report / PWA install
 * tiles are registered, and so the click logic stays unit-testable.
 */
export function getExitDesktopModeTileDef(): SystemDockItem {
	return {
		id: EXIT_DESKTOP_MODE_TILE_ID,
		title: __( 'Exit Desktop Mode' ),
		// `dashicons-exit` (door with arrow) is the clearest "leave"
		// glyph in the WordPress set, distinct from `dashicons-desktop`
		// used by OS Settings.
		icon: 'dashicons-exit',
		onOpen: () => {
			void exitDesktopMode();
		},
	};
}

/**
 * Disable the user's desktop-mode preference, then navigate the top
 * window to the redirect URL the server returns (or `classicUrl` if
 * the response is missing one). Mirrors the admin-bar toggle's flow in
 * `assets/js/admin-bar.js`; if the global is absent for any reason,
 * falls back to navigating straight to `wp-admin`.
 */
export async function exitDesktopMode(): Promise< void > {
	const cfg = window.desktopModeAdminBar;
	const fallback = cfg?.classicUrl || '/wp-admin/';

	if ( ! cfg?.ajaxUrl || ! cfg?.nonce ) {
		navigateTop( fallback );
		return;
	}

	const body = new URLSearchParams();
	body.set( 'action', 'save-desktop-mode' );
	body.set( 'nonce', cfg.nonce );
	body.set( 'enabled', '' );

	let target = fallback;
	try {
		const res = await fetch( cfg.ajaxUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: body.toString(),
			credentials: 'same-origin',
		} );
		if ( res.ok ) {
			const json = ( await res.json() ) as
				| { success?: boolean; data?: { redirect?: string } }
				| null;
			if ( json?.success && json.data?.redirect ) {
				target = json.data.redirect;
			}
		}
	} catch {
		// Network error — fall through to navigate to the fallback.
	}

	navigateTop( target );
}

/**
 * Drive a full top-window navigation. The dock tile may be hosted in
 * the shell page (top window) or — in tests / embedded scenarios — in
 * an iframe; either way we want the whole tab to land on the new URL.
 */
function navigateTop( url: string ): void {
	try {
		window.top!.location.href = url;
	} catch {
		window.location.href = url;
	}
}
