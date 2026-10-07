import type { DockItem, SubmenuItem } from '../dock';
import { tryOpenExternalUrl } from '../external-url';
import { tryNativeUrlRemap } from '../native-url-remap';
import { deriveWindowId } from '../utils';
import type { WindowManager } from '../window-manager';

function safeIcon( icon: string ): string {
	return icon.startsWith( 'dashicons-' ) ? icon : 'dashicons-admin-generic';
}

export interface ConstellationRouting {
	windowManager: WindowManager;
	adminUrl: string;
}

export function openMenuItem(
	deps: ConstellationRouting,
	item: DockItem,
): void {
	if ( item.url && tryOpenExternalUrl( item.url ) ) {
		return;
	}
	if ( item.url && tryNativeUrlRemap( item.url ) ) {
		return;
	}
	const baseId = deriveWindowId( item.url, deps.adminUrl );
	deps.windowManager.open( {
		id: baseId,
		baseId,
		url: item.url,
		parentUrl: item.url,
		title: item.title,
		icon: safeIcon( item.icon ),
		submenu: item.submenu,
		selfLabel: item.selfLabel,
		multi: !! item.multi,
	} );
}

export function openSubmenuItem(
	deps: ConstellationRouting,
	item: DockItem,
	sub: SubmenuItem,
): void {
	if ( tryOpenExternalUrl( sub.url ) ) {
		return;
	}
	if ( tryNativeUrlRemap( sub.url, { newInstance: true } ) ) {
		return;
	}
	void deps.windowManager.openNew( {
		id: deriveWindowId( sub.url, deps.adminUrl ),
		baseId: deriveWindowId( item.url, deps.adminUrl ),
		url: sub.url,
		parentUrl: item.url,
		title: item.title,
		icon: safeIcon( item.icon ),
		submenu: item.submenu,
		selfLabel: item.selfLabel,
		multi: !! item.multi,
	} );
}
