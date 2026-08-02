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
 * The chromeless bridge embedded in `includes/render/chromeless-bridge.php`
 * ships its own copy of the same logic inline so chromeless wp-admin
 * pages don't need a separate enqueue. Keep the two in sync — any
 * change here must be mirrored there (search for `desktop-mode-bridge-`
 * in `chromeless-bridge.php`).
 *
 * Built by Vite to:
 *   - `assets/js/iframe-bridge.js`     (development)
 *   - `assets/js/iframe-bridge.min.js` (production)
 *
 * **Do not hand-edit the built JS — only this TS source.**
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
	/**
	 * The id of the window the parent shell opened to host this
	 * iframe. Populated after the first connection handshake from
	 * the parent (the handshake message now carries
	 * `targetWindowId`). `null` until then.
	 *
	 * Replaces the brittle `iframe.contentWindow ===` walk plugins
	 * had to do parent-side; iframe code can now self-identify
	 * (e.g. `wp.desktop.iframe.publish('focus-changed', {windowId:
	 * wp.desktop.iframe.windowId})`).
	 */
	readonly windowId: string | null;
	/**
	 * Resolve once `windowId` is populated by the first handshake.
	 * Resolves immediately if already known.
	 */
	whenWindowId(): Promise< string >;
	/**
	 * Whether the parent frame is same-origin and reachable. All
	 * bridge messages (handshakes, publishes, drag-bridge, OS-file
	 * forwarder) hard-filter on `window.location.origin`; a cross-
	 * origin parent silently drops everything we post. Use this
	 * predicate to fail fast / degrade gracefully instead of
	 * debugging vanishing messages:
	 *
	 * ```js
	 * if ( ! wp.desktop.iframe.isParentReachable() ) {
	 *     // Cross-origin parent — bridge can't operate. Fall back
	 *     // to in-iframe UI or skip the feature entirely.
	 *     return;
	 * }
	 * ```
	 *
	 * Returns `true` when:
	 *   - There IS a parent (we're in an iframe, not the top frame).
	 *   - The parent's origin matches ours (same-origin).
	 *
	 * Returns `false` when:
	 *   - Top frame (`window.parent === window`).
	 *   - Parent is cross-origin (accessing `window.parent.location`
	 *     throws). Includes most Gutenberg `srcdoc` canvases that
	 *     inherited a different origin, sandboxed iframes, PWA
	 *     wrappers loading desktop-mode in a foreign frame.
	 */
	isParentReachable(): boolean;
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

/**
 * Editor-autosave query handler — answers the parent shell's
 * `desktop-mode-editor-autosave-request` (sent by the editor-preview
 * module before opening the front-end preview) with a
 * `desktop-mode-editor-autosave-response`.
 *
 * Installed OUTSIDE the double-install guard below: on chromeless
 * wp-admin pages the inline chromeless bridge installs
 * `wp.desktop.iframe` first and this bundle's main listener bails,
 * but the autosave handler only lives here (not in the inline
 * bridge), so it must register regardless. Its own dedupe flag
 * protects against a double enqueue.
 *
 * Editor detection, in order:
 *  - Gutenberg — prefer `__unstableSaveForPreview()` (what core's own
 *    Preview button calls: autosaves when needed, resolves to the
 *    freshest preview link). Fallback: `isEditedPostAutosaveable()`
 *    → `not-dirty`, else `autosave()` watched via `wp.data.subscribe`.
 *  - Classic editor — `wp.autosave.server.triggerSave()` +
 *    `after-autosave` jQuery event, 5 s best-effort fallback.
 *  - Neither — `no-editor`, immediately, so the parent never waits on
 *    a list table or settings page that has nothing to save.
 *
 * The same listener also serves the LIVE-preview watch
 * (`desktop-mode-editor-live-watch` / `-unwatch`): while a preview
 * companion is open, the shell asks this page to watch its own editor
 * for content changes — block-list / title reference changes in
 * Gutenberg, the `after-autosave` event in classic — and, debounced
 * after the typing pause, autosave and announce
 * `desktop-mode-editor-live-saved` so the shell reloads the preview.
 * Typing detection has to live iframe-side: keystrokes never cross
 * the frame boundary.
 *
 * Exported for tests (entry exports land on the
 * `desktopModeIframeBridge` IIFE global — no runtime consumers).
 */
export function installEditorAutosaveHandler(): void {
	const flagged = window as unknown as {
		__desktopModeEditorAutosaveInstalled?: boolean;
	};
	if ( flagged.__desktopModeEditorAutosaveInstalled ) {
		return;
	}
	flagged.__desktopModeEditorAutosaveInstalled = true;

	const origin = window.location.origin;

	interface EditorSelect {
		isEditedPostAutosaveable?: () => boolean;
		isEditedPostDirty?: () => boolean;
		isAutosavingPost?: () => boolean;
		isSavingPost?: () => boolean;
		getEditedPostAttribute?: ( attr: string ) => unknown;
	}
	interface BlockEditorSelect {
		getBlocks?: () => unknown;
	}
	interface EditorDispatch {
		__unstableSaveForPreview?: () => Promise< unknown > | unknown;
		autosave?: () => unknown;
	}
	interface EditorWp {
		data?: {
			select?: (
				store: string,
			) => ( EditorSelect & BlockEditorSelect ) | undefined;
			dispatch?: ( store: string ) => EditorDispatch | undefined;
			subscribe?: ( cb: () => void ) => () => void;
		};
		autosave?: {
			server?: { triggerSave?: () => void };
		};
	}

	const getEditorWp = (): EditorWp | undefined =>
		( window as unknown as { wp?: EditorWp } ).wp;

	// Same-origin gate for editor-supplied links — the parent
	// re-validates, but a clean contract beats relying on it.
	const sameOriginLink = ( link: unknown ): string | undefined => {
		if ( typeof link !== 'string' || link === '' ) {
			return undefined;
		}
		try {
			return new URL( link, origin ).origin === origin
				? link
				: undefined;
		} catch {
			return undefined;
		}
	};

	const postToParent = ( message: Record< string, unknown > ): void => {
		try {
			window.parent.postMessage( message, origin );
		} catch {
			/* parent gone */
		}
	};

	/** Active live-preview watches, keyed by the parent's watchId. */
	const liveWatches: Map< string, () => void > = new Map();

	/**
	 * Start watching the editor for content changes; on each debounced
	 * settle, autosave and announce `desktop-mode-editor-live-saved`.
	 * Returns a teardown, or `null` when no watchable editor exists.
	 */
	const startLiveWatch = (
		watchId: string,
		debounceMs: number,
	): ( () => void ) | null => {
		const editorWp = getEditorWp();
		const select = editorWp?.data?.select?.( 'core/editor' );

		if ( select && typeof editorWp?.data?.subscribe === 'function' ) {
			const blockSelect = editorWp.data.select?.( 'core/block-editor' );
			const dispatch = editorWp.data.dispatch?.( 'core/editor' );
			let timer: number | null = null;
			let stopped = false;
			// Change detection by REFERENCE, not content serialization:
			// Gutenberg replaces the block list (and the edited title
			// string) on every USER edit. But a completing save also
			// churns these references (the save response normalizes
			// the entity and resyncs the block list) — treating that
			// as an edit produced a save → churn → save feedback loop
			// (drafts autosave in place, so Gutenberg considers them
			// forever autosaveable). Three guards below break it:
			//
			//  1. While a save/autosave is in flight (and on its
			//     settle tick), churn is ABSORBED into the baseline
			//     without scheduling.
			//  2. A ref change only schedules when the post is DIRTY
			//     — user edits set dirty synchronously; a draft's
			//     completed in-place autosave clears it.
			//  3. `save()` bails when Gutenberg reports nothing to
			//     autosave (`isEditedPostAutosaveable()` false) —
			//     covers published posts, which stay dirty relative
			//     to published content after an autosave revision.
			let lastBlocks = blockSelect?.getBlocks?.();
			let lastTitle = select.getEditedPostAttribute?.( 'title' );
			let absorbSettleTick = false;

			const save = (): void => {
				timer = null;
				if ( stopped ) {
					return;
				}
				// A save is already on the wire (the user hit Update,
				// or a previous live autosave hasn't landed) — retry
				// shortly instead of stacking parallel requests.
				if (
					( select.isSavingPost?.() ?? false ) ||
					( select.isAutosavingPost?.() ?? false )
				) {
					timer = window.setTimeout( save, 1000 );
					return;
				}
				// Guard 3: nothing new since the last autosave — a
				// save would write nothing and the preview already
				// shows this content. No save, no refresh nudge.
				if (
					typeof select.isEditedPostAutosaveable === 'function' &&
					! select.isEditedPostAutosaveable()
				) {
					return;
				}
				if ( typeof dispatch?.__unstableSaveForPreview === 'function' ) {
					Promise.resolve( dispatch.__unstableSaveForPreview() )
						.then( ( link ) => {
							if ( ! stopped ) {
								postToParent( {
									type: 'desktop-mode-editor-live-saved',
									watchId,
									...( sameOriginLink( link )
										? { previewUrl: sameOriginLink( link ) }
										: {} ),
								} );
							}
						} )
						.catch( () => {
							/* Transient — the next edit retries. */
						} );
					return;
				}
				if ( typeof dispatch?.autosave === 'function' ) {
					void dispatch.autosave();
					postToParent( {
						type: 'desktop-mode-editor-live-saved',
						watchId,
					} );
				}
			};

			const unsubscribe = editorWp.data.subscribe( () => {
				const blocks = blockSelect?.getBlocks?.();
				const title = select.getEditedPostAttribute?.( 'title' );

				// Guard 1: save-driven churn. Adopt whatever the save
				// resynced as the new baseline — it isn't an edit.
				const saving =
					( select.isSavingPost?.() ?? false ) ||
					( select.isAutosavingPost?.() ?? false );
				if ( saving ) {
					lastBlocks = blocks;
					lastTitle = title;
					absorbSettleTick = true;
					return;
				}
				if ( absorbSettleTick ) {
					// The first tick AFTER a save completes carries
					// the entity-update churn — absorb it too.
					absorbSettleTick = false;
					lastBlocks = blocks;
					lastTitle = title;
					return;
				}

				if ( blocks === lastBlocks && title === lastTitle ) {
					return;
				}
				lastBlocks = blocks;
				lastTitle = title;

				// Guard 2: reference churn without a dirty post is
				// normalization noise, not typing.
				if (
					typeof select.isEditedPostDirty === 'function' &&
					! select.isEditedPostDirty()
				) {
					return;
				}

				if ( timer !== null ) {
					window.clearTimeout( timer );
				}
				timer = window.setTimeout( save, debounceMs );
			} );

			return () => {
				stopped = true;
				unsubscribe();
				if ( timer !== null ) {
					window.clearTimeout( timer );
					timer = null;
				}
			};
		}

		// Classic editor: no reactive store to watch — ride the
		// heartbeat-driven autosave core already runs (~60 s) and
		// announce after each round-trip.
		if ( editorWp?.autosave?.server ) {
			const jqWindow = window as unknown as {
				jQuery?: ( el: Document ) => {
					on: ( evt: string, cb: () => void ) => void;
					off: ( evt: string ) => void;
				};
			};
			const jq = jqWindow.jQuery;
			if ( ! jq ) {
				return null;
			}
			const eventName = `after-autosave.desktop-mode-live-${ watchId }`;
			jq( document ).on( eventName, () => {
				postToParent( {
					type: 'desktop-mode-editor-live-saved',
					watchId,
				} );
			} );
			return () => {
				jq( document ).off( eventName );
			};
		}

		return null;
	};

	window.addEventListener( 'message', ( ev: MessageEvent ) => {
		if ( ev.origin !== origin ) {
			return;
		}
		const data = ev?.data as {
			type?: unknown;
			requestId?: unknown;
			watchId?: unknown;
			debounceMs?: unknown;
		} | null;
		if ( ! data || typeof data !== 'object' ) {
			return;
		}

		if (
			data.type === 'desktop-mode-editor-live-watch' &&
			typeof data.watchId === 'string'
		) {
			// Replace an existing watch with the same id (an unwatch
			// that got lost) instead of stacking two.
			liveWatches.get( data.watchId )?.();
			liveWatches.delete( data.watchId );
			const debounceMs = Math.min(
				30000,
				Math.max(
					500,
					typeof data.debounceMs === 'number' ? data.debounceMs : 1500,
				),
			);
			try {
				const teardown = startLiveWatch( data.watchId, debounceMs );
				if ( teardown ) {
					liveWatches.set( data.watchId, teardown );
				}
			} catch {
				/* Editor stores shaped differently — live mode off. */
			}
			return;
		}

		if (
			data.type === 'desktop-mode-editor-live-unwatch' &&
			typeof data.watchId === 'string'
		) {
			try {
				liveWatches.get( data.watchId )?.();
			} catch {
				/* already torn down */
			}
			liveWatches.delete( data.watchId );
			return;
		}

		if (
			data.type !== 'desktop-mode-editor-autosave-request' ||
			typeof data.requestId !== 'string'
		) {
			return;
		}
		const requestId = data.requestId;

		let responded = false;
		const respond = (
			status: 'saved' | 'no-editor' | 'not-dirty' | 'error',
			previewUrl?: string,
		): void => {
			if ( responded ) {
				return;
			}
			responded = true;
			try {
				window.parent.postMessage(
					{
						type: 'desktop-mode-editor-autosave-response',
						requestId,
						status,
						...( previewUrl ? { previewUrl } : {} ),
					},
					origin,
				);
			} catch {
				/* parent gone */
			}
		};

		try {
			const editorWp = getEditorWp();
			const select = editorWp?.data?.select?.( 'core/editor' );

			if ( select ) {
				const dispatch = editorWp?.data?.dispatch?.( 'core/editor' );

				if ( typeof dispatch?.__unstableSaveForPreview === 'function' ) {
					Promise.resolve( dispatch.__unstableSaveForPreview() )
						.then( ( link ) => {
							respond( 'saved', sameOriginLink( link ) );
						} )
						.catch( () => respond( 'error' ) );
					return;
				}

				if (
					typeof select.isEditedPostAutosaveable === 'function' &&
					! select.isEditedPostAutosaveable()
				) {
					respond( 'not-dirty' );
					return;
				}

				if (
					typeof dispatch?.autosave === 'function' &&
					typeof editorWp?.data?.subscribe === 'function'
				) {
					let sawAutosaving = false;
					const unsubscribe = editorWp.data.subscribe( () => {
						const saving = select.isAutosavingPost?.() ?? false;
						if ( saving ) {
							sawAutosaving = true;
							return;
						}
						if ( sawAutosaving ) {
							unsubscribe();
							respond( 'saved' );
						}
					} );
					// Best-effort backstop — if the autosave never
					// round-trips, answer anyway; the preview then
					// shows the last saved revision.
					window.setTimeout( () => {
						unsubscribe();
						respond( 'saved' );
					}, 8000 );
					void dispatch.autosave();
					return;
				}

				respond( 'no-editor' );
				return;
			}

			// Classic editor.
			const triggerSave = editorWp?.autosave?.server?.triggerSave;
			if ( typeof triggerSave === 'function' ) {
				const jqWindow = window as unknown as {
					jQuery?: (
						el: Document,
					) => { one: ( evt: string, cb: () => void ) => void };
				};
				const jq = jqWindow.jQuery;
				if ( jq ) {
					jq( document ).one( 'after-autosave.desktop-mode-editor-preview', () =>
						respond( 'saved' ),
					);
				}
				// Best-effort backstop — classic autosave has no
				// promise; without jQuery (or if the event never
				// fires) answer after its usual round-trip window.
				window.setTimeout( () => respond( 'saved' ), 5000 );
				triggerSave.call( editorWp?.autosave?.server );
				return;
			}

			respond( 'no-editor' );
		} catch {
			respond( 'error' );
		}
	} );
}

( function() {
	if ( ! window.parent || window.parent === window ) {
		// Not in an iframe — bridge has nothing to talk to.
		return;
	}

	installEditorAutosaveHandler();

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
	 * The host window's id, learned from the first
	 * `desktop-mode-bridge-handshake` the parent sends. `null` until
	 * the parent connects; resolves through
	 * {@link IframeApi.whenWindowId} for callers that need a wait.
	 */
	let _windowId: string | null = null;
	const _windowIdWaiters: Array< ( id: string ) => void > = [];
	const _setWindowId = ( id: string ): void => {
		if ( ! id || _windowId === id ) {
			return;
		}
		_windowId = id;
		const waiters = _windowIdWaiters.splice( 0 );
		for ( const waiter of waiters ) {
			try {
				waiter( id );
			} catch {
				/* swallow */
			}
		}
	};

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
			// The parent's handshake carries the host window id since
			// 0.8.8. Stash it so `wp.desktop.iframe.windowId` and
			// `whenWindowId()` can serve callers that need to know
			// which native window opened this iframe.
			const tw = ( data as { targetWindowId?: unknown } ).targetWindowId;
			if ( typeof tw === 'string' && tw !== '' ) {
				_setWindowId( tw );
			}
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

		if ( data.type === 'desktop-mode-bridge-beforeunload-query' ) {
			let prevent = false;
			let msg = '';

			const shimReturnValue = ( e: Event ) => {
				const self = e as unknown as Record<string, unknown>;
				Object.defineProperty( e, 'returnValue', {
					get() {
						return self._returnValue || '';
					},
					set( v ) {
						self._returnValue = v;
					},
				} );
			};

			const checkPrevent = ( event: Event, result: unknown ) => {
				const retVal: unknown = ( event as unknown as Record<string, unknown> ).returnValue;
				const hasResult = typeof result === 'string' && result !== '';
				const hasRetVal = typeof retVal === 'string' && retVal !== '';
				if ( event.defaultPrevented || hasResult || hasRetVal ) {
					prevent = true;
					if ( hasResult ) {
						msg = result as string;
					} else if ( hasRetVal ) {
						msg = retVal as string;
					}
				}
			};

			if ( typeof window.onbeforeunload === 'function' ) {
				const unloadEvent = new Event( 'beforeunload', { cancelable: true } ) as Event & { returnValue?: unknown };
				shimReturnValue( unloadEvent );
				const res = window.onbeforeunload( unloadEvent );
				checkPrevent( unloadEvent, res );
			}
			if ( ! prevent ) {
				const dispatchEvent = new Event( 'beforeunload', { cancelable: true } ) as Event & { returnValue?: unknown };
				shimReturnValue( dispatchEvent );
				window.dispatchEvent( dispatchEvent );
				checkPrevent( dispatchEvent, null );
			}
			try {
				window.parent.postMessage(
					{
						type: 'desktop-mode-bridge-beforeunload-response',
						prevent,
						message: msg,
					},
					parentOrigin,
				);
			} catch {
				/* swallow */
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
			const ids = Object.keys( connections );
			if ( ids.length === 0 ) {
				// Silent no-op was a recurring footgun: plugin authors
				// publishing before any parent-side `connect()` lands
				// see nothing happen, no error, no warn. Emit a
				// console.warn so the missing-handshake case is at
				// least discoverable in DevTools.
				// eslint-disable-next-line no-console
				console.warn(
					'[desktop-mode] wp.desktop.iframe.publish dropped: no open connection for topic "%s". The parent shell must call `wp.desktop.connect(windowId)` first.',
					topic,
				);
				return;
			}
			for ( const id of ids ) {
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
		get windowId() {
			return _windowId;
		},
		whenWindowId(): Promise< string > {
			if ( _windowId !== null ) {
				return Promise.resolve( _windowId );
			}
			return new Promise< string >( ( resolve ) => {
				_windowIdWaiters.push( resolve );
			} );
		},
		isParentReachable(): boolean {
			if ( ! window.parent || window.parent === window ) {
				return false;
			}
			try {
				// Cross-origin parents throw on `.location.origin`
				// access. Same-origin parents return a string we can
				// compare to our own origin to confirm the bridge
				// will actually accept our messages.
				const parentOrig = window.parent.location.origin;
				return parentOrig === parentOrigin;
			} catch {
				return false;
			}
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
		__desktopModeOsFileDropForwarderInstalled?: boolean;
		__desktopModeDragHoverForwarderInstalled?: boolean;
		__desktopModePointerForwarderInstalled?: boolean;
	};
	if ( ! sentinelHost.__desktopModeScreenMetaInstalled ) {
		sentinelHost.__desktopModeScreenMetaInstalled = true;
		installScreenMetaHoist( parentOrigin );
	}

	/*
	 * OS-file drop forwarder. Mirrors the inline equivalent in
	 * `includes/render/chromeless-bridge.php`. Any same-origin
	 * iframe that loads this bundle (declared as
	 * `iframeContent: { bridge: true }` on a native window, or
	 * a chromeless admin page that lost the inline bridge to
	 * navigation timing) gets the same upload-from-OS coverage.
	 *
	 * Same-origin `postMessage` preserves `File` identity so the
	 * parent shell's OS-file drop manager receives real `File`
	 * objects with no base64 round-trip.
	 */
	if ( ! sentinelHost.__desktopModeOsFileDropForwarderInstalled ) {
		sentinelHost.__desktopModeOsFileDropForwarderInstalled = true;
		const hasFiles = ( ev: DragEvent ): boolean => {
			const types = ev.dataTransfer?.types;
			if ( ! types ) {
				return false;
			}
			const list = types as unknown as {
				includes?: ( s: string ) => boolean;
				contains?: ( s: string ) => boolean;
				length: number;
				[ i: number ]: string;
			};
			if ( typeof list.includes === 'function' ) {
				return list.includes( 'Files' );
			}
			if ( typeof list.contains === 'function' ) {
				return list.contains( 'Files' );
			}
			for ( let i = 0; i < list.length; i++ ) {
				if ( list[ i ] === 'Files' ) {
					return true;
				}
			}
			return false;
		};
		const dropPassthroughSelectors = [
			'.components-drop-zone',
			'[data-drop-zone]',
			'.uploader-window',
			'.media-frame-content',
		];
		const targetWantsFile = ( target: EventTarget | null ): boolean => {
			const el = target as Element | null;
			if ( ! el || ! el.closest ) {
				return false;
			}
			for ( const sel of dropPassthroughSelectors ) {
				if ( el.closest( sel ) ) {
					return true;
				}
			}
			return false;
		};
		// Bubble phase (not capture): the inner-most handler — Gutenberg's
		// drop zone, the legacy media uploader, or a third-party plugin
		// like "Administrador de archivos WP" — runs FIRST and gets the
		// chance to call `preventDefault()` to claim the drop. Our
		// forwarder then runs LAST at the document level and yields to
		// anyone who already took ownership.
		//
		// Two bail conditions, in order:
		//   1. `targetWantsFile()` — the curated allowlist (Gutenberg,
		//      wp.media, anything tagged `[data-drop-zone]`). Kept as the
		//      primary check so the well-known core surfaces behave
		//      identically to before, even if some edge case skips the
		//      `preventDefault()` step.
		//   2. `ev.defaultPrevented` — the universal HTML5 contract:
		//      any drop zone willing to receive a file calls
		//      `preventDefault()` on `dragover` (mandatory per spec) and
		//      `drop` (to suppress the browser's default navigate-to-
		//      file). When that's true, some inner handler has taken the
		//      drop — yield so plugins outside the allowlist (WP File
		//      Manager, Yoast, etc.) keep their native UX.
		document.addEventListener(
			'dragover',
			( ev: DragEvent ) => {
				if ( ! hasFiles( ev ) ) {
					return;
				}
				if ( targetWantsFile( ev.target ) ) {
					return;
				}
				if ( ev.defaultPrevented ) {
					return;
				}
				ev.preventDefault();
				if ( ev.dataTransfer ) {
					ev.dataTransfer.dropEffect = 'copy';
				}
			},
			false,
		);
		document.addEventListener(
			'drop',
			( ev: DragEvent ) => {
				if ( ! hasFiles( ev ) ) {
					return;
				}
				if ( targetWantsFile( ev.target ) ) {
					return;
				}
				if ( ev.defaultPrevented ) {
					return;
				}
				ev.preventDefault();
				ev.stopPropagation();
				const files: File[] = [];
				if ( ev.dataTransfer?.files ) {
					for ( let i = 0; i < ev.dataTransfer.files.length; i++ ) {
						files.push( ev.dataTransfer.files[ i ] );
					}
				}
				if ( files.length === 0 ) {
					return;
				}
				try {
					window.parent.postMessage(
						{
							type: 'desktop-mode-os-file-drop',
							files,
							x: ev.clientX,
							y: ev.clientY,
						},
						parentOrigin,
					);
				} catch {
					/* cross-origin parent; swallow */
				}
			},
			false,
		);
	}

	/*
	 * Drag-hover forwarder. Mirrors the inline equivalent in
	 * `includes/render/chromeless-bridge.php`. Native drag events
	 * don't cross iframe boundaries, so when the user holds ANY drag
	 * (an OS file, an image lifted off another admin page, a text
	 * selection) over this window, the parent shell has no idea the
	 * window is being hovered. Forward a throttled, payload-free
	 * heartbeat so the shell's focus-on-drag-hover module
	 * (`src/drag/focus-window-on-drag-hover.ts`) can raise this
	 * window after its dwell. Purely observational — no
	 * `preventDefault()`, no interference with in-page drop zones.
	 * The parent identifies the hovered window from the message
	 * source, so no coordinates travel.
	 */
	if ( ! sentinelHost.__desktopModeDragHoverForwarderInstalled ) {
		sentinelHost.__desktopModeDragHoverForwarderInstalled = true;
		const hoverHasFiles = ( ev: DragEvent ): boolean => {
			const types = ev.dataTransfer?.types;
			if ( ! types ) {
				return false;
			}
			const list = types as unknown as {
				includes?: ( s: string ) => boolean;
				contains?: ( s: string ) => boolean;
			};
			if ( typeof list.includes === 'function' ) {
				return list.includes( 'Files' );
			}
			return typeof list.contains === 'function' && list.contains( 'Files' );
		};
		let dragHoverLastSent = 0;
		document.addEventListener(
			'dragover',
			( ev: DragEvent ) => {
				const now = Date.now();
				if ( now - dragHoverLastSent < 150 ) {
					return;
				}
				dragHoverLastSent = now;
				try {
					window.parent.postMessage(
						{
							type: 'desktop-mode-drag-hover',
							payloadType: hoverHasFiles( ev ) ? 'os-file' : 'external',
						},
						parentOrigin,
					);
				} catch {
					/* cross-origin parent; swallow */
				}
			},
			true,
		);
	}

	/*
	 * Pointer forwarder — OPT-IN, off by default. Mirrors the inline
	 * equivalent in `includes/render/chromeless-bridge.php`.
	 *
	 * Pointer events don't cross iframe boundaries, so the parent
	 * shell goes blind to the cursor the moment it enters a window.
	 * Anything in the shell that needs the real cursor position while
	 * it's over window content — today, Mio's gaze
	 * (`src/mio/pointer.ts`) — gets a throttled stream of this
	 * frame's client coordinates and rebases them through the iframe
	 * element's own rect.
	 *
	 * Coordinates only, and only while a parent-side consumer has
	 * armed it with `desktop-mode-pointer-track { enabled: true }`.
	 * See `docs/bridge-protocol.md`.
	 */
	if ( ! sentinelHost.__desktopModePointerForwarderInstalled ) {
		sentinelHost.__desktopModePointerForwarderInstalled = true;
		let pointerTrackOn = false;
		let pointerLastSent = 0;
		window.addEventListener( 'message', ( e: MessageEvent ) => {
			if ( e.origin !== window.location.origin ) {
				return;
			}
			const data = e.data as { type?: string; enabled?: unknown } | null;
			if ( ! data || data.type !== 'desktop-mode-pointer-track' ) {
				return;
			}
			pointerTrackOn = data.enabled === true;
		} );
		document.addEventListener(
			'pointermove',
			( ev: PointerEvent ) => {
				if ( ! pointerTrackOn ) {
					return;
				}
				const now = Date.now();
				// ~25 Hz. The consumer interpolates; a faster stream
				// buys nothing visible and costs a postMessage per
				// mouse move.
				if ( now - pointerLastSent < 40 ) {
					return;
				}
				pointerLastSent = now;
				try {
					window.parent.postMessage(
						{
							type: 'desktop-mode-pointer-move',
							x: ev.clientX,
							y: ev.clientY,
						},
						parentOrigin,
					);
				} catch {
					/* cross-origin parent; swallow */
				}
			},
			{ capture: true, passive: true },
		);
	}

	/*
	 * Bridge-ready signal. Every listener installed by this bundle
	 * is now wired; let the parent shell know so it can fire
	 * `HOOKS.IFRAME_READY` and re-arm any connection handshakes
	 * (`src/connection/index.ts#onIframeReady`) that arrived before
	 * we were listening. Symmetric with the inline chromeless
	 * bridge in `includes/render/chromeless-bridge.php` — both
	 * iframe-side entry points emit the same message so the parent
	 * sees a uniform "iframe wired" signal regardless of which
	 * bridge is in play.
	 */
	try {
		if ( window.parent && window.parent !== window ) {
			window.parent.postMessage(
				{ type: 'desktop-mode-ready' },
				parentOrigin,
			);
		}
	} catch {
		/* cross-origin parent; swallow */
	}

	function installScreenMetaHoist( origin: string ): void {
		// Real screen options render form controls (column toggles, a
		// per-page input, custom settings). An empty wrap — a screen
		// that forced the toggle on via the `screen_options_show_screen`
		// filter but rendered nothing — should not surface a dead gear.
		const hasScreenOptionsContent = (): boolean => {
			const wrap = document.getElementById( 'screen-options-wrap' );
			// WP always renders a nonce hidden input and an "Apply"
			// submit inside the wrap, so match only *interactive option*
			// controls (column toggles, per-page number, view-mode
			// radios, custom selects) — never that always-present
			// scaffolding — or an empty panel would read as non-empty.
			return (
				!! wrap &&
				!! wrap.querySelector(
					'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), select, textarea',
				)
			);
		};
		// A help tab registered with empty `content` and no callback
		// still produces `#contextual-help-link` but an empty panel.
		// Require at least one tab-content panel (or the sidebar) to
		// carry non-whitespace text before announcing the Help button.
		const hasHelpContent = (): boolean => {
			const wrap = document.getElementById( 'contextual-help-wrap' );
			if ( ! wrap ) {
				return false;
			}
			const panelEls = wrap.querySelectorAll(
				'.help-tab-content, .contextual-help-sidebar',
			);
			for ( let i = 0; i < panelEls.length; i++ ) {
				if ( ( panelEls[ i ].textContent || '' ).trim() !== '' ) {
					return true;
				}
			}
			return false;
		};

		const start = (): void => {
			const links = document.getElementById( 'screen-meta-links' );
			const screenOptionsBtn = links
				? document.getElementById( 'show-settings-link' )
				: null;
			const helpBtn = links
				? document.getElementById( 'contextual-help-link' )
				: null;
			const panels: string[] = [];
			if ( screenOptionsBtn && hasScreenOptionsContent() ) {
				panels.push( 'screen-options' );
			}
			if ( helpBtn && hasHelpContent() ) {
				panels.push( 'help' );
			}

			// ALWAYS announce — including an empty array — so the parent
			// removes stale gear/Help buttons when this page (e.g. after
			// an in-place same-slug navigation) has no screen meta. The
			// parent's addScreenMetaButtons() clears then repopulates, so
			// `[]` is the correct "remove everything" signal.
			try {
				window.parent.postMessage(
					{ type: 'desktop-mode-screen-meta', panels },
					origin,
				);
			} catch {
				/* parent gone */
			}

			if ( panels.length === 0 ) {
				return; // Nothing to observe or toggle on this page.
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
