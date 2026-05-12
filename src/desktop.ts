/**
 * Desktop Mode — Entry Point.
 *
 * Initializes the desktop shell, restores the user's session if one
 * exists, opens the current admin page otherwise, wires session
 * persistence to change events, and normalizes the browser URL to
 * `/desktop-mode/` so the address bar shows a single stable location
 * regardless of which admin page is open in which window.
 *
 * @since 6.9.0
 */

import { WindowManager } from './window-manager';
import { installWindowSwitcherShortcut } from './window-manager/switcher';
import {
	installWindowLoadingTransitions,
} from './window/loading';
import { Dock, type DockItem, type SystemDockItem } from './dock';
import {
	bindNativeUrlRemap,
	registerNativeUrlRemap,
	tryNativeUrlRemap,
} from './native-url-remap';
import { bindAdminLinkDispatch } from './window/iframe-bridge';
// Tile-decoration helpers and the dock-selector registry live in
// `src/dock-helpers.ts` — `src/api/facade.ts` is the only consumer
// in this bundle since 0.8.1.
import { OsSettings } from './settings';
import { getExitDesktopModeTileDef } from './exit-desktop-mode';
import { deriveWindowId, urlMatchKey } from './utils';
// Static import — `setUserEditTarget` MUST run before the user-edit
// window's render callback reads the target, and the render callback
// fires synchronously inside `openById` (`manager.open` → `hydrateNative`
// → render). Going through `void import().then( setUserEditTarget )` added
// a 2-microtask delay that consistently lost the race in real-world
// network conditions: the render callback's own `.then` chain queued
// before the setUserEditTarget chain resolved, `readUserEditTarget`
// returned `null`, the fallback to `cfg.currentUserId` kicked in, and
// the form mounted for the viewer instead of the clicked user.
import { setUserEditTarget as setUserEditTargetSync } from './posts-window/user-edit-target';
import {
	HOOKS,
	addAction,
	doAction,
	type WpHooks,
} from './hooks';
import { WallpaperLayer } from './wallpapers/layer';
import { createWallpaperRegistrySync } from './wallpapers/server-sync';
import { createCommandRegistrySync } from './commands/server-sync';
import { createSettingsTabRegistrySync } from './settings/server-sync';
import {
	type DesktopSettingsTab,
	type OsSettingsSnapshot,
} from './settings/registry';
import {
	type TitleBarButtonDef,
} from './title-bar-buttons/registry';
import { createTitleBarButtonRegistrySync } from './title-bar-buttons/server-sync';
import { createDockRailRendererSync } from './dock-rail/server-sync';
import {
	type WindowThemeDef,
} from './window-chrome/themes/registry';
import { createWindowThemeRegistrySync } from './window-chrome/themes/server-sync';
import {
	type WindowControlDef,
} from './window-chrome/controls/registry';
import { registerBuiltInControls } from './window-chrome/controls/built-ins';
import { createWindowControlRegistrySync } from './window-chrome/controls/server-sync';
import {
	type WindowSlotDef,
} from './window-chrome/slots/registry';
import { createWindowSlotRegistrySync } from './window-chrome/slots/server-sync';
import {
	type WindowChromeDef,
} from './window-chrome/chrome/registry';
import { createWindowChromeRegistrySync } from './window-chrome/chrome/server-sync';
import {
	createConnectionBridge,
	type WindowConnection,
	type ConnectOptions,
} from './connection';
import { IframeCommandBridge } from './commands/iframe-bridge';
import { type ScriptExtras } from './wallpapers/vendor-loader';
import {
	type WallpaperSurface,
} from './wallpapers/surfaces';
import { WidgetLayer } from './widgets/layer';
import {
	createNativeWindowSync,
	createRegisterWindow,
	type WindowLifecycleHandlers,
} from './native-windows';
import { iconsApi, renderDesktopIcons, type IconsApi } from './desktop-icons';
import {
	createLayoutDispatcher,
	type LayoutDispatcher,
} from './desktop-layout';
// `createApplyPayload` is consumed inside `boot/menu-refresh.ts` since 0.8.1.
import { AiAssistantStub, type AiAssistantApi } from './ai-assistant';
import { createAsk } from './ai/ask';
import {
	attachBroadcastBus,
	installBroadcastReceiver,
} from './broadcast';
import { startRecycleBinBadge, _currentRecycleBinBadge } from './recycle-bin/badge';
import { registerBuiltInPeekRenderers } from './dock-peek/built-in-renderers';
import {
	BUG_REPORT_WINDOW_ID,
	renderBugReport,
} from './bug-report';
import { showToast, type ToastOptions } from './toast';
import {
	bootstrapPwa,
	type NotifyOptions,
} from './pwa';
import {
	getInstallTileDef,
	isStandaloneDisplay,
	isLikelyInstalled,
} from './pwa/install';
import { type KeyedListOptions } from './ui/util/keyed-list';
import { DragBridge, type DragBridgeApi } from './drag-bridge';
import { DragManager, type DragManagerApi } from './drag';
import {
	type DesktopCommand,
} from './commands';
import { registerBuiltInCommands } from './built-in-commands';
import {
	registerPalette,
	openPaletteOnly,
	installPaletteShortcut,
	type Palette,
} from './palette-registry';
import { type SharedStore } from './shared-store';
import {
	bootPresenceProbe,
	type PresenceApi,
} from './presence';
import { type ActivityApi } from './activity';
import { bootHeartbeatBus, type HeartbeatBus } from './heartbeat';
import { bindTopWindowLinkInterceptor } from './boot/link-interceptor';
import { bindMenuRefresh } from './boot/menu-refresh';
import { openCurrentPage, restoreSession } from './boot/session';
import { createSessionSaver } from './boot/session-saver';
import { bindShellLifecycle, wireSessionEvents } from './boot/shell-lifecycle';
import { trackedFetch } from './boot/tracked-fetch';
import { buildPublicApi, installPublicApi } from './api/facade';
import { setCurrentLayout } from './layout';
import {
	installShortcutsSync,
	syncShortcutsWithVisibility,
} from './settings/desktop-shortcuts-sync';

// `INITIAL_ORIGIN` lives in `src/boot/origin.ts` since 0.8.1 so every
// boot-time consumer reaches the same captured value — see the import
// further down for the canonical reference.
import { registerBuiltInWidgets } from './widgets/built-in';
import {
	installDefaultDockRailRenderer,
	type DockRailRenderer,
} from './dock-rail';
import { createWidgetRegistrySync } from './widgets/server-sync';
import { WPD_COMPONENT_TAGS } from './ui/components/tags';
import {
	registerModule,
	type ModuleDef,
} from './modules/registry';
import { wpdConfirm } from './wpd-confirm';
import { preloadShellOverlays } from './shell-overlays/loader';
import { preloadWindowSystem } from './window-system/loader';
import type { WallpaperDef } from './wallpapers/types';
// Built-in plugins used to be side-effect-imported from `./plugins`.
// As of 0.8.4 each built-in plugin ships as its own lazy-loaded
// bundle and is registered through the same server-side
// `desktop_mode_register_wallpaper()` / `desktop_mode_register_*()` APIs
// third-party plugins use, so the shell no longer pulls them into
// `desktop.min.js`. See `includes/wallpapers.php` for the animated
// WP logo wallpaper's registration.
import {
	filesApi,
	filesRest,
	installOpenDeps as installFilesOpenDeps,
	setUserAssociations as setFilesUserAssociations,
	type FilesApi,
} from './desktop-files';
import { mountFilesLayer } from './desktop-files/layer';
import { installRecycleBinDropTargets } from './desktop-files/recycle-bin-targets';
import { startFilesHeartbeat } from './desktop-files/heartbeat';
import { startFilesRestoreSync } from './desktop-files/restore-sync';
import { buildOccupiedSet, snapToEmptyCell } from './desktop-files/grid';
import {
	buildMenuItems as buildWallpaperMenuItems,
	closeWallpaperMenu,
	isWallpaperMenuOpen,
	openWallpaperMenu,
	type ServerWallpaperMenuItem,
	type SortMode as RootSortMode,
} from './desktop-files/wallpaper-menu';
import { openCreateFolderDialog } from './desktop-files/create-folder-dialog';
import { openUrlDialog } from './desktop-files/url-dialog';
import type {
	DesktopConfig,
	NativeWindowDef,
} from './types';
import type { Window as DesktopWindow } from './window';

/* -------------------------------------------------------------------
 * Pre-bootstrap shim — installs `window.wp.desktop` synchronously at
 * module-parse time with a queueing `whenReady` so consumer scripts
 * loaded with `array( 'desktop-mode' )` as their dep don't race the
 * shell's `init()` execution.
 *
 * Why this exists: WordPress only orders the consumer's `<script>`
 * tag AFTER `desktop.js` in the DOM — it doesn't wait for our
 * bundle's bootstrap to finish. A consumer IIFE that runs the
 * documented recipe…
 *
 *     wp.desktop.whenReady( () => { … } );
 *
 * …could fire before `init()` reached the
 * `window.wp.desktop = desktopApi` assignment, blowing up with
 * `wp.desktop.whenReady is not a function`.
 *
 * The shim:
 *   1. Sets up `window.wp.desktop` immediately with `whenReady` /
 *      `ready` / `isReady`. `whenReady` queues callbacks into a
 *      module-local array.
 *   2. Bootstrap merges the full API onto the same object via
 *      `Object.assign` (NOT reassign — we'd otherwise lose the
 *      shim's closure binding to the queue).
 *   3. After HOOKS.INIT fires, the bootstrap drains the queue.
 *
 * Re-runs are idempotent: a previous installation is left alone so
 * a duplicate enqueue / HMR reload doesn't blow away the queue.
 *
 * @since 0.6.1
 */
const _earlyReadyQueue: Array< () => void > = [];
let _earlyReady = false;

( function installEarlyDesktopShim() {
	const w = window as { wp?: { desktop?: unknown } };
	if ( ! w.wp ) {
		w.wp = {};
	}
	if ( w.wp.desktop ) {
		// Either the bootstrap already ran (full API installed) or
		// a previous module load already set up this shim. Either
		// way, leave it alone — the bootstrap's `Object.assign`
		// path tolerates an already-shimmed slot.
		return;
	}
	const shim = {
		whenReady( cb: () => void ): void {
			if ( typeof cb !== 'function' ) {
				return;
			}
			if ( _earlyReady ) {
				// Microtask-defer so the cb runs in the same
				// async-shape consumers see post-bootstrap. The
				// real `whenReady` (in `src/hooks.ts`) does the
				// same.
				Promise.resolve().then( cb );
				return;
			}
			_earlyReadyQueue.push( cb );
		},
		ready( cb: () => void ): void {
			shim.whenReady( cb );
		},
		isReady(): boolean {
			return _earlyReady;
		},
	};
	// Cast through unknown — the shim is a partial implementation;
	// the bootstrap's Object.assign fills in the rest before any
	// consumer reads beyond `whenReady` / `ready` / `isReady`.
	w.wp.desktop = shim as unknown;
}() );

/** Stable id for the OS Settings native window. */
const OS_SETTINGS_WINDOW_ID = 'desktop-mode-os-settings';

/**
 * Public surface exposed on `window.wp.desktop`. Third-party plugins
 * rely on these members being stable — new fields may be added over
 * time, but nothing here is removed without a major-version bump.
 */
export interface WpDesktopPublicApi {
	windowManager: WindowManager;
	/**
	 * Primary (bottom) dock instance. Present in every layout. May
	 * be replaced when the user switches `desktopLayout` in OS
	 * Settings — plugins that cache a reference should listen for
	 * the `desktop-mode-layout-changed` CustomEvent on `document` and
	 * re-fetch from `wp.desktop.dock`.
	 */
	dock: Dock | null;
	/**
	 * Side (left) dock instance — only non-null when the active
	 * layout is `classic`. Holds core admin menus while the bottom
	 * dock holds plugin menus. `null` in `unified` and `spatial`.
	 *
	 * @since 0.18.0
	 */
	sideDock: Dock | null;
	/**
	 * Currently-active desktop layout. Mirrors
	 * `OsSettingsSnapshot.desktopLayout`; the framework writes
	 * `data-desktop-mode-layout` on the shell root with this value so
	 * plugins can also key off the attribute via CSS.
	 *
	 * @since 0.18.0
	 */
	desktopLayout: 'classic' | 'unified' | 'spatial';
	/**
	 * Wallpaper-icon rail — the second badge surface alongside the
	 * dock. Mirrors `Dock.setBadge` exactly:
	 *
	 * ```ts
	 * wp.desktop.icons.setBadge( 'desktop-mode-messages', 5 );
	 * wp.desktop.icons.setBadge( 'desktop-mode-messages', 0 );  // clear
	 * ```
	 *
	 * Every change publishes `desktop-mode/badge-changed` on the
	 * activity bus with `rail: 'icon'` (the same channel the dock
	 * publishes to with `rail: 'dock'`), and fires
	 * {@link HOOKS.ICON_BADGE_CHANGED} on the hook bus with
	 * `{ iconId, count, previousCount }`. Badges survive a full
	 * grid rebuild — set once, the framework re-paints across
	 * every live menu refresh.
	 *
	 * Plugin authors writing a single badge wrapper for both
	 * rails can fan a count to every surface idempotently:
	 *
	 * ```ts
	 * function setBadgeEverywhere( id: string, count: number ): void {
	 *     wp.desktop.dock?.setBadge?.(    id, count );
	 *     wp.desktop.icons?.setBadge?.(   id, count );
	 * }
	 * ```
	 *
	 * @since 0.24.0
	 */
	icons: IconsApi;
	/**
	 * Files-on-the-desktop registry. Plugin authors register custom
	 * file types via `wp.desktop.files.registerType`, resolve a
	 * serialized shape into a `DesktopFile` instance via
	 * `wp.desktop.files.resolve`, and read the full type list via
	 * `wp.desktop.files.getTypes`. Higher phases extend this surface
	 * with the opener registry (`open`, `registerOpener`), the
	 * placement REST client, and the `FilesLayer` mount helpers.
	 *
	 * @since 0.9.0
	 */
	files: FilesApi;
	/**
	 * Promise-returning Yes/No prompt. Drop-in replacement for
	 * `window.confirm()` that uses the framework's
	 * `<wpd-confirm-dialog>` so the prompt matches the rest of
	 * the desktop visually.
	 *
	 * ```ts
	 * if ( await wp.desktop.confirm( {
	 *     title: 'Delete?',
	 *     message: 'Cannot undo.',
	 *     danger: true,
	 * } ) ) {
	 *     // …
	 * }
	 * ```
	 *
	 * @since 0.9.0
	 */
	confirm: ( options: import( './ui/components/wpd-confirm-dialog/wpd-confirm-dialog' ).WpdConfirmOptions ) => Promise< boolean >;
	saveSession: () => void;
	/** Raw `@wordpress/hooks` bridge. Alias of `window.wp.hooks`. */
	hooks: WpHooks;
	/**
	 * Typed constants for every hook the shell dispatches. Use these
	 * in `wp.desktop.hooks.addAction()` / `addFilter()` calls instead
	 * of hand-typed strings so a renamed hook fails typecheck in your
	 * editor instead of silently going dead.
	 *
	 * ```ts
	 * wp.desktop.hooks.addAction(
	 *     wp.desktop.HOOKS.ARRANGE_CASCADE_APPLIED,
	 *     'myplugin/toast',
	 *     ( e ) => console.log( 'Cascade applied', e )
	 * );
	 * ```
	 */
	HOOKS: typeof import( './hooks' ).HOOKS;
	/**
	 * True when the desktop shell is mounted and active on this page.
	 * Cheap capability check for plugins that also run in classic
	 * admin and want to branch without probing `document.getElementById`.
	 */
	isActive: () => boolean;
	/** Convenience: register a wallpaper via `desktop-mode.wallpapers` filter. */
	registerWallpaper: ( def: WallpaperDef ) => void;
	/** Convenience: register a widget via `desktop-mode.widgets` filter. */
	registerWidget: ( def: import( './widgets/types' ).WidgetDef ) => void;
	/**
	 * Live reference to the shell's widget layer (or `null` when the
	 * widget DOM element isn't present). Companion plugins use the
	 * public `add( id )` / `remove( id )` / `ensureMounted( id )`
	 * methods to pin or unpin their widget programmatically — e.g.
	 * a monitor plugin that auto-surfaces its widget on the first
	 * error burst, or an onboarding flow that guarantees the
	 * quick-start widget is present on a new user's first visit.
	 */
	widgetLayer: WidgetLayer | null;
	/**
	 * Register a shell-level system tile (a JS-owned launcher that
	 * isn't part of the admin menu — a quick-notes panel, a
	 * native-window tool) on the unified dock rail. Tiles always
	 * land on the dock; placement is the user's pref (left / right /
	 * bottom) and applies uniformly.
	 */
	registerSystemTile: ( item: SystemDockItem ) => void;
	/**
	 * Open a native window from a compact {@link NativeWindowDef}
	 * with sensible shell-provided defaults (`native: true`,
	 * fallback `#<id>` url, default min-size, default initial
	 * size). Idempotent on `id` — opening a window that's already
	 * open focuses the existing instance instead of stacking a
	 * duplicate.
	 *
	 * Prefer this over direct `windowManager.open({ native: true,
	 * ... })` calls: plugins declare only what they care about, and
	 * the shell fills in the boilerplate.
	 */
	registerWindow: ( def: NativeWindowDef ) => Promise< DesktopWindow >;
	/**
	 * Open (or focus) a server-registered native window by id —
	 * the same path the dock click + wallpaper-icon click go
	 * through, so callers inherit the cloned-template body that
	 * `desktop_mode_register_window( 'template' )` declared.
	 *
	 * Returns `true` if the window was opened (or already open and
	 * was focused), `false` if no native window is registered with
	 * that id. Used by the global Cmd/Ctrl+Shift+E shortcut, by
	 * the AI Copilot's "open editor" tool, and by plugin authors
	 * that want to surface a sister-plugin's window.
	 *
	 * @since 0.18.0
	 */
	openWindow: ( id: string, opts?: { source?: string } ) => boolean;
	/**
	 * Spawn a brand-new instance of a registered native window — even
	 * when one is already open. Returns `true` when the registry
	 * matched the id (a fresh window with id `<base>-2` / `-3` / … is
	 * now mounted), `false` when no native window is registered.
	 *
	 * Powers the dock-peek "+" button for native windows so they
	 * behave like iframe windows do: every "+" yields a duplicate.
	 *
	 * @since 0.19.0
	 */
	openNewWindow: ( id: string, opts?: { source?: string } ) => boolean;
	/**
	 * Wrapper around native `fetch()` that attributes the request to
	 * a desktop window's activity indicator. While the fetch is in
	 * flight the window's title-bar dot blinks like a modem activity
	 * LED; on success it flashes "saved", on failure "couldn't save"
	 * (with the error as a tooltip).
	 *
	 * Identical signature to `fetch()` plus one extra options object:
	 *
	 *   - `windowId?: string` — explicit attribution. Wins over
	 *     `window` when both are passed.
	 *   - `window?: Window`   — direct reference to a `Window`
	 *     instance. Use when you have the handle in scope.
	 *   - `silent?: boolean`  — track but do NOT pulse the indicator.
	 *     Reserved for background polls (heartbeat, presence) that
	 *     shouldn't blink the title bar every tick.
	 *
	 * Default attribution: the focused window at call time. So
	 * `wp.desktop.fetch( '/wp-json/myapi/v1/save', { method: 'POST' } )`
	 * inside a click handler "just works" — the click focused the
	 * window, the fetch attributes to it, the title bar pulses.
	 *
	 * Returns the same Response Promise as native `fetch()`. Errors
	 * propagate unchanged (the indicator just adds a "failed" pulse
	 * before the rejection bubbles up).
	 *
	 * @since 0.8.0
	 */
	fetch: (
		input: RequestInfo | URL,
		requestInit?: RequestInit,
		opts?: { windowId?: string; window?: DesktopWindow; silent?: boolean },
	) => Promise< Response >;
	/**
	 * Clone a `<template>` element's contents into a fresh
	 * `DocumentFragment`. Convenience wrapper — accepts either the
	 * element's DOM id or the element itself. Throws if the
	 * reference doesn't resolve to a template.
	 */
	cloneTemplate: ( template: string | HTMLTemplateElement ) => DocumentFragment;
	/**
	 * Subscribe to a specific window's lifecycle events by id.
	 * Returns an unsubscribe function; by default also
	 * auto-unsubscribes when the window closes (suits one-shot
	 * per-instance subscribers). Pass `{ persistent: true }` for
	 * app-lifetime subscribers that need to keep firing across
	 * every open/close cycle (badge policies, toast suppression).
	 *
	 * See {@link WindowLifecycleHandlers}.
	 */
	onWindow: (
		id: string,
		handlers: WindowLifecycleHandlers,
		options?: { persistent?: boolean },
	) => () => void;
	/**
	 * Build an infinite-scroll renderer wired to a sentinel-driven
	 * `IntersectionObserver`, an `AbortController` that cancels
	 * in-flight pages on `reset()` / `destroy()`, dedup-by-id, and
	 * cursor pagination. The five pieces every feed-reader plugin
	 * was reinventing — bundled into one helper.
	 *
	 * ```ts
	 * const list = wp.desktop.createInfiniteList< Post >( {
	 *     root,
	 *     fetchPage: async ( cursor, signal ) => {
	 *         const res  = await wp.desktop.fetch(
	 *             '/wp-json/myplugin/v1/feed?cursor=' + ( cursor ?? '' ),
	 *             { signal },
	 *         );
	 *         const json = await res.json();
	 *         return { items: json.items, nextCursor: json.next };
	 *     },
	 *     getId:      ( post ) => post.id,
	 *     renderItem: ( post ) => buildLi( post ),
	 * } );
	 * // On filter change: list.reset();
	 * // On window close: list.destroy();
	 * ```
	 *
	 * See `docs/examples/infinite-list.md` for the full recipe and
	 * the {@link InfiniteListOptions} reference.
	 *
	 * @since 0.8.2
	 */
	createInfiniteList: < TItem >(
		options: import( './infinite-list' ).InfiniteListOptions< TItem >,
	) => import( './infinite-list' ).InfiniteList;
	/**
	 * Start the OAuth relay flow for `service`. The framework owns
	 * the `state`-nonce + popup + `postMessage` round-trip; the
	 * plugin only declares the service via PHP
	 * `desktop_mode_register_oauth_relay( 'tumblr', [...] )` and
	 * persists the tokens its `on_success` callback receives.
	 *
	 * Returns a Promise that resolves with the success payload
	 * (`{ ok: true, service }`) or rejects with a tagged Error
	 * whose `cause` is the failure payload (`reason` =
	 * `'invalid_state' | 'authorize_denied' | 'token_exchange_failed' |
	 * …`).
	 *
	 * ```ts
	 * try {
	 *     await wp.desktop.startOAuth( 'tumblr' );
	 *     toast( 'Connected to Tumblr.' );
	 * } catch ( err ) {
	 *     toast( err.message );
	 * }
	 * ```
	 *
	 * @since 0.8.2
	 */
	startOAuth: (
		service: string,
		options?: import( './oauth-relay' ).StartOAuthOptions,
	) => Promise< import( './oauth-relay' ).OAuthCallbackPayload >;
	/**
	 * Load a vendor script once, memoized. The optional `extras` bag
	 * mirrors what `desktop_mode_resolve_script_payload()` harvests
	 * from a registered handle's `wp_localize_script` /
	 * `wp_add_inline_script` / `wp_set_script_translations` data.
	 * Bundles loaded via the shell's native-window / widgets / commands
	 * sync paths get this for free; the public surface exposes the
	 * primitive for parity. See `src/wallpapers/vendor-loader.ts`.
	 */
	loadVendorScript: ( url: string, extras?: ScriptExtras ) => Promise<void>;
	/**
	 * Live list of collision surfaces for wallpaper effects —
	 * window tops, shell floor, dock edge, widget
	 * cards, plus anything plugins added via the
	 * `desktop-mode.wallpaper.surfaces` filter. Rects are in
	 * viewport coordinates. Call each frame (or throttled) from a
	 * canvas wallpaper to rebuild its collision cache.
	 */
	getWallpaperSurfaces: () => WallpaperSurface[];
	/**
	 * Register a shared vendor module so other plugins can `needs:` it
	 * by id. Built-in ids (`pixijs`, …) are pre-registered by the shell.
	 */
	registerModule: ( def: ModuleDef ) => void;
	/** Imperatively load one or more registered modules. Usually unnecessary — canvas wallpapers declare `needs[]` and the shell resolves automatically. */
	loadModules: ( ids: string[] ) => Promise<void>;
	/** Run `cb` after `desktop-mode.init` has fired (immediately if already fired). */
	whenReady: ( cb: () => void ) => void;
	/**
	 * Short alias of {@link whenReady}. The idiomatic entry point for
	 * plugin scripts — especially those loaded late by server-sync
	 * (widgets, wallpapers, commands, settings tabs) after
	 * `desktop-mode.init` has already fired. Mirrors the ergonomics of
	 * `jQuery( fn )`: the callback runs synchronously (via microtask)
	 * if the shell is already booted, otherwise queues.
	 *
	 * ```js
	 * wp.desktop.ready( () => {
	 *     wp.desktop.registerSettingsTab( { ... } );
	 * } );
	 * ```
	 *
	 * @since 0.17.0
	 */
	ready: ( cb: () => void ) => void;
	/**
	 * Synchronously report whether the shell's `desktop-mode.init` action
	 * has fired. Lets late-loading plugin code branch between
	 * "register directly" and "schedule via whenReady" without racing.
	 *
	 * @since 0.14.0
	 */
	isReady: () => boolean;
	/**
	 * Update the user's "default window" preference — the window that
	 * opens when the user enters the portal with no saved session.
	 *
	 * - Passing a URL makes it the default (the shell clamps to
	 *   same-origin wp-admin URLs; invalid URLs reject).
	 * - Passing `null` disables the default entirely, giving the user
	 *   an empty desktop on portal entry.
	 *
	 * Updates `config.defaultWindow` in place and dispatches the
	 * `desktop-mode-default-window-changed` CustomEvent on `document`
	 * so the ⋯-menu checkmarks repaint.
	 */
	setDefaultWindow: ( url: string | null ) => Promise<void>;
	/**
	 * Force a refresh of the live admin-menu split and repaint both
	 * rails. Invoked automatically when a windowed `plugins.php`
	 * signals an activation / deactivation; plugins that mutate the
	 * admin menu server-side outside that flow can call this directly
	 * to surface their changes without a full reload.
	 *
	 * Implemented as a hidden 1×1 iframe pointing at
	 * `admin.php?desktop_mode_chromeless=1&desktop_mode_menu_refresh=1` whose
	 * chromeless bridge postMessages a fresh payload from real admin
	 * context. Same pipeline as the auto-refresh path, so plugin
	 * menus that gate on `is_admin()` register correctly.
	 */
	refreshMenu: () => Promise<void>;
	/**
	 * The `DesktopConfig` that booted this shell. Read-only for plugins
	 * — useful for picking up `pluginUrl` and other PHP-sourced bits.
	 */
	config: DesktopConfig;
	/**
	 * AI Assistant spotlight overlay. Open it programmatically with
	 * `wp.desktop.ai.open()`, or let the global Cmd+K shortcut handle
	 * it. The admin-bar "Ask AI ⌘K" button dispatches the
	 * `desktop-mode-open-ai` event on `document`, which the assistant
	 * also listens for — no direct reference needed.
	 *
	 * @since 0.14.0
	 */
	ai: AiAssistantApi;
	/**
	 * Cross-window drag bridge — the authoritative carrier for
	 * attachment payloads that cross iframe boundaries (Media Library
	 * → post editor). Source iframes call `window.parent.postMessage`
	 * with a `desktop-mode-drag-start` payload; this bridge stores it
	 * and replies to `desktop-mode-drag-payload-request` messages from
	 * receiver iframes during their drop handlers.
	 *
	 * @since 0.14.0
	 */
	dragBridge: DragBridgeApi;
	/**
	 * Centralized in-shell drag-and-drop manager. Owns every pointer-
	 * based drag in the parent shell — file tiles on the wallpaper,
	 * entity tiles inside My WordPress, and any plugin surface that
	 * registers a draggable element via `dragManager.start()`.
	 *
	 * Distinct from {@link dragBridge}: that's a payload channel for
	 * cross-iframe Media Library drags. This is the gesture driver —
	 * it owns the pointer events, the ghost element, the drop-target
	 * registry, and the global cancellation paths (Escape / blur /
	 * visibilitychange / pointercancel).
	 *
	 * @since 0.18.0
	 */
	dragManager: DragManagerApi;
	/**
	 * Register a slash-command that appears in the Cmd+K palette.
	 *
	 * ```js
	 * wp.desktop.registerCommand( {
	 *   slug: 'turn_on_comments',
	 *   label: 'Turn on comments',
	 *   hint: '[post id]',
	 *   icon: 'dashicons-admin-comments',
	 *   run: ( args, ctx ) => {
	 *     // ...perform action...
	 *     ctx.close();
	 *     return `Enabled comments on post ${ args.trim() }.`;
	 *   },
	 * } );
	 * ```
	 *
	 * @since 0.14.0
	 */
	registerCommand: ( cmd: DesktopCommand ) => void;
	/** Remove a previously registered command by slug. @since 0.14.0 */
	unregisterCommand: ( slug: string ) => void;
	/** Snapshot of all currently registered commands. @since 0.14.0 */
	listCommands: () => DesktopCommand[];
	/**
	 * Register a tab in the OS Settings window.
	 *
	 * ```js
	 * wp.desktop.registerSettingsTab( {
	 *   id: 'my-plugin',
	 *   label: 'My Plugin',
	 *   capability: 'manage_options', // optional — admin-only when set to this
	 *   order: 50,                    // optional — default 100 (after built-ins)
	 *   owner: 'my-plugin-settings',  // optional — enables live-unregister
	 *   render: ( body ) => { body.textContent = 'Hello'; },
	 * } );
	 * ```
	 *
	 * Built-in tab orders for reference: appearance=10, ai=20,
	 * extended=30, help=40.
	 *
	 * @since 0.17.0
	 */
	registerSettingsTab: ( tab: DesktopSettingsTab ) => void;
	/** Remove a previously registered settings tab. @since 0.17.0 */
	unregisterSettingsTab: ( id: string ) => void;
	/** Snapshot of all registered third-party settings tabs. @since 0.17.0 */
	listSettingsTabs: () => DesktopSettingsTab[];
	/**
	 * Register a renderer that REPLACES the dock rail entirely.
	 * Plugins can ship a circular ring, a Stage-Manager-style
	 * stack, a floating cluster — anything that fits the
	 * controller contract. The user picks among registered
	 * renderers in OS Settings → Appearance → Dock style.
	 *
	 * See `docs/examples/dock-rail-renderer.md` for the full
	 * contract.
	 *
	 * @since 0.18.0
	 */
	registerDockRailRenderer: ( renderer: DockRailRenderer ) => void;
	/** Remove a previously registered rail renderer. @since 0.18.0 */
	unregisterDockRailRenderer: ( id: string ) => void;
	/** Snapshot of all registered rail renderers. @since 0.18.0 */
	listDockRailRenderers: () => DockRailRenderer[];
	/**
	 * Open (or focus, if already open) the shell's OS Settings
	 * window. Routes through the same `manager.open()` call the
	 * dock's OS Settings tile uses, so a window opened here is
	 * indistinguishable from one opened by a dock click — same
	 * id, same render callback, same dimensions, same focus and
	 * minimize behaviour.
	 *
	 * Useful for custom dock rail renderers that want to surface
	 * OS Settings inside their own UI without relying on the
	 * dock's system tile being reachable (Classic layout puts OS
	 * Settings on the side rail, which a custom primary-rail
	 * renderer can't see).
	 *
	 * @since 0.18.0
	 */
	openOsSettings: () => void;
	/**
	 * Read the current OS Settings snapshot. Mirrors the same shape
	 * any settings tab sees via its `ctx.getOsSettings()`. Use this
	 * from a feature plugin (or a feature window) when you need to
	 * key behaviour off a per-user preference (e.g. the native Posts
	 * window reads `nativePostsHiddenColumns` from here to filter the
	 * `<wpd-table>` columns).
	 *
	 * @since 0.8.0
	 */
	getOsSettings: () => OsSettingsSnapshot;
	/**
	 * Subscribe to OS Settings changes. The callback fires every time
	 * the user toggles a setting (or a third-party tab calls
	 * `updateOsSettings`). Returns an unsubscribe function. Mirrors
	 * the existing settings-tab `ctx.subscribeOsSettings` API.
	 *
	 * @since 0.8.0
	 */
	subscribeOsSettings: (
		cb: ( snapshot: OsSettingsSnapshot ) => void,
	) => () => void;
	/**
	 * Patch the OS Settings state and persist (debounced REST sync +
	 * localStorage write + subscriber notification). Only the keys
	 * present on the public `OsSettingsSnapshot` are honored; unknown
	 * keys are ignored. Save lifecycle events (`'saving'` /
	 * `'success'` / `'failed'`) fire on `document` as
	 * `desktop-mode-os-settings-save-lifecycle`, same as a built-in
	 * tab's save.
	 *
	 * @since 0.8.0
	 */
	updateOsSettings: (
		patch: Partial< OsSettingsSnapshot >,
		opts?: { windowId?: string },
	) => void;
	/**
	 * Derive a stable window id from an admin URL — the same id the
	 * default rail renderer uses when it opens a tile. Matches the
	 * shell's internal slugifier; a custom renderer that calls
	 * `wp.desktop.deriveWindowId(url)` and
	 * `wp.desktop.windowManager.open({ id, … })` addresses the same
	 * window the default renderer would, so switching renderer
	 * mid-session doesn't lose the user's open windows.
	 *
	 * Plugins almost always want this over rolling their own
	 * slugifier — a custom slug means the renderer can't
	 * reuse-or-focus a window the default renderer opened.
	 *
	 * `adminUrl` defaults to `wp.desktop.config.adminUrl` so callers
	 * normally pass just the URL.
	 *
	 * @since 0.18.0
	 */
	deriveWindowId: ( url: string, adminUrl?: string ) => string;
	/**
	 * Snapshot of every JS-registered system tile across both
	 * rails. Returns `[]` when the layout dispatcher hasn't booted
	 * yet (rare; only happens before `desktop-mode.init` fires).
	 *
	 * Custom rail renderers use this to compose against the same
	 * tile set the default renderer paints — e.g., a launcher
	 * palette that lists every native-window plugin tile + the
	 * OS Settings tile in one place.
	 *
	 * @since 0.18.0
	 */
	listSystemTiles: () => Array< {
		id: string;
		title: string;
		icon: string;
		affinity: 'core' | 'plugin';
	} >;
	/**
	 * Look up a system tile by id. Returns the underlying
	 * `SystemDockItem` so callers can read its `title` / `icon` /
	 * `isOpen()` predicate, or invoke `onOpen()` to forward the
	 * action — the canonical "open by id" path that doesn't
	 * require DOM scraping.
	 *
	 * Returns `null` when the id isn't registered or when the
	 * dispatcher hasn't booted yet.
	 *
	 * @since 0.18.0
	 */
	getSystemTile: ( id: string ) => SystemDockItem | null;
	/**
	 * Read the complete admin-menu list, regardless of which rail
	 * it would partition to under the active layout. The default
	 * Classic layout splits the menu (core to side rail, plugin to
	 * primary rail), so a custom rail renderer's `mount-deps.items`
	 * is layout-scoped — this returns the full picture.
	 *
	 * Snapshots `config.dockItems` (the boot payload + the most
	 * recent live-refresh result). Returns `[]` before the shell
	 * has finished booting.
	 *
	 * @since 0.18.0
	 */
	getMenuItems: () => DockItem[];
	/**
	 * Render an icon-string into a DOM element using the canonical
	 * dispatch (dashicon class → `<span>`, base64 SVG data URI →
	 * `<span>` background, http(s) URL → `<img>`, anything else →
	 * letter-badge fallback). Use this so your renderer's icons
	 * look consistent with the default dock's.
	 *
	 * @since 0.18.0
	 */
	renderIcon: (
		icon: string,
		opts: { title: string; className?: string },
	) => HTMLElement;
	/**
	 * Run the registered `desktop-mode.dock.tile-class` filter against
	 * a base classNames list. Custom rail renderers SHOULD use this
	 * during tile build so decoration plugins compose with any
	 * renderer the user picks. See `docs/examples/dock-rail-renderer.md`
	 * for the full composition contract.
	 *
	 * @since 0.18.0
	 */
	applyTileClasses: typeof import( './dock-helpers' ).applyTileClasses;
	/**
	 * Run the registered `desktop-mode.dock.tile-element` filter so
	 * decoration plugins can wrap a renderer's tile element.
	 *
	 * @since 0.18.0
	 */
	applyTileElement: typeof import( './dock-helpers' ).applyTileElement;
	/**
	 * Resolve the tooltip text for a tile through the registered
	 * `desktop-mode.dock.tile-tooltip` filter. Empty return suppresses
	 * the tooltip.
	 *
	 * @since 0.18.0
	 */
	applyTileTooltip: typeof import( './dock-helpers' ).applyTileTooltip;
	/**
	 * Fire the `desktop-mode.dock.tile-rendered` action after a tile
	 * lands in the DOM.
	 *
	 * @since 0.18.0
	 */
	dispatchTileRendered: typeof import( './dock-helpers' ).dispatchTileRendered;
	/**
	 * Walk an event target's composedPath looking for a known dock
	 * element. Custom rail renderers should register their root
	 * selector via {@link registerDockSelector} at mount time, then
	 * use this in click-outside-to-dismiss handlers.
	 *
	 * @since 0.18.0
	 */
	isDockElement: ( target: EventTarget | null ) => boolean;
	/**
	 * Register an additional CSS selector treated as "inside the
	 * dock" by {@link isDockElement}. Returns an unregister callback.
	 *
	 * @since 0.18.0
	 */
	registerDockSelector: ( selector: string ) => () => void;
	/**
	 * Register a custom button in the title bar of any matching
	 * window. Predicate decides which windows show it. See
	 * `TitleBarButtonDef` for the full options shape.
	 *
	 * Returns `true` when the button was registered, `false` on
	 * validation failure (a `console.warn` names the bad field).
	 *
	 * @since 0.17.0
	 */
	registerTitleBarButton: ( def: TitleBarButtonDef ) => void;
	/** Remove a previously registered title-bar button. @since 0.17.0 */
	unregisterTitleBarButton: ( id: string ) => void;
	/** Snapshot of registered title-bar buttons. @since 0.17.0 */
	listTitleBarButtons: () => TitleBarButtonDef[];
	/**
	 * Register (or replace) a per-window theme — a CSS-variable map
	 * applied to every matching window's outer element. The shell
	 * routes registry mutations through every open window so live
	 * activation paints immediately. Mirrors {@link registerCommand}
	 * / {@link registerTitleBarButton} for predicate filtering and
	 * `owner`-based teardown.
	 *
	 * Throws a `RegistrationError` on validation failure.
	 *
	 * @since 0.6.0
	 */
	registerWindowTheme: ( def: WindowThemeDef ) => void;
	/** Remove a previously registered window theme. @since 0.6.0 */
	unregisterWindowTheme: ( id: string ) => void;
	/** Snapshot of registered window themes. @since 0.6.0 */
	listWindowThemes: () => WindowThemeDef[];
	/**
	 * Register (or replace) a window control. Built-in controls
	 * (close, minimize, maximize, focus, detach) live in this same
	 * registry under the `core/*` id prefix — plugins can `unregister`
	 * any of them to hide globally, or use per-window
	 * `appearance.controls.{order, hide, custom}` to mutate just
	 * one window's cluster.
	 *
	 * Throws a `RegistrationError` on validation failure.
	 *
	 * @since 0.6.0
	 */
	registerWindowControl: ( def: WindowControlDef ) => void;
	/** Remove a previously registered window control by id. @since 0.6.0 */
	unregisterWindowControl: ( id: string ) => void;
	/** Snapshot of registered window controls. @since 0.6.0 */
	listWindowControls: () => WindowControlDef[];
	/**
	 * Apply (or clear) a per-window controls config at runtime.
	 * Pass `null` / `undefined` to clear and fall back to the
	 * registry's default resolution.
	 *
	 * No-op when the window id is not currently open.
	 *
	 * @since 0.6.0
	 */
	applyWindowControls: (
		windowId: string,
		override: import( './types' ).WindowControlsConfig | null | undefined,
	) => void;
	/**
	 * Register (or replace) a Layer-3 title-bar slot renderer. The
	 * registered renderer paints into the named slot's host element
	 * for every window the `match` predicate accepts. Multiple
	 * registrations targeting the same slot stack in `order`.
	 *
	 * Throws a `RegistrationError` on validation failure.
	 *
	 * @since 0.6.0
	 */
	registerWindowSlot: ( def: WindowSlotDef ) => void;
	/** Remove a previously registered slot renderer. @since 0.6.0 */
	unregisterWindowSlot: ( id: string ) => void;
	/** Snapshot of registered slot renderers. @since 0.6.0 */
	listWindowSlots: () => WindowSlotDef[];
	/**
	 * Apply (or clear) a per-window slot override at runtime. Pass
	 * `undefined` for `config` to clear the override (default
	 * content + matching registry entries take over again).
	 *
	 * No-op when the window id is not currently open.
	 *
	 * @since 0.6.0
	 */
	applyWindowSlot: (
		windowId: string,
		slot: import( './types' ).WindowSlotName,
		config: import( './types' ).WindowSlotConfig | undefined,
	) => void;
	/**
	 * **Experimental** — register (or replace) a custom chrome
	 * implementation. A chrome owns the title-bar DOM tree of any
	 * window that selects it via `WindowConfig.appearance.chrome`.
	 * Layer-4 of the chrome framework — Layers 1-3 (theme, controls,
	 * slots) cover 95%+ of customization use cases by composition.
	 *
	 * The chrome render contract may change in future minor versions.
	 *
	 * @since 0.6.0
	 */
	registerWindowChrome: ( def: WindowChromeDef ) => void;
	/** Remove a previously registered chrome by id. **Experimental.** @since 0.6.0 */
	unregisterWindowChrome: ( id: string ) => void;
	/** Snapshot of registered chromes. **Experimental.** @since 0.6.0 */
	listWindowChromes: () => WindowChromeDef[];
	/**
	 * Set a window's chrome at runtime. Pass `null` / `undefined`
	 * (or `'core/standard'`) to fall back to the standard chrome.
	 *
	 * **Experimental.** @since 0.6.0
	 */
	applyWindowChrome: (
		windowId: string,
		chromeId: string | null | undefined,
	) => void;
	/**
	 * Apply (or clear) a per-window theme override at runtime.
	 * Accepts a registered theme id (string), an inline tokens map
	 * (`Record< string, string >`), an explicit `WindowThemeRef`, or
	 * `null` to clear the override and fall back to the registry.
	 *
	 * No-op when the window id is not currently open.
	 *
	 * @since 0.6.0
	 */
	applyWindowTheme: (
		windowId: string,
		override:
			| import( './types' ).WindowThemeRef
			| Record< string, string >
			| string
			| null
			| undefined,
	) => void;
	/**
	 * Open a typed pub/sub connection to another window's iframe.
	 * Returns a `WindowConnection` with `subscribe`, `send`, and
	 * `disconnect`. Messages are queued before the iframe acks the
	 * handshake; the iframe-side counterpart is
	 * `wp.desktop.iframe.publish/subscribe` (injected into every
	 * chromeless wp-admin page).
	 *
	 * @since 0.17.0
	 */
	connect: ( targetWindowId: string, opts?: ConnectOptions ) => WindowConnection;
	/**
	 * Cross-window broadcast. Publishes a payload on a topic to
	 * every window — native or iframe — that has subscribed. The
	 * canonical built-in topic is `desktop-mode.data-changed`,
	 * emitted by the Recycle Bin whenever an item is restored or
	 * permanently deleted; the shell's default subscriber reloads
	 * any iframe whose URL matches a known admin page for the
	 * affected post type.
	 *
	 * Plugins are encouraged to namespace their topics
	 * (`acme.orders.refunded`, etc.). Wildcard `'*'` subscriptions
	 * are supported by `subscribe()` but expensive — use sparingly.
	 *
	 * @since 0.21.0
	 */
	broadcast: < T = unknown >( topic: string, payload: T ) => void;
	/**
	 * Subscribe to broadcast topics. Returns an unsubscribe handle.
	 * Use `'*'` to receive every payload.
	 *
	 * Iframe-side admin pages can subscribe via plain DOM —
	 * `document.addEventListener( 'desktop-mode-broadcast', cb )` —
	 * the chromeless bridge re-dispatches every incoming broadcast
	 * as that CustomEvent.
	 *
	 * @since 0.21.0
	 */
	subscribe: < T = unknown >(
		topic: string,
		cb: ( payload: T, meta: { topic: string } ) => void,
	) => () => void;
	/**
	 * Register a Cmd+K palette. The shell owns a single shortcut
	 * handler that cycles through every registered palette; the
	 * built-in AI Assistant is registered as palette 0 by default.
	 *
	 * ```js
	 * const unregister = wp.desktop.registerPalette( {
	 *     id:     'my-plugin/launcher',
	 *     label:  'My Launcher',
	 *     open:   () => myUI.show(),
	 *     close:  () => myUI.hide(),
	 *     isOpen: () => myUI.isVisible(),
	 * } );
	 * // later: unregister();
	 * ```
	 *
	 * Re-registering the same id replaces the previous entry.
	 * @since 0.14.0
	 */
	registerPalette: ( p: Palette ) => () => void;
	/** Remove a palette from the cycle. Idempotent. @since 0.14.0 */
	unregisterPalette: ( id: string ) => void;
	/** Snapshot of registered palettes. @since 0.14.0 */
	listPalettes: () => Palette[];
	/** Open a specific palette, closing any other open one. @since 0.14.0 */
	openPalette: ( id: string ) => void;
	/**
	 * Cross-plugin instrumentation surface. Lets a third-party
	 * devtool (SQL inspector, perf profiler, request logger) attach
	 * behavior to a window registered by another plugin without
	 * reaching into iframe globals.
	 *
	 * - `addRequestHeader( windowId, name, value )` contributes an
	 *   HTTP header the iframe attaches to every fetch / XHR /
	 *   sendBeacon. Multiple devtools may contribute the same header;
	 *   values are joined per RFC 7230. Returns a disposer.
	 * - `onRequest( windowId, cb, { observe } )` subscribes to every
	 *   completed request. Pass `observe: true` to receive
	 *   request + response headers (default summary covers method/
	 *   url/status/duration only).
	 * - `debug` is a generic per-session pub/sub bus backed by REST
	 *   polling — pair it with PHP `desktop_mode_debug_publish()`.
	 *
	 * @since 0.6.0
	 */
	devtools: import( './devtools' ).DevtoolsApi;
	/**
	 * Cross-bundle reactive store factory.
	 *
	 * Each plugin / feature in Desktop Mode is typically built as
	 * its own Vite IIFE bundle. Module-level state defined inside
	 * one bundle is invisible to another bundle even when both
	 * import the same source file — each bundle has its own copy.
	 * `createSharedStore` solves this by attaching state to a
	 * window-level slot keyed by your string. The first call with
	 * a given key creates the store; every subsequent call with
	 * the same key (in any bundle) returns the SAME store, so
	 * mutations propagate and subscribers from any bundle fire on
	 * any mutation.
	 *
	 * Mutation pattern is mutate-then-notify (no immutable updates,
	 * no reducer enum). The returned handle exposes `state` (live
	 * mutable object), `notify()`, `subscribe(cb)`, `getState()`,
	 * and `reset()`.
	 *
	 * Use this any time you split your plugin's JS across more
	 * than one bundle and need them to agree on something. Common
	 * consumers: a feature whose lazy chat / detail-pane bundle
	 * needs to read state from an always-on shell bundle.
	 *
	 * @example
	 * ```js
	 * const store = wp.desktop.createSharedStore(
	 *     'my-plugin/state',
	 *     () => ( { selectedId: null, items: [] } ),
	 * );
	 * store.subscribe( ( s ) => repaint( s ) );
	 * store.state.selectedId = 7;
	 * store.notify();
	 * ```
	 *
	 * @since 0.5.5
	 */
	createSharedStore: < T >(
		key: string,
		initialState: () => T,
	) => SharedStore< T >;
	/**
	 * Framework-level presence — who's currently in the desktop-mode
	 * WP-Admin and what their state is (`online | inactive |
	 * offline`). Always available regardless of which feature
	 * plugins (chat, collaboration, …) happen to be installed.
	 *
	 * The probe is started automatically on `desktop-mode.init` and
	 * piggy-backs on the WordPress Heartbeat to bump server-side
	 * presence + receive the visible-users snapshot. Plugins read
	 * `getStatus(userId)` / `getAll()` for a synchronous snapshot,
	 * `subscribe(cb)` to react to changes, and listen for
	 * `desktop-mode-presence-changed` CustomEvents on `document` for
	 * status transitions (fires once per user per transition,
	 * never on stable ticks).
	 *
	 * @example
	 * ```js
	 * if ( wp.desktop.presence.getStatus( authorId ) === 'online' ) {
	 *     showOnlineBadge();
	 * }
	 * document.addEventListener( 'desktop-mode-presence-changed', ( e ) => {
	 *     console.log( e.detail.userId, e.detail.newStatus );
	 * } );
	 * ```
	 *
	 * @since 0.5.5
	 */
	presence: PresenceApi;
	/**
	 * Cross-plugin activity channels — a thin, named-channel layer
	 * over `wp.hooks` for plugin-internal events that other
	 * plugins might care about. Apps publish state changes; peers
	 * subscribe + react. Convention is `<plugin>/<event>`:
	 *
	 * ```js
	 * wp.desktop.activity.publish( 'inbox/unread-changed', { total: 5 } );
	 * const off = wp.desktop.activity.subscribe(
	 *     'inbox/unread-changed',
	 *     ( { total } ) => repaintBadge( total ),
	 * );
	 * ```
	 *
	 * Channels are routed via `desktop-mode.activity.<channel>` on
	 * the hook bus, so devtools / inspectors can list activity
	 * traffic as a discrete group.
	 *
	 * @since 0.5.5
	 */
	activity: ActivityApi;
	/**
	 * Cross-feature WordPress Heartbeat bus.
	 *
	 * Every plugin that wants to read / write a per-tick payload
	 * goes through here:
	 *
	 * ```js
	 * wp.desktop.heartbeat.contribute( 'my-plugin/active', () => true );
	 * wp.desktop.heartbeat.subscribe( 'my-plugin/payload', ( v ) => {
	 *     applyServerSnapshot( v );
	 * } );
	 * ```
	 *
	 * The framework wires the underlying `heartbeat-send` /
	 * `heartbeat-tick` jQuery events once. Plugins compose; no
	 * boilerplate per feature.
	 *
	 * @since 0.5.5
	 */
	heartbeat: HeartbeatBus;
	/**
	 * Show a transient top-of-shell toast. Returns a dismiss callback
	 * the caller can invoke early — useful when the state the toast
	 * was reporting changes (e.g. dismiss inbound-message toasts the
	 * moment the chat window mounts).
	 *
	 * Routes through the `desktop-mode/toast-requested` activity filter
	 * before painting; plugins can mutate or cancel the payload.
	 *
	 * @since 0.23.0
	 */
	showToast: ( opts: ToastOptions ) => () => void;
	/**
	 * Re-paint every currently-loading window's spinner overlay
	 * through the customization pipeline (per-window
	 * `config.loading.render` + `WINDOW_LOADING_OVERLAY` filter).
	 *
	 * Call this after registering a `WINDOW_LOADING_OVERLAY` filter
	 * **mid-life** — i.e. NOT inside `whenReady( … )`. Filters
	 * registered in `whenReady` are picked up automatically by the
	 * shell's post-`HOOKS.INIT` sweep, so the typical plugin shape:
	 *
	 * ```js
	 * wp.desktop.whenReady( () => {
	 *     wp.desktop.hooks.addFilter(
	 *         'desktop-mode.window.loading-overlay',
	 *         'my-skin/branded',
	 *         ( host ) => { ... }
	 *     );
	 * } );
	 * ```
	 *
	 * never needs this. The escape hatch exists for plugins that
	 * register their filter from a deferred async import, a
	 * runtime feature flag flip, or a settings change after init.
	 *
	 * Idempotent. Safe to call multiple times — windows that
	 * already finished loading are unaffected.
	 *
	 * @since 0.6.0
	 */
	repaintLoadingOverlays: () => void;
	/**
	 * Keyed-list rendering helper for any plugin that paints a dynamic
	 * list of items into a DOM container. Reuses element instances when
	 * the keys match across renders so event listeners survive data
	 * updates — the only reliable way to keep clicks working on rows
	 * that may re-render mid-press.
	 *
	 * See {@link renderKeyedList} for the full options shape.
	 *
	 * @since 0.23.0
	 */
	renderKeyedList: < T >(
		host: HTMLElement,
		items: readonly T[],
		opts: KeyedListOptions< T >,
	) => void;
	/**
	 * Drop the keyed-list state for a host. Idempotent. Pair with
	 * `renderKeyedList` when tearing down a list-bearing component.
	 *
	 * @since 0.23.0
	 */
	clearKeyedList: ( host: HTMLElement ) => void;
	/**
	 * Bless a plugin-owned subnamespace under `wp.desktop`. Plugins
	 * that ship their own public surface (`wp.desktop.<your-plugin>`)
	 * call this once at boot to publish their api object on the shell. Subsequent calls with the same
	 * name replace the previous registration — re-registration is
	 * idempotent and intentionally non-throwing so a plugin reload
	 * does the right thing.
	 *
	 * Reserved names: any key already present on `wp.desktop` at the
	 * moment of registration. Attempting to claim a reserved name
	 * console.warns and is a no-op so a plugin can't accidentally
	 * shadow a built-in.
	 *
	 * @since 0.23.0
	 */
	registerNamespace: ( name: string, api: object ) => void;
	/**
	 * Read the bundle-bound config blob shipped via the `'config'`
	 * arg on `desktop_mode_register_window( $id, [ 'config' => … ] )`.
	 * Returns `undefined` when no config was registered for `id`.
	 *
	 * Recommended over reading `window.desktopModeWindowConfig[ id ]`
	 * directly so the storage location can evolve without breaking
	 * plugin bundles.
	 *
	 * @since 0.6.0
	 */
	getWindowConfig: < T = Record< string, unknown > >( id: string ) => T | undefined;
	/**
	 * Read-only diagnostics surface. Plugin authors integrating with
	 * desktop-mode use these to answer "what state does the framework
	 * think my window is in?" without inventing one-off probes from
	 * scratch. Strictly observational — calling these methods is side-
	 * effect free.
	 *
	 * @since 0.6.0
	 */
	/**
	 * Show a system notification (or fall back to a toast when
	 * permission is denied / unsupported). Returns a dismiss
	 * callback. Routes through `desktop-mode/notification-requested`
	 * (filterable) and broadcasts on
	 * `desktop-mode/notification-shown` after rendering. v1 is
	 * page-scoped local notifications only — phase 4 will extend
	 * this to Web Push without breaking the call surface.
	 *
	 * @since 0.8.0
	 */
	notify: ( opts: NotifyOptions ) => () => void;
	/**
	 * Programmatic + observational PWA surface. Mirrors the install
	 * pill the framework renders automatically — plugin authors can
	 * surface their own "Install as app" button in a settings tab,
	 * read whether the app is already installed, or watch for the
	 * dismissal flag flipping.
	 *
	 * @since 0.8.0
	 */
	pwa: {
		/**
		 * Trigger the install prompt. Resolves to the user's
		 * choice, or `'unavailable'` when the browser hasn't fired
		 * `beforeinstallprompt` yet (Safari, already installed,
		 * non-PWA-capable browser).
		 */
		promptInstall: () => Promise< 'accepted' | 'dismissed' | 'unavailable' >;
		/** Reset the install-hint dismissal flag so the pill re-appears. */
		undismissInstallHint: () => void;
		/** Snapshot of the per-user PWA state. */
		getState: () => import( './types' ).PwaUserState;
		/** Subscribe to state changes. Returns unsubscribe. */
		subscribe: (
			cb: ( s: import( './types' ).PwaUserState ) => void,
		) => () => void;
		/** Eager permission prompt for notifications. */
		requestNotificationPermission: () => Promise<
			'granted' | 'denied' | 'default' | 'unsupported'
		>;
		/** Synchronous read of the current permission. */
		getNotificationPermission: () =>
			| 'granted'
			| 'denied'
			| 'default'
			| 'unsupported';
	};
	debug: {
		/**
		 * Snapshot what the shell knows about a registered native
		 * window. Returns `null` when `id` is not in the
		 * `nativeWindows` payload (plugin not active, or id typo).
		 *
		 * Most useful values for "why isn't my bundle running?"
		 * debugging:
		 * - `loadPath: 'eager' | 'lazy' | 'unknown'` — eager means
		 *   `desktop_mode_enqueue_native_window_scripts` printed the
		 *   tag through `wp_print_scripts`; lazy means the shell
		 *   appended a `<script>` via `loadVendorScript`. Lazy + a
		 *   missing `configPresent` is the historical
		 *   mid-session-activation bug fixed in 0.6.0.
		 * - `configPresent` — whether
		 *   `window.desktopModeWindowConfig[ id ]` exists.
		 * - `extras` — what the payload supplied for
		 *   `loadVendorScript` to inject (translations / l10n /
		 *   before / after counts).
		 */
		window: ( id: string ) => DesktopDebugWindow | null;
	};
}

/**
 * Read-only diagnostics for one native window. Returned by
 * `wp.desktop.debug.window( id )`.
 *
 * @public
 * @since 0.6.0
 */
export interface DesktopDebugWindow {
	id: string;
	scriptHandle: string;
	scriptUrl: string;
	/**
	 * `'eager'` — a `<script>` tag printed by `wp_print_scripts` was
	 * found in the document for this URL.
	 * `'lazy'`  — only the shell-injected (`data-desktop-mode-vendor`) tag is present.
	 * `'unknown'` — neither (script never loaded yet, or the URL is empty).
	 */
	loadPath: 'eager' | 'lazy' | 'unknown';
	tagInDom: boolean;
	configPresent: boolean;
	extras: {
		hasTranslations: boolean;
		l10nCount: number;
		beforeCount: number;
		afterCount: number;
	};
}

declare global {
	interface Window {
		desktopModeConfig?: DesktopConfig;
		/**
		 * Per-window config blobs, one entry per
		 * `desktop_mode_register_window( $id, [ 'config' => … ] )`.
		 * Read via {@link WpDesktopPublicApi.getWindowConfig} rather
		 * than touching this global directly — the storage location
		 * may evolve.
		 *
		 * @since 0.6.0
		 */
		desktopModeWindowConfig?: Record< string, unknown >;
	}
	/**
	 * Contribute `desktop` to the merged `window.wp` namespace. The
	 * `hooks` slot is contributed by `src/hooks.ts`; a single `Window.wp`
	 * declaration (there) stitches them together.
	 */
	interface WpGlobal {
		desktop?: WpDesktopPublicApi;
	}
}

/** Debounce window for session writes. 500 ms is short enough to feel immediate and long enough to coalesce drag/resize storms. */
// `SESSION_SAVE_DEBOUNCE_MS` lives with the saver in
// `src/boot/session-saver.ts` since 0.8.1.

// `RESERVED_NAMESPACE_KEYS` lives with the facade in
// `src/api/facade.ts` since 0.8.1 — that's the one place that owns
// the wp.desktop.* assembly, and the allowlist needs to stay in
// sync with it.

/**
 * Initialize Desktop Mode.
 */
function init(): void {
	const config = window.desktopModeConfig;
	if ( ! config ) {
		return;
	}

	const desktopArea = document.getElementById( 'desktop-mode-area' );
	if ( ! desktopArea ) {
		return;
	}

	const manager = new WindowManager( desktopArea );

	// Wallpaper layer + registry. Built-in presets register immediately
	// (synchronously, before `desktop-mode.init` fires) so the filter chain
	// third-party plugins hook into already carries the full seed list.
	// The layer owns the wallpaper DOM element the shell markup reserves
	// as the first child of `#desktop-mode-shell`.
	const wallpaperEl = document.getElementById( 'desktop-mode-wallpaper' );
	const pluginUrl = config.pluginUrl || '';
	let wallpaperLayer: WallpaperLayer | null = null;
	if ( wallpaperEl ) {
		wallpaperLayer = new WallpaperLayer( wallpaperEl, pluginUrl );
	}

	// Widget layer + registry. Same pattern as wallpapers: register
	// built-ins synchronously so the `desktop-mode.widgets` filter
	// already carries them when plugins hook in, then hydrate the
	// layer which mounts whichever widgets the user last had on.
	const widgetsEl = document.getElementById( 'desktop-mode-widgets' );
	let widgetLayer: WidgetLayer | null = null;
	registerBuiltInWidgets();
	// Dock rail renderer registry — install the built-in `'default'`
	// icon-strip renderer before `desktop-mode.init` fires so the
	// layout dispatcher (constructed below) can resolve it on the
	// very first paint.
	installDefaultDockRailRenderer();
	if ( widgetsEl ) {
		widgetLayer = new WidgetLayer( widgetsEl, pluginUrl );
	}

	// Built-in modules: PixiJS is bundled in `assets/vendor/`. Plugins
	// that want to use it declare `needs: ['pixijs']` on their wallpaper
	// and the shell loads the script before mount fires — no URL lookup
	// for the plugin author to get wrong.
	registerModule( {
		id: 'pixijs',
		url: `${ pluginUrl }/assets/vendor/pixi.min.js`,
		isReady: () => typeof ( window as { PIXI?: unknown } ).PIXI !== 'undefined',
	} );

	// OS Settings — shell-level preferences. Takes the wallpaper layer
	// so it can delegate apply() through the registry-driven path.
	// Falls back to a stub layer when the shell markup somehow lacks
	// the wallpaper element (defensive; shouldn't happen in practice).
	const osSettings = new OsSettings(
		{
			mediaUrl: config.mediaUrl,
			restNonce: config.restNonce,
			canUpload: !! config.canUpload,
			isAdmin: !! config.currentUserIsAdmin,
			aiPlatformSettings: config.aiPlatformSettings ?? null,
			aiPlatformSettingsUrl: config.aiPlatformSettingsUrl ?? '',
			extendedOptions: config.extendedOptions ?? null,
			extendedOptionsUrl: config.extendedOptionsUrl ?? '',
			osSettingsPanelBundleUrl: config.osSettingsPanelBundleUrl ?? '',
		},
		wallpaperLayer ?? new WallpaperLayer( document.createElement( 'div' ), pluginUrl ),
	);
	osSettings.apply();

	// AI Assistant — main bundle ships a tiny stub matching the same
	// AiAssistantApi contract. The 38 kB implementation lives in its
	// own `ai-assistant[.min].js` bundle and is `<script>`-injected on
	// the user's first invocation, so first-paint pays nothing for it.
	// aiSearchUrl comes from PHP config; falls back to an empty string
	// when AI is not configured (the search will return a 403 from the
	// permission gate and show an error). aiAssistantBundleUrl is
	// always emitted by PHP — never empty when the shell is loaded.
	const aiAssistant = new AiAssistantStub(
		{
			aiSearchUrl: config.aiSearchUrl ?? '',
			aiSearchStreamUrl: config.aiSearchStreamUrl ?? '',
			restNonce: config.restNonce,
			// Transport picker lives in OS Settings → AI Settings. Read
			// live (not captured at construction) so a change applies on
			// the next search without a page reload.
			getTransport: () => osSettings.getOsSettingsSnapshot().ai.transport,
		},
		config.aiAssistantBundleUrl ?? '',
	);

	// Late-bind the programmatic `ask` entry point. Passing `config`
	// through a getter (rather than capturing at construction time)
	// means plugins that mutate `wp.desktop.config` at runtime see
	// the fresh values, matching the rest of the public API's "read
	// live" contract.
	aiAssistant.attachAsk(
		createAsk( {
			config: () => config,
			fallbackContext: () => ( {
				close: () => aiAssistant.close(),
				openInWindow: ( url, title, icon ) => {
					// WindowManager.open accepts `id?` at runtime (derived from
					// the URL when missing); the TS signature requires it, so
					// we route through the existing assistant helper which
					// already handles the fallback + type widening.
					( manager as unknown as {
						open( cfg: {
							id?: string;
							url: string;
							title: string;
							icon?: string;
						} ): unknown;
					} ).open( {
						url,
						title,
						icon: icon ?? 'dashicons-admin-generic',
					} );
				},
				confirm: ( msg ) =>
					wpdConfirm( { message: msg } ),
			} ),
		} ),
	);

	// Cross-window drag bridge — stores the attachment payload the
	// Media Library iframe sends on dragstart so drop-receiver iframes
	// can request it back in their drop handler. Instantiated here
	// (after shell DOM exists) so any iframe loading afterward sees
	// a parent that's ready to receive messages.
	const dragBridge = new DragBridge();
	// In-shell drag-and-drop manager — owns the pointer-based drag
	// gestures for file tiles, entity tiles, and plugin-registered
	// draggable surfaces. Drop targets register via the public API.
	const dragManager: DragManagerApi = new DragManager();

	// Register the AI Assistant as the first (default) Cmd+K palette
	// and install the single global shortcut. Other plugins can register
	// more palettes via wp.desktop.registerPalette and Cmd+K cycles
	// through them in registration order.
	registerPalette( {
		id: 'desktop-mode-ai-assistant',
		label: 'AI Assistant',
		open: () => aiAssistant.open(),
		close: () => aiAssistant.close(),
		isOpen: () => aiAssistant.isOpen,
	} );
	installPaletteShortcut();
	installWindowSwitcherShortcut( manager );

	// Iframe command bridge — pulls `wp.data.select('core/commands')` out
	// of whichever window has focus and exposes the commands as slash-
	// commands in the shell palette. Navigation commands rewrite to open
	// a new desktop window; actions proxy back into the iframe.
	new IframeCommandBridge( {
		manager,
		adminUrl: config.adminUrl,
	} ).install();

	// Admin-bar "Ask AI" button and programmatic `desktop-mode-open-ai`
	// dispatches now route through openPaletteOnly so any other plugin
	// palette that happens to be open is dismissed first — matches the
	// single-palette-at-a-time invariant the cycle maintains.
	document.addEventListener( 'desktop-mode-open-ai', () => {
		openPaletteOnly( 'desktop-mode-ai-assistant' );
	} );

	// Dock(s) + desktop icons — managed by the layout dispatcher.
	// User picks one of three layouts in OS Settings → Appearance:
	// Classic (left side bar + bottom dock), Unified (single bottom
	// rail), or Spatial (bottom dock + core menus as wallpaper
	// icons). The dispatcher tears down and rebuilds the right set
	// of `Dock` instances on every layout change and exposes a
	// stable handle the rest of the shell (live menu refresh,
	// public API) keeps wired to whichever rails are currently live.
	const bottomDockEl = document.getElementById( 'desktop-mode-dock' );
	const shellEl = document.getElementById( 'desktop-mode-shell' );
	const shellBody = shellEl?.querySelector< HTMLElement >(
		'.desktop-mode-shell__body',
	);
	let layoutDispatcher: LayoutDispatcher | null = null;

	// Native-window sync is built BEFORE the dispatcher so the
	// dispatcher's `renderIcons` closure can hand `nativeWindows.openById`
	// to `renderDesktopIcons` without hitting a temporal-dead-zone
	// reference (the dispatcher's constructor paints icons immediately).
	// The system-tile callbacks close over the still-null
	// `layoutDispatcher` and read it lazily; the initial sync that
	// would invoke them is deferred until after the dispatcher is wired.
	const nativeWindows = createNativeWindowSync( {
		manager,
		appendSystemTile: ( item ) =>
			layoutDispatcher?.appendSystemTile( item ),
		removeSystemTile: ( id ) => layoutDispatcher?.removeSystemTile( id ),
		desktopArea,
	} );
	const syncNativeWindows = nativeWindows.sync;

	// Bind the URL → native-window remap registry now that both the OS
	// Settings snapshot and the native-window opener exist. Built-in
	// remaps register themselves below; future native replacements
	// (Pages, Media, Users) drop in with a single
	// `registerNativeUrlRemap({ ... })` call here — no Dock or
	// dispatcher changes needed.
	bindNativeUrlRemap( {
		getSnapshot: () => osSettings.getOsSettingsSnapshot(),
		openById: ( id ) => nativeWindows.openById( id ),
		adminUrl: config.adminUrl,
	} );

	// Cross-page admin-link dispatcher (since 0.8.2). The chromeless
	// bridge `preventDefault`s every admin-internal click and posts
	// `desktop-mode-iframe-admin-link` to us; this binding tells the
	// bridge how to compute slugs, find a destination's title/icon
	// from the dock, and open windows. The lookup falls back to the
	// boot dockItems snapshot before the layout dispatcher exists,
	// so clicks that race the dispatcher's first paint still resolve
	// to a sensible window title.
	const findDockEntryForUrl = (
		url: string,
	): import( './window/iframe-bridge' ).AdminLinkDockEntry | null => {
		const targetSlug = deriveWindowId( url, config.adminUrl );
		const items = layoutDispatcher
			? layoutDispatcher.getMenuItems()
			: ( config.dockItems ?? [] );
		for ( const item of items ) {
			if ( deriveWindowId( item.url, config.adminUrl ) === targetSlug ) {
				return {
					title: item.title,
					icon: item.icon,
					url: item.url,
					submenu: item.submenu,
					multi: item.multi,
				};
			}
			for ( const sub of item.submenu ?? [] ) {
				if (
					deriveWindowId( sub.url, config.adminUrl ) === targetSlug
				) {
					return {
						title: sub.title,
						// Sub-menu entries inherit the parent tile's
						// icon — that's the dock's own convention and
						// avoids painting a generic glyph on a window
						// the user knows by its parent's identity.
						icon: item.icon,
						// `url` holds the PARENT tile's landing page, so
						// the new window's synthetic "back to parent"
						// tab links to the dock URL (themes.php) rather
						// than to the sub-page itself.
						url: item.url,
						multi: item.multi,
					};
				}
			}
		}
		return null;
	};
	bindAdminLinkDispatch( {
		adminUrl: config.adminUrl,
		deriveSlug: ( url ) => deriveWindowId( url, config.adminUrl ),
		openWindow: ( windowConfig ) => {
			void manager.open( windowConfig );
		},
		findDockEntry: findDockEntryForUrl,
	} );

	// Native Posts window (replaces `edit.php` when the user opts in
	// via OS Settings → Features). Matches the bare Posts admin URL
	// AND `?post_type=post` (some hosts/plugins canonicalise the
	// query string differently). Pages / CPTs are intentionally NOT
	// claimed here — they get their own remap when their windows
	// ship.
	registerNativeUrlRemap( {
		id: 'desktop-mode-posts',
		nativeWindowId: 'desktop-mode-posts',
		matches: ( _url, parsed ) => {
			if ( ! parsed.pathname.endsWith( '/edit.php' ) ) {
				return false;
			}
			const postType = parsed.searchParams.get( 'post_type' );
			return ! postType || postType === 'post';
		},
		enabled: ( snapshot ) => snapshot.nativePostsEnabled === true,
	} );

	// Native Pages window — same shape as the Posts remap, scoped to
	// `?post_type=page` only. Other CPTs continue to fall through to
	// the chromeless iframe path until they grow their own native
	// window registration.
	registerNativeUrlRemap( {
		id: 'desktop-mode-pages',
		nativeWindowId: 'desktop-mode-pages',
		matches: ( _url, parsed ) => {
			if ( ! parsed.pathname.endsWith( '/edit.php' ) ) {
				return false;
			}
			return parsed.searchParams.get( 'post_type' ) === 'page';
		},
		enabled: ( snapshot ) => snapshot.nativePagesEnabled === true,
	} );

	// Native Users window — opens on `users.php` only (the list
	// screen). Per-user edit screens are claimed by the User Edit
	// remap below.
	registerNativeUrlRemap( {
		id: 'desktop-mode-users',
		nativeWindowId: 'desktop-mode-users',
		matches: ( _url, parsed ) => parsed.pathname.endsWith( '/users.php' ),
		enabled: ( snapshot ) => snapshot.nativeUsersEnabled === true,
	} );

	// Native User Edit window — claims `user-edit.php?user_id=N`
	// AND `profile.php` (the viewer's own profile shortcut). Sets
	// the target user id via the shared-store helper before the
	// shell calls openById; the render callback reads it back to
	// know which user to load. Same opt-in flag as the Users list
	// — if you turned that off, you presumably want the classic
	// edit screen too.
	// `user-edit.php?user_id=N` and `profile.php` open the
	// dedicated **`desktop-mode-user-edit`** native window. The
	// Users-list window has its OWN built-in Profile tab pinned to
	// the viewer; this remap is for the per-user profile flow.
	// `onMatch` stashes the target user id in the shared store so
	// the user-edit render callback knows which user to load.
	registerNativeUrlRemap( {
		id: 'desktop-mode-user-edit',
		nativeWindowId: 'desktop-mode-user-edit',
		matches: ( _url, parsed ) => {
			const path = parsed.pathname;
			if ( path.endsWith( '/profile.php' ) ) {
				return true;
			}
			if ( path.endsWith( '/user-edit.php' ) ) {
				return parsed.searchParams.has( 'user_id' );
			}
			return false;
		},
		enabled: ( snapshot ) => snapshot.nativeUsersEnabled === true,
		onMatch: ( _url, parsed ) => {
			const userId = parseInt(
				parsed.searchParams.get( 'user_id' ) ?? '0',
				10,
			);
			if ( userId > 0 ) {
				// Set synchronously — see import comment above. The
				// render callback that reads this target fires before
				// the next microtask flush, so any async path here
				// races and loses.
				setUserEditTargetSync( userId );
			}
			// `profile.php` with no user_id falls through to the
			// render callback's `currentUserId` fallback — no need
			// to set a target.
		},
	} );

	// Native Comments window — claims `edit-comments.php` for any user
	// who has opted into the native experience. The comment-edit
	// screen (`comment.php?action=editcomment&c=N`) still falls through
	// to the chromeless iframe path — the native window has its own
	// inline edit affordance and we want the classic deep-edit form
	// available as a fallback.
	registerNativeUrlRemap( {
		id: 'desktop-mode-comments',
		nativeWindowId: 'desktop-mode-comments',
		matches: ( _url, parsed ) =>
			parsed.pathname.endsWith( '/edit-comments.php' ),
		enabled: ( snapshot ) => snapshot.nativeCommentsEnabled === true,
	} );

	// Native Plugins window — claims `plugins.php` (Installed list)
	// AND `plugin-install.php` (Browse the .org repo). The latter
	// stashes a `tab: 'browse'` hint so the bundle's first paint
	// activates the Browse tab. `plugin-editor.php` is intentionally
	// NOT claimed — it's a code-editor surface that belongs to the
	// separate code-editor bundle.
	registerNativeUrlRemap( {
		id: 'desktop-mode-plugins',
		nativeWindowId: 'desktop-mode-plugins',
		matches: ( _url, parsed ) => {
			const path = parsed.pathname;
			return (
				path.endsWith( '/plugins.php' ) ||
				path.endsWith( '/plugin-install.php' )
			);
		},
		enabled: ( snapshot ) => snapshot.nativePluginsEnabled === true,
		onMatch: ( _url, parsed ) => {
			const tab = parsed.pathname.endsWith( '/plugin-install.php' )
				? 'browse'
				: 'installed';
			void import( './plugins-window/tab-target' ).then( ( m ) => {
				m.setPluginsWindowTab( tab );
			} );
		},
	} );

	if ( bottomDockEl && shellEl && shellBody && config.dockItems ) {
		desktopArea.classList.add( 'desktop-mode-area--with-dock' );
		const initialLayout = osSettings.getOsSettingsSnapshot().desktopLayout;
		const renderIcons = (
			icons: import( './types' ).DesktopIconServerEntry[] | undefined,
		): void => {
			renderDesktopIcons( desktopArea, icons, {
				openWindow: nativeWindows.openById,
				manager,
			} );
		};
		layoutDispatcher = createLayoutDispatcher(
			{
				shellRoot: shellEl,
				shellBody,
				bottomDockEl,
				desktopArea,
				windowManager: manager,
				adminUrl: config.adminUrl,
				renderIcons,
				getSettings: () => {
					const snap = osSettings.getOsSettingsSnapshot();
					return {
						itemVisibility: snap.itemVisibility,
						dockOrder: snap.dockOrder,
					};
				},
			},
			initialLayout,
			config.dockItems,
			config.desktopIcons,
		);
		// OS Settings tile — `'core'` affinity so it lands on the side
		// dock in Classic (with core admin menus, where users expect a
		// shell-owned affordance) and on the primary rail in Unified
		// and Spatial (where there is no side dock to host it).
		// Tracked by the dispatcher so it re-attaches automatically
		// after a layout rebuild.
		layoutDispatcher.appendSystemTile(
			{
				id: OS_SETTINGS_WINDOW_ID,
				title: 'OS Settings',
				icon: 'dashicons-desktop',
				// "Open" for the dock dot means "open on the currently
				// active desktop." OS Settings on another desktop
				// shouldn't paint the dot on the active view.
				isOpen: () => {
					const win = manager.getById( OS_SETTINGS_WINDOW_ID );
					if ( ! win ) {
						return false;
					}
					return (
						( win.config.desktopId ||
							manager.getActiveDesktopId() ) ===
						manager.getActiveDesktopId()
					);
				},
				onOpen: openOsSettings,
			},
			'core',
		);

		// PWA install tile — sits next to OS Settings on the same
		// rail (`'core'` affinity) so users see install / settings as
		// peer shell-owned actions. Skipped entirely when the shell
		// itself is already running inside the installed PWA window
		// (`display-mode: standalone`) — there's nothing to install
		// from there, and a perpetually-no-op icon is just noise.
		//
		// **Two-phase guard.** Chrome cold-starts a PWA window with
		// the document briefly reporting `display-mode: browser`
		// before flipping to standalone. The boot-time check covers
		// the common case (display mode already settled); the
		// matchMedia `'change'` listener catches the cold-start race
		// and removes the tile retroactively when the flip arrives,
		// so the icon never lingers in the installed PWA.
		if ( ! isStandaloneDisplay() ) {
			layoutDispatcher.appendSystemTile(
				getInstallTileDef(
					config.pwa?.appName || 'WordPress',
					showToast,
				),
				'core',
			);
		}
		window
			.matchMedia( '(display-mode: standalone)' )
			.addEventListener( 'change', ( e ) => {
				if ( e.matches ) {
					layoutDispatcher?.removeSystemTile(
						'desktop-mode-pwa-install',
					);
				}
			} );

		// Async post-boot: if the PWA is already installed in the
		// current browser profile (Chrome's `Open in app` indicator
		// in the address bar), drop the install tile from regular
		// browser tabs too. The synchronous boot-time check only
		// covers the standalone display case; this handles the
		// "regular tab where the user has already installed" case
		// that otherwise leaves a no-op install icon on the dock
		// and a confusing "already installed" toast on click.
		// `getInstalledRelatedApps()` is async and Chromium-only,
		// so this resolves to a no-op on Safari / Firefox where
		// the tile stays as a fallback.
		void isLikelyInstalled().then( ( installed ) => {
			if ( installed ) {
				layoutDispatcher?.removeSystemTile(
					'desktop-mode-pwa-install',
				);
			}
		} );
	}

	/**
	 * Public OS Settings opener. Routes through the same
	 * `manager.open()` call the system tile uses so a window
	 * reopened from `wp.desktop.openOsSettings()` is identical to
	 * one opened by clicking the dock tile — same id, same render
	 * callback, same dimensions, same focus / minimize behaviour.
	 *
	 * Defined as a closure so the OS Settings tile registration
	 * AND the public API both reach the same opener; previously the
	 * opener lived inside the tile's `onOpen` closure with no way
	 * for plugin authors to invoke it short of DOM-scraping the
	 * tile element. See gap report (`docs/dock-customization.md`)
	 * — custom rail renderers needed a portable way to surface OS
	 * Settings inside their own UI.
	 *
	 * @since 0.18.0
	 */
	function openOsSettings(): void {
		void manager.open( {
			id: OS_SETTINGS_WINDOW_ID,
			baseId: OS_SETTINGS_WINDOW_ID,
			url: '#os-settings',
			title: 'OS Settings',
			icon: 'dashicons-desktop',
			native: true,
			render: ( body ) => osSettings.renderPanel( body ),
			width: 820,
			height: 720,
			minWidth: 560,
			minHeight: 480,
		} );
	}

	/**
	 * Open (or focus) the Bug Report native window. Routed through
	 * `manager.open` so the admin-bar button, the dock system tile,
	 * and any future widget all reach the same window instance.
	 */
	function openBugReport(): void {
		void manager.open( {
			id: BUG_REPORT_WINDOW_ID,
			baseId: BUG_REPORT_WINDOW_ID,
			url: `#${ BUG_REPORT_WINDOW_ID }`,
			title: 'Report a bug',
			icon: 'dashicons-buddicons-replies',
			native: true,
			render: ( body ) => renderBugReport( body ),
			width: 560,
			height: 620,
			minWidth: 420,
			minHeight: 480,
		} );
	}

	// Admin-bar "Report a bug" button. Inline JS in
	// `assets/js/admin-bar.js` dispatches the event; the shell
	// answers here, decoupled from the early-running admin-bar IIFE.
	document.addEventListener( 'desktop-mode-open-bug-report', () => {
		openBugReport();
	} );

	// Dock system tile — sits next to OS Settings on the primary
	// rail. Tracked by the layout dispatcher so it survives a layout
	// rebuild (Classic ↔ Unified ↔ Spatial).
	if ( layoutDispatcher ) {
		layoutDispatcher.appendSystemTile(
			{
				id: BUG_REPORT_WINDOW_ID,
				title: 'Report a bug',
				icon: 'dashicons-buddicons-replies',
				isOpen: () => {
					const win = manager.getById( BUG_REPORT_WINDOW_ID );
					if ( ! win ) {
						return false;
					}
					return (
						( win.config.desktopId ||
							manager.getActiveDesktopId() ) ===
						manager.getActiveDesktopId()
					);
				},
				onOpen: openBugReport,
			},
			'core',
		);

		// Exit Desktop Mode tile — last on the core rail so users have
		// a discoverable in-shell way out, complementing the admin-bar
		// "Switch to Classic Admin" toggle. Reuses the existing
		// save-desktop-mode AJAX endpoint via the
		// `window.desktopModeAdminBar` global; no new PHP surface.
		layoutDispatcher.appendSystemTile(
			getExitDesktopModeTileDef(),
			'core',
		);
	}
	const dock: Dock | null = layoutDispatcher?.getPrimary() ?? null;

	// Initial native-window registry sync — runs AFTER the dispatcher
	// is wired so plugin-owned tiles route through the dispatcher's
	// `appendSystemTile` callback rather than hitting the no-op
	// fallback while the dispatcher is still null.
	void syncNativeWindows(
		Array.isArray( config.nativeWindows ) ? config.nativeWindows : [],
	);

	// Bootstrap: restore session (if any), then decide whether to also
	// auto-open the current admin URL. The rules compose three signals:
	//
	//   1. `fromPortal=false`     → user navigated to a specific admin
	//      URL (e.g. /wp-admin/edit.php). Always honor that navigation
	//      by opening the page; direct URLs are intent.
	//
	//   2. `fromPortal=true`
	//      + session exists       → user is returning to their saved
	//      stack. Respect the stack verbatim — don't force Dashboard
	//      (or any other default) back in. Matches their last state.
	//
	//   3. `fromPortal=true`
	//      + session empty
	//      + defaultWindow.enabled=false
	//                              → user explicitly turned off the
	//      default window. Show them an empty desktop. No auto-open.
	//
	//   4. `fromPortal=true`
	//      + session empty
	//      + defaultWindow.enabled=true
	//                              → first visit or clean slate, and
	//      the default window is set (Dashboard by default). The
	//      portal already redirected to its URL, so the current page
	//      IS the default window — open it. The desktop is populated
	//      with the user's chosen startup.
	const hasSession = !! ( config.session && config.session.windows && config.session.windows.length > 0 );
	if ( hasSession ) {
		// Fire-and-forget: the boot path doesn't need to wait for
		// session restore to complete before proceeding with the
		// rest of setup. Windows appear asynchronously as the lazy
		// `window-system[.min].js` bundle resolves and each
		// `manager.open(...)` finishes. Restore errors are logged
		// rather than surfaced — a broken session shouldn't strand
		// the desktop.
		void restoreSession( manager, config, desktopArea ).catch( ( err ) => {
			if ( typeof console !== 'undefined' ) {
				console.error( '[desktop-mode] session restore failed:', err );
			}
		} );
	}
	const defaultEnabled = config.defaultWindow?.enabled !== false;
	const defaultUrlEarly = config.defaultWindow?.url ?? '';
	const isNativeDefault =
		typeof defaultUrlEarly === 'string' &&
		defaultUrlEarly.startsWith( 'native:' );
	const suppressAutoOpen =
		config.fromPortal &&
		( hasSession || ! defaultEnabled || isNativeDefault );
	if ( ! suppressAutoOpen ) {
		void openCurrentPage( manager, config ).catch( ( err ) => {
			if ( typeof console !== 'undefined' ) {
				console.error( '[desktop-mode] openCurrentPage failed:', err );
			}
		} );
	}

	// Persistence.
	const saveSession = createSessionSaver( manager, config );
	wireSessionEvents( saveSession );

	// Async writer for the default-window preference. Writes the user's
	// choice through the REST endpoint, mutates `config.defaultWindow`
	// in place, and dispatches a CustomEvent the ⋯-menu listens to so
	// the check state repaints live without an OS Settings reopen.
	const setDefaultWindow = async ( url: string | null ): Promise<void> => {
		try {
			const response = await trackedFetch(
				manager,
				config.defaultWindowUrl,
				{
					method: 'POST',
					credentials: 'same-origin',
					headers: {
						'Content-Type': 'application/json',
						'X-WP-Nonce': config.restNonce,
					},
					body: JSON.stringify( { url } ),
				},
				{ source: 'desktop-mode/default-window' },
			);
			if ( ! response.ok ) {
				throw new Error( `HTTP ${ response.status }` );
			}
			const data = ( await response.json() ) as {
				enabled: boolean;
				url: string;
			};
			config.defaultWindow = data;
			document.dispatchEvent(
				new CustomEvent( 'desktop-mode-default-window-changed', {
					detail: data,
				} ),
			);
		} catch ( err ) {
			doAction( HOOKS.SHELL_ERROR, { scope: 'default-window-save', error: err } );
			if ( typeof console !== 'undefined' ) {
				console.error(
					'[desktop-mode] Failed to save default window:',
					err,
				);
			}
		}
	};

	// Manager → public API wiring. When a user clicks "Open on startup"
	// in a window's ⋯ menu, the manager calls this callback with the
	// window. We either set this window's URL as the default, or — if
	// it's already the default — disable it.
	//
	// Native windows (OS Settings, Recycle Bin, plugin-registered)
	// have no admin URL — `getCurrentUrl()` returns the `#<id>` hash
	// fallback, which isn't a redirectable URL the portal can forward
	// to. We store a `native:<id>` marker instead; the PHP validator
	// accepts the marker, the portal redirects to admin home when it
	// sees one, and this module's boot flow opens the right native
	// window after init.
	manager.onToggleStartupRequested = ( win ) => {
		const currentPref = config.defaultWindow;
		const isNative = !! win.config.native;
		const winValue = isNative ? `native:${ win.id }` : win.getCurrentUrl();
		const matchesCurrent = isNative
			? currentPref?.url === winValue
			: urlMatchKey( currentPref?.url ?? '' ) === urlMatchKey( winValue );
		const alreadyDefault = !! currentPref?.enabled && matchesCurrent;
		void setDefaultWindow( alreadyDefault ? null : winValue );
	};

	// Open the native default window on portal entry. The portal
	// redirected the user to admin home (because `native:` markers
	// aren't redirectable), so `openCurrentPage` was suppressed
	// above. Open the user's choice here, after the manager + native
	// registry are wired.
	//
	// Two opener paths because the shell registers built-in native
	// windows (OS Settings) directly against the manager via local
	// closures, NOT through `nativeWindows.openById` — that registry
	// only carries server-payload entries (plugin-registered native
	// windows). Built-ins are matched by id first; everything else
	// falls through to the registry.
	if (
		config.defaultWindow?.enabled &&
		config.fromPortal &&
		! hasSession &&
		isNativeDefault
	) {
		const nativeId = defaultUrlEarly.slice( 'native:'.length );
		// Defer one tick so the dispatcher / system tiles have
		// finished mounting — both built-in openers and the
		// registry assume the layout pass is complete.
		queueMicrotask( () => {
			if ( nativeId === OS_SETTINGS_WINDOW_ID ) {
				openOsSettings();
				return;
			}
			void nativeWindows.openById( nativeId );
		} );
	}

	/**
	 * Place a system tile on the bottom dock rail via the layout
	 * dispatcher so it re-attaches automatically after a layout
	 * rebuild. Plugin-registered launchers that aren't part of the
	 * admin menu (native-window tools, quick-notes panels) land here.
	 */
	const placeSystemTile = ( item: SystemDockItem ): void => {
		layoutDispatcher?.appendSystemTile( item );
	};

	// (Native-window sync was wired earlier — before the layout
	// dispatcher — so the dispatcher's `renderIcons` could close over
	// `nativeWindows.openById` without a TDZ. The initial bulk sync
	// runs right after the dispatcher is built, so plugin-owned
	// native-window tiles route through the dispatcher.)

	// Widget-registry sync — same story for the right-column widget
	// layer. Plugins declare widgets via `desktop_mode_register_widget()`;
	// the shell adds / removes defs from its registry as plugins
	// activate / deactivate mid-session, dynamically loading the
	// plugin's script so the mount callback lands on
	// `window.desktopModeWidgets[ id ]` before we build the WidgetDef.
	const syncServerWidgets = createWidgetRegistrySync( {
		layer: widgetLayer,
	} );
	void syncServerWidgets(
		Array.isArray( config.serverWidgets ) ? config.serverWidgets : [],
	);

	// Wallpaper-registry sync — third instance of the same pattern,
	// same reasoning. Plugins declare wallpapers via
	// `desktop_mode_register_wallpaper()`; the shell loads the
	// plugin's JS, reads the full `WallpaperDef` off
	// `window.desktopModeWallpapers[ id ]`, and adds / removes it
	// from the registry as activation / deactivation plays out.
	const syncServerWallpapers = createWallpaperRegistrySync( {
		osSettings,
	} );
	void syncServerWallpapers(
		Array.isArray( config.serverWallpapers ) ? config.serverWallpapers : [],
	);

	// Command-palette sync — mirrors the widget / wallpaper pattern for
	// slash-commands registered by plugins via
	// `desktop_mode_register_command_script()`. Loads each opted-in
	// script URL on boot (idempotent if WP already enqueued it) and on
	// mid-session plugins-changed signals, so a newly-installed plugin's
	// commands appear in the palette without a reload. Deactivation
	// unregisters commands tagged with a departing script handle as
	// their `owner`; untagged commands survive until the next page load
	// (graceful backwards-compat).
	const syncServerCommands = createCommandRegistrySync();
	void syncServerCommands(
		Array.isArray( config.serverCommandScripts ) ? config.serverCommandScripts : [],
		Array.isArray( config.serverCommands ) ? config.serverCommands : [],
	);

	// Settings-tab sync — same pattern as commands, for OS Settings
	// tabs registered by plugins via
	// `desktop_mode_register_settings_tab_script()`. Injects each
	// opted-in script so a plugin's `registerSettingsTab()` call
	// lands and the (possibly open) OS Settings window repaints.
	const syncServerSettingsTabs = createSettingsTabRegistrySync();
	void syncServerSettingsTabs(
		Array.isArray( config.serverSettingsTabScripts )
			? config.serverSettingsTabScripts
			: [],
		Array.isArray( config.serverSettingsTabs ) ? config.serverSettingsTabs : [],
	);

	// Title-bar-button sync — same pattern. Loads opted-in scripts
	// so plugin-registered buttons appear in matching windows on
	// activation; deactivation drops buttons by `owner` tag.
	const syncServerTitleBarButtons = createTitleBarButtonRegistrySync();
	void syncServerTitleBarButtons(
		Array.isArray( config.serverTitleBarButtonScripts )
			? config.serverTitleBarButtonScripts
			: [],
	);

	// Dock rail renderer sync — loads plugin renderer scripts on
	// activation so OS Settings → Dock style surfaces them
	// without an F5; owner-tagged sweep on deactivation. The
	// dispatcher's subscription to the rail-renderer registry
	// rebuilds the rails automatically if the user's active id
	// now resolves to a freshly-loaded renderer.
	const syncServerDockRailRenderers = createDockRailRendererSync();
	void syncServerDockRailRenderers(
		Array.isArray( config.serverDockRailRendererScripts )
			? config.serverDockRailRendererScripts
			: [],
	);

	// Submenu renderer sync — same shape, different registry.

	// Window-theme sync — Layer 1 of the chrome-customization
	// framework. Loads scripts opted-in via
	// `desktop_mode_register_window_theme_script()` AND honors
	// PHP-declared metadata themes (token-only stylesheets) via
	// `desktop_mode_register_window_theme()`. Live activation /
	// deactivation paints / unpaints the theme on every open window
	// the predicate matches.
	const syncServerWindowThemes = createWindowThemeRegistrySync();
	void syncServerWindowThemes(
		Array.isArray( config.serverWindowThemeScripts )
			? config.serverWindowThemeScripts
			: [],
		Array.isArray( config.serverWindowThemes )
			? config.serverWindowThemes
			: [],
	);

	// Layer-2 controls — register the built-in close/minimize/
	// maximize/focus/detach buttons in the same registry plugins use
	// for custom controls. Plugins that want to reorder, hide, or
	// replace built-ins target their `core/*` ids via per-window
	// `appearance.controls` or via a global `unregisterWindowControl`
	// call. Idempotent — registering a window with the framework's
	// own controls before this runs is fine because every Window
	// constructor calls `repaintWindowControls()` after the registry
	// is ready.
	registerBuiltInControls();

	// Plugin-driven control sync — same activation / deactivation
	// lifecycle as themes and commands. Loads each opted-in plugin
	// script so its `wp.desktop.registerWindowControl()` calls land,
	// then drops owner-tagged controls when handles depart the
	// payload (deactivation).
	const syncServerWindowControls = createWindowControlRegistrySync();
	void syncServerWindowControls(
		Array.isArray( config.serverWindowControlScripts )
			? config.serverWindowControlScripts
			: [],
		Array.isArray( config.serverWindowControls )
			? config.serverWindowControls
			: [],
	);

	// Layer-3 slot sync — same activation / deactivation lifecycle.
	const syncServerWindowSlots = createWindowSlotRegistrySync();
	void syncServerWindowSlots(
		Array.isArray( config.serverWindowSlotScripts )
			? config.serverWindowSlotScripts
			: [],
		Array.isArray( config.serverWindowSlots )
			? config.serverWindowSlots
			: [],
	);

	// Layer-4 (Experimental) custom-chrome sync — same lifecycle.
	const syncServerWindowChromes = createWindowChromeRegistrySync();
	void syncServerWindowChromes(
		Array.isArray( config.serverWindowChromeScripts )
			? config.serverWindowChromeScripts
			: [],
		Array.isArray( config.serverWindowChromes )
			? config.serverWindowChromes
			: [],
	);

	// Cross-window connection bridge — parent side. Builds the
	// `connect()` factory + the iframe-message router. The router
	// is wired into `iframe-bridge.ts` below via a side-channel
	// global so individual Window instances don't need to know
	// about the bridge.
	const connectionBridge = createConnectionBridge( manager );

	// Cross-window broadcast bus — generic fan-out pub/sub. Built-in
	// uses today: Recycle Bin publishes `desktop-mode.data-changed`
	// when items move in/out of trash; iframes (Posts list, Media
	// Library, …) and other native windows can react.
	attachBroadcastBus( manager );
	installBroadcastReceiver();

	// Loading-state transitions — show the `<wpd-spinner>` overlay
	// while a window's iframe boots / native render fetches data,
	// fade the content in once `WINDOW_CONTENT_LOADED` fires. The
	// hook firing itself is in `src/window-channels.ts`; this just
	// wires the visual side.
	installWindowLoadingTransitions();

	// `desktop-mode.shell.toast` action — the documented way for plugins
	// to surface a transient notification without importing
	// `showToast` directly. Payload mirrors the `ToastOptions` type
	// in `src/toast.ts`.
	addAction(
		'desktop-mode.shell.toast',
		'desktop-mode/shell-toast',
		( payload: {
			message?: string;
			action?: { label: string; onClick: () => void };
			duration?: number;
		} ) => {
			if ( ! payload || typeof payload.message !== 'string' ) {
				return;
			}
			showToast( {
				message: payload.message,
				action: payload.action,
				duration: payload.duration,
			} );
		},
	);

	// Recycle-bin count badge — painted on the dock/taskbar tile
	// + desktop icon as soon as those exist. Initial value comes
	// from the shell config (`recycleBinCount`); cross-window
	// `desktop-mode.<type>.changed` broadcasts deliver delta updates
	// so the badge stays accurate without an explicit refresh.
	// `wp_localize_script` coerces every scalar to a string — so
	// `recycleBinCount: 2` (int) lands here as `'2'` (string).
	// `Number()` handles both shapes, and the `|| 0` guard turns
	// `NaN` (missing key) into a safe zero.
	const cfgWithBin = config as DesktopConfig & {
		recycleBinCount?: number | string;
		recycleBinCountUrl?: string;
	};
	const cfgCountRaw = cfgWithBin.recycleBinCount;
	startRecycleBinBadge(
		Number( cfgCountRaw ) || 0,
		typeof cfgWithBin.recycleBinCountUrl === 'string'
			? cfgWithBin.recycleBinCountUrl
			: '',
	);

	// Register custom dock-peek renderers for shell-owned native
	// windows (OS Settings, Recycle Bin). Plugins use the
	// `desktop-mode.dock.peek-card-content` filter directly to surface
	// their own thumbnails — this is just the built-in set so the
	// in-tree windows look like first-class apps.
	registerBuiltInPeekRenderers( {
		getRecycleBinCount: _currentRecycleBinBadge,
	} );

	// Auto-reload iframes on `desktop-mode.<post_type>.changed` is
	// handled IN THE IFRAME (see the chromeless bridge in
	// `includes/render.php`). The iframe-side handler does a soft
	// reload — fetch the current URL, swap `#wpbody-content` —
	// instead of a full `iframe.contentWindow.location.reload()`
	// from the parent, which produces the WP loading spinner the
	// user explicitly asked us not to show. Native windows still
	// react via `wp.desktop.subscribe()`; nothing here.
	(
		window as unknown as {
			__desktopModeConnectionBridge?: ReturnType< typeof createConnectionBridge >;
		}
	).__desktopModeConnectionBridge = connectionBridge;
	// Tear down connections when their target window closes.
	addAction( HOOKS.WINDOW_CLOSED, 'desktop-mode/connection-cleanup', ( e: { windowId?: string } ) => {
		if ( e?.windowId ) {
			connectionBridge.onWindowClosed( e.windowId );
		}
	} );
	// Re-arm pending handshakes once an iframe finishes loading.
	addAction( HOOKS.IFRAME_READY, 'desktop-mode/connection-rearm', ( e: { windowId?: string } ) => {
		if ( e?.windowId ) {
			connectionBridge.onIframeReady( e.windowId );
		}
	} );

	// Public-API alias for the lower-level `manager.open({ native:
	// true, … })` path. Plugins that build their UI entirely in JS
	// (no PHP `desktop_mode_register_window`) reach for this. The
	// PHP-registered native-window path goes through
	// `nativeWindows.openById` instead — which pre-clones the
	// template into the body before render fires.
	const registerWindow = createRegisterWindow( manager );

	// Desktop icons — shortcut tiles on the wallpaper, registered
	// server-side via `desktop_mode_register_icon()`. Re-rendered on
	// every live menu refresh so a plugin activation adds / removes
	// tiles without a full shell reload.
	//
	// The icon's `openWindow` delegates straight to
	// `nativeWindows.openById` — the same opener the dock/taskbar
	// click goes through. This is load-bearing: the canonical opener
	// pre-clones the registered template into the body before the
	// plugin's render callback fires. Hand-rolling a separate path
	// here (which we used to do) leaks an empty body to render
	// callbacks that depend on the cloned template, breaking every
	// plugin that follows the documented pattern.
	// Wallpaper-icon repaint that re-uses whatever the layout
	// dispatcher last said the merged list should be. In Spatial
	// mode the dispatcher synthesizes core menu items as additional
	// icons; in every other layout this is a passthrough to
	// `renderDesktopIcons`.
	const renderIcons = (
		icons: import( './types' ).DesktopIconServerEntry[] | undefined,
	): void => {
		if ( layoutDispatcher ) {
			layoutDispatcher.applyDesktopIcons( icons );
			return;
		}
		// Headless paths without a dispatcher (rare; tests, older
		// shell markup) still need direct rendering.
		renderDesktopIcons( desktopArea, icons, {
			openWindow: nativeWindows.openById,
			manager,
		} );
	};

	// Live menu refresh — rebuild the dock when a plugin activation
	// or deactivation lands in any windowed `plugins.php`. Without
	// this the dock reflects the server-side `$menu` at shell boot
	// only, so the user would have to hard-reload the whole tab to
	// see a newly-activated plugin's top-level menu appear on the
	// dock (or vanish on deactivation).
	//
	// Wired BEFORE the `window.wp.desktop` assignment so the returned
	// refresh function is available to expose in the public API in
	// the same statement.
	const refreshMenu = bindMenuRefresh( {
		layoutDispatcher,
		desktopArea,
		config,
		syncNativeWindows,
		syncServerWidgets,
		syncServerWallpapers,
		syncServerCommands,
		syncServerSettingsTabs,
		syncServerTitleBarButtons,
		syncServerDockRailRenderers,
		renderIcons,
	} );

	// Live desktop-layout sync: when the user picks a new layout
	// in OS Settings, the dispatcher tears down the current dock(s),
	// rebuilds for the new layout, and (in Spatial) re-emits the
	// merged wallpaper-icons list. `osSettings.apply()` has already
	// written `data-desktop-mode-layout` on the shell root by the time
	// this fires.
	//
	// The public-API references on `wp.desktop` are mutated in place
	// so a plugin reading `wp.desktop.dock` after a layout change
	// gets the current primary rail without an explicit re-fetch.
	// Plugins that CACHED a reference earlier should listen for
	// `desktop-mode-layout-changed` to know the value moved.
	osSettings.subscribeOsSettings( ( snapshot ) => {
		if ( ! layoutDispatcher ) {
			return;
		}
		const prevLayout = layoutDispatcher.getLayout();
		layoutDispatcher.setLayout( snapshot.desktopLayout );
		desktopApi.dock = layoutDispatcher.getPrimary();
		desktopApi.sideDock = layoutDispatcher.getSide();
		desktopApi.desktopLayout = snapshot.desktopLayout;
		// Always re-apply per-item placement on every settings save.
		// `setLayout` already rebuilt from scratch when the layout
		// itself changed (and reads the latest settings while doing
		// so), so we skip the explicit refresh in that case to avoid
		// double-rendering. Otherwise, refresh unconditionally — the
		// snapshot may carry an item-visibility or dock-order change
		// that callers (settings tab, context menu, drag-to-reorder)
		// rely on landing live.
		if ( prevLayout === snapshot.desktopLayout ) {
			layoutDispatcher.refresh();
		}
		// Bring the files-layer placements in line with the new
		// visibility map — promotes dock items onto the wallpaper
		// and removes hidden server icons from the grid.
		syncShortcutsWithVisibility( snapshot.itemVisibility );
		// Cross-bundle SSOT publish — feature bundles + third-party
		// plugins that imported `@layout` see the change without
		// having to thread the OsSettings snapshot through.
		setCurrentLayout( snapshot.desktopLayout );
	} );

	// Install the files-layer reconciler. Runs an initial sync on a
	// microtask AND on every files-store change so the server's
	// page-load hydration of registered icons gets filtered through
	// the visibility map immediately.
	installShortcutsSync(
		() => osSettings.getOsSettingsSnapshot().itemVisibility,
	);

	// Initial publish so any consumer that reads `getCurrentLayout()`
	// before the first OS Settings change sees the right value.
	setCurrentLayout( osSettings.getOsSettingsSnapshot().desktopLayout );

	// The wp.desktop.* assembly was extracted to `src/api/facade.ts`
	// in 0.8.1 — `buildPublicApi(deps)` returns the same WpDesktopPublicApi
	// shape this block used to declare inline; `installPublicApi(api)`
	// does the merge-onto-shim that the block used to do at the end.
	// Behavior is identical; tests touching `wp.desktop.*` keep
	// passing unchanged.
	const desktopApi: WpDesktopPublicApi = buildPublicApi( {
		manager,
		dock,
		layoutDispatcher,
		osSettings,
		iconsApi,
		filesApi,
		saveSession,
		widgetLayer,
		registerWindow,
		openWindowById: nativeWindows.openById,
		openNewWindowById: nativeWindows.openNewById,
		placeSystemTile,
		setDefaultWindow,
		refreshMenu,
		openOsSettings,
		aiAssistant,
		dragBridge,
		dragManager,
		connect: connectionBridge.connect,
		config,
	} );
	installPublicApi( desktopApi );

	// Now that `wp.desktop.dragManager` is on the window, register
	// the recycle-bin drop targets (dock icon + window body). The
	// installer is idempotent — it listens for `DOCK_AFTER_RENDER`
	// and `WINDOW_OPENED` to (re-)attach when the elements appear.
	installRecycleBinDropTargets( dragManager );

	// Wire the cross-feature Heartbeat bus before any consumer
	// (presence, recycle bin, third-party plugins) registers a
	// contributor / subscriber. Idempotent — safe to run twice
	// if init() ever fires again.
	bootHeartbeatBus();

	// Files-on-the-Desktop: hand the open() dispatcher real
	// dependencies and seed the per-user associations from the
	// shell config. Done here so the manager is fully wired and
	// the public API is already on `window.wp.desktop`.
	installFilesOpenDeps( {
		openUrl: ( { id, url, title, icon } ) => {
			// Same path the in-shell link interceptor takes:
			// consult the native-URL remap registry FIRST so a
			// desktop shortcut whose target is an admin URL that
			// a native window has claimed (`user-edit.php?user_id=N`
			// → User Edit window, `users.php` → Users window,
			// `edit.php` → Posts window, …) opens the native
			// experience instead of an iframe of classic chrome.
			// Without this, double-clicking a user shortcut on the
			// desktop dropped users into the old `wp-admin` profile
			// page even though everything else (admin-bar links,
			// dock clicks, in-window anchors) routed natively.
			if ( tryNativeUrlRemap( url ) ) {
				return true;
			}
			// Fire-and-forget: `installFilesOpenDeps` expects a sync
			// boolean meaning "did we accept the open intent?". The
			// open dispatch is intent-only — the lazy
			// `window-system[.min].js` bundle finishes constructing
			// the actual `<Window>` asynchronously. We return `true`
			// to signal acceptance; failures inside the lazy path
			// surface via the manager's normal error channels.
			void manager.open( { id, baseId: id, url, title, icon } );
			return true;
		},
		openNativeWindow: ( id ) => nativeWindows.openById( id ),
		deriveWindowId: ( url: string ) => deriveWindowId( url, config.adminUrl ),
	} );
	setFilesUserAssociations(
		( config.userFileAssociations as Record< string, string > | undefined ) ?? {},
	);
	if ( typeof config.filesUrl === 'string' && config.filesUrl ) {
		filesRest.installRestDeps( {
			baseUrl: config.filesUrl,
			nonce: config.restNonce,
		} );
		// Mount the root files layer on the desktop area. Hydrates
		// from REST on first paint; subsequent paints come from
		// the shared store. Skipped when the area DOM element
		// isn't in the page (headless tests, classic admin).
		const rootHost = document.getElementById( 'desktop-mode-area' );
		if ( rootHost ) {
			mountFilesLayer( rootHost, 0 );
		}
	}

	// Wire the Files-on-the-Desktop Heartbeat sync. Idempotent —
	// safe to call again on a re-init.
	startFilesHeartbeat();

	// Restore-from-bin sync: refetches hydrated folders the moment the
	// Recycle Bin broadcasts `action: 'untrashed'` so a restored
	// folder/placement lands back on the desktop without waiting for
	// the next Heartbeat tick.
	startFilesRestoreSync();

	// Boot the framework presence probe — always runs in desktop
	// mode, regardless of whether the chat feature is enabled. The
	// probe wires Heartbeat send/tick listeners that bump server
	// presence and ingest the snapshot. Idempotent on repeat
	// init() calls (the underlying singleton-guards itself).
	bootPresenceProbe();

	// Fire `desktop-mode.init` — plugins can now register wallpapers
	// and hook other surfaces. Fired AFTER `window.wp.desktop` is
	// populated so subscribers see the full public API. Subscribers
	// that later re-apply the wallpaper pick up their own
	// registrations via registry re-read.
	// Component-registry signal — fires before `INIT` so plugin
	// subscribers that need the component kit available can subscribe
	// to either hook (components first, init second) and rely on the
	// ordering.
	doAction( HOOKS.COMPONENTS_REGISTERED, { tags: [ ...WPD_COMPONENT_TAGS ] } );

	// Built-in slash-commands (`/open`). Registered AFTER the public
	// API is mounted so the command's `suggest()` / `run()` can read
	// `wp.desktop.config` + `windowManager`, and BEFORE `HOOKS.INIT`
	// so plugin subscribers that want to extend via
	// `desktop-mode.open-command.items` can rely on the command being
	// in the registry.
	registerBuiltInCommands();

	// PWA bootstrap — initialise the install pill, register the SW,
	// and load the per-user dismissal/notifications snapshot. Runs
	// AFTER the public API is mounted so a plugin's `whenReady`
	// callback can immediately call `wp.desktop.pwa.*` or the
	// `wp.desktop.notify` API. No-op when `config.pwa` is absent
	// (chromeless context, classic admin, older PHP build).
	bootstrapPwa( config, showToast );

	// Pre-load the shell-overlays bundle (toast + confirm-dialog +
	// context-menu component classes) in the background once we're
	// past the boot path. By the time the user fires their first
	// `showToast()` / `wpdConfirm()` / right-click, the components
	// are already registered and the overlay opens with no
	// perceptible latency. Idle-callback when available, falls back
	// to a 0ms timer so even non-supporting browsers get the
	// "after first paint" timing.
	const overlayPreload = (): void => {
		preloadShellOverlays( config.shellOverlaysBundleUrl ?? '' );
		// Window system (Stage 11) — preload alongside the
		// overlays. By the time the user clicks an icon and
		// `windowManager.open()` runs, the lazy bundle is
		// registered and `createWindow()`'s `await` resolves on
		// the sync fast path. Session-restore and openCurrentPage
		// race the preload, but both are explicit `await
		// manager.open(...)` paths so they just wait an extra
		// frame.
		preloadWindowSystem( config.windowSystemBundleUrl ?? '' );
	};
	if ( typeof window.requestIdleCallback === 'function' ) {
		window.requestIdleCallback( overlayPreload, { timeout: 1500 } );
	} else {
		window.setTimeout( overlayPreload, 0 );
	}

	doAction( HOOKS.INIT, { config } );

	// Drain the early-shim's whenReady queue. Callbacks queued by
	// consumer scripts that landed BEFORE the bootstrap finished
	// see a fully-mounted `window.wp.desktop` (full API + HOOKS.INIT
	// already fired) when they fire. Callbacks queued AFTER this
	// point go through the canonical `whenReady` from `src/hooks.ts`
	// (already merged onto the slot above), which handles the
	// post-init case via `Promise.resolve().then( cb )`.
	_earlyReady = true;
	const queued = _earlyReadyQueue.splice( 0 );
	for ( const cb of queued ) {
		try {
			cb();
		} catch ( err ) {
			// Don't let one consumer's bad callback strand the
			// rest. Surface via SHELL_ERROR + console — same shape
			// as the wallpaper / widget mount error handlers.
			doAction( HOOKS.SHELL_ERROR, {
				scope: 'when-ready-cb',
				error: err,
			} );
			if ( typeof console !== 'undefined' ) {
				// eslint-disable-next-line no-console
				console.error( '[desktop-mode] whenReady cb threw:', err );
			}
		}
	}

	// Re-apply the wallpaper once init subscribers have had a chance
	// to register — if the user's saved selection belongs to a plugin
	// that just registered, this is when it becomes visible.
	osSettings.apply();

	// Hydrate widgets AFTER `desktop-mode.init` so plugin-registered
	// defs are in the registry when the user's saved list is
	// resolved. Hydration is idempotent — safe if it fires twice
	// (shouldn't, but defensive).
	widgetLayer?.hydrate();

	// Tear down any active canvas wallpaper + every mounted widget
	// on page unload. Both hold intervals / tickers / WebGL
	// contexts that would otherwise compete with the session-beacon
	// flush.
	window.addEventListener( 'pagehide', () => {
		wallpaperLayer?.teardownActive();
		widgetLayer?.disposeAll();
	} );

	// Shell-level lifecycle actions — fired once the public API exists
	// so plugin authors can subscribe from `desktop-mode.init`.
	bindShellLifecycle();

	// Intercept top-window clicks on /wp-admin/ links so they route into
	// the window manager instead of reloading the whole page. Without this,
	// the admin bar's "Edit my profile", "New Post", comments counter, etc.
	// each trigger a full-tab navigation → portal redirect → shell re-boot
	// cycle even though the outcome is "open a window in this shell".
	// Chromeless iframes have their own interceptor in render.php; this one
	// covers the top-window chrome (admin bar, anything any plugin hangs
	// off the shell).
	bindTopWindowLinkInterceptor( manager, config );

	// Click on the desktop background to minimize all windows (like macOS "Show Desktop").
	//
	// Suppressed while overview is active. Overview owns its own
	// pointer surface and drives selection/cancel via pointerdown +
	// pointerup on the same element — the browser still synthesizes a
	// trailing `click` on the common ancestor (the desktop area) for
	// drag-across-thumbnails and backdrop taps, and without this guard
	// that click would minimize every window the moment the overview
	// animation starts, leaving thumbnail labels orphaned on an empty
	// backdrop. The guard checks the live class on `desktopArea`
	// because overview can be entered/exited repeatedly — a captured
	// boolean snapshot would go stale.
	/**
	 * Re-tile every placement at the desktop root in the order
	 * returned by `transform`. Used by Clean up (identity transform),
	 * Sort by * (sort transforms, persisted), and the auto-arrange
	 * ResizeObserver (current sort transform, NOT persisted — see
	 * `rootSortMode` below).
	 *
	 * When `persist` is `false` we only mutate the store + DOM (via
	 * the layer's repaint subscription); REST is left alone so a
	 * resize storm doesn't fire dozens of writes per tile.
	 */
	const relayoutRoot = (
		transform: (
			arr: import( './desktop-files/rest' ).RestPlacementShape[],
		) => import( './desktop-files/rest' ).RestPlacementShape[],
		persist = true,
	): void => {
		const root = filesApi.store.getState().placementsByFolder.get( 0 ) ?? [];
		const ordered = transform( root );
		// Column-major fill: top-to-bottom within a column, then to
		// the next column. Number of rows comes from the desktop
		// area's measured height so columns wrap cleanly.
		const rowsPerCol = Math.max(
			1,
			Math.floor( ( desktopArea.clientHeight - 16 ) / 110 ),
		);
		const occupied = new Set< string >();
		let i = 0;
		for ( const p of ordered ) {
			const cell = snapToEmptyCell(
				16 + Math.floor( i / rowsPerCol ) * 96,
				16 + ( i % rowsPerCol ) * 110,
				occupied,
				desktopArea,
			);
			occupied.add( `${ cell.col },${ cell.row }` );
			i++;
			if ( p.x === cell.x && p.y === cell.y ) {
				continue;
			}
			filesApi.store.upsertPlacement( {
				...p,
				x: cell.x,
				y: cell.y,
				sortOrder: i,
			} );
			if ( ! persist ) {
				continue;
			}
			void filesRest
				.updatePlacement( p.id, {
					x: cell.x,
					y: cell.y,
					sortOrder: i,
				} )
				.catch( ( err: unknown ) => {
					// eslint-disable-next-line no-console
					console.error( '[desktop-mode] relayout persist failed', err );
				} );
		}
	};

	/**
	 * Build the placement-list transform for a given sort mode. Same
	 * sort keys the wallpaper menu offers; extracted so the resize
	 * observer can re-apply the user's last pick without duplicating
	 * the comparator logic.
	 */
	const rootSortTransform = ( mode: RootSortMode ) => (
		arr: import( './desktop-files/rest' ).RestPlacementShape[],
	): import( './desktop-files/rest' ).RestPlacementShape[] => {
		const sorted = arr.slice();
		switch ( mode ) {
			case 'name-asc':
				sorted.sort( ( a, b ) =>
					a.file.title.localeCompare( b.file.title ),
				);
				break;
			case 'name-desc':
				sorted.sort( ( a, b ) =>
					b.file.title.localeCompare( a.file.title ),
				);
				break;
			case 'date-asc':
				sorted.sort( ( a, b ) => a.updatedAtMs - b.updatedAtMs );
				break;
			case 'date-desc':
				sorted.sort( ( a, b ) => b.updatedAtMs - a.updatedAtMs );
				break;
		}
		return sorted;
	};

	// Auto-arrange / "sort by" sticky state. When a user picks Sort
	// By from the wallpaper menu we remember the mode so subsequent
	// desktop resizes re-pack the icons into the new column count
	// (overflowing icons would otherwise stay where they were and
	// fall off the right/bottom edges as the window shrinks). Cleared
	// when the user manually drags a tile — manual placement wins,
	// macOS Finder convention.
	const ROOT_SORT_MODE_KEY = 'desktop-mode:root-sort-mode';
	const isRootSortMode = ( v: unknown ): v is RootSortMode =>
		v === 'name-asc' ||
		v === 'name-desc' ||
		v === 'date-asc' ||
		v === 'date-desc';
	let rootSortMode: RootSortMode | null = ( () => {
		try {
			const raw = window.localStorage.getItem( ROOT_SORT_MODE_KEY );
			return isRootSortMode( raw ) ? raw : null;
		} catch {
			return null;
		}
	} )();
	const setRootSortMode = ( mode: RootSortMode | null ): void => {
		rootSortMode = mode;
		try {
			if ( mode ) {
				window.localStorage.setItem( ROOT_SORT_MODE_KEY, mode );
			} else {
				window.localStorage.removeItem( ROOT_SORT_MODE_KEY );
			}
		} catch {
			// localStorage unavailable (private mode, quota) — keep
			// the in-memory state and move on.
		}
	};

	// Clear auto-arrange when the user manually drags a root tile.
	// Emitted by `desktop-files/layer.ts` from the canvas drop
	// handler; folderId 0 = the desktop root.
	addAction(
		'desktop-mode.files.tile-manually-placed',
		'desktop-mode/root-sort-clear',
		( payload: unknown ) => {
			const folderId = ( payload as { folderId?: number } | undefined )
				?.folderId;
			if ( folderId === 0 ) {
				setRootSortMode( null );
			}
		},
	);

	// Re-pack icons when the desktop area resizes — but ONLY while
	// auto-arrange is active. Manual layouts stay untouched. The
	// non-persisting relayout mutates the store so the layer's
	// subscription repaints, and avoids a REST writeback storm
	// during a continuous drag-resize of the browser window.
	if ( typeof ResizeObserver !== 'undefined' ) {
		let lastW = desktopArea.clientWidth;
		let lastH = desktopArea.clientHeight;
		const ro = new ResizeObserver( () => {
			if ( ! rootSortMode ) {
				return;
			}
			const w = desktopArea.clientWidth;
			const h = desktopArea.clientHeight;
			if ( w === lastW && h === lastH ) {
				return;
			}
			lastW = w;
			lastH = h;
			relayoutRoot( rootSortTransform( rootSortMode ), false );
		} );
		ro.observe( desktopArea );
	}

	// Wallpaper context menu — RIGHT-click only. `contextmenu` is
	// the only opener; left-clicks on the bg either dismiss the
	// menu (handled inside `openWallpaperMenu`) or do nothing.
	// `e.preventDefault()` suppresses the native browser CMO so we
	// always show ours.
	desktopArea.addEventListener( 'contextmenu', ( e: MouseEvent ) => {
		// Skip when the right-click landed on a tile / inner widget
		// rather than the bare wallpaper — those surfaces own their
		// own context menus.
		if ( e.target !== desktopArea ) {
			return;
		}
		e.preventDefault();
		const clientX = e.clientX;
		const clientY = e.clientY;
		( () => {
			if ( desktopArea.classList.contains( 'desktop-mode-area--overview' ) ) {
				return;
			}
			// Right-click toggles: open if closed, close if already
			// open from the wallpaper.
			if ( isWallpaperMenuOpen() ) {
				closeWallpaperMenu();
				return;
			}
			// Capture the click coordinates so a folder created from
			// this menu lands where the user clicked, not at (0, 0).
			const dropClient = { x: clientX, y: clientY };
			// Snap the click point to the nearest empty grid cell —
			// shared between every "new" item the menu spawns
			// (folder, link, embed) so anything created lands on a
			// clean cell aligned with the grid.
			const cellAtClick = (): { x: number; y: number } => {
				const rect = desktopArea.getBoundingClientRect();
				const rawX = Math.max( 0, dropClient.x - rect.left );
				const rawY = Math.max( 0, dropClient.y - rect.top );
				const occupied = buildOccupiedSet(
					filesApi.store.getState().placementsByFolder.get( 0 ) ?? [],
				);
				return snapToEmptyCell( rawX, rawY, occupied, desktopArea );
			};
			const createUrlPlacement = (
				dialogTitle: string,
				description: string,
			): void => {
				openUrlDialog( {
					title: dialogTitle,
					description,
					nameLabel: 'Name',
					urlLabel: 'URL',
					submitLabel: 'Create',
					onSubmit: async ( { name, url } ) => {
						const cell = cellAtClick();
						const placement = await filesRest.createPlacement( {
							type: 'link',
							ref: url,
							parentId: 0,
							x: cell.x,
							y: cell.y,
							meta: name ? { name } : undefined,
						} );
						filesApi.store.upsertPlacement( placement );
					},
				} );
			};
			const items = buildWallpaperMenuItems( {
				createFolder: () => {
					openCreateFolderDialog( {
						onSubmit: async ( name ) => {
							const folder = await filesRest.createFolder( { name } );
							const cell = cellAtClick();
							const placement = await filesRest.createPlacement( {
								type: 'folder',
								ref: String( folder.id ),
								parentId: 0,
								x: cell.x,
								y: cell.y,
							} );
							filesApi.store.upsertFolder( folder );
							filesApi.store.upsertPlacement( placement );
						},
					} );
				},
				createUrl: () =>
					createUrlPlacement(
						'New URL',
						'Opens the URL in a new browser tab.',
					),
				toggleShowDesktop: () => manager.toggleShowDesktop(),
				openOsSettings: () => openOsSettings(),
				openWallpapers: () => openOsSettings(),
				sortIcons: ( mode ) => {
					setRootSortMode( mode );
					relayoutRoot( rootSortTransform( mode ) );
				},
				currentSortMode: rootSortMode,
				labels: {
					createFolder: 'New folder',
					showDesktop: 'Show desktop',
					osSettings: 'OS Settings',
					wallpapers: 'Wallpapers',
					sortHeading: 'Sort by',
					sortNameAsc: 'Name (A → Z)',
					sortNameDesc: 'Name (Z → A)',
					sortDateAsc: 'Date (oldest first)',
					sortDateDesc: 'Date (newest first)',
					newUrl: 'New URL',
				},
				serverItems: ( config.serverWallpaperMenuItems as
				| ServerWallpaperMenuItem[]
				| undefined ) ?? [],
			} );
			// No `excludeOutsideTarget` — with right-click-only
			// activation, a left-click on the wallpaper should
			// dismiss the menu (no toggle race to protect against).
			openWallpaperMenu(
				document.body,
				{ x: clientX, y: clientY },
				items,
			);
		} )();
	} );

	// The URL bar is intentionally NOT normalized to /desktop-mode/.
	// Prior versions did a `history.replaceState(..., config.portalUrl)`
	// here to unify the address bar around the portal URL — cosmetically
	// nicer, but every browser reload hit /desktop-mode/, which triggered
	// a portal HTTP redirect to the canonical admin URL, producing a
	// visible address-bar flash (`/wp-admin/index.php?desktop_mode_portal=1`
	// → `/desktop-mode/`) on every reload. Leaving the URL as the actual
	// admin URL eliminates the flash and makes reloads instant — the
	// user sees /wp-admin/... in the address bar in exchange, which is
	// also more transparent about where the shell is currently hosted.
	// `config.portalUrl` stays in the shell config so plugins that want
	// to build "home" links can still point at the portal.

	document.dispatchEvent(
		new CustomEvent( 'desktop-mode-init', {
			detail: { config, restored: hasSession },
		} ),
	);
}

// `restoreSession` and `openCurrentPage` were moved to
// `src/boot/session.ts` in 0.8.1 — see the imports near the top of
// this file. This is the architecture-0.8.1 phase-5 split.

// `trackedFetch` was moved to `src/boot/tracked-fetch.ts` in 0.8.1.

// `openCurrentPage` lives in `src/boot/session.ts` since 0.8.1.

// `bindTopWindowLinkInterceptor` was moved to
// `src/boot/link-interceptor.ts` in 0.8.1.
//
// `findDockEntryForUrl` and `clampGeometryToViewport` were moved
// to `src/boot/geometry.ts` in 0.8.1.

// `createSessionSaver` (and the SESSION_SAVE_DEBOUNCE_MS constant) was
// moved to `src/boot/session-saver.ts` in 0.8.1.

// `wireSessionEvents` and `bindShellLifecycle` were moved to
// `src/boot/shell-lifecycle.ts` in 0.8.1.

// `bindMenuRefresh` and `MENU_REFRESH_TIMEOUT_MS` were moved to
// `src/boot/menu-refresh.ts` in 0.8.1.

// Initialize when DOM is ready.
if ( document.readyState === 'loading' ) {
	document.addEventListener( 'DOMContentLoaded', init );
} else {
	init();
}

// Backwards-compat re-export — `clampGeometryToViewport` was inlined here
// before 0.8.1 and tests imported it from this module. New code should
// reach for `@boot/geometry` directly.
export { clampGeometryToViewport } from './boot/geometry';
