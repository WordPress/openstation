/**
 * Per-window channel bus.
 *
 * Storage layer for the unified window-message API. Two registries
 * per window id:
 *
 *   - **Parent-side subscribers** — fire when the window's content
 *     publishes via `wp.os.send( channel, payload )` (iframe)
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
 *
 * ## Every registry here is shared state, and it has to be
 *
 * This module is compiled into MORE THAN ONE bundle: the `Window`
 * class and `createWindowElement()` live in `window-system.js`, while
 * the shell's own callers — `native-windows.ts`' synthetic-iframe
 * readiness signal, `connection/index.ts`' subscriber registration —
 * ride in `desktop.js`. Plain module-level `Map`s / `Set`s here give
 * each bundle its own private bookkeeping, and the two halves of every
 * pairing below then talk past each other:
 *
 *   - `markWindowContentLoading()` in one copy, `markWindowContentReady()`
 *     in the other → the loading → ready edge never fires, so
 *     `WINDOW_CONTENT_LOADED` never fires and the window sits under
 *     its loading overlay forever. Silently: every guard on the path
 *     is an early return.
 *   - `enqueueWindowSend()` in one copy, the flush in the other → a
 *     `Window.send()` issued before the content is ready is never
 *     delivered.
 *   - `addParentSubscriber()` in one copy, `dispatchFromWindow()` in
 *     the other → `Window.on( channel, cb )` never fires.
 *   - `clearWindowChannels()` in one copy → the other keeps a closed
 *     window's ready flag, and the reopened window skips its flush.
 *
 * So everything lives in one `createSharedStore` record, keyed on the
 * page rather than on the module. See AGENTS.md § "Cross-bundle state
 * — `wp.os.createSharedStore`", and the same treatment applied to the
 * admin-link deps a few files over in `src/window/iframe-bridge.ts`.
 */

import { HOOKS, doAction } from './hooks';
import { createSharedStore } from './shared-store';

export type WindowChannelMeta = {
	channel: string;
	windowId: string;
};

export type WindowChannelCb = (
	payload: unknown,
	meta: WindowChannelMeta,
) => void;

type PendingSend = {
	channel: string;
	payload: unknown;
	flush: () => void;
};

type SubRoot = Map< string, Map< string, Set< WindowChannelCb > > >;

/**
 * Every registry this module owns, in one cross-bundle record.
 *
 * Every call site reads `channelsStore.state.<field>` fresh rather
 * than capturing a field in a module-level `const`: a store reset
 * swaps the field values (keeping the outer object's identity), so a
 * capture taken at module load would go stale the first time a test
 * resets the store — the same silent-divergence failure the store is
 * here to prevent.
 */
interface WindowChannelsState {
	parentSubs: SubRoot;
	nativeSubs: SubRoot;
	readyWindows: Set< string >;
	loadingWindows: Set< string >;
	pendingSends: Map< string, PendingSend[] >;
}

const channelsStore = createSharedStore< WindowChannelsState >(
	'desktop-mode/window-channels',
	() => ( {
		parentSubs: new Map(),
		nativeSubs: new Map(),
		readyWindows: new Set(),
		loadingWindows: new Set(),
		pendingSends: new Map(),
	} ),
);

function bucket(
	root: SubRoot,
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
	root: SubRoot,
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
						`[openstation] window-channel subscriber for "${ channel }" threw:`,
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
						`[openstation] window-channel wildcard subscriber for "${ windowId }" threw:`,
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
	const set = bucket(
		channelsStore.state.parentSubs,
		windowId,
		channel,
		true,
	)!;
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
	dispatch( channelsStore.state.parentSubs, windowId, channel, payload );
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
	const set = bucket(
		channelsStore.state.nativeSubs,
		windowId,
		channel,
		true,
	)!;
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
	dispatch( channelsStore.state.nativeSubs, windowId, channel, payload );
}

/* ---------------------------------------------------------------- *
 *  Pre-load send queue — let `Window.send()` be safe to call before
 *  an iframe-backed window finishes loading. The Window class
 *  enqueues here when the target isn't ready; the appropriate ready
 *  signal (`os-ready` for real iframes, `iframe.load` for
 *  synthetic ones) calls `markWindowContentReady()` to flush. Pure
 *  native windows always count as ready — there's no async
 *  boundary between `Window.send()` and the render's listeners.
 * ---------------------------------------------------------------- */

/**
 * Whether a window's content is ready to receive sends. True for
 * pure native windows from the start. For iframe-backed windows
 * the bridge / load event flips this on at the right moment.
 *
 * @internal
 */
export function isWindowContentReady( windowId: string ): boolean {
	return channelsStore.state.readyWindows.has( windowId );
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
	return channelsStore.state.loadingWindows.has( windowId );
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
	const { loadingWindows } = channelsStore.state;
	if ( loadingWindows.has( windowId ) ) {
		return;
	}
	loadingWindows.add( windowId );
	doAction( HOOKS.WINDOW_CONTENT_LOADING, { windowId } );
	if ( typeof document !== 'undefined' ) {
		document.dispatchEvent(
			new CustomEvent( 'os-window-content-loading', {
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
 *      `os-window-content-loaded` CustomEvent only on a
 *      loading → ready transition. A plugin re-arming the spinner
 *      with `markContentLoading` and then calling
 *      `markContentLoaded` again will see a fresh hook fire.
 *
 * @internal
 */
export function markWindowContentReady( windowId: string ): void {
	const { readyWindows, loadingWindows, pendingSends } = channelsStore.state;
	if ( ! readyWindows.has( windowId ) ) {
		readyWindows.add( windowId );
		const queued = pendingSends.get( windowId );
		if ( queued ) {
			pendingSends.delete( windowId );
			for ( const m of queued ) {
				try {
					m.flush();
				} catch ( err ) {
					if ( typeof console !== 'undefined' ) {
						console.error(
							`[openstation] flushing queued window-send for "${ m.channel }" threw:`,
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
	if ( loadingWindows.delete( windowId ) ) {
		doAction( HOOKS.WINDOW_CONTENT_LOADED, { windowId } );
		if ( typeof document !== 'undefined' ) {
			document.dispatchEvent(
				new CustomEvent( 'os-window-content-loaded', {
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
	const { pendingSends } = channelsStore.state;
	let q = pendingSends.get( windowId );
	if ( ! q ) {
		q = [];
		pendingSends.set( windowId, q );
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
	const s = channelsStore.state;
	s.parentSubs.delete( windowId );
	s.nativeSubs.delete( windowId );
	s.readyWindows.delete( windowId );
	s.loadingWindows.delete( windowId );
	s.pendingSends.delete( windowId );
}

/**
 * Test-only reset — drops every registry. Real code never calls
 * this.
 *
 * @internal
 */
export function _resetWindowChannelsForTests(): void {
	// Cleared in place rather than via `channelsStore.reset()`: the
	// store's reset also drops subscribers, and every registry here is
	// reachable from another bundle's handle on the same record.
	const s = channelsStore.state;
	s.parentSubs.clear();
	s.nativeSubs.clear();
	s.readyWindows.clear();
	s.loadingWindows.clear();
	s.pendingSends.clear();
}
