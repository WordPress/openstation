/**
 * OpenStation — Files-on-the-desktop entry point.
 *
 * Importing this module side-effect registers the ten built-in
 * file types and the ten built-in openers with their respective
 * registries, then exposes the public API on `wp.os.files`.
 *
 * Higher phases extend this module with the REST/store layer
 * (Phase 2), the `FilesLayer` renderer (Phase 3), the wallpaper
 * context menu (Phase 4), the file-associations settings tab
 * (Phase 5), folder sharing + Heartbeat sync (Phase 6), and the
 * Recycle-Bin drop integration (Phase 7).
 */

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
// Fill the folders map before anything reads folder ownership from
// it — the "Share folder" title-bar button gates on exactly that.
seedBootFolders();
installShareMenuItems();
installUploadMenuItems();
// Hydrate the shares store from the shell config snapshot BEFORE the
// banner subscribes — the heartbeat-driven path only fires the
// subscriber when new rows land, so the refresh case (rows seeded
// server-side, no heartbeat tick yet) needs the store populated up
// front for the banner's initial walk to see them.
const seededPending = ( window as unknown as {
	openStationConfig?: { serverPendingShares?: PendingInvite[] };
} ).openStationConfig?.serverPendingShares;
if ( Array.isArray( seededPending ) && seededPending.length > 0 ) {
	ingestPendingInvites( seededPending );
}
installShareInviteBanner();

/**
 * Public API surface for the files registry. Mirrored on
 * `wp.os.files` by `desktop.ts` so plugin authors get a
 * stable, namespaced entry point.
 */
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
	/**
	 * Accept drops on a desktop icon your plugin registered.
	 *
	 * Every non-folder tile carries a claimant that hard-rejects
	 * foreign payloads, so a drop doesn't fall through to the
	 * wallpaper. Fighting that claimant for the element doesn't work —
	 * the drop-target registry allows one target per element and the
	 * claimant is installed last. This is the cooperative seam: the
	 * layer keeps owning the target and consults registered handlers
	 * for the accept predicate, the hover chip, and the drop.
	 */
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
