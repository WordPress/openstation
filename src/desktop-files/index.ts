import { DefaultDesktopFile, DesktopFile } from './file';
import {
	getType,
	getTypes,
	registerType,
	resolve,
	subscribe,
	unregisterType,
	type DesktopFileTypeDef,
} from './registry';
import {
	getOpener,
	getOpeners,
	getOpenersForType,
	getUserAssociations,
	registerOpener,
	resolveOpener,
	setUserAssociations,
	subscribeOpeners,
	unregisterOpener,
	type FileOpenerDef,
	type OpenerHandler,
} from './openers';
import { installOpenDeps, openFile, type OpenDeps } from './open';
import { registerBuiltInFileTypes } from './built-in-types';
import { registerBuiltInFileOpeners } from './built-in-openers';
import { installEmbedPersistence } from './embed-window';
import { registerFileAssociationsTab } from './settings-tab';
import { seedBootFolders } from './boot-folders';
import { installShareMenuItems } from './share-menu-items';
import { installShareInviteBanner } from './share-invite-banner';
import { installUploadMenuItems } from './upload-menu-items';
import { installMediaMenuItems } from './media-menu-items';
import { installMediaDrag } from './media-drag';
import { installMediaDropTargets } from './media-drop-targets';
import { ingestPendingInvites, type PendingInvite } from './shares-store';
import { registerTilePayloadHandler } from './tile-payloads';
import * as filesRest from './rest';
import {
	getFilesState,
	getFilesStore,
	removeFolder,
	removePlacement,
	setFolders,
	setFolderPlacements,
	subscribeFilesStore,
	upsertFolder,
	upsertPlacement,
	type FilesState,
} from './store';
import type { DesktopFileShape, DesktopFileTypeServerEntry } from './types';

registerBuiltInFileTypes();
registerBuiltInFileOpeners();
installEmbedPersistence();
registerFileAssociationsTab();

seedBootFolders();
installShareMenuItems();
installUploadMenuItems();
installMediaMenuItems();
installMediaDrag();
installMediaDropTargets();

const seededPending = ( window as unknown as {
	openStationConfig?: { serverPendingShares?: PendingInvite[] };
} ).openStationConfig?.serverPendingShares;
if ( Array.isArray( seededPending ) && seededPending.length > 0 ) {
	ingestPendingInvites( seededPending );
}
installShareInviteBanner();

export const filesApi = {
	DesktopFile,
	registerType,
	unregisterType,
	getType,
	getTypes,
	resolve,
	subscribe,
	registerOpener,
	unregisterOpener,
	getOpener,
	getOpeners,
	getOpenersForType,
	resolveOpener,
	subscribeOpeners,
	getUserAssociations,
	open: openFile,

	registerTilePayloadHandler,
	rest: filesRest,
	store: {
		get: getFilesStore,
		getState: getFilesState,
		subscribe: subscribeFilesStore,
		setFolderPlacements,
		upsertPlacement,
		removePlacement,
		setFolders,
		upsertFolder,
		removeFolder,
	},
};

export type FilesApi = typeof filesApi;

export type {
	TilePayloadContext,
	TilePayloadHandler,
} from './tile-payloads';

export {
	DefaultDesktopFile,
	DesktopFile,
	getOpener,
	getOpeners,
	getOpenersForType,
	getType,
	getTypes,
	getUserAssociations,
	installOpenDeps,
	openFile,
	registerOpener,
	registerType,
	resolve,
	resolveOpener,
	setUserAssociations,
	subscribe,
	subscribeOpeners,
	unregisterOpener,
	unregisterType,
};
export {
	filesRest,
	getFilesState,
	getFilesStore,
	removeFolder,
	removePlacement,
	setFolderPlacements,
	setFolders,
	subscribeFilesStore,
	upsertFolder,
	upsertPlacement,
};
export type {
	DesktopFileShape,
	DesktopFileTypeDef,
	DesktopFileTypeServerEntry,
	FileOpenerDef,
	FilesState,
	OpenDeps,
	OpenerHandler,
};
