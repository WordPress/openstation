/**
 * OpenStation — Public API barrel.
 *
 * The single canonical entry point for third-party plugin authors
 * writing TypeScript against the shell. Everything re-exported from
 * here is considered **Stable** unless its doc comment says otherwise:
 * we promise backwards-compatibility within a major version.
 *
 * Anything NOT re-exported from here is shell-internal; its path may
 * change, its shape may change, and its behavior may tighten without
 * notice. If you find yourself reaching into a non-barrel file to get
 * a type or helper that feels author-facing, open an issue — it
 * should either land here or gain a dedicated escape hatch.
 *
 * Usage:
 *
 *   ```ts
 *   import type {
 *     WidgetDef,
 *     WallpaperDef,
 *     WindowConfig,
 *   } from 'openstation';
 *   import { HOOKS } from 'openstation';
 *
 *   wp.os.hooks.addAction( HOOKS.WINDOW_OPENED, 'myplugin/track', ( e ) => {
 *     console.log( 'Window opened:', e.windowId );
 *   } );
 *   ```
 *
 * (The `openstation` package name above is aspirational — today
 * plugins are bundled alongside the shell and import relatively. When
 * we publish this as an npm-distributable d.ts bundle, this file is
 * what the `main` field points at.)
 */

// ----- Types: windows, desktops, dock, session, config -----

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

// ----- Types: wallpapers -----

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

// ----- Types: widgets -----

export type {
	WidgetContext,
	WidgetDef,
	WidgetGeometry,
	WidgetTeardown,
} from './widgets/types';

// ----- Types: modules (vendor-script registry) -----

export type { ModuleDef } from './modules/registry';

// ----- Hooks: typed constants + wrappers -----

/**
 * The canonical list of shell-dispatched hook names. Use these
 * constants instead of hand-typed strings so a renamed hook fails
 * typecheck instead of silently going dead.
 *
 * ```ts
 * wp.os.hooks.addAction(
 *     wp.os.HOOKS.ARRANGE_CASCADE_APPLIED,
 *     'myplugin/toast',
 *     ({ windowCount }) => toast(`Arranged ${windowCount} windows`)
 * );
 * ```
 */
export { HOOKS } from './hooks';

export type { WpHooks } from './hooks';

/**
 * Typed helpers around `window.wp.hooks`. Most plugins should use
 * the untyped bridge at `wp.hooks` directly — these are for authors
 * who want strict signatures on their callbacks.
 */
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

// ----- Settings tabs (OS Settings window extensibility) -----

export type { DesktopSettingsTab, SettingsTabRenderCtx } from './settings/registry';

// ----- Title-bar buttons (per-window action buttons) -----

export type {
	TitleBarButtonDef,
	TitleBarButtonRenderCtx,
} from './title-bar-buttons/registry';

// ----- Cross-window connection bridge -----

export type { ConnectOptions, WindowConnection } from './connection';

// ----- Window content relations & link renderers -----

export type {
	WindowContentRef,
	WindowLinkFrame,
	WindowLinkGroup,
	WindowLinkRendererContext,
	WindowLinkRendererDef,
	WindowRelationsApi,
} from './window-links/types';

// ----- AI Copilot programmatic API -----

export type { AskFn, AskOptions, AskResult, AskToolCall } from './ai/ask';

// ----- Drag-and-drop manager (in-shell pointer-event drag) -----

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

// ----- Cross-iframe drag bridge -----

export type {
	AttachmentDragPayload,
	DragBridgeApi,
	DragBridgePayload,
	PostDragPayload,
	UserDragPayload,
} from './drag-bridge';
export { DRAG_BRIDGE_EVENTS } from './drag-bridge';

// ----- DevTools / cross-plugin instrumentation -----

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

// ----- Public class types (for plugins that need to type-cast an
// instance returned by `wp.os.windowManager` / `.dock`) -----

export type { Window } from './window';
export type { WindowManager } from './window-manager';
export type { Dock, DockOrientation, SystemDockItem } from './dock';
export type { IconsApi } from './desktop-icons';
export type { WidgetLayer } from './widgets/layer';

// ----- The whole shell-public-API interface itself -----
//
// Plugins that want to type-cast `window.wp.os` directly (e.g.
// to satisfy a strict TS rule that flags `unknown as ...`) can import
// the interface and use it as the cast target. The ambient
// `src/global.d.ts` already augments `window.wp.os` to this type
// — the export here is for cases where the consumer needs the
// nominal name (function signatures, generics, etc.).

export type { OpenStationPublicApi } from './desktop';

// ----- Toast options + keyed-list options for plugins that wrap
// `wp.os.showToast` / `wp.os.renderKeyedList` -----

export type { ToastOptions, ToastIntent } from './toast';

// ----- PWA — install affordance + local notifications -----

export type { NotifyOptions, NotifyIntent } from './pwa';
export type { PwaConfig, PwaUserState } from './types';

// ----- DOM utilities (keyed-list reconciler) -----

/**
 * Keyed-list rendering helper for any plugin that paints a dynamic
 * list of items into a DOM container. Reuses element instances when
 * the keys match across renders so event listeners survive data
 * updates — the only reliable way to keep clicks working on rows
 * that may re-render mid-press.
 */
export {
	renderKeyedList,
	clearKeyedList,
} from './ui/util/keyed-list';
export type { KeyedListOptions } from './ui/util/keyed-list';

// ----- Native window helpers -----

/**
 * Native-window convenience wrappers. `registerWindow` is a compact
 * alias for the boilerplate-heavy `windowManager.open({ native: true, … })`
 * pattern. `cloneTemplate` is exported for advanced cases (re-cloning,
 * custom hydration) — `open_station_register_window()` plugins don't
 * need it because the shell pre-clones the template into the window
 * body before the render callback fires.
 */
export {
	cloneTemplate,
	createRegisterWindow,
	onWindow,
} from './native-windows';

export type {
	WindowLifecycleHandlers,
} from './native-windows';

// ----- Wallpaper surfaces (collision-aware wallpapers) -----

export type { WallpaperSurface } from './wallpapers/surfaces';

// ----- UI component kit (Stable) -----
//
// Every component listed below defines itself on
// `customElements` via side-effects at import time — importing
// this barrel from a plugin's bundle registers every tag. The
// classes are also named exports so plugins that need to
// subclass or type-assert them can.
//
// Each component is considered **Stable**: attribute names,
// event contracts, and `::part()` anchors won't break within a
// major release without a deprecation notice first.

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
	OsTab,
	OsTabChip,
	OsTabs,
	OsTextarea,
	OsToast,
	OsToastContainer,
	OsWindowButton,
} from './ui/components';
export type { OsAvatarPresence, OsBadgeTone, OsLogRowRenderer } from './ui/components';

// Stable variant enum for <os-button> — plugins can narrow props
// against the recognised set rather than hard-coding strings.
export type { OsButtonVariant } from './ui/components/os-button/os-button';
