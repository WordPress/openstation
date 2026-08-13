/**
 * Seed the client folders map from the boot-time shell config.
 *
 * The desktop keeps folder ROWS separately from placements, and
 * anything that needs to know a folder's owner reads them there —
 * the owner-only "Share folder" title-bar button most of all, since
 * a window hands its match predicate nothing but an id.
 *
 * Nothing on the normal boot path filled that map. Placement
 * hydration (`layer.ts`) populates placements; `listFolders()` only
 * ran after a create, a rename or an untrash. So after a plain
 * reload every folder looked ownerless, and the owner of a shared
 * folder lost the control that manages its sharing until something
 * happened to repopulate the map.
 *
 * PHP inlines the rows as `filesBootFolders` using the same
 * visibility resolution and shape as GET /folders, so seeding from
 * it is indistinguishable from a REST hydration — minus the round
 * trip. One-shot by design, matching `takeBootPlacements()`: the key
 * is deleted on first read so a later re-hydration fetches fresh
 * state instead of resurrecting the boot snapshot.
 */

import { setFolders } from './store';
import type { RestFolderShape } from './rest';

interface BootFoldersConfig {
	filesBootFolders?: RestFolderShape[];
}

/**
 * @return True when a snapshot was found and applied.
 */
export function seedBootFolders(): boolean {
	const config = ( window as unknown as {
		openStationConfig?: BootFoldersConfig;
	} ).openStationConfig;
	const rows = config?.filesBootFolders;
	if ( ! config || ! Array.isArray( rows ) ) {
		return false;
	}
	delete config.filesBootFolders;
	setFolders( rows );
	return true;
}
