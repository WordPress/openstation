import { loadVendorScript } from '../wallpapers/vendor-loader';

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

export function isUrlDialogOpen(): boolean {
	return window.openStationFilesOverlays?.isUrlDialogOpen() ?? false;
}
