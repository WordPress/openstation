/**
 * OpenStation — lazy loader for the click-opened desktop-files
 * surfaces (`files-overlays[.min].js`: share modals + URL dialog).
 *
 * The shell imports the SAME function names from here that it used
 * to import from the modules directly; each wrapper loads the bundle
 * on first call and delegates to the API the entry publishes on
 * `window.openStationFilesOverlays`. Every entry point is a
 * user-gesture handler (menu click, banner click), so the added
 * await is one same-host fetch, once, then a lookup.
 *
 * Signature note: `openUrlDialog` and the two pending-invite openers
 * were synchronous `void` functions; the wrappers keep the callable
 * shape (`void` callers still work) but the dialog now appears a
 * tick later on the very first call.
 */

import { loadVendorScript } from '../wallpapers/vendor-loader';

/** URL from the boot config; `''` disables the surfaces outright. */
function bundleUrl(): string {
	const config = (
		window as unknown as {
			openStationConfig?: { filesOverlaysBundleUrl?: string };
		}
	).openStationConfig;
	return config?.filesOverlaysBundleUrl ?? '';
}

async function api(): Promise<
	NonNullable< Window[ 'openStationFilesOverlays' ] > | null
	> {
	if ( window.openStationFilesOverlays ) {
		return window.openStationFilesOverlays;
	}
	const url = bundleUrl();
	if ( ! url ) {
		return null;
	}
	try {
		await loadVendorScript( url );
	} catch ( err ) {
		// eslint-disable-next-line no-console -- a dialog that silently never opens is undebuggable.
		console.warn(
			'[openstation] files-overlays bundle failed to load',
			err,
		);
		return null;
	}
	return window.openStationFilesOverlays ?? null;
}

type Overlays = NonNullable< Window[ 'openStationFilesOverlays' ] >;

export async function openShareSettingsModal(
	...args: Parameters< Overlays[ 'openShareSettingsModal' ] >
): Promise< void > {
	const overlays = await api();
	await overlays?.openShareSettingsModal( ...args );
}

export async function openFileShareModal(
	...args: Parameters< Overlays[ 'openFileShareModal' ] >
): Promise< void > {
	const overlays = await api();
	await overlays?.openFileShareModal( ...args );
}

export async function openPendingFileInviteModal(
	...args: Parameters< Overlays[ 'openPendingFileInviteModal' ] >
): Promise<
	Awaited< ReturnType< Overlays[ 'openPendingFileInviteModal' ] > > | undefined
> {
	const overlays = await api();
	return overlays?.openPendingFileInviteModal( ...args );
}

export async function openPendingInviteModal(
	...args: Parameters< Overlays[ 'openPendingInviteModal' ] >
): Promise<
	Awaited< ReturnType< Overlays[ 'openPendingInviteModal' ] > > | undefined
> {
	const overlays = await api();
	return overlays?.openPendingInviteModal( ...args );
}

export function openUrlDialog(
	...args: Parameters< Overlays[ 'openUrlDialog' ] >
): void {
	void api().then( ( overlays ) => overlays?.openUrlDialog( ...args ) );
}

export function closeUrlDialog(): void {
	window.openStationFilesOverlays?.closeUrlDialog();
}

/** `false` until the bundle has loaded — an unloaded dialog isn't open. */
export function isUrlDialogOpen(): boolean {
	return window.openStationFilesOverlays?.isUrlDialogOpen() ?? false;
}
