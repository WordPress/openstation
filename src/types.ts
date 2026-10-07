import type { WindowContentRef } from './window-links/types';

export type WindowState = 'normal' | 'maximized' | 'minimized' | 'fullscreen' | 'snapped-left' | 'snapped-right';

export type DragGesture =
	| { type: 'modifier'; active: boolean; clientX: number; clientY: number }
	| { type: 'shake'; clientX: number; clientY: number };

export interface GridSpan {
	anchor: { col: number; row: number };
	cursor: { col: number; row: number };
	cols: number;
	rows: number;
}

export interface Desktop {

	id: string;

	label: string;

	profile?: import( './workspaces/types' ).WorkspaceProfile;
}

export interface WindowConfig {

	openAs?: 'default' | 'maximized' | 'focused';

	id: string;

	desktopId?: string;

	baseId?: string;

	multi?: boolean;

	url?: string;

	parentUrl?: string;

	selfLabel?: string;

	title: string;

	titleFromPage?: boolean;

	icon: string;

	x: number;

	y: number;

	width: number;

	height: number;

	minWidth: number;

	minHeight: number;

	submenu?: { title: string; url: string; offSite?: boolean }[];

	initialState?: WindowState;

	native?: boolean;

	render?: (
		body: HTMLElement,
		ctx?: NativeRenderContext,
	) =>
		| void
		| ( () => void )
		| Promise< void | ( () => void ) >;

	autofocus?: boolean | string;

	onClose?: () => void;

	onResize?: ( width: number, height: number ) => void;

	ownerHandle?: string;

	content?: WindowContentRef;

	ephemeral?: boolean;

	parentWindowId?: string;

	params?: Record< string, string | number | boolean >;

	gridSpan?: GridSpan;

	appearance?: WindowAppearance;

	loading?: {
		render?: (
			host: HTMLElement,
			ctx: { windowId: string; config: WindowConfig },
		) => void;
	};
}

export interface WindowAppearance {

	theme?: WindowThemeRef;

	controls?: WindowControlsConfig;

	slots?: Partial< Record< WindowSlotName, WindowSlotConfig > >;

	chrome?: string;
}

export type WindowThemeRef =
	| { themeId: string; tokens?: never }
	| { tokens: Record< string, string >; themeId?: never };

export interface WindowControlsConfig {
	order?: string[];
	hide?: string[];
	custom?: WindowControlInline[];
	placement?: 'left' | 'right';
}

export interface WindowControlInline {
	id: string;
	label: string;
	icon?: string;
	placement?: 'left' | 'right' | 'controls';
	order?: number;
	onClick?: ( ev: MouseEvent ) => void;
	render?: ( host: HTMLElement ) => void;
}

export type WindowSlotName =
	| 'before-titlebar'
	| 'before-icon'
	| 'icon'
	| 'title'
	| 'after-title'
	| 'before-controls'
	| 'controls'
	| 'after-controls'
	| 'after-titlebar';

export type WindowSlotConfig =
	| { html: string }
	| {
		render: ( host: HTMLElement ) => void | ( () => void );
		replace?: boolean;
	}
	| null;

export interface NativeWindowDef extends Omit< WindowConfig, 'native' | 'url' | 'submenu' | 'x' | 'y' > {

	url?: string;

	native?: true;

	x?: number;

	y?: number;

	iframeContent?: NativeWindowIframeContent;
}

export interface NativeWindowIframeContent {

	url: string;

	sandbox?: string;

	bridge?: boolean;

	onMessage?: ( payload: unknown ) => void;
}

export interface NativeRenderContext {

	window: {

		send< T = unknown >( channel: string, payload?: T ): void;

		on< T = unknown >(
			channel: string,
			cb: (
				payload: T,
				meta: { channel: string; windowId: string },
			) => void,
		): () => void;

		markLoading(): void;

		markReady(): void;
	};

	markLoading(): void;

	markReady(): void;

	signal: AbortSignal;

	onResize( cb: ( width: number, height: number ) => void ): () => void;

	onHide( cb: () => void ): () => void;

	onShow( cb: () => void ): () => void;

	params: Record< string, string | number | boolean >;
}

export interface MonitorEntry {

	ts: number;

	type: 'log' | 'warn' | 'error' | 'network' | 'shell-error' | 'iframe-error' | string;

	message: string;

	source?: string;

	status?: number;

	method?: string;

	url?: string;

	duration?: number;

	failed?: boolean;

	extra?: Record<string, unknown>;
}

export interface LazyScriptDependency {

	handle?: string;

	url: string;
	before?: string[];
	after?: string[];
	l10n?: string[];
	translations?: string;
}

export interface NativeWindowCompanionScript {
	scriptUrl: string;
	scriptHandle: string;
	scriptBefore?: string[];
	scriptAfter?: string[];
	scriptL10n?: string[];
	scriptTranslations?: string;

	scriptDeps?: LazyScriptDependency[];
}

export type NativeWindowScriptData = Record<
	string,
	{
		url: string;
		before?: string[];
		after?: string[];
		l10n?: string[];
		translations?: string;

		deps?: string[];
	}
>;

export type NativeWindowWireEntry = Omit<
	NativeWindowServerEntry,
	'scriptUrl' | 'companionScripts' | 'tabs'
> & {
	scriptUrl?: string;
	companionScripts?: Array< string | NativeWindowCompanionScript >;
	tabs?: Array<
		Omit< NativeWindowTabEntry, 'scriptUrl' > & { scriptUrl?: string }
	>;
};

export interface NativeWindowCompanionStyle {
	styleUrl: string;
	styleHandle?: string;
	styleInline?: string[];
}

export interface NativeWindowServerEntry {

	id: string;

	title: string;

	icon: string;

	placement: 'dock' | 'none';

	navKind?: 'app' | 'control';

	dockOrder?: number;

	placeable?: boolean;

	width: number;
	height: number;

	minWidth: number;
	minHeight: number;

	autofocus: boolean | string;

	templateId: string;

	templateHtml: string;

	scriptUrl: string;

	scriptHandle: string;

	scriptBefore?: string[];

	scriptAfter?: string[];

	scriptL10n?: string[];

	scriptTranslations?: string;

	scriptDeps?: LazyScriptDependency[];

	companionScripts?: NativeWindowCompanionScript[];

	preloadScript?: boolean;

	styleUrl?: string;

	styleHandle?: string;

	styleInline?: string[];

	companionStyles?: NativeWindowCompanionStyle[];

	ownerHandle: string;

	tabs?: NativeWindowTabEntry[];

	menuPages?: Array< { id: string; page: string } >;
}

export interface NativeWindowTabEntry {
	value: string;
	label: string;
	isMain: boolean;

	scriptUrl: string;

	scriptHandle: string;
	scriptBefore?: string[];
	scriptAfter?: string[];
	scriptL10n?: string[];
	scriptTranslations?: string;

	scriptDeps?: LazyScriptDependency[];
}

export interface DesktopWidgetServerEntry {
	id: string;
	label: string;
	description: string;
	icon: string;
	movable: boolean;
	resizable: boolean;
	minWidth: number;
	minHeight: number;
	maxWidth: number;
	maxHeight: number;
	defaultWidth: number;
	defaultHeight: number;

	scriptUrl: string;

	scriptHandle: string;
	scriptBefore?: string[];
	scriptAfter?: string[];
	scriptL10n?: string[];
	scriptTranslations?: string;

	scriptDeps?: LazyScriptDependency[];
}

export interface DesktopWallpaperServerEntry {
	id: string;
	label: string;
	preview: string;
	type: 'css' | 'canvas';

	value: string;

	description?: string;

	tone?: '' | 'light' | 'dark';

	scriptUrl: string;

	scriptHandle: string;
	scriptBefore?: string[];
	scriptAfter?: string[];
	scriptL10n?: string[];
	scriptTranslations?: string;

	scriptDeps?: LazyScriptDependency[];
}

export interface DesktopThemeServerEntry {
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

	icons: Record< string, string >;
	installedAt: number;
	source: 'upload' | 'code';
}

export interface DesktopGameServerEntry {
	id: string;
	title: string;

	description: string;

	icon: string;

	scoreColumns: Array< {
		key: string;
		label: string;
		type: 'number' | 'time' | 'text';
	} >;

	config: Record< string, unknown >;

	window?: {
		width?: number;
		height?: number;
		minWidth?: number;
		minHeight?: number;
	};

	scriptUrl: string;

	scriptHandle: string;
	scriptBefore?: string[];
	scriptAfter?: string[];
	scriptL10n?: string[];
	scriptTranslations?: string;

	scriptDeps?: LazyScriptDependency[];
}

export interface DesktopCommandScriptServerEntry {

	handle: string;

	scriptUrl: string;
	scriptBefore?: string[];
	scriptAfter?: string[];
	scriptL10n?: string[];
	scriptTranslations?: string;

	scriptDeps?: LazyScriptDependency[];
}

export interface DesktopDockRailRendererScriptServerEntry {
	handle: string;
	scriptUrl: string;
	scriptBefore?: string[];
	scriptAfter?: string[];
	scriptL10n?: string[];
	scriptTranslations?: string;

	scriptDeps?: LazyScriptDependency[];
}

export interface DesktopCommandServerEntry {
	slug: string;
	label: string;
	description: string;
	icon: string;
	hint: string;

	scriptUrl: string;

	scriptHandle: string;
	scriptBefore?: string[];
	scriptAfter?: string[];
	scriptL10n?: string[];
	scriptTranslations?: string;

	scriptDeps?: LazyScriptDependency[];
}

export interface DesktopSettingsTabScriptServerEntry {

	handle: string;

	scriptUrl: string;
	scriptBefore?: string[];
	scriptAfter?: string[];
	scriptL10n?: string[];
	scriptTranslations?: string;

	scriptDeps?: LazyScriptDependency[];
}

export interface DesktopTitleBarButtonScriptServerEntry {

	handle: string;

	scriptUrl: string;
	scriptBefore?: string[];
	scriptAfter?: string[];
	scriptL10n?: string[];
	scriptTranslations?: string;

	scriptDeps?: LazyScriptDependency[];
}

export interface DesktopWindowActionScriptServerEntry {

	handle: string;

	scriptUrl: string;
	scriptBefore?: string[];
	scriptAfter?: string[];
	scriptL10n?: string[];
	scriptTranslations?: string;

	scriptDeps?: LazyScriptDependency[];
}

export interface DesktopUnfocusEffectScriptServerEntry {

	handle: string;

	scriptUrl: string;
	scriptBefore?: string[];
	scriptAfter?: string[];
	scriptL10n?: string[];
	scriptTranslations?: string;

	scriptDeps?: LazyScriptDependency[];
}

export interface DesktopWindowLinkRendererScriptServerEntry {

	handle: string;

	scriptUrl: string;
	scriptBefore?: string[];
	scriptAfter?: string[];
	scriptL10n?: string[];
	scriptTranslations?: string;

	scriptDeps?: LazyScriptDependency[];
}

export interface DesktopWindowThemeScriptServerEntry {

	handle: string;

	scriptUrl: string;
	scriptBefore?: string[];
	scriptAfter?: string[];
	scriptL10n?: string[];
	scriptTranslations?: string;

	scriptDeps?: LazyScriptDependency[];
}

export interface DesktopWindowThemeServerEntry {
	id: string;
	label: string;
	tokens: Record< string, string >;
	priority: number;
	scriptUrl: string;
	scriptHandle: string;
	scriptBefore?: string[];
	scriptAfter?: string[];
	scriptL10n?: string[];
	scriptTranslations?: string;

	scriptDeps?: LazyScriptDependency[];
}

export interface DesktopWindowControlScriptServerEntry {
	handle: string;
	scriptUrl: string;
	scriptBefore?: string[];
	scriptAfter?: string[];
	scriptL10n?: string[];
	scriptTranslations?: string;

	scriptDeps?: LazyScriptDependency[];
}

export interface DesktopWindowControlServerEntry {
	id: string;
	label: string;
	icon: string;
	placement: 'left' | 'right' | 'controls';
	order: number;
	scriptUrl: string;
	scriptHandle: string;
	scriptBefore?: string[];
	scriptAfter?: string[];
	scriptL10n?: string[];
	scriptTranslations?: string;

	scriptDeps?: LazyScriptDependency[];
}

export interface DesktopWindowSlotScriptServerEntry {
	handle: string;
	scriptUrl: string;
	scriptBefore?: string[];
	scriptAfter?: string[];
	scriptL10n?: string[];
	scriptTranslations?: string;

	scriptDeps?: LazyScriptDependency[];
}

export interface DesktopWindowSlotServerEntry {
	id: string;
	slot: WindowSlotName;
	order: number;
	scriptUrl: string;
	scriptHandle: string;
	scriptBefore?: string[];
	scriptAfter?: string[];
	scriptL10n?: string[];
	scriptTranslations?: string;

	scriptDeps?: LazyScriptDependency[];
}

export interface DesktopWindowNoticeServerEntry {
	id: string;
	message: string;
	tone: 'info' | 'success' | 'warning' | 'error' | 'danger' | 'neutral';
	dismissible: boolean;
	icon?: string;
	match?: {
		window?: string;
		windows?: string[];
		urlContains?: string;
	};
	order?: number;
}

export interface DesktopWindowChromeScriptServerEntry {
	handle: string;
	scriptUrl: string;
	scriptBefore?: string[];
	scriptAfter?: string[];
	scriptL10n?: string[];
	scriptTranslations?: string;

	scriptDeps?: LazyScriptDependency[];
}

export interface DesktopWindowChromeServerEntry {
	id: string;
	label: string;
	scriptUrl: string;
	scriptHandle: string;
	scriptBefore?: string[];
	scriptAfter?: string[];
	scriptL10n?: string[];
	scriptTranslations?: string;

	scriptDeps?: LazyScriptDependency[];
}

export interface DesktopSettingsTabServerEntry {
	id: string;
	label: string;

	capability: string;

	order: number;

	scriptUrl: string;

	scriptHandle: string;
	scriptBefore?: string[];
	scriptAfter?: string[];
	scriptL10n?: string[];
	scriptTranslations?: string;

	scriptDeps?: LazyScriptDependency[];
}

export interface DesktopIconServerEntry {
	id: string;
	title: string;
	icon: string;

	window: string;

	url: string;

	position: number;

	pinned?: boolean;
}

export interface VisibleWindowRect {

	windowId: string;

	rect: { x: number; y: number; width: number; height: number };

	state: WindowState;

	element: HTMLElement;
}

export interface WindowSnapshot {
	id: string;
	url: string;
	title: string;
	icon: string;
	x: number;
	y: number;
	width: number;
	height: number;
	state: WindowState;
}

export interface DockItemConfig {

	id: string;

	title: string;

	icon: string;

	url: string;

	badge: number;

	submenu: { title: string; url: string; offSite?: boolean }[];

	selfLabel?: string;

	multi?: boolean;

	isCore?: boolean;
}

export interface SessionWindow {
	id: string;

	baseId?: string;

	desktopId?: string;

	native?: boolean;

	params?: Record< string, string | number | boolean >;

	gridSpan?: GridSpan;

	unplaced?: boolean;
	url: string;
	title: string;
	icon: string;
	state: WindowState;
	x: number;
	y: number;
	width: number;
	height: number;

	externalTabs?: { url: string; label: string }[];
}

export interface Session {
	windows: SessionWindow[];
	desktops: Desktop[];
	activeDesktop: string;
	focused: string;
	updated: number;
}

export interface MultisiteConfig {
	isNetworkAdmin: boolean;

	networkAdmin: {
		url: string;
		shellUrl: string;
		rows: Array< { title: string; url: string } >;

		foreign?: boolean;
	} | null;

	current: string;

	sites: Array< {
		id: string;
		name: string;
		shellUrl: string;

		adminUrl?: string;

		active?: boolean;
		kind?: 'local' | 'member';

		foreign?: boolean;
	} >;

	hopUrl?: string;
}

export interface UsageFeedbackConfig {

	restUrl: string;
}

export interface DesktopConfig {

	currentPage: string;

	currentTitle: string;

	currentIcon: string;

	adminUrl: string;

	homeUrl?: string;

	logoutUrl?: string;

	colorScheme: string;

	menuSig?: string;

	dockItems: DockItemConfig[];

	nativeWindows: NativeWindowWireEntry[];

	nativeWindowScriptData?: NativeWindowScriptData;

	scriptDepPayloads?: Record< string, LazyScriptDependency >;

	serverWidgets: DesktopWidgetServerEntry[];

	serverWallpapers: DesktopWallpaperServerEntry[];

	serverGames?: DesktopGameServerEntry[];

	serverDesktopThemes?: DesktopThemeServerEntry[];

	workspacePresets?: import( './workspaces/server-sync' ).WorkspacePresetServerEntry[];

	canManageDesktopThemes?: boolean;

	desktopThemesUrl?: string;

	serverCommandScripts?: DesktopCommandScriptServerEntry[];

	serverCommands?: DesktopCommandServerEntry[];

	serverSettingsTabScripts?: DesktopSettingsTabScriptServerEntry[];

	serverSettingsTabs?: DesktopSettingsTabServerEntry[];

	serverDockRailRendererScripts?: DesktopDockRailRendererScriptServerEntry[];

	serverTitleBarButtonScripts?: DesktopTitleBarButtonScriptServerEntry[];

	serverWindowActionScripts?: DesktopWindowActionScriptServerEntry[];

	serverUnfocusEffectScripts?: DesktopUnfocusEffectScriptServerEntry[];

	serverWindowLinkRendererScripts?: DesktopWindowLinkRendererScriptServerEntry[];

	serverWindowThemeScripts?: DesktopWindowThemeScriptServerEntry[];

	serverWindowThemes?: DesktopWindowThemeServerEntry[];

	serverWindowControlScripts?: DesktopWindowControlScriptServerEntry[];

	serverWindowControls?: DesktopWindowControlServerEntry[];

	serverWindowSlotScripts?: DesktopWindowSlotScriptServerEntry[];

	serverWindowSlots?: DesktopWindowSlotServerEntry[];

	serverWindowChromeScripts?: DesktopWindowChromeScriptServerEntry[];

	serverWindowChromes?: DesktopWindowChromeServerEntry[];

	serverWindowNotices?: DesktopWindowNoticeServerEntry[];

	desktopIcons?: DesktopIconServerEntry[];

	serverFileTypes?: Array< {
		id: string;
		label: string;
		sort: number;
		scriptUrl: string;
		scriptHandle: string;
		scriptBefore: string[];
		scriptAfter: string[];
		scriptL10n: Record< string, string >;
		scriptTranslations: string;
	} >;

	serverFileOpeners?: Array< {
		id: string;
		label: string;
		types: string[];
		isDefault: boolean;
		sort: number;
		scriptUrl: string;
		scriptHandle: string;
		scriptBefore: string[];
		scriptAfter: string[];
		scriptL10n: Record< string, string >;
		scriptTranslations: string;
	} >;

	userFileAssociations?: Record< string, string >;

	filesUrl?: string;

	notesUrl?: string;

	canCreatePosts?: boolean;

	shareEligibleRoles?: Array< { slug: string; name: string } >;

	currentUserId?: number;

	filesUsersSearchUrl?: string;

	folderSharesUrl?: string;

	serverWallpaperMenuItems?: Array< {
		id: string;
		label: string;
		icon?: string;
		sort?: number;
		disabled?: boolean;
		callbackId?: string;
	} >;

	session: Session;

	sessionUrl: string;

	restUrl?: string;

	mediaUrl: string;

	dropConfig?: import( './os-file-drop/types' ).DropConfig;

	desktopStorage?: {

		canUpload: boolean;

		maxBytes: number;

		quotaBytes: number;

		zipAvailable: boolean;
	};

	defaultWindowUrl: string;

	defaultWindow: { enabled: boolean; url: string };

	canUpload: boolean;

	pluginUrl: string;

	iframeBridgeUrl?: string;

	restNonce: string;

	soloWindow?: string;

	portalUrl: string;

	fromPortal: boolean;

	fromPortalIntent?: boolean;

	landInOverview?: boolean;

	arrivalDirection?: 'next' | 'prev' | '';

	hopLinkOffer?: { site: string; name: string; email: string; url: string } | null;

	pwa?: PwaConfig;

	accentColors?: AccentColor[];

	toastTypes?: ToastTypeDef[];

	coreUpdate?: {

		version: string;

		available?: string;

		branch?: string;
		url: string;

		crossing?: boolean;
	} | null;

	coreNotices?: Array< {

		id: string;

		title?: string;

		message: string;

		actionLabel?: string;

		actionUrl?: string;
	} >;

	pluginNotices?: Array< {

		id: string;

		title?: string;

		message: string;

		actionLabel?: string;

		actionUrl?: string;
	} >;

	rebrandNotice?: boolean;

	usageFeedback?: UsageFeedbackConfig | null;

	usageFeedbackBundleUrl?: string;

	seenIntros?: string[];

	seenIntrosUrl?: string;

	shellTour?: boolean;

	shellTourBundleUrl?: string;

	firstRun?: {
		installedAt?: number;
		firstEnabledAt?: number;
		enabledAt?: number;
	};

	defaultWallpaper?: string;

	osSettings?: Record<string, unknown>;

	osSettingsUrl?: string;

	aiSearchUrl?: string;

	aiAssistant?: import( './settings/types' ).AiAssistantConfig | null;

	aiStatusUrl?: string;

	aiAssistantBundleUrl?: string;

	deferredStyles?: Record< string, { url: string; inline?: string[] } >;

	gameStyleHandles?: string[];

	commandPalette?: {
		scripts: Array< {

			handle: string;
			url: string;
			before?: string[];
			after?: string[];
			l10n?: string[];
			translations?: string;
		} >;
		styles: Array< {
			handle: string;
			url: string;
			inline?: string[];
		} >;
	} | null;

	aboutFeedUrl?: string;

	shellOverlaysBundleUrl?: string;

	fileDropBundleUrl?: string;
	filesOverlaysBundleUrl?: string;
	notesBundleUrl?: string;
	dockConstellationBundleUrl?: string;
	windowLinkVisualsBundleUrl?: string;

	hasNotes?: boolean;

	componentsBundleUrl?: string;

	mio?: unknown;

	mioBundleUrl?: string;

	windowSystemBundleUrl?: string;

	mobileBundleUrl?: string;

	mode?: {
		preference?: 'auto' | 'desktop' | 'mobile';
		breakpoints?: { mobile?: number; tablet?: number };
		tabBar?: string[];
	};

	currentUserIsAdmin?: boolean;

	multisite?: MultisiteConfig | null;

	extendedOptions?: {
		media_library_enhanced: boolean;
		games: boolean;
		agents: boolean;
		network: boolean;
	} | null;

	extendedOptionsUrl?: string;

	gamesEnabled?: boolean;
}

export interface PwaUserState {
	installHintDismissed: boolean;
	notificationsEnabled: boolean;
}

export interface PwaConfig {

	manifestUrl: string;

	swUrl: string;

	swFallbackUrl?: string;

	swScope?: string;

	stateUrl: string;

	state: PwaUserState;

	appName: string;

	forceReplaceSw?: boolean;

	shellBuild?: string;
}

export interface AccentColor {
	id: string;
	label: string;
	value: string;
}

export interface ToastTypeDef {
	id: string;
	label: string;
	icon: string;
	tone: 'positive' | 'warning' | 'critical' | 'neutral';
}

export interface HarvestedCommand {
	name: string;
	label: string;
	icon?: string;

	iconSvg?: string;
	context?: string;
	kind: 'navigate' | 'action';
	url?: string;
}

export type {
	BridgeEvent,
	BridgeEventFromIframe,
	BridgeEventToIframe,
	BridgeEventType,
} from './protocol/window-messages';
