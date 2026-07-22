/**
 * Desktop Mode — Layer-side dependency surface.
 *
 * Re-exports the few REST + store entry points the layer
 * needs, in a tiny module so importing `layer.ts` doesn't
 * pull `index.ts` (which would create a cycle through the
 * built-in registrations).
 *
 * @since 0.9.0
 */

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
