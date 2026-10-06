/**
 * OpenStation — keep open windows' submenu tabs in step with the dock.
 *
 * A menu refresh replaces `config.dockItems` and repaints the dock, but
 * an iframe window built its tab strip from its dock entry when it
 * opened. This walks the open windows after each refresh and re-seeds
 * any strip whose entry's rows changed, so a window offers the same
 * sub-pages as the dock that opened it (and as the same window would
 * after a reload, which re-reads the entry in `boot/session.ts`).
 */

import { findDockEntryForWindowId } from '../boot/geometry';
import type { DesktopConfig } from '../types';
import type { Window } from './index';
import { setSubmenuTabs } from './tabs';

/**
 * Re-seed the submenu tabs of every open iframe window from the dock
 * entry its open-time identity (`baseId`) belongs to.
 *
 * A window whose entry is gone is left as it is: the menu it came from
 * no longer lists it, and there is nothing truer to show in its place.
 * Native windows are skipped, their tabs are panes the app declares.
 */
export function syncOpenWindowSubmenus(
	windows: readonly Window[],
	config: DesktopConfig,
): void {
	for ( const win of windows ) {
		if ( win.config.native ) {
			continue;
		}
		const entry = findDockEntryForWindowId(
			win.config.baseId || win.id,
			config,
		);
		if ( entry ) {
			setSubmenuTabs( win, entry );
		}
	}
}
