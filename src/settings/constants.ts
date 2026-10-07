import type { AccentColor, DesktopConfig } from '../types';
import type { OsSettingsState } from './types';

export const STORAGE_KEY = 'desktop-mode-os-settings';

export const OS_SETTINGS_WINDOW_ID = 'desktop-mode-os-settings';

export const HD_MIN_WIDTH = 1920;
export const HD_MIN_HEIGHT = 1080;

export const MEDIA_PER_PAGE = 40;

export const SEARCH_DEBOUNCE_MS = 300;

export const CUSTOM_GRADIENT_ID = 'custom-gradient';

export const CUSTOM_IMAGE_ID = 'custom-image';

export const DEFAULT_WALLPAPER_ID = 'galaxy';

export const CUSTOM_ACCENT_ID = 'custom';

export const DEFAULT_ACCENTS: readonly AccentColor[] = [
	{ id: 'pulse', label: 'Pulse', value: '#f252fc' },
	{ id: 'nebula', label: 'Nebula', value: '#ec9bff' },
	{ id: 'sirius', label: 'Sirius', value: '#9af2ff' },
	{ id: 'lagoon', label: 'Lagoon', value: '#9f98ff' },
	{ id: 'starlight', label: 'Starlight', value: '#fffbff' },
	{ id: 'wp-blue', label: 'WordPress Blue', value: '#2271b1' },
	{ id: 'indigo', label: 'Indigo', value: '#3858e9' },
	{ id: 'teal', label: 'Teal', value: '#04a4cc' },
	{ id: 'emerald', label: 'Emerald', value: '#059669' },
	{ id: 'amber', label: 'Amber', value: '#d97706' },
	{ id: 'rose', label: 'Rose', value: '#e11d48' },
] as const;

export function getAccents(): readonly AccentColor[] {
	const config = ( window as unknown as {
		wp?: { os?: { config?: DesktopConfig } };
	} ).wp?.os?.config;
	const raw = config?.accentColors;
	if ( ! Array.isArray( raw ) || raw.length === 0 ) {
		return DEFAULT_ACCENTS;
	}
	const clean: AccentColor[] = [];
	for ( const entry of raw ) {
		if (
			entry &&
			typeof entry === 'object' &&
			typeof entry.id === 'string' &&
			typeof entry.label === 'string' &&
			typeof entry.value === 'string' &&
			entry.id !== '' &&
			entry.label !== '' &&
			/^#[0-9a-f]{3,8}$/i.test( entry.value )
		) {
			clean.push( { id: entry.id, label: entry.label, value: entry.value } );
		}
	}
	return clean.length > 0 ? clean : DEFAULT_ACCENTS;
}

export function getDefaultWallpaperId(): string {
	const config = ( window as unknown as {
		wp?: { os?: { config?: DesktopConfig } };
	} ).wp?.os?.config;
	const raw = config?.defaultWallpaper;
	if ( typeof raw === 'string' && raw !== '' ) {
		return raw;
	}
	return DEFAULT_WALLPAPER_ID;
}

export const DOCK_SIZES = [
	{ id: 'compact', label: 'Compact', width: 48, icon: 18 },
	{ id: 'default', label: 'Default', width: 56, icon: 20 },
	{ id: 'large', label: 'Large', width: 72, icon: 26 },
] as const;

export const WINDOW_RADII = [
	{ id: 'sharp', label: 'Sharp', value: 0 },
	{ id: 'default', label: 'Default', value: 8 },
	{ id: 'round', label: 'Round', value: 16 },
] as const;

export const OPEN_WINDOWS_AS = [
	{ id: 'default', label: 'Default' },
	{ id: 'maximized', label: 'Maximized' },
	{ id: 'focused', label: 'Focused' },
] as const;

export const ADMIN_BAR_MODES = [
	{ id: 'static', label: 'Static' },
	{ id: 'dynamic', label: 'Dynamic' },
	{ id: 'hidden', label: 'Hidden' },
] as const;

export const DOCK_BEHAVIORS = [
	{ id: 'static', label: 'Static' },
	{ id: 'dynamic', label: 'Dynamic' },
] as const;

export const DOCK_PLACEMENTS = [
	{ id: 'bottom', label: 'Bottom' },
	{ id: 'left', label: 'Left' },
	{ id: 'right', label: 'Right' },
] as const;

export const DESKTOP_LAYOUTS = [
	{ id: 'unified', label: 'Unified' },
	{ id: 'classic', label: 'Split' },
] as const;

export const DEFAULTS: OsSettingsState = {
	wallpaper: DEFAULT_WALLPAPER_ID,

	accent: 'pulse',

	customAccent: '#f252fc',
	dockSize: 'default',

	windowRadius: 'round',
	openWindowsAs: 'default',

	adminBarMode: 'hidden',

	desktopLayout: 'unified',
	dockPlacement: 'bottom',

	dockBehavior: 'static',
	sideDockBehavior: 'static',
	dockRailRenderer: 'default',

	desktopTheme: '',

	appliedThemeRecommendations: [],
	unfocusEffect: 'darken',

	windowReveal: 'none',

	windowRevealDuration: 0,
	windowLinkRenderer: 'svg-splines',
	windowLinkVisibility: 'always',
	windowLinksEnabled: true,
	windowLinkRaiseOnFocus: true,
	windowLinkHighlight: true,
	customGradient: {
		from: '#2271b1',
		to: '#7c3aed',
		angle: 135,
	},
	customImage: null,
	wallpaperSettings: {},
	libraryHdOnly: true,
	ai: {
		enabled: false,
	},

	heartbeatRate: 60,
	nativePostsEnabled: false,
	nativePostsHiddenColumns: [],

	nativePagesEnabled: false,
	nativePagesHiddenColumns: [],

	nativeUsersEnabled: false,

	nativePluginsEnabled: false,

	nativeCommentsEnabled: false,

	stationHomeEnabled: false,

	adminAssetCacheEnabled: true,
	windowPrewarmEnabled: true,
	showDesktopOnWallpaperClick: false,

	confirmCloseAllWindows: true,
	mioEnabled: false,
	mioApiEnabled: false,
	mioShowOnWallpaper: true,

	mioStyle: { appearance: {}, physics: {} },
	showPostStatusRibbons: true,
	developerModeEnabled: false,
	foldersSharingEnabled: true,
	navPlacement: {},
	navOrder: [],
	mobileLayout: 'auto',
	mobileTabs: [],
	dockPromotedPositions: {},
};
