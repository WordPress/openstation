/**
 * Desktop Mode — cross-window broadcast bus.
 *
 * Generic pub/sub primitive. Any module can call
 * `wp.desktop.broadcast( topic, payload )`; every subscriber on the
 * topic — whether in the parent shell, in a native window's render
 * callback, or inside any open iframe — receives the payload.
 *
 * The connection bridge in `src/connection/` is point-to-point —
 * "I want to talk to *that* window." This module is fan-out:
 * "something happened, anyone who cares about <topic> should
 * react." First use case: the Recycle Bin publishes
 * `desktop-mode.data-changed` whenever it restores or permanently
 * deletes an item, so the Posts list, Media Library, etc. can
 * repaint themselves without polling.
 *
 * Wire model:
 *   - **In-shell delivery:** `document.dispatchEvent` on the
 *     parent document with `CustomEvent( 'desktop-mode-broadcast',
 *     { detail: { topic, payload } } )`. Cheap, synchronous.
 *   - **To iframes:** the parent walks every open window's
 *     `iframe.contentWindow` and posts `{ type:
 *     'desktop-mode-broadcast', topic, payload }`. Same-origin
 *     check on the receive side.
 *   - **From iframes:** the chromeless bridge in `render.php`
 *     listens for incoming `desktop-mode-broadcast` messages and
 *     re-dispatches the CustomEvent on the iframe's own
 *     `document`. Iframe-side admin pages subscribe with
 *     `document.addEventListener( 'desktop-mode-broadcast', … )`.
 *
 * @public
 * @since 0.21.0
 */

import { activity } from './activity';
import { applyFilters, doAction, HOOKS } from './hooks';
import type { WindowManager } from './window-manager';

const EVENT_NAME = 'desktop-mode-broadcast';
const POSTMESSAGE_TYPE = 'desktop-mode-broadcast';
const ORIGIN = window.location.origin;

export interface BroadcastDetail< T = unknown > {
	topic: string;
	payload: T;
}

export type BroadcastSubscriber< T = unknown > = (
	payload: T,
	meta: { topic: string },
) => void;

/** One handle from `subscribe()` — call it to detach. */
export type BroadcastUnsubscribe = () => void;

let _manager: WindowManager | null = null;

/**
 * Wire the broadcast bus to the live window manager. Called once
 * by `desktop.ts` during shell init — the bus needs the manager to
 * enumerate open iframes when fanning out.
 *
 * @internal
 *
 * @param manager Live window manager.
 */
export function attachBroadcastBus( manager: WindowManager ): void {
	_manager = manager;
}

/**
 * Publish a payload on a topic. Synchronous — every in-shell
 * subscriber is invoked before this returns; iframes receive the
 * payload one tick later (postMessage is always async).
 *
 * The topic is filterable via `desktop-mode.broadcast.topic` and the
 * payload via `desktop-mode.broadcast.payload`, so plugins can
 * mute / rewrite traffic without forking the source.
 *
 * @public
 *
 * @param topic   Slash- or dot-separated identifier (e.g.
 *                `desktop-mode.data-changed`). Subscribers match by
 *                exact string OR by the wildcard `'*'`.
 * @param payload Anything structured-clone-safe.
 */
export function broadcast< T = unknown >( topic: string, payload: T ): void {
	const filteredTopic = String(
		applyFilters( 'desktop-mode.broadcast.topic', topic, { payload } ) ?? topic,
	);
	const filteredPayload = applyFilters(
		'desktop-mode.broadcast.payload',
		payload,
		{ topic: filteredTopic },
	) as T;

	const detail: BroadcastDetail< T > = {
		topic: filteredTopic,
		payload: filteredPayload,
	};

	// In-shell — synchronous.
	document.dispatchEvent( new CustomEvent( EVENT_NAME, { detail } ) );
	doAction( HOOKS.BROADCAST, detail );

	// Mirror onto the framework activity bus so in-tab consumers
	// can subscribe via the unified `wp.desktop.activity.subscribe`
	// surface instead of having to know about the broadcast bus.
	// Cross-tab BroadcastChannel + cross-iframe postMessage fanout
	// below stays the broadcast module's job — activity is in-tab
	// only by design.
	activity.publish(
		filteredTopic as `${ string }/${ string }`,
		filteredPayload,
	);

	// Fan out to every open iframe. Catch-and-continue: a single
	// iframe's `contentWindow` going stale (cross-origin nav,
	// detach race) must not abort the rest of the fanout.
	if ( ! _manager ) {
		return;
	}
	const message = {
		type: POSTMESSAGE_TYPE,
		topic: filteredTopic,
		payload: filteredPayload,
	};
	for ( const win of _manager._stack ) {
		const target = win.iframe?.contentWindow;
		if ( ! target ) {
			continue;
		}
		try {
			target.postMessage( message, ORIGIN );
		} catch ( err ) {
			// Cross-origin iframe (rare in our flow — chromeless
			// is same-origin), or the iframe was just navigated
			// and the contentWindow is stale. Either way, skip.
			void err;
		}
	}
}

/**
 * Subscribe to a topic. The callback fires for every `broadcast()`
 * with a matching topic. Returns an unsubscribe handle.
 *
 * Use the literal string `'*'` to receive every payload — useful
 * for debugging and observability subscribers, expensive in hot
 * paths.
 *
 * Works identically inside an iframe (the chromeless bridge
 * re-dispatches incoming broadcasts as the same CustomEvent on
 * the iframe document) — iframe-side admin pages can call this
 * via `wp.desktop.subscribe(...)` if they enqueue
 * `desktop-mode-iframe-bridge`, or they can listen on `document`
 * directly for `desktop-mode-broadcast`.
 *
 * @public
 *
 * @param topic Topic name, or `'*'` for the wildcard.
 * @param cb    Receives `( payload, { topic } )`.
 * @return Unsubscribe handle.
 */
export function subscribe< T = unknown >(
	topic: string,
	cb: BroadcastSubscriber< T >,
): BroadcastUnsubscribe {
	const handler = ( e: Event ): void => {
		const detail = ( e as CustomEvent< BroadcastDetail< T > > ).detail;
		if ( ! detail ) {
			return;
		}
		if ( topic !== '*' && detail.topic !== topic ) {
			return;
		}
		try {
			cb( detail.payload, { topic: detail.topic } );
		} catch ( err ) {
			// One subscriber's bug must not break the bus for
			// every other subscriber. Surface to the shell
			// error channel so DevTools can see it.
			doAction( HOOKS.SHELL_ERROR, {
				scope: 'broadcast-subscriber',
				topic: detail.topic,
				error: err,
			} );
		}
	};
	document.addEventListener( EVENT_NAME, handler );
	return () => document.removeEventListener( EVENT_NAME, handler );
}

/**
 * Install the parent-side receiver that converts incoming
 * `postMessage` broadcasts (from iframes that publish via the
 * iframe-bridge or from arbitrary `window.parent.postMessage`)
 * into local `broadcast()` calls. Same-origin check enforced.
 *
 * Also handles the inverse: messages forwarded from the parent
 * to iframes are silently ignored when received again on the
 * parent (we tag every fanout with `_fromParent: true`).
 *
 * @internal
 */
export function installBroadcastReceiver(): void {
	window.addEventListener( 'message', ( e: MessageEvent ) => {
		if ( e.origin !== ORIGIN ) {
			return;
		}
		const data = e.data as
			| {
				type?: string;
				topic?: string;
				payload?: unknown;
				_fromParent?: boolean;
			}
			| null
			| undefined;
		if ( ! data || data.type !== POSTMESSAGE_TYPE ) {
			return;
		}
		// Ignore the messages we're sending OUT to iframes — they
		// arrive back on the parent's own handler if the iframe
		// happens to relay (some bridges do). The fanout in
		// `broadcast()` doesn't tag, but iframe re-publishes from
		// the standalone iframe-bridge do; this guard keeps the
		// bus from looping.
		if ( data._fromParent ) {
			return;
		}
		if ( typeof data.topic !== 'string' ) {
			return;
		}
		broadcast( data.topic, data.payload );
	} );
}
