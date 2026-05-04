/**
 * desktop-mode — iframe-side bridge (standalone, enqueueable).
 *
 * Entry point for the `desktop-mode-iframe-bridge` script handle. Any
 * same-origin iframe that enqueues this script gets
 * `wp.desktop.iframe.{ publish, subscribe, onConnection,
 * requestConnection }`.
 *
 * Two ways to load:
 *
 *   1. Enqueue the public handle —
 *      `wp_enqueue_script( 'desktop-mode-iframe-bridge' )`.
 *
 *   2. Set `iframeContent: { bridge: true }` on a native window;
 *      the parent shell auto-injects this bundle via `<script src>`
 *      after the iframe loads (same-origin only).
 *
 * The chromeless bridge embedded in `includes/render.php` ships its
 * own copy of the same logic inline so chromeless wp-admin pages
 * don't need a separate enqueue. Keep the two in sync — any change
 * here must be mirrored there (search for `desktop-mode-bridge-` in
 * `render.php`).
 *
 * Built by Vite to:
 *   - `assets/js/iframe-bridge.js`     (development)
 *   - `assets/js/iframe-bridge.min.js` (production)
 *
 * **Do not hand-edit the built JS — only this TS source.**
 *
 * @since 0.18.0
 */

interface ConnectionRecord {
	id: string;
	topics: string[];
}

type SubscriberCb = (
	payload: unknown,
	meta: { topic: string; connectionId?: string },
) => void;

type ConnectionListenerCb = ( conn: ConnectionRecord ) => void;

interface RequestConnectionOptions {
	topics?: string[];
	timeoutMs?: number;
	onOpen?: ( conn: ConnectionRecord ) => void;
}

/**
 * Iframe-side window-chrome helpers — symmetric with the parent
 * shell's `wp.desktop.applyWindowTheme` / `applyWindowControls` /
 * `applyWindowSlot`. The iframe content can re-theme its own
 * window, reorder controls, or replace a slot without owning a
 * registry entry on the parent side. Each helper just posts to
 * the parent; the parent's iframe-bridge handler routes the
 * message to the appropriate `Window.setAppearance*` method.
 *
 * `setSlot` is HTML-only (sandboxed via `textContent` on the
 * parent) — rich slot renders require a parent-side
 * `registerWindowSlot()` registration. That asymmetry is by
 * design: a malicious or buggy iframe can't smuggle script into
 * the parent shell DOM.
 *
 * @since 0.6.0
 */
interface IframeChromeApi {
	setTheme( tokens: Record< string, string > | null ): void;
	setControls( config: unknown ): void;
	setSlot( name: string, html: string ): void;
}

interface IframeApi {
	publish( topic: string, payload: unknown ): void;
	subscribe( topic: string, cb: SubscriberCb ): () => void;
	onConnection( cb: ConnectionListenerCb ): () => void;
	requestConnection(
		opts: RequestConnectionOptions,
	): Promise< ConnectionRecord >;
	chrome: IframeChromeApi;
}

type WindowChannelCb = (
	payload: unknown,
	meta: { channel: string },
) => void;

interface IframeWp {
	desktop?: {
		iframe?: IframeApi;
		send?: ( channel: string, payload?: unknown ) => void;
		on?: ( channel: string, cb: WindowChannelCb ) => () => void;
	};
}

( function() {
	if ( ! window.parent || window.parent === window ) {
		// Not in an iframe — bridge has nothing to talk to.
		return;
	}

	const w = window as unknown as { wp?: IframeWp };
	if ( w.wp?.desktop?.iframe ) {
		// Already installed (chromeless inline bridge ran first, or
		// a previous load of this script). Don't double-install.
		return;
	}

	const parentOrigin = window.location.origin;
	const connections: Record< string, ConnectionRecord > = {};
	const connectionListeners: ConnectionListenerCb[] = [];
	const subs: Record< string, SubscriberCb[] > = {};

	/**
	 * Per-channel subscribers for the unified window-channel API
	 * (`wp.desktop.send` / `wp.desktop.on`). Distinct from the
	 * connection-bridge `subs` map above — this one fires from
	 * `desktop-mode-window-send` messages the parent posts on
	 * `Window.send( channel, payload )`.
	 */
	const channelSubs: Record< string, WindowChannelCb[] > = {};

	const emitToParent = (
		connectionId: string,
		topic: string,
		payload: unknown,
	): void => {
		try {
			window.parent.postMessage(
				{
					type: 'desktop-mode-bridge-publish',
					connectionId,
					topic,
					payload,
				},
				parentOrigin,
			);
		} catch {
			/* parent gone */
		}
	};

	window.addEventListener( 'message', ( ev: MessageEvent ) => {
		if ( ev.origin !== parentOrigin ) {
			return;
		}
		const data = ev?.data as
			| {
					type?: string;
					connectionId?: string;
					topic?: string;
					payload?: unknown;
					topics?: unknown;
				}
			| null;
		if ( ! data || typeof data !== 'object' || typeof data.type !== 'string' ) {
			return;
		}

		if (
			data.type === 'desktop-mode-bridge-handshake' &&
			typeof data.connectionId === 'string'
		) {
			if ( connections[ data.connectionId ] ) {
				try {
					window.parent.postMessage(
						{
							type: 'desktop-mode-bridge-handshake-ack',
							connectionId: data.connectionId,
						},
						parentOrigin,
					);
				} catch {
					/* swallow */
				}
				return;
			}
			const conn: ConnectionRecord = {
				id: data.connectionId,
				topics: Array.isArray( data.topics ) ? data.topics.slice() : [],
			};
			connections[ conn.id ] = conn;
			try {
				window.parent.postMessage(
					{
						type: 'desktop-mode-bridge-handshake-ack',
						connectionId: conn.id,
					},
					parentOrigin,
				);
			} catch {
				/* swallow */
			}
			for ( const listener of connectionListeners ) {
				try {
					listener( { id: conn.id, topics: conn.topics.slice() } );
				} catch {
					/* swallow listener */
				}
			}
			return;
		}

		if (
			data.type === 'desktop-mode-bridge-publish' &&
			typeof data.topic === 'string'
		) {
			const meta = {
				topic: data.topic,
				connectionId: data.connectionId,
			};
			const bucket = subs[ data.topic ];
			if ( bucket ) {
				for ( const cb of bucket ) {
					try {
						cb( data.payload, meta );
					} catch {
						/* swallow subscriber */
					}
				}
			}
			const wildcard = subs[ '*' ];
			if ( wildcard ) {
				for ( const cb of wildcard ) {
					try {
						cb( data.payload, meta );
					} catch {
						/* swallow */
					}
				}
			}
			return;
		}

		if (
			data.type === 'desktop-mode-bridge-disconnect' &&
			typeof data.connectionId === 'string'
		) {
			delete connections[ data.connectionId ];
		}

		// Unified window-channel delivery from the parent. Fires
		// every `wp.desktop.on( channel, cb )` subscriber for the
		// matching channel.
		if (
			data.type === 'desktop-mode-window-send' &&
			typeof ( data as { channel?: unknown } ).channel === 'string'
		) {
			const d = data as { channel: string; payload?: unknown };
			const meta = { channel: d.channel };
			const bucket = channelSubs[ d.channel ];
			if ( bucket ) {
				for ( const cb of bucket.slice() ) {
					try {
						cb( d.payload, meta );
					} catch {
						/* swallow subscriber */
					}
				}
			}
			const wildcard = channelSubs[ '*' ];
			if ( wildcard ) {
				for ( const cb of wildcard.slice() ) {
					try {
						cb( d.payload, meta );
					} catch {
						/* swallow */
					}
				}
			}
		}
	} );

	const iframeApi: IframeApi = {
		publish( topic, payload ) {
			if ( typeof topic !== 'string' || topic === '' ) {
				return;
			}
			for ( const id of Object.keys( connections ) ) {
				emitToParent( id, topic, payload );
			}
		},
		subscribe( topic, cb ) {
			if (
				typeof topic !== 'string' ||
				topic === '' ||
				typeof cb !== 'function'
			) {
				return () => {};
			}
			let bucket = subs[ topic ];
			if ( ! bucket ) {
				bucket = [];
				subs[ topic ] = bucket;
			}
			bucket.push( cb );
			return () => {
				const i = bucket!.indexOf( cb );
				if ( i >= 0 ) {
					bucket!.splice( i, 1 );
				}
			};
		},
		onConnection( cb ) {
			if ( typeof cb !== 'function' ) {
				return () => {};
			}
			connectionListeners.push( cb );
			// Replay current connections — late subscribers still see
			// who's already there.
			for ( const id of Object.keys( connections ) ) {
				try {
					cb( {
						id: connections[ id ].id,
						topics: connections[ id ].topics.slice(),
					} );
				} catch {
					/* swallow */
				}
			}
			return () => {
				const i = connectionListeners.indexOf( cb );
				if ( i >= 0 ) {
					connectionListeners.splice( i, 1 );
				}
			};
		},
		/**
		 * Iframe-initiated connection request. Asks the parent to open
		 * a connection back to this iframe. Returns a Promise that
		 * resolves with the new `{ id, topics }` once the parent acks
		 * (or rejects on timeout / refusal).
		 *
		 * Parent-side handler: see `src/connection/index.ts`
		 * `handleConnectionRequest` + the
		 * `desktop-mode.iframe.connection-request` filter.
		 */
		chrome: {
			setTheme( tokens ) {
				try {
					window.parent.postMessage(
						{
							type: 'desktop-mode-chrome-theme',
							tokens: tokens ?? {},
						},
						parentOrigin,
					);
				} catch {
					/* parent gone */
				}
			},
			setControls( config ) {
				try {
					window.parent.postMessage(
						{
							type: 'desktop-mode-chrome-controls',
							config: config ?? null,
						},
						parentOrigin,
					);
				} catch {
					/* parent gone */
				}
			},
			setSlot( name, html ) {
				if ( typeof name !== 'string' || name === '' ) {
					return;
				}
				try {
					window.parent.postMessage(
						{
							type: 'desktop-mode-chrome-slot',
							slot: name,
							html: typeof html === 'string' ? html : '',
						},
						parentOrigin,
					);
				} catch {
					/* parent gone */
				}
			},
		},
		requestConnection( opts ) {
			const o = opts ?? {};
			const topics = Array.isArray( o.topics ) ? o.topics.slice() : [];
			const requestId =
				'wpdir-' + Math.random().toString( 36 ).slice( 2, 10 );

			return new Promise< ConnectionRecord >( ( resolve, reject ) => {
				let settled = false;
				const timeoutMs =
					typeof o.timeoutMs === 'number' ? o.timeoutMs : 5000;

				const settle = (
					ok: boolean,
					value: ConnectionRecord | Error,
				): void => {
					if ( settled ) {
						return;
					}
					settled = true;
					window.removeEventListener( 'message', onAck );
					clearTimeout( timer );
					if ( ok ) {
						resolve( value as ConnectionRecord );
					} else {
						reject( value );
					}
				};

				const onAck = ( ev: MessageEvent ): void => {
					if ( ev.origin !== parentOrigin ) {
						return;
					}
					const d = ev?.data as
						| {
								type?: string;
								requestId?: string;
								accepted?: boolean;
								connectionId?: string;
								reason?: string;
							}
						| null;
					if (
						! d ||
						typeof d !== 'object' ||
						d.type !== 'desktop-mode-bridge-connection-ack' ||
						d.requestId !== requestId
					) {
						return;
					}
					if ( d.accepted ) {
						const summary: ConnectionRecord = {
							id:
								typeof d.connectionId === 'string'
									? d.connectionId
									: '',
							topics: topics.slice(),
						};
						if ( typeof o.onOpen === 'function' ) {
							try {
								o.onOpen( summary );
							} catch {
								/* swallow */
							}
						}
						settle( true, summary );
					} else {
						settle( false, new Error( d.reason || 'rejected' ) );
					}
				};
				window.addEventListener( 'message', onAck );

				const timer = setTimeout( () => {
					settle( false, new Error( 'timeout' ) );
				}, timeoutMs );

				try {
					window.parent.postMessage(
						{
							type: 'desktop-mode-bridge-connection-request',
							requestId,
							topics,
						},
						parentOrigin,
					);
				} catch ( err ) {
					settle( false, err as Error );
				}
			} );
		},
	};

	if ( ! w.wp ) {
		w.wp = {};
	}
	if ( ! w.wp.desktop ) {
		w.wp.desktop = {};
	}
	w.wp.desktop.iframe = iframeApi;

	/**
	 * Unified window-channel API. The parent posts on this window
	 * via `Window.send( channel, payload )`; iframe-side handlers
	 * register via `wp.desktop.on( channel, cb )`. Symmetric with
	 * the native render's `windowApi.on()` — plugin authors write
	 * the same code regardless of which side they're on.
	 *
	 * Sending the OTHER way (`wp.desktop.send( channel, payload )`)
	 * posts a `desktop-mode-window-publish` message up to the parent,
	 * where every `Window.on( channel, cb )` subscriber fires.
	 *
	 * @since 0.5.5
	 */
	if ( typeof w.wp.desktop.send !== 'function' ) {
		w.wp.desktop.send = ( channel: string, payload?: unknown ): void => {
			if ( typeof channel !== 'string' || channel === '' ) {
				return;
			}
			try {
				window.parent.postMessage(
					{
						type: 'desktop-mode-window-publish',
						channel,
						payload,
					},
					parentOrigin,
				);
			} catch {
				/* parent gone — silently drop */
			}
		};
	}
	if ( typeof w.wp.desktop.on !== 'function' ) {
		w.wp.desktop.on = (
			channel: string,
			cb: WindowChannelCb,
		): () => void => {
			if (
				typeof channel !== 'string' ||
				channel === '' ||
				typeof cb !== 'function'
			) {
				return () => undefined;
			}
			let bucket = channelSubs[ channel ];
			if ( ! bucket ) {
				bucket = [];
				channelSubs[ channel ] = bucket;
			}
			bucket.push( cb );
			return () => {
				const i = bucket!.indexOf( cb );
				if ( i >= 0 ) {
					bucket!.splice( i, 1 );
				}
			};
		};
	}

	// -----------------------------------------------------------------
	// Screen-meta hoist — Help & Screen Options icons.
	//
	// Pages like `edit.php`, `post.php`, plugins screens etc. ship a
	// `#screen-meta-links` block with the Help and Screen Options
	// buttons. When those exist inside an iframe-windowed admin page,
	// we want them surfaced in the parent window's title bar — the
	// shell renders them via the `desktop-mode-screen-meta` postMessage
	// protocol.
	//
	// Used to live ONLY in the chromeless inline bridge (gated on
	// `desktop_mode_is_chromeless_request()`), so any internal navigation
	// that dropped the `?desktop_mode_chromeless=1` flag silently lost the title-
	// bar icons. This standalone bridge is auto-enqueued on every
	// admin page, so detection runs regardless. A sentinel global
	// (`__desktopModeScreenMetaInstalled`) prevents double-emission
	// when the inline bridge also runs on the same response.
	// -----------------------------------------------------------------
	const sentinelHost = window as unknown as {
		__desktopModeScreenMetaInstalled?: boolean;
	};
	if ( ! sentinelHost.__desktopModeScreenMetaInstalled ) {
		sentinelHost.__desktopModeScreenMetaInstalled = true;
		installScreenMetaHoist( parentOrigin );
	}

	function installScreenMetaHoist( origin: string ): void {
		const start = (): void => {
			const links = document.getElementById( 'screen-meta-links' );
			if ( ! links ) {
				return;
			}
			const screenOptionsBtn = document.getElementById(
				'show-settings-link',
			);
			const helpBtn = document.getElementById( 'contextual-help-link' );
			const panels: string[] = [];
			if ( screenOptionsBtn ) {
				panels.push( 'screen-options' );
			}
			if ( helpBtn ) {
				panels.push( 'help' );
			}
			if ( panels.length === 0 ) {
				return;
			}

			try {
				window.parent.postMessage(
					{ type: 'desktop-mode-screen-meta', panels },
					origin,
				);
			} catch {
				/* parent gone */
			}

			const getOpenPanel = (): 'screen-options' | 'help' | null => {
				if (
					screenOptionsBtn &&
					screenOptionsBtn.getAttribute( 'aria-expanded' ) === 'true'
				) {
					return 'screen-options';
				}
				if (
					helpBtn &&
					helpBtn.getAttribute( 'aria-expanded' ) === 'true'
				) {
					return 'help';
				}
				return null;
			};
			const reportState = (): void => {
				try {
					window.parent.postMessage(
						{
							type: 'desktop-mode-screen-meta-state',
							open: getOpenPanel(),
						},
						origin,
					);
				} catch {
					/* parent gone */
				}
			};
			reportState();

			const observer = new MutationObserver( reportState );
			if ( screenOptionsBtn ) {
				observer.observe( screenOptionsBtn, {
					attributes: true,
					attributeFilter: [ 'aria-expanded' ],
				} );
			}
			if ( helpBtn ) {
				observer.observe( helpBtn, {
					attributes: true,
					attributeFilter: [ 'aria-expanded' ],
				} );
			}

			// WP's `close()` animates and shares `#screen-meta`
			// between both panels, so racing two animated clicks hides
			// the panel that just opened. Jump the other panel to its
			// closed end-state synchronously instead.
			const forceClose = ( button: HTMLElement | null ): void => {
				if ( ! button || button.getAttribute( 'aria-expanded' ) !== 'true' ) {
					return;
				}
				const panelId = button.getAttribute( 'aria-controls' );
				const panel = panelId ? document.getElementById( panelId ) : null;
				if ( ! panel ) {
					return;
				}
				const jq = ( window as unknown as {
					jQuery?: ( el: HTMLElement ) => { stop: ( c: boolean, j: boolean ) => unknown };
				} ).jQuery;
				if ( jq ) {
					try {
						jq( panel ).stop( true, false );
					} catch {
						/* swallow */
					}
				}
				panel.style.display = 'none';
				panel.classList.add( 'hidden' );
				if ( panel.parentElement ) {
					panel.parentElement.style.display = 'none';
				}
				button.classList.remove( 'screen-meta-active' );
				button.setAttribute( 'aria-expanded', 'false' );
				const toggles = document.querySelectorAll< HTMLElement >(
					'.screen-meta-toggle',
				);
				toggles.forEach( ( t ) => {
					t.style.visibility = '';
				} );
			};

			window.addEventListener( 'message', ( e: MessageEvent ) => {
				if ( e.origin !== origin ) {
					return;
				}
				const d = e.data as { type?: string; panel?: string } | null;
				if ( ! d || d.type !== 'desktop-mode-toggle-panel' ) {
					return;
				}
				let target: HTMLElement | null = null;
				if ( d.panel === 'screen-options' && screenOptionsBtn ) {
					target = screenOptionsBtn;
				} else if ( d.panel === 'help' && helpBtn ) {
					target = helpBtn;
				}
				if ( ! target ) {
					return;
				}
				if ( target.getAttribute( 'aria-expanded' ) !== 'true' ) {
					forceClose(
						target === screenOptionsBtn ? helpBtn : screenOptionsBtn,
					);
				}
				target.click();
			} );
		};

		// `screen-meta-links` is rendered server-side, so by the time
		// any module-level script runs in the body the element already
		// exists. But a `defer`-loaded script can fire before
		// `DOMContentLoaded` on some pages — gate accordingly.
		if ( document.readyState === 'loading' ) {
			document.addEventListener( 'DOMContentLoaded', start, { once: true } );
		} else {
			start();
		}
	}
}() );
