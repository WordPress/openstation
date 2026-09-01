/**
 * OpenStation Preferences — the app's own types.
 *
 * The SETTINGS are not app state: they are the shell's, read and
 * written through the public `wp.os` API (see `./store.ts`). The
 * app's declared state is the page the user is on; everything else
 * the window remembers between paints — an open drawer, a fetch in
 * flight, a mounted editor — is client-only and lives in `ctx.ui()`.
 */

import type { ViewContext } from '@openstation/app';
import type { TemplateResult } from '@openstation/app';
import type { OsSettingsState } from '../../../src/settings/types';
import type { AiAssistantConfig } from '../../../src/settings/types';
import type { DesktopSettingsTab } from '../../../src/settings/registry';
import type { WallpaperTeardown } from '../../../src/wallpapers/types';
import type { WallpaperPreviewManager } from './wallpaper-previews';
import type { MediaItem } from './custom-image';
import type { ComponentEntry } from './components';
import type { AboutFeedState } from './about';

/** The declared state (`App::state()` in the `.os.php`). */
export interface AppState extends Record< string, unknown > {
	/** The active page: a built-in id, or `ext-<id>` for a registry tab. */
	tab: string;
}

/** The site-wide, admin-only Extended Options. */
export interface ExtendedOptions {
	media_library_enhanced: boolean;
	games: boolean;
	agents: boolean;
}

/** What `data()` returns — the server facts that can change mid-session. */
export interface AppData {
	/** `manage_options` — gates the admin-only sections. */
	isAdmin: boolean;
	/** `upload_files` — gates the Upload source of the image picker. */
	canUpload: boolean;
	/** May upload / delete desktop themes; PICKING one is per-user and open to all. */
	canManageDesktopThemes: boolean;
	/** Null for a non-admin: the section is never painted for them. */
	extendedOptions: ExtendedOptions | null;
	/** Null when the Comments AI feature is not loaded. */
	commentsAi: { enabled: boolean; providerConfigured: boolean } | null;
	/** Null when the AI Copilot is not loaded. */
	aiAssistant: AiAssistantConfig | null;
}

/** What `App::config()` ships once with the window — the static facts. */
export interface AppExtra extends Record< string, unknown > {
	/** `wp/v2/media`. */
	mediaUrl: string;
	/** `desktop-mode/v1/desktop-themes`. */
	desktopThemesUrl: string;
	/** The authenticated admin-AJAX URL of the cached journal feed. */
	aboutFeedUrl: string;
	pluginUrl: string;
	pluginVersion: string;
}

export type Ctx = ViewContext< AppState, AppData >;

/** A section paints from the settings snapshot and the context. */
export type Section = ( s: OsSettingsState, ctx: Ctx ) => TemplateResult;

/** The media library pane's state — paginated REST results. */
export interface LibraryState {
	query: string;
	page: number;
	totalPages: number;
	loaded: MediaItem[];
	loading: boolean;
	error: string;
	/** The debounce behind the search field. */
	searchTimer: number | null;
	/** A transient upload-tile error, cleared by its own timer. */
	uploadError: string;
	uploading: boolean;
	/** A file is being dragged over the upload tile. */
	dragover: boolean;
}

/** Client-only per-window state — none of it may reach the server. */
export interface UiState {
	/** The wallpaper whose inline editor is mounted, and its teardown. */
	editor: { id: string; teardown: WallpaperTeardown | null };
	previews: WallpaperPreviewManager | null;
	imagePickerOpen: boolean;
	/** Which drawer source is showing; '' until the user picks (see `imageSource()`). */
	imageSource: '' | 'upload' | 'library';
	library: LibraryState;
	themes: { error: string; busy: boolean };
	features: {
		purging: boolean;
		resetting: boolean;
		extendedSaving: boolean;
		extendedError: string;
		commentsAiSaving: boolean;
	};
	components: {
		entries: ComponentEntry[] | null;
		activeTag: string;
		query: string;
		paintedTag: string;
	};
	/** Null until the About page is first shown. */
	about: AboutFeedState | null;
	/** The nav search: the query, and the index built on first use. */
	search: { query: string; index: Map< string, string > | null };
	/** Which registry tab each host element was last painted with. */
	mountedTabs: WeakMap< HTMLElement, DesktopSettingsTab >;
	/** Sidebar glyphs, one node per row — an SVG can only be in one place. */
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
		commentsAiSaving: false,
	},
	components: { entries: null, activeTag: '', query: '', paintedTag: '' },
	about: null,
	search: { query: '', index: null },
	mountedTabs: new WeakMap(),
	glyphs: new Map(),
} );

/** The context's `extra`, typed. */
export const extraOf = ( ctx: Ctx ): AppExtra => ctx.extra as AppExtra;

/** The context's client-only bag. */
export const uiOf = ( ctx: Ctx ): UiState => ctx.ui( freshUi );

/** The event detail every kit control carries. */
export const detailOf = < T = Record< string, unknown > >( e: Event ): T =>
	( ( e as CustomEvent ).detail ?? {} ) as T;

/** `detail.value`, as a string. */
export const pickedValue = ( e: Event ): string =>
	String( detailOf< { value?: unknown } >( e ).value ?? '' );

/** `detail.checked`, as a boolean. */
export const pickedChecked = ( e: Event ): boolean =>
	detailOf< { checked?: unknown } >( e ).checked === true;
