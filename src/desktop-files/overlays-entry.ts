/**
 * OpenStation — `files-overlays[.min].js` bundle entry.
 *
 * The click-opened desktop-files surfaces: the share-settings /
 * share-invite modals and the URL-file dialog — ~16 KB of minified
 * code the shell used to carry to every boot for dialogs most
 * sessions never open. `./overlays-loader.ts` (in the shell bundle)
 * loads this on first use and delegates through the API published
 * here.
 *
 * State safety: everything stateful these modules touch
 * (`./store`, `./shares-store`) is `createSharedStore`-backed, so
 * this bundle and the shell read and write the same state even
 * though each compiles its own copy of the module code.
 */

import {
	openFileShareModal,
	openPendingFileInviteModal,
	openPendingInviteModal,
	openShareSettingsModal,
} from './share-settings-modal';
import {
	closeUrlDialog,
	isUrlDialogOpen,
	openUrlDialog,
} from './url-dialog';

declare global {
	interface Window {
		openStationFilesOverlays?: {
			openShareSettingsModal: typeof openShareSettingsModal;
			openFileShareModal: typeof openFileShareModal;
			openPendingFileInviteModal: typeof openPendingFileInviteModal;
			openPendingInviteModal: typeof openPendingInviteModal;
			openUrlDialog: typeof openUrlDialog;
			closeUrlDialog: typeof closeUrlDialog;
			isUrlDialogOpen: typeof isUrlDialogOpen;
		};
	}
}

window.openStationFilesOverlays = {
	openShareSettingsModal,
	openFileShareModal,
	openPendingFileInviteModal,
	openPendingInviteModal,
	openUrlDialog,
	closeUrlDialog,
	isUrlDialogOpen,
};
