/**
 * Cross-window connection bridge.
 *
 * Plugins use `wp.desktop.connect( windowId )` to open a typed
 * pub/sub channel with any open window's content — iframe or
 * native, the API is the same. The shell only routes; topic
 * semantics are plugin-defined.
 *
 * Wire model — iframe windows:
 *
 *   parent shell ─[postMessage]─▶ iframe (wp-desktop-bridge-handshake)
 *                                            │ chromeless-bridge installs handlers
 *                                            ▼
 *                                       handshake-ack
 *   parent shell ◀─[postMessage]── iframe
 *
 * Wire model — native windows:
 *
 *   parent shell ──▶ in-process `dispatchToNative`/`dispatchFromWindow`
 *                    on `src/window-channels.ts`
 *
 * After setup, both kinds of `connect()` look identical to the
 * caller: `publish( topic, payload )` reaches the other side, and
 * `subscribe( topic, cb )` fires on every inbound match. Plugin
 * authors don't need to know whether their target is an iframe or
 * a native window — that's the whole point.
 *
 * @since 0.17.0
 */

import { applyFilters, doAction, HOOKS } from './../hooks';
import type { WindowManager } from './../window-manager';
import {
	addParentSubscriber,
	dispatchToNative,
	type WindowChannelCb,
} from './../window-channels';

const INITIAL_ORIGIN = window.location.origin;

export interface ConnectOptions {
	/**
	 * Topics the parent wants to subscribe to. The handshake forwards
	 * the list to the iframe so it can decide whether to start
	 * publishing (idle if nobody's listening). Use `'*'` for a
	 * wildcard subscription — useful for debug consoles, expensive
	 * for production traffic.
	 */
	topics?: string[];
	/** Fires when the iframe acks the handshake. */
	onOpen?: () => void;
	/**
	 * Fires when either side disconnects, or the target window
	 * closes / navigates. The reason lets observability code distinguish
	 * deliberate teardown from window churn.
	 */
	onClose?: ( reason: 'disconnect' | 'window-closed' | 'navigated' ) => void;
}

export interface WindowConnection {
	/** Globally unique id for this connection. */
	readonly id: string;
	/** Window id this connection targets. */
	readonly target: string;
	/** Whether the iframe has acked the handshake. */
	isOpen(): boolean;
	/**
	 * Subscribe to a topic. Returns an unsubscribe function. Multiple
	 * subscribers per topic are supported; use the wildcard `'*'`
	 * topic to receive every published payload (slug-prefixed).
	 */
	subscribe< T = unknown >(
		topic: string,
		cb: ( payload: T, meta: { topic: string } ) => void,
	): () => void;
	/**
	 * Publish a payload to the iframe. Messages sent before the
	 * iframe acks are queued and flushed in order.
	 */
	send< T = unknown >( topic: string, payload: T ): void;
	/** Tear the connection down. Idempotent. */
	disconnect(): void;
}

interface InternalConnection extends WindowConnection {
	_targetWindow: () => HTMLIFrameElement | null;
	_handleIframeMessage( data: unknown ): void;
	_destroy( reason: 'disconnect' | 'window-closed' | 'navigated' ): void;
}

let _connSeq = 0;
const _connections = new Map< string, InternalConnection >();
const _connectionsByTarget = new Map< string, Set< string > >();

/**
 * Registry of iframes that aren't on the `Window.iframe` slot but
 * still participate in the connection bridge — typically a native
 * window whose body is a single iframe via the `iframeContent`
 * shorthand. The lookup in `connect()` consults this registry
 * first, falling back to `win.iframe`.
 *
 * @internal
 */
const _syntheticIframes = new Map< string, HTMLIFrameElement >();

/**
 * Register a synthetic iframe under a window id. Returns an
 * unregister function — the synthesised render calls this on
 * teardown so closed windows don't leak stale iframe references.
 *
 * @internal
 */
export function registerSyntheticIframe(
	windowId: string,
	iframe: HTMLIFrameElement,
): () => void {
	_syntheticIframes.set( windowId, iframe );
	return () => {
		if ( _syntheticIframes.get( windowId ) === iframe ) {
			_syntheticIframes.delete( windowId );
		}
	};
}

/**
 * Look up a synthetic iframe by window id. Used by `Window.send()`
 * to route messages into the body iframe of native windows that
 * registered an `iframeContent` block.
 *
 * @internal
 */
export function getSyntheticIframe(
	windowId: string,
): HTMLIFrameElement | null {
	return _syntheticIframes.get( windowId ) ?? null;
}

/**
 * Generate a unique connection id. Cheap counter — these don't need
 * to be globally unique across browser tabs (they're scoped to a
 * single shell instance).
 */
function nextId(): string {
	return `wp-desktop-conn-${ ++_connSeq }`;
}

/**
 * Factory that binds the connect API to the live window manager.
 * Returns the public `connect` function plus an internal
 * `routeIncomingFromIframe` that the iframe-bridge handler calls
 * for every `wp-desktop-bridge-*` message.
 */
export function createConnectionBridge( manager: WindowManager ) {
	const sendToIframe = (
		win: HTMLIFrameElement,
		message: unknown,
	): void => {
		try {
			win.contentWindow?.postMessage( message, INITIAL_ORIGIN );
		} catch ( err ) {
			if ( typeof console !== 'undefined' ) {
				console.error(
					'[wp-desktop-mode] connection: postMessage failed',
					err,
				);
			}
		}
	};

	const connect = (
		targetWindowId: string,
		opts: ConnectOptions = {},
	): WindowConnection => {
		const id = nextId();
		const topics = Array.isArray( opts.topics ) ? [ ...opts.topics ] : [];
		const subs = new Map< string, Set<( payload: unknown, meta: { topic: string } ) => void > >();
		const queue: { topic: string; payload: unknown }[] = [];
		let isOpen = false;
		let destroyed = false;

		const targetIframe = (): HTMLIFrameElement | null => {
			// Prefer a synthesised iframe (native window with
			// `iframeContent`) over the Window class's own iframe
			// slot — native windows never set the latter, but their
			// `iframeContent` body still wants bridge participation.
			const synth = _syntheticIframes.get( targetWindowId );
			if ( synth ) {
				return synth;
			}
			const w = manager.getById( targetWindowId );
			return w?.iframe ?? null;
		};

		/**
		 * Pure-native target — no iframe at all, neither real nor
		 * synthetic. We route through the in-process channel bus
		 * (`src/window-channels.ts`), which the native render's
		 * `windowApi.send` / `windowApi.on` also feed.
		 */
		const isNativeTarget = (): boolean => {
			if ( targetIframe() ) {
				return false;
			}
			const w = manager.getById( targetWindowId );
			return !! w && w.config?.native === true;
		};
		// Parent-side subscriptions installed against the channel bus
		// (used only when the target is pure native). Tracked so we
		// can drop them on disconnect.
		const nativeSubUnsubs: Array< () => void > = [];

		const flushQueue = (): void => {
			const iframe = targetIframe();
			if ( ! iframe ) {
				return;
			}
			while ( queue.length ) {
				const msg = queue.shift()!;
				sendToIframe( iframe, {
					type: 'wp-desktop-bridge-publish',
					connectionId: id,
					topic: msg.topic,
					payload: msg.payload,
				} );
			}
		};

		const conn: InternalConnection = {
			id,
			target: targetWindowId,
			isOpen: () => isOpen,
			subscribe( topic, cb ) {
				const wrapped = cb as ( p: unknown, m: { topic: string } ) => void;
				// Native target — feed the channel bus directly so
				// the native render's `windowApi.send( topic )` lands
				// here. Iframe target — keep the existing
				// connection-scoped registry.
				if ( isNativeTarget() ) {
					const off = addParentSubscriber(
						targetWindowId,
						topic,
						( ( payload: unknown, meta ) => {
							doAction( HOOKS.CONNECTION_MESSAGE, {
								connectionId: id,
								topic: meta.channel,
								direction: 'in',
							} );
							try {
								wrapped( payload, { topic: meta.channel } );
							} catch ( err ) {
								if ( typeof console !== 'undefined' ) {
									console.error(
										'[wp-desktop-mode] connection subscriber threw:',
										err,
									);
								}
							}
						} ) as WindowChannelCb,
					);
					nativeSubUnsubs.push( off );
					return off;
				}
				let bucket = subs.get( topic );
				if ( ! bucket ) {
					bucket = new Set();
					subs.set( topic, bucket );
				}
				bucket.add( wrapped );
				return () => {
					bucket?.delete( wrapped );
				};
			},
			send( topic, payload ) {
				if ( destroyed ) {
					return;
				}
				doAction( HOOKS.CONNECTION_MESSAGE, {
					connectionId: id,
					topic,
					direction: 'out',
				} );
				// Native target — dispatch in-process to the render's
				// `windowApi.on( topic )` listeners.
				if ( isNativeTarget() ) {
					dispatchToNative( targetWindowId, topic, payload );
					return;
				}
				if ( ! isOpen ) {
					queue.push( { topic, payload } );
					return;
				}
				const iframe = targetIframe();
				if ( ! iframe ) {
					return;
				}
				sendToIframe( iframe, {
					type: 'wp-desktop-bridge-publish',
					connectionId: id,
					topic,
					payload,
				} );
			},
			disconnect() {
				conn._destroy( 'disconnect' );
			},
			_targetWindow: targetIframe,
			_handleIframeMessage( data ) {
				if ( ! data || typeof data !== 'object' ) {
					return;
				}
				const msg = data as { type?: string };
				if ( msg.type === 'wp-desktop-bridge-handshake-ack' ) {
					if ( isOpen ) {
						return;
					}
					isOpen = true;
					doAction( HOOKS.CONNECTION_OPENED, {
						connectionId: id,
						targetWindowId,
						topics,
					} );
					try {
						opts.onOpen?.();
					} catch ( err ) {
						if ( typeof console !== 'undefined' ) {
							console.error(
								'[wp-desktop-mode] connection.onOpen threw:',
								err,
							);
						}
					}
					flushQueue();
					return;
				}
				if ( msg.type === 'wp-desktop-bridge-publish' ) {
					const m = data as {
						topic?: string;
						payload?: unknown;
					};
					const topic = typeof m.topic === 'string' ? m.topic : '';
					if ( ! topic ) {
						return;
					}
					doAction( HOOKS.CONNECTION_MESSAGE, {
						connectionId: id,
						topic,
						direction: 'in',
					} );
					const exact = subs.get( topic );
					if ( exact ) {
						for ( const cb of Array.from( exact ) ) {
							try {
								cb( m.payload, { topic } );
							} catch ( err ) {
								if ( typeof console !== 'undefined' ) {
									console.error(
										'[wp-desktop-mode] connection subscriber threw:',
										err,
									);
								}
							}
						}
					}
					const wildcard = subs.get( '*' );
					if ( wildcard ) {
						for ( const cb of Array.from( wildcard ) ) {
							try {
								cb( m.payload, { topic } );
							} catch ( err ) {
								if ( typeof console !== 'undefined' ) {
									console.error(
										'[wp-desktop-mode] connection wildcard subscriber threw:',
										err,
									);
								}
							}
						}
					}
					return;
				}
				if ( msg.type === 'wp-desktop-bridge-disconnect' ) {
					conn._destroy( 'disconnect' );
				}
			},
			_destroy( reason ) {
				if ( destroyed ) {
					return;
				}
				destroyed = true;
				const wasOpen = isOpen;
				isOpen = false;
				_connections.delete( id );
				const targetSet = _connectionsByTarget.get( targetWindowId );
				if ( targetSet ) {
					targetSet.delete( id );
					if ( targetSet.size === 0 ) {
						_connectionsByTarget.delete( targetWindowId );
					}
				}
				// Native subscribers — drop the channel-bus handles so
				// late dispatches don't fire stale callbacks.
				for ( const off of nativeSubUnsubs.splice( 0 ) ) {
					try {
						off();
					} catch {
						/* swallow */
					}
				}
				// Notify the iframe — best-effort, the window may have
				// already closed.
				if ( wasOpen ) {
					const iframe = targetIframe();
					if ( iframe ) {
						sendToIframe( iframe, {
							type: 'wp-desktop-bridge-disconnect',
							connectionId: id,
						} );
					}
				}
				doAction( HOOKS.CONNECTION_CLOSED, {
					connectionId: id,
					reason,
				} );
				try {
					opts.onClose?.( reason );
				} catch ( err ) {
					if ( typeof console !== 'undefined' ) {
						console.error(
							'[wp-desktop-mode] connection.onClose threw:',
							err,
						);
					}
				}
			},
		};

		_connections.set( id, conn );
		let bucket = _connectionsByTarget.get( targetWindowId );
		if ( ! bucket ) {
			bucket = new Set();
			_connectionsByTarget.set( targetWindowId, bucket );
		}
		bucket.add( id );

		// Native target — no handshake needed. Open synchronously
		// and fire `onOpen` next tick so async-style callers don't
		// see a re-entrant fire from inside `connect()` itself.
		if ( isNativeTarget() ) {
			Promise.resolve().then( () => {
				if ( destroyed || isOpen ) {
					return;
				}
				isOpen = true;
				doAction( HOOKS.CONNECTION_OPENED, {
					connectionId: id,
					targetWindowId,
					topics,
				} );
				try {
					opts.onOpen?.();
				} catch ( err ) {
					if ( typeof console !== 'undefined' ) {
						console.error(
							'[wp-desktop-mode] connection.onOpen threw:',
							err,
						);
					}
				}
			} );
			return conn;
		}

		// Send the handshake. Iframes that haven't loaded yet won't
		// have a `contentWindow`; the chromeless bridge replays
		// pending handshakes after `wp-desktop-ready` (see
		// `replayPendingHandshakes` below — wired in `desktop.ts` on
		// IFRAME_READY).
		const iframe = targetIframe();
		if ( iframe ) {
			sendToIframe( iframe, {
				type: 'wp-desktop-bridge-handshake',
				connectionId: id,
				topics,
			} );
		}

		return conn;
	};

	/**
	 * Called from `iframe-bridge.ts` for every
	 * `wp-desktop-bridge-*` message. Routes to the right connection
	 * by id; silently drops messages whose connection is gone.
	 *
	 * Iframe-initiated connection requests (`requestConnection()`)
	 * arrive here too — they carry a `requestId` instead of a
	 * `connectionId`. The shell fires
	 * `HOOKS.IFRAME_CONNECTION_REQUEST` with `accept()` / `reject()`
	 * helpers; if no subscriber decides, the next-tick filter
	 * defaults to accept.
	 *
	 * `windowId` identifies the window the message came from — the
	 * iframe-bridge handler in `src/window/iframe-bridge.ts` looks
	 * it up by matching `event.source` against each Window's
	 * `iframe.contentWindow`.
	 */
	const routeIncomingFromIframe = ( data: unknown, windowId?: string ): void => {
		if ( ! data || typeof data !== 'object' ) {
			return;
		}
		const msg = data as {
			type?: string;
			connectionId?: string;
			requestId?: string;
			topics?: unknown;
		};
		if ( typeof msg.type !== 'string' || ! msg.type.startsWith( 'wp-desktop-bridge-' ) ) {
			return;
		}

		// Iframe-initiated connection request — open a connection
		// back to this iframe unless a plugin rejects.
		if (
			msg.type === 'wp-desktop-bridge-connection-request' &&
			typeof msg.requestId === 'string' &&
			typeof windowId === 'string' &&
			windowId !== ''
		) {
			handleConnectionRequest( windowId, msg.requestId, Array.isArray( msg.topics ) ? ( msg.topics as string[] ) : [] );
			return;
		}

		if ( typeof msg.connectionId !== 'string' ) {
			return;
		}
		const conn = _connections.get( msg.connectionId );
		conn?._handleIframeMessage( data );
	};

	const handleConnectionRequest = (
		windowId: string,
		requestId: string,
		topics: string[],
	): void => {
		const synth = _syntheticIframes.get( windowId );
		const iframe = synth ?? manager.getById( windowId )?.iframe ?? null;
		if ( ! iframe ) {
			return;
		}

		/**
		 * Filter — `false` to reject the request, an object
		 * `{ topics }` to accept (optionally narrowing the topic
		 * list), `true` / `undefined` for the default
		 * accept-with-original-topics.
		 *
		 * @since 0.18.0
		 *
		 * @param {boolean|Object} accept Default `true` (accept).
		 * @param {Object}         ctx    `{ windowId, requestId, topics }`.
		 */
		const decision: unknown = applyFilters(
			HOOKS.IFRAME_CONNECTION_REQUEST,
			true as boolean | { topics: string[] },
			{ windowId, requestId, topics: topics.slice() },
		);

		if ( decision === false ) {
			try {
				iframe.contentWindow?.postMessage( {
					type: 'wp-desktop-bridge-connection-ack',
					requestId,
					accepted: false,
					reason: 'rejected',
				}, INITIAL_ORIGIN );
			} catch { /* swallow */ }
			return;
		}

		const finalTopics = decision && typeof decision === 'object' && Array.isArray( ( decision as { topics?: unknown } ).topics )
			? ( decision as { topics: string[] } ).topics
			: topics;

		const conn = connect( windowId, { topics: finalTopics } );

		try {
			iframe.contentWindow?.postMessage( {
				type: 'wp-desktop-bridge-connection-ack',
				requestId,
				accepted: true,
				connectionId: conn.id,
			}, INITIAL_ORIGIN );
		} catch { /* swallow */ }
	};

	/**
	 * Re-send pending handshakes when an iframe becomes ready. The
	 * shell calls this on `HOOKS.IFRAME_READY` so connections opened
	 * before the iframe finished loading still complete.
	 */
	const onIframeReady = ( windowId: string ): void => {
		const bucket = _connectionsByTarget.get( windowId );
		if ( ! bucket ) {
			return;
		}
		for ( const connId of Array.from( bucket ) ) {
			const conn = _connections.get( connId );
			if ( ! conn || conn.isOpen() ) {
				continue;
			}
			const iframe = conn._targetWindow();
			if ( ! iframe ) {
				continue;
			}
			sendToIframe( iframe, {
				type: 'wp-desktop-bridge-handshake',
				connectionId: conn.id,
				topics: [], // already negotiated client-side; iframe re-uses
			} );
		}
	};

	/**
	 * Tear down every connection targeting `windowId` — called by the
	 * shell on window close so connections to a vanished window
	 * don't leak.
	 */
	const onWindowClosed = ( windowId: string ): void => {
		const bucket = _connectionsByTarget.get( windowId );
		if ( ! bucket ) {
			return;
		}
		for ( const connId of Array.from( bucket ) ) {
			const conn = _connections.get( connId );
			conn?._destroy( 'window-closed' );
		}
	};

	return { connect, routeIncomingFromIframe, onIframeReady, onWindowClosed };
}
