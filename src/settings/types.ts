import type { NavPlacement } from '../nav/types';
import type { MioLook } from '../mio/types';
import type {
	ADMIN_BAR_MODES,
	DOCK_BEHAVIORS,
	DOCK_SIZES,
	WINDOW_RADII,
	OPEN_WINDOWS_AS,
} from './constants';

export type AccentId = string;
export type DockSizeId = ( typeof DOCK_SIZES )[ number ][ 'id' ];
export type WindowRadiusId = ( typeof WINDOW_RADII )[ number ][ 'id' ];
export type OpenWindowsAsId = ( typeof OPEN_WINDOWS_AS )[ number ][ 'id' ];
export type AdminBarModeId = ( typeof ADMIN_BAR_MODES )[ number ][ 'id' ];
export type DockBehaviorId = ( typeof DOCK_BEHAVIORS )[ number ][ 'id' ];
export type DockPlacementId = 'left' | 'right' | 'bottom';

export type DesktopLayoutId = 'classic' | 'unified';

export interface CustomGradient {
	from: string;
	to: string;
	angle: number;
}

export interface CustomImage {
	id: number;
	url: string;
}

export interface AiSettings {
	enabled: boolean;
}

export interface AiAssistantConfig {

	available: boolean;

	providerConfigured: boolean;

	assistantProviderConfigured: boolean;

	enabled: boolean;

	connectorsUrl: string;
}

export interface OsSettingsState {
	wallpaper: string;
	accent: AccentId;

	customAccent: string;
	dockSize: DockSizeId;

	windowRadius: WindowRadiusId;

	openWindowsAs: OpenWindowsAsId;

	adminBarMode: AdminBarModeId;
	desktopLayout: DesktopLayoutId;

	dockPlacement: DockPlacementId;

	dockBehavior: DockBehaviorId;

	sideDockBehavior: DockBehaviorId;

	dockRailRenderer: string;

	desktopTheme: string;

	appliedThemeRecommendations: string[];

	unfocusEffect: string;

	windowReveal: string;

	windowRevealDuration: number;

	windowLinkRenderer: string;

	windowLinkVisibility: 'focus' | 'always' | 'off';

	windowLinksEnabled: boolean;

	windowLinkRaiseOnFocus: boolean;

	windowLinkHighlight: boolean;
	customGradient: CustomGradient;
	customImage: CustomImage | null;

	wallpaperSettings: Record<
		string,
		Record< string, string | number | boolean >
	>;

	libraryHdOnly: boolean;
	ai: AiSettings;

	heartbeatRate: 15 | 30 | 45 | 60;

	nativePostsEnabled: boolean;

	nativePostsHiddenColumns: string[];

	nativePagesHiddenColumns: string[];

	nativePagesEnabled: boolean;

	nativeUsersEnabled: boolean;

	nativePluginsEnabled: boolean;

	nativeCommentsEnabled: boolean;

	stationHomeEnabled: boolean;

	adminAssetCacheEnabled: boolean;

	windowPrewarmEnabled: boolean;

	showDesktopOnWallpaperClick: boolean;

	confirmCloseAllWindows: boolean;

	mioEnabled: boolean;

	mioApiEnabled: boolean;

	mioShowOnWallpaper: boolean;

	mioStyle: MioLook;

	showPostStatusRibbons: boolean;

	developerModeEnabled: boolean;

	foldersSharingEnabled: boolean;

	navPlacement: Record< string, NavPlacement >;

	navOrder: string[];

	mobileLayout: 'auto' | 'desktop' | 'mobile';

	mobileTabs: string[];

	dockPromotedPositions: Record< string, { x: number; y: number } >;
}
