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
 *   - {@link cloneTemplate} → a tiny `<template>` cloner for plugins
 *     that ship their UI as an inert template and want to hydrate a
 *     fresh copy per window. Saves the "find the template, clone
 *     content, query nodes" boilerplate every native window
 *     otherwise reinvents.
 *
 * Both are intentionally thin — they don't introduce new runtime
 * state. Plugins that outgrow them can always call the underlying
 * APIs directly.
 *
 * @since 0.10.0
 */

import { HOOKS, addAction, doAction, removeAction } from './hooks';
import { loadVendorScript } from './wallpapers/vendor-loader';
import { registerSyntheticIframe } from './connection';
import type { Dock } from './dock';
import type {
	NativeWindowDef,
	NativeWindowIframeContent,
	NativeWindowServerEntry,
} from './types';
import type { WindowManager } from './window-manager';
import type { Window as DesktopWindow } from './window';

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
	focused?: () => void;
	closing?: ( payload: { element: HTMLElement } ) => void;
	closed?: () => void;
	minimized?: () => void;
	restored?: () => void;
	maximized?: () => void;
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
/**
 * Public shape of the send closure. Re-exported through
 * `Window.iframeSend` and the `onReady` callback parameter.
 *
 * @public
 * @since 0.18.0
 */
export type IframeContentSendFn = (
	payload: unknown,
	opts?: { coalesce?: boolean },
) => void;

/** Out-param the render closure populates synchronously. */
interface IframeContentSendHandle {
	send: IframeContentSendFn | null;
}

function buildIframeContentRender(
	cfg: NativeWindowIframeContent,
	cleanups: ( () => void )[],
	windowId: string,
	sendHandle: IframeContentSendHandle,
): ( body: HTMLElement ) => void {
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

		// Resolve the iframe URL's origin for the postMessage
		// targetOrigin. If the URL is relative or invalid, fall back
		// to the shell's own origin (matches the chromeless bridge's
		// trust boundary).
		let targetOrigin: string;
		try {
			targetOrigin = new URL( cfg.url, window.location.origin ).origin;
		} catch {
			targetOrigin = window.location.origin;
		}

		// Pre-load message buffers.
		//
		//   - `fifoQueue` — every `send()` call without `coalesce`
		//     is queued and flushed in order on load. Use for
		//     setup messages where every payload matters
		//     ({ type:'init' }, { type:'config' }, etc.).
		//
		//   - `coalesceSlot` — single-slot buffer used when the
		//     caller passes `{ coalesce: true }`. Each call
		//     overwrites the slot; only the most-recent payload
		//     survives until load. Use for live-stream snapshots
		//     (Gutenberg editor content, scroll position, hover
		//     state) where pre-load intermediates are throwaway
		//     and you want the freshest one.
		let isLoaded = false;
		const fifoQueue: unknown[] = [];
		let hasCoalesce = false;
		let coalesceSlot: unknown;

		const sendNow = ( payload: unknown ): void => {
			try {
				iframe.contentWindow?.postMessage( payload, targetOrigin );
			} catch ( err ) {
				if ( typeof console !== 'undefined' ) {
					console.error(
						'[wp-desktop-mode] iframeContent.send: postMessage failed',
						err,
					);
				}
			}
		};

		const send: IframeContentSendFn = ( payload, opts ) => {
			if ( isLoaded ) {
				sendNow( payload );
				return;
			}
			if ( opts?.coalesce ) {
				coalesceSlot = payload;
				hasCoalesce = true;
				return;
			}
			fifoQueue.push( payload );
		};

		// Expose synchronously so `Window.iframeSend` can route
		// calls into THIS render's queue. `manager.open()` invokes
		// `render(body)` from within its constructor, so by the time
		// `manager.open()` returns to `createRegisterWindow`, this
		// out-param is already populated.
		sendHandle.send = send;

		const onLoad = (): void => {
			isLoaded = true;

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

			try {
				cfg.onReady?.( send );
			} catch ( err ) {
				if ( typeof console !== 'undefined' ) {
					console.error(
						'[wp-desktop-mode] iframeContent.onReady threw:',
						err,
					);
				}
			}

			// Flush FIFO first so setup messages arrive in order;
			// the coalesce slot lands last so it represents the
			// freshest snapshot — matters for live-preview cases
			// where the queue mixes init + repeated stream payloads.
			while ( fifoQueue.length ) {
				sendNow( fifoQueue.shift() );
			}
			if ( hasCoalesce ) {
				sendNow( coalesceSlot );
				hasCoalesce = false;
				coalesceSlot = undefined;
			}
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
		let render = def.render;
		const cleanups: ( () => void )[] = [];
		const sendHandle: IframeContentSendHandle = { send: null };
		if ( def.iframeContent ) {
			if ( render && typeof console !== 'undefined' ) {
				console.warn(
					'[wp-desktop-mode] registerWindow: both `render` and `iframeContent` provided — ignoring `render` and using the iframe shorthand. Drop one.',
				);
			}
			render = buildIframeContentRender(
				def.iframeContent,
				cleanups,
				def.id,
				sendHandle,
			);
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
			multi: def.multi,
			desktopId: def.desktopId,
		} );

		// Wire the iframeContent send closure onto the Window so
		// callers can `win.iframeSend( payload )` synchronously,
		// without waiting for `onReady`. The send fn was populated
		// during `render(body)` which runs inside `manager.open()`,
		// so by this point `sendHandle.send` is set when
		// `iframeContent` was configured. For windows that focused
		// an already-open instance (idempotent re-open), the existing
		// Window's send fn stays unchanged — re-rendering would
		// stomp the still-valid live queue.
		if ( sendHandle.send && ! win._iframeSendImpl ) {
			win._iframeSendImpl = sendHandle.send;
		}

		return win;
	};
}

/**
 * Clone the contents of a `<template>` element and return the
 * resulting `DocumentFragment`. A thin utility, but it short-
 * circuits the "grab template, clone, cast" dance every native
 * window currently inlines:
 *
 * ```ts
 * const tpl = document.getElementById( 'myplugin-calc' ) as HTMLTemplateElement;
 * const tree = tpl.content.cloneNode( true ) as DocumentFragment;
 * body.appendChild( tree );
 * ```
 *
 * becomes:
 *
 * ```ts
 * body.appendChild( cloneTemplate( 'myplugin-calc' ) );
 * ```
 *
 * Accepts either a DOM id string or a template element directly,
 * so plugins that already have a reference don't double-lookup.
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
let onWindowInstanceCounter = 0;
export function onWindow(
	id: string,
	handlers: WindowLifecycleHandlers,
): () => void {
	const namespace = `wp-desktop-mode/on-window/${ id }/${ ++onWindowInstanceCounter }`;

	// Map each handler slot onto the corresponding hook name + a
	// windowId-filter-and-dispatch wrapper. Kept declarative so the
	// table stays easy to audit / extend when new hooks land.
	const bindings: Array< [ keyof WindowLifecycleHandlers, string ] > = [
		[ 'opened', HOOKS.WINDOW_OPENED ],
		[ 'focused', HOOKS.WINDOW_FOCUSED ],
		[ 'closing', HOOKS.WINDOW_CLOSING ],
		[ 'closed', HOOKS.WINDOW_CLOSED ],
		[ 'minimized', HOOKS.WINDOW_MINIMIZED ],
		[ 'restored', HOOKS.WINDOW_RESTORED ],
		[ 'maximized', HOOKS.WINDOW_MAXIMIZED ],
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
			// don't leak.
			if ( key === 'closed' ) {
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
 * `wp_register_desktop_window()` get this automatic lifecycle;
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

type RenderCallback = ( body: HTMLElement ) => void;

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
export function createNativeWindowSync(
	deps: NativeWindowRegistryDeps,
): ( list: NativeWindowServerEntry[] ) => Promise< void > {
	const { manager, dock, taskbar, taskbarEl, desktopArea } = deps;

	const registered = new Set< string >();
	const injectedTemplates = new Set< string >();
	const loadedScripts = new Set< string >();

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

		// Fallback render when the plugin didn't register one (or
		// its script failed to load): just clone the template into
		// the window body. Gives a declarative-template plugin a
		// fully working window without any JS render callback.
		const finalRender: RenderCallback = render
			? render
			: ( body ) => {
				try {
					body.appendChild( cloneTemplate( entry.templateId ) );
				} catch {
					/* Missing template — give up quietly. */
				}
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
	};

	return async ( list ) => {
		const incoming = new Set< string >();
		for ( const entry of list ) {
			incoming.add( entry.id );
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
