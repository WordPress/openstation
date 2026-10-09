export interface RecommendedOsSettings {
	dockSize?: string;
	desktopLayout?: string;
	dockPlacement?: string;
	windowRadius?: string;
	adminBarMode?: string;
	dockRailRenderer?: string;
	windowReveal?: string;
	windowRevealDuration?: number;
	wallpaper?: string;
	accentColor?: string;
	customAccent?: string;
	accent?: string;
	navPlacement?: Record< string, string >;
	widgets?: string[];
}

export interface DesktopThemeEntry {
	id: string;
	slug: string;
	name: string;
	version: string;
	author: string;
	description: string;
	previewUrl: string;
	cssUrl: string;
	cssText: string;
	tokens: Record< string, string >;
	cssDeferred: boolean;
	fonts: string[];
	icons: Record< string, string >;
	iconColors: Record< string, string >;
	recommendedOsSettings: RecommendedOsSettings;
	drawsToolbar: boolean;
	installedAt: number;
	source: 'upload' | 'code';
}

export interface DesktopThemeState {
	themes: DesktopThemeEntry[];
	activeId: string | null;
	activeIcons: Record< string, string > | null;
	activeIconColors: Record< string, string > | null;
}
