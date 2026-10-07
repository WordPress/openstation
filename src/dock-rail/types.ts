import type {
	DockAttentionIntensity,
	DockAttentionMode,
	DockItem,
	DockOrientation,
	DockZones,
	SubmenuItem,
	SystemDockItem,
} from '../dock';
import type { WindowManager } from '../window-manager';

export interface DockRailMountDeps {
	container: HTMLElement;

	items: DockItem[];

	fullMenu: DockItem[];

	fullSystemTiles: SystemDockItem[];
	orientation: DockOrientation;

	openItem( item: DockItem ): void;

	openSubmenuPick( item: DockItem, sub: SubmenuItem ): void;
	openSystemItem( item: SystemDockItem ): void;
	windowManager: WindowManager;
	adminUrl: string;
}

export interface DockRailController {

	replaceItems( items: DockItem[] ): void;

	setZones?( zones: DockZones ): void;

	appendSystemItem( item: SystemDockItem ): void;

	removeSystemItem( id: string ): void;

	setBadge?( itemId: string, count: number ): void;

	setAttention?(
		itemId: string,
		mode: DockAttentionMode,
		opts?: { durationMs?: number; intensity?: DockAttentionIntensity },
	): void;

	setOrientation?( orientation: DockOrientation ): void;

	destroy(): void;
}

export interface DockRailRenderer {

	id: string;

	label: string;

	description?: string;

	icon?: string;

	apiVersion?: 1;

	owner?: string;

	mount( deps: DockRailMountDeps ): DockRailController;
}
