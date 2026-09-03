/**
 * OpenStation — PWA bootstrap.
 *
 * Single entry point called from `src/desktop.ts` after the public
 * API is mounted. Wires three concerns:
 *
 *   1. Per-user state — initialise the REST-backed snapshot from the
 *      boot config so the install pill knows whether the user already
 *      dismissed the hint.
 *   2. Service worker — register the SW (root scope, narrow fetch
 *      handler) and store the registration for later push wiring.
 *   3. Install affordance — listen for `beforeinstallprompt` and
 *      surface the pill when conditions hold.
 *
 * Notifications (`wp.os.notify`) don't need bootstrap — they
 * lazy-request permission on first call. Exported here for the
 * public-API barrel.
 */

import type { DesktopConfig } from '../types';
import type { ToastOptions } from '../toast';
import { __ } from '../i18n';
import { initPwaState } from './state';
import { installPwaInstallAffordance } from './install';
import { applyPendingUpdate, registerServiceWorker } from './sw-register';

/**
 * @param config      The boot config; a no-op without `config.pwa`.
 * @param showToast   The shell's toast.
 * @param reloadShell Reloads the desktop on the user's say-so, after
 *                    the session has reached the server. Offered — in
 *                    a toast with a Reload action — when a deploy
 *                    changed the shell's own files while this desktop
 *                    was open. The shell never reloads itself; without
 *                    this, a changed build is simply not mentioned.
 */
export function bootstrapPwa(
	config: DesktopConfig,
	showToast: ( opts: ToastOptions ) => () => void,
	reloadShell?: () => void | Promise< void >,
): void {
	if ( ! config.pwa ) {
		return;
	}
	initPwaState( config.pwa );
	installPwaInstallAffordance(
		config.pwa.appName || 'WordPress',
		showToast,
	);
	// A deploy changed the shell's own files while this desktop was
	// open: say so, once, and leave the reload to the user. Taking the
	// offer swaps the waiting worker in first, so the page that comes
	// back is served by the worker that matches it.
	const onShellUpdated = reloadShell
		? (): void => {
			showToast( {
				message: __( 'A new version of OpenStation is available.' ),
				action: {
					label: __( 'Reload' ),
					onClick: () => {
						void applyPendingUpdate().then( () => reloadShell() );
					},
				},
				persistent: true,
				dismissible: true,
			} );
		}
		: undefined;
	// Fire-and-forget — registration is async but the rest of the
	// shell doesn't gate on it.
	void registerServiceWorker( config.pwa, {
		forceReplace: !! config.pwa.forceReplaceSw,
		onShellUpdated,
	} );
}

export { promptInstall, undismissInstallHint } from './install';
export { notify, requestNotificationPermission, getNotificationPermission } from './notify';
export { getPwaState, subscribePwaState } from './state';
export type { NotifyOptions, NotifyIntent } from './notify';
