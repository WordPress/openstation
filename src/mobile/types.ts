import type { OsModeApi } from '../mode';
import type { NavItem, NavResult } from '../nav/types';
import type { SessionWindow } from '../types';
import type { WindowManager } from '../window-manager';

export interface MobileRecents {
	list(): SessionWindow[];

	open( win: SessionWindow ): void;

	forget( id: string ): void;
	subscribe( cb: () => void ): () => void;
}

export interface MobileLayerDeps {
	manager: WindowManager;

	shell: HTMLElement;

	area: HTMLElement;
	mode: OsModeApi;

	getNav: () => NavResult | null;

	openNavItem: ( item: NavItem ) => boolean;

	getBadge: ( item: NavItem ) => number;

	getArt?: ( item: NavItem ) => string;

	subscribeArt?: ( cb: () => void ) => () => void;

	getPinnedTabIds: () => string[];

	subscribeNav: ( cb: () => void ) => () => void;
	wallpaper: {
		suspend( reason: string ): void;
		resume( reason: string ): void;
	};

	openExternal: ( url: string ) => void;

	adminUrl: string;

	renderIcon: ( icon: string, opts: { title: string; className?: string } ) => HTMLElement;
}

export interface MobileLayerHandle {

	unmount(): void;

	refresh(): void;
	goHome(): void;
	openSwitcher(): void;
	closeSwitcher(): void;

	getState(): MobileState;
}

export type MobileState = 'home' | 'app' | 'switcher';

export interface MobileApi {
	mount( deps: MobileLayerDeps ): MobileLayerHandle;
}

declare global {

	interface Window {

		openStationMobile?: MobileApi;
	}
}
