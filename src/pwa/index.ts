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
import { initPwaState } from './state';
import { installPwaInstallAffordance } from './install';
import { registerServiceWorker } from './sw-register';

export function bootstrapPwa(
	config: DesktopConfig,
	showToast: ( opts: ToastOptions ) => () => void,
): void {
	if ( ! config.pwa ) {
		return;
	}
	initPwaState( config.pwa );
	installPwaInstallAffordance(
		config.pwa.appName || 'WordPress',
		showToast,
	);
	// Fire-and-forget — registration is async but the rest of the
	// shell doesn't gate on it.
	void registerServiceWorker( config.pwa, {
		forceReplace: !! config.pwa.forceReplaceSw,
	} );
}

export { promptInstall, undismissInstallHint } from './install';
export { notify, requestNotificationPermission, getNotificationPermission } from './notify';
export { getPwaState, subscribePwaState } from './state';
export type { NotifyOptions, NotifyIntent } from './notify';
