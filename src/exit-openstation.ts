/**
 * Exit OpenStation.
 *
 * The action that disables the user's openstation preference and
 * routes them back to classic admin. Its affordance lives in the
 * tray (`src/tray.ts`); this module owns only what leaving means.
 *
 * Reuses the existing `save-openstation` AJAX endpoint
 * (`includes/ajax.php`) via the `window.openStationAdminBar` global
 * already published by `includes/admin-bar.php` for the admin-bar
 * toggle. Same nonce, same redirect contract — no new PHP surface.
 */

import type { ShortcutsData } from './shortcuts';

interface AdminBarConfig {
	nonce?: string;
	classicUrl?: string;
	ajaxUrl?: string;
	/**
	 * Keyboard-shortcut reference content, translated server-side.
	 * Declared here because this module owns the global; rendered by
	 * `src/shortcuts.ts`, which owns the shape.
	 */
	shortcuts?: ShortcutsData;
}

declare global {
	interface Window {
		openStationAdminBar?: AdminBarConfig;
	}
}

/**
 * Disable the user's openstation preference, then navigate the top
 * window to the redirect URL the server returns (or `classicUrl` if
 * the response is missing one). Mirrors the admin-bar toggle's flow in
 * `assets/js/admin-bar.js`; if the global is absent for any reason,
 * falls back to navigating straight to `wp-admin`.
 */
export async function exitOpenStation(): Promise< void > {
	const cfg = window.openStationAdminBar;
	const fallback = cfg?.classicUrl || '/wp-admin/';

	if ( ! cfg?.ajaxUrl || ! cfg?.nonce ) {
		navigateTop( fallback );
		return;
	}

	const body = new URLSearchParams();
	body.set( 'action', 'save-openstation' );
	body.set( 'nonce', cfg.nonce );
	body.set( 'enabled', '' );

	let target = fallback;
	try {
		// eslint-disable-next-line no-restricted-syntax -- exit flow navigates the top frame away immediately; activity bus / spinner attribution would never be observable.
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
 * Drive a full top-window navigation. The caller may be hosted in the
 * shell page (top window) or — in tests / embedded scenarios — in an
 * iframe; either way we want the whole tab to land on the new URL.
 */
function navigateTop( url: string ): void {
	try {
		( window.top ?? window ).location.assign( url );
	} catch {
		window.location.assign( url );
	}
}

/**
 * Delay before leaving, so the toast explaining why is readable.
 */
export const LEAVE_DELAY_MS = 800;

/**
 * Leave the shell for the classic admin. Shared by every "OpenStation
 * is gone, get the user out" path so the delay and the fallback can't
 * drift apart.
 *
 * `adminUrl` rather than a reload because the current URL may be a
 * now-unroutable `admin.php?page=…`.
 */
export function leaveForClassicAdmin(
	adminUrl: string,
	delayMs: number = LEAVE_DELAY_MS,
): void {
	window.setTimeout( () => {
		if ( adminUrl ) {
			navigateTop( adminUrl );
			return;
		}
		// No admin URL (older registration / test harness). A reload
		// still beats sitting on a dead shell.
		try {
			( window.top ?? window ).location.reload();
		} catch {
			window.location.reload();
		}
	}, delayMs );
}
