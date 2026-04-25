/**
 * Desktop Mode — Entry Point.
 *
 * Initializes the desktop shell, restores the user's session if one
 * exists, opens the current admin page otherwise, wires session
 * persistence to change events, and normalizes the browser URL to
 * `/wp-desktop/` so the address bar shows a single stable location
 * regardless of which admin page is open in which window.
 *
 * @since 6.9.0
 */

import { WindowManager } from './window-manager';
import { installWindowSwitcherShortcut } from './window-manager/switcher';
import { Dock, type SystemDockItem } from './dock';
import { OsSettings } from './settings';
import { deriveWindowId, urlMatchKey } from './utils';
import {
	HOOKS,
	addAction,
	doAction,
	rawHooks,
	whenReady,
	isReady,
	type WpHooks,
} from './hooks';
import * as registry from './wallpapers/registry';
import { WallpaperLayer } from './wallpapers/layer';
import { registerBuiltInWallpapers } from './wallpapers/built-in';
import { createWallpaperRegistrySync } from './wallpapers/server-sync';
import { createCommandRegistrySync } from './commands/server-sync';
import { createSettingsTabRegistrySync } from './settings/server-sync';
import {
	registerSettingsTab,
	unregisterSettingsTab,
	listSettingsTabs,
	type DesktopSettingsTab,
} from './settings/registry';
import {
	registerTitleBarButton,
	unregisterTitleBarButton,
	listTitleBarButtons,
	type TitleBarButtonDef,
} from './title-bar-buttons/registry';
import { createTitleBarButtonRegistrySync } from './title-bar-buttons/server-sync';
import {
	createConnectionBridge,
	type WindowConnection,
	type ConnectOptions,
} from './connection';
import { IframeCommandBridge } from './commands/iframe-bridge';
import { loadVendorScript } from './wallpapers/vendor-loader';
import {
	collectWallpaperSurfaces,
	type WallpaperSurface,
} from './wallpapers/surfaces';
import { WidgetLayer } from './widgets/layer';
import {
	cloneTemplate,
	createNativeWindowSync,
	createRegisterWindow,
	onWindow,
	type WindowLifecycleHandlers,
} from './native-windows';
import { renderDesktopIcons } from './desktop-icons';
import { AiAssistant, type AiAssistantApi } from './ai-assistant';
import { createAsk } from './ai/ask';
import { DragBridge, type DragBridgeApi } from './drag-bridge';
import {
	registerCommand,
	unregisterCommand,
	listCommands,
	type DesktopCommand,
} from './commands';
import { registerBuiltInCommands } from './built-in-commands';
import {
	registerPalette,
	unregisterPalette,
	listPalettes,
	openPaletteOnly,
	installPaletteShortcut,
	type Palette,
} from './palette-registry';

/**
 * Origin snapshot taken at shell module load. Every same-origin gate
 * in this file (message listeners, link interception) compares against
 * this value so a plugin script that mutates `window.location` mid-
 * session can't relax the cross-origin guards.
 *
 * @since 0.11.0
 */
const INITIAL_ORIGIN = window.location.origin;
import { registerBuiltInWidgets } from './widgets/built-in';
import * as widgetRegistry from './widgets/registry';
import { createWidgetRegistrySync } from './widgets/server-sync';
import { WPD_COMPONENT_TAGS } from './ui/components';
import {
	registerModule,
	loadModules,
	type ModuleDef,
} from './modules/registry';
import type { WallpaperDef } from './wallpapers/types';
import './plugins';
import type {
	DesktopConfig,
	NativeWindowDef,
	SessionWindow,
} from './types';
import type { Window as DesktopWindow } from './window';

/** Stable id for the OS Settings native window. */
const OS_SETTINGS_WINDOW_ID = 'wp-desktop-os-settings';

/**
 * Public surface exposed on `window.wp.desktop`. Third-party plugins
 * rely on these members being stable — new fields may be added over
 * time, but nothing here is removed without a major-version bump.
 */
export interface WpDesktopPublicApi {
	windowManager: WindowManager;
	dock: Dock | null;
	/**
	 * Bottom-edge taskbar — `null` when either the shell markup lacks
	 * the taskbar element (older shell build) or no plugin-contributed
	 * menus were routed to it (`config.taskbarItems` empty). The
	 * taskbar is an instance of the same `Dock` class as the left-edge
	 * dock — only its orientation + CSS differ.
	 */
	taskbar: Dock | null;
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
	/** Convenience: register a wallpaper via `wp-desktop.wallpapers` filter. */
	registerWallpaper: ( def: WallpaperDef ) => void;
	/** Convenience: register a widget via `wp-desktop.widgets` filter. */
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
	 * isn't part of the admin menu — Jorvy, a quick-notes panel, a
	 * native-window tool) on one of the two rails.
	 *
	 * Default placement is `'taskbar'` — the bottom macOS-style pill
	 * that already hosts installed-plugin menus. That keeps the
	 * left-edge dock reserved for core WordPress pages + shell-owned
	 * affordances (OS Settings). Plugins that genuinely belong on
	 * the left rail (rare) can pass `placement: 'dock'` explicitly.
	 *
	 * When a tile lands on the taskbar and the taskbar was empty
	 * (no plugin-menu items, no prior system tiles), the bar is
	 * auto-unhidden. Returns the resolved placement for callers
	 * that want to log / persist it.
	 */
	registerSystemTile: (
		item: SystemDockItem,
		placement?: 'dock' | 'taskbar',
	) => 'dock' | 'taskbar';
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
	registerWindow: ( def: NativeWindowDef ) => DesktopWindow;
	/**
	 * Clone a `<template>` element's contents into a fresh
	 * `DocumentFragment`. Convenience wrapper — accepts either the
	 * element's DOM id or the element itself. Throws if the
	 * reference doesn't resolve to a template.
	 */
	cloneTemplate: ( template: string | HTMLTemplateElement ) => DocumentFragment;
	/**
	 * Subscribe to a specific window's lifecycle events by id.
	 * Returns an unsubscribe function; also auto-unsubscribes when
	 * the window closes. See {@link WindowLifecycleHandlers}.
	 */
	onWindow: (
		id: string,
		handlers: WindowLifecycleHandlers,
	) => () => void;
	/** Load a vendor script once, memoized. See `src/wallpapers/vendor-loader.ts`. */
	loadVendorScript: ( url: string ) => Promise<void>;
	/**
	 * Live list of collision surfaces for wallpaper effects —
	 * window tops, shell floor, taskbar top, dock edge, widget
	 * cards, plus anything plugins added via the
	 * `wp-desktop.wallpaper.surfaces` filter. Rects are in
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
	/** Run `cb` after `wp-desktop.init` has fired (immediately if already fired). */
	whenReady: ( cb: () => void ) => void;
	/**
	 * Short alias of {@link whenReady}. The idiomatic entry point for
	 * plugin scripts — especially those loaded late by server-sync
	 * (widgets, wallpapers, commands, settings tabs) after
	 * `wp-desktop.init` has already fired. Mirrors the ergonomics of
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
	 * Synchronously report whether the shell's `wp-desktop.init` action
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
	 * `wp-desktop-default-window-changed` CustomEvent on `document`
	 * so the ⋯-menu checkmarks repaint.
	 */
	setDefaultWindow: ( url: string | null ) => Promise<void>;
	/**
	 * Force a refetch of the live admin-menu split from
	 * `GET /wp-desktop/v1/menu` and repaint both rails. Invoked
	 * automatically when a windowed `plugins.php` signals an
	 * activation / deactivation; plugins that mutate the admin menu
	 * server-side outside that flow can call this directly to surface
	 * their changes without a full reload.
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
	 * `wp-desktop-open-ai` event on `document`, which the assistant
	 * also listens for — no direct reference needed.
	 *
	 * @since 0.14.0
	 */
	ai: AiAssistantApi;
	/**
	 * Cross-window drag bridge — the authoritative carrier for
	 * attachment payloads that cross iframe boundaries (Media Library
	 * → post editor). Source iframes call `window.parent.postMessage`
	 * with a `wp-desktop-drag-start` payload; this bridge stores it
	 * and replies to `wp-desktop-drag-payload-request` messages from
	 * receiver iframes during their drop handlers.
	 *
	 * @since 0.14.0
	 */
	dragBridge: DragBridgeApi;
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
}

declare global {
	interface Window {
		wpDesktopConfig?: DesktopConfig;
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
const SESSION_SAVE_DEBOUNCE_MS = 500;

/** Minimum margin between the restored window and the desktop edges when clamping. */
const VIEWPORT_CLAMP_MARGIN = 12;

/**
 * Initialize Desktop Mode.
 */
function init(): void {
	const config = window.wpDesktopConfig;
	if ( ! config ) {
		return;
	}

	const desktopArea = document.getElementById( 'wp-desktop-area' );
	if ( ! desktopArea ) {
		return;
	}

	const manager = new WindowManager( desktopArea );

	// Wallpaper layer + registry. Built-in presets register immediately
	// (synchronously, before `wp-desktop.init` fires) so the filter chain
	// third-party plugins hook into already carries the full seed list.
	// The layer owns the wallpaper DOM element the shell markup reserves
	// as the first child of `#wp-desktop-shell`.
	const wallpaperEl = document.getElementById( 'wp-desktop-wallpaper' );
	const pluginUrl = config.pluginUrl || '';
	let wallpaperLayer: WallpaperLayer | null = null;
	if ( wallpaperEl ) {
		wallpaperLayer = new WallpaperLayer( wallpaperEl, pluginUrl );
	}
	registerBuiltInWallpapers();

	// Widget layer + registry. Same pattern as wallpapers: register
	// built-ins synchronously so the `wp-desktop.widgets` filter
	// already carries them when plugins hook in, then hydrate the
	// layer which mounts whichever widgets the user last had on.
	const widgetsEl = document.getElementById( 'wp-desktop-widgets' );
	let widgetLayer: WidgetLayer | null = null;
	registerBuiltInWidgets();
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
		},
		wallpaperLayer ?? new WallpaperLayer( document.createElement( 'div' ), pluginUrl ),
	);
	osSettings.apply();

	// AI Assistant — mounts the spotlight overlay onto document.body and
	// wires the global Cmd+K shortcut. aiSearchUrl comes from PHP config;
	// falls back to an empty string when AI is not configured (the search
	// will return a 403 from the permission gate and show an error).
	const aiAssistant = new AiAssistant( {
		aiSearchUrl: config.aiSearchUrl ?? '',
		aiSearchStreamUrl: config.aiSearchStreamUrl ?? '',
		restNonce: config.restNonce,
	} );

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
					Promise.resolve(
						// eslint-disable-next-line no-alert
						typeof window.confirm === 'function' ? window.confirm( msg ) : true,
					),
			} ),
		} ),
	);

	// Cross-window drag bridge — stores the attachment payload the
	// Media Library iframe sends on dragstart so drop-receiver iframes
	// can request it back in their drop handler. Instantiated here
	// (after shell DOM exists) so any iframe loading afterward sees
	// a parent that's ready to receive messages.
	const dragBridge = new DragBridge();

	// Register the AI Assistant as the first (default) Cmd+K palette
	// and install the single global shortcut. Other plugins can register
	// more palettes via wp.desktop.registerPalette and Cmd+K cycles
	// through them in registration order.
	registerPalette( {
		id: 'wp-desktop-ai-assistant',
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

	// Admin-bar "Ask AI" button and programmatic `wp-desktop-open-ai`
	// dispatches now route through openPaletteOnly so any other plugin
	// palette that happens to be open is dismissed first — matches the
	// single-palette-at-a-time invariant the cycle maintains.
	document.addEventListener( 'wp-desktop-open-ai', () => {
		openPaletteOnly( 'wp-desktop-ai-assistant' );
	} );

	// Dock (left edge, CORE WP menus). `config.dockItems` was already
	// filtered server-side to core items — anything that routes via
	// `admin.php?page=*` is split into `config.taskbarItems` below.
	const dockEl = document.getElementById( 'wp-desktop-dock' );
	let dock: Dock | null = null;
	if ( dockEl && config.dockItems ) {
		dock = new Dock( dockEl, manager, config.dockItems, config.adminUrl, 'left' );
		desktopArea.classList.add( 'wp-desktop-area--with-dock' );

		// System tile at the bottom of the dock — last icon, after WP
		// Settings. Clicking opens the native OS Settings window; the
		// window manager focuses any existing instance instead of
		// stacking a second.
		dock.appendSystemItem( {
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
					( win.config.desktopId || manager.getActiveDesktopId() ) ===
					manager.getActiveDesktopId()
				);
			},
			onOpen: () => {
				manager.open( {
					id: OS_SETTINGS_WINDOW_ID,
					baseId: OS_SETTINGS_WINDOW_ID,
					url: '#os-settings',
					title: 'OS Settings',
					icon: 'dashicons-desktop',
					native: true,
					render: ( body ) => osSettings.renderPanel( body ),
					// Sized to comfortably fit three wallpaper swatches
					// across plus the media-library grid showing 5–6
					// thumbnails per row — smaller defaults forced the
					// sections into a single narrow column.
					width: 820,
					height: 720,
					minWidth: 560,
					minHeight: 480,
				} );
			},
		} );
	}

	// Taskbar (bottom edge, PLUGIN-contributed menus). Instantiated
	// with the same `Dock` class as the left rail — behavior is
	// identical (tooltips, active-window dots, multi-instance rail,
	// same icon fallbacks). Only orientation + CSS differ. The taskbar
	// DOM element is optional — older shell builds without it render
	// fine, the taskbar just no-ops.
	//
	// ALWAYS instantiate when the element exists, even if the item
	// list is empty. The live menu-refresh path (plugin activation
	// inside a windowed plugins.php) needs an existing Dock instance
	// to call `replaceItems()` on — creating one lazily on first
	// refresh would mean the user's FIRST plugin activation wouldn't
	// re-render. Hidden via `[hidden]` when empty so it doesn't show
	// an empty glass pill floating over the wallpaper.
	const taskbarEl = document.getElementById( 'wp-desktop-taskbar' );
	let taskbar: Dock | null = null;
	if ( taskbarEl ) {
		const initialTaskbarItems = Array.isArray( config.taskbarItems )
			? config.taskbarItems
			: [];
		taskbar = new Dock(
			taskbarEl,
			manager,
			initialTaskbarItems,
			config.adminUrl,
			'bottom',
		);
		taskbarEl.hidden = initialTaskbarItems.length === 0;
		if ( initialTaskbarItems.length > 0 ) {
			desktopArea.classList.add( 'wp-desktop-area--with-taskbar' );
		}
	}

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
		restoreSession( manager, config, desktopArea );
	}
	const defaultEnabled = config.defaultWindow?.enabled !== false;
	const suppressAutoOpen =
		config.fromPortal && ( hasSession || ! defaultEnabled );
	if ( ! suppressAutoOpen ) {
		openCurrentPage( manager, config );
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
			const response = await fetch( config.defaultWindowUrl, {
				method: 'POST',
				credentials: 'same-origin',
				headers: {
					'Content-Type': 'application/json',
					'X-WP-Nonce': config.restNonce,
				},
				body: JSON.stringify( { url } ),
			} );
			if ( ! response.ok ) {
				throw new Error( `HTTP ${ response.status }` );
			}
			const data = ( await response.json() ) as {
				enabled: boolean;
				url: string;
			};
			config.defaultWindow = data;
			document.dispatchEvent(
				new CustomEvent( 'wp-desktop-default-window-changed', {
					detail: data,
				} ),
			);
		} catch ( err ) {
			doAction( HOOKS.SHELL_ERROR, { scope: 'default-window-save', error: err } );
			if ( typeof console !== 'undefined' ) {
				console.error(
					'[wp-desktop-mode] Failed to save default window:',
					err,
				);
			}
		}
	};

	// Manager → public API wiring. When a user clicks "Open on startup"
	// in a window's ⋯ menu, the manager calls this callback with the
	// window. We either set this window's URL as the default, or — if
	// it's already the default — disable it.
	manager.onToggleStartupRequested = ( win ) => {
		const currentPref = config.defaultWindow;
		const winUrl = win.getCurrentUrl();
		const alreadyDefault =
			!! currentPref?.enabled &&
			urlMatchKey( currentPref.url ) === urlMatchKey( winUrl );
		void setDefaultWindow( alreadyDefault ? null : winUrl );
	};

	/**
	 * Place a system tile on the requested rail. Extracted so
	 * `registerSystemTile` can do its single taskbar-unhide + hook
	 * fire uniformly regardless of the placement branch it takes.
	 * Returns the resolved placement — it may differ from the
	 * requested value when the taskbar element is missing.
	 */
	const placeSystemTile = (
		item: SystemDockItem,
		placement: 'dock' | 'taskbar',
	): 'dock' | 'taskbar' => {
		if ( placement === 'dock' ) {
			dock?.appendSystemItem( item );
			return 'dock';
		}
		if ( ! taskbar ) {
			dock?.appendSystemItem( item );
			return 'dock';
		}
		taskbar.appendSystemItem( item );
		if ( taskbarEl && taskbarEl.hidden ) {
			taskbarEl.hidden = false;
			desktopArea.classList.add( 'wp-desktop-area--with-taskbar' );
		}
		return 'taskbar';
	};

	// Native-window sync — the server-declared list from
	// `wp_register_desktop_window()` drives system-tile lifecycle
	// for plugin-owned native windows. At boot we prime tiles from
	// `config.nativeWindows`; the live-refresh path calls the same
	// syncer with the fresh payload so activation / deactivation
	// maps to tile add / remove without any shell reload.
	const syncNativeWindows = createNativeWindowSync( {
		manager,
		dock,
		taskbar,
		taskbarEl,
		desktopArea,
	} );
	void syncNativeWindows(
		Array.isArray( config.nativeWindows ) ? config.nativeWindows : [],
	);

	// Widget-registry sync — same story for the right-column widget
	// layer. Plugins declare widgets via `wp_register_desktop_widget()`;
	// the shell adds / removes defs from its registry as plugins
	// activate / deactivate mid-session, dynamically loading the
	// plugin's script so the mount callback lands on
	// `window.wpDesktopWidgets[ id ]` before we build the WidgetDef.
	const syncServerWidgets = createWidgetRegistrySync( {
		layer: widgetLayer,
	} );
	void syncServerWidgets(
		Array.isArray( config.serverWidgets ) ? config.serverWidgets : [],
	);

	// Wallpaper-registry sync — third instance of the same pattern,
	// same reasoning. Plugins declare wallpapers via
	// `wp_register_desktop_wallpaper()`; the shell loads the
	// plugin's JS, reads the full `WallpaperDef` off
	// `window.wpDesktopWallpapers[ id ]`, and adds / removes it
	// from the registry as activation / deactivation plays out.
	const syncServerWallpapers = createWallpaperRegistrySync( {
		osSettings,
	} );
	void syncServerWallpapers(
		Array.isArray( config.serverWallpapers ) ? config.serverWallpapers : [],
	);

	// Command-palette sync — mirrors the widget / wallpaper pattern for
	// slash-commands registered by plugins via
	// `wp_desktop_register_command_script()`. Loads each opted-in
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
	// `wp_desktop_register_settings_tab_script()`. Injects each
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

	// Cross-window connection bridge — parent side. Builds the
	// `connect()` factory + the iframe-message router. The router
	// is wired into `iframe-bridge.ts` below via a side-channel
	// global so individual Window instances don't need to know
	// about the bridge.
	const connectionBridge = createConnectionBridge( manager );
	(
		window as unknown as {
			__wpDesktopConnectionBridge?: ReturnType< typeof createConnectionBridge >;
		}
	).__wpDesktopConnectionBridge = connectionBridge;
	// Tear down connections when their target window closes.
	addAction( HOOKS.WINDOW_CLOSED, 'wp-desktop-mode/connection-cleanup', ( e: { windowId?: string } ) => {
		if ( e?.windowId ) {
			connectionBridge.onWindowClosed( e.windowId );
		}
	} );
	// Re-arm pending handshakes once an iframe finishes loading.
	addAction( HOOKS.IFRAME_READY, 'wp-desktop-mode/connection-rearm', ( e: { windowId?: string } ) => {
		if ( e?.windowId ) {
			connectionBridge.onIframeReady( e.windowId );
		}
	} );

	// Hoisted so the desktop-icons render code below and the
	// `window.wp.desktop.registerWindow` public export both
	// reference the same function — no double-wrapping, no drift.
	const registerWindow = createRegisterWindow( manager );

	// Desktop icons — shortcut tiles on the wallpaper, registered
	// server-side via `wp_register_desktop_icon()`. Re-rendered on
	// every live menu refresh so a plugin activation adds / removes
	// tiles without a full shell reload.
	//
	// The `openWindow` callback reaches into the native-window
	// registry the shell keeps in sync with `config.nativeWindows`.
	// When the icon's target plugin has been deactivated since the
	// icon was registered, the registry lookup returns null and the
	// click becomes a no-op — the icon itself disappears on the
	// next refresh via `wp_desktop_icons` filtering.
	const openRegisteredNativeWindow = ( id: string ): boolean => {
		const def = Array.isArray( config.nativeWindows )
			? config.nativeWindows.find( ( w ) => w.id === id )
			: null;
		if ( ! def ) {
			return false;
		}
		registerWindow( {
			id: def.id,
			title: def.title,
			icon: def.icon,
			width: def.width,
			height: def.height,
			minWidth: def.minWidth,
			minHeight: def.minHeight,
			autofocus: def.autofocus,
			render: ( body: HTMLElement ) => {
				// Native windows registered from PHP publish their
				// render callback on `window.wpDesktopNativeWindows`.
				// If the plugin's script hasn't loaded yet (very
				// rare at this point — the shell enqueues all
				// native-window scripts as shell deps), fall through
				// to an empty body rather than throwing.
				const nativeRegistry = ( window as unknown as {
					wpDesktopNativeWindows?: Record<
						string,
						( ( el: HTMLElement ) => void ) | undefined
					>;
				} ).wpDesktopNativeWindows;
				const render = nativeRegistry?.[ def.id ];
				if ( render ) {
					render( body );
				}
			},
		} );
		return true;
	};
	if ( Array.isArray( config.desktopIcons ) && config.desktopIcons.length > 0 ) {
		renderDesktopIcons( desktopArea, config.desktopIcons, {
			openWindow: openRegisteredNativeWindow,
			manager,
		} );
	}

	// Live menu refresh — rebuild both rails when a plugin activation
	// or deactivation lands in any windowed `plugins.php`. Without
	// this the dock + taskbar reflect the server-side `$menu` at
	// shell boot only, so the user would have to hard-reload the
	// whole tab to see a newly-activated plugin's top-level menu
	// appear on the taskbar (or vanish on deactivation).
	//
	// Wired BEFORE the `window.wp.desktop` assignment so the returned
	// refresh function is available to expose in the public API in
	// the same statement.
	const refreshMenu = bindMenuRefresh(
		dock,
		taskbar,
		taskbarEl,
		desktopArea,
		config,
		syncNativeWindows,
		syncServerWidgets,
		syncServerWallpapers,
		syncServerCommands,
		syncServerSettingsTabs,
		syncServerTitleBarButtons,
	);

	// Expose the public API on `window.wp.desktop`. The `hooks` field
	// aliases `window.wp.hooks` so plugins have one idiomatic entry
	// point for both the window manager and the filter/action bus.
	window.wp = window.wp || {};
	window.wp.desktop = {
		windowManager: manager,
		dock,
		taskbar,
		saveSession,
		hooks: rawHooks(),
		HOOKS,
		isActive: () => !! document.getElementById( 'wp-desktop-shell' ),
		registerWallpaper: ( def: WallpaperDef ) => {
			registry.register( def );
			// Re-apply so a plugin that registers its own wallpaper and
			// sets the user's selection to it in the same breath sees an
			// immediate repaint rather than having to wait for the next
			// OS Settings open.
			osSettings.apply();
		},
		registerWidget: ( def ) => {
			widgetRegistry.register( def );
			// No re-paint needed here: the layer only mounts IDs the
			// user explicitly enabled, so adding a new def just makes
			// it available in the next picker open. Plugins wanting
			// to force a widget on can call
			// `wp.desktop.widgetLayer.add(id)` / `ensureMounted(id)` —
			// exposed below.
		},
		widgetLayer,
		loadVendorScript,
		getWallpaperSurfaces: () => collectWallpaperSurfaces( manager ),
		registerWindow,
		cloneTemplate,
		onWindow,
		registerSystemTile: ( item, placement = 'taskbar' ) => {
			const resolved = placeSystemTile( item, placement );
			doAction( HOOKS.DOCK_ITEM_APPENDED, { id: item.id, placement: resolved } );
			return resolved;
		},
		registerModule,
		loadModules,
		whenReady,
		ready: whenReady,
		isReady,
		setDefaultWindow,
		refreshMenu,
		config,
		ai: aiAssistant,
		dragBridge,
		registerCommand,
		unregisterCommand,
		listCommands,
		registerSettingsTab,
		unregisterSettingsTab,
		listSettingsTabs,
		registerTitleBarButton,
		unregisterTitleBarButton,
		listTitleBarButtons,
		connect: connectionBridge.connect,
		registerPalette,
		unregisterPalette,
		listPalettes,
		openPalette: openPaletteOnly,
	};

	// Fire `wp-desktop.init` — plugins can now register wallpapers
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
	// `wp-desktop.open-command.items` can rely on the command being
	// in the registry.
	registerBuiltInCommands();

	doAction( HOOKS.INIT, { config } );

	// Re-apply the wallpaper once init subscribers have had a chance
	// to register — if the user's saved selection belongs to a plugin
	// that just registered, this is when it becomes visible.
	osSettings.apply();

	// Hydrate widgets AFTER `wp-desktop.init` so plugin-registered
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
	// so plugin authors can subscribe from `wp-desktop.init`.
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
	desktopArea.addEventListener( 'click', ( e: MouseEvent ) => {
		if ( e.target !== desktopArea ) {
			return;
		}
		if ( desktopArea.classList.contains( 'wp-desktop-area--overview' ) ) {
			return;
		}
		const windows = manager.getAll();
		const allMinimized = windows.length > 0 && windows.every( ( w ) => w.state === 'minimized' );
		if ( allMinimized ) {
			for ( const win of windows ) {
				win.restore();
			}
		} else {
			for ( const win of windows ) {
				if ( win.state !== 'minimized' ) {
					win.minimize();
				}
			}
		}
	} );

	// The URL bar is intentionally NOT normalized to /wp-desktop/.
	// Prior versions did a `history.replaceState(..., config.portalUrl)`
	// here to unify the address bar around the portal URL — cosmetically
	// nicer, but every browser reload hit /wp-desktop/, which triggered
	// a portal HTTP redirect to the canonical admin URL, producing a
	// visible address-bar flash (`/wp-admin/index.php?wp_desktop_portal=1`
	// → `/wp-desktop/`) on every reload. Leaving the URL as the actual
	// admin URL eliminates the flash and makes reloads instant — the
	// user sees /wp-admin/... in the address bar in exchange, which is
	// also more transparent about where the shell is currently hosted.
	// `config.portalUrl` stays in the shell config so plugins that want
	// to build "home" links can still point at the portal.

	document.dispatchEvent(
		new CustomEvent( 'wp-desktop-init', {
			detail: { config, restored: hasSession },
		} ),
	);
}

/**
 * Restores windows from a saved session into the manager.
 *
 * Each window's geometry is clamped to fit the current desktop area
 * before construction — so a layout captured on an ultrawide display
 * lands sanely on a laptop. Stacking order follows the session order
 * (earliest-opened first, focused id brought to the top at the end).
 */
function restoreSession(
	manager: WindowManager,
	config: DesktopConfig,
	desktopArea: HTMLElement,
): void {
	const rect = desktopArea.getBoundingClientRect();

	// Seed desktops + active id BEFORE recreating windows. Windows
	// pass `desktopId` from the session through to their config; the
	// manager honours that exactly as long as the desktop already
	// exists in the registry, otherwise it falls back to the active
	// desktop. Establishing the registry first preserves the user's
	// per-desktop window grouping across reloads.
	if ( Array.isArray( config.session.desktops ) && config.session.desktops.length > 0 ) {
		manager.seedDesktops(
			config.session.desktops,
			config.session.activeDesktop || config.session.desktops[ 0 ].id,
		);
	}

	for ( const win of config.session.windows ) {
		const clamped = clampGeometryToViewport( win, rect );
		const dockEntry = findDockEntryForUrl( win.url, config );

		const opened = manager.open( {
			id: win.id,
			baseId: win.baseId || win.id,
			desktopId: win.desktopId,
			multi: !! dockEntry?.multi,
			url: win.url,
			title: win.title,
			icon: win.icon || 'dashicons-admin-generic',
			x: clamped.x,
			y: clamped.y,
			width: clamped.width,
			height: clamped.height,
			initialState: win.state,
			submenu: dockEntry?.submenu,
		} );

		// Rehydrate any external sub-tabs the user had open on this
		// window at save time. Each becomes a fresh closeable tab with
		// its own iframe, ordered left-to-right in the order they
		// were added originally.
		if ( Array.isArray( win.externalTabs ) ) {
			for ( const ext of win.externalTabs ) {
				if ( ext && typeof ext.url === 'string' && ext.url !== '' ) {
					opened.addExternalTab(
						ext.url,
						typeof ext.label === 'string' && ext.label !== ''
							? ext.label
							: ext.url,
					);
				}
			}
		}
	}

	// Restore focus to whichever window the user left focused. If that id
	// is no longer around (e.g., the saved focus pointed at a window we
	// failed to reconstruct), `getById` returns undefined and we leave
	// the default — topmost-of-stack — focus in place.
	if ( config.session.focused ) {
		const focused = manager.getById( config.session.focused );
		if ( focused ) {
			manager.focus( focused );
		}
	}
}

/**
 * Opens the current admin page in a fresh window — the "no saved session" path.
 */
function openCurrentPage( manager: WindowManager, config: DesktopConfig ): void {
	const windowId = deriveWindowId( config.currentPage, config.adminUrl );
	const dockEntry = findDockEntryForUrl( config.currentPage, config );

	manager.open( {
		id: windowId,
		baseId: windowId,
		multi: !! dockEntry?.multi,
		url: config.currentPage,
		title: config.currentTitle,
		icon: config.currentIcon,
		submenu: dockEntry?.submenu,
	} );
}

/**
 * Intercepts clicks on `/wp-admin/` anchors in the top window and opens
 * (or focuses) a matching shell window instead of letting the browser
 * navigate the whole tab.
 *
 * Runs in the capture phase so we beat any handler that calls
 * `stopPropagation` on the bubble phase — the admin bar's own JS, for
 * instance. Handlers that call `preventDefault()` before us (like the
 * desktop-mode toggle, which uses `href="#"`) are respected: we bail on
 * `defaultPrevented` and on anchor links.
 *
 * Iframe content is a separate document realm — clicks inside a window
 * don't bubble up to this listener, so the chromeless iframe's own link
 * rewriter still owns iframe-internal navigation.
 */
function bindTopWindowLinkInterceptor(
	manager: WindowManager,
	config: DesktopConfig,
): void {
	document.addEventListener(
		'click',
		( e: MouseEvent ) => {
			if ( e.defaultPrevented ) {
				return;
			}
			if ( e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey ) {
				return;
			}
			const target = e.target as Element | null;
			const link = target && target.closest ? target.closest( 'a[href]' ) : null;
			if ( ! link ) {
				return;
			}
			const anchor = link as HTMLAnchorElement;
			const linkTarget = anchor.getAttribute( 'target' );
			if ( linkTarget && linkTarget !== '' && linkTarget !== '_self' ) {
				return;
			}
			if ( anchor.hasAttribute( 'download' ) ) {
				return;
			}

			const rawHref = anchor.getAttribute( 'href' );
			if ( ! rawHref || rawHref.charAt( 0 ) === '#' ) {
				return;
			}
			if ( /^(mailto:|tel:|javascript:|data:)/i.test( rawHref ) ) {
				return;
			}

			let url: URL;
			try {
				url = new URL( rawHref, window.location.href );
			} catch ( err ) {
				// Malformed href — rare in practice (the browser's own
				// parser is quite lenient) but if a plugin is generating
				// broken URLs the only signal today would be "the link
				// doesn't get intercepted and leaves the shell." Log so
				// the author can trace it.
				if ( typeof console !== 'undefined' ) {
					console.warn(
						'[wp-desktop-mode] Couldn’t parse href; letting the browser handle the click:',
						rawHref,
						err,
					);
				}
				return;
			}

			if ( url.origin !== INITIAL_ORIGIN ) {
				return;
			}
			let adminPath: string;
			try {
				adminPath = new URL( config.adminUrl ).pathname;
			} catch ( err ) {
				// Shell boot should have rejected a bad adminUrl, so
				// reaching this branch means something mutated config
				// after boot. Log + fall back rather than break every
				// link click on the page.
				if ( typeof console !== 'undefined' ) {
					console.error(
						'[wp-desktop-mode] config.adminUrl is not a valid URL; falling back to /wp-admin/:',
						config.adminUrl,
						err,
					);
				}
				adminPath = '/wp-admin/';
			}
			if ( ! url.pathname.startsWith( adminPath ) ) {
				return;
			}

			// admin-post.php and admin-ajax.php are endpoints, not pages.
			// Logout and similar auth routes carry their own redirects and
			// must be allowed to navigate the tab normally.
			if ( /\/(admin-post|admin-ajax)\.php$/.test( url.pathname ) ) {
				return;
			}
			if ( url.searchParams.has( 'action' ) && url.searchParams.get( 'action' ) === 'logout' ) {
				return;
			}
			// The Detach-to-classic action explicitly wants a real tab with
			// classic chrome — don't steal it back into the shell.
			if ( url.searchParams.has( 'wp_desktop_classic' ) ) {
				return;
			}

			e.preventDefault();
			e.stopPropagation();

			const windowId = deriveWindowId( url.href, config.adminUrl );
			const dockEntry = findDockEntryForUrl( url.href, config );
			const fallbackTitle = ( anchor.textContent || '' ).trim() || dockEntry?.title || '';

			manager.open( {
				id: windowId,
				baseId: windowId,
				multi: !! dockEntry?.multi,
				url: url.href,
				title: dockEntry?.title || fallbackTitle,
				icon: dockEntry?.icon || 'dashicons-admin-generic',
				submenu: dockEntry?.submenu,
			} );
		},
		true,
	);
}

/**
 * Finds the dock entry whose URL — or whose submenu's URL — resolves to
 * the same window ID as the given URL.
 *
 * Used on session restore and fresh-page auto-open so a window that
 * lands on a sub-page (e.g. Categories) still gets the parent menu's
 * submenu tabs rendered — and so the parent's `multi` flag threads
 * through to the window chrome.
 */
function findDockEntryForUrl(
	url: string,
	config: DesktopConfig,
): DesktopConfig[ 'dockItems' ][ number ] | undefined {
	const windowId = deriveWindowId( url, config.adminUrl );
	return ( config.dockItems || [] ).find(
		( i ) =>
			deriveWindowId( i.url, config.adminUrl ) === windowId ||
			( i.submenu || [] ).some(
				( s ) => deriveWindowId( s.url, config.adminUrl ) === windowId,
			),
	);
}

/**
 * Clamp a persisted window's geometry to fit inside the current desktop
 * area, preserving the window's aspect ratio when the saved size exceeds
 * the area. Handles the ultrawide-to-laptop transition gracefully:
 *
 *   - A window that sat at x=2800 on a 3440px desktop gets pulled back
 *     onto the smaller viewport.
 *   - A window bigger than the viewport is scaled down, not cropped.
 *   - Negative positions (shouldn't happen but defend anyway) become 0.
 *
 * Returns a plain geometry object — caller applies it to the WindowConfig.
 */
function clampGeometryToViewport(
	win: SessionWindow,
	rect: DOMRect,
): { x: number; y: number; width: number; height: number } {
	const maxW = Math.max( 200, rect.width - VIEWPORT_CLAMP_MARGIN * 2 );
	const maxH = Math.max( 200, rect.height - VIEWPORT_CLAMP_MARGIN * 2 );

	const width = Math.min( win.width, maxW );
	const height = Math.min( win.height, maxH );

	const maxX = Math.max( 0, rect.width - width - VIEWPORT_CLAMP_MARGIN );
	const maxY = Math.max( 0, rect.height - height - VIEWPORT_CLAMP_MARGIN );

	const x = Math.max( VIEWPORT_CLAMP_MARGIN, Math.min( win.x, maxX ) );
	const y = Math.max( VIEWPORT_CLAMP_MARGIN, Math.min( win.y, maxY ) );

	return { x, y, width, height };
}

/**
 * Creates the debounced+immediate session saver. Returns a single
 * function that schedules a debounced REST write on each call. Also
 * exposed on `wp.desktop.saveSession()` for plugins that want to flush.
 */
function createSessionSaver( manager: WindowManager, config: DesktopConfig ): () => void {
	let debounceTimer: number | null = null;
	let inFlight = false;

	const doSave = async (): Promise<void> => {
		if ( inFlight ) {
			return;
		}
		const payload = manager.snapshot();
		inFlight = true;
		try {
			await fetch( config.sessionUrl, {
				method: 'POST',
				credentials: 'same-origin',
				headers: {
					'Content-Type': 'application/json',
					'X-WP-Nonce': config.restNonce,
				},
				body: JSON.stringify( { session: payload } ),
				// Best-effort: we don't block the UI on persistence.
				keepalive: true,
			} );
		} catch ( err ) {
			/* Network error is non-fatal — next change triggers another save.
			 * Still worth surfacing to monitor widgets so a connectivity
			 * regression doesn't go silent under the session-beacon path. */
			doAction( HOOKS.SHELL_ERROR, { scope: 'session-save', error: err } );
		} finally {
			inFlight = false;
		}
	};

	const flushImmediately = (): void => {
		if ( debounceTimer !== null ) {
			clearTimeout( debounceTimer );
			debounceTimer = null;
		}
		// Use sendBeacon for unload-time saves where fetch may not
		// complete. WP REST's cookie-auth middleware reads the nonce
		// from `$_REQUEST` (URL query string + form-encoded body),
		// NOT from JSON bodies — so to satisfy auth we append the
		// nonce to the URL as a query param. Without this, the
		// beacon arrives but WP returns 403 before our handler runs,
		// and the session on disk stays at its pre-close state.
		// Symptom: close a window, reload fast, window reappears.
		const payload = manager.snapshot();
		const body = new Blob(
			[ JSON.stringify( { session: payload } ) ],
			{ type: 'application/json' },
		);
		const beaconUrl =
			config.sessionUrl +
			( config.sessionUrl.includes( '?' ) ? '&' : '?' ) +
			'_wpnonce=' +
			encodeURIComponent( config.restNonce );
		if ( navigator.sendBeacon && navigator.sendBeacon( beaconUrl, body ) ) {
			return;
		}
		void doSave();
	};

	const schedule = (): void => {
		if ( debounceTimer !== null ) {
			clearTimeout( debounceTimer );
		}
		debounceTimer = window.setTimeout( () => {
			debounceTimer = null;
			void doSave();
		}, SESSION_SAVE_DEBOUNCE_MS ) as unknown as number;
	};

	// pagehide is the reliable unload signal across browsers (mobile Safari
	// in particular never fires beforeunload in the BFCache case).
	window.addEventListener( 'pagehide', flushImmediately );
	// Hidden tabs might never fire pagehide if the user switches away and
	// kills the browser — save opportunistically on visibility change too.
	document.addEventListener( 'visibilitychange', () => {
		if ( document.visibilityState === 'hidden' ) {
			flushImmediately();
		}
	} );

	return schedule;
}

/**
 * Wire the session saver to every window lifecycle event that should
 * end up persisted. Close/focus come from the manager; moved/resized/
 * state come from individual windows via `wp-desktop-window-changed`.
 */
function wireSessionEvents( save: () => void ): void {
	document.addEventListener( 'wp-desktop-window-opened', save );
	document.addEventListener( 'wp-desktop-window-closed', save );
	document.addEventListener( 'wp-desktop-window-focused', save );
	document.addEventListener( 'wp-desktop-window-changed', save );
}

/** Debounce window for the shell-resized action. Trailing-edge only. */
const SHELL_RESIZE_DEBOUNCE_MS = 120;

/**
 * Wire browser-resize and document-visibility into `wp-desktop.shell.*`
 * actions. Resize is debounced so a drag-to-resize storm collapses to a
 * single hook fire; visibility is edge-triggered (fires exactly once per
 * state change).
 */
function bindShellLifecycle(): void {
	const shellEl = document.getElementById( 'wp-desktop-shell' );

	let resizeTimer: number | null = null;
	const fireShellResize = (): void => {
		resizeTimer = null;
		const rect = shellEl ? shellEl.getBoundingClientRect() : null;
		doAction( HOOKS.SHELL_RESIZED, {
			width: rect ? Math.round( rect.width ) : window.innerWidth,
			height: rect ? Math.round( rect.height ) : window.innerHeight,
		} );
	};
	window.addEventListener( 'resize', () => {
		if ( resizeTimer !== null ) {
			window.clearTimeout( resizeTimer );
		}
		resizeTimer = window.setTimeout( fireShellResize, SHELL_RESIZE_DEBOUNCE_MS ) as unknown as number;
	} );

	document.addEventListener( 'visibilitychange', () => {
		doAction( HOOKS.SHELL_VISIBILITY, {
			state: document.hidden ? 'hidden' : 'visible',
		} );
	} );
}

/**
 * Debounce window for live menu refetches. Long enough to coalesce the
 * chromeless bridge's `plugins.php` signal with the iframe's navigation
 * settling, short enough to feel instant to the user.
 */
const MENU_REFRESH_DEBOUNCE_MS = 250;

/**
 * Wire the live menu-refresh pipeline.
 *
 * Listens for `wp-desktop-plugins-changed` postMessages from the
 * chromeless bridge (fired when an iframe lands on `plugins.php`), then
 * debounces + fetches `/wp-desktop/v1/menu` and calls `replaceItems()`
 * on whichever rails changed. Also exposes the fetch as a return value
 * so the public API can expose a manual `wp.desktop.refreshMenu()` for
 * plugins that mutate the menu server-side outside the plugins.php
 * flow (rare, but the escape hatch costs nothing).
 *
 * No-ops when `config.menuUrl` isn't present — older PHP builds that
 * predate the REST endpoint get the boot-time menu only.
 *
 * @param dock        Left-edge dock instance (may be null).
 * @param taskbar     Bottom-edge taskbar instance (may be null).
 * @param taskbarEl   Taskbar DOM element, used to flip `hidden` when
 *                    items go from empty → populated or vice versa.
 * @param desktopArea Desktop area element — wears the
 *                    `--with-taskbar` modifier when items are present.
 * @param config      Boot config; `taskbarItems` / `dockItems` are
 *                    mutated in place after each successful refresh so
 *                    plugins that read `wp.desktop.config` after a
 *                    refresh see fresh values.
 * @return An async function plugins can call to force a refresh.
 */
function bindMenuRefresh(
	dock: Dock | null,
	taskbar: Dock | null,
	taskbarEl: HTMLElement | null,
	desktopArea: HTMLElement,
	config: DesktopConfig,
	syncNativeWindows: (
		list: import( './types' ).NativeWindowServerEntry[],
	) => Promise< void >,
	syncServerWidgets: (
		list: import( './types' ).DesktopWidgetServerEntry[],
	) => Promise< void >,
	syncServerWallpapers: (
		list: import( './types' ).DesktopWallpaperServerEntry[],
	) => Promise< void >,
	syncServerCommands: (
		scripts: import( './types' ).DesktopCommandScriptServerEntry[],
		commands?: import( './types' ).DesktopCommandServerEntry[],
	) => Promise< void >,
	syncServerSettingsTabs: (
		scripts: import( './types' ).DesktopSettingsTabScriptServerEntry[],
		tabs?: import( './types' ).DesktopSettingsTabServerEntry[],
	) => Promise< void >,
	syncServerTitleBarButtons: (
		scripts: import( './types' ).DesktopTitleBarButtonScriptServerEntry[],
	) => Promise< void >,
): () => Promise<void> {
	// Shared applier — takes a freshly-split payload and rebuilds
	// both rails. Extracted so the message-with-payload path (no
	// REST) and the manual-refresh path (REST) share behaviour.
	const applyPayload = ( payload: {
		dockItems?: unknown;
		taskbarItems?: unknown;
		nativeWindows?: unknown;
		serverWidgets?: unknown;
		serverWallpapers?: unknown;
		serverCommandScripts?: unknown;
		serverCommands?: unknown;
		serverSettingsTabScripts?: unknown;
		serverSettingsTabs?: unknown;
	} ): void => {
		const dockItems = payload.dockItems;
		const taskbarItems = payload.taskbarItems;
		const nativeWindows = payload.nativeWindows;
		const serverWidgets = payload.serverWidgets;
		const serverWallpapers = payload.serverWallpapers;
		const serverCommandScripts = payload.serverCommandScripts;
		const serverCommands = payload.serverCommands;
		const serverSettingsTabScripts = payload.serverSettingsTabScripts;
		const serverSettingsTabs = payload.serverSettingsTabs;

		// Guard: an empty `dockItems` list is NEVER legitimate —
		// WordPress Core always ships Dashboard, which lands on the
		// dock by default. An empty response means the server side
		// failed to build the menu (e.g. the `$menu` global wasn't
		// populated in REST context and our bootstrap didn't kick
		// in). Skip the swap entirely rather than wipe the user's
		// sidebar.
		if ( ! Array.isArray( dockItems ) || dockItems.length === 0 ) {
			return;
		}
		if ( dock ) {
			dock.replaceItems( dockItems as DesktopConfig[ 'dockItems' ] );
			config.dockItems = dockItems as DesktopConfig[ 'dockItems' ];
		}

		// Taskbar CAN legitimately be empty (user has no plugins
		// with top-level menus yet). Only touched when the payload
		// also carries a taskbarItems array — missing field means
		// "no data", not "clear it."
		if ( Array.isArray( taskbarItems ) ) {
			taskbar?.replaceItems(
				taskbarItems as DesktopConfig[ 'taskbarItems' ],
			);
			config.taskbarItems = taskbarItems as DesktopConfig[ 'taskbarItems' ];

			// Visibility check spans BOTH menu-derived tiles AND
			// JS-registered system tiles (like the Calculator's
			// native-window launcher). Counting only `taskbarItems`
			// would incorrectly hide the whole rail whenever the
			// LAST menu-plugin deactivates — even if a native
			// window is still sitting on the rail. Asking the dock
			// itself via `hasItems()` keeps both kinds of tile in
			// the "is this rail alive?" equation.
			const hasAnyTaskbarTile = taskbar?.hasItems() ?? false;
			if ( taskbarEl ) {
				taskbarEl.hidden = ! hasAnyTaskbarTile;
			}
			desktopArea.classList.toggle(
				'wp-desktop-area--with-taskbar',
				hasAnyTaskbarTile,
			);
		}

		// Native-window sync — server registry is the source of
		// truth for plugin-owned native windows. Tiles added
		// server-side (plugin activated via `wp_register_desktop_window`)
		// appear; tiles whose plugin deactivated disappear. All
		// without a shell reload.
		if ( Array.isArray( nativeWindows ) ) {
			void syncNativeWindows(
				nativeWindows as import( './types' ).NativeWindowServerEntry[],
			);
			config.nativeWindows =
				nativeWindows as DesktopConfig[ 'nativeWindows' ];
		}

		// Widget-registry sync — same lifecycle story for the
		// right-column widget layer. Plugins declared via
		// `wp_register_desktop_widget()` show up in the picker
		// without a reload; deactivated plugin widgets disappear.
		if ( Array.isArray( serverWidgets ) ) {
			void syncServerWidgets(
				serverWidgets as import( './types' ).DesktopWidgetServerEntry[],
			);
			config.serverWidgets =
				serverWidgets as DesktopConfig[ 'serverWidgets' ];
		}

		// Wallpaper-registry sync — same lifecycle, now for the
		// OS Settings wallpaper picker. New plugin wallpapers
		// surface without a reload; deactivated ones disappear and
		// the active selection falls back to a built-in if it was
		// the one leaving.
		if ( Array.isArray( serverWallpapers ) ) {
			void syncServerWallpapers(
				serverWallpapers as import( './types' ).DesktopWallpaperServerEntry[],
			);
			config.serverWallpapers =
				serverWallpapers as DesktopConfig[ 'serverWallpapers' ];
		}

		// Command-palette sync — loads plugin-contributed command scripts
		// on activation and unregisters owner-tagged commands when a
		// handle leaves the payload. `serverCommandScripts` may be
		// absent on older menu REST responses that haven't been redeployed
		// yet; treat missing as "no change."
		if ( Array.isArray( serverCommandScripts ) ) {
			void syncServerCommands(
				serverCommandScripts as import( './types' ).DesktopCommandScriptServerEntry[],
				Array.isArray( serverCommands )
					? ( serverCommands as import( './types' ).DesktopCommandServerEntry[] )
					: undefined,
			);
			config.serverCommandScripts =
				serverCommandScripts as DesktopConfig[ 'serverCommandScripts' ];
			if ( Array.isArray( serverCommands ) ) {
				config.serverCommands =
					serverCommands as DesktopConfig[ 'serverCommands' ];
			}
		}

		// Settings-tab sync — mirror of the commands block. Loads
		// plugin-contributed settings-tab scripts on activation and
		// unregisters tabs attributable to a handle that just left
		// the payload.
		if ( Array.isArray( serverSettingsTabScripts ) ) {
			void syncServerSettingsTabs(
				serverSettingsTabScripts as import( './types' ).DesktopSettingsTabScriptServerEntry[],
				Array.isArray( serverSettingsTabs )
					? ( serverSettingsTabs as import( './types' ).DesktopSettingsTabServerEntry[] )
					: undefined,
			);
			config.serverSettingsTabScripts =
				serverSettingsTabScripts as DesktopConfig[ 'serverSettingsTabScripts' ];
			if ( Array.isArray( serverSettingsTabs ) ) {
				config.serverSettingsTabs =
					serverSettingsTabs as DesktopConfig[ 'serverSettingsTabs' ];
			}
		}

		// Title-bar-button sync — same shape as the commands block.
		const serverTitleBarButtonScripts = (
			payload as { serverTitleBarButtonScripts?: unknown }
		).serverTitleBarButtonScripts;
		if ( Array.isArray( serverTitleBarButtonScripts ) ) {
			void syncServerTitleBarButtons(
				serverTitleBarButtonScripts as import( './types' ).DesktopTitleBarButtonScriptServerEntry[],
			);
			config.serverTitleBarButtonScripts =
				serverTitleBarButtonScripts as DesktopConfig[ 'serverTitleBarButtonScripts' ];
		}
	};

	const refresh = async (): Promise<void> => {
		if ( ! config.menuUrl ) {
			return;
		}
		try {
			const res = await fetch( config.menuUrl, {
				method: 'GET',
				credentials: 'same-origin',
				headers: { 'X-WP-Nonce': config.restNonce },
			} );
			if ( ! res.ok ) {
				return;
			}
			const data = ( await res.json() ) as {
				dockItems?: DesktopConfig[ 'dockItems' ];
				taskbarItems?: DesktopConfig[ 'taskbarItems' ];
				nativeWindows?: DesktopConfig[ 'nativeWindows' ];
				serverWidgets?: DesktopConfig[ 'serverWidgets' ];
				serverWallpapers?: DesktopConfig[ 'serverWallpapers' ];
				serverCommandScripts?: DesktopConfig[ 'serverCommandScripts' ];
				serverCommands?: DesktopConfig[ 'serverCommands' ];
				serverSettingsTabScripts?: DesktopConfig[ 'serverSettingsTabScripts' ];
				serverSettingsTabs?: DesktopConfig[ 'serverSettingsTabs' ];
			};
			applyPayload( data );
		} catch ( err ) {
			/* Network / parse errors — skip this refresh. The next
			 * signal will retry, and a stale menu degrades gracefully:
			 * existing tiles still work, just don't reflect the latest
			 * activation. Monitors may still want to see this, so fire
			 * a SHELL_ERROR — log to console skipped to keep the DevTools
			 * surface quiet for the no-op case. */
			doAction( HOOKS.SHELL_ERROR, { scope: 'menu-refresh', error: err } );
		}
	};

	let debounceTimer: number | null = null;
	window.addEventListener( 'message', ( e: MessageEvent ) => {
		if ( e.origin !== INITIAL_ORIGIN ) {
			return;
		}
		const data = e.data as {
			type?: string;
			payload?: {
				dockItems?: unknown;
				taskbarItems?: unknown;
				nativeWindows?: unknown;
				serverWidgets?: unknown;
				serverWallpapers?: unknown;
				serverCommandScripts?: unknown;
				serverCommands?: unknown;
				serverSettingsTabScripts?: unknown;
				serverSettingsTabs?: unknown;
			};
		} | null;
		if ( ! data || data.type !== 'wp-desktop-plugins-changed' ) {
			return;
		}

		// FAST PATH: the chromeless bridge embedded a fresh menu
		// payload captured from the iframe's real admin context —
		// plugins that gate `admin_menu` on `is_admin()` at load
		// time registered normally there. Apply it directly; no
		// REST roundtrip. This is the primary refresh path after
		// plugin activation / deactivation.
		if ( data.payload ) {
			applyPayload( data.payload );
			return;
		}

		// SLOW PATH: message arrived without a payload (manual
		// trigger, older bridge, test). Fall back to the REST
		// endpoint. Not reliable for plugin-menu discovery — many
		// plugins gate `is_admin()` at load time and never
		// register in REST context — but safe for core menus.
		if ( ! config.menuUrl ) {
			return;
		}
		if ( debounceTimer !== null ) {
			window.clearTimeout( debounceTimer );
		}
		debounceTimer = window.setTimeout( () => {
			debounceTimer = null;
			void refresh();
		}, MENU_REFRESH_DEBOUNCE_MS ) as unknown as number;
	} );

	return refresh;
}

// Initialize when DOM is ready.
if ( document.readyState === 'loading' ) {
	document.addEventListener( 'DOMContentLoaded', init );
} else {
	init();
}

// Re-export so the bundle can be tested without tight coupling.
export { clampGeometryToViewport };
