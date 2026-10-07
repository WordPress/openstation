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
