export * as rest from './rest';
export {
	currentPlacement,
	getFilesState,
	removeFolder,
	removePlacement,
	setFolderPlacements,
	subscribeFilesStore,
	upsertFolder,
	upsertPlacement,
} from './store';

import {
	currentPlacement,
	getFilesState,
	removeFolder,
	removePlacement,
	setFolderPlacements,
	subscribeFilesStore,
	upsertFolder,
	upsertPlacement,
} from './store';

export const store = {
	getState: getFilesState,
	subscribe: subscribeFilesStore,
	setFolderPlacements,
	upsertPlacement,
	upsertFolder,
	removePlacement,
	removeFolder,
	currentPlacement,
};
