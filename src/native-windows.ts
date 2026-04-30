/**
 * Helpers for plugins that register native (non-iframe) windows.
 *
 * Two convenience wrappers land here:
 *
 *   - {@link createRegisterWindow} → `wp.desktop.registerWindow()`.
 *     Wraps `windowManager.open()` with sensible native defaults so
 *     plugin authors don't have to re-declare the same scaffolding
 *     every time: `native: true`, fallback `url` (`#<id>`), minimum
 *     size defaults, and a warning-free id derivation when the
 *     caller omits `baseId`.
 *
 *   - {@link cloneTemplate} → a tiny `<template>` cloner. The shell
 *     uses it internally to populate every native window's body with
 *     the registered template before invoking the render callback,
 *     so plugin authors using `desktop_mode_register_window()` don't
 *     touch this directly. Exported for advanced cases that want to
 *     re-clone (e.g. dynamic per-row templates, custom hydration
 *     flows outside the standard pipeline).
 *
 * Both are intentionally thin — they don't introduce new runtime
 * state. Plugins that outgrow them can always call the underlying
 * APIs directly.
 *
 * @since 0.10.0
 */

import { activity } from './activity';
import { HOOKS, addAction, doAction, removeAction } from './hooks';
import { loadVendorScript } from './wallpapers/vendor-loader';
import { registerSyntheticIframe } from './connection';
import type { Dock } from './dock';
import type {
	NativeRenderContext,
	NativeWindowDef,
	NativeWindowIframeContent,
	NativeWindowServerEntry,
} from './types';
import type { WindowManager } from './window-manager';
import type { Window as DesktopWindow } from './window';
import {
	addNativeSubscriber,
	dispatchFromWindow,
	markWindowContentLoading,
	markWindowContentReady,
	type WindowChannelCb,
} from './window-channels';

/**
 * Scoped lifecycle handlers a caller passes to `onWindow( id, … )`.
 * Each slot is optional — subscribers pick the events they care
 * about. Keys are short (opened / closed / focused / …) rather
 * than the full hook name so the invocation reads like a state-
 * machine transition table. Payloads match the hook payloads
 * exactly, minus the `windowId` field (it's implied by the id
 * argument to `onWindow`).
 *
 * @public
 * @since 0.10.0
 */
export interface WindowLifecycleHandlers {
	opened?: () => void;
	/**
	 * `wp.desktop.openWindow(id)` was called for an already-open
	 * instance — the plugin's render callback won't run again, but
	 * the user/caller is asking to "show this window". A typical
	 * use is to re-orient content (focus a tab, scroll to a row).
	 * Payload mirrors the `WINDOW_REOPENED` action: `{ baseId,
	 * wasMinimized }`. *Since 0.5.5.*
	 */
	reopened?: ( payload: { baseId: string; wasMinimized: boolean } ) => void;
	focused?: () => void;
	/**
	 * Window lost focus to another window. Payload: `{ focusedTo }` —
	 * the id of the window that took over (so subscribers can
	 * decide whether the blur transitions to a peer they care
	 * about). *Since 0.5.5.*
	 */
	blurred?: ( payload: { focusedTo: string | null } ) => void;
	closing?: ( payload: { element: HTMLElement } ) => void;
	closed?: () => void;
	minimized?: () => void;
	restored?: () => void;
	maximized?: () => void;
	/** *Since 0.5.5.* Fires when the window leaves maximized state. */
	unmaximized?: () => void;
	/** *Since 0.5.5.* Fires when the window enters fullscreen / focus mode. */
	fullscreenEntered?: () => void;
	/** *Since 0.5.5.* Fires when the window exits fullscreen / focus mode. */
	fullscreenExited?: () => void;
	resized?: ( payload: { width: number; height: number } ) => void;
	/** Body-resized — fires on every paint where body dimensions change. */
	bodyResized?: ( payload: { width: number; height: number } ) => void;
	/** Live geometry during an active drag / resize. rAF-coalesced. */
	boundsChanged?: ( payload: {
		x: number;
		y: number;
		width: number;
		height: number;
	} ) => void;
}

/**
 * Sensible minimums for native windows that don't declare their
 * own. Matches the smallest sizes our own native windows (OS
 * Settings) ship with so third-party plugins start in the same
 * ballpark without guessing.
 */
const DEFAULT_NATIVE_MIN_WIDTH = 280;
const DEFAULT_NATIVE_MIN_HEIGHT = 220;
const DEFAULT_NATIVE_WIDTH = 520;
const DEFAULT_NATIVE_HEIGHT = 400;

/**
 * Synthesise a `render( body )` callback that renders an iframe
 * inside the native window's body and manages its lifecycle:
 *
 *   - Creates the `<iframe>` with the configured URL + sandbox.
 *   - On the iframe's `load` event, calls `onReady( send )` and
 *     flushes any messages queued before load.
 *   - Listens for `message` events whose `event.source` matches
 *     the iframe's `contentWindow` (the source-check every plugin
 *     would otherwise reinvent) and forwards `event.data` to
 *     `onMessage`.
 *   - When `bridge: true` AND the iframe is same-origin, injects
 *     the public iframe-side bridge script via `<script>` so the
 *     iframe can `wp.desktop.iframe.publish/subscribe/
 *     onConnection/requestConnection` without enqueueing the
 *     bridge handle itself.
 *
 * Listener + iframe are torn down via the parent window's `onClose`
 * — wired in by `createRegisterWindow` below so the plugin's own
 * `onClose` also runs.
 *
 * @internal
 */
function buildIframeContentRender(
	cfg: NativeWindowIframeContent,
	cleanups: ( () => void )[],
	windowId: string,
): ( body: HTMLElement ) => Promise< void > {
	return ( body: HTMLElement ) => {
		const iframe = document.createElement( 'iframe' );
		iframe.style.width = '100%';
		iframe.style.height = '100%';
		iframe.style.border = '0';
		iframe.setAttribute( 'src', cfg.url );
		if ( typeof cfg.sandbox === 'string' && cfg.sandbox !== '' ) {
			iframe.setAttribute( 'sandbox', cfg.sandbox );
		}
		body.style.padding = '0';
		body.appendChild( iframe );

		// Tell the connection bridge that this window's "iframe"
		// lives here in the native body, not on `Window.iframe`.
		// Without this, `wp.desktop.connect( id ).send( … )` would
		// silently drop messages — the bridge's iframe lookup would
		// hit a null `Window.iframe` and bail.
		const unregisterSynth = registerSyntheticIframe( windowId, iframe );
		cleanups.push( unregisterSynth );

		// Resolve the iframe URL's origin once; the message handler
		// uses it for the same-origin check on inbound messages.
		// Falls back to the shell origin for relative / invalid
		// URLs — matches the chromeless bridge's trust boundary.
		let targetOrigin: string;
		try {
			targetOrigin = new URL( cfg.url, window.location.origin ).origin;
		} catch {
			targetOrigin = window.location.origin;
		}

		// Promise resolves when the iframe finishes loading. The
		// shell's `hydrateNative` awaits this before flipping the
		// window out of the loading state — so `iframeContent`
		// native windows get the same spinner-while-loading
		// affordance as plain iframe windows. `markWindowContentReady`
		// is also called inline to flush any queued sends; firing it
		// twice is a no-op (the loading-state delete is edge-triggered).
		let resolveReady: ( () => void ) | null = null;
		const readyPromise = new Promise< void >( ( resolve ) => {
			resolveReady = resolve;
		} );
		const onLoad = (): void => {
			// Bridge auto-inject — same-origin only. Cross-origin
			// iframes throw on `contentDocument` access; we silently
			// skip in that case so the rest of the lifecycle still
			// works (the plugin can still ship its own bridge
			// integration if it wants one).
			if ( cfg.bridge ) {
				try {
					const doc = iframe.contentDocument;
					if ( doc && ! doc.querySelector( 'script[data-wp-desktop-iframe-bridge]' ) ) {
						const bridgeUrl = (
							window as unknown as {
								wpDesktopConfig?: { iframeBridgeUrl?: string };
							}
						).wpDesktopConfig?.iframeBridgeUrl;
						if ( bridgeUrl ) {
							const s = doc.createElement( 'script' );
							s.src = bridgeUrl;
							s.setAttribute( 'data-wp-desktop-iframe-bridge', '1' );
							doc.head?.appendChild( s );
						}
					}
				} catch {
					/* cross-origin — silently skip auto-inject */
				}
			}

			// Flush every queued `Window.send()` payload in FIFO
			// order — the canonical readiness signal for synthetic
			// iframes.
			markWindowContentReady( windowId );
			resolveReady?.();
		};
		iframe.addEventListener( 'load', onLoad );

		// Source-checked message dispatch. Restricting on
		// `event.source === iframe.contentWindow` is the canonical
		// way to ensure the message came from THIS iframe (rather
		// than another iframe in the same shell or a top-level
		// foreign caller). Origin is also validated — same-origin
		// only by default, matching the chromeless bridge.
		//
		// Bridge-prefixed messages (`wp-desktop-bridge-*`) are also
		// forwarded into the connection registry so this iframe can
		// participate in `wp.desktop.connect()` traffic — the
		// chromeless bridge's own message listener doesn't see this
		// iframe (it sits inside a native window's body, not the
		// shell-managed iframe).
		const onMessage = ( e: MessageEvent ): void => {
			if ( ! iframe.contentWindow || e.source !== iframe.contentWindow ) {
				return;
			}
			if ( e.origin !== targetOrigin && e.origin !== window.location.origin ) {
				return;
			}
			const data = e.data;
			if (
				data &&
				typeof data === 'object' &&
				typeof ( data as { type?: string } ).type === 'string' &&
				( data as { type: string } ).type.startsWith( 'wp-desktop-bridge-' )
			) {
				const bridgeRouter = (
					window as unknown as {
						__wpDesktopConnectionBridge?: {
							routeIncomingFromIframe(
								d: unknown,
								fromWindowId?: string,
							): void;
						};
					}
				).__wpDesktopConnectionBridge;
				bridgeRouter?.routeIncomingFromIframe( data, windowId );
			}
			// Unified window-channel publish from the synthetic iframe.
			// Mirror of the equivalent block in `src/window/iframe-bridge.ts`
			// — keeps `iframeContent` native windows participating in
			// the same `Window.on( channel, cb )` registry as
			// shell-managed iframe windows.
			if (
				data &&
				typeof data === 'object' &&
				( data as { type?: string } ).type === 'wp-desktop-window-publish' &&
				typeof ( data as { channel?: string } ).channel === 'string' &&
				( data as { channel: string } ).channel !== ''
			) {
				dispatchFromWindow(
					windowId,
					( data as { channel: string } ).channel,
					( data as { payload?: unknown } ).payload,
				);
			}
			try {
				cfg.onMessage?.( e.data );
			} catch ( err ) {
				if ( typeof console !== 'undefined' ) {
					console.error(
						'[wp-desktop-mode] iframeContent.onMessage threw:',
						err,
					);
				}
			}
		};
		window.addEventListener( 'message', onMessage );

		cleanups.push( () => {
			window.removeEventListener( 'message', onMessage );
			iframe.removeEventListener( 'load', onLoad );
		} );

		return readyPromise;
	};
}

/**
 * Build the `registerWindow` implementation bound to the shell's
 * window manager. Returned function is the one exposed on
 * `wp.desktop.registerWindow`.
 *
 * The returned helper is idempotent for a given id — if a window
 * with the same id is already open, it focuses it rather than
 * spawning a duplicate. Matches the dock's click-to-focus
 * semantics so `registerWindow` + a dock-icon onClick can share
 * the same function without extra conditionals on the caller's
 * side.
 */
export function createRegisterWindow(
	manager: WindowManager,
): ( def: NativeWindowDef ) => DesktopWindow {
	return ( def: NativeWindowDef ) => {
		// `iframeContent` shorthand — the shell synthesises a render
		// callback that builds an iframe + handles the load /
		// postMessage / source-check lifecycle. Plugins that need a
		// non-iframe body still pass `render` directly; the two
		// shapes are mutually exclusive.
		const userRender = def.render;
		let render = userRender;
		const cleanups: ( () => void )[] = [];
		if ( def.iframeContent ) {
			if ( userRender && typeof console !== 'undefined' ) {
				console.warn(
					'[wp-desktop-mode] registerWindow: both `render` and `iframeContent` provided — ignoring `render` and using the iframe shorthand. Drop one.',
				);
			}
			render = buildIframeContentRender(
				def.iframeContent,
				cleanups,
				def.id,
			);
		} else if ( userRender ) {
			// Wrap the user's render callback so it receives the
			// unified window API as its second argument. The wrapper
			// builds a per-call context whose `send` / `on` are
			// scoped to this window's id, so plugin authors get the
			// same shape regardless of whether they're rendering an
			// iframe-content window or a pure-native one.
			render = ( body: HTMLElement ) => {
				const ctx: NativeRenderContext = {
					window: {
						send< T = unknown >( channel: string, payload?: T ): void {
							if ( typeof channel !== 'string' || channel === '' ) {
								return;
							}
							dispatchFromWindow( def.id, channel, payload );
						},
						on< T = unknown >(
							channel: string,
							cb: (
								payload: T,
								meta: { channel: string; windowId: string },
							) => void,
						): () => void {
							if (
								typeof channel !== 'string' ||
								channel === '' ||
								typeof cb !== 'function'
							) {
								return () => undefined;
							}
							return addNativeSubscriber(
								def.id,
								channel,
								cb as WindowChannelCb,
							);
						},
						markLoading(): void {
							markWindowContentLoading( def.id );
						},
						markReady(): void {
							markWindowContentReady( def.id );
						},
					},
				};
				return userRender( body, ctx );
			};
		}

		const userOnClose = def.onClose;
		const onClose: typeof userOnClose = cleanups.length
			? ( () => {
				for ( const fn of cleanups ) {
					try {
						fn();
					} catch {
						/* swallow — don't let cleanup errors block close */
					}
				}
				userOnClose?.();
			} )
			: userOnClose;

		// If the window already exists, manager.open() focuses the
		// existing instance on its own. We still normalise the config
		// so a re-open call doesn't leak the caller's unset size
		// fields into the eventually-opened instance.
		const win = manager.open( {
			id: def.id,
			baseId: def.baseId || def.id,
			native: true,
			url: def.url || `#${ def.id }`,
			title: def.title,
			icon: def.icon,
			x: def.x ?? 0,
			y: def.y ?? 0,
			width: def.width ?? DEFAULT_NATIVE_WIDTH,
			height: def.height ?? DEFAULT_NATIVE_HEIGHT,
			minWidth: def.minWidth ?? DEFAULT_NATIVE_MIN_WIDTH,
			minHeight: def.minHeight ?? DEFAULT_NATIVE_MIN_HEIGHT,
			render,
			onClose,
			onResize: def.onResize,
			autofocus: def.autofocus,
			initialState: def.initialState,
			ownerHandle: def.ownerHandle,
			multi: def.multi,
			desktopId: def.desktopId,
		} );

		return win;
	};
}

/**
 * Clone the contents of a `<template>` element and return the
 * resulting `DocumentFragment`.
 *
 * **Native-window authors don't usually call this.** The shell pre-
 * clones the registered template into the window body before
 * invoking the render callback — see {@link RenderCallback}. Reach
 * for `cloneTemplate` only when you need to re-clone (per-row list
 * templates, dynamic hydration outside the standard pipeline).
 *
 * Accepts either a DOM id string or a template element directly,
 * so callers that already hold a reference don't double-lookup.
 * Throws when the id doesn't resolve or the element isn't a
 * `<template>` — templates are declarative and a missing one
 * almost always signals a markup bug worth surfacing.
 *
 * @public
 */
/**
 * Subscribe to a window's lifecycle events by id. Returns an
 * unsubscribe function that removes every listener it installed,
 * AND auto-unsubscribes once the window closes (so most callers
 * don't have to hold onto the return value).
 *
 * Lets plugins write:
 *
 * ```ts
 * wp.desktop.onWindow( 'calc', {
 *   opened:  () => trackOpen(),
 *   closed:  () => trackClose(),
 *   resized: ( { width, height } ) => relayout( width, height ),
 * } );
 * ```
 *
 * Instead of:
 *
 * ```ts
 * wp.hooks.addAction( HOOKS.WINDOW_RESIZED, 'plugin/resized', ( p ) => {
 *   if ( p.windowId === 'calc' ) { ... }
 * } );
 * // ... × N
 * ```
 *
 * Each listener is registered under a deterministic namespace
 * (`wp-desktop-mode/on-window/<id>/<instance>`) so two concurrent
 * `onWindow( 'calc', … )` calls don't clobber each other. The
 * instance counter is module-local.
 *
 * Idempotent: calling the returned unsubscribe twice is safe.
 *
 * @public
 */
/**
 * Optional flags for {@link onWindow}.
 *
 * @since 0.5.5
 */
export interface OnWindowOptions {
	/**
	 * Default `false` — `onWindow` auto-unsubscribes after the
	 * window's `closed` handler runs, matching the "one-shot per
	 * window instance" use case (a plugin hooking a particular
	 * open/close cycle, e.g. an undo toast that vanishes once
	 * the window closes).
	 *
	 * Set `persistent: true` for app-level subscriptions that
	 * should survive every open/close cycle for the lifetime of
	 * the page — badge policies, toast suppression rules, anything
	 * that needs to react every time the window comes back. Without
	 * this flag, your handler stops firing after the first close
	 * and you spend a half hour debugging.
	 */
	persistent?: boolean;
}

let onWindowInstanceCounter = 0;
export function onWindow(
	id: string,
	handlers: WindowLifecycleHandlers,
	options: OnWindowOptions = {},
): () => void {
	const namespace = `wp-desktop-mode/on-window/${ id }/${ ++onWindowInstanceCounter }`;
	const persistent = options.persistent === true;

	// Map each handler slot onto the corresponding hook name + a
	// windowId-filter-and-dispatch wrapper. Kept declarative so the
	// table stays easy to audit / extend when new hooks land.
	const bindings: Array< [ keyof WindowLifecycleHandlers, string ] > = [
		[ 'opened', HOOKS.WINDOW_OPENED ],
		[ 'reopened', HOOKS.WINDOW_REOPENED ],
		[ 'focused', HOOKS.WINDOW_FOCUSED ],
		[ 'blurred', HOOKS.WINDOW_BLURRED ],
		[ 'closing', HOOKS.WINDOW_CLOSING ],
		[ 'closed', HOOKS.WINDOW_CLOSED ],
		[ 'minimized', HOOKS.WINDOW_MINIMIZED ],
		[ 'restored', HOOKS.WINDOW_RESTORED ],
		[ 'maximized', HOOKS.WINDOW_MAXIMIZED ],
		[ 'unmaximized', HOOKS.WINDOW_UNMAXIMIZED ],
		[ 'fullscreenEntered', HOOKS.WINDOW_FULLSCREEN_ENTERED ],
		[ 'fullscreenExited', HOOKS.WINDOW_FULLSCREEN_EXITED ],
		[ 'resized', HOOKS.WINDOW_RESIZED ],
		[ 'bodyResized', HOOKS.WINDOW_BODY_RESIZED ],
		[ 'boundsChanged', HOOKS.WINDOW_BOUNDS_CHANGED ],
	];

	const registered: string[] = [];
	let disposed = false;

	const unsubscribe = (): void => {
		if ( disposed ) {
			return;
		}
		disposed = true;
		for ( const hookName of registered ) {
			removeAction( hookName, namespace );
		}
	};

	for ( const [ key, hookName ] of bindings ) {
		const handler = handlers[ key ];
		if ( ! handler ) {
			continue;
		}
		registered.push( hookName );
		addAction( hookName, namespace, ( payload: unknown ) => {
			const p = payload as { windowId?: string } & Record< string, unknown >;
			if ( p.windowId !== id ) {
				return;
			}
			// Strip the windowId before handing to the handler —
			// it's already implied by the scope.
			const { windowId: _w, ...rest } = p;
			( handler as ( x: unknown ) => void )( rest );
			// Auto-unsubscribe after `closed` so subscribers who
			// installed a one-shot listener per window instance
			// don't leak. Plugins that want app-lifetime
			// subscriptions (badge policies, suppression rules)
			// pass `{ persistent: true }` to opt out — the handler
			// then keeps firing across every open/close cycle.
			if ( key === 'closed' && ! persistent ) {
				unsubscribe();
			}
		} );
	}

	return unsubscribe;
}

/**
 * Sync the shell's native-window system tiles to a server-supplied
 * list. Diffs the current registry against the payload and:
 *
 *   - Removes tiles whose entry disappeared from the list (plugin
 *     was deactivated).
 *   - Adds tiles for entries that are new (plugin was activated,
 *     or the shell is booting with a non-empty initial list).
 *
 * Boot-time calls and live-refresh calls share one code path. For
 * new entries, if the corresponding `<template>` isn't already in
 * the DOM (mid-session activation) we inject it from the payload's
 * `templateHtml`; ditto for the plugin script via
 * `loadVendorScript( entry.scriptUrl )`. Once the script loads the
 * plugin registers a render callback on
 * `window.wpDesktopNativeWindows[ id ]`, which the shell invokes
 * when the tile opens its window.
 *
 * Mutually exclusive with the legacy JS-only path (a plugin calling
 * `wp.desktop.registerSystemTile` directly). Plugins that use
 * `desktop_mode_register_window()` get this automatic lifecycle;
 * plugins that stick to the JS-only path self-manage their tiles.
 *
 * @public
 * @since 0.10.0
 */
export interface NativeWindowRegistryDeps {
	manager: WindowManager;
	dock: Dock | null;
	taskbar: Dock | null;
	taskbarEl: HTMLElement | null;
	desktopArea: HTMLElement;
}

/**
 * Render callback contract for native desktop windows.
 *
 * When the window opens, the shell clones the registered `<template>`
 * into `body`, then invokes the callback. Implementations enhance:
 * query for mount points the template declared (data attributes, ids,
 * classes) and light them up. To start from a blank canvas, call
 * `body.replaceChildren()` first.
 *
 * @public
 */
type RenderCallback = ( body: HTMLElement ) => void | ( () => void );

interface NativeWindowGlobals {
	wpDesktopNativeWindows?: Record< string, RenderCallback | undefined >;
}

/**
 * Build a `syncNativeWindows( list )` closure bound to the shell
 * instance. Keeps per-shell state (which ids we've registered,
 * which templates we injected, which scripts we loaded) in the
 * closure rather than module globals so tests can mount multiple
 * shells in sequence cleanly.
 */
/**
 * Public surface of {@link createNativeWindowSync}.
 *
 * @public
 */
export interface NativeWindowSync {
	/**
	 * Reconcile the dock/taskbar tiles to a server-supplied list.
	 * Adds tiles for new entries, removes tiles whose entry has
	 * disappeared. Idempotent.
	 */
	sync: ( list: NativeWindowServerEntry[] ) => Promise< void >;
	/**
	 * Open a registered native window by id. Used by entry points
	 * that don't go through the dock — desktop icons on the
	 * wallpaper, programmatic API calls, AI commands, etc. Returns
	 * `false` when the id isn't registered (the window opener silently
	 * no-ops, the caller decides what to do — usually nothing, since
	 * the icon/command would be hidden in the same refresh cycle).
	 *
	 * Goes through the same `openFromEntry` path as the dock click,
	 * so the body always has the cloned template before the render
	 * callback fires. **Do not duplicate this elsewhere.**
	 */
	openById: ( id: string ) => boolean;
}

export function createNativeWindowSync(
	deps: NativeWindowRegistryDeps,
): NativeWindowSync {
	const { manager, dock, taskbar, taskbarEl, desktopArea } = deps;

	const registered = new Set< string >();
	const injectedTemplates = new Set< string >();
	const loadedScripts = new Set< string >();
	// Entry index — `openById` reaches in here when the desktop-icon
	// or AI-command paths request "open whatever's registered as <id>".
	// Always reflects the most recent sync.
	const entriesById = new Map< string, NativeWindowServerEntry >();

	const ensureTaskbarVisible = (): void => {
		if ( taskbarEl && taskbarEl.hidden ) {
			taskbarEl.hidden = false;
			desktopArea.classList.add( 'wp-desktop-area--with-taskbar' );
		}
	};

	const ensureTemplate = ( entry: NativeWindowServerEntry ): void => {
		if ( injectedTemplates.has( entry.templateId ) ) {
			return;
		}
		// The server-rendered admin_footer already wrote the
		// template for plugins active at boot — skip re-injection
		// in that case so we don't double up.
		if ( document.getElementById( entry.templateId ) ) {
			injectedTemplates.add( entry.templateId );
			return;
		}
		if ( ! entry.templateHtml ) {
			return;
		}
		const tpl = document.createElement( 'template' );
		tpl.id = entry.templateId;
		tpl.innerHTML = entry.templateHtml;
		document.body.appendChild( tpl );
		injectedTemplates.add( entry.templateId );
	};

	const ensureScript = async (
		entry: NativeWindowServerEntry,
	): Promise< void > => {
		if ( ! entry.scriptUrl || loadedScripts.has( entry.scriptUrl ) ) {
			return;
		}
		try {
			await loadVendorScript( entry.scriptUrl );
		} catch ( err ) {
			// Load failed — surface via SHELL_ERROR. The tile will
			// still render + open, but the window's body will only
			// get the bare template (no interactive render
			// callback). Better than blocking the whole sync.
			doAction( HOOKS.SHELL_ERROR, {
				scope: 'native-window-script-load',
				id: entry.id,
				error: err,
			} );
		}
		loadedScripts.add( entry.scriptUrl );
	};

	const openFromEntry = ( entry: NativeWindowServerEntry ): void => {
		const globalRegistry =
			( window as unknown as NativeWindowGlobals ).wpDesktopNativeWindows ||
			{};
		const render = globalRegistry[ entry.id ];

		// Pre-populate the window body with the cloned template, then
		// hand it to the optional render callback. The render contract
		// is enhancement: declare static markup in `template`, query
		// the body for mount points in render, light them up. Without
		// a render callback the cloned template IS the window —
		// declarative-only plugins need zero JS.
		//
		// `cloneTemplate` throws (and console.errors) when the
		// template element is missing — let it surface; a missing
		// template is a developer error worth seeing, not silencing.
		const finalRender: RenderCallback = ( body ) => {
			body.appendChild( cloneTemplate( entry.templateId ) );
			// Forward the optional teardown returned by the plugin's
			// render callback so the Window class can invoke it on
			// close. Without this `return`, the teardown was silently
			// discarded — plugins had no reliable cleanup hook for
			// native windows.
			return render?.( body );
		};

		manager.open( {
			id: entry.id,
			baseId: entry.id,
			native: true,
			url: `#${ entry.id }`,
			title: entry.title,
			icon: entry.icon,
			x: 0,
			y: 0,
			width: entry.width,
			height: entry.height,
			minWidth: entry.minWidth,
			minHeight: entry.minHeight,
			render: finalRender,
			autofocus: entry.autofocus,
			ownerHandle: entry.ownerHandle || entry.scriptHandle,
		} );
	};

	const registerTile = async (
		entry: NativeWindowServerEntry,
	): Promise< void > => {
		if ( registered.has( entry.id ) ) {
			return;
		}
		if ( 'none' === entry.placement ) {
			// Plugin declared a window but opted out of a tile —
			// shell still processes the template + script so the
			// plugin can open the window programmatically via
			// `wp.desktop.windowManager.open()`. Nothing to
			// register on the rails.
			ensureTemplate( entry );
			await ensureScript( entry );
			registered.add( entry.id );
			return;
		}

		ensureTemplate( entry );
		await ensureScript( entry );

		const rail = 'dock' === entry.placement ? dock : taskbar;
		if ( ! rail ) {
			// Rail element missing (old shell markup) — fall back
			// to dock to keep the tile visible.
			dock?.appendSystemItem( {
				id: entry.id,
				title: entry.title,
				icon: entry.icon,
				isOpen: () => !! manager.getById( entry.id ),
				onOpen: () => openFromEntry( entry ),
			} );
		} else {
			rail.appendSystemItem( {
				id: entry.id,
				title: entry.title,
				icon: entry.icon,
				isOpen: () => !! manager.getById( entry.id ),
				onOpen: () => openFromEntry( entry ),
			} );
			if ( rail === taskbar ) {
				ensureTaskbarVisible();
			}
		}

		doAction( HOOKS.DOCK_ITEM_APPENDED, {
			id: entry.id,
			placement: 'dock' === entry.placement ? 'dock' : 'taskbar',
		} );

		registered.add( entry.id );
	};

	const unregisterTile = ( id: string ): void => {
		if ( ! registered.has( id ) ) {
			return;
		}
		dock?.removeSystemItem( id );
		taskbar?.removeSystemItem( id );
		registered.delete( id );
		entriesById.delete( id );
	};

	const sync = async ( list: NativeWindowServerEntry[] ) => {
		const incoming = new Set< string >();
		for ( const entry of list ) {
			incoming.add( entry.id );
			// Refresh the index every sync so `openById` always
			// reflects the latest payload (a plugin update can
			// change a window's title / dimensions / template
			// without touching the dock-tile lifecycle).
			entriesById.set( entry.id, entry );
		}

		// Removals first — if the plugin reactivates with the same
		// id in the same session we want the old tile gone before
		// the new one lands so we don't double-insert.
		for ( const id of Array.from( registered ) ) {
			if ( ! incoming.has( id ) ) {
				unregisterTile( id );
			}
		}

		// Additions — await sequentially so script-load order is
		// deterministic (helps plugins that share a vendor bundle
		// and race to define globals).
		for ( const entry of list ) {
			if ( ! registered.has( entry.id ) ) {
				await registerTile( entry );
			}
		}
	};

	const openById = (
		id: string,
		opts: { source?: string } = {},
	): boolean => {
		const entry = entriesById.get( id );
		if ( ! entry ) {
			return false;
		}
		// Publish "user / caller asked to open this window" BEFORE
		// the manager decides between creating a new instance and
		// focusing the existing one. Plugins doing analytics, DND,
		// or "show coachmark on first open" hook this independent
		// of the WINDOW_OPENED / WINDOW_REOPENED branch the
		// framework will take next.
		activity.publish( 'wp-desktop/open-requested', {
			windowId: id,
			source: opts.source ?? 'api',
		} );
		openFromEntry( entry );
		return true;
	};

	return { sync, openById };
}

export function cloneTemplate(
	template: string | HTMLTemplateElement,
): DocumentFragment {
	let tpl: HTMLTemplateElement | null = null;
	if ( typeof template === 'string' ) {
		const found = document.getElementById( template );
		if ( found instanceof HTMLTemplateElement ) {
			tpl = found;
		}
	} else {
		tpl = template;
	}
	if ( ! tpl ) {
		throw new Error(
			`[wp-desktop-mode] cloneTemplate: no <template> found for ${
				typeof template === 'string' ? `#${ template }` : '<reference>'
			}`,
		);
	}
	return tpl.content.cloneNode( true ) as DocumentFragment;
}
