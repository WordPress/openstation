export interface WallpaperContext {

	id: string;

	prefersReducedMotion: boolean;

	visible: boolean;

	pluginUrl: string;

	settings: Record< string, unknown >;
}

export type WallpaperTeardown = () => void;
export type WallpaperMountResult = WallpaperTeardown | Promise<WallpaperTeardown>;

export type WallpaperEditor = ( container: HTMLElement, ctx: WallpaperContext ) => WallpaperMountResult;

export interface WallpaperPreviewContext extends WallpaperContext {

	params: Record< string, unknown >;

	width: number;

	height: number;
}

export type WallpaperPreview = (
	container: HTMLElement,
	ctx: WallpaperPreviewContext,
) => WallpaperMountResult;

export interface WallpaperConfigContext extends WallpaperContext {

	setSettings( partial: Record< string, string | number | boolean > ): void;
}

export type WallpaperConfig = (
	container: HTMLElement,
	ctx: WallpaperConfigContext,
) => WallpaperMountResult;

interface WallpaperDefBase {

	id: string;

	label: string;

	preview: string;

	description?: string;

	tone?: 'light' | 'dark';

	renderEditor?: WallpaperEditor;

	renderPreview?: WallpaperPreview;

	renderConfig?: WallpaperConfig;

	previewParams?: Record< string, unknown >;
}

export interface CssWallpaperDef extends WallpaperDefBase {
	type: 'css';

	value?: string;

	resolveValue?: ( ctx: WallpaperContext ) => string;
}

export interface CanvasWallpaperDef extends WallpaperDefBase {
	type: 'canvas';

	needs?: string[];

	mount: ( container: HTMLElement, ctx: WallpaperContext ) => WallpaperMountResult;
}

export type WallpaperDef = CssWallpaperDef | CanvasWallpaperDef;

export type WallpapersFilter = ( list: WallpaperDef[] ) => WallpaperDef[];
