import type { DockItem, SystemDockItem } from '../dock';
import type { DesktopIconServerEntry } from '../types';

export type NavKind = 'core' | 'plugin' | 'app' | 'control';

export type NavPlacement = 'rail' | 'desktop' | 'both' | 'hidden';

export type NavRail = 'dock' | 'sidebar';

export type NavZone = 'core' | 'apps' | 'controls';

export type NavLayout = 'classic' | 'unified';

export interface NavItem {

	id: string;
	kind: NavKind;
	title: string;

	icon: string;

	locked?: boolean;

	defaultPlacement?: NavPlacement;

	windowId?: string;

	answersFor?: readonly string[];

	order?: number;

	menu?: DockItem;

	tile?: SystemDockItem;

	entry?: DesktopIconServerEntry;

	transient?: boolean;
}

export interface OpenWindow {

	id: string;
	title: string;
	icon: string;

	fromAdminUrl: boolean;
}

export interface NavConfig {

	placement: Record< string, NavPlacement >;

	order: string[];
}

export interface NavInput {
	items: NavItem[];
	config: NavConfig;
	layout: NavLayout;

	openWindows: readonly OpenWindow[];
}

export interface NavResult {

	dock: Record< NavZone, NavItem[] >;

	sidebar: NavItem[];

	desktop: NavItem[];

	ephemeral: ReadonlySet< string >;
}
