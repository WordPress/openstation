/**
 * Desktop Mode — Public API barrel.
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
 *   } from 'desktop-mode';
 *   import { HOOKS } from 'desktop-mode';
 *
 *   wp.desktop.hooks.addAction( HOOKS.WINDOW_OPENED, 'myplugin/track', ( e ) => {
 *     console.log( 'Window opened:', e.windowId );
 *   } );
 *   ```
 *
 * (The `desktop-mode` package name above is aspirational — today
 * plugins are bundled alongside the shell and import relatively. When
 * we publish this as an npm-distributable d.ts bundle, this file is
 * what the `main` field points at.)
 *
 * @since 0.8.2
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
 * wp.desktop.hooks.addAction(
 *     wp.desktop.HOOKS.ARRANGE_CASCADE_APPLIED,
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
// instance returned by `wp.desktop.windowManager` / `.dock`) -----

export type { Window } from './window';
export type { WindowManager } from './window-manager';
export type { Dock, DockOrientation, SystemDockItem } from './dock';
export type { IconsApi } from './desktop-icons';
export type { WidgetLayer } from './widgets/layer';

// ----- The whole shell-public-API interface itself -----
//
// Plugins that want to type-cast `window.wp.desktop` directly (e.g.
// to satisfy a strict TS rule that flags `unknown as ...`) can import
// the interface and use it as the cast target. The ambient
// `src/global.d.ts` already augments `window.wp.desktop` to this type
// — the export here is for cases where the consumer needs the
// nominal name (function signatures, generics, etc.).

export type { WpDesktopPublicApi } from './desktop';

// ----- Toast options + keyed-list options for plugins that wrap
// `wp.desktop.showToast` / `wp.desktop.renderKeyedList` -----

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
 *
 * @since 0.22.10
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
 * custom hydration) — `desktop_mode_register_window()` plugins don't
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
	WpdAvatar,
	WpdBadge,
	WpdButton,
	WpdCheckboxLabel,
	WpdCluster,
	WpdCode,
	WpdColorField,
	WpdDisplay,
	WpdEmptyState,
	WpdGrid,
	WpdIcon,
	WpdKey,
	WpdLog,
	WpdMenu,
	WpdMenuItem,
	WpdPanel,
	WpdRangeField,
	WpdSection,
	WpdSegment,
	WpdSegmented,
	WpdStack,
	WpdStep,
	WpdSteps,
	WpdSwatch,
	WpdSwatchGrid,
	WpdTab,
	WpdTabChip,
	WpdTabs,
	WpdTextarea,
	WpdToast,
	WpdToastContainer,
	WpdWindowButton,
} from './ui/components';
export type { WpdAvatarPresence, WpdBadgeTone, WpdLogRowRenderer } from './ui/components';

// Stable variant enum for <wpd-button> — plugins can narrow props
// against the recognised set rather than hard-coding strings.
export type { WpdButtonVariant } from './ui/components/wpd-button/wpd-button';
