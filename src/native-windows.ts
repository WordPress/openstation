/**
 * Helpers for plugins that register native (non-iframe) windows.
 *
 * Two convenience wrappers land here:
 *
 *   - {@link createRegisterWindow} → `wp.os.registerWindow()`.
 *     Wraps `windowManager.open()` with sensible native defaults so
 *     plugin authors don't have to re-declare the same scaffolding
 *     every time: `native: true`, fallback `url` (`#<id>`), minimum
 *     size defaults, and a warning-free id derivation when the
 *     caller omits `baseId`.
 *
 *   - {@link cloneTemplate} → a tiny `<template>` cloner. The shell
 *     uses it internally to populate every native window's body with
 *     the registered template before invoking the render callback,
 *     so plugin authors using `openstation_register_window()` don't
 *     touch this directly. Exported for advanced cases that want to
 *     re-clone (e.g. dynamic per-row templates, custom hydration
 *     flows outside the standard pipeline).
 *
 * Both are intentionally thin — they don't introduce new runtime
 * state. Plugins that outgrow them can always call the underlying
 * APIs directly.
 */

import { activity } from './activity';
import { HOOKS, addAction, doAction, removeAction } from './hooks';
import { isMobileStamped } from './mode/stamp';
import { injectInlineScript, loadVendorScript } from './wallpapers/vendor-loader';
import { registerSyntheticIframe } from './connection';
import { setPanelTabs } from './window/tab-strip';
import {
	loadNativeWindowGeometry,
	saveNativeWindowGeometry,
	saveNativeWindowPosition,
	setNativeWindowSavedState,
} from './window-manager/native-window-geometry';
import type { SystemDockItem } from './dock';
import type {
	NativeRenderContext,
	NativeWindowCompanionScript,
	NativeWindowDef,
	NativeWindowIframeContent,
	NativeWindowScriptData,
	NativeWindowServerEntry,
	NativeWindowTabEntry,
	NativeWindowWireEntry,
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
 */
export interface WindowLifecycleHandlers {
	opened?: () => void;
	/**
	 * `wp.os.openWindow(id)` was called for an already-open
	 * instance — the plugin's render callback won't run again, but
	 * the user/caller is asking to "show this window". A typical
	 * use is to re-orient content (focus a tab, scroll to a row).
	 * Payload mirrors the `WINDOW_REOPENED` action: `{ baseId,
	 * wasMinimized, navigated }`. `navigated` is
	 * `true` when the open request carried a URL the window wasn't
	 * already showing and the framework navigated the existing
	 * iframe to it in place; always `false` for native windows.
	 */
	reopened?: ( payload: {
		baseId: string;
		wasMinimized: boolean;
		navigated?: boolean;
	} ) => void;
	focused?: () => void;
	/**
	 * Window lost focus to another window. Payload: `{ focusedTo }` —
	 * the id of the window that took over (so subscribers can
	 * decide whether the blur transitions to a peer they care
	 * about).
	 */
	blurred?: ( payload: { focusedTo: string | null } ) => void;
	closing?: ( payload: { element: HTMLElement } ) => void;
	closed?: () => void;
	minimized?: () => void;
	restored?: () => void;
	maximized?: () => void;
	/** Fires when the window leaves maximized state. */
	unmaximized?: () => void;
	/** Fires when the window enters fullscreen / focus mode. */
	fullscreenEntered?: () => void;
	/** Fires when the window exits fullscreen / focus mode. */
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
 * Module-local counter that keeps every per-window hook subscription
 * under a unique namespace — avoids collisions when the same id is
 * opened, closed, and reopened in the same session.
 */
let _ctxInstance = 0;

/**
 * Build the per-render `NativeRenderContext` plus a `dispose` that
 * unwires every subscription it created and aborts the close-bound
 * `signal`.
 *
 * Both the JS-side `createRegisterWindow` path and the PHP-side
 * `openFromEntry` path go through this builder, so plugin authors
 * see the same shape no matter which entry point registered the
 * window.
 *
 * @internal
 */
function buildNativeRenderContext(
	windowId: string,
	params: Record< string, string | number | boolean > = {},
): {
	ctx: NativeRenderContext;
	dispose: () => void;
} {
	const instance = ++_ctxInstance;
	const ns = ( label: string ): string =>
		`desktop-mode/native-render-ctx/${ windowId }/${ instance }/${ label }`;

	const controller = new AbortController();
	const teardowns: Array< () => void > = [];

	const subscribeWindowed = (
		hookName: string,
		label: string,
		match: ( payload: unknown ) => boolean,
		invoke: ( payload: unknown ) => void,
	): ( () => void ) => {
		const namespace = ns( label );
		addAction( hookName, namespace, ( payload: unknown ) => {
			if ( match( payload ) ) {
				invoke( payload );
			}
		} );
		const off = (): void => {
			removeAction( hookName, namespace );
		};
		teardowns.push( off );
		return off;
	};

	const matchByWindowId = ( payload: unknown ): boolean =>
		!! payload &&
		typeof payload === 'object' &&
		( payload as { windowId?: string } ).windowId === windowId;

	const ctx: NativeRenderContext = {
		window: {
			send< T = unknown >( channel: string, payload?: T ): void {
				if ( typeof channel !== 'string' || channel === '' ) {
					return;
				}
				dispatchFromWindow( windowId, channel, payload );
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
					windowId,
					channel,
					cb as WindowChannelCb,
				);
			},
			markLoading(): void {
				markWindowContentLoading( windowId );
			},
			markReady(): void {
				markWindowContentReady( windowId );
			},
		},
		markLoading(): void {
			markWindowContentLoading( windowId );
		},
		markReady(): void {
			markWindowContentReady( windowId );
		},
		signal: controller.signal,
		onResize( cb ) {
			if ( typeof cb !== 'function' ) {
				return () => undefined;
			}
			return subscribeWindowed(
				HOOKS.WINDOW_BODY_RESIZED,
				'on-resize',
				matchByWindowId,
				( payload ) => {
					const { width, height } = payload as {
						width: number;
						height: number;
					};
					try {
						cb( width, height );
					} catch ( err ) {
						doAction( HOOKS.SHELL_ERROR, {
							scope: 'native-render-ctx/onResize',
							id: windowId,
							error: err,
						} );
					}
				},
			);
		},
		onHide( cb ) {
			if ( typeof cb !== 'function' ) {
				return () => undefined;
			}
			return subscribeWindowed(
				HOOKS.WINDOW_MINIMIZED,
				'on-hide',
				matchByWindowId,
				() => {
					try {
						cb();
					} catch ( err ) {
						doAction( HOOKS.SHELL_ERROR, {
							scope: 'native-render-ctx/onHide',
							id: windowId,
							error: err,
						} );
					}
				},
			);
		},
		onShow( cb ) {
			if ( typeof cb !== 'function' ) {
				return () => undefined;
			}
			return subscribeWindowed(
				HOOKS.WINDOW_RESTORED,
				'on-show',
				matchByWindowId,
				() => {
					try {
						cb();
					} catch ( err ) {
						doAction( HOOKS.SHELL_ERROR, {
							scope: 'native-render-ctx/onShow',
							id: windowId,
							error: err,
						} );
					}
				},
			);
		},
		params,
	};

	const dispose = (): void => {
		// Abort first so any in-flight `fetch( …, { signal } )` sees
		// the close before the user's render-returned teardown runs.
		try {
			controller.abort();
		} catch {
			/* AbortController.abort throws on some polyfills — ignore. */
		}
		while ( teardowns.length ) {
			const off = teardowns.pop();
			try {
				off?.();
			} catch {
				/* swallow — never let one bad listener block the rest */
			}
		}
	};

	return { ctx, dispose };
}

/**
 * Public re-export of {@link buildNativeRenderContext} for the
 * Window class's `hydrateNative()` — the single point inside the
 * framework that invokes `config.render(body)` for native windows.
 * Centralising the ctx build there means every code path
 * (`wp.os.registerWindow`, PHP-registered windows, direct
 * `manager.open({ native: true, render })`) gets the same ctx
 * shape without each call site re-implementing the wiring.
 *
 * @internal
 */
export { buildNativeRenderContext as _buildNativeRenderContext };

/**
 * Resolve the id of the window a native render callback is mounting
 * into, by walking up from the body element to the window root
 * (`id="wp-window-<windowId>"`, stamped by `createWindowElement`).
 *
 * `Window.hydrateNative()` runs AFTER the element is appended to the
 * desktop, so by render time the ancestry is always present — the
 * `fallback` only covers a detached body (a unit test rendering into
 * a bare `<div>`, a future code path that pre-renders off-DOM).
 *
 * The same `wp-window-` walk backs `os-file-drop/manager.ts` and
 * `drag/iframe-drop-targets.ts`; this is the id-of-record for
 * anything that has a DOM node but not a `Window` reference.
 *
 * @internal
 */
function resolveMountedWindowId(
	body: HTMLElement,
	fallback: string,
): string {
	const root = body.closest< HTMLElement >( '[id^="wp-window-"]' );
	const id = root?.id.slice( 'wp-window-'.length );
	return id ? id : fallback;
}

/**
 * Synthesise a `render( body )` callback that renders an iframe
 * inside the native window's body and manages its lifecycle:
 *
 *   - Creates the `<iframe>` with the configured URL + sandbox.
 *   - On the iframe's `load` event, marks the window content ready
 *     (flushing any `Window.send()` payloads queued before load in
 *     FIFO order) and resolves the promise the shell awaits before
 *     clearing the window's loading state. Readiness needs no
 *     callback from the plugin.
 *   - Listens for `message` events whose `event.source` matches
 *     the iframe's `contentWindow` (the source-check every plugin
 *     would otherwise reinvent) and forwards `event.data` to
 *     `onMessage`.
 *   - When `bridge: true` AND the iframe is same-origin, injects
 *     the public iframe-side bridge script via `<script>` so the
 *     iframe can `wp.os.iframe.publish/subscribe/
 *     onConnection/requestConnection` without enqueueing the
 *     bridge handle itself.
 *
 * Listener + iframe are torn down via the parent window's `onClose`
 * — wired in by `createRegisterWindow` below so the plugin's own
 * `onClose` also runs.
 *
 * `registeredId` is the id the PLUGIN asked for, which is NOT
 * necessarily the id the window ends up with — `manager.open()`
 * suffixes it (`chat` → `chat-2`) whenever an instance of the same
 * baseId is already open on another virtual desktop, and `openNew`
 * always does. Every id-keyed call below therefore resolves the LIVE
 * instance id off the mounted DOM instead (see
 * {@link resolveMountedWindowId}); `registeredId` is only the
 * fallback for the theoretical case where the body isn't inside a
 * window root yet.
 *
 * @internal
 */
function buildIframeContentRender(
	cfg: NativeWindowIframeContent,
	cleanups: ( () => void )[],
	registeredId: string,
): ( body: HTMLElement ) => Promise< void > {
	return ( body: HTMLElement ) => {
		const windowId = resolveMountedWindowId( body, registeredId );
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
		// Without this, `wp.os.connect( id ).send( … )` would
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
					if ( doc && ! doc.querySelector( 'script[data-os-iframe-bridge]' ) ) {
						const bridgeUrl = (
							window as unknown as {
								openStationConfig?: { iframeBridgeUrl?: string };
							}
						).openStationConfig?.iframeBridgeUrl;
						if ( bridgeUrl ) {
							const s = doc.createElement( 'script' );
							s.src = bridgeUrl;
							s.setAttribute( 'data-os-iframe-bridge', '1' );
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
		// Bridge-prefixed messages (`os-bridge-*`) are also
		// forwarded into the connection registry so this iframe can
		// participate in `wp.os.connect()` traffic — the
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
				( data as { type: string } ).type.startsWith( 'os-bridge-' )
			) {
				const bridgeRouter = (
					window as unknown as {
						__openStationConnectionBridge?: {
							routeIncomingFromIframe(
								d: unknown,
								fromWindowId?: string,
							): void;
						};
					}
				).__openStationConnectionBridge;
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
				( data as { type?: string } ).type === 'os-window-publish' &&
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
						'[openstation] iframeContent.onMessage threw:',
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
 * `wp.os.registerWindow`.
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
): ( def: NativeWindowDef ) => Promise< DesktopWindow > {
	return async ( def: NativeWindowDef ) => {
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
					'[openstation] registerWindow: both `render` and `iframeContent` provided — ignoring `render` and using the iframe shorthand. Drop one.',
				);
			}
			render = buildIframeContentRender(
				def.iframeContent,
				cleanups,
				def.id,
			);
		}
		// Note: the ctx-wrapping (channel API + signal + onResize /
		// onHide / onShow) used to live here as a wrapper around the
		// user's render. It moved into `Window.hydrateNative()` in
		// 0.8.2 so EVERY code path that opens a native window —
		// `wp.os.registerWindow`, PHP-registered windows, direct
		// `manager.open({ native: true, render })` — gets the same
		// shape without each call site re-implementing the wiring.
		// `userRender` therefore reaches `manager.open()` unchanged
		// here; the Window class wraps it at hydration time.

		const userOnClose = def.onClose;
		// Wrap on "this def CAN produce cleanups", never on
		// `cleanups.length`. The array is populated by the synthesised
		// render callback, which doesn't run until `manager.open()`
		// below hydrates the window — so at this point it is always
		// empty and the length check wrapped nothing. Every
		// `iframeContent` window therefore leaked: its synthetic-iframe
		// registration outlived the close (a stale `_syntheticIframes`
		// entry pointing at a detached iframe, which the next instance
		// of the same id would then find instead of its own), and its
		// `message` listener stayed on `window` for the rest of the
		// session.
		const onClose: typeof userOnClose = def.iframeContent
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
		const win = await manager.open( {
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
 * wp.os.onWindow( 'calc', {
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
 * (`desktop-mode/on-window/<id>/<instance>`) so two concurrent
 * `onWindow( 'calc', … )` calls don't clobber each other. The
 * instance counter is module-local.
 *
 * Idempotent: calling the returned unsubscribe twice is safe.
 *
 * @public
 */
/**
 * Optional flags for {@link onWindow}.
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
	const namespace = `desktop-mode/on-window/${ id }/${ ++onWindowInstanceCounter }`;
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
 * `window.openStationNativeWindows[ id ]`, which the shell invokes
 * when the tile opens its window.
 *
 * Mutually exclusive with the legacy JS-only path (a plugin calling
 * `wp.os.registerSystemTile` directly). Plugins that use
 * `openstation_register_window()` get this automatic lifecycle;
 * plugins that stick to the JS-only path self-manage their tiles.
 *
 * @public
 */
export interface NativeWindowRegistryDeps {
	manager: WindowManager;
	/**
	 * Append a JS-owned tile to the bottom dock rail. Plugin-registered
	 * native windows hand their tile here; the layout dispatcher tracks
	 * the registration so it survives a layout rebuild without the sync
	 * having to re-run.
	 */
	appendSystemTile: ( item: SystemDockItem ) => void;
	/** Remove a previously-appended system tile by id. */
	removeSystemTile: ( id: string ) => void;
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
 * The optional second argument is a {@link NativeRenderContext} carrying
 * window-scoped helpers — `signal` (fires on close), `onResize`,
 * `onHide`, `onShow`, `markLoading`, `markReady`, plus the nested
 * `window.send/on` channel API. Existing unary callbacks
 * (`( body ) => …`) keep working — `ctx` is detected by arity, never
 * required.
 *
 * @public
 */
type RenderCallback = (
	body: HTMLElement,
	ctx?: NativeRenderContext,
) => void | ( () => void ) | Promise< void | ( () => void ) >;

interface NativeWindowGlobals {
	openStationNativeWindows?: Record< string, RenderCallback | undefined >;
	/**
	 * Deprecated legacy registry bag. Extension bundles built before
	 * the rename (cron-manager, code-editor, phpMyAdmin) register
	 * their render callbacks here; the shell merges it at read time
	 * so those windows stay interactive. New code must register on
	 * `openStationNativeWindows`.
	 *
	 * Deliberately keeps its pre-rebrand spelling: the whole point of
	 * the bag is to match what already-built bundles write.
	 */
	wpDesktopNativeWindows?: Record< string, RenderCallback | undefined >;
}

/**
 * Resolve the render-callback registry, merging the deprecated
 * `wpDesktopNativeWindows` bag under the canonical
 * `openStationNativeWindows` one (canonical wins on id collisions).
 *
 * Merged at every read — not copied once at load — because some
 * legacy bundles rewrite their entry after the bundle executes
 * (e.g. cron-manager's whenDefined wrapper), so a boot-time copy
 * would capture a stale callback.
 */
function readGlobalRegistry(): Record< string, RenderCallback | undefined > {
	const g = window as unknown as NativeWindowGlobals;
	return {
		...( g.wpDesktopNativeWindows || {} ),
		...( g.openStationNativeWindows || {} ),
	};
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
	 * Reconcile the dock tiles to a server-supplied list.
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
	openById: (
		id: string,
		opts?: {
			source?: string;
			params?: Record< string, string | number | boolean >;
		},
	) => boolean;

	/**
	 * Spawn a BRAND-NEW instance of a registered native window — even
	 * when one is already open. Mirrors {@link openById} but routes
	 * through `manager.openNew()` so the new window gets a fresh
	 * instance id (`<base>-2`, `<base>-3`, …) and the cloned template
	 * + render callback fire against the new body.
	 *
	 * Used by the dock-peek "+" button and the window menu's "Open
	 * another" affordance so native windows behave like iframe
	 * windows do: every "+" yields a duplicate, not a focus-existing.
	 *
	 * Returns `false` when the id isn't registered.
	 */
	openNewById: (
		id: string,
		opts?: {
			source?: string;
			params?: Record< string, string | number | boolean >;
		},
	) => boolean;

	/**
	 * Load a registered native window's bundle (companions first,
	 * then the window's own script) WITHOUT opening the window.
	 *
	 * Native-window bundles load on first open. That covers the
	 * windows themselves, but not the second thing some of them do:
	 * publish an API on `wp.os` that another bundle calls with no
	 * window in sight — `wp.os.myWordpress.trashEntity()` from a
	 * drop on the recycle bin, say. Those call sites await this
	 * first, then read the API.
	 *
	 * Resolves `true` once the bundle is in the tab (immediately on
	 * a repeat call), `false` when the id isn't registered. A load
	 * FAILURE also resolves `true` — the script tag was attempted
	 * and reported through `SHELL_ERROR`; the caller's own "is the
	 * API there?" check is the honest test of whether it worked.
	 */
	loadScriptById: ( id: string ) => Promise< boolean >;
}

/**
 * Declare a server-registered native window's tabs in the window
 * chrome.
 *
 * The panes are server-rendered into the template (one
 * `<os-tabpanel>` per registered tab); the strip that drives them is
 * the shell's, in the chrome, the same one an admin-page window
 * wears. The metadata to build it already rides the payload, so a
 * plugin using `openstation_register_window_tab()` needs no JS for
 * this at all.
 *
 * Single-tab windows are left alone: PHP emits their template bare,
 * with no panes to switch between and so no strip to build.
 */
function declareServerTabs(
	body: HTMLElement,
	entry: NativeWindowServerEntry,
): void {
	const tabs = entry.tabs;
	if ( ! Array.isArray( tabs ) || tabs.length < 2 ) {
		return;
	}
	const winEl = body.closest< HTMLElement >( '.os-window' );
	if ( ! winEl ) {
		return;
	}
	setPanelTabs(
		winEl,
		tabs.map( ( tab ) => ( { value: tab.value, label: tab.label } ) ),
		// The window's own template is the pane that opens.
		tabs.find( ( tab ) => tab.isMain )?.value,
	);
}

/**
 * Join wire-format native-window entries with the handle-keyed
 * script-data map into the full entries the sync consumes.
 *
 * The payload ships script data ONCE per handle
 * (`nativeWindowScriptData`) because several windows share one
 * bundle — every App Framework window rides the one
 * `openstation-app-runtime` handle, and inlining each entry's
 * resolved copy serialized the same blobs once per window. Entries reference
 * handles; this join puts the resolved url / inline data back on
 * each entry, companions and tabs included.
 *
 * Tolerant of the OLD inline format on purpose: a live session that
 * predates the split can receive a bridge payload from a newer
 * server (or vice versa during a deploy), so an entry that still
 * carries its own resolved fields — or companion OBJECTS rather
 * than handle strings — passes through untouched.
 */
export function hydrateServerEntries(
	entries: NativeWindowWireEntry[],
	scriptData?: NativeWindowScriptData,
): NativeWindowServerEntry[] {
	const data = scriptData ?? {};
	return entries.map( ( entry ) => {
		const own = entry.scriptHandle ? data[ entry.scriptHandle ] : undefined;

		const companions: NativeWindowCompanionScript[] = [];
		for ( const companion of entry.companionScripts ?? [] ) {
			if ( typeof companion !== 'string' ) {
				companions.push( companion );
				continue;
			}
			const resolved = data[ companion ];
			if ( ! resolved?.url ) {
				continue;
			}
			companions.push( {
				scriptUrl: resolved.url,
				scriptHandle: companion,
				scriptBefore: resolved.before,
				scriptAfter: resolved.after,
				scriptL10n: resolved.l10n,
				scriptTranslations: resolved.translations,
			} );
		}

		const tabs: NativeWindowTabEntry[] = ( entry.tabs ?? [] ).map(
			( tab ) => {
				if ( typeof tab.scriptUrl === 'string' ) {
					return tab as NativeWindowTabEntry;
				}
				const resolved = tab.scriptHandle
					? data[ tab.scriptHandle ]
					: undefined;
				return {
					...tab,
					scriptUrl: resolved?.url ?? '',
					scriptBefore: resolved?.before,
					scriptAfter: resolved?.after,
					scriptL10n: resolved?.l10n,
					scriptTranslations: resolved?.translations,
				};
			},
		);

		return {
			...entry,
			scriptUrl: entry.scriptUrl ?? own?.url ?? '',
			scriptBefore: entry.scriptBefore ?? own?.before,
			scriptAfter: entry.scriptAfter ?? own?.after,
			scriptL10n: entry.scriptL10n ?? own?.l10n,
			scriptTranslations: entry.scriptTranslations ?? own?.translations,
			companionScripts: companions,
			tabs,
		};
	} );
}

export function createNativeWindowSync(
	deps: NativeWindowRegistryDeps,
): NativeWindowSync {
	const { manager, appendSystemTile, removeSystemTile } = deps;

	const registered = new Set< string >();
	const injectedTemplates = new Set< string >();
	const loadedScripts = new Set< string >();
	/** URL → in-flight load, so concurrent opens share one `<script>`. */
	const inflightScripts = new Map< string, Promise< void > >();
	const loadedStyles = new Set< string >();
	// Entry index — `openById` reaches in here when the desktop-icon
	// or AI-command paths request "open whatever's registered as <id>".
	// Always reflects the most recent sync.
	const entriesById = new Map< string, NativeWindowServerEntry >();

	/**
	 * Resolve the size to open a native window at, preferring the
	 * user's last manually-resized dimensions over the registered
	 * defaults. Clamps to the registered `minWidth` / `minHeight` so
	 * a stale entry from a wider-minimum version of a plugin can't
	 * open the window smaller than the plugin currently allows.
	 *
	 * Maximized state is replayed in `WindowManager.createWindow`
	 * (via `initialState: 'maximized'`) — not here. That keeps the
	 * replay path uniform between native and classic windows. The
	 * caller can suppress it by passing an explicit `initialState`
	 * on the `manager.open` call.
	 */
	const resolveSizeForEntry = (
		entry: NativeWindowServerEntry,
	): { width: number; height: number } => {
		const saved = loadNativeWindowGeometry( entry.id );
		if ( ! saved ) {
			return { width: entry.width, height: entry.height };
		}
		return {
			width: Math.max( saved.width, entry.minWidth ),
			height: Math.max( saved.height, entry.minHeight ),
		};
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

	/**
	 * Inject one stylesheet (link + inline blobs), once per URL.
	 *
	 * `wp_print_styles` already ran when the parent shell page was
	 * rendered, but a plugin activated mid-session never got its
	 * `admin_enqueue_scripts` callback hit on this page. Inject the
	 * `<link>` ourselves so the window's CSS lands before the
	 * render callback queries the body for mount points.
	 *
	 * Idempotent on every dimension we care about: tracked by URL
	 * in `loadedStyles`, AND a defensive `head` lookup so a
	 * server-rendered `<link>` (plugin active at boot) is detected
	 * and skipped — same shape as `ensureTemplate`'s guard.
	 */
	const injectStylesheet = ( style: {
		styleUrl?: string;
		styleHandle?: string;
		styleInline?: string[];
	} ): void => {
		const url = style.styleUrl;
		if ( ! url || loadedStyles.has( url ) ) {
			return;
		}
		// Defensive lookup against `<link>`s the server printed at boot
		// (plugin active at page load) so we don't duplicate. Escape `\`
		// and `"` for the attribute selector — the URL is resolved by
		// PHP `wp_styles()` so any character is fair game.
		const safeUrl = url.replace( /\\/g, '\\\\' ).replace( /"/g, '\\"' );
		const existing = document.head.querySelector< HTMLLinkElement >(
			`link[rel="stylesheet"][href="${ safeUrl }"]`,
		);
		if ( ! existing ) {
			const link = document.createElement( 'link' );
			link.rel = 'stylesheet';
			link.href = url;
			if ( style.styleHandle ) {
				link.dataset.osStyleHandle = style.styleHandle;
			}
			document.head.appendChild( link );
		}
		// Replay `wp_add_inline_style` blobs as a single `<style>` after
		// the link so the cascade matches what the print pipeline would
		// have written. One blob per inline string keeps stack traces
		// useful in DevTools when a rule misbehaves.
		if ( Array.isArray( style.styleInline ) ) {
			for ( const css of style.styleInline ) {
				if ( typeof css !== 'string' || css === '' ) {
					continue;
				}
				const el = document.createElement( 'style' );
				if ( style.styleHandle ) {
					el.dataset.osStyleHandle = style.styleHandle;
				}
				el.textContent = css;
				document.head.appendChild( el );
			}
		}
		loadedStyles.add( url );
	};

	const ensureStyle = ( entry: NativeWindowServerEntry ): void => {
		injectStylesheet( entry );
	};

	/**
	 * Inject the window's companion stylesheets (`styles` arg), in
	 * declared order. Runs on the first-open path, NOT at sync: a
	 * companion sheet only paints surfaces inside this window, so it
	 * is deliberately deferred until the window is actually shown.
	 *
	 * Appended to `<head>` after everything the server printed and
	 * after the window's own style (which `ensureStyle` handled at
	 * registration), so at equal specificity a companion's overrides
	 * win by source order — the same contract a `wp_register_style`
	 * dependency gives on the print path.
	 */
	const ensureCompanionStyles = ( entry: NativeWindowServerEntry ): void => {
		for ( const companion of entry.companionStyles ?? [] ) {
			injectStylesheet( companion );
		}
	};

	/**
	 * Load one bundle, once. The in-flight map is what makes this
	 * safe to call from the render path: a window opened twice in
	 * the same tick (tile click racing a session restore) would
	 * otherwise get two `<script>` tags for the same URL, because
	 * `loadedScripts` isn't written until the await resolves.
	 */
	/**
	 * Per-entry inline data already replayed, keyed `id|url`.
	 *
	 * The script TAG dedupes by URL, but the harvested data an entry
	 * carries is not guaranteed to have ridden the tag that loaded
	 * the URL. Every app window shares `app-runtime[.min].js` (and
	 * did share the legacy list bundle before the App Framework port);
	 * with the handle-keyed script-data map,
	 * every sibling hydrates from the SAME blobs — including the
	 * whole handle's `openStationWindowConfig[ id ]` set — so this
	 * replay is normally a harmless idempotent repeat. It stays
	 * because it is also the safety net for old-format payloads
	 * (entries carrying genuinely per-entry data), where skipping a
	 * sibling's data because the bundle was already fetched is
	 * exactly how the Pages window opened to "[desktop-mode-pages]
	 * config blob is missing" whenever Posts had opened first.
	 */
	const injectedScriptData = new Set< string >();

	/**
	 * Replay one entry's harvested inline data — translations, l10n,
	 * before/after blobs — without fetching its script. Only for an
	 * entry whose shared bundle another entry already brought into
	 * the tab: the bundle has executed, so ordering relative to the
	 * body no longer matters, and the render callback that needs the
	 * data runs strictly after this (`ensureScript` is awaited).
	 */
	const injectScriptDataOnce = (
		key: string,
		script: {
			scriptTranslations?: string;
			scriptL10n?: string[];
			scriptBefore?: string[];
			scriptAfter?: string[];
		},
	): void => {
		if ( injectedScriptData.has( key ) ) {
			return;
		}
		injectedScriptData.add( key );
		const blobs = [
			script.scriptTranslations ?? '',
			...( script.scriptL10n ?? [] ),
			...( script.scriptBefore ?? [] ),
			...( script.scriptAfter ?? [] ),
		];
		for ( const code of blobs ) {
			if ( typeof code === 'string' && code !== '' ) {
				injectInlineScript( code );
			}
		}
	};

	const loadOnce = (
		id: string,
		script: {
			scriptUrl: string;
			scriptTranslations?: string;
			scriptL10n?: string[];
			scriptBefore?: string[];
			scriptAfter?: string[];
		},
	): Promise< void > => {
		const url = script.scriptUrl;
		const dataKey = `${ id }|${ url }`;
		if ( loadedScripts.has( url ) ) {
			// The bundle is in the tab, but this entry's own data may
			// not be — see `injectedScriptData`.
			injectScriptDataOnce( dataKey, script );
			return Promise.resolve();
		}
		const pending = inflightScripts.get( url );
		if ( pending ) {
			// A sibling entry started the fetch with ITS extras; hand
			// this entry's in once the bundle has executed.
			return pending.then( () => injectScriptDataOnce( dataKey, script ) );
		}
		// This entry's extras travel with the script tag itself —
		// mark them replayed so a repeat open doesn't double-inject.
		injectedScriptData.add( dataKey );
		const load = loadVendorScript( url, {
			translations: script.scriptTranslations,
			l10n: script.scriptL10n,
			before: script.scriptBefore,
			after: script.scriptAfter,
		} )
			.catch( ( err ) => {
				// Load failed — surface via SHELL_ERROR. The window
				// still opens, but its body only gets the bare
				// template (no interactive render callback). Better
				// than blocking the whole sync / open.
				doAction( HOOKS.SHELL_ERROR, {
					scope: 'native-window-script-load',
					id,
					error: err,
				} );
			} )
			.then( () => {
				loadedScripts.add( url );
				inflightScripts.delete( url );
			} );
		inflightScripts.set( url, load );
		return load;
	};

	/**
	 * Bring every bundle this window needs into the tab: companion
	 * handles first, in declaration order, then the window's own
	 * script. The order is the contract — a companion subscribes to
	 * actions the window's bundle fires while rendering, so it has
	 * to be listening before that bundle is even parsed.
	 */
	const ensureScript = async (
		entry: NativeWindowServerEntry,
	): Promise< void > => {
		// Companion styles first — the `<link>` fetches in parallel
		// with the bundles below, so by the time the render callback
		// paints, the CSS has had the whole script load to arrive.
		ensureCompanionStyles( entry );
		for ( const companion of entry.companionScripts ?? [] ) {
			if ( ! companion.scriptUrl ) {
				continue;
			}
			await loadOnce( entry.id, companion );
		}
		if ( ! entry.scriptUrl ) {
			return;
		}
		await loadOnce( entry.id, entry );
	};

	/**
	 * Boot-time load, for the windows that asked for one.
	 *
	 * Every other window's bundle waits for its first open — see the
	 * `preload_script` note on `openstation_register_window()`. The
	 * shell reads a window's render callback off
	 * `window.openStationNativeWindows[ id ]` at open time, so
	 * loading the bundle any earlier only buys weight on every admin
	 * page the window is never opened from.
	 */
	const preloadScriptIfRequested = async (
		entry: NativeWindowServerEntry,
	): Promise< void > => {
		if ( ! entry.preloadScript ) {
			return;
		}
		await ensureScript( entry );
	};

	/**
	 * Build the render callback the window manager will invoke once
	 * the window element is in the DOM.
	 *
	 * Pre-populates the window body with the cloned template, then
	 * hands it to the optional render callback. The render contract
	 * is enhancement: declare static markup in `template`, query the
	 * body for mount points in render, light them up. Without a
	 * render callback the cloned template IS the window —
	 * declarative-only plugins need zero JS.
	 *
	 * `cloneTemplate` throws (and console.errors) when the template
	 * element is missing — let it surface; a missing template is a
	 * developer error worth seeing, not silencing.
	 *
	 * The `(body, ctx)` shape is built inside `Window.hydrateNative`
	 * — see the note in `createRegisterWindow` above. Legacy unary
	 * callbacks ignore `ctx`; new ones can destructure it.
	 *
	 * The template is cloned BEFORE the bundle is awaited, so the
	 * window paints its declared markup immediately and the wait
	 * only covers the interactive layer. `hydrateNative` holds the
	 * window's loading spinner for as long as this promise is
	 * pending, so a cold open reads as loading rather than as an
	 * empty window.
	 */
	const buildRender = ( entry: NativeWindowServerEntry ): RenderCallback => {
		return async ( body, ctx ) => {
			body.appendChild( cloneTemplate( entry.templateId ) );
			// After the panes are in the body, so the strip can pair
			// each tab to the one it shows and hide the rest.
			declareServerTabs( body, entry );
			// No-op once the bundle is in the tab — the second open of
			// a window resolves on an already-settled promise.
			await ensureScript( entry );
			// Read the callback AFTER the load: on a lazy window this
			// is the moment it exists.
			const render = readGlobalRegistry()[ entry.id ];
			// Forward the optional teardown returned by the plugin's
			// render callback so the Window class can invoke it on
			// close. Without this `return`, the teardown was silently
			// discarded — plugins had no reliable cleanup hook for
			// native windows.
			return render?.( body, ctx );
		};
	};

	const openFromEntry = (
		entry: NativeWindowServerEntry,
		params?: Record< string, string | number | boolean >,
	): void => {
		const finalRender = buildRender( entry );

		const size = resolveSizeForEntry( entry );

		// Leave `x` / `y` unset so `WindowManager.createWindow` can
		// apply the user's last saved position (or cascade on first
		// open). An explicit `0, 0` would short-circuit that.
		void manager.open( {
			id: entry.id,
			baseId: entry.id,
			native: true,
			url: `#${ entry.id }`,
			title: entry.title,
			icon: entry.icon,
			width: size.width,
			height: size.height,
			minWidth: entry.minWidth,
			minHeight: entry.minHeight,
			render: finalRender,
			autofocus: entry.autofocus,
			ownerHandle: entry.ownerHandle || entry.scriptHandle,
			// What this open is showing. Persisted with the session,
			// so a singleton that retargets comes back on the same
			// subject after a reload instead of on its default.
			// Omitted rather than set empty: `manager.open()` focuses
			// an existing window rather than rebuilding it, and an
			// argument-less reopen must not wipe what it was showing.
			...( params ? { params } : {} ),
		} );
	};

	/**
	 * Same shape as {@link openFromEntry} but routes through
	 * `manager.openNew()` so the next-instance-id logic kicks in. The
	 * render callback is built fresh per call — every duplicate gets
	 * its own template clone and its own teardown.
	 */
	const openNewFromEntry = (
		entry: NativeWindowServerEntry,
		params?: Record< string, string | number | boolean >,
	): void => {
		const finalRender = buildRender( entry );

		// Duplicate instances always open floating — the remembered
		// maximize preference applies to the primary window only.
		// Passing an explicit `initialState: 'normal'` suppresses the
		// `WindowManager.createWindow` saved-state replay (which
		// would otherwise spawn the duplicate in the maximized state
		// the user set on the primary).
		const size = resolveSizeForEntry( entry );

		void manager.openNew( {
			id: entry.id,
			baseId: entry.id,
			native: true,
			url: `#${ entry.id }`,
			title: entry.title,
			icon: entry.icon,
			width: size.width,
			height: size.height,
			minWidth: entry.minWidth,
			minHeight: entry.minHeight,
			initialState: 'normal',
			render: finalRender,
			autofocus: entry.autofocus,
			ownerHandle: entry.ownerHandle || entry.scriptHandle,
			...( params ? { params } : {} ),
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
			// shell still processes the template + style so the
			// plugin can open the window programmatically via
			// `wp.os.windowManager.open()`. Nothing to
			// register on the rails.
			ensureTemplate( entry );
			ensureStyle( entry );
			await preloadScriptIfRequested( entry );
			registered.add( entry.id );
			return;
		}

		ensureTemplate( entry );
		ensureStyle( entry );
		await preloadScriptIfRequested( entry );

		appendSystemTile( {
			id: entry.id,
			title: entry.title,
			icon: entry.icon,
			windowId: entry.id,
			navKind: 'control' === entry.navKind ? 'control' : 'app',
			// The window asked for a launcher, so the launcher's
			// resting place is a rail rather than the wallpaper an app
			// would otherwise default to. A proposal, not an
			// instruction: the user's Navigation pick still wins.
			defaultPlacement: 'rail',
			order: entry.dockOrder,
			placeable: true === entry.placeable,
			isOpen: () => !! manager.getById( entry.id ),
			onOpen: () => openFromEntry( entry ),
		} );

		doAction( HOOKS.DOCK_ITEM_APPENDED, { id: entry.id } );

		registered.add( entry.id );
	};

	const unregisterTile = ( id: string ): void => {
		if ( ! registered.has( id ) ) {
			return;
		}
		removeSystemTile( id );
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
		opts: {
			source?: string;
			params?: Record< string, string | number | boolean >;
		} = {},
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
		activity.publish( 'os/open-requested', {
			windowId: id,
			source: opts.source ?? 'api',
		} );
		openFromEntry( entry, opts.params );
		return true;
	};

	const openNewById = (
		id: string,
		opts: {
			source?: string;
			params?: Record< string, string | number | boolean >;
		} = {},
	): boolean => {
		const entry = entriesById.get( id );
		if ( ! entry ) {
			return false;
		}
		activity.publish( 'os/open-requested', {
			windowId: id,
			source: opts.source ?? 'api',
		} );
		openNewFromEntry( entry, opts.params );
		return true;
	};

	// Persist the user's manually-resized size for EVERY window
	// (native and classic iframe-backed alike) so the next fresh
	// open lands at the same dimensions instead of the defaults.
	// WINDOW_RESIZE_END only fires from the pointer-drag resize
	// handler, so programmatic re-tiles (arrange.ts / snap-zones.ts)
	// don't poison the persisted size.
	//
	// Skipped for non-normal states: a snap-zone tile (left half,
	// quarter, …) isn't the user saying "this is my preferred size",
	// it's a temporary layout intent. Restoring those on next open
	// would defeat the purpose. Maximized + fullscreen resizes are
	// also skipped here; the WINDOW_MAXIMIZED listener below records
	// the maximize *intent* separately from the floating size.
	addAction(
		HOOKS.WINDOW_RESIZE_END,
		'desktop-mode-native-window-geometry',
		( payload: unknown ) => {
			const p = payload as
				| { windowId?: string; width?: number; height?: number }
				| null;
			const windowId = p?.windowId;
			const width = p?.width;
			const height = p?.height;
			if (
				! windowId ||
				typeof width !== 'number' ||
				typeof height !== 'number'
			) {
				return;
			}
			const win = manager.getById( windowId );
			if ( ! win ) {
				return;
			}
			if ( win.state !== 'normal' ) {
				return;
			}
			const baseId = win.config.baseId || win.id;
			saveNativeWindowGeometry( baseId, { width, height } );
			// A top-left / top / left handle drag also moves the
			// window, so capture the post-resize x/y too. The
			// resize-end payload only carries width / height; read
			// position directly off the element. Defensive guard
			// for tests that mock the Window without a real element.
			if ( win.element ) {
				saveNativeWindowPosition( baseId, {
					x: win.element.offsetLeft,
					y: win.element.offsetTop,
				} );
			}
		},
	);

	// Persist the user's drag position so the window reopens where
	// they last left it. WINDOW_DRAG_END fires once per pointer-up
	// at the end of a title-bar drag — same gating as resize-end:
	// only the normal floating state counts, so an in-progress snap
	// (state=snapped-left, dragged to commit the half-screen tile)
	// doesn't poison the stored position.
	//
	// We write BOTH size + position here. The size is the window's
	// current floating dimensions even if the user never manually
	// resized; without this seed call, `saveNativeWindowPosition`
	// would have no prior entry to layer position onto for users
	// who open-drag-close without ever resizing.
	addAction(
		HOOKS.WINDOW_DRAG_END,
		'desktop-mode-native-window-geometry',
		( payload: unknown ) => {
			const windowId = ( payload as { windowId?: string } | null )?.windowId;
			if ( ! windowId ) {
				return;
			}
			const win = manager.getById( windowId );
			if ( ! win ) {
				return;
			}
			if ( win.state !== 'normal' ) {
				return;
			}
			if ( ! win.element ) {
				return;
			}
			const baseId = win.config.baseId || win.id;
			saveNativeWindowGeometry( baseId, {
				width: win.element.offsetWidth,
				height: win.element.offsetHeight,
			} );
			saveNativeWindowPosition( baseId, {
				x: win.element.offsetLeft,
				y: win.element.offsetTop,
			} );
		},
	);

	// Persist the user's maximized intent for every window. The
	// floating width / height stored separately by the resize-end
	// handler stays untouched — it's still what un-maximize restores
	// to.
	//
	// When the user maximizes a window they never resized, seed the
	// floating size from the entry defaults (for native windows in
	// the registry) or the current window snapshot's pre-maximize
	// geometry — whichever is available. Without a seed the
	// store has no width/height to anchor the maximize-on-reopen.
	addAction(
		HOOKS.WINDOW_MAXIMIZED,
		'desktop-mode-native-window-geometry',
		( payload: unknown ) => {
			const windowId = ( payload as { windowId?: string } | null )?.windowId;
			if ( ! windowId ) {
				return;
			}
			// On a phone every window is maximized by contract, not by
			// choice; recording that would reopen the window maximized
			// on the desktop too.
			if ( isMobileStamped() ) {
				return;
			}
			const win = manager.getById( windowId );
			if ( ! win ) {
				return;
			}
			const baseId = win.config.baseId || win.id;
			const entry = entriesById.get( baseId );
			const defaults = entry
				? { width: entry.width, height: entry.height }
				: { width: win.config.width, height: win.config.height };
			setNativeWindowSavedState( baseId, 'maximized', defaults );
		},
	);

	addAction(
		HOOKS.WINDOW_UNMAXIMIZED,
		'desktop-mode-native-window-geometry',
		( payload: unknown ) => {
			const windowId = ( payload as { windowId?: string } | null )?.windowId;
			if ( ! windowId ) {
				return;
			}
			const win = manager.getById( windowId );
			if ( ! win ) {
				return;
			}
			const baseId = win.config.baseId || win.id;
			setNativeWindowSavedState( baseId, null );
		},
	);

	const loadScriptById = async ( id: string ): Promise< boolean > => {
		const entry = entriesById.get( id );
		if ( ! entry ) {
			return false;
		}
		await ensureScript( entry );
		return true;
	};

	return { sync, openById, openNewById, loadScriptById };
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
			`[openstation] cloneTemplate: no <template> found for ${
				typeof template === 'string' ? `#${ template }` : '<reference>'
			}`,
		);
	}
	return tpl.content.cloneNode( true ) as DocumentFragment;
}
