import { findDockEntryForWindowId } from '../boot/geometry';
import type { DesktopConfig } from '../types';
import type { Window } from './index';
import { setSubmenuTabs } from './tabs';

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
