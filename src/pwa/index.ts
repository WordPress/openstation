import type { DesktopConfig } from '../types';
import type { ToastOptions } from '../toast';
import { __ } from '../i18n';
import { initPwaState } from './state';
import { installPwaInstallAffordance } from './install';
import { applyPendingUpdate, registerServiceWorker } from './sw-register';

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

	void registerServiceWorker( config.pwa, {
		forceReplace: !! config.pwa.forceReplaceSw,
		onShellUpdated,
	} );
}

export { promptInstall, undismissInstallHint } from './install';
export { notify, requestNotificationPermission, getNotificationPermission } from './notify';
export { getPwaState, subscribePwaState } from './state';
export type { NotifyOptions, NotifyIntent } from './notify';
