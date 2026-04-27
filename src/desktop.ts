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
import { createApplyPayload } from './menu-refresh-apply';
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
	registerWindow: ( def: NativeWindowDef ) => DesktopWindow;
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
	openWindow: ( id: string ) => boolean;
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
	 * window tops, shell floor, dock edge, widget
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

	// Dock — one unified rail that hosts every admin menu (core and
	// plugin alike). Placement (left / right / bottom) is the user's
	// OS-Settings preference; the shell root's
	// `data-wp-desktop-dock-placement` attribute is the single source
	// of truth CSS reads, and `osSettings.apply()` writes it on boot
	// before the first paint. The `Dock` class itself just needs to
	// know its orientation to anchor tooltips correctly.
	const dockEl = document.getElementById( 'wp-desktop-dock' );
	let dock: Dock | null = null;
	if ( dockEl && config.dockItems ) {
		const dockPlacement = osSettings.getOsSettingsSnapshot().dockPlacement;
		dock = new Dock(
			dockEl,
			manager,
			config.dockItems,
			config.adminUrl,
			dockPlacement,
		);
		desktopArea.classList.add( 'wp-desktop-area--with-dock' );

		// OS Settings tile — appended to the unified dock so it's
		// reachable from whichever edge the user pins the rail to.
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
					width: 820,
					height: 720,
					minWidth: 560,
					minHeight: 480,
				} );
			},
		} );
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
	 * Place a system tile on the unified dock rail. Plugin-registered
	 * launchers that aren't part of the admin menu (native-window
	 * tools, quick-notes panels) land here.
	 */
	const placeSystemTile = ( item: SystemDockItem ): void => {
		dock?.appendSystemItem( item );
	};

	// Native-window sync — the server-declared list from
	// `desktop_mode_register_window()` drives system-tile lifecycle
	// for plugin-owned native windows. At boot we prime tiles from
	// `config.nativeWindows`; the live-refresh path calls the same
	// syncer with the fresh payload so activation / deactivation
	// maps to tile add / remove without any shell reload.
	const nativeWindows = createNativeWindowSync( {
		manager,
		dock,
		desktopArea,
	} );
	const syncNativeWindows = nativeWindows.sync;
	void syncNativeWindows(
		Array.isArray( config.nativeWindows ) ? config.nativeWindows : [],
	);

	// Widget-registry sync — same story for the right-column widget
	// layer. Plugins declare widgets via `desktop_mode_register_widget()`;
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
	// `desktop_mode_register_wallpaper()`; the shell loads the
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
	const renderIcons = (
		icons: import( './types' ).DesktopIconServerEntry[] | undefined,
	): void => {
		renderDesktopIcons( desktopArea, icons, {
			openWindow: nativeWindows.openById,
			manager,
		} );
	};
	if ( Array.isArray( config.desktopIcons ) && config.desktopIcons.length > 0 ) {
		renderIcons( config.desktopIcons );
	}

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
	const refreshMenu = bindMenuRefresh(
		dock,
		desktopArea,
		config,
		syncNativeWindows,
		syncServerWidgets,
		syncServerWallpapers,
		syncServerCommands,
		syncServerSettingsTabs,
		syncServerTitleBarButtons,
		renderIcons,
	);

	// Live dock-placement + orientation sync: when the user changes
	// the dock placement in OS Settings, apply() has already written
	// the shell attribute that CSS keys off; the `Dock` instance
	// needs the same signal so its tooltip anchor stays correct.
	osSettings.subscribeOsSettings( ( snapshot ) => {
		dock?.setOrientation( snapshot.dockPlacement );
	} );

	// Expose the public API on `window.wp.desktop`. The `hooks` field
	// aliases `window.wp.hooks` so plugins have one idiomatic entry
	// point for both the window manager and the filter/action bus.
	window.wp = window.wp || {};
	window.wp.desktop = {
		windowManager: manager,
		dock,
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
		openWindow: nativeWindows.openById,
		cloneTemplate,
		onWindow,
		registerSystemTile: ( item ) => {
			placeSystemTile( item );
			doAction( HOOKS.DOCK_ITEM_APPENDED, { id: item.id } );
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
	// visible address-bar flash (`/wp-admin/index.php?desktop_mode_portal=1`
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
			if ( url.searchParams.has( 'desktop_mode_classic' ) ) {
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
 * on the unified dock. Also exposes the fetch as a return value so the
 * public API can expose a manual `wp.desktop.refreshMenu()` for plugins
 * that mutate the menu server-side outside the plugins.php flow.
 *
 * No-ops when `config.menuUrl` isn't present.
 *
 * @param dock        Unified dock instance.
 * @param desktopArea Desktop area element — wears live-refresh
 *                    classes the applier may toggle.
 * @param config      Boot config; `dockItems` is mutated in place
 *                    after each successful refresh.
 * @return An async function plugins can call to force a refresh.
 */
function bindMenuRefresh(
	dock: Dock | null,
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
	renderIcons: (
		icons: import( './types' ).DesktopIconServerEntry[] | undefined,
	) => void,
): () => Promise<void> {
	// the dock. Extracted into its own module so the message-with-
	// payload path (no REST) and the manual-refresh path (REST) share
	// behaviour AND the contract is unit-testable in isolation.
	const applyPayload = createApplyPayload( {
		dock,
		desktopArea,
		config,
		syncNativeWindows,
		syncServerWidgets,
		syncServerWallpapers,
		syncServerCommands,
		syncServerSettingsTabs,
		syncServerTitleBarButtons,
		renderIcons,
	} );

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
				nativeWindows?: DesktopConfig[ 'nativeWindows' ];
				serverWidgets?: DesktopConfig[ 'serverWidgets' ];
				serverWallpapers?: DesktopConfig[ 'serverWallpapers' ];
				serverCommandScripts?: DesktopConfig[ 'serverCommandScripts' ];
				serverCommands?: DesktopConfig[ 'serverCommands' ];
				serverSettingsTabScripts?: DesktopConfig[ 'serverSettingsTabScripts' ];
				serverSettingsTabs?: DesktopConfig[ 'serverSettingsTabs' ];
				serverTitleBarButtonScripts?: DesktopConfig[ 'serverTitleBarButtonScripts' ];
				desktopIcons?: DesktopConfig[ 'desktopIcons' ];
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
				nativeWindows?: unknown;
				serverWidgets?: unknown;
				serverWallpapers?: unknown;
				serverCommandScripts?: unknown;
				serverCommands?: unknown;
				serverSettingsTabScripts?: unknown;
				serverSettingsTabs?: unknown;
				serverTitleBarButtonScripts?: unknown;
				desktopIcons?: unknown;
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
