export type {
	Desktop,
	DesktopConfig,
	DockItemConfig,
	MonitorEntry,
	DesktopSettingsTabScriptServerEntry,
	DesktopSettingsTabServerEntry,
	DesktopTitleBarButtonScriptServerEntry,
	DesktopWallpaperServerEntry,
	DesktopWidgetServerEntry,
	NativeWindowDef,
	NativeWindowServerEntry,
	Session,
	SessionWindow,
	VisibleWindowRect,
	WindowConfig,
	WindowSnapshot,
	WindowState,
	BridgeEventFromIframe,
	BridgeEventToIframe,
} from './types';

export type {
	CanvasWallpaperDef,
	CssWallpaperDef,
	WallpaperContext,
	WallpaperDef,
	WallpaperEditor,
	WallpaperMountResult,
	WallpaperTeardown,
	WallpapersFilter,
} from './wallpapers/types';

export type {
	WidgetContext,
	WidgetDef,
	WidgetGeometry,
	WidgetTeardown,
} from './widgets/types';

export type {
	WorkAreaApi,
	WorkAreaInsets,
	WorkAreaRect,
	WorkAreaSnapshot,
} from './work-area';

export type { ModuleDef } from './modules/registry';

export { HOOKS } from './hooks';

export type { WpHooks } from './hooks';

export {
	addAction,
	addFilter,
	applyFilters,
	didAction,
	doAction,
	rawHooks,
	removeAction,
	removeFilter,
	whenReady,
	whenReady as ready,
} from './hooks';

export type { DesktopSettingsTab, SettingsTabRenderCtx } from './settings/registry';

export type {
	TitleBarButtonDef,
	TitleBarButtonRenderCtx,
} from './title-bar-buttons/registry';

export type { WindowActionDef } from './window-actions/registry';

export type { ConnectOptions, WindowConnection } from './connection';

export type {
	WindowContentRef,
	WindowLinkFrame,
	WindowLinkGroup,
	WindowLinkRendererContext,
	WindowLinkRendererDef,
	WindowRelationsApi,
} from './window-links/types';

export type { AskFn, AskOptions, AskResult, AskToolCall } from './ai/ask';

export type {
	CancelReason as DragCancelReason,
	DragManagerApi,
	DragPayload,
	DragSession,
	DropTarget as DragDropTarget,
	GhostConfig as DragGhostConfig,
	StartOpts as DragStartOpts,
} from './drag';
export { DRAG_EVENTS, DRAG_THRESHOLD_PX } from './drag';

export type {
	AttachmentDragPayload,
	DragBridgeApi,
	DragBridgePayload,
	PostDragPayload,
	UserDragPayload,
} from './drag-bridge';
export { DRAG_BRIDGE_EVENTS } from './drag-bridge';

export type {
	DebugBusApi,
	DebugEvent,
	DevtoolsApi,
	HeaderValue,
	OnRequestOptions,
	ReloadWithDebugSessionOptions,
	ReloadWithDebugSessionResult,
	RequestObservation,
	RequestObserver,
} from './devtools';

export type { Window } from './window';
export type { WindowManager } from './window-manager';
export type { Dock, DockOrientation, SystemDockItem } from './dock';
export type { IconsApi } from './desktop-icons';

export {
	osIcon,
	osIconSvg,
	osIconDataUri,
	OS_ICON_NAMES,
	OS_CORE_ICON_NAMES,
	OS_OWN_ICON_NAMES,
} from './ui/icons';
export type {
	OsIconName,
	OsIconOptions,
	OsIconRotation,
	OsIconSetApi,
} from './ui/icons';
export type { WidgetLayer } from './widgets/layer';

export type { OpenStationPublicApi } from './desktop';

export type { ToastOptions, ToastIntent } from './toast';

export type { NotifyOptions, NotifyIntent } from './pwa';
export type { PwaConfig, PwaUserState } from './types';

export {
	renderKeyedList,
	clearKeyedList,
} from './ui/util/keyed-list';
export type { KeyedListOptions } from './ui/util/keyed-list';

export {
	cloneTemplate,
	createRegisterWindow,
	onWindow,
} from './native-windows';

export type {
	WindowLifecycleHandlers,
} from './native-windows';

export type { WallpaperSurface } from './wallpapers/surfaces';

export {
	OsAvatar,
	OsBadge,
	OsButton,
	OsCheckboxLabel,
	OsCluster,
	OsCode,
	OsColorField,
	OsDisplay,
	OsEmptyState,
	OsForm,
	OsGrid,
	OsIcon,
	OsKey,
	OsLog,
	OsMenu,
	OsMenuItem,
	OsPanel,
	OsRangeField,
	OsSection,
	OsSegment,
	OsSegmented,
	OsStack,
	OsStep,
	OsSteps,
	OsSwatch,
	OsSwatchGrid,
	OsSwitch,
	OsTagInput,
	OsTab,
	OsTabChip,
	OsTabs,
	OsTextarea,
	OsToast,
	OsToastContainer,
	OsWindowButton,
} from './ui/components';
export type { OsAvatarPresence, OsBadgeTone, OsLogRowRenderer } from './ui/components';

export type { OsButtonVariant } from './ui/components/os-button/os-button';

export type { MioResponseAction, MioResponseActionContext, MioResponseContext, MioArgumentError, MioValidationResult, MioOperationOutcome, MioOperation, MioCallContext, MioTurnContext, MioTurnSummary, MioHistoryEntry, MioHistory, MioCallout, MioWindowContext, MioWindowLease, MioAbility, MioDocument, MioConversationStore, MioChatMessage } from './mio/assistant/types';
