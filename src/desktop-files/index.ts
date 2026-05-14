/**
 * Desktop Mode — Files-on-the-desktop entry point.
 *
 * Importing this module side-effect registers the seven built-in
 * file types and the seven built-in openers with their respective
 * registries, then exposes the public API on `wp.desktop.files`.
 *
 * Higher phases extend this module with the REST/store layer
 * (Phase 2), the `FilesLayer` renderer (Phase 3), the wallpaper
 * context menu (Phase 4), the file-associations settings tab
 * (Phase 5), folder sharing + Heartbeat sync (Phase 6), and the
 * Recycle-Bin drop integration (Phase 7).
 *
 * @since 0.9.0
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
import { installShareMenuItems } from './share-menu-items';
import { installShareInviteBanner } from './share-invite-banner';
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
installShareMenuItems();
installShareInviteBanner();

/**
 * Public API surface for the files registry. Mirrored on
 * `wp.desktop.files` by `desktop.ts` so plugin authors get a
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
