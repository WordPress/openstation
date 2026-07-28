/**
 * Per-window channel bus.
 *
 * Storage layer for the unified window-message API. Two registries
 * per window id:
 *
 *   - **Parent-side subscribers** — fire when the window's content
 *     publishes via `wp.desktop.send( channel, payload )` (iframe)
 *     or `windowApi.send( channel, payload )` (native render). The
 *     parent shell observes these via `Window.on( channel, cb )`.
 *
 *   - **Native-side subscribers** — fire when the parent calls
 *     `Window.send( channel, payload )` on a NATIVE window. The
 *     render callback observes these via the `windowApi.on(
 *     channel, cb )` it received in the render context.
 *
 * For iframe windows the second leg goes via `postMessage` — the
 * iframe-bridge in the iframe document owns its own subscriber
 * table — so this module only stores the FIRST leg for them.
 *
 * The bus has no opinion on iframe vs native; the dispatcher (
 * `Window.send`, the iframe-bridge handler, the native render's
 * `windowApi`) is the only thing that picks the right path. Plugin
 * authors stay in API-land — they never see this module.
 */

import { HOOKS, doAction } from './hooks';

export type WindowChannelMeta = {
	channel: string;
	windowId: string;
};

export type WindowChannelCb = (
	payload: unknown,
	meta: WindowChannelMeta,
) => void;

const _parentSubs = new Map< string, Map< string, Set< WindowChannelCb > > >();
const _nativeSubs = new Map< string, Map< string, Set< WindowChannelCb > > >();

function bucket(
	root: Map< string, Map< string, Set< WindowChannelCb > > >,
	windowId: string,
	channel: string,
	create: boolean,
): Set< WindowChannelCb > | undefined {
	let perWindow = root.get( windowId );
	if ( ! perWindow ) {
		if ( ! create ) {
			return undefined;
		}
		perWindow = new Map();
		root.set( windowId, perWindow );
	}
	let bucketSet = perWindow.get( channel );
	if ( ! bucketSet ) {
		if ( ! create ) {
			return undefined;
		}
		bucketSet = new Set();
		perWindow.set( channel, bucketSet );
	}
	return bucketSet;
}

function dispatch(
	root: Map< string, Map< string, Set< WindowChannelCb > > >,
	windowId: string,
	channel: string,
	payload: unknown,
): void {
	const meta: WindowChannelMeta = { channel, windowId };
	const exact = bucket( root, windowId, channel, false );
	if ( exact ) {
		// Snapshot so unsubscribe-during-fire doesn't disturb iteration.
		for ( const cb of Array.from( exact ) ) {
			try {
				cb( payload, meta );
			} catch ( err ) {
				if ( typeof console !== 'undefined' ) {
					console.error(
						`[desktop-mode] window-channel subscriber for "${ channel }" threw:`,
						err,
					);
				}
			}
		}
	}
	const wildcard = bucket( root, windowId, '*', false );
	if ( wildcard ) {
		for ( const cb of Array.from( wildcard ) ) {
			try {
				cb( payload, meta );
			} catch ( err ) {
				if ( typeof console !== 'undefined' ) {
					console.error(
						`[desktop-mode] window-channel wildcard subscriber for "${ windowId }" threw:`,
						err,
					);
				}
			}
		}
	}
}

/**
 * Register a parent-side subscriber. Fires when the window's
 * content publishes on `channel` (or any channel, for `'*'`).
 * Called from `Window.on()`.
 */
export function addParentSubscriber(
	windowId: string,
	channel: string,
	cb: WindowChannelCb,
): () => void {
	const set = bucket( _parentSubs, windowId, channel, true )!;
	set.add( cb );
	let removed = false;
	return () => {
		if ( removed ) {
			return;
		}
		removed = true;
		set.delete( cb );
	};
}

/**
 * Fire every parent-side subscriber for `(windowId, channel)`.
 * Called from the iframe-bridge when an iframe publishes, and
 * from the native `windowApi.send()` closure.
 *
 * @internal
 */
export function dispatchFromWindow(
	windowId: string,
	channel: string,
	payload: unknown,
): void {
	dispatch( _parentSubs, windowId, channel, payload );
}

/**
 * Register a native-render-side subscriber. Fires when the parent
 * calls `Window.send( channel, payload )` on this native window.
 * Called from the `windowApi.on()` closure given to the render
 * callback.
 *
 * @internal
 */
export function addNativeSubscriber(
	windowId: string,
	channel: string,
	cb: WindowChannelCb,
): () => void {
	const set = bucket( _nativeSubs, windowId, channel, true )!;
	set.add( cb );
	let removed = false;
	return () => {
		if ( removed ) {
			return;
		}
		removed = true;
		set.delete( cb );
	};
}

/**
 * Fire every native-render-side subscriber for `(windowId, channel)`.
 * Called from `Window.send()` when the target is a pure native
 * window (no iframe, no synthetic iframe).
 *
 * @internal
 */
export function dispatchToNative(
	windowId: string,
	channel: string,
	payload: unknown,
): void {
	dispatch( _nativeSubs, windowId, channel, payload );
}

/* ---------------------------------------------------------------- *
 *  Pre-load send queue — let `Window.send()` be safe to call before
 *  an iframe-backed window finishes loading. The Window class
 *  enqueues here when the target isn't ready; the appropriate ready
 *  signal (`desktop-mode-ready` for real iframes, `iframe.load` for
 *  synthetic ones) calls `markWindowContentReady()` to flush. Pure
 *  native windows always count as ready — there's no async
 *  boundary between `Window.send()` and the render's listeners.
 * ---------------------------------------------------------------- */

const _readyWindows = new Set< string >();
const _loadingWindows = new Set< string >();
type PendingSend = {
	channel: string;
	payload: unknown;
	flush: () => void;
};
const _pendingSends = new Map< string, PendingSend[] >();

/**
 * Whether a window's content is ready to receive sends. True for
 * pure native windows from the start. For iframe-backed windows
 * the bridge / load event flips this on at the right moment.
 *
 * @internal
 */
export function isWindowContentReady( windowId: string ): boolean {
	return _readyWindows.has( windowId );
}

/**
 * Whether a window is currently in the visual loading state — i.e.
 * the shell is showing the spinner overlay and the body content is
 * faded out. Driven by {@link markWindowContentLoading} (enter) and
 * {@link markWindowContentReady} (exit). Independent from transport
 * readiness ({@link isWindowContentReady}): a window may be transport-
 * ready (queued sends already flushed) yet visually loading because
 * a plugin called `markLoading()` to refetch.
 *
 * @internal
 */
export function isWindowContentLoading( windowId: string ): boolean {
	return _loadingWindows.has( windowId );
}

/**
 * Fires the canonical "window entered loading state" signal.
 * Called automatically when a window's body is constructed, and
 * exposed through `Window.markContentLoading()` /
 * `NativeRenderContext.window.markLoading()` so plugin authors can
 * re-show the spinner mid-life (e.g. before refetching data).
 *
 * Edge-triggered: idempotent calls don't re-fire the hook.
 *
 * @internal
 */
export function markWindowContentLoading( windowId: string ): void {
	if ( _loadingWindows.has( windowId ) ) {
		return;
	}
	_loadingWindows.add( windowId );
	doAction( HOOKS.WINDOW_CONTENT_LOADING, { windowId } );
	if ( typeof document !== 'undefined' ) {
		document.dispatchEvent(
			new CustomEvent( 'desktop-mode-window-content-loading', {
				detail: { windowId },
			} ),
		);
	}
}

/**
 * Mark a window's content as ready and flush any sends that
 * `Window.send()` queued in the meantime.
 *
 * Two semantics rolled into one call:
 *
 *   1. Transport readiness — one-shot. The first call adds the
 *      window to `_readyWindows` and flushes any queued sends. Later
 *      calls skip the flush (idempotent).
 *   2. Visual loading state — edge-triggered. Fires
 *      `WINDOW_CONTENT_LOADED` + the
 *      `desktop-mode-window-content-loaded` CustomEvent only on a
 *      loading → ready transition. A plugin re-arming the spinner
 *      with `markContentLoading` and then calling
 *      `markContentLoaded` again will see a fresh hook fire.
 *
 * @internal
 */
export function markWindowContentReady( windowId: string ): void {
	if ( ! _readyWindows.has( windowId ) ) {
		_readyWindows.add( windowId );
		const queued = _pendingSends.get( windowId );
		if ( queued ) {
			_pendingSends.delete( windowId );
			for ( const m of queued ) {
				try {
					m.flush();
				} catch ( err ) {
					if ( typeof console !== 'undefined' ) {
						console.error(
							`[desktop-mode] flushing queued window-send for "${ m.channel }" threw:`,
							err,
						);
					}
				}
			}
		}
	}

	// Visual loading → ready transition. `Set.delete` returns true
	// when the entry was actually present, so this fires exactly
	// once per loading episode regardless of how many times callers
	// invoke `markWindowContentReady`.
	if ( _loadingWindows.delete( windowId ) ) {
		doAction( HOOKS.WINDOW_CONTENT_LOADED, { windowId } );
		if ( typeof document !== 'undefined' ) {
			document.dispatchEvent(
				new CustomEvent( 'desktop-mode-window-content-loaded', {
					detail: { windowId },
				} ),
			);
		}
	}
}

/**
 * Enqueue a send the caller couldn't deliver yet. The `flush`
 * closure does the actual delivery (postMessage to whatever target
 * was resolved at enqueue time).
 *
 * @internal
 */
export function enqueueWindowSend(
	windowId: string,
	channel: string,
	payload: unknown,
	flush: () => void,
): void {
	let q = _pendingSends.get( windowId );
	if ( ! q ) {
		q = [];
		_pendingSends.set( windowId, q );
	}
	q.push( { channel, payload, flush } );
}

/**
 * Drop every subscriber bound to a window id — called when the
 * window closes so subscriber sets don't leak across reopens.
 *
 * @internal
 */
export function clearWindowChannels( windowId: string ): void {
	_parentSubs.delete( windowId );
	_nativeSubs.delete( windowId );
	_readyWindows.delete( windowId );
	_loadingWindows.delete( windowId );
	_pendingSends.delete( windowId );
}

/**
 * Test-only reset — drops every registry. Real code never calls
 * this.
 *
 * @internal
 */
export function _resetWindowChannelsForTests(): void {
	_parentSubs.clear();
	_nativeSubs.clear();
	_readyWindows.clear();
	_loadingWindows.clear();
	_pendingSends.clear();
}
