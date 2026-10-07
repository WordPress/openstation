import { deriveWindowId } from '../utils';
import type { DesktopConfig, DockItemConfig } from '../types';

interface ShellGlobalShape {
	os?: {
		getMenuItems?: () => DockItemConfig[];
		config?: { adminUrl?: string };
	};
}

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
