/**
 * Desktop Mode type definitions.
 *
 * @since 6.9.0
 */

/**
 * Window state enum.
 */
export type WindowState = 'normal' | 'maximized' | 'minimized' | 'fullscreen' | 'snapped-left' | 'snapped-right';

/**
 * A virtual desktop ("Space" in macOS terminology).
 *
 * Each desktop owns its own set of windows. Only one desktop is
 * "active" at a time; the active desktop's windows are visible, every
 * other desktop's windows stay mounted but display-suppressed so
 * switching is instant and doesn't lose iframe state.
 *
 * @public
 */
export interface Desktop {
	/** Unique identifier — `default-1`, `desktop-2`, … */
	id: string;
	/** Human-readable label, shown beneath the overview top-bar tile. */
	label: string;
}

/**
 * Configuration for a desktop window.
 */
export interface WindowConfig {
	/** Unique window identifier, derived from the admin page slug. */
	id: string;
	/**
	 * Virtual-desktop assignment. When omitted on construction, the
	 * window joins the manager's currently active desktop. Mutated by
	 * the manager's switch / close logic when desktops are reorganised.
	 */
	desktopId?: string;
	/**
	 * Grouping key shared across every instance of the same admin page.
	 * For the first instance `baseId` equals `id`; additional instances
	 * carry suffixed ids (`${baseId}-2`, `${baseId}-3`, ...) while keeping
	 * the same baseId so the dock can group them.
	 */
	baseId?: string;
	/**
	 * Whether this page supports multiple simultaneous windows. When true,
	 * the title-bar menu exposes an "Open another" action and the dock
	 * icon gets a secondary "+" tap target. Singletons (false/undefined)
	 * always reuse the existing window.
	 */
	multi?: boolean;
	/**
	 * The admin page URL to load in the iframe.
	 *
	 * Optional for **native windows** (`native: true`) because a
	 * native window renders into `body` via {@link WindowConfig.render}
	 * rather than loading a URL. Iframe windows still require it —
	 * an iframe without a `src` serves `about:blank` and the user
	 * sees nothing useful. The shell defaults an absent native `url`
	 * to `#<id>` so history / bookmarking still round-trip to
	 * something unique.
	 */
	url?: string;
	/** Window title displayed in the title bar. */
	title: string;
	/** Dashicon class for the window icon (e.g., 'dashicons-admin-post'). */
	icon: string;
	/** Initial x position in pixels. */
	x: number;
	/** Initial y position in pixels. */
	y: number;
	/** Initial width in pixels. */
	width: number;
	/** Initial height in pixels. */
	height: number;
	/** Minimum width in pixels. */
	minWidth: number;
	/** Minimum height in pixels. */
	minHeight: number;
	/**
	 * Submenu items that render as a tab strip below the title bar.
	 * Each tab navigates the iframe within the same window — no new window opens.
	 * Pass an empty array (or omit) to hide the strip.
	 */
	submenu?: { title: string; url: string }[];
	/**
	 * Optional initial state. When present, the window is constructed
	 * into this state directly — used by session restore so a minimized
	 * or maximized window comes back in the same shape the user left it.
	 */
	initialState?: WindowState;
	/**
	 * Native window flag. When true, the window's body is rendered
	 * directly in the parent DOM via {@link WindowConfig.render} instead
	 * of loading {@link WindowConfig.url} in an iframe. Native windows
	 * inherit the full chrome (drag/resize/minimize/maximize) but skip
	 * iframe-only affordances (detach-to-tab, screen-meta bridge, tab
	 * strip, postMessage listener). Used for desktop-shell-native panels
	 * like OS Settings where an iframe would be wasteful and where the
	 * module wants direct access to the shell.
	 */
	native?: boolean;
	/**
	 * Render callback for native windows. Invoked once after the window
	 * element mounts; receives the `.wp-desktop-window__body` and
	 * an optional render context whose `window.send` / `window.on`
	 * are the unified channel-bus API for talking to / from this
	 * window's content. Ignored when `native` is falsy.
	 *
	 * Body content at call time depends on which entry point opened
	 * the window:
	 *
	 *   - **`desktop_mode_register_window()` (PHP)** — the shell clones
	 *     the registered `<template>` into the body before the
	 *     callback fires. Render = enhancement: query mount points,
	 *     light them up. See `wpDesktopNativeWindows[ id ]`.
	 *   - **`windowManager.open({ native: true, render })` (raw JS)** —
	 *     no template plumbing exists at this layer. The body is
	 *     empty; the callback constructs the DOM directly.
	 *
	 * The second argument is populated when `wp.desktop.registerWindow()`
	 * (or `desktop_mode_register_window()`) is the entry point —
	 * legacy `windowManager.open()` callers still receive `body`
	 * only; in that case use `wp.desktop.windowManager.getById(
	 * id ).on/send` instead.
	 */
	render?: (
		body: HTMLElement,
		ctx?: NativeRenderContext,
	) => void | ( () => void );
	/**
	 * Auto-focus control for native windows. Pass `true` to focus
	 * the body element itself (tabbable after render), a CSS
	 * selector string to focus a specific child (e.g. `'input'` for
	 * a search window, `'[data-primary]'` for a calculator's `=`
	 * key), or omit / pass `false` to skip auto-focus entirely.
	 *
	 * Applied on the next animation frame after `render()` returns —
	 * gives the DOM a chance to settle before `.focus()` resolves.
	 * Ignored for iframe windows (the iframe's own focus handling
	 * already owns that surface).
	 */
	autofocus?: boolean | string;
	/**
	 * Inline callback fired when the window's close animation begins.
	 * Complements the `wp-desktop.window.closing` hook — the hook is
	 * broadcast to every subscriber, while this callback is scoped
	 * specifically to this window's caller. Native windows use it to
	 * tear down subscriptions / timers that don't want to live past
	 * the fade-out. No-op for iframe windows.
	 */
	onClose?: () => void;
	/**
	 * Inline callback fired whenever the body element's dimensions
	 * change (user resize, initial mount, viewport reflow). Native
	 * windows that paint their own canvas use this to re-measure;
	 * DOM-based content usually doesn't need it. Delivered width /
	 * height are the `.wp-desktop-window__body` client dimensions,
	 * NOT the outer window size (title bar + tab strip are already
	 * subtracted). Fires alongside the
	 * `wp-desktop.window.body-resized` hook.
	 */
	onResize?: ( width: number, height: number ) => void;
	/**
	 * Attribution: the WordPress script handle (or plugin slug) that
	 * registered this window. Surfaced so devtools / inspectors that
	 * instrument a window from the outside can identify the owning
	 * plugin without parsing URLs. Populated automatically for native
	 * windows registered via `desktop_mode_register_window( $args )`
	 * (carries `$args['script']`); plugins that open iframe windows
	 * directly may set this themselves. Empty / undefined when the
	 * window comes from a core admin page with no plugin owner.
	 *
	 * @since 0.6.0
	 */
	ownerHandle?: string;
	/**
	 * Per-window appearance overrides — themes (CSS variables),
	 * controls (close / minimize / maximize layout + custom buttons),
	 * slots (named title-bar regions), and chrome (full title-bar
	 * render replacement, Experimental).
	 *
	 * Plugins can also drive these globally via the
	 * `wp.desktop.registerWindowTheme()` / `registerWindowControl()` /
	 * `registerWindowSlot()` / `registerWindowChrome()` registries plus
	 * the `match` predicate; this field is the registration-time
	 * shortcut for windows that opt in directly.
	 *
	 * @since 0.6.0
	 */
	appearance?: WindowAppearance;
}

/**
 * Per-window appearance overrides. Each layer is independently
 * optional — an empty `appearance` object is identical to omitting
 * the field.
 *
 * Resolution order against the global registries:
 *
 *   1. Theme — the theme registered with the highest `priority` whose
 *      `match` returns true wins. `appearance.theme.tokens` (inline)
 *      overrides any registered match; `appearance.theme.themeId`
 *      pins the theme to a specific registration.
 *   2. Controls — registry entries are filtered by their `match`,
 *      then `appearance.controls.order` / `.hide` / `.custom` apply
 *      the per-window mutations.
 *   3. Slots — registry entries with matching `match` paint each
 *      slot in `order` ascending; `appearance.slots[name]` overrides
 *      the slot entirely.
 *   4. Chrome — `appearance.chrome` selects a registered chrome by
 *      id; defaults to `'core/standard'`.
 *
 * @public
 * @since 0.6.0
 */
export interface WindowAppearance {
	/** Theme override (CSS variables). */
	theme?: WindowThemeRef;
	/** Per-window control configuration. */
	controls?: WindowControlsConfig;
	/** Per-window slot overrides keyed by slot name. */
	slots?: Partial< Record< WindowSlotName, WindowSlotConfig > >;
	/**
	 * Chrome registration id (e.g. `'core/standard'`,
	 * `'my-plugin/macos'`). Defaults to `'core/standard'` when
	 * omitted. Marked Experimental — chrome render contract may
	 * change.
	 */
	chrome?: string;
}

/**
 * Window-theme reference. Either a pinned theme id or an inline
 * tokens map. The inline form bypasses the global theme registry —
 * useful for one-off windows that don't merit a registration.
 *
 * @public
 * @since 0.6.0
 */
export type WindowThemeRef =
	| { themeId: string; tokens?: never }
	| { tokens: Record< string, string >; themeId?: never };

/**
 * Per-window control configuration. Mutates the resolved control
 * list AFTER the global registry has been filtered by its match
 * predicates.
 *
 *   - `order` — ids of controls in the order they should render
 *     inside the controls cluster. Built-in ids are
 *     `core/minimize`, `core/maximize`, `core/focus-tab`,
 *     `core/detach`, `core/close`. Plugin custom controls register
 *     their own ids. Controls not listed in `order` keep their
 *     registry order after the listed ones.
 *   - `hide` — ids to suppress on this window without unregistering
 *     them globally. Built-in ids are valid here.
 *   - `custom` — additional control entries scoped to this window
 *     only (no registry registration required).
 *   - `placement` — overall placement of the controls cluster.
 *     Defaults to `'right'`.
 *
 * @public
 * @since 0.6.0
 */
export interface WindowControlsConfig {
	order?: string[];
	hide?: string[];
	custom?: WindowControlInline[];
	placement?: 'left' | 'right';
}

/**
 * Inline control definition for `WindowControlsConfig.custom`. Same
 * shape as the registry's `WindowControlDef` minus the cross-window
 * fields (`match`, `owner`) — an inline control is bound to its
 * window, so the window arg is implied.
 *
 * @public
 * @since 0.6.0
 */
export interface WindowControlInline {
	id: string;
	label: string;
	icon?: string;
	placement?: 'left' | 'right' | 'controls';
	order?: number;
	onClick?: ( ev: MouseEvent ) => void;
	render?: ( host: HTMLElement ) => void;
}

/**
 * Canonical slot names. The shell renders each slot in this
 * left-to-right order:
 *
 * `before-titlebar` (above the bar) → `before-icon` → `icon` →
 * `title` → `after-title` → screen-meta cluster → menu (iframe-only)
 * → custom-button left slot → `before-controls` → `controls` →
 * `after-controls` → custom-button right slot → `after-titlebar`
 * (below the bar).
 *
 * @public
 * @since 0.6.0
 */
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

/**
 * Per-window slot override. Three accepted shapes:
 *
 *   - **`{ html: string }`** — the shell sets the slot host's
 *     `textContent` to the string (NOT `innerHTML`, so iframe-side
 *     content can't smuggle script). Plugins that need rich markup
 *     register a `WindowSlotDef.render` callback in the global
 *     registry and gate it on a window-specific match predicate.
 *   - **`{ render: (host, ctx) => …; replace?: boolean }`** — same
 *     shape as the global registry's `WindowSlotDef.render`. The
 *     callback runs every time the slot repaints.
 *   - **`null`** — explicit "render nothing" (suppress any matching
 *     global slot renderers and the default content). Use this to
 *     hide the title or icon for a custom-chrome look.
 *
 * @public
 * @since 0.6.0
 */
export type WindowSlotConfig =
	| { html: string }
	| {
		render: ( host: HTMLElement ) => void | ( () => void );
		replace?: boolean;
	}
	| null;

/**
 * Narrowed window configuration for **native** windows only. Author-
 * facing alias that defaults `native: true` and drops the iframe-only
 * fields the full {@link WindowConfig} carries. Use this when
 * declaring a plugin's native window:
 *
 * ```ts
 * const calc: NativeWindowDef = {
 *   id: 'calc',
 *   title: 'Calculator',
 *   icon: 'dashicons-calculator',
 *   width: 320,
 *   height: 460,
 *   minWidth: 280,
 *   minHeight: 380,
 *   render: ( body ) => { body.innerHTML = '…'; },
 *   onResize: ( w, h ) => console.log( 'body:', w, h ),
 * };
 * wp.desktop.registerWindow( calc );
 * ```
 *
 * @public
 * @since 0.10.0
 */
export interface NativeWindowDef extends Omit< WindowConfig, 'native' | 'url' | 'submenu' | 'x' | 'y' > {
	/** Optional `#hash`-style URL for history. Auto-generated from `id` when absent. */
	url?: string;
	/** Always `true` for native windows. Accepted for clarity; the shell enforces it. */
	native?: true;
	/** Initial x position in pixels. Defaults to 0; the shell's cascade positioner usually takes over. */
	x?: number;
	/** Initial y position in pixels. Defaults to 0; the shell's cascade positioner usually takes over. */
	y?: number;
	/**
	 * Convenience: declare this native window's body as a single
	 * iframe with shell-managed lifecycle. The shell creates the
	 * `<iframe>`, validates `event.source` on every incoming
	 * postMessage, hands you a `send()` closure that's safe to call
	 * (queued until the iframe acks ready), and auto-injects the
	 * iframe-side bridge (`wp.desktop.iframe.publish/subscribe/
	 * onConnection/requestConnection`) on same-origin pages when
	 * `bridge: true`.
	 *
	 * Replaces ~50 lines of per-plugin postMessage plumbing with a
	 * single config block. When you set this, **don't pass `render`**
	 * — the shell synthesises the body for you.
	 *
	 * @since 0.18.0
	 */
	iframeContent?: NativeWindowIframeContent;
}

/**
 * Configuration for a native window whose body is a single
 * shell-managed iframe. Used by `NativeWindowDef.iframeContent`.
 *
 * @public
 * @since 0.18.0
 */
export interface NativeWindowIframeContent {
	/**
	 * URL the iframe loads. Cross-origin is allowed but `bridge`
	 * auto-inject and `event.source` validation are best-effort
	 * (sandboxed cross-origin iframes get neither — `onMessage`
	 * still fires for messages whose `event.source` matches the
	 * iframe's `contentWindow`).
	 */
	url: string;
	/**
	 * Optional `sandbox` attribute. Pass the value verbatim
	 * (e.g. `'allow-scripts allow-same-origin'`). Omit for an
	 * unsandboxed iframe (the default — most common case for same-
	 * origin admin pages).
	 */
	sandbox?: string;
	/**
	 * When `true`, the shell injects the iframe-side connection
	 * bridge (`wp.desktop.iframe.publish/subscribe/onConnection/
	 * requestConnection` plus the unified `wp.desktop.send` /
	 * `wp.desktop.on`) into the iframe's document after load.
	 * Same-origin only — cross-origin iframes are out of reach for
	 * script injection so the flag is silently ignored.
	 *
	 * Default `false`. Set this when your iframe is a same-origin
	 * page that wants to participate in `wp.desktop.connect()`
	 * traffic / `Window.send` traffic without enqueueing the
	 * bridge handle itself.
	 */
	bridge?: boolean;
	/**
	 * Receives every message whose `event.source ===
	 * iframe.contentWindow`. Handles the source-check the shell
	 * would otherwise force every plugin to reinvent.
	 *
	 * **Most plugins should NOT use this.** Reach for the unified
	 * channel API instead — `Window.on( channel, cb )` from the
	 * parent shell, paired with `wp.desktop.send( channel,
	 * payload )` from inside the iframe. `onMessage` is the raw
	 * `event.data` firehose, useful only for plugins that already
	 * speak a non-`wp-desktop-window-*` postMessage protocol.
	 */
	onMessage?: ( payload: unknown ) => void;
}

/**
 * Window-scoped channel API surfaced to native render callbacks
 * as the second argument of {@link WindowConfig.render}. Plugin
 * authors talk to / from the window's content through these two
 * methods — same shape as the iframe-side `wp.desktop.send` /
 * `wp.desktop.on`, so cross-cutting plugin code that doesn't
 * care about render strategy stays render-strategy-agnostic.
 *
 * @public
 * @since 0.5.5
 */
export interface NativeRenderContext {
	/**
	 * Per-window channel handle. Methods are bound to this window's
	 * id so render code can lift them out of the context object
	 * without losing scope.
	 */
	window: {
		/**
		 * Publish a payload on a named channel. Reaches every
		 * `Window.on( channel, cb )` subscriber on the parent side
		 * (and any peer `wp.desktop.connect( id ).on()` listeners).
		 */
		send< T = unknown >( channel: string, payload?: T ): void;
		/**
		 * Subscribe to a payload published from outside this window —
		 * fires when a parent-side caller invokes `Window.send(
		 * channel, payload )`. Returns an unsubscribe handle.
		 */
		on< T = unknown >(
			channel: string,
			cb: (
				payload: T,
				meta: { channel: string; windowId: string },
			) => void,
		): () => void;
	};
}

/**
 * Canonical shape for a single entry displayed in a monitor /
 * observability widget. Any plugin that wants to contribute an
 * entry to monitor widgets applies a `wp-desktop.monitor.entry`
 * filter returning a mutated `MonitorEntry` or adds one to the
 * aggregated list. By converging every plugin on this shape we
 * avoid the "every monitor widget invents its own schema" fragmentation.
 *
 * Optional fields are all present so callers can filter / group
 * consistently: a pure console-log entry leaves `status` / `method`
 * / `url` unset, while a failed XHR fills them all.
 *
 * @public
 * @since 0.10.0
 */
export interface MonitorEntry {
	/** Unix timestamp in milliseconds (Date.now()). */
	ts: number;
	/** Classification tag — used for coloring / grouping in monitor UIs. */
	type: 'log' | 'warn' | 'error' | 'network' | 'shell-error' | 'iframe-error' | string;
	/** Human-readable summary. Max ~240 chars in UI — callers may truncate. */
	message: string;
	/**
	 * Free-form source label: window id, widget id, plugin slug,
	 * file:line, etc. Monitors group by this when rendering lists.
	 */
	source?: string;
	/** HTTP status (network entries). 0 when the request never completed. */
	status?: number;
	/** HTTP method (network entries). Uppercase. */
	method?: string;
	/** URL (network entries). Cross-origin is fine — monitors decide whether to render. */
	url?: string;
	/** Duration in milliseconds (network entries). */
	duration?: number;
	/** True when the entry represents a failure — network non-2xx, caught exception. */
	failed?: boolean;
	/** Arbitrary extra context. Kept untyped on purpose — MonitorEntry should stay small. */
	extra?: Record<string, unknown>;
}

/**
 * Server-declared native-window entry passed from PHP via the
 * `nativeWindows` config field. One entry per
 * `desktop_mode_register_window()` call. The shell automatically
 * adds + removes tiles to match this list across boots AND mid-
 * session plugin activation / deactivation — so activating a
 * plugin that registered via this helper makes its tile appear
 * without a browser reload, and deactivating it makes the tile
 * disappear cleanly.
 *
 * @public
 * @since 0.10.0
 */
export interface NativeWindowServerEntry {
	/** Window id + dock-tile id. */
	id: string;
	/** Tooltip + window title. */
	title: string;
	/** Dashicons class or URL. */
	icon: string;
	/** 'dock' | 'taskbar' | 'none'. */
	placement: 'dock' | 'taskbar' | 'none';
	/** Initial window dimensions in px. */
	width: number;
	height: number;
	/** Minimum user-resizable dimensions in px. */
	minWidth: number;
	minHeight: number;
	/** Autofocus rule — true, CSS selector, or false/absent. */
	autofocus: boolean | string;
	/** DOM id of the `<template>` the shell clones into the window body. */
	templateId: string;
	/** Pre-rendered template HTML. Shell injects a `<template>` when the id isn't already in the DOM (mid-session activation path). */
	templateHtml: string;
	/** Absolute URL of the plugin's enqueued script. Shell dynamically loads it when this entry appears mid-session. Empty when the plugin declared no script. */
	scriptUrl: string;
	/** WordPress script handle (informational). */
	scriptHandle: string;
	/**
	 * `wp_add_inline_script( $h, $code, 'before' )` strings harvested
	 * from the registered script handle. Injected as inline `<script>`
	 * tags before the lazy-load `<script src>` so the data lands the
	 * same way `wp_print_scripts()` would have printed it.
	 *
	 * @since 0.6.0
	 */
	scriptBefore?: string[];
	/** `wp_add_inline_script( $h, $code, 'after' )` strings. Injected after the body's `load` event. @since 0.6.0 */
	scriptAfter?: string[];
	/** Precomputed `wp_localize_script()` `var x = …;` blobs. Injected before the body. @since 0.6.0 */
	scriptL10n?: string[];
	/** `wp.i18n.setLocaleData(…)` snippet from `wp_set_script_translations()`. Injected before everything. @since 0.6.0 */
	scriptTranslations?: string;
	/**
	 * Attribution of the registering plugin. Mirrors `scriptHandle` for
	 * windows registered via `desktop_mode_register_window()`. Devtools
	 * read this off `Window.config.ownerHandle` once the window opens.
	 *
	 * @since 0.6.0
	 */
	ownerHandle: string;
	/**
	 * Tab descriptors for this window. Always includes at least the
	 * main tab (whose `template` renders the window's own body); if
	 * additional tabs were registered via
	 * `desktop_mode_register_window_tab()` they follow in position
	 * order. Empty array is equivalent to "main tab only" — the
	 * shell renders the window body directly without a tab strip.
	 *
	 * The template HTML already carries the rendered tab markup
	 * (`<wpd-tabs>` + `<wpd-tabpanel>` per entry). This field is
	 * metadata — useful for plugins that want to inspect or extend
	 * a window's tab list without re-parsing the template.
	 *
	 * @since 0.11.0
	 */
	tabs?: NativeWindowTabEntry[];
}

/**
 * A single tab descriptor on a native window — either the main tab
 * (`isMain: true`) whose template is the window's own body, or a
 * registered `desktop_mode_register_window_tab()` entry.
 *
 * @public
 * @since 0.11.0
 */
export interface NativeWindowTabEntry {
	value: string;
	label: string;
	isMain: boolean;
	/** Absolute URL of this tab's script — empty for the main tab and for tabs without a dedicated script. */
	scriptUrl: string;
	/** WordPress script handle (informational). */
	scriptHandle: string;
	/** @since 0.6.0 */
	scriptBefore?: string[];
	/** @since 0.6.0 */
	scriptAfter?: string[];
	/** @since 0.6.0 */
	scriptL10n?: string[];
	/** @since 0.6.0 */
	scriptTranslations?: string;
}

/**
 * Server-declared desktop-widget entry passed from PHP via the
 * `serverWidgets` config field. One entry per
 * `desktop_mode_register_widget()` call.
 *
 * The mount callback itself is not serializable; plugins register
 * it on `window.wpDesktopWidgets[ <id> ]` as a `(container, ctx)
 * => teardown` function. The shell pairs that global with the
 * metadata here to build a full `WidgetDef` at registration time.
 *
 * Mid-session activation injects the plugin's script (from
 * `scriptUrl`) before reading the callback, so newly-activated
 * plugins surface in the widget picker without a shell reload.
 *
 * @public
 * @since 0.10.0
 */
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
	/** Absolute URL of the plugin's enqueued script. Empty when no script was declared. */
	scriptUrl: string;
	/** WordPress script handle (informational). */
	scriptHandle: string;
	/** @since 0.6.0 */
	scriptBefore?: string[];
	/** @since 0.6.0 */
	scriptAfter?: string[];
	/** @since 0.6.0 */
	scriptL10n?: string[];
	/** @since 0.6.0 */
	scriptTranslations?: string;
}

/**
 * Server-declared wallpaper entry passed from PHP via
 * `serverWallpapers`. One entry per
 * `desktop_mode_register_wallpaper()` call. Only metadata crosses
 * the wire; the plugin's mount / resolveValue / renderEditor
 * callbacks are announced via
 * `window.wpDesktopWallpapers[ <id> ]` as a full `WallpaperDef`,
 * which the shell loads (if the script isn't yet in the tab) and
 * forwards to the normal wallpaper registry.
 *
 * @public
 * @since 0.10.0
 */
export interface DesktopWallpaperServerEntry {
	id: string;
	label: string;
	preview: string;
	type: 'css' | 'canvas';
	/**
	 * CSS value applied to the wallpaper surface. Populated when
	 * `type === 'css'` and the server-side registration passed a
	 * `value`. Empty string for canvas wallpapers, whose runtime
	 * value lives on the JS side inside the `mount` callback.
	 *
	 * When set, the shell can register the wallpaper purely from
	 * the server-side entry without any accompanying JS bundle.
	 *
	 * @since 0.11.0
	 */
	value: string;
	/** Absolute URL of the plugin's enqueued script. Empty when no script was declared. */
	scriptUrl: string;
	/** WordPress script handle (informational). */
	scriptHandle: string;
	/** @since 0.6.0 */
	scriptBefore?: string[];
	/** @since 0.6.0 */
	scriptAfter?: string[];
	/** @since 0.6.0 */
	scriptL10n?: string[];
	/** @since 0.6.0 */
	scriptTranslations?: string;
}

/**
 * Server-declared command-script entry passed from PHP via
 * `serverCommandScripts`. One entry per
 * `desktop_mode_register_command_script()` call (or indirectly via
 * `desktop_mode_register_command()`).
 *
 * The shell injects each `scriptUrl` into the shell page on mid-
 * session plugin activation. The loaded script registers its commands
 * through the normal `wp.desktop.registerCommand()` path; the live
 * command-registry subscription (see `subscribeCommands`) then repaints
 * any open palette without a reload.
 *
 * @public
 * @since 0.15.0
 */
export interface DesktopCommandScriptServerEntry {
	/** WordPress script handle — doubles as the command `owner` key used for live unregistration. */
	handle: string;
	/** Absolute URL of the plugin's enqueued script. Empty entries are dropped by the PHP payload builder. */
	scriptUrl: string;
	/** @since 0.6.0 */
	scriptBefore?: string[];
	/** @since 0.6.0 */
	scriptAfter?: string[];
	/** @since 0.6.0 */
	scriptL10n?: string[];
	/** @since 0.6.0 */
	scriptTranslations?: string;
}

/**
 * Server-declared command metadata passed from PHP via
 * `serverCommands`. Optional companion to
 * `DesktopCommandScriptServerEntry` — plugins declaring commands with
 * `desktop_mode_register_command()` emit one entry per command so metadata
 * is enumerable without executing the plugin's JS. The `run` function
 * still lives JS-side and is attached by the script referenced in
 * `scriptUrl` when it loads.
 *
 * Advisory today — reserved for future pre-registration shims.
 *
 * @public
 * @since 0.15.0
 */
export interface DesktopCommandServerEntry {
	slug: string;
	label: string;
	description: string;
	icon: string;
	hint: string;
	/** Absolute URL of the plugin's enqueued script. Empty when no script was declared. */
	scriptUrl: string;
	/**
	 * WordPress script handle this command belongs to. Enables live-
	 * unregistration on plugin deactivation without requiring the plugin
	 * to set `owner` on each JS `registerCommand` call — the sync walks
	 * the previous payload's slug→handle mapping when a handle leaves.
	 *
	 * @since 0.15.0
	 */
	scriptHandle: string;
	/** @since 0.6.0 */
	scriptBefore?: string[];
	/** @since 0.6.0 */
	scriptAfter?: string[];
	/** @since 0.6.0 */
	scriptL10n?: string[];
	/** @since 0.6.0 */
	scriptTranslations?: string;
}

/**
 * Server-declared settings-tab script entry passed from PHP via
 * `serverSettingsTabScripts`. One entry per
 * `desktop_mode_register_settings_tab_script()` call (or indirectly via
 * `desktop_mode_register_settings_tab()`).
 *
 * The shell injects each `scriptUrl` on mid-session plugin activation;
 * the loaded script calls `wp.desktop.registerSettingsTab()` and the
 * OS Settings window (subscribed to the tab registry) repaints.
 *
 * @public
 * @since 0.17.0
 */
export interface DesktopSettingsTabScriptServerEntry {
	/** WordPress script handle — doubles as the tab `owner` key used for live unregistration. */
	handle: string;
	/** Absolute URL of the plugin's enqueued script. Empty entries are dropped by the PHP payload builder. */
	scriptUrl: string;
	/** @since 0.6.0 */
	scriptBefore?: string[];
	/** @since 0.6.0 */
	scriptAfter?: string[];
	/** @since 0.6.0 */
	scriptL10n?: string[];
	/** @since 0.6.0 */
	scriptTranslations?: string;
}

/**
 * Server-declared title-bar-button script entry. One per
 * `desktop_mode_register_titlebar_button_script()` call. The shell
 * injects each `scriptUrl` on mid-session activation; the loaded
 * script calls `wp.desktop.registerTitleBarButton()` and the
 * window-class registry subscriber repaints every open window.
 *
 * @public
 * @since 0.17.0
 */
export interface DesktopTitleBarButtonScriptServerEntry {
	/** WordPress script handle — doubles as the button `owner` key for live unregistration. */
	handle: string;
	/** Absolute URL of the plugin's enqueued script. Empty entries are dropped by the PHP payload builder. */
	scriptUrl: string;
	/** @since 0.6.0 */
	scriptBefore?: string[];
	/** @since 0.6.0 */
	scriptAfter?: string[];
	/** @since 0.6.0 */
	scriptL10n?: string[];
	/** @since 0.6.0 */
	scriptTranslations?: string;
}

/**
 * Server-declared window-theme script entry. One per
 * `desktop_mode_register_window_theme_script()` call. The shell
 * injects each `scriptUrl` on mid-session activation; the loaded
 * script calls `wp.desktop.registerWindowTheme()` and the chrome
 * subscriber repaints every open window the theme matches.
 *
 * @public
 * @since 0.6.0
 */
export interface DesktopWindowThemeScriptServerEntry {
	/** WordPress script handle — doubles as the theme `owner` key for live unregistration. */
	handle: string;
	/** Absolute URL of the plugin's enqueued script. Empty entries are dropped by the PHP payload builder. */
	scriptUrl: string;
}

/**
 * Server-declared window-theme metadata entry. Optional companion to
 * {@link DesktopWindowThemeScriptServerEntry} — plugins that pre-declare
 * theme tokens server-side via `desktop_mode_register_window_theme()`
 * get the theme registered on the shell side without needing a JS
 * round trip; ergonomic for designers who want a stylesheet-only
 * theme. The `scriptUrl` carries any optional companion JS that
 * registers a `match` predicate (the metadata-only path matches the
 * theme to every window).
 *
 * @public
 * @since 0.6.0
 */
export interface DesktopWindowThemeServerEntry {
	id: string;
	label: string;
	tokens: Record< string, string >;
	priority: number;
	scriptUrl: string;
	scriptHandle: string;
}

/**
 * Server-declared window-control script entry. One per
 * `desktop_mode_register_window_control_script()` call.
 *
 * @public
 * @since 0.6.0
 */
export interface DesktopWindowControlScriptServerEntry {
	handle: string;
	scriptUrl: string;
}

/**
 * Server-declared window-control metadata entry — optional companion
 * to {@link DesktopWindowControlScriptServerEntry}.
 *
 * @public
 * @since 0.6.0
 */
export interface DesktopWindowControlServerEntry {
	id: string;
	label: string;
	icon: string;
	placement: 'left' | 'right' | 'controls';
	order: number;
	scriptUrl: string;
	scriptHandle: string;
}

/**
 * Server-declared window-slot script entry. One per
 * `desktop_mode_register_window_slot_script()` call.
 *
 * @public
 * @since 0.6.0
 */
export interface DesktopWindowSlotScriptServerEntry {
	handle: string;
	scriptUrl: string;
}

/**
 * Server-declared window-slot metadata entry — optional companion to
 * {@link DesktopWindowSlotScriptServerEntry}. The actual `render`
 * callback always lives JS-side; this metadata only declares which
 * slot the script targets so the live-refresh sync can attribute
 * unregister calls.
 *
 * @public
 * @since 0.6.0
 */
export interface DesktopWindowSlotServerEntry {
	id: string;
	slot: WindowSlotName;
	order: number;
	scriptUrl: string;
	scriptHandle: string;
}

/**
 * Server-declared custom-chrome script entry. One per
 * `desktop_mode_register_window_chrome_script()` call.
 *
 * Marked Experimental — the chrome render contract may change.
 *
 * @public
 * @since 0.6.0
 */
export interface DesktopWindowChromeScriptServerEntry {
	handle: string;
	scriptUrl: string;
}

/**
 * Server-declared custom-chrome metadata entry — optional companion
 * to {@link DesktopWindowChromeScriptServerEntry}. Marked Experimental.
 *
 * @public
 * @since 0.6.0
 */
export interface DesktopWindowChromeServerEntry {
	id: string;
	label: string;
	scriptUrl: string;
	scriptHandle: string;
}

/**
 * Server-declared settings-tab metadata passed from PHP via
 * `serverSettingsTabs`. Optional companion to
 * `DesktopSettingsTabScriptServerEntry`. Enables live unregistration on
 * plugin deactivation without requiring the plugin's JS to set `owner`
 * on each `registerSettingsTab()` call — the sync walks the previous
 * payload's id→handle mapping when a handle leaves.
 *
 * @public
 * @since 0.17.0
 */
export interface DesktopSettingsTabServerEntry {
	id: string;
	label: string;
	/**
	 * Required capability. The shell today collapses this to an admin
	 * vs everyone gate; `manage_options` maps to admin-only, anything
	 * else to everyone-visible.
	 */
	capability: string;
	/** Sort order relative to built-in tabs. */
	order: number;
	/** Absolute URL of the plugin's enqueued script. Empty when no script was declared. */
	scriptUrl: string;
	/** WordPress script handle this tab belongs to. */
	scriptHandle: string;
	/** @since 0.6.0 */
	scriptBefore?: string[];
	/** @since 0.6.0 */
	scriptAfter?: string[];
	/** @since 0.6.0 */
	scriptL10n?: string[];
	/** @since 0.6.0 */
	scriptTranslations?: string;
}

/**
 * Server-declared desktop icon — a shortcut tile on the wallpaper
 * that opens a native window or a URL on click. Registered via PHP
 * with `desktop_mode_register_icon()`.
 *
 * @since 0.11.0
 * @public
 */
export interface DesktopIconServerEntry {
	id: string;
	title: string;
	icon: string;
	/** Id of a registered native window to open on click. Empty string when the icon targets a URL instead. */
	window: string;
	/** URL to open on click. Empty string when the icon targets a native window. */
	url: string;
	/** Sort order; lower renders first. */
	position: number;
}

/**
 * Live geometry + state snapshot for a single window, returned by
 * `WindowManager.getVisibleRects()`.
 *
 * The shape is intentionally small and non-serializable (it carries
 * a live `HTMLElement` reference) — it exists for runtime overlays
 * and collision-aware wallpaper plugins, not for persistence. For the
 * persisted shape see {@link WindowSnapshot}.
 *
 * @public
 */
export interface VisibleWindowRect {
	/** Unique window id — matches `Window.id`. */
	windowId: string;
	/**
	 * Current geometry in desktop-area coordinates (matches the
	 * window element's inline-style `left` / `top` / `width` /
	 * `height`). For windows on a suppressed (non-active) virtual
	 * desktop this still reflects the geometry the window would
	 * paint at once its desktop becomes active.
	 */
	rect: { x: number; y: number; width: number; height: number };
	/** The window's current state. Callers typically filter on this. */
	state: WindowState;
	/** Live reference to the outer window element. */
	element: HTMLElement;
}

/**
 * Serialized window state for persistence.
 */
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

/**
 * A dock item passed from PHP menu data.
 */
export interface DockItemConfig {
	/** Unique identifier (menu slug). */
	id: string;
	/** Display label. */
	title: string;
	/** Icon: dashicons class, data:image/svg+xml, URL, or 'none'. */
	icon: string;
	/** Admin page URL. */
	url: string;
	/** Badge count (updates, comments, etc.). */
	badge: number;
	/** Submenu items. */
	submenu: { title: string; url: string }[];
	/**
	 * Whether this admin page supports multiple open windows. Determined
	 * server-side — list screens (Posts, Pages, Media, Users, Comments,
	 * taxonomies) are true by default; Settings / Tools / Dashboard are
	 * false. Filterable via `desktop_mode_dock_item_multi`.
	 */
	multi?: boolean;
	/**
	 * Server-side routing hint: `'dock'` for core WordPress menus
	 * rendered on the left-edge dock, `'taskbar'` for plugin-
	 * contributed top-level menus rendered in the bottom taskbar.
	 * Derived by `desktop_mode_dock_placement` in PHP; filterable via the
	 * `desktop_mode_dock_placement` hook.
	 */
	placement?: 'dock' | 'taskbar';
}

/**
 * A single persisted window entry.
 *
 * Shape mirrors the server-side sanitizer in includes/session.php — any
 * field added here must be validated server-side or it will be dropped.
 */
export interface SessionWindow {
	id: string;
	/**
	 * Grouping key for multi-instance windows. Optional for back-compat
	 * with sessions saved before the field existed — restore falls back
	 * to the id when missing.
	 */
	baseId?: string;
	/**
	 * Virtual-desktop assignment. Optional for back-compat with
	 * sessions saved before multi-desktop support — restore falls back
	 * to the active desktop when missing.
	 */
	desktopId?: string;
	url: string;
	title: string;
	icon: string;
	state: WindowState;
	x: number;
	y: number;
	width: number;
	height: number;
	/**
	 * External-link sub-tabs open on this window at save time. Each
	 * carries the URL and display label so the shell can re-add them
	 * via `Window.addExternalTab` on restore. Empty or absent when no
	 * external tabs are open.
	 */
	externalTabs?: { url: string; label: string }[];
}

/**
 * The user's saved desktop session — open windows, focused id, last-write
 * timestamp. Restored by the shell on load; written back debounced.
 *
 * `desktops` + `activeDesktop` are post-multi-desktop additions and
 * carry sane defaults from the server side, so older clients reading
 * a fresh session never miss them.
 */
export interface Session {
	windows: SessionWindow[];
	desktops: Desktop[];
	activeDesktop: string;
	focused: string;
	updated: number;
}

/**
 * Desktop shell configuration passed from PHP via wp_localize_script.
 */
export interface DesktopConfig {
	/** The current admin page URL (to auto-open in the first window). */
	currentPage: string;
	/** The current admin page title. */
	currentTitle: string;
	/** The current admin page icon class. */
	currentIcon: string;
	/** Base admin URL (e.g., 'http://localhost:8889/wp-admin/'). */
	adminUrl: string;
	/** The active color scheme slug. */
	colorScheme: string;
	/**
	 * Dock items derived from the admin menu and filtered to CORE
	 * WordPress pages (Dashboard, Posts, Plugins, Users, Settings,
	 * and CPTs). Rendered on the left-edge dock.
	 */
	dockItems: DockItemConfig[];
	/**
	 * Plugin-contributed top-level menus (anything routed through
	 * `admin.php?page=*`). Rendered in the bottom taskbar, macOS-
	 * style. Split from `dockItems` by `desktop_mode_dock_placement` in PHP
	 * with the `desktop_mode_dock_placement` filter as an escape hatch
	 * for plugins that want to override the default heuristic.
	 */
	taskbarItems: DockItemConfig[];
	/**
	 * Server-declared native windows (from `desktop_mode_register_window()`).
	 * Shell auto-registers system tiles at boot + syncs them on every
	 * live menu refresh so plugin activate / deactivate maps to tile
	 * add / remove with no browser reload.
	 */
	nativeWindows: NativeWindowServerEntry[];
	/**
	 * Server-declared widgets (from `desktop_mode_register_widget()`).
	 * Same lifecycle story as native windows — shell syncs the
	 * widget registry + dynamically loads plugin scripts on mid-
	 * session activation, so widgets appear in the picker without
	 * a browser reload.
	 */
	serverWidgets: DesktopWidgetServerEntry[];
	/**
	 * Server-declared wallpapers (from `desktop_mode_register_wallpaper()`).
	 * Same lifecycle as widgets + native windows — shell loads the
	 * plugin's JS, reads the full `WallpaperDef` from the global,
	 * and registers it. Deactivation unregisters + re-applies the
	 * current selection.
	 */
	serverWallpapers: DesktopWallpaperServerEntry[];
	/**
	 * Script handles opted-in via `desktop_mode_register_command_script()`.
	 * Shell injects each URL on boot and on mid-session activation so
	 * new slash-commands appear in the palette without a reload.
	 *
	 * @since 0.15.0
	 */
	serverCommandScripts?: DesktopCommandScriptServerEntry[];
	/**
	 * Server-declared command metadata (from `desktop_mode_register_command()`).
	 * Advisory today — reserved for future pre-registration shims.
	 *
	 * @since 0.15.0
	 */
	serverCommands?: DesktopCommandServerEntry[];
	/**
	 * Script handles opted-in via `desktop_mode_register_settings_tab_script()`.
	 * Shell injects each URL on boot and on mid-session activation so
	 * new OS Settings tabs appear without a reload.
	 *
	 * @since 0.17.0
	 */
	serverSettingsTabScripts?: DesktopSettingsTabScriptServerEntry[];
	/**
	 * Server-declared settings-tab metadata (from
	 * `desktop_mode_register_settings_tab()`). Enables live unregistration
	 * on deactivation without per-call `owner` in JS.
	 *
	 * @since 0.17.0
	 */
	serverSettingsTabs?: DesktopSettingsTabServerEntry[];
	/**
	 * Script handles opted-in via
	 * `desktop_mode_register_titlebar_button_script()`. Shell injects
	 * each URL on boot and on mid-session activation so newly-
	 * installed plugins paint their title-bar buttons live.
	 *
	 * @since 0.17.0
	 */
	serverTitleBarButtonScripts?: DesktopTitleBarButtonScriptServerEntry[];
	/**
	 * Script handles opted-in via
	 * `desktop_mode_register_window_theme_script()`. The shell loads
	 * each script on activation; the script calls
	 * `wp.desktop.registerWindowTheme()` so window themes appear live.
	 * Owner-tagged registrations live-unregister on deactivation.
	 *
	 * @since 0.6.0
	 */
	serverWindowThemeScripts?: DesktopWindowThemeScriptServerEntry[];
	/**
	 * Server-declared window-theme metadata (from
	 * `desktop_mode_register_window_theme()`). Optional companion to
	 * the script-handle list — pre-registers themes shell-side so
	 * stylesheet-only themes (no JS) work, and so the sync can map
	 * id → handle for live unregistration without per-call JS owner.
	 *
	 * @since 0.6.0
	 */
	serverWindowThemes?: DesktopWindowThemeServerEntry[];
	/**
	 * Script handles opted-in via
	 * `desktop_mode_register_window_control_script()`.
	 *
	 * @since 0.6.0
	 */
	serverWindowControlScripts?: DesktopWindowControlScriptServerEntry[];
	/**
	 * Server-declared control metadata (from
	 * `desktop_mode_register_window_control()`).
	 *
	 * @since 0.6.0
	 */
	serverWindowControls?: DesktopWindowControlServerEntry[];
	/**
	 * Script handles opted-in via
	 * `desktop_mode_register_window_slot_script()`.
	 *
	 * @since 0.6.0
	 */
	serverWindowSlotScripts?: DesktopWindowSlotScriptServerEntry[];
	/**
	 * Server-declared slot metadata (from
	 * `desktop_mode_register_window_slot()`).
	 *
	 * @since 0.6.0
	 */
	serverWindowSlots?: DesktopWindowSlotServerEntry[];
	/**
	 * Script handles opted-in via
	 * `desktop_mode_register_window_chrome_script()`. **Experimental** —
	 * the chrome render contract may change.
	 *
	 * @since 0.6.0
	 */
	serverWindowChromeScripts?: DesktopWindowChromeScriptServerEntry[];
	/**
	 * Server-declared custom-chrome metadata (from
	 * `desktop_mode_register_window_chrome()`). **Experimental.**
	 *
	 * @since 0.6.0
	 */
	serverWindowChromes?: DesktopWindowChromeServerEntry[];
	/**
	 * Server-declared desktop icons (from `desktop_mode_register_icon()`).
	 * The shell renders these as shortcut tiles on the wallpaper;
	 * click-through opens either the referenced native window (if
	 * `window` is set) or the URL (if `url` is set).
	 *
	 * @since 0.11.0
	 */
	desktopIcons?: DesktopIconServerEntry[];
	/** Previously saved session (may be empty on first run). */
	session: Session;
	/** REST endpoint for reading/writing the session. */
	sessionUrl: string;
	/** REST endpoint for media uploads (wp/v2/media). */
	mediaUrl: string;
	/**
	 * REST endpoint returning the live admin-menu split
	 * (`{ dockItems, taskbarItems }`). The shell calls it after the
	 * chromeless bridge signals `wp-desktop-plugins-changed` so
	 * newly-activated plugins surface on the taskbar without a full
	 * tab reload. Same payload shape as `dockItems` + `taskbarItems`
	 * at boot.
	 */
	menuUrl: string;
	/** REST endpoint for saving the default-window preference. */
	defaultWindowUrl: string;
	/**
	 * Current default-window preference.
	 *
	 * - `enabled: true`  — on portal entry with no saved session,
	 *   open the window at `url`. First-run default is Dashboard.
	 * - `enabled: false` — on portal entry with no saved session, do
	 *   NOT auto-open anything. The user gets a clean empty desktop.
	 *   `url` still carries a sensible fallback (typically Dashboard)
	 *   that the portal forwards through at the HTTP layer; the shell
	 *   uses the flag to decide whether to auto-open it.
	 */
	defaultWindow: { enabled: boolean; url: string };
	/** Whether the user has the `upload_files` capability. */
	canUpload: boolean;
	/**
	 * Plugin base URL without trailing slash. Used by the shell to
	 * locate vendor assets (e.g. `${pluginUrl}/assets/vendor/pixi.min.js`)
	 * and by third-party plugin authors who want to build asset URLs
	 * relative to the wp-desktop-mode install.
	 */
	pluginUrl: string;
	/**
	 * Absolute URL of the standalone iframe-bridge script. Used by
	 * the `iframeContent: { bridge: true }` auto-inject path on
	 * `registerWindow` and exposed for plugins that need to inject
	 * the bridge into their own same-origin iframes manually.
	 *
	 * @since 0.18.0
	 */
	iframeBridgeUrl?: string;
	/** Nonce for the REST endpoint (X-WP-Nonce header). */
	restNonce: string;
	/** Canonical `/wp-desktop/` URL — used for history.replaceState. */
	portalUrl: string;
	/** True when the shell was reached via the portal redirect. */
	fromPortal: boolean;
	/**
	 * Accent swatches shown in the OS Settings color picker. Filterable
	 * server-side via `desktop_mode_accent_colors`. Optional — the TS
	 * side falls back to a built-in default list when this is missing
	 * (older PHP builds, hostile filter that returned garbage, etc.).
	 *
	 * @since 0.11.0
	 */
	accentColors?: AccentColor[];
	/**
	 * Toast-notification type map. Filterable server-side via
	 * `desktop_mode_toast_types`. Optional — same fallback story as
	 * `accentColors`.
	 *
	 * @since 0.11.0
	 */
	toastTypes?: ToastTypeDef[];
	/**
	 * Wallpaper slug applied on first boot for a new user. Filterable
	 * server-side via `desktop_mode_default_wallpaper`. Optional — an
	 * empty string falls back to the TS default.
	 *
	 * @since 0.11.0
	 */
	defaultWallpaper?: string;
	/**
	 * Saved OS settings for the current user, loaded from user meta by PHP
	 * at boot. The JS layer reads this once to hydrate its local state,
	 * then writes to localStorage for instant subsequent reads and POSTs
	 * changes back to `osSettingsUrl` so user meta stays the durable source.
	 *
	 * Optional — absent on older PHP builds that predate this field.
	 *
	 * @since 0.14.0
	 */
	osSettings?: Record<string, unknown>;
	/**
	 * REST endpoint for reading/writing OS settings.
	 * @since 0.14.0
	 */
	osSettingsUrl?: string;
	/**
	 * REST endpoint for the AI content search.
	 * Shape: `wp-desktop/v1/ai/search`.
	 * @since 0.14.0
	 */
	aiSearchUrl?: string;
	/**
	 * SSE streaming endpoint for the agentic search — admin-ajax.php with
	 * `action=desktop_mode_ai_search_stream` pre-filled. The JS EventSource appends
	 * &nonce= and &query= when connecting.
	 * @since 0.14.0
	 */
	aiSearchStreamUrl?: string;
	/**
	 * Platform-wide AI settings — only present for admins (null for
	 * non-admin users so the key is never leaked in the page source).
	 * @since 0.14.0
	 */
	aiPlatformSettings?: { enabled: boolean; provider: string; apiKey: string } | null;
	/**
	 * REST endpoint for reading/writing platform AI settings (admin only).
	 * @since 0.14.0
	 */
	aiPlatformSettingsUrl?: string;
	/**
	 * Whether the current user has the `manage_options` capability.
	 * @since 0.14.0
	 */
	currentUserIsAdmin?: boolean;
	/**
	 * Platform-wide extended options (admin-only). Contains toggles
	 * for optional site-level enhancements such as Media Library
	 * drag-and-drop. Null for non-admin users.
	 * @since 0.14.0
	 */
	extendedOptions?: {
		media_library_enhanced: boolean;
	} | null;
	/**
	 * REST endpoint for reading/writing extended options (admin only).
	 * @since 0.14.0
	 */
	extendedOptionsUrl?: string;
}

/**
 * A single entry in the OS Settings accent-color picker.
 *
 * @since 0.11.0
 */
export interface AccentColor {
	id: string;
	label: string;
	value: string;
}

/**
 * A single toast-notification type declared by the server.
 *
 * @since 0.11.0
 */
export interface ToastTypeDef {
	id: string;
	label: string;
	icon: string;
	tone: 'positive' | 'warning' | 'critical' | 'neutral';
}

/**
 * A single command harvested from an iframe's `wp.data.select('core/commands')`
 * registry. Emitted by the chromeless bridge and consumed by the parent's
 * iframe-command bridge module, which re-registers each entry as a
 * slash-command in the shell palette for whichever window currently has focus.
 *
 * `kind` is decided inside the iframe by dry-invoking the original callback
 * inside a `window.location`-intercept sandbox: a callback whose only
 * observable effect is a navigation is classified `navigate` (with the
 * captured `url`), and the parent rewrites the selection to open a new
 * desktop window instead of navigating the current iframe out of chromeless
 * mode. Anything else is `action` — the parent proxies execution back
 * into the iframe via `wp-desktop-commands-invoke`.
 *
 * @since 0.16.0
 */
export interface HarvestedCommand {
	name: string;
	label: string;
	icon?: string;
	/**
	 * Pre-rendered SVG markup for the command's icon. Gutenberg ships
	 * most command icons as React elements from `@wordpress/icons`
	 * (e.g. the `duplicate` block glyph), which the structured-clone
	 * algorithm behind `postMessage` can't carry. The iframe renders
	 * these to an HTML string via `wp.element.renderToString` and
	 * forwards the result here; the parent palette injects it directly
	 * into the row's icon slot. Empty / absent when the icon was a
	 * plain dashicons class (covered by `icon` above) or unset.
	 *
	 * Trust note: the string is same-origin and never user-authored,
	 * so rendering via `innerHTML` is safe.
	 */
	iconSvg?: string;
	context?: string;
	kind: 'navigate' | 'action';
	url?: string;
}

/**
 * Bridge events sent from iframe to parent shell.
 */
export type BridgeEventFromIframe =
	| { type: 'wp-desktop-title-change'; title: string }
	| { type: 'wp-desktop-navigate'; url: string; target: 'self' | 'new' }
	| { type: 'wp-desktop-notification'; title: string; body: string }
	| { type: 'wp-desktop-ready' }
	| { type: 'wp-desktop-screen-meta'; panels: ( 'screen-options' | 'help' )[] }
	| { type: 'wp-desktop-screen-meta-state'; open: 'screen-options' | 'help' | null }
	| { type: 'wp-desktop-commands-list'; commands: HarvestedCommand[] }
	// -----------------------------------------------------------------
	// Cross-window connection bridge — extensible pub/sub between any
	// parent-side caller (e.g. a plugin's title-bar dropdown) and a
	// chromeless iframe. The shell only routes; topic semantics are
	// plugin-defined. See `wp.desktop.connect()` and
	// `wp.desktop.iframe.publish/subscribe`.
	// -----------------------------------------------------------------
	| {
		type: 'wp-desktop-bridge-handshake-ack';
		connectionId: string;
	}
	| {
		type: 'wp-desktop-bridge-publish';
		connectionId: string;
		topic: string;
		payload: unknown;
	}
	| {
		type: 'wp-desktop-bridge-disconnect';
		connectionId: string;
	};

/**
 * Bridge events sent from parent shell to iframe.
 */
export type BridgeEventToIframe =
	| { type: 'wp-desktop-focus' }
	| { type: 'wp-desktop-color-scheme'; scheme: string }
	| { type: 'wp-desktop-toggle-panel'; panel: 'screen-options' | 'help' }
	| { type: 'wp-desktop-commands-subscribe' }
	| { type: 'wp-desktop-commands-unsubscribe' }
	| { type: 'wp-desktop-commands-invoke'; name: string }
	// Connection-bridge messages (parent → iframe).
	| {
		type: 'wp-desktop-bridge-handshake';
		connectionId: string;
		topics: string[];
	}
	| {
		type: 'wp-desktop-bridge-publish';
		connectionId: string;
		topic: string;
		payload: unknown;
	}
	| {
		type: 'wp-desktop-bridge-disconnect';
		connectionId: string;
	};
