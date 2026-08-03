/**
 * OpenStation — Admin-menu entry lookup for URL-based openers.
 *
 * Windows opened straight from a URL (wallpaper shortcut tiles,
 * server-registered desktop icons) historically shipped a bare
 * `{ id, url, title, icon }` config — no `submenu` / `parentUrl` /
 * `multi` — so they rendered without the in-window submenu tab
 * strip that the same window gets when opened from the dock
 * (`openItem` in `desktop-layout.ts`) or via session restore
 * (`findDockEntryForUrl` in `boot/geometry.ts`). This helper closes
 * that gap: given a target URL, find the admin-menu item the URL
 * belongs to so callers can enrich their window config with the
 * same dock metadata every other open path passes.
 *
 * Kept as a leaf module (imports only `utils` + `types`) so the
 * lazy desktop-files/icons bundles don't drag in a bundle entry as
 * a side effect — see the cross-bundle warning in AGENTS.md.
 */

import { deriveWindowId } from '../utils';
import type { DesktopConfig, DockItemConfig } from '../types';

/** Runtime shape of the `window.wp` global the lookup reads. */
interface ShellGlobalShape {
	os?: {
		getMenuItems?: () => DockItemConfig[];
		config?: { adminUrl?: string };
	};
}

/**
 * Find the dock entry — top-level item or the parent of a matching
 * submenu child — whose URL derives the same window id as `url`.
 *
 * Reads the live menu list from `wp.os.getMenuItems()` when the
 * shell API is up (it reflects live menu refreshes), falling back to
 * the boot `openStationConfig.dockItems` snapshot. Returns the
 * PARENT top-level entry in both match cases — mirroring
 * `findDockEntryForUrl()` in `boot/geometry.ts` — so callers can
 * read `submenu` / `multi` and use `entry.url` as the window's
 * `parentUrl` (the synthetic "back to parent" tab target).
 *
 * @param url Target admin URL being opened.
 * @return The matching top-level dock item, or `null`.
 */
export function findMenuEntryForUrl( url: string ): DockItemConfig | null {
	const wp = ( window.wp as ShellGlobalShape | undefined )?.os;
	const bootConfig = (
		window as unknown as { openStationConfig?: DesktopConfig }
	).openStationConfig;

	const adminUrl = wp?.config?.adminUrl ?? bootConfig?.adminUrl;
	if ( ! adminUrl ) {
		return null;
	}

	const items = wp?.getMenuItems?.() ?? bootConfig?.dockItems ?? [];
	const targetId = deriveWindowId( url, adminUrl );
	return (
		items.find(
			( item ) =>
				deriveWindowId( item.url, adminUrl ) === targetId ||
				( item.submenu ?? [] ).some(
					( sub ) => deriveWindowId( sub.url, adminUrl ) === targetId,
				),
		) ?? null
	);
}
