import type { ViewContext } from '@openstation/app';
import type { TemplateResult } from '@openstation/app';
import type { OsSettingsState } from '../../../src/settings/types';
import type { AiAssistantConfig } from '../../../src/settings/types';
import type { DesktopSettingsTab } from '../../../src/settings/registry';
import type { WallpaperTeardown } from '../../../src/wallpapers/types';
import type { WallpaperPreviewManager } from '../../../src/wallpapers/preview-manager';
import type { MediaItem } from './custom-image';
import type { ComponentEntry } from './components';
import type { AboutFeedState } from './about';

export interface AppState extends Record< string, unknown > {

	tab: string;
}

export interface ExtendedOptions {
	window_prewarm: boolean;
	admin_asset_cache: boolean;
	media_library_enhanced: boolean;
	games: boolean;
	agents: boolean;
	network: boolean;
}

export interface AppData {

	isAdmin: boolean;

	canUpload: boolean;

	canManageDesktopThemes: boolean;

	extendedOptions: ExtendedOptions | null;

	aiAssistant: AiAssistantConfig | null;
}

export interface AppExtra extends Record< string, unknown > {

	mediaUrl: string;

	desktopThemesUrl: string;

	aboutFeedUrl: string;
	pluginUrl: string;
	pluginVersion: string;
}

export type Ctx = ViewContext< AppState, AppData >;

export type Section = ( s: OsSettingsState, ctx: Ctx ) => TemplateResult;

export interface LibraryState {
	query: string;
	page: number;
	totalPages: number;
	loaded: MediaItem[];
	loading: boolean;
	error: string;

	searchTimer: number | null;

	uploadError: string;
	uploading: boolean;

	dragover: boolean;
}

export interface UiState {

	editor: { id: string; teardown: WallpaperTeardown | null };
	previews: WallpaperPreviewManager | null;
	imagePickerOpen: boolean;

	imageSource: '' | 'upload' | 'library';
	library: LibraryState;
	themes: { error: string; busy: boolean };
	features: {
		purging: boolean;
		resetting: boolean;
		extendedSaving: boolean;
		extendedError: string;
	};
	components: {
		entries: ComponentEntry[] | null;
		activeTag: string;
		query: string;
		paintedTag: string;
	};

	about: AboutFeedState | null;

	search: { query: string; index: Map< string, string > | null };

	mountedTabs: WeakMap< HTMLElement, DesktopSettingsTab >;

	glyphs: Map< string, SVGSVGElement >;
}

export const freshUi = (): UiState => ( {
	editor: { id: '', teardown: null },
	previews: null,
	imagePickerOpen: false,
	imageSource: '',
	library: {
		query: '',
		page: 0,
		totalPages: 0,
		loaded: [],
		loading: false,
		error: '',
		searchTimer: null,
		uploadError: '',
		uploading: false,
		dragover: false,
	},
	themes: { error: '', busy: false },
	features: {
		purging: false,
		resetting: false,
		extendedSaving: false,
		extendedError: '',
	},
	components: { entries: null, activeTag: '', query: '', paintedTag: '' },
	about: null,
	search: { query: '', index: null },
	mountedTabs: new WeakMap(),
	glyphs: new Map(),
} );

export const extraOf = ( ctx: Ctx ): AppExtra => ctx.extra as AppExtra;

export const uiOf = ( ctx: Ctx ): UiState => ctx.ui( freshUi );

export const detailOf = < T = Record< string, unknown > >( e: Event ): T =>
	( ( e as CustomEvent ).detail ?? {} ) as T;

export const pickedValue = ( e: Event ): string =>
	String( detailOf< { value?: unknown } >( e ).value ?? '' );

export const pickedChecked = ( e: Event ): boolean =>
	detailOf< { checked?: unknown } >( e ).checked === true;
