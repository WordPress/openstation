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
	getFilesState,
	removeFolder,
	removePlacement,
	setFolderPlacements,
	subscribeFilesStore,
	upsertPlacement,
} from './store';

import {
	getFilesState,
	removeFolder,
	removePlacement,
	setFolderPlacements,
	subscribeFilesStore,
	upsertPlacement,
} from './store';

export const store = {
	getState: getFilesState,
	subscribe: subscribeFilesStore,
	setFolderPlacements,
	upsertPlacement,
	removePlacement,
	removeFolder,
};
