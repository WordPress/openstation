/**
 * OpenStation — phone layer: the cross-bundle contract.
 *
 * `mobile[.min].js` is a lazy bundle. The main bundle loads it on a
 * phone (`./loader.ts`) and hands it everything it needs through
 * {@link MobileLayerDeps}; the bundle hands back a
 * {@link MobileLayerHandle}. Nothing is imported across the seam
 * except these types, so each side keeps its own module state and
 * the shared-store rule (`AGENTS.md`) never comes up.
 *
 * Keep the surface minimal — every field is a cross-bundle call.
 */
import type { OsModeApi } from '../mode';
import type { NavItem, NavResult } from '../nav/types';
import type { SessionWindow } from '../types';
import type { WindowManager } from '../window-manager';

/**
 * Windows a phone boot chose not to restore. They stay in the
 * session (see `os.session.snapshot`) and go back to the desktop
 * untouched; the phone does not list them.
 */
export interface MobileRecents {
	list(): SessionWindow[];
	/** Open one (removing it from the recents). */
	open( win: SessionWindow ): void;
	/** Drop one without opening it. */
	forget( id: string ): void;
	subscribe( cb: () => void ): () => void;
}

export interface MobileLayerDeps {
	manager: WindowManager;
	/** `#os-shell` — the top bar and tab bar mount as its children. */
	shell: HTMLElement;
	/** `#os-area` — windows and the home grid live here. */
	area: HTMLElement;
	mode: OsModeApi;
	/** The computed navigation, `null` before the dispatcher boots. */
	getNav: () => NavResult | null;
	/** Open the window a navigation item stands for. `false` when nothing could. */
	openNavItem: ( item: NavItem ) => boolean;
	/** Live badge count for an item — server count plus client overrides. */
	getBadge: ( item: NavItem ) => number;
	/**
	 * The art an item's tile wears on the desk's rails (`setArt`), or
	 * `''` for its declared icon. The home grid paints it in place of
	 * the icon so a state a tile carries — the bin holding something —
	 * is the same on the phone.
	 */
	getArt?: ( item: NavItem ) => string;
	/** Notifies when any rail's art changes; the grid repaints. */
	subscribeArt?: ( cb: () => void ) => () => void;
	/** Ids pinned to the tab bar, user preference first, server default second. */
	getPinnedTabIds: () => string[];
	/** Fires when navigation or the pinned tabs may have changed. */
	subscribeNav: ( cb: () => void ) => () => void;
	wallpaper: {
		suspend( reason: string ): void;
		resume( reason: string ): void;
	};
	/** Open a URL outside the shell (a new browser tab). */
	openExternal: ( url: string ) => void;
	/** The admin base — window ids are derived against it. */
	adminUrl: string;
	/**
	 * The shell's icon renderer (`wp.os.renderIcon`), handed over so
	 * desktop-theme icon substitutions — state that lives in the main
	 * bundle — apply to phone tiles too.
	 */
	renderIcon: ( icon: string, opts: { title: string; className?: string } ) => HTMLElement;
}

export interface MobileLayerHandle {
	/** Tear the layer down and hand the desktop back. */
	unmount(): void;
	/** Repaint the home grid and tab bar from fresh navigation. */
	refresh(): void;
	goHome(): void;
	openSwitcher(): void;
	closeSwitcher(): void;
	/** The layer's current surface. */
	getState(): MobileState;
}

export type MobileState = 'home' | 'app' | 'switcher';

export interface MobileApi {
	mount( deps: MobileLayerDeps ): MobileLayerHandle;
}

declare global {
	// Augment the DOM `Window` (the browser global, not our class).
	// eslint-disable-next-line @typescript-eslint/no-shadow
	interface Window {
		/** Set by `src/mobile/entry.ts` once the bundle has run. */
		openStationMobile?: MobileApi;
	}
}
