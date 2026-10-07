export type WorkspaceLayoutId =
	| 'free'
	| 'cascade'
	| 'tile'
	| 'columns'
	| 'focus';

export const WORKSPACE_MAX_WINDOWS = 12;

export const WORKSPACE_LAYOUTS: readonly WorkspaceLayoutId[] = [
	'free',
	'cascade',
	'tile',
	'columns',
	'focus',
] as const;

export interface WorkspaceApps {
	mode: 'all' | 'only';

	ids: string[];
}

export interface WorkspaceWidgets {
	mode: 'all' | 'only';

	ids: string[];
}

export const WORKSPACE_APPEARANCE_KEYS = [
	'wallpaper',
	'wallpaperSettings',
	'customGradient',
	'customImage',
	'accent',
	'customAccent',
	'desktopTheme',
	'desktopLayout',
	'dockPlacement',
	'dockSize',
	'dockBehavior',
	'sideDockBehavior',
	'windowRadius',
	'windowReveal',
	'unfocusEffect',
	'adminBarMode',
] as const;

export type WorkspaceAppearanceKey =
	( typeof WORKSPACE_APPEARANCE_KEYS )[ number ];

export type WorkspaceAppearance = Partial<
	Record< WorkspaceAppearanceKey, unknown >
>;

export interface WorkspaceLaunch {

	match: string;

	url?: string;

	title?: string;

	gridSpan?: import( '../types' ).GridSpan;

	place?: { x: number; y: number; width: number; height: number };
}

export interface WorkspaceProfile {

	preset: string;

	icon: string;

	color: string;
	apps: WorkspaceApps;

	widgets?: WorkspaceWidgets;

	appearance?: WorkspaceAppearance;
	windows: WorkspaceLaunch[];
	layout: WorkspaceLayoutId;

	provisioned?: boolean;
}

export interface WorkspacePreset {
	id: string;

	label: string;

	description: string;
	icon: string;
	color: string;

	apps: string[];

	widgets?: string[];

	appearance?: WorkspaceAppearance;
	windows: WorkspaceLaunch[];
	layout: WorkspaceLayoutId;

	defaultLabel?: string;

	order?: number;
}

export function blankWorkspaceProfile(): WorkspaceProfile {
	return {
		preset: '',
		icon: 'dashicons-desktop',
		color: '',
		apps: { mode: 'all', ids: [] },
		widgets: { mode: 'all', ids: [] },
		appearance: {},
		windows: [],
		layout: 'free',
		provisioned: true,
	};
}
