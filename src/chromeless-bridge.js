/**
 * OpenStation — chromeless bridge (iframe side).
 *
 * Plain ES5-flavoured JavaScript on purpose: this runs inside a real
 * wp-admin document alongside whatever else that page loads, so it
 * stays dependency-free and conservative about syntax.
 *
 * **This file used to be a PHP nowdoc.** It was emitted inline into
 * every chromeless window by `includes/render/chromeless-bridge.php`,
 * which meant ~125 KB of unminified JavaScript — comments and all —
 * landed in the HTML document of every window a user opened. A
 * document is the one thing no cache can help with, so that cost was
 * paid in full, every time. It now builds to
 * `assets/js/chromeless-bridge[.min].js` and is enqueued like any
 * other bundle: fetched once, then served from the browser (and the
 * shared service-worker cache) on every later window.
 *
 * The four values the server has to vary per request — the menu
 * payload, its signature, the content identity, and the soft-reload
 * rules — arrive on `window.__osChromelessData`, emitted as a small
 * inline `before` script by the same PHP file. Keep that contract in
 * step: a key added here needs a key added there.
 *
 * **Still to do: convert this to TypeScript.** It is the only
 * first-class bundle in the repo whose source is plain JS, so ESLint
 * covers it (see the override in `.eslintrc.cjs`) but `tsc` does not —
 * the "silent class of bug" AGENTS.md warns about. The nowdoc it
 * replaced had the same blind spot and worse (PHPCS cannot see inside
 * a JS-in-PHP string), so this is not a regression, but it is a gap.
 * The conversion is deliberately its own change: rewriting 3,500
 * lines and moving them between files at the same time would make
 * both impossible to review.
 */
( function() {
	/**
	 * Per-request data from PHP. Defensive default so the bundle stays
	 * harmless if it is ever loaded without its inline companion (a
	 * cached bundle paired with a failed document, a plugin enqueueing
	 * the handle directly).
	 */
	var __OS_DATA = window.__osChromelessData || {};
	// Escape hatch: a chromeless page is *normally* only meant to live
	// inside a openstation window iframe. If the top window IS this
	// page, the user usually ended up here by accident — bookmarked
	// it, followed a stale link, or got stranded by a bad portal
	// redirect. Without an admin bar there's no toggle to turn
	// OpenStation off, so strip the chromeless flag and reload as
	// classic admin. That puts the admin bar back and lets the user
	// decide what to do.
	//
	// Unless something is deliberately HOSTING this page top-level.
	// `window.openStationChromelessHost` is how an embedder says "this
	// is not an accident, and I provide the way out" — the native
	// desktop host sets it on windows a user set free, where closing
	// the OS window is the way back. Rescuing those would strip the
	// flag, reload as classic, bounce through the portal, and leave a
	// whole second desktop inside a window that was meant to hold one
	// screen.
	//
	// It has to be a JS global rather than a query flag: a query flag
	// is lost on the first in-page navigation, and the host would stop
	// recognising its own window the moment the user clicked a link.
	if ( ! window.parent || window.parent === window ) {
		if ( ! window.openStationChromelessHost ) {
			try {
				var here = new URL( window.location.href );
				if ( here.searchParams.has( 'openstation_chromeless' ) ) {
					here.searchParams.delete( 'openstation_chromeless' );
					here.searchParams.delete( 'desktop_mode_portal' );
					window.location.replace( here.toString() );
				}
			} catch ( err ) {
				/* URL parse failure — let the broken state stand rather than
				 * navigate somewhere worse. */
			}
		}
		// Either way the rest of the bridge is skipped: every feature
		// below posts to `window.parent`, and there isn't one.
		return;
	}

	/*
	 * Content-identity announcement. The server resolved which object
	 * this page shows (post / comment / attachment, plus the root post
	 * a child belongs to) while it still had real admin context; hand
	 * it to the parent's relations engine. Deliberately posted even
	 * when the identity is null — a full-page navigation away from an
	 * identified screen must CLEAR the stale identity, and every
	 * navigation re-runs admin_footer, so this doubles as the
	 * re-announce-on-navigate path.
	 *
	 * Posted FIRST, right after the top-frame escape hatch, because it
	 * depends on nothing else in this script: a page-specific runtime
	 * failure in any of the feature blocks below (screen-meta harvest,
	 * command scan, link interceptor, …) must not cost the shell its
	 * window relations. The `os-ready` signal intentionally
	 * stays LAST — it means "every listener below is wired".
	 */
	try {
		window.parent.postMessage(
			{
				type: 'os-content-identity',
				identity: ( '_identity' in __OS_DATA ) ? __OS_DATA._identity : null
			},
			window.location.origin
		);
	} catch ( _err ) { /* parent gone or cross-origin */ }

	/*
	 * Editor save-watcher — keeps the identity fresh across block-editor
	 * saves. Gutenberg saves over REST without a page navigation, so the
	 * announcement above (rebuilt only on admin_footer) goes stale the
	 * moment the user adds a category, links a post, or sets a featured
	 * image — the parent's Related menu and window ties would show the
	 * pre-save state until a manual reload. After every real
	 * (non-autosave) save completes, refetch a server-recomputed
	 * identity from `desktop-mode/v1/content-identity` and re-announce
	 * it; the parent engine diffs and repaints. The classic editor
	 * reloads the page on save, which re-runs the announcement
	 * naturally — this block never engages there (no `core/editor`
	 * store on the page).
	 */
	window.addEventListener( 'load', function () {
		try {
			var wpg = window.wp;
			if ( ! wpg || ! wpg.data || ! wpg.apiFetch || typeof wpg.data.select !== 'function' ) {
				return;
			}
			var editor = wpg.data.select( 'core/editor' );
			if (
				! editor ||
				typeof editor.isSavingPost !== 'function' ||
				typeof editor.getCurrentPostId !== 'function'
			) {
				return;
			}
			var wasSaving = false;
			var wasNew = false;
			var inFlight = false;
			wpg.data.subscribe( function () {
				var saving =
					editor.isSavingPost() &&
					! ( editor.isAutosavingPost && editor.isAutosavingPost() );
				if ( saving && ! wasSaving ) {
					// Capture "is this the first real save?" on the tick
					// where saving STARTS — after the save completes the
					// post is no longer new and the flag reads false.
					wasNew = !! (
						editor.isEditedPostNew && editor.isEditedPostNew()
					);
				}
				var finished = wasSaving && ! saving;
				wasSaving = saving;
				if ( ! finished || inFlight ) {
					return;
				}
				if (
					editor.didPostSaveRequestSucceed &&
					! editor.didPostSaveRequestSucceed()
				) {
					return;
				}
				var postId = editor.getCurrentPostId();
				if ( ! postId ) {
					return;
				}

				/*
				 * Announce the save as a cross-window content-change
				 * broadcast. Gutenberg saves over REST with no
				 * navigation, so the server-side chromeless-footer
				 * emitter (includes/content-changes.php) never runs
				 * here — this is the only instant path for block-editor
				 * saves. The parent's broadcast receiver fans it out;
				 * list windows showing this post type refresh.
				 */
				if ( editor.getCurrentPostType ) {
					try {
						window.parent.postMessage(
							{
								type: 'os-broadcast',
								topic:
									'os.' +
									editor.getCurrentPostType() +
									'.changed',
								payload: {
									source: 'editor',
									action: wasNew ? 'created' : 'updated',
									ids: [ postId ],
								},
							},
							window.location.origin
						);
					} catch ( _err ) { /* parent gone */ }
				}
				inFlight = true;
				wpg
					.apiFetch( {
						path: '/desktop-mode/v1/content-identity?post=' + postId,
					} )
					.then( function ( res ) {
						if ( res && res.identity ) {
							window.parent.postMessage(
								{
									type: 'os-content-identity',
									identity: res.identity,
								},
								window.location.origin
							);
						}
					} )
					.catch( function () {
						/* Transient — the next save retries. */
					} )
					.finally( function () {
						inFlight = false;
					} );
			} );
		} catch ( _err ) {
			/* Editor stores absent or shaped differently — nothing to watch. */
		}
	} );

	/*
	 * Observability — iframe error + network capture.
	 *
	 * Everything admin-interesting (REST failures from Gutenberg,
	 * admin-ajax 500s, plugin console warnings) fires INSIDE the
	 * iframe whose parent is the desktop shell. Without relaying
	 * those events to the shell, monitor / debug widgets would only
	 * ever see the shell's own errors — the smallest, least-
	 * interesting surface in the whole admin.
	 *
	 * Two listeners and two wrappers land here:
	 *
	 *   - `error` + `unhandledrejection` on window → postMessage
	 *     `os-iframe-error`. Parent dispatches `HOOKS.
	 *     IFRAME_ERROR`.
	 *   - `fetch` + `XMLHttpRequest` are wrapped so every completed
	 *     request (including failures) posts
	 *     `os-iframe-network` with `{ method, url, status,
	 *     duration, failed }`. Parent dispatches `HOOKS.
	 *     IFRAME_NETWORK_COMPLETED`.
	 *
	 * Privacy: request / response bodies are NEVER captured — only
	 * method, URL, status, duration. Monitor widgets that want the
	 * full payload must ship their own deeper wrapper (at which
	 * point they own the consent conversation).
	 */
	/*
	 * "I am really leaving."
	 *
	 * `pagehide` fires once, at the moment a navigation commits — so
	 * it is the one thing that separates a "Leave site?" prompt the
	 * user accepted from one they cancelled. A cancelled navigation
	 * fires nothing at all and leaves this document running, which is
	 * why the parent cannot work it out for itself: it looks
	 * identical, from the outside, to a page still waiting on a slow
	 * response.
	 *
	 * The shell uses it to release a navigation paint it withheld
	 * over the prompt (see `src/window/unsaved-guard.ts`); a window
	 * with nothing withheld ignores the message. Registered next to
	 * the error relay rather than gated on anything, because by the
	 * time this document knows a prompt is coming it is too late to
	 * start listening.
	 */
	try {
		window.addEventListener( 'pagehide', function () {
			try {
				window.parent.postMessage(
					{ type: 'os-iframe-unloading' },
					window.location.origin
				);
			} catch ( _err ) { /* parent gone */ }
		} );
	} catch ( _err ) { /* swallow */ }

	try {
		window.addEventListener( 'error', function ( e ) {
			try {
				window.parent.postMessage( {
					type: 'os-iframe-error',
					kind: 'error',
					message: e && e.message ? String( e.message ) : '',
					filename: e && e.filename ? String( e.filename ) : null,
					lineno: e && typeof e.lineno === 'number' ? e.lineno : null,
					colno: e && typeof e.colno === 'number' ? e.colno : null,
					stack: e && e.error && e.error.stack ? String( e.error.stack ) : null
				}, window.location.origin );
			} catch ( _err ) { /* swallow: don't let the relay compound the error */ }
		} );

		window.addEventListener( 'unhandledrejection', function ( e ) {
			try {
				var reason = e && 'reason' in e ? e.reason : null;
				var message = '';
				var stack = null;
				if ( reason instanceof Error ) {
					message = reason.message;
					stack = reason.stack || null;
				} else if ( reason !== null && reason !== undefined ) {
					try { message = String( reason ); } catch ( _s ) { message = '[unstringifiable]'; }
				}
				window.parent.postMessage( {
					type: 'os-iframe-error',
					kind: 'unhandledrejection',
					message: message,
					filename: null,
					lineno: null,
					colno: null,
					stack: stack
				}, window.location.origin );
			} catch ( _err ) { /* swallow */ }
		} );

		// Devtools instrumentation slot — populated by
		// `os-instrument-set` messages from the parent shell.
		// Mutable: parent overwrites the whole object on every change
		// (header add/remove, observe toggle).
		//
		// Headers: { name: 'value' } — already pre-merged by the parent
		// (RFC 7230 §3.2.2 join applied there).
		// Observe: when true, network reports include request +
		// response headers; otherwise only the privacy-conscious
		// summary travels parent-bound.
		window.__wpdInstrument = window.__wpdInstrument || { headers: {}, observe: false };
		try {
			window.addEventListener( 'message', function ( ev ) {
				if ( ev.origin !== window.location.origin || ev.source !== window.parent ) {
					return;
				}
				var d = ev && ev.data;
				if ( ! d || typeof d !== 'object' || d.type !== 'os-instrument-set' ) {
					return;
				}
				window.__wpdInstrument = {
					headers: d.headers && typeof d.headers === 'object' ? d.headers : {},
					observe: !! d.observe
				};
			} );
		} catch ( _err ) { /* swallow — instrumentation is best-effort */ }

		var osReportNetwork = function ( method, url, status, duration, failed, extra ) {
			try {
				var msg = {
					type: 'os-iframe-network',
					method: String( method || 'GET' ).toUpperCase(),
					url: String( url || '' ),
					status: typeof status === 'number' ? status : 0,
					duration: typeof duration === 'number' ? duration : 0,
					failed: !! failed
				};
				if ( extra && window.__wpdInstrument && window.__wpdInstrument.observe ) {
					if ( extra.requestHeaders ) {
						msg.requestHeaders = extra.requestHeaders;
					}
					if ( extra.responseHeaders ) {
						msg.responseHeaders = extra.responseHeaders;
					}
				}
				window.parent.postMessage( msg, window.location.origin );
			} catch ( _err ) { /* swallow */ }
		};

		// Activity reporting — the window's status ring.
		//
		// `os-iframe-network` above fires on COMPLETION only, which is
		// enough for the devtools panel and useless for an indicator:
		// a ring that can only be told "it finished" never shows the
		// part the user is waiting through. These two messages bracket
		// the request instead, and the parent reference-counts them
		// the same way `wp.os.fetch` does for native windows.
		//
		// Reads do NOT count. The ring answers one question — "did my
		// change go through?" — and a GET has no "through": nothing was
		// changed, so nothing can have failed to change. In an admin
		// page most GETs are the page's own housekeeping (list-table
		// refreshes, dashboard widgets, autosave checks, media queries)
		// that the user never asked about and shouldn't be made to
		// watch. Mutations are the requests with a question attached.
		//
		// HEAD and OPTIONS go with GET: a probe and a preflight are
		// even further from a change than a read is.
		//
		// QUERY too, and it is the one that needs saying out loud: it
		// carries a BODY, so every "does it have a payload?" heuristic
		// mistakes it for a write. It is a safe, idempotent read — a
		// GET whose parameters wouldn't fit in a URL — so it belongs
		// here with the rest of them. Listed ahead of the spec landing
		// on purpose: a method the shell has never heard of arriving in
		// a Core release should not start lighting rings.
		var osIsReadRequest = function ( method ) {
			var m = String( method || 'GET' ).toUpperCase();
			return 'GET' === m || 'HEAD' === m || 'OPTIONS' === m || 'QUERY' === m;
		};

		var osIsBackgroundRequest = function ( url, body ) {
			// WordPress Heartbeat is a poll the user did not initiate,
			// on a timer, forever. Reporting it would light the ring
			// on every open window every 15 seconds and flash a
			// "Saved" check for a save nobody made — the framework's
			// own background pings pass `silent: true` for exactly
			// this reason. The action rides in the POST body, not the
			// URL, so both are checked.
			try {
				if ( String( url || '' ).indexOf( 'action=heartbeat' ) !== -1 ) {
					return true;
				}
				if ( typeof body === 'string' && body.indexOf( 'action=heartbeat' ) !== -1 ) {
					return true;
				}
				if ( body && typeof body.get === 'function' && body.get( 'action' ) === 'heartbeat' ) {
					return true;
				}
			} catch ( _bgErr ) { /* unreadable body — treat as foreground */ }
			return false;
		};

		var osActivityBegin = function ( method, url, body ) {
			if ( osIsReadRequest( method ) || osIsBackgroundRequest( url, body ) ) {
				return false;
			}
			try {
				window.parent.postMessage(
					{ type: 'os-iframe-activity', phase: 'start' },
					window.location.origin
				);
			} catch ( _sErr ) { /* swallow — instrumentation is best-effort */ }
			return true;
		};

		// `tracked` is the value `osActivityBegin` returned, so a
		// request that was never counted can never decrement — an
		// unbalanced end would settle the ring while other requests
		// are still in flight.
		var osActivityEnd = function ( tracked, failed, status ) {
			if ( ! tracked ) {
				return;
			}
			try {
				window.parent.postMessage(
					{
						type: 'os-iframe-activity',
						phase: 'end',
						failed: !! failed,
						status: typeof status === 'number' ? status : 0
					},
					window.location.origin
				);
			} catch ( _eErr ) { /* swallow */ }
		};

		// Helper — when an admin-side request returns 401/403 the
		// session is most likely toast. Don't wait up to 60s for the
		// next heartbeat tick to surface core's auth-check modal —
		// force an immediate tick. `wp.heartbeat.connectNow()` is
		// safe to call repeatedly; we still debounce to avoid storms
		// when many requests fail at once. Same-origin gate keeps us
		// out of third-party 403s. The URL gate avoids looping on
		// heartbeat itself (heartbeat shouldn't 403 — but if it does
		// the recursive connectNow would not help anyway).
		var osAuthCheckCooldownUntil = 0;
		var osMaybeForceAuthCheck = function ( status, url ) {
			if ( status !== 401 && status !== 403 ) {
				return;
			}
			var urlStr = String( url || '' );
			if ( ! urlStr ) {
				return;
			}
			// Cross-origin URLs aren't ours to interpret.
			try {
				var resolved = new URL( urlStr, window.location.href );
				if ( resolved.origin !== window.location.origin ) {
					return;
				}
				// Skip heartbeat to avoid recursion. Skip wp-login
				// because the login iframe itself returns 4xx during
				// the auth handshake and we don't want to retrigger.
				if (
					resolved.pathname.indexOf( '/wp-admin/admin-ajax.php' ) !== -1
					&& /(?:^|&|\?)action=heartbeat(?:&|$)/.test( resolved.search )
				) {
					return;
				}
				if ( resolved.pathname.indexOf( '/wp-login.php' ) !== -1 ) {
					return;
				}
			} catch ( _err ) {
				return;
			}
			var now = Date.now();
			if ( now < osAuthCheckCooldownUntil ) {
				return;
			}
			osAuthCheckCooldownUntil = now + 5000;
			try {
				if (
					window.wp
					&& window.wp.heartbeat
					&& typeof window.wp.heartbeat.connectNow === 'function'
				) {
					window.wp.heartbeat.connectNow();
				}
			} catch ( _err ) { /* swallow */ }
		};

		// Helper — convert an arbitrary `init.headers` shape into a
		// plain `{ name: value }` map so the instrument layer can
		// merge contributed headers without caring whether the caller
		// passed a Headers, an array of pairs, or a plain object.
		var osHeadersToObject = function ( h ) {
			var out = {};
			if ( ! h ) {
				return out;
			}
			if ( typeof Headers !== 'undefined' && h instanceof Headers ) {
				try {
					h.forEach( function ( v, k ) { out[ k ] = v; } );
				} catch ( _e ) { /* swallow */ }
				return out;
			}
			if ( Array.isArray( h ) ) {
				for ( var i = 0; i < h.length; i++ ) {
					if ( h[ i ] && h[ i ].length >= 2 ) {
						out[ h[ i ][ 0 ] ] = h[ i ][ 1 ];
					}
				}
				return out;
			}
			if ( typeof h === 'object' ) {
				for ( var k in h ) {
					if ( Object.prototype.hasOwnProperty.call( h, k ) ) {
						out[ k ] = h[ k ];
					}
				}
			}
			return out;
		};

		// Helper — snapshot the contributed-header set at request time.
		// Header values can theoretically come and go between requests
		// (parent ref-counts contributions) so we read fresh on every
		// call rather than caching at wrap time.
		var osContributedHeaders = function () {
			var inst = window.__wpdInstrument || {};
			var headers = inst.headers || {};
			var out = {};
			for ( var k in headers ) {
				if ( Object.prototype.hasOwnProperty.call( headers, k ) && typeof headers[ k ] === 'string' ) {
					out[ k ] = headers[ k ];
				}
			}
			return out;
		};

		// Wrap fetch. Called AFTER `admin_footer` runs — plugin code
		// using fetch during synchronous page boot (rare in wp-admin)
		// bypasses this, but lazy calls (the common case) are captured.
		//
		// Two layers of behavior:
		//
		//   - Always: timing + status reporting (the original
		//     observability contract).
		//   - When `__wpdInstrument.headers` is non-empty: merge those
		//     headers into the request before dispatch so devtools can
		//     tag every outgoing call without each plugin reinventing
		//     a fetch wrapper.
		//   - When `__wpdInstrument.observe`: also relay request +
		//     response headers in the parent-bound network message.
		if ( typeof window.fetch === 'function' ) {
			var osOrigFetch = window.fetch;
			window.fetch = function ( input, init ) {
				var start = ( typeof performance !== 'undefined' && performance.now )
					? performance.now()
					: Date.now();
				var method = 'GET';
				var url = '';
				if ( typeof input === 'string' ) {
					url = input;
					if ( init && typeof init.method === 'string' ) {
						method = init.method;
					}
				} else if ( input && typeof input === 'object' ) {
					url = input.url || '';
					method = ( input.method || ( init && init.method ) || 'GET' );
				}

				// Header contribution + capture. Build a single
				// `Headers` instance so contributed values overwrite /
				// stack predictably regardless of the caller's input
				// shape, then re-attach to a cloned init.
				var contributed = osContributedHeaders();
				var observe = window.__wpdInstrument && window.__wpdInstrument.observe;
				var requestHeaders = null;
				var hasContributed = false;
				for ( var ck in contributed ) {
					if ( Object.prototype.hasOwnProperty.call( contributed, ck ) ) {
						hasContributed = true;
						break;
					}
				}
				if ( hasContributed || observe ) {
					var existing = osHeadersToObject( init && init.headers );
					if ( input && typeof input === 'object' && input.headers ) {
						var fromReq = osHeadersToObject( input.headers );
						for ( var rk in fromReq ) {
							if ( Object.prototype.hasOwnProperty.call( fromReq, rk ) && ! ( rk in existing ) ) {
								existing[ rk ] = fromReq[ rk ];
							}
						}
					}
					for ( var ck2 in contributed ) {
						if ( Object.prototype.hasOwnProperty.call( contributed, ck2 ) ) {
							existing[ ck2 ] = contributed[ ck2 ];
						}
					}
					if ( hasContributed ) {
						init = init ? Object.assign( {}, init ) : {};
						init.headers = existing;
						arguments[ 1 ] = init;
					}
					if ( observe ) {
						requestHeaders = existing;
					}
				}

				var tracked = osActivityBegin( method, url, ( init && init.body ) || ( input && input.body ) );

				var promise;
				try {
					promise = osOrigFetch.apply( this, arguments );
				} catch ( sync ) {
					osReportNetwork( method, url, 0, 0, true, requestHeaders ? { requestHeaders: requestHeaders } : null );
					osActivityEnd( tracked, true, 0 );
					throw sync;
				}
				return promise.then(
					function ( res ) {
						var dur = ( ( typeof performance !== 'undefined' && performance.now )
							? performance.now()
							: Date.now() ) - start;
						var extra = null;
						if ( requestHeaders ) {
							extra = { requestHeaders: requestHeaders };
							try {
								var rh = {};
								if ( res && res.headers && typeof res.headers.forEach === 'function' ) {
									res.headers.forEach( function ( v, k ) { rh[ k ] = v; } );
								}
								extra.responseHeaders = rh;
							} catch ( _hErr ) { /* swallow */ }
						}
						osReportNetwork( method, url, res.status, Math.round( dur ), ! res.ok, extra );
						// `fetch` resolves for 4xx / 5xx, so the ring
						// settles on `res.ok` and not on the promise.
						osActivityEnd( tracked, ! res.ok, res.status );
						osMaybeForceAuthCheck( res.status, url );
						return res;
					},
					function ( err ) {
						var dur = ( ( typeof performance !== 'undefined' && performance.now )
							? performance.now()
							: Date.now() ) - start;
						osReportNetwork( method, url, 0, Math.round( dur ), true, requestHeaders ? { requestHeaders: requestHeaders } : null );
						osActivityEnd( tracked, true, 0 );
						throw err;
					}
				);
			};
		}

		// Wrap XHR — admin-ajax runs through jQuery which runs through
		// XHR, so fetch-only instrumentation would miss most of the
		// legacy admin surface. Record method + URL on open; fire on
		// loadend regardless of success / failure.
		//
		// Header contribution layer: `setRequestHeader` after open() but
		// before send() — that's the only window the spec allows. The
		// caller's own headers are tracked so observation can include
		// them alongside the contributed ones.
		if ( typeof XMLHttpRequest !== 'undefined' ) {
			var osOrigOpen = XMLHttpRequest.prototype.open;
			var osOrigSend = XMLHttpRequest.prototype.send;
			var osOrigSetHeader = XMLHttpRequest.prototype.setRequestHeader;
			XMLHttpRequest.prototype.open = function ( method, url ) {
				try {
					this.__wpdMethod = method;
					this.__wpdUrl = url;
					this.__wpdReqHeaders = {};
				} catch ( _err ) { /* frozen instance — skip */ }
				return osOrigOpen.apply( this, arguments );
			};
			XMLHttpRequest.prototype.setRequestHeader = function ( name, value ) {
				try {
					if ( ! this.__wpdReqHeaders ) {
						this.__wpdReqHeaders = {};
					}
					this.__wpdReqHeaders[ name ] = value;
				} catch ( _err ) { /* swallow */ }
				return osOrigSetHeader.apply( this, arguments );
			};
			XMLHttpRequest.prototype.send = function ( body ) {
				var xhr = this;
				var start = ( typeof performance !== 'undefined' && performance.now )
					? performance.now()
					: Date.now();
				// The body is where an admin-ajax action name lives,
				// and the action name is how Heartbeat is recognised.
				var tracked = osActivityBegin( xhr.__wpdMethod, xhr.__wpdUrl, body );

				// Apply contributed headers right before send. Doing it
				// here rather than in open() means contributions added
				// after open() (e.g. in async-built request flows) still
				// land on the wire.
				var contributed = osContributedHeaders();
				var observe = window.__wpdInstrument && window.__wpdInstrument.observe;
				for ( var hk in contributed ) {
					if ( Object.prototype.hasOwnProperty.call( contributed, hk ) ) {
						try {
							osOrigSetHeader.call( xhr, hk, contributed[ hk ] );
							if ( ! xhr.__wpdReqHeaders ) {
								xhr.__wpdReqHeaders = {};
							}
							xhr.__wpdReqHeaders[ hk ] = contributed[ hk ];
						} catch ( _hErr ) { /* `setRequestHeader` rejects forbidden names — skip */ }
					}
				}

				var fire = function () {
					var dur = ( ( typeof performance !== 'undefined' && performance.now )
						? performance.now()
						: Date.now() ) - start;
					var extra = null;
					if ( observe ) {
						extra = {
							requestHeaders: xhr.__wpdReqHeaders || {}
						};
						try {
							var raw = xhr.getAllResponseHeaders ? xhr.getAllResponseHeaders() : '';
							var resHeaders = {};
							if ( raw && typeof raw === 'string' ) {
								var lines = raw.trim().split( /[\r\n]+/ );
								for ( var li = 0; li < lines.length; li++ ) {
									var idx = lines[ li ].indexOf( ':' );
									if ( idx > 0 ) {
										resHeaders[ lines[ li ].slice( 0, idx ).trim() ] = lines[ li ].slice( idx + 1 ).trim();
									}
								}
							}
							extra.responseHeaders = resHeaders;
						} catch ( _rErr ) { /* swallow */ }
					}
					var failed = xhr.status === 0 || xhr.status >= 400;
					osReportNetwork(
						xhr.__wpdMethod,
						xhr.__wpdUrl,
						xhr.status,
						Math.round( dur ),
						failed,
						extra
					);
					osActivityEnd( tracked, failed, xhr.status );
					osMaybeForceAuthCheck( xhr.status, xhr.__wpdUrl );
				};
				try {
					xhr.addEventListener( 'loadend', fire );
				} catch ( _err ) { /* swallow */ }
				return osOrigSend.apply( this, arguments );
			};
		}

		// Wrap sendBeacon — used by analytics + telemetry. The Beacon
		// API doesn't accept headers (the entire point of beacons is
		// minimal payload + best-effort delivery). When devtools have
		// contributed headers we silently fall back to fetch with
		// `keepalive: true`, which is the closest semantic match —
		// guaranteed POST + same fire-and-forget intent + custom headers
		// allowed. Without contributions we just relay the call.
		if ( typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function' ) {
			var osOrigBeacon = navigator.sendBeacon.bind( navigator );
			navigator.sendBeacon = function ( url, data ) {
				var contributed = osContributedHeaders();
				var hasContributed = false;
				for ( var ck in contributed ) {
					if ( Object.prototype.hasOwnProperty.call( contributed, ck ) ) {
						hasContributed = true;
						break;
					}
				}
				var start = ( typeof performance !== 'undefined' && performance.now )
					? performance.now()
					: Date.now();
				if ( ! hasContributed ) {
					var ok = false;
					try { ok = !! osOrigBeacon( url, data ); } catch ( _e ) { ok = false; }
					osReportNetwork( 'POST', url, ok ? 200 : 0, 0, ! ok );
					return ok;
				}
				try {
					var observe = window.__wpdInstrument && window.__wpdInstrument.observe;
					var headers = {};
					for ( var hk2 in contributed ) {
						if ( Object.prototype.hasOwnProperty.call( contributed, hk2 ) ) {
							headers[ hk2 ] = contributed[ hk2 ];
						}
					}
					window.fetch( url, {
						method: 'POST',
						body: data,
						keepalive: true,
						credentials: 'same-origin',
						headers: headers
					} ).then(
						function ( res ) {
							var dur = ( ( typeof performance !== 'undefined' && performance.now )
								? performance.now()
								: Date.now() ) - start;
							osReportNetwork( 'POST', url, res.status, Math.round( dur ), ! res.ok, observe ? { requestHeaders: headers } : null );
						},
						function () {
							var dur = ( ( typeof performance !== 'undefined' && performance.now )
								? performance.now()
								: Date.now() ) - start;
							osReportNetwork( 'POST', url, 0, Math.round( dur ), true, observe ? { requestHeaders: headers } : null );
						}
					);
					return true;
				} catch ( _bErr ) {
					return false;
				}
			};
		}
	} catch ( _err ) {
		/* Whole observability block is best-effort. If something in
		 * the environment disagrees (frozen prototypes, CSP blocking
		 * postMessage, etc.) we don't want to tank the rest of the
		 * chromeless bridge. */
	}

	/*
	 * Menu-changed signal.
	 *
	 * The shell's dock is built from `$menu` at page-load time and
	 * then frozen — the iframe reload that follows plugin
	 * activation / deactivation / installation doesn't tell the
	 * parent the admin menu just mutated. This handler fires inside
	 * the iframe that JUST LOADED plugins.php (or a sibling menu-
	 * affecting page) and hands the parent a fresh payload the PHP
	 * side built server-side from the live $menu globals.
	 *
	 * Why not a REST roundtrip: plugins commonly gate their
	 * `admin_menu` registration on `is_admin()` evaluated AT PLUGIN
	 * LOAD. REST requests don't define `WP_ADMIN` at plugin-load
	 * time, so those plugins never register and a REST-context
	 * bootstrap can't retroactively make them. By capturing the
	 * payload here, inside a real admin context, we get the
	 * authoritative post-activation state that any REST endpoint
	 * would miss.
	 *
	 * Covered pages:
	 *   - plugins.php         — activate, deactivate, bulk, delete.
	 *   - plugin-install.php  — install new, install-and-activate.
	 *   - update.php          — update / install handler (install-
	 *                           plugin + upload-plugin actions).
	 *   - themes.php          — theme switch (rare but can add menus).
	 */
	var __OPENSTATION_MENU_PAYLOAD__ = ( '_menuPayload' in __OS_DATA ) ? __OS_DATA._menuPayload : null;
	var __OPENSTATION_MENU_SIG__ = ( '_menuSig' in __OS_DATA ) ? __OS_DATA._menuSig : null;
	/*
	 * Icon harvest from the iframe's authoritative #adminmenu.
	 *
	 * The server-side payload only knows what the plugin set on
	 * $menu[$i][6]. Plugins that register their icon with 'none' /
	 * 'div' and paint it via a CSS rule on `#adminmenu .menu-icon-X`
	 * (All in One WP Migration, plus a long tail of older plugins)
	 * end up serialized with the gear fallback.
	 *
	 * On a regular page load the parent shell's resolveIcon() falls
	 * back to the parent's hidden #adminmenu DOM and reads the icon
	 * from there — but on a live activation the parent's #adminmenu
	 * is stale (it was rendered before the plugin existed). This
	 * iframe just rendered plugins.php in real admin context, so its
	 * own #adminmenu DOM IS authoritative; harvest each menu item's
	 * resolved icon here and patch the dockItems before postMessage.
	 */
	try {
		if (
			__OPENSTATION_MENU_PAYLOAD__
			&& Array.isArray( __OPENSTATION_MENU_PAYLOAD__.dockItems )
		) {
			var __wpdAdminMenu = document.getElementById( 'adminmenu' );
			if ( __wpdAdminMenu ) {
				var __wpdHarvest = {};
				var __wpdLinks = __wpdAdminMenu.querySelectorAll( 'li.menu-top > a' );
				for ( var __wpdLi = 0; __wpdLi < __wpdLinks.length; __wpdLi++ ) {
					var __wpdLink = __wpdLinks[ __wpdLi ];
					var __wpdKey;
					try {
						var __wpdU = new URL( __wpdLink.href || '', window.location.href );
						__wpdKey = ( __wpdU.pathname.split( '/' ).pop() || '' ) + __wpdU.search;
					} catch ( __wpdE1 ) { continue; }
					if ( ! __wpdKey ) { continue; }
					var __wpdImgWrap = __wpdLink.querySelector( '.wp-menu-image' );
					if ( ! __wpdImgWrap ) { continue; }

					/* (a) <img src> nested inside .wp-menu-image */
					var __wpdImg = __wpdImgWrap.querySelector( 'img' );
					if ( __wpdImg && __wpdImg.src ) {
						__wpdHarvest[ __wpdKey ] = __wpdImg.src;
						continue;
					}

					/* (b) dashicon class on the wrap div itself */
					var __wpdDash = ( __wpdImgWrap.className || '' ).match( /\bdashicons-[\w-]+\b/ );
					if (
						__wpdDash
						&& __wpdDash[ 0 ] !== 'dashicons-before'
						&& __wpdDash[ 0 ] !== 'dashicons-admin-generic'
					) {
						__wpdHarvest[ __wpdKey ] = __wpdDash[ 0 ];
						continue;
					}

					/* (c) ::before background-image — pass the raw
					 * `url(...)` CSS value through; the parent's
					 * resolveIcon can hand it straight to _makeSvgIcon
					 * regardless of whether it's base64-encoded SVG,
					 * URL-encoded SVG, or a plain http(s) URL. */
					try {
						var __wpdBefore = window.getComputedStyle( __wpdImgWrap, '::before' );
						var __wpdBg = __wpdBefore && __wpdBefore.backgroundImage;
						if ( __wpdBg && __wpdBg !== 'none' && __wpdBg.indexOf( 'url("")' ) === -1 ) {
							__wpdHarvest[ __wpdKey ] = __wpdBg;
							continue;
						}
						/* (d) background on the wrap itself */
						var __wpdWrapBg = window.getComputedStyle( __wpdImgWrap ).backgroundImage;
						if ( __wpdWrapBg && __wpdWrapBg !== 'none' && __wpdWrapBg.indexOf( 'url("")' ) === -1 ) {
							__wpdHarvest[ __wpdKey ] = __wpdWrapBg;
						}
					} catch ( __wpdE2 ) { /* getComputedStyle may throw on detached nodes */ }
				}

				var __wpdItems = __OPENSTATION_MENU_PAYLOAD__.dockItems;
				for ( var __wpdDi = 0; __wpdDi < __wpdItems.length; __wpdDi++ ) {
					var __wpdItem = __wpdItems[ __wpdDi ];
					if ( ! __wpdItem || __wpdItem.icon !== 'dashicons-admin-generic' ) { continue; }
					if ( typeof __wpdItem.url !== 'string' || ! __wpdItem.url ) { continue; }
					try {
						var __wpdItemU = new URL( __wpdItem.url, window.location.href );
						var __wpdItemKey = ( __wpdItemU.pathname.split( '/' ).pop() || '' ) + __wpdItemU.search;
						if ( __wpdHarvest[ __wpdItemKey ] ) {
							__wpdItem.icon = __wpdHarvest[ __wpdItemKey ];
						}
					} catch ( __wpdE3 ) { /* malformed url — leave icon alone */ }
				}
			}
		}
	} catch ( __wpdHarvestErr ) {
		/* Harvest is best-effort; on any failure we still ship the
		 * server-built payload, which is exactly the pre-fix behavior. */
	}
	/*
	 * Menu payload / signature target: the SHELL, i.e. the top window —
	 * not the immediate parent. For a normal window iframe the two are
	 * the same frame, but the bulk updater nests: update-core.php (the
	 * window iframe) hosts a progress iframe of `update.php?action=
	 * update-selected`, whose `iframe_footer()` fires `admin_footer`
	 * AFTER the upgrades ran — exactly the fresh payload the shell
	 * wants. Posting that to `window.parent` hands it to the
	 * update-core.php page, which has no listener, and the dock badge
	 * stays stale (GH#296). `window.top` reaches the shell from any
	 * nesting depth; the targetOrigin pin means a cross-origin top
	 * (foreign page iframing wp-admin) simply never receives it.
	 */
	try {
		var __wpdShell = window.top || window.parent;
		if ( __OPENSTATION_MENU_PAYLOAD__ ) {
			__wpdShell.postMessage(
				{
					type: 'os-plugins-changed',
					payload: __OPENSTATION_MENU_PAYLOAD__
				},
				window.location.origin
			);
		} else if ( __OPENSTATION_MENU_SIG__ ) {
			/*
			 * No full payload on this page — but we still ship the cheap
			 * menu signature so the shell can notice a menu change that
			 * happened somewhere off the plugins/themes/update path (a
			 * CPT registered via a settings tool, a plugin that adds a
			 * menu on save, …) and spend a refresh probe only then.
			 * GH#325.
			 */
			__wpdShell.postMessage(
				{
					type: 'os-menu-signature',
					sig: __OPENSTATION_MENU_SIG__
				},
				window.location.origin
			);
		}
	} catch ( err ) {
		/* postMessage throws only on structured-clone failures, which
		 * this static payload won't hit. Swallow defensively so a
		 * wayward extension wrapping window.parent can't break the
		 * rest of the bridge. */
	}

	/*
	 * Link & form interceptor.
	 *
	 * Every same-origin wp-admin <a> href and <form> action gets the
	 * `openstation_chromeless=1` flag appended so navigation inside the iframe stays
	 * chromeless. Without this, a stray link to /wp-admin/edit.php (see
	 * Gutenberg's fullscreen close button, help-tab links, "Return to
	 * posts" affordances, etc.) re-renders the full classic admin inside
	 * our window.
	 *
	 * Excluded from rewriting:
	 *   - modifier clicks (cmd/ctrl/shift/alt) — user wants to open a
	 *     new tab/window, respect that
	 *   - target="_blank" / target="_top" / target="_parent"
	 *   - download attribute
	 *   - in-page anchors (#)
	 *   - mailto:, tel:, javascript: schemes
	 *   - cross-origin URLs
	 *   - URLs that already carry openstation_chromeless=
	 */
	/*
	 * Which ADMIN a path belongs to: the site root up to and including
	 * the first `/wp-admin/`, plus the `network/` or `user/` segment
	 * when there is one — the client-side twin of `self_admin_url()`.
	 * That segment is the part a site-root comparison gets wrong: the
	 * network admin sits UNDER the main site's admin, sharing its
	 * prefix.
	 */
	function adminScope( pathname ) {
		var i = pathname.indexOf( '/wp-admin/' );
		if ( i === -1 ) {
			return '';
		}
		var rest = pathname.slice( i + 10 );
		var sub = /^(network|user)\//.exec( rest );
		return pathname.slice( 0, i + 10 ) + ( sub ? sub[ 0 ] : '' );
	}

	/*
	 * Whether an admin URL belongs to a DIFFERENT admin: another site,
	 * or the network admin seen from a site and the reverse. On a
	 * subdirectory multisite every site shares one origin, so these used
	 * to pass every gate as ordinary in-window navigations — which put
	 * one admin inside another's shell, and the bridge there repainted
	 * the dock with its own menu. See docs/multisite.md.
	 */
	function isOtherAdmin( url ) {
		var ours = adminScope( window.location.pathname );
		var theirs = adminScope( url.pathname );
		return '' !== ours && '' !== theirs && ours !== theirs;
	}

	function rewriteAdminUrl( href, base ) {
		if ( ! href || href.charAt( 0 ) === '#' ) {
			return null;
		}
		if ( /^(mailto:|tel:|javascript:|data:)/i.test( href ) ) {
			return null;
		}
		var url;
		try {
			url = new URL( href, base );
		} catch ( err ) {
			return null;
		}
		if ( url.origin !== window.location.origin ) {
			return null;
		}
		if ( url.pathname.indexOf( '/wp-admin/' ) === -1 ) {
			return null;
		}
		if ( isOtherAdmin( url ) ) {
			return null;
		}
		if ( url.searchParams.has( 'openstation_chromeless' ) ) {
			return null;
		}
		url.searchParams.set( 'openstation_chromeless', '1' );
		return url.toString();
	}

	/*
	 * Classify a link so we know whether to rewrite it (admin),
	 * escalate it to the parent shell (external / non-admin), or let
	 * the browser navigate naturally (mailto, anchor, download, etc.).
	 *
	 *   'admin'       — same-origin /wp-admin/ URL we rewrite in place.
	 *   'other-admin'  — another site, or the network admin. The
	 *                   workspace hop: the top tab navigates there.
	 *                   (Modifier and middle clicks never get here —
	 *                   the handler yields them to the browser.)
	 *   'external'    — http(s) URL we want the parent shell to open
	 *                   as a sub-tab instead of navigating the iframe
	 *                   out of wp-admin. Covers both cross-origin
	 *                   links (plugin author sites, external docs) AND
	 *                   same-origin non-admin links (the site's own
	 *                   front-end pages).
	 *   'passthrough' — anything else (mailto, tel, javascript, data,
	 *                   anchors, unparseable). The browser handles it.
	 */
	function classifyLink( href, base ) {
		if ( ! href || href.charAt( 0 ) === '#' ) {
			return 'passthrough';
		}
		if ( /^(mailto:|tel:|javascript:|data:)/i.test( href ) ) {
			return 'passthrough';
		}
		var url;
		try {
			url = new URL( href, base );
		} catch ( err ) {
			return 'passthrough';
		}
		if ( url.protocol !== 'http:' && url.protocol !== 'https:' ) {
			return 'passthrough';
		}
		if (
			url.origin === window.location.origin &&
			url.pathname.indexOf( '/wp-admin/' ) !== -1
		) {
			return isOtherAdmin( url ) ? 'other-admin' : 'admin';
		}
		return 'external';
	}

	/*
	 * Rewrite a link's href to carry `_wp_http_referer=<this page>`.
	 *
	 * The iframe-side twin of `stampSourceReferer()` in
	 * `src/window/iframe-bridge.ts`, for links the interceptor yields
	 * on: the parent never sees the click, so it can't stamp them.
	 * `wp_get_referer()` reads `$_REQUEST['_wp_http_referer']` ahead
	 * of the raw header, so the param survives any `Referrer-Policy`.
	 *
	 * Same three guards as the parent, for the same reasons: never
	 * overwrite a referer the markup already supplied, stay
	 * same-origin (a mis-attributed referer is worse than none), and
	 * strip the chromeless flag from the hint so it doesn't loop into
	 * whatever redirect WP builds out of it.
	 */
	function stampSourceRefererOnLink( link ) {
		try {
			var target = new URL( link.getAttribute( 'href' ), window.location.href );
			if ( target.origin !== window.location.origin ) {
				return;
			}
			if ( target.searchParams.has( '_wp_http_referer' ) ) {
				return;
			}
			var source = new URL( window.location.href );
			source.searchParams.delete( 'openstation_chromeless' );
			target.searchParams.set(
				'_wp_http_referer',
				source.pathname + ( source.search ? source.search : '' )
			);
			link.setAttribute( 'href', target.toString() );
		} catch ( err ) {
			/* Unparseable href, so leave the link exactly as it was. */
		}
	}

	/*
	 * The text a link actually SHOWS, for use as a window title.
	 *
	 * `textContent` is the wrong source on its own. WP Core routinely
	 * pairs a terse visible label with a longer screen-reader one
	 * inside the same anchor, and reads back as both at once. Drop the
	 * screen-reader half (`.screen-reader-text` is Core's own class for
	 * it, `.hidden` covers the markup that toggles) and collapse the
	 * indentation whitespace the templates leave behind.
	 *
	 * The parent treats a label harvested this way as provisional and
	 * upgrades it to the destination page's own title once the iframe
	 * loads — see `titleFromPage` in `src/types.ts`.
	 */
	/*
	 * The wp-admin filename a URL points at (`revision.php`), or an
	 * empty string when it can't be read. Used to tell "a different
	 * admin screen" from "another view of this one" without needing
	 * the shell's window-slug rules.
	 */
	function adminFileOf( url ) {
		try {
			return new URL( url, window.location.href ).pathname.split( '/' ).pop();
		} catch ( err ) {
			return '';
		}
	}

	function visibleLinkText( link ) {
		var clone = link.cloneNode( true );
		var muted = clone.querySelectorAll( '.screen-reader-text, .hidden' );
		for ( var i = 0; i < muted.length; i++ ) {
			if ( muted[ i ].parentNode ) {
				muted[ i ].parentNode.removeChild( muted[ i ] );
			}
		}
		return ( clone.textContent || '' ).replace( /\s+/g, ' ' ).trim();
	}

	document.addEventListener( 'click', function ( e ) {
		if ( e.defaultPrevented ) {
			return;
		}
		if ( e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey ) {
			return;
		}
		var link = e.target && e.target.closest ? e.target.closest( 'a[href]' ) : null;
		if ( ! link ) {
			return;
		}
		/*
		 * A link that names another browsing context.
		 *
		 * `_blank` on a /wp-admin/ URL means "open this admin screen
		 * without losing the one I am on", and inside the shell that
		 * is another window rather than a browser tab that drops the
		 * user out of the desktop. Claimed only when the destination
		 * is a DIFFERENT wp-admin file: whether two URLs on one file
		 * are the same "page" depends on the shell's window-slug
		 * rules, which the iframe can't see, and guessing wrong makes
		 * the parent navigate the window the link was clicked in.
		 *
		 * Every other target yields. `_top` / `_parent` are a
		 * deliberate "replace the whole shell" and a page's only
		 * escape hatch; a named target (`wp-preview-4`) reuses one
		 * specific tab across clicks, which a window cannot honour;
		 * and any target on a non-admin URL has no window to open
		 * into.
		 */
		var newContext = false;
		var linkTarget = link.target || '';
		if ( linkTarget !== '' && linkTarget !== '_self' ) {
			var claimable =
				linkTarget === '_blank' &&
				classifyLink( link.getAttribute( 'href' ), window.location.href ) === 'admin' &&
				adminFileOf( link.getAttribute( 'href' ) ) !== '' &&
				adminFileOf( link.getAttribute( 'href' ) ) !== adminFileOf( window.location.href );
			if ( ! claimable ) {
				return;
			}
			newContext = true;
		}
		if ( link.hasAttribute( 'download' ) ) {
			return;
		}
		/*
		 * Activity-footprint launcher. A "View activity footprint" row
		 * action (added to the Users list table by
		 * `openstation_user_footprint_row_action`) carries the target
		 * user id in `data-os-footprint`. The iframe has no
		 * shell API of its own, so we escalate the click to the parent
		 * shell, which opens the My WordPress window on that user's
		 * footprint. Checked BEFORE classifyLink so the link's real
		 * href — a graceful profile-edit fallback for no-JS — is never
		 * followed inside the shell. Modifier-key / middle clicks are
		 * already filtered above, so cmd/ctrl-click still opens that
		 * fallback in a new browser tab.
		 */
		var footprintAttr = link.getAttribute( 'data-os-footprint' );
		if ( footprintAttr ) {
			var footprintUid = parseInt( footprintAttr, 10 );
			if ( footprintUid > 0 ) {
				e.preventDefault();
				try {
					window.parent.postMessage(
						{
							type: 'os-open-user-footprint',
							userId: footprintUid,
							userName: link.getAttribute( 'data-os-footprint-name' ) || ''
						},
						window.location.origin
					);
				} catch ( footprintErr ) {
					/* Same-origin postMessage can only fail in a sandbox
					 * we don't support — swallow rather than block the
					 * click. */
				}
				return;
			}
		}
		/*
		 * `aria-button-if-js` is WP core's own marker for "this anchor
		 * is really an in-page button; the href is only the no-JS
		 * fallback". Core stamps `role="button"` on every one of them
		 * (`wp-admin/js/common.js`), and the owning script binds a
		 * bubble-phase handler that calls preventDefault: media-grid.js
		 * for the Media Library's uploader toggle, wp-lists for the
		 * comment row actions, tags.js for term Delete, updates.js
		 * for the auto-update toggles.
		 *
		 * Our capture-phase handler runs first, so hijacking these
		 * substitutes the fallback URL for the in-page action the user
		 * actually asked for. On the Media Library grid that showed up as
		 * two uploaders at once: the shell opened a window for
		 * `media-new.php` (the fallback) while media-grid.js's
		 * `addNewClickHandler` still expanded the inline drop zone in the
		 * Media window behind it, and closing the window left the drop
		 * zone stranded above the grid.
		 *
		 * The class does NOT promise a handler, though. The Media list
		 * table stamps it on Trash / Restore / Delete Permanently
		 * (`.submitdelete`, `class-wp-media-list-table.php`) and binds
		 * nothing: the href really is the navigation. Yielding is still
		 * right for those (the inline `onclick` confirm runs, and
		 * cancelling actually cancels, which it did not when we
		 * preventDefaulted in capture ahead of it), but the parent's
		 * destructive-action path used to stamp `_wp_http_referer` on
		 * them, and a raw navigation loses that. See `stampSourceReferer`
		 * in `src/window/iframe-bridge.ts` for the full rationale; the
		 * short version is that a `Referrer-Policy` of `strict-origin` or
		 * tighter downgrades the `Referer` header to the bare origin,
		 * which `post.php` matches against neither `post.php` nor
		 * `post-new.php`, so `$sendback` stays the origin and the window
		 * lands on the site front page instead of back on the list.
		 *
		 * So stamp the hint ourselves before yielding. In here the
		 * source page IS `window.location`, which makes this the same
		 * value the parent would have computed, minus the round trip.
		 */
		if ( link.classList.contains( 'aria-button-if-js' ) ) {
			if ( link.classList.contains( 'submitdelete' ) ) {
				stampSourceRefererOnLink( link );
			}
			return;
		}
		/*
		 * Same story as `aria-button-if-js` above, minus the marker
		 * class: `plugin-install.php`'s "Upload Plugin" href is a
		 * no-JS fallback, and plugin-install.js binds a bubble-phase
		 * handler that opens the drop zone in place above the plugin
		 * cards. Our capture handler used to win and navigate to
		 * `?tab=upload`, which shows the uploader with no cards.
		 *
		 * On that page core skips the binding on purpose ("let the
		 * link behave like a link"), flagged by
		 * `plugin-install-tab-upload` on the wrap. There the href is
		 * the real navigation, so we route it as usual.
		 *
		 * `theme-install.php`'s Upload Theme is a `<button>`, so it
		 * never reaches this handler.
		 */
		if ( link.classList.contains( 'upload-view-toggle' ) ) {
			var uploadWrap = link.closest( '.wrap' );
			if (
				! uploadWrap ||
				! uploadWrap.classList.contains( 'plugin-install-tab-upload' )
			) {
				return;
			}
		}
		/*
		 * Same shape as the toggles above: dashboard.js binds the
		 * dismiss on the anchor and preventDefaults, so our capture
		 * handler gets there first and routes `?welcome=0` (a dead
		 * no-JS fallback) into a second Dashboard window titled
		 * "Dismiss". Scoped like core's own selector, so a
		 * `welcome-panel-close` elsewhere still routes.
		 */
		if (
			link.closest( '#welcome-panel' ) &&
			( link.classList.contains( 'welcome-panel-close' ) ||
				link.closest( '.welcome-panel-dismiss' ) )
		) {
			return;
		}
		/*
		 * WordPress core's wp-admin/js/updates.js owns the click on these
		 * AJAX-driven plugin/theme management buttons — it binds in bubble
		 * phase and calls preventDefault to take over with an in-place
		 * AJAX install / update / delete (with its own progress spinner
		 * and inline success/failure UX). Our capture-phase handler would
		 * preempt it: preventDefault here fires BEFORE updates.js's own,
		 * the AJAX call never starts, and the postMessage below diverts
		 * the user to the link's no-JS fallback URL (update.php?action=
		 * install-plugin&...) opened as a freshly spawned desktop window.
		 * That fallback technically completes the install server-side,
		 * but it's a long blocking page-load with no in-place feedback —
		 * which is what users perceive as "Install Now keeps loading and
		 * opens a new tab". Skip these classes so updates.js's bubble
		 * handler runs as core intended.
		 *
		 * The plugins-list-table row action "Delete" is the same story
		 * with a different marker: a bare `a.delete` inside a
		 * `tr[data-plugin]` (updates.js binds `[data-plugin] a.delete`;
		 * the network themes list is `.themes-php.network-admin
		 * a.delete`) — it never carries the `delete-plugin` /
		 * `delete-theme` classes of the card-style buttons above.
		 * Hijacking it navigated the iframe to the link's no-JS
		 * bulk-delete fallback WHILE updates.js's AJAX delete was
		 * already running: `wp.updates.beforeunload` raised a native
		 * "Leave site?" prompt, and leaving landed on a delete
		 * confirmation screen for a plugin whose files the AJAX call
		 * had just removed — an empty "You are about to remove:" list.
		 */
		if (
			link.classList.contains( 'install-now' ) ||
			link.classList.contains( 'update-link' ) ||
			link.classList.contains( 'update-now' ) ||
			link.classList.contains( 'delete-plugin' ) ||
			link.classList.contains( 'delete-theme' ) ||
			link.classList.contains( 'install-theme' ) ||
			( link.classList.contains( 'delete' ) &&
				( link.closest( '[data-plugin]' ) ||
					( document.body.classList.contains( 'themes-php' ) &&
						document.body.classList.contains( 'network-admin' ) ) ) )
		) {
			return;
		}
		var href = link.getAttribute( 'href' );
		var kind = classifyLink( href, window.location.href );
		if ( kind === 'admin' ) {
			var rewritten = rewriteAdminUrl( href, window.location.href );
			if ( rewritten ) {
				link.setAttribute( 'href', rewritten );
			}
			/*
			 * Hand admin-internal navigation to the parent shell.
			 *
			 * The parent decides what to do with each click:
			 *
			 *   - Native-window remap hits (e.g. `edit.php` while the
			 *     user has the native Posts opt-in on) → parent opens
			 *     the native window and closes THIS iframe.
			 *   - Same-page nav (pagination, filtering on the same
			 *     `edit.php?post_type=page` screen, etc.) → parent
			 *     drives the iframe's `location.assign()` so the
			 *     in-place navigation matches the user's intent.
			 *   - Cross-page nav (e.g. clicking "Posts" from inside
			 *     the Pages window) → parent opens a new window for
			 *     the destination and leaves THIS iframe untouched,
			 *     so the user keeps both contexts.
			 *
			 * We `preventDefault()` so the iframe never starts a
			 * navigation the parent might want to suppress; otherwise
			 * cross-page clicks would trash the source window before
			 * the parent had a chance to react. Modifier-key clicks
			 * (cmd/ctrl/shift/alt, middle-click) are already filtered
			 * upstream so the browser's native "open in new tab" path
			 * still works.
			 */
			e.preventDefault();
			try {
				var absolute = new URL( rewritten || href, window.location.href ).toString();
				/*
				 * Ship the link's visible text along with the URL so
				 * the parent can title a freshly-opened window with
				 * something the user recognises ("Scheduler") instead
				 * of the URL slug ("tools-php-page-scheduler") when
				 * the destination has no dock tile to copy a title
				 * from. The iframe itself never auto-emits a
				 * title-change, so without this hint the slug-as-
				 * title fallback would persist for the lifetime of
				 * the new window.
				 */
				var adminLabel = visibleLinkText( link ) ||
					link.getAttribute( 'title' ) ||
					link.getAttribute( 'aria-label' ) ||
					'';
				window.parent.postMessage(
					{
						type: 'os-iframe-admin-link',
						url: absolute,
						label: adminLabel.slice( 0, 80 ),
						/*
						 * The link asked for a new browsing context, so
						 * the parent must give the destination its own
						 * window rather than driving this one. Without
						 * the flag it would still be free to pick an
						 * in-place branch — the destructive-action one
						 * fires on slug mismatch, which is exactly the
						 * shape a `_blank` reaches us with.
						 */
						newContext: newContext
					},
					window.location.origin
				);
			} catch ( bridgeErr ) {
				/* Same-origin postMessage to the same window can only fail in
				 * a sandbox we don't support — swallow rather than block the
				 * click. */
			}
			return;
		}
		if ( kind === 'other-admin' ) {
			/*
			 * A different admin: the WORKSPACE HOP. Not a window (see
			 * isOtherAdmin), and no longer a forced browser tab either —
			 * every admin keeps its own desktop under its own session
			 * key, so navigating the top tab there restores that
			 * admin's desktop and leaves this one saved exactly as it
			 * stands, with the shell stylesheet's cross-document view
			 * transition covering the swap. A modifier or middle click
			 * never reaches this branch — the handler yields those to
			 * the browser, whose native new-tab behavior keeps the
			 * side-by-side option. See docs/multisite.md.
			 */
			e.preventDefault();
			var other;
			try {
				other = new URL( href, window.location.href );
			} catch ( err ) {
				return;
			}
			/* A stray flag would make the destination a standalone
			 * chromeless page with no way out. */
			other.searchParams.delete( 'openstation_chromeless' );
			/* No modifier check here: the handler's first guard yields
			 * every modified and non-primary click to the browser, whose
			 * native new-tab behavior IS the side-by-side path. */
			try {
				window.top.location.assign( other.href );
			} catch ( err ) {
				/* A host that forbids top navigation (a sandboxed
				 * embed) still gets the tab. */
				window.open( other.href, '_blank', 'noopener,noreferrer' );
			}
			return;
		}
		if ( kind === 'external' ) {
			/*
			 * External navigation inside an admin iframe would leave
			 * the user stranded in a chrome-free version of whatever
			 * site the link points at. Escalate to the parent shell
			 * so it opens the URL as a closeable sub-tab (with a
			 * detach button) alongside the admin tab — the user
			 * stays inside the desktop shell.
			 *
			 * Resolving the href against the document base gives the
			 * parent an absolute URL it doesn't have to re-resolve.
			 */
			e.preventDefault();
			// Named apart from the `absolute` in the admin-link branch
			// above: `var` is function-scoped, so both branches shared
			// one binding. They are mutually exclusive and each assigns
			// before reading, so nothing was ever wrong — but one name
			// per value is what a reader expects.
			var externalAbsolute;
			try {
				externalAbsolute = new URL( href, window.location.href ).toString();
			} catch ( err ) {
				return;
			}
			var label = visibleLinkText( link ) ||
				link.getAttribute( 'title' ) ||
				externalAbsolute;
			window.parent.postMessage(
				{
					type: 'os-external-link',
					url: externalAbsolute,
					label: label.slice( 0, 80 )
				},
				window.location.origin
			);
		}
	}, true );

	document.addEventListener( 'submit', function ( e ) {
		var form = e.target;
		if ( ! form || form.tagName !== 'FORM' ) {
			return;
		}
		var action = form.getAttribute( 'action' );
		var rewritten = rewriteAdminUrl( action || window.location.href, window.location.href );
		if ( rewritten ) {
			form.setAttribute( 'action', rewritten );
		}
	}, true );

	/*
	 * Form submits — the other half of the status ring. The wrappers
	 * above miss the admin's most common save, a classic POST, which
	 * navigates rather than issuing a request they can see.
	 * `navigation: true` tells the parent no `end` is coming: this
	 * document is about to be replaced, and the response is the end.
	 *
	 * Bubble phase, after `defaultPrevented`, and never with a
	 * `target` — a submit a script handles itself, or one aimed at
	 * another browsing context, leaves this document where it is, and
	 * a start posted for it would never be closed.
	 */
	document.addEventListener( 'submit', function ( e ) {
		var form = e.target;
		if ( ! form || form.tagName !== 'FORM' || e.defaultPrevented ) {
			return;
		}
		var target = form.getAttribute( 'target' );
		if ( target && '_self' !== target ) {
			return;
		}
		// A GET submit is a read — the search box, the date filter —
		// with one exception, and it is the most common destructive
		// action in the admin: `edit.php`, `upload.php` and
		// `edit-comments.php` all submit their bulk actions over GET,
		// on the same form as the search box. Trashing twenty posts
		// is a write however it travels. Mirror
		// `WP_List_Table::current_action()`: a bulk-action select set
		// to anything but -1 is an action, and the Filter button is
		// not one whatever the select says.
		if ( 'POST' !== String( form.getAttribute( 'method' ) || 'get' ).toUpperCase() ) {
			if ( e.submitter && 'filter_action' === e.submitter.name ) {
				return;
			}
			var picked = false;
			var actions = form.querySelectorAll( 'select[name="action"],select[name="action2"]' );
			for ( var i = 0; i < actions.length; i++ ) {
				if ( actions[ i ].value && '-1' !== actions[ i ].value ) {
					picked = true;
				}
			}
			if ( ! picked ) {
				return;
			}
		}
		try {
			window.parent.postMessage(
				{ type: 'os-iframe-activity', phase: 'start', navigation: true },
				window.location.origin
			);
		} catch ( _subErr ) { /* swallow — instrumentation is best-effort */ }
	} );

	/*
	 * Focus-request bridge.
	 *
	 * Clicks inside an iframe don't cross the browsing-context
	 * boundary — the parent shell's pointerdown / focusin listeners
	 * never see them, so without this hook the only way to focus an
	 * iframe window would be clicking its title bar chrome. Post a
	 * `os-focus-request` message on every pointerdown; the
	 * parent Window class treats it as an onFocusRequest. Capture
	 * phase so the signal fires before any stopPropagation inside
	 * a page's own handlers.
	 */
	function postFocusRequest() {
		try {
			window.parent.postMessage(
				{ type: 'os-focus-request' },
				window.location.origin
			);
		} catch ( err ) {
			/* cross-origin parent (shouldn't happen for chromeless
			 * pages, but don't let a throw break the bridge) */
		}
	}

	document.addEventListener( 'pointerdown', postFocusRequest, true );

	/*
	 * Nested-frame focus escalation.
	 *
	 * The document-level listener above never hears clicks inside
	 * NESTED iframes: Gutenberg renders the post canvas in one
	 * (`editor-canvas`, srcdoc → same-origin), and TinyMCE's visual
	 * mode uses `#content_ifr`. Without this hook, clicking into the
	 * canvas of an unfocused editor window is swallowed — only the
	 * toolbar/sidebar (outer document) would focus the window.
	 * Attach the same escalation inside every same-origin nested
	 * frame: on load (each navigation creates a fresh document) and
	 * as frames mount (Gutenberg creates the canvas asynchronously
	 * and re-creates it, e.g. on device-preview switches).
	 *
	 * The observer walks only each record's `addedNodes` — the same
	 * shape as the component-sniffer observer at the top of this
	 * file, and for the same reason. Re-querying the whole document
	 * per mutation batch would put an O(DOM) tree walk on Gutenberg's
	 * typing path, which is precisely when the editor mutates hardest
	 * (and precisely when the editor-preview pairing is live). A
	 * frame that was never inserted cannot need hooking, so the
	 * narrow sweep loses nothing. The WeakSets keep it idempotent
	 * when a subtree is moved rather than created.
	 */
	var hookedFrameDocs = new WeakSet();
	var hookedFrameEls = new WeakSet();

	function hookNestedFrameDoc( frame ) {
		var doc;
		try {
			doc = frame.contentDocument;
		} catch ( err ) {
			return; /* cross-origin frame — unreachable, skip */
		}
		if ( ! doc || hookedFrameDocs.has( doc ) ) {
			return;
		}
		hookedFrameDocs.add( doc );
		doc.addEventListener( 'pointerdown', postFocusRequest, true );
	}

	function hookNestedFrame( frame ) {
		if ( ! hookedFrameEls.has( frame ) ) {
			hookedFrameEls.add( frame );
			frame.addEventListener( 'load', function ( ev ) {
				hookNestedFrameDoc( ev.target );
			} );
		}
		hookNestedFrameDoc( frame );
	}

	/*
	 * Hook every iframe at or below `root`. `root` is the document on
	 * the initial sweep and a freshly-added node thereafter, so the
	 * walk stays proportional to what actually changed.
	 */
	function hookNestedFrames( root ) {
		if ( ! root || ( 1 !== root.nodeType && 9 !== root.nodeType ) ) {
			return; /* text / comment node — nothing to walk */
		}
		if ( 'IFRAME' === root.nodeName ) {
			hookNestedFrame( root );
		}
		var frames = root.querySelectorAll( 'iframe' );
		for ( var i = 0; i < frames.length; i++ ) {
			hookNestedFrame( frames[ i ] );
		}
	}

	hookNestedFrames( document );
	if ( window.MutationObserver ) {
		new MutationObserver( function ( records ) {
			for ( var r = 0; r < records.length; r++ ) {
				var added = records[ r ].addedNodes;
				for ( var n = 0; n < added.length; n++ ) {
					hookNestedFrames( added[ n ] );
				}
			}
		} ).observe(
			document.documentElement,
			{ childList: true, subtree: true }
		);
	}

	/*
	 * OS-file drop forwarder. When the user drags a file from the
	 * host OS into a chromeless admin iframe, intercept the drop
	 * before the browser's default "navigate the iframe to the
	 * file" handler fires, and `postMessage` the raw `File[]` up
	 * to the parent shell so the OS-file drop manager
	 * (`src/os-file-drop/manager.ts`) can show the upload dialog.
	 *
	 * Same-origin postMessage preserves `File` identity — the
	 * parent receives real `File` objects, no base64 round-trip.
	 *
	 * We only intercept drops whose `DataTransfer.types` includes
	 * `'Files'`. In-page DnD (Gutenberg block reorders, media
	 * library drags) carries non-`Files` types and passes through
	 * untouched.
	 */
	function bridgeHasFiles( ev ) {
		var t = ev && ev.dataTransfer && ev.dataTransfer.types;
		if ( ! t ) {
			return false;
		}
		if ( typeof t.includes === 'function' ) {
			return t.includes( 'Files' );
		}
		if ( typeof t.contains === 'function' ) {
			return t.contains( 'Files' );
		}
		for ( var i = 0; i < t.length; i++ ) {
			if ( t[ i ] === 'Files' ) {
				return true;
			}
		}
		return false;
	}
	/*
	 * Selectors of in-iframe drop receivers we leave alone —
	 * Gutenberg's drop zone, the legacy media uploader, any
	 * element a plugin marks with `data-drop-zone`. The whole
	 * point: file drops onto Gutenberg blocks keep firing
	 * Gutenberg's handler; only drops on the empty page
	 * background escalate to the shell.
	 */
	var bridgeDropPassthroughSelectors = [
		'.components-drop-zone',
		'[data-drop-zone]',
		'.uploader-window',
		'.media-frame-content'
	];
	function bridgeDropTargetWantsFile( target ) {
		if ( ! target || ! target.closest ) {
			return false;
		}
		for ( var s = 0; s < bridgeDropPassthroughSelectors.length; s++ ) {
			if ( target.closest( bridgeDropPassthroughSelectors[ s ] ) ) {
				return true;
			}
		}
		return false;
	}
	/*
	 * Bubble phase (not capture): the inner-most handler — Gutenberg's
	 * drop zone, the legacy media uploader, or a third-party plugin
	 * like "Administrador de archivos WP" — runs FIRST and gets the
	 * chance to call `preventDefault()` to claim the drop. Our
	 * forwarder then runs LAST at the document level and yields to
	 * anyone who already took ownership.
	 *
	 * Two bail conditions, in order:
	 *   1. `bridgeDropTargetWantsFile()` — the curated allowlist
	 *      (Gutenberg, wp.media, anything tagged `[data-drop-zone]`).
	 *      Kept as the primary check so the well-known core surfaces
	 *      behave identically to before, even if some edge case skips
	 *      the `preventDefault()` step.
	 *   2. `ev.defaultPrevented` — the universal HTML5 contract: any
	 *      drop zone willing to receive a file calls `preventDefault()`
	 *      on `dragover` (mandatory per spec) and `drop` (to suppress
	 *      the browser's default navigate-to-file). When that's true,
	 *      some inner handler has taken the drop — yield so plugins
	 *      outside the allowlist (WP File Manager, Yoast, etc.) keep
	 *      their native UX.
	 */
	document.addEventListener( 'dragover', function ( ev ) {
		if ( ! bridgeHasFiles( ev ) ) {
			return;
		}
		if ( bridgeDropTargetWantsFile( ev.target ) ) {
			return;
		}
		if ( ev.defaultPrevented ) {
			return;
		}
		ev.preventDefault();
		if ( ev.dataTransfer ) {
			ev.dataTransfer.dropEffect = 'copy';
		}
	}, false );
	document.addEventListener( 'drop', function ( ev ) {
		if ( ! bridgeHasFiles( ev ) ) {
			return;
		}
		if ( bridgeDropTargetWantsFile( ev.target ) ) {
			return;
		}
		if ( ev.defaultPrevented ) {
			return;
		}
		ev.preventDefault();
		ev.stopPropagation();
		var files = [];
		if ( ev.dataTransfer && ev.dataTransfer.files ) {
			for ( var i = 0; i < ev.dataTransfer.files.length; i++ ) {
				files.push( ev.dataTransfer.files[ i ] );
			}
		}
		if ( files.length === 0 ) {
			return;
		}
		try {
			window.parent.postMessage(
				{
					type: 'os-file-drop',
					files: files,
					x: ev.clientX,
					y: ev.clientY,
				},
				window.location.origin
			);
		} catch ( err ) { /* cross-origin parent; swallow */ }
	}, false );

	/*
	 * Drag-hover forwarder. Native drag events don't cross iframe
	 * boundaries, so when the user holds ANY drag (an OS file, an
	 * image lifted off another admin page, a text selection) over
	 * this window, the parent shell has no idea the window is being
	 * hovered. Forward a throttled, payload-free heartbeat so the
	 * shell's focus-on-drag-hover module
	 * (`src/drag/focus-window-on-drag-hover.ts`) can raise this
	 * window after its dwell. Purely observational — no
	 * `preventDefault()`, no interference with in-page drop zones.
	 * The parent identifies the hovered window from the message
	 * source, so no coordinates travel.
	 *
	 * Sentinel-guarded: the standalone bridge bundle
	 * (`iframe-bridge-standalone.ts`) installs the same forwarder,
	 * and unlike the drop forwarder above there is no
	 * `defaultPrevented` handshake to dedupe a double install.
	 */
	if ( ! window.__openStationDragHoverForwarderInstalled ) {
		window.__openStationDragHoverForwarderInstalled = true;
		var dragHoverLastSent = 0;
		document.addEventListener( 'dragover', function ( ev ) {
			var now = Date.now();
			if ( now - dragHoverLastSent < 150 ) {
				return;
			}
			dragHoverLastSent = now;
			try {
				window.parent.postMessage(
					{
						type: 'os-drag-hover',
						payloadType: bridgeHasFiles( ev ) ? 'os-file' : 'external',
					},
					window.location.origin
				);
			} catch ( err ) { /* cross-origin parent; swallow */ }
		}, true );
	}

	/*
	 * Pointer forwarder — OPT-IN, off by default.
	 *
	 * Pointer events don't cross iframe boundaries, so the parent
	 * shell goes blind to the cursor the moment it enters a window.
	 * Anything in the shell that needs to know where the mouse
	 * actually is while it's over window content — today, the
	 * Mio's gaze (`src/mio/pointer.ts`) — gets a throttled
	 * stream of this frame's client coordinates and rebases them
	 * through the iframe element's own rect.
	 *
	 * Strictly opt-in: the parent posts
	 * `os-pointer-track { enabled: true }` when a consumer
	 * starts, and `{ enabled: false }` when the last one stops. A
	 * shell with no consumer never turns this on and pays nothing.
	 * `os-bridge-ready` (emitted at the end of this script,
	 * i.e. on every navigation) is the parent's cue to re-arm a
	 * freshly-loaded frame.
	 *
	 * Coordinates only — no target element, no event object, nothing
	 * about the page content. Purely observational: passive listener,
	 * no `preventDefault()`.
	 *
	 * Sentinel-guarded: the standalone bridge bundle
	 * (`iframe-bridge-standalone.ts`) installs the same forwarder.
	 */
	if ( ! window.__openStationPointerForwarderInstalled ) {
		window.__openStationPointerForwarderInstalled = true;
		var pointerTrackOn = false;
		var pointerLastSent = 0;
		window.addEventListener( 'message', function ( e ) {
			if ( e.origin !== window.location.origin ) return;
			if ( ! e.data || e.data.type !== 'os-pointer-track' ) return;
			pointerTrackOn = !! e.data.enabled;
		} );
		document.addEventListener( 'pointermove', function ( ev ) {
			if ( ! pointerTrackOn ) return;
			var now = Date.now();
			// ~25 Hz. The consumer interpolates; a faster stream buys
			// nothing visible and costs a postMessage per mouse move.
			if ( now - pointerLastSent < 40 ) return;
			pointerLastSent = now;
			try {
				window.parent.postMessage(
					{
						type: 'os-pointer-move',
						x: ev.clientX,
						y: ev.clientY
					},
					window.location.origin
				);
			} catch ( err ) { /* cross-origin parent; swallow */ }
		}, { capture: true, passive: true } );
	}

	/*
	 * Cmd+K / Ctrl+K forwarder — single-press, unconditional.
	 *
	 * Native keydown events don't cross iframe boundaries. Inside a
	 * chromeless admin page we want exactly ONE command palette: the
	 * desktop shell's. WordPress's own `core/commands` palette is
	 * harvested by `__wpdHarvestCommands` below and re-surfaced in the
	 * shell palette, so there's no reason to ever let the in-page palette
	 * take the keystroke.
	 *
	 * Capture phase + `stopImmediatePropagation` so we win the race
	 * against Gutenberg / TinyMCE / plugin handlers bound to the same
	 * shortcut. Shift/Alt modifiers pass through so user shortcuts using
	 * those combos keep working.
	 */
	document.addEventListener( 'keydown', function ( e ) {
		if ( ! ( e.metaKey || e.ctrlKey ) ) return;
		if ( e.key !== 'k' && e.key !== 'K' ) return;
		if ( e.shiftKey || e.altKey ) return;

		e.preventDefault();
		e.stopImmediatePropagation();

		try {
			window.parent.postMessage(
				{ type: 'os-palette-cycle' },
				window.location.origin
			);
		} catch ( err ) { /* cross-origin parent; swallow */ }
	}, true );

	/*
	 * Command harvester — bridges `wp.data.select('core/commands')` to
	 * the parent shell.
	 *
	 * On `os-commands-subscribe` from the parent, subscribe to
	 * the `core/commands` store and post `os-commands-list` on
	 * every change (de-duplicated). On `os-commands-invoke`, run
	 * the original callback inside this iframe — the parent fires this
	 * when the user selects a proxied command from the shell palette.
	 *
	 * Commands are classified by dry-invoking their callback inside a
	 * `window.location`-intercept sandbox: pure-navigation callbacks
	 * are flagged `navigate` (with the captured URL) so the parent can
	 * open a new desktop window instead of navigating this iframe out
	 * of chromeless mode. Everything else is `action` and proxies back
	 * into this iframe on user selection.
	 */
	var __wpdCommandsSubscribed   = false;
	var __wpdCommandsLastPayload  = '';
	var __wpdCommandsDebounceId   = null;
	var __wpdCommandsOrigin       = window.location.origin;
	// Cache per command name so the `window.location`-intercept
	// sandbox only runs once per command. Re-classifying on every
	// store tick would repeatedly fire side-effectful action
	// callbacks (preference toggles, modal opens) — unacceptable.
	// Keyed by name; value is the frozen classification minus the
	// live `label` / `icon` (which we always re-read in case the
	// command updated its own metadata).
	var __wpdCommandsKindCache    = Object.create( null );

	function __wpdRenderIconElement( icon ) {
		if ( ! icon ) return '';
		if ( typeof icon === 'string' ) return '';
		if ( ! window.wp || ! window.wp.element || typeof window.wp.element.renderToString !== 'function' ) {
			return '';
		}
		try {
			var rendered = window.wp.element.renderToString( icon );
			// `@wordpress/icons` entries render as a complete `<svg>`
			// tag. Anything else (wrapped components, empty fragments,
			// strings) falls back to dashicons in the palette — we only
			// accept markup we can inject straight into the icon slot.
			if ( typeof rendered === 'string' && rendered.toLowerCase().indexOf( '<svg' ) === 0 ) {
				return rendered;
			}
		} catch ( _err ) { /* swallow */ }
		return '';
	}

	function __wpdClassifyCommand( cmd ) {
		// Defensive defaults — a broken registry should not tank the bridge.
		var out = {
			name:    String( cmd && cmd.name ? cmd.name : '' ),
			label:   String( cmd && cmd.label ? cmd.label : '' ),
			icon:    cmd && cmd.icon && typeof cmd.icon === 'string' ? cmd.icon : undefined,
			iconSvg: undefined,
			context: cmd && cmd.context ? String( cmd.context ) : undefined,
			kind:    'action',
			url:     undefined
		};
		if ( ! cmd || typeof cmd.callback !== 'function' ) {
			return out;
		}

		// Short-circuit on cached classifications — `renderToString` on
		// the React icon is expensive, and the static URL regex scan
		// on `callback.toString()` is pure CPU we've already paid once.
		var cached = __wpdCommandsKindCache[ out.name ];
		if ( cached ) {
			out.kind    = cached.kind;
			out.url     = cached.url;
			out.iconSvg = cached.iconSvg;
			return out;
		}

		// Render the React icon once per command name — Gutenberg
		// commands ship `icon` as a `@wordpress/icons` React element
		// the postMessage bridge can't serialize, so we flatten it to
		// a static SVG string here.
		if ( cmd.icon && typeof cmd.icon !== 'string' ) {
			out.iconSvg = __wpdRenderIconElement( cmd.icon );
		}

		// STATIC classification — read the callback's source text and
		// look for a string-literal navigation target. We deliberately
		// do NOT execute the callback. An earlier iteration tried a
		// dry-run with a `window.location` intercept sandbox, but
		// `Location.prototype.href` is non-configurable: the shim
		// silently failed, every nav callback actually navigated the
		// iframe, the new page re-harvested, and the cascade opened
		// windows forever.
		//
		// Cases caught (WP's @wordpress/core-commands callbacks are
		// all of this shape):
		//   document.location.href = 'url'
		//   window.location.href   = "url"
		//   location.href          = `url`
		//   location.assign( 'url' )
		//   location.replace( 'url' )
		//
		// Computed URLs (template-literal interpolation, addQueryArgs
		// calls, variables) fall back to `action` — the user picking
		// them will still run the real callback inside the iframe,
		// which is the safe default.
		var src = '';
		try { src = Function.prototype.toString.call( cmd.callback ); } catch ( _err ) { src = ''; }
		var navRe = /(?:document\.location\.href|window\.location\.href|location\.href)\s*=\s*['"]([^'"$]+?)['"]/;
		var asgRe = /location\.(?:assign|replace)\s*\(\s*['"]([^'"$]+?)['"]\s*\)/;
		var mm = src.match( navRe ) || src.match( asgRe );
		if ( mm && mm[ 1 ] ) {
			try {
				out.url  = new URL( mm[ 1 ], window.location.href ).toString();
				out.kind = 'navigate';
			} catch ( _err ) {
				out.kind = 'action';
			}
		}
		__wpdCommandsKindCache[ out.name ] = { kind: out.kind, url: out.url, iconSvg: out.iconSvg };
		return out;
	}

	// Harvested commands accumulate here. The React harvester writes
	// the full list each render; `__wpdPostCommandsList` reads + posts.
	var __wpdLastRawCommands = [];
	// Name → live `callback` reference. Loader-returned commands are
	// NOT in `wp.data.select('core/commands').getCommands()` — the
	// store only exposes statically-registered entries. Without a
	// private cache keyed off the React harvester's most recent render,
	// invoking a loader command from the parent palette ("Duplicate
	// block", "Transform to...", pattern commands) would silently fall
	// through to the `getCommands()` lookup and no-op.
	var __wpdCommandCallbacks = Object.create( null );

	function __wpdFinalizeCommands( raw ) {
		var seen = Object.create( null );
		var out = [];
		var skipped = { missing: 0, disabled: 0, dup: 0 };
		for ( var i = 0; i < raw.length; i++ ) {
			var cmd = raw[ i ];
			if ( ! cmd || ! cmd.name || ! cmd.label ) { skipped.missing++; continue; }
			if ( cmd.disabled ) { skipped.disabled++; continue; }
			if ( seen[ cmd.name ] ) { skipped.dup++; continue; }
			seen[ cmd.name ] = true;
			out.push( __wpdClassifyCommand( cmd ) );
		}
		return out;
	}

	function __wpdHarvestCommands() {
		return __wpdFinalizeCommands( __wpdLastRawCommands );
	}

	// React-mounted harvester. Block-level / editor-contextual commands
	// (tier 3 loaders like `core/block-editor/selected-block-commands`,
	// `core/edit-post/pattern-commands`) are React *hooks* — they call
	// `useSelect` internally, which only works inside a function-
	// component render. So we mount an invisible React tree whose
	// children invoke each loader's hook at render time. On every
	// re-render (block selection changes, entity edits, welcome guide
	// toggled) the effect re-posts the fresh command list to the
	// parent. One component per loader keeps the rules-of-hooks
	// contract — the hook count inside each `LoaderSlot` is fixed at
	// one call (plus the constant `useEffect`), so React's reconciler
	// is happy.
	var __wpdReactMounted = false;
	// Stashed so `__wpdUnsubscribeCommands` can tear the harvester
	// down when focus leaves the window — otherwise the component
	// keeps re-rendering on every store tick, calling `mergeAndPost`,
	// and posting command lists the parent drops on the floor.
	var __wpdReactRoot    = null;
	var __wpdReactHost    = null;

	function __wpdMountReactHarvester() {
		if ( __wpdReactMounted ) return;
		if ( ! window.wp || ! window.wp.element || ! window.wp.data ) {
			return;
		}
		var el        = window.wp.element;
		var createEl  = el.createElement;
		var useEffect = el.useEffect;
		var useRef    = el.useRef;
		var useMemo   = el.useMemo;
		var useSelect = ( window.wp.data && window.wp.data.useSelect ) || null;
		if ( ! createEl || ! useSelect || ! el.createRoot || ! useRef ) {
			return;
		}
		__wpdReactMounted = true;

		// Hidden mount point. Positioned off-screen + `aria-hidden` so
		// nothing the harvester renders (it renders null anyway) can
		// leak into the accessibility tree or the visible document.
		var host = document.createElement( 'div' );
		host.setAttribute( 'aria-hidden', 'true' );
		host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;left:-9999px;top:-9999px;';
		( document.body || document.documentElement ).appendChild( host );
		__wpdReactHost = host;

		// Shared mutable bucket — ref-based aggregation to avoid the
		// classic setState-inside-useEffect loop. A `setState` here
		// would fire a parent re-render, which would fire the loader
		// hook again, which returns a fresh commands array with a new
		// reference even when the contents are identical, which would
		// re-fire the effect and setState again → Maximum update
		// depth exceeded. Refs don't trigger renders, so the loop is
		// broken even when hooks churn references.
		var resultsBucket = { perLoader: {}, statics: [], loadersList: [] };

		function commandsFingerprint( cmds ) {
			if ( ! Array.isArray( cmds ) || cmds.length === 0 ) return '';
			// Cheap identity — name count is enough to decide whether
			// to re-post. Accepts some false negatives (two different
			// commands sharing a name) we'll never hit in practice.
			var keys = new Array( cmds.length );
			for ( var i = 0; i < cmds.length; i++ ) {
				var c = cmds[ i ];
				keys[ i ] = c && c.name ? c.name : '';
			}
			return keys.join( '|' );
		}

		function mergeAndPost() {
			var merged = [];
			var loadersList = resultsBucket.loadersList;
			if ( Array.isArray( loadersList ) ) {
				for ( var i = 0; i < loadersList.length; i++ ) {
					var bucket = resultsBucket.perLoader[ loadersList[ i ] ];
					if ( Array.isArray( bucket ) ) merged = merged.concat( bucket );
				}
			}
			if ( Array.isArray( resultsBucket.statics ) ) {
				merged = merged.concat( resultsBucket.statics );
			}
			// Refresh the callback cache off the SAME snapshot we're
			// about to post. Loader-returned commands close over React
			// state (selected block, edited entity, etc.) that's only
			// valid for this render pass, so rebuilding from scratch
			// every merge keeps invoke-from-parent honest instead of
			// calling a stale closure.
			__wpdCommandCallbacks = Object.create( null );
			for ( var j = 0; j < merged.length; j++ ) {
				var cc = merged[ j ];
				if ( cc && cc.name && typeof cc.callback === 'function' ) {
					__wpdCommandCallbacks[ cc.name ] = cc.callback;
				}
			}
			__wpdLastRawCommands = merged;
			__wpdSchedulePost();
		}

		// One slot per loader. Calls the loader's hook at render time;
		// an effect keyed on the commands' name-fingerprint writes the
		// fresh list into the shared bucket and posts. Ref-based, no
		// setState → no re-render cascade.
		function LoaderSlot( props ) {
			var loader = props.loader;
			var result = null;
			try {
				result = loader.hook( { search: '' } );
			} catch ( _err ) {
				/* swallow — a buggy loader hook shouldn't take the harvester down */
			}
			var cmds = ( result && Array.isArray( result.commands ) ) ? result.commands : [];
			var key  = useMemo( function () { return commandsFingerprint( cmds ); }, [ cmds ] );

			useEffect( function () {
				resultsBucket.perLoader[ loader.name ] = cmds;
				mergeAndPost();
			}, [ key ] );

			useEffect( function () {
				return function () {
					delete resultsBucket.perLoader[ loader.name ];
					mergeAndPost();
				};
			}, [] );

			return null;
		}

		function Harvester() {
			var loaders = useSelect( function ( s ) {
				var ss = s( 'core/commands' );
				return ( ss && typeof ss.getCommandLoaders === 'function' )
					? ss.getCommandLoaders( true )
					: [];
			}, [] );
			var staticCmds = useSelect( function ( s ) {
				var ss = s( 'core/commands' );
				return ( ss && typeof ss.getCommands === 'function' )
					? ss.getCommands( true )
					: [];
			}, [] );

			// Track the loader-name ordering so `mergeAndPost` can emit
			// tier-3 in a deterministic order (React reconciliation
			// order = registration order = the order the user sees).
			var loadersNames = useMemo( function () {
				if ( ! Array.isArray( loaders ) ) return [];
				return loaders.map( function ( l ) { return l ? l.name : ''; } );
			}, [ loaders ] );
			var loadersKey = loadersNames.join( '|' );
			useEffect( function () {
				resultsBucket.loadersList = loadersNames;
				mergeAndPost();
			}, [ loadersKey ] );

			var staticKey = useMemo( function () { return commandsFingerprint( staticCmds ); }, [ staticCmds ] );
			useEffect( function () {
				resultsBucket.statics = Array.isArray( staticCmds ) ? staticCmds : [];
				mergeAndPost();
			}, [ staticKey ] );

			if ( ! Array.isArray( loaders ) || loaders.length === 0 ) {
				return null;
			}
			var children = [];
			for ( var i = 0; i < loaders.length; i++ ) {
				var loader = loaders[ i ];
				if ( ! loader || typeof loader.hook !== 'function' ) continue;
				children.push( createEl( LoaderSlot, {
					key: loader.name,
					loader: loader
				} ) );
			}
			return createEl( el.Fragment || 'div', null, children );
		}

		try {
			var root = el.createRoot( host );
			__wpdReactRoot = root;
			root.render( createEl( Harvester ) );
		} catch ( err ) {
			__wpdReactMounted = false;
			__wpdReactRoot    = null;
			if ( __wpdReactHost && __wpdReactHost.parentNode ) {
				__wpdReactHost.parentNode.removeChild( __wpdReactHost );
			}
			__wpdReactHost = null;
		}
	}

	function __wpdUnmountReactHarvester() {
		if ( __wpdReactRoot ) {
			try { __wpdReactRoot.unmount(); } catch ( _err ) { /* swallow */ }
		}
		__wpdReactRoot = null;
		if ( __wpdReactHost && __wpdReactHost.parentNode ) {
			__wpdReactHost.parentNode.removeChild( __wpdReactHost );
		}
		__wpdReactHost       = null;
		__wpdReactMounted    = false;
		__wpdLastRawCommands = [];
		__wpdCommandCallbacks = Object.create( null );
	}

	function __wpdPostCommandsList() {
		var list = __wpdHarvestCommands();
		// Cheap de-dupe — the store fires on every unrelated preference
		// change too, and shipping an identical payload is pure noise.
		// Fingerprint on `name|kind|url` keeps us sensitive to the
		// visible surface (name changes, navigate-vs-action flips,
		// destination URL changes) while skipping `JSON.stringify` of
		// the entire payload — label/icon churn inside a single command
		// is rare and re-shipping on it is harmless noise vs. a hot
		// path allocation cost.
		var key = '';
		for ( var k = 0; k < list.length; k++ ) {
			var lc = list[ k ];
			key += ( lc && lc.name ? lc.name : '' ) + '|'
				+ ( lc && lc.kind ? lc.kind : '' ) + '|'
				+ ( lc && lc.url  ? lc.url  : '' ) + '\n';
		}
		if ( key === __wpdCommandsLastPayload ) {
			return;
		}
		__wpdCommandsLastPayload = key;
		try {
			window.parent.postMessage(
				{ type: 'os-commands-list', commands: list },
				__wpdCommandsOrigin
			);
		} catch ( _err ) {
			/* cross-origin parent (shouldn't happen for chromeless pages, but
			 * don't let a throw break the bridge) */
		}
	}

	function __wpdSchedulePost() {
		if ( __wpdCommandsDebounceId !== null ) return;
		__wpdCommandsDebounceId = window.setTimeout( function () {
			__wpdCommandsDebounceId = null;
			__wpdPostCommandsList();
		}, 60 );
	}

	function __wpdSubscribeCommands() {
		__wpdCommandsSubscribed = true;

		// If the React harvester is already running (focus left and
		// came back), the bucket still holds the latest merged list.
		// Reset the dedupe key so the next post actually ships, then
		// schedule it. The harvester itself won't re-fire its effects
		// just because the parent re-subscribed — React only reacts to
		// store changes, and the store hasn't changed. We have to
		// push from here.
		if ( __wpdReactMounted ) {
			__wpdCommandsLastPayload = '';
			__wpdSchedulePost();
			return;
		}

		var attempts = 0;
		function tryBind() {
			if ( ! __wpdCommandsSubscribed ) return;
			if ( ! window.wp || ! window.wp.data || typeof window.wp.data.subscribe !== 'function' ) {
				if ( attempts++ < 40 ) {
					window.setTimeout( tryBind, 150 );
				}
				return;
			}
			// Mount the React harvester — tier 3 loaders are hooks and
			// need a legal render context to execute. On every re-render
			// the component's effect calls `__wpdSchedulePost` with the
			// fresh merged list, so we don't need a separate
			// `wp.data.subscribe` callback.
			__wpdMountReactHarvester();
		}
		tryBind();
	}

	function __wpdUnsubscribeCommands() {
		__wpdCommandsSubscribed  = false;
		__wpdCommandsLastPayload = '';
		if ( __wpdCommandsDebounceId !== null ) {
			try { window.clearTimeout( __wpdCommandsDebounceId ); } catch ( _err ) { /* swallow */ }
			__wpdCommandsDebounceId = null;
		}
		// Fully tear down the React harvester. Keeping it mounted in
		// the background wastes CPU: every store tick re-renders the
		// loader hooks, which rebuild the callback cache and post to
		// the parent (who drops the message because this window isn't
		// the subscribed one). On re-subscribe we remount from scratch.
		__wpdUnmountReactHarvester();
	}

	function __wpdInvokeCommand( name ) {
		// Primary lookup — the React harvester's latest snapshot. This
		// covers loader-returned commands (Duplicate block, Transform
		// to, pattern commands) that never appear in the static
		// `getCommands()` list.
		var cb = __wpdCommandCallbacks[ name ];
		if ( typeof cb === 'function' ) {
			try {
				cb( { close: function () {} } );
			} catch ( _err ) {
				/* swallow — a plugin command callback that throws shouldn't break the bridge */
			}
			return;
		}
		// Fallback — statically registered commands that never passed
		// through the harvester (registered after the last render).
		if ( ! window.wp || ! window.wp.data ) {
			return;
		}
		var sel = null;
		try { sel = window.wp.data.select( 'core/commands' ); } catch ( _err ) { return; }
		if ( ! sel || typeof sel.getCommands !== 'function' ) return;
		var raw;
		try { raw = sel.getCommands(); } catch ( _err ) { return; }
		if ( ! raw ) return;
		for ( var i = 0; i < raw.length; i++ ) {
			if ( raw[ i ] && raw[ i ].name === name && typeof raw[ i ].callback === 'function' ) {
				try {
					raw[ i ].callback( { close: function () {} } );
				} catch ( _err ) {
					/* swallow — see note in primary path above */
				}
				return;
			}
		}
	}

	// Attach the listener BEFORE the bridge-ready ping so a subscribe
	// posted synchronously in response is guaranteed to land.
	window.addEventListener( 'message', function ( e ) {
		if ( e.origin !== __wpdCommandsOrigin ) return;
		if ( ! e.data || typeof e.data.type !== 'string' ) return;
		if ( e.data.type === 'os-commands-subscribe' ) {
			__wpdSubscribeCommands();
		} else if ( e.data.type === 'os-commands-unsubscribe' ) {
			__wpdUnsubscribeCommands();
		} else if ( e.data.type === 'os-commands-invoke' && typeof e.data.name === 'string' ) {
			__wpdInvokeCommand( e.data.name );
		}
	} );

	// Handshake: tell the parent we're ready so it can (re)send any
	// subscribe that was dispatched before this listener attached.
	// Without this ping, a subscribe posted during iframe navigation
	// arrives at a context whose message listener isn't installed yet
	// and is silently dropped — the symptom is an empty palette even
	// though `wp.data.select('core/commands')` is perfectly happy.
	try {
		window.parent.postMessage(
			{ type: 'os-bridge-ready' },
			__wpdCommandsOrigin
		);
	} catch ( _err ) {
		/* parent gone or cross-origin — bridge handshake will retry on next load */
	}

	/*
	 * Background heartbeat throttle.
	 *
	 * Every chromeless iframe is a complete wp-admin page running
	 * Core's Heartbeat — 15 s in the post editor (post locking). A
	 * desktop with several windows open therefore fires several
	 * admin-ajax heartbeats a minute from windows the user isn't even
	 * looking at, and every one of them boots the whole plugin stack
	 * server-side. Core only slows Heartbeat when the browser TAB is
	 * hidden; a background desktop window is still a visible iframe,
	 * so that built-in backoff never engages.
	 *
	 * The parent shell posts `os-window-active` on window focus and
	 * blur (`src/window-activity-notifier.ts`). On blur we stretch the
	 * interval to Heartbeat's 120 s maximum; on focus we restore the
	 * saved cadence. Post locks stay safe: Core's lock window is 150 s,
	 * above the slowed interval. Two guards keep this conservative:
	 *
	 *   - Never slow an interval below 15 s — a 5 s cadence means
	 *     something urgent (auth-check retry) is in flight.
	 *   - Only restore when the interval is still the 120 s we set —
	 *     if page code re-tuned Heartbeat while backgrounded, the
	 *     throttle keeps its hands off.
	 */
	( function () {
		var savedInterval = null;

		window.addEventListener( 'message', function ( e ) {
			if ( e.origin !== window.location.origin || e.source !== window.parent ) return;
			var d = e && e.data;
			if ( ! d || typeof d !== 'object' || d.type !== 'os-window-active' ) return;
			var hb = window.wp && window.wp.heartbeat;
			if ( ! hb || typeof hb.interval !== 'function' ) return;
			try {
				if ( d.active === false ) {
					var current = hb.interval();
					if (
						savedInterval === null &&
						typeof current === 'number' &&
						current >= 15 &&
						current < 120
					) {
						savedInterval = current;
						hb.interval( 120 );
					}
				} else if ( d.active === true && savedInterval !== null ) {
					if ( hb.interval() === 120 ) {
						hb.interval( savedInterval );
					}
					savedInterval = null;
				}
			} catch ( _err ) {
				/* heartbeat internals changed shape — leave it alone */
			}
		} );
	} () );

	/*
	 * ` / Shift+` forwarder — window switcher.
	 *
	 * Bare backtick with no modifier. Must skip when focus is in a
	 * text-entry element, otherwise typing ` into a block, a text
	 * field, or TinyMCE would steal the keystroke. Non-text inputs
	 * (checkbox, button, select) don't accept character input, so
	 * cycling on those is fine.
	 *
	 * Same iframe-crossing rationale as the Cmd+K forwarder above:
	 * native keydown doesn't reach the parent, so we postMessage.
	 */
	document.addEventListener( 'keydown', function ( e ) {
		if ( e.ctrlKey || e.metaKey || e.altKey ) return;
		if ( e.code !== 'Backquote' ) return;

		// IFRAME case catches Gutenberg: the block canvas is a nested
		// iframe, and Gutenberg re-dispatches cloned keydowns up to
		// this document for its shortcut system. Without this branch
		// typing ` in a block would cycle windows. Any other nested
		// iframe owning keyboard handling gets the same treatment.
		var el = document.activeElement;
		if ( el ) {
			var tag = el.tagName;
			if ( tag === 'IFRAME' ) return;
			if ( tag === 'TEXTAREA' ) return;
			if ( tag === 'INPUT' ) {
				var type = ( el.type || '' ).toLowerCase();
				var textTypes = [
					'text', 'search', 'url', 'email', 'password',
					'tel', 'number', 'date', 'datetime-local',
					'month', 'week', 'time'
				];
				if ( textTypes.indexOf( type ) !== -1 ) return;
			}
			if ( el.isContentEditable ) return;
		}

		e.preventDefault();
		e.stopImmediatePropagation();

		try {
			window.parent.postMessage(
				{
					type:      'os-window-switch',
					direction: e.shiftKey ? 'prev' : 'next'
				},
				window.location.origin
			);
		} catch ( err ) { /* cross-origin parent; swallow */ }
	}, true );

	/*
	 * Ctrl/Cmd+Alt+W forwarder — close all windows.
	 *
	 * Same iframe-crossing rationale as the two forwarders above.
	 * Unlike the backtick one there is no text-entry gate: the chord
	 * carries two modifiers, so it types nothing into a field, and
	 * "close everything" is a reasonable thing to ask for from inside
	 * the window you want gone.
	 *
	 * `e.code` rather than `e.key`, because Option+W on macOS types a
	 * different character and the W glyph moves between layouts.
	 */
	document.addEventListener( 'keydown', function ( e ) {
		if ( ! ( e.metaKey || e.ctrlKey ) ) return;
		if ( ! e.altKey || e.shiftKey ) return;
		if ( e.code !== 'KeyW' ) return;

		e.preventDefault();
		e.stopImmediatePropagation();

		try {
			window.parent.postMessage(
				{ type: 'os-window-close-all' },
				window.location.origin
			);
		} catch ( err ) { /* cross-origin parent; swallow */ }
	}, true );

	// Skip if the standalone iframe-bridge bundle already wired
	// screen-meta hoisting on this page. Two bridges racing to read
	// `aria-expanded` and reflect state would double-fire the
	// `os-screen-meta-state` message and flicker the
	// title-bar buttons.
	if ( window.__openStationScreenMetaInstalled ) {
		return;
	}
	window.__openStationScreenMetaInstalled = true;

	// Real screen options render form controls (column toggles, a
	// per-page input, custom settings). An empty wrap should not
	// surface a dead gear button.
	function hasScreenOptionsContent() {
		var wrap = document.getElementById( 'screen-options-wrap' );
		// WP always renders a nonce hidden input and an "Apply" submit
		// inside the wrap, so match only interactive option controls
		// (toggles, per-page, radios, selects) — never that always-
		// present scaffolding — or an empty panel reads as non-empty.
		return !! wrap && !! wrap.querySelector( 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), select, textarea' );
	}
	// A help tab registered with empty content + no callback still
	// produces #contextual-help-link but an empty panel. Require some
	// non-whitespace tab/sidebar text before announcing the button.
	function hasHelpContent() {
		var wrap = document.getElementById( 'contextual-help-wrap' );
		if ( ! wrap ) {
			return false;
		}
		var panelEls = wrap.querySelectorAll( '.help-tab-content, .contextual-help-sidebar' );
		for ( var i = 0; i < panelEls.length; i++ ) {
			if ( ( panelEls[ i ].textContent || '' ).trim() !== '' ) {
				return true;
			}
		}
		return false;
	}

	var links = document.getElementById( 'screen-meta-links' );
	var screenOptionsBtn = links ? document.getElementById( 'show-settings-link' ) : null;
	var helpBtn = links ? document.getElementById( 'contextual-help-link' ) : null;
	var panels = [];
	if ( screenOptionsBtn && hasScreenOptionsContent() ) {
		panels.push( 'screen-options' );
	}
	if ( helpBtn && hasHelpContent() ) {
		panels.push( 'help' );
	}

	var origin = window.location.origin;

	// ALWAYS announce — including an empty array — so the parent removes
	// stale gear/Help buttons when this page (e.g. after an in-place
	// same-slug navigation) has no screen meta. addScreenMetaButtons()
	// clears then repopulates, so an empty array removes everything.
	window.parent.postMessage( {
		type: 'os-screen-meta',
		panels: panels
	}, origin );

	if ( panels.length === 0 ) {
		return;
	}

	function getOpenPanel() {
		if ( screenOptionsBtn && screenOptionsBtn.getAttribute( 'aria-expanded' ) === 'true' ) {
			return 'screen-options';
		}
		if ( helpBtn && helpBtn.getAttribute( 'aria-expanded' ) === 'true' ) {
			return 'help';
		}
		return null;
	}

	function reportState() {
		window.parent.postMessage( {
			type: 'os-screen-meta-state',
			open: getOpenPanel()
		}, origin );
	}

	reportState();

	var observer = new MutationObserver( reportState );
	if ( screenOptionsBtn ) {
		observer.observe( screenOptionsBtn, { attributes: true, attributeFilter: [ 'aria-expanded' ] } );
	}
	if ( helpBtn ) {
		observer.observe( helpBtn, { attributes: true, attributeFilter: [ 'aria-expanded' ] } );
	}

	// WP's close() animates and shares #screen-meta between both panels,
	// so racing two animated clicks hides the panel that just opened.
	// Jump the other panel to its closed end state synchronously instead.
	function forceClose( button ) {
		if ( ! button || button.getAttribute( 'aria-expanded' ) !== 'true' ) {
			return;
		}
		var panelId = button.getAttribute( 'aria-controls' );
		var panel = panelId ? document.getElementById( panelId ) : null;
		if ( ! panel ) {
			return;
		}
		if ( window.jQuery ) {
			window.jQuery( panel ).stop( true, false );
		}
		panel.style.display = 'none';
		panel.classList.add( 'hidden' );
		if ( panel.parentNode instanceof HTMLElement ) {
			panel.parentNode.style.display = 'none';
		}
		button.classList.remove( 'screen-meta-active' );
		button.setAttribute( 'aria-expanded', 'false' );
		var toggles = document.querySelectorAll( '.screen-meta-toggle' );
		for ( var i = 0; i < toggles.length; i++ ) {
			toggles[ i ].style.visibility = '';
		}
	}

	/* -----------------------------------------------------------------
	 * Broadcast receiver — iframe side.
	 *
	 * The parent shell publishes broadcasts via
	 * `wp.os.broadcast(topic, payload)` (see `src/broadcast.ts`).
	 * It posts `{ type: 'os-broadcast', topic, payload }` to
	 * every open iframe. Here we re-dispatch that as a CustomEvent
	 * on the iframe's own document so admin pages can subscribe with
	 * plain `document.addEventListener( 'os-broadcast', cb )`
	 * — no extra script handle required.
	 *
	 * Iframe-side admin code can also publish UPSTREAM by posting
	 * the same shape to `window.parent`; the parent's
	 * `installBroadcastReceiver()` re-broadcasts to every other
	 * iframe + native window.
	 * ----------------------------------------------------------------- */
	window.addEventListener( 'message', function ( e ) {
		if ( e.origin !== origin ) {
			return;
		}
		if ( ! e.data || e.data.type !== 'os-broadcast' ) {
			return;
		}
		try {
			document.dispatchEvent( new CustomEvent( 'os-broadcast', {
				detail: { topic: e.data.topic, payload: e.data.payload }
			} ) );
		} catch ( _err ) { /* old browser without CustomEvent ctor — ignore */ }
	} );

	/* -----------------------------------------------------------------
	 * Soft-reload — iframe-side default handler.
	 *
	 * When a `os.<post_type>.changed` broadcast fires AND the
	 * current iframe is on a known list page for that post type, we
	 * fetch the current URL and replace the iframe's `#wpbody-content`
	 * in place. The user sees the new state of the list — restored
	 * post appears, deleted media disappears — without the WP loading
	 * spinner that `location.reload()` would show.
	 *
	 * Single-edit pages (`post.php`, `post-new.php`, the HPOS order
	 * editor) are deliberately NOT matched: replacing their body would
	 * destroy any unsaved Gutenberg/classic-editor state. Plugins that
	 * want specific behaviour for those pages can subscribe to the
	 * same topic on `document` and handle it themselves.
	 *
	 * Matching is generic: the current page's "list type" is derived
	 * from the URL (`edit.php` → its `post_type` param or `post`,
	 * `upload.php` → `attachment`, `edit-comments.php` → `comment`)
	 * and compared against the `<type>` captured from any
	 * `os.<type>.changed` topic — so every custom post
	 * type's `edit.php?post_type=X` screen participates with zero
	 * per-type code. Non-`edit.php` list screens (e.g. WooCommerce's
	 * HPOS `admin.php?page=wc-orders`) are covered by declarative
	 * extra rules, filterable server-side via
	 * `openstation_soft_reload_rules`.
	 *
	 * The fetch carries a custom header so a later phase can serve a
	 * minimal partial response if we want to optimise; for now WP
	 * returns the full admin page and we just pluck the body.
	 *
	 * Most WP list-table JS delegates on `document`/`body` and
	 * survives the swap. The inline editors don't, so
	 * `_openstationReinitListTables()` below re-runs Core's init
	 * entry points afterwards. A page needing more than that should
	 * listen for `os-soft-reloaded`, which fires after that re-init.
	 * ----------------------------------------------------------------- */
	var OPENSTATION_SOFT_RELOAD_EXTRAS = ( '_softReload' in __OS_DATA ) ? __OS_DATA._softReload : [];

	function _openstationEndsWith( s, suffix ) { return s.lastIndexOf( suffix ) === s.length - suffix.length; }

	function _openstationListType() {
		if ( _openstationEndsWith( location.pathname, '/wp-admin/edit.php' ) ) {
			return new URLSearchParams( location.search ).get( 'post_type' ) || 'post';
		}
		if ( _openstationEndsWith( location.pathname, '/wp-admin/upload.php' ) ) {
			return 'attachment';
		}
		if ( _openstationEndsWith( location.pathname, '/wp-admin/edit-comments.php' ) ) {
			return 'comment';
		}
		if ( _openstationEndsWith( location.pathname, '/wp-admin/plugins.php' ) ) {
			return 'plugin';
		}
		// plugin-install.php is intentionally not a soft-reload target.
		// Reloading that page mid-session would discard the user's search
		// results or reset an in-progress install. The page still emits
		// plugin.changed (via notifyPluginInstall below); it just doesn't
		// reload itself in response to one.
		return null;
	}

	function _openstationMatchesExtraRule( rule ) {
		if ( ! rule || ! rule.path ) {
			return false;
		}
		if ( ! _openstationEndsWith( location.pathname, '/wp-admin/' + rule.path ) ) {
			return false;
		}
		var params = new URLSearchParams( location.search );
		if ( rule.query ) {
			for ( var key in rule.query ) {
				if ( ! Object.prototype.hasOwnProperty.call( rule.query, key ) ) {
					continue;
				}
				if ( params.get( key ) !== String( rule.query[ key ] ) ) {
					return false;
				}
			}
		}
		if ( rule.queryAbsent ) {
			for ( var i = 0; i < rule.queryAbsent.length; i++ ) {
				if ( params.has( rule.queryAbsent[ i ] ) ) {
					return false;
				}
			}
		}
		return true;
	}

	function _openstationSoftReloadTopicMatches( topic ) {
		var m = /^os\.(.+)\.changed$/.exec( topic );
		if ( m && m[ 1 ] === _openstationListType() ) {
			return true;
		}
		for ( var i = 0; i < OPENSTATION_SOFT_RELOAD_EXTRAS.length; i++ ) {
			var rule = OPENSTATION_SOFT_RELOAD_EXTRAS[ i ];
			if ( rule && rule.topic === topic && _openstationMatchesExtraRule( rule ) ) {
				return true;
			}
		}
		return false;
	}

	var _openstationSoftReloadInFlight = false;
	var _openstationSoftReloadQueued = false;

	/*
	 * Re-init Core's list-table editors after a soft reload.
	 *
	 * Core's inline editors bind to elements inside `#wpbody-content`
	 * instead of delegating on `document`: `#the-list` for Quick Edit
	 * (inline-edit-post.js, inline-edit-tax.js), `#doaction` for Bulk
	 * Edit, `#the-comment-list` for the comment inline editors. The
	 * swap above throws those elements away, so the buttons keep
	 * rendering and stop working.
	 *
	 * Only re-run an init whose every binding lands inside the
	 * replaced subtree — then the fresh DOM gets it exactly once and
	 * nothing accumulates. `setCommentsList()` fails that test and is
	 * NOT called here: it re-runs `wpList`, whose `process()` binds on
	 * `document` (which survives), so each call stacks another set of
	 * comment row-action handlers and one Approve click ends up firing
	 * N moderation requests. Those handlers were never broken by the
	 * swap; only the closure state behind them goes stale, which costs
	 * a stale total count until the next reload.
	 *
	 * Also left alone: `common.js`'s empty-bulk-action guard and
	 * search-box mousedown, and `$.table_hotkeys` (comment moderation
	 * shortcuts stop navigating; re-running it would double-register).
	 * All degraded rather than dead, and each would mean copying
	 * dozens of lines of Core in here.
	 */
	function _openstationReinitListTables() {
		var $ = window.jQuery;
		if ( ! $ ) {
			return;
		}

		/*
		 * Mobile row expander. `common.js` binds it per-`tbody`, all
		 * of which we just replaced. Narrow windows are the norm in
		 * the shell, so it is often the only row affordance on screen.
		 *
		 * Per-`tbody` on purpose. Delegating on the now-surviving
		 * `#wpbody-content` would stack with Core's own binding on
		 * first load and toggle the row twice, back to closed.
		 */
		$( '#wpbody-content tbody' ).on( 'click', '.toggle-row', function () {
			$( this ).closest( 'tr' ).toggleClass( 'is-expanded' );
		} );

		if ( document.getElementById( 'the-list' ) ) {
			try {
				if ( window.inlineEditPost && typeof window.inlineEditPost.init === 'function' ) {
					window.inlineEditPost.init();
				}
			} catch ( err ) { _openstationWarnReinit( 'inline-edit-post', err ); }
			try {
				if ( window.inlineEditTax && typeof window.inlineEditTax.init === 'function' ) {
					window.inlineEditTax.init();
				}
			} catch ( err ) { _openstationWarnReinit( 'inline-edit-tax', err ); }
		}

		if ( document.getElementById( 'the-comment-list' ) && window.commentReply ) {
			try {
				if ( typeof window.commentReply.init === 'function' ) {
					window.commentReply.init();
				}
			} catch ( err ) { _openstationWarnReinit( 'comment-reply', err ); }
			try {
				/*
				 * Quick Edit / Reply / Edit on a comment row.
				 * edit-comments.js binds this in its own doc-ready
				 * rather than in `commentReply.init`, so there is
				 * nothing to re-call. Mirror Core's handler.
				 */
				$( '#the-comment-list' ).on( 'click', '.comment-inline', function () {
					var $el = $( this ),
						action = 'replyto';

					if ( 'undefined' !== typeof $el.data( 'action' ) ) {
						action = $el.data( 'action' );
					}

					$( this ).attr( 'aria-expanded', 'true' );
					window.commentReply.open( $el.data( 'commentId' ), $el.data( 'postId' ), action );
				} );
			} catch ( err ) { _openstationWarnReinit( 'comment-inline', err ); }
		}
	}

	/*
	 * One failing re-init must not take the others, or the
	 * `os-soft-reloaded` listeners after them, down with it. Warn
	 * rather than swallow: a silent catch here looks exactly like the
	 * bug this function exists to fix.
	 */
	function _openstationWarnReinit( which, err ) {
		if ( window.console && window.console.warn ) {
			window.console.warn( '[openstation] soft-reload re-init failed for ' + which + ':', err );
		}
	}

	function _openstationSoftReload() {
		if ( _openstationSoftReloadInFlight ) {
			_openstationSoftReloadQueued = true;
			return;
		}
		_openstationSoftReloadInFlight = true;
		fetch( location.href, {
			credentials: 'same-origin',
			cache: 'no-cache',
			headers: { 'X-WP-Desktop-Soft-Reload': '1' }
		} ).then( function ( r ) {
			if ( ! r.ok ) throw new Error( 'soft-reload fetch failed: ' + r.status );
			return r.text();
		} ).then( function ( html ) {
			var doc = new DOMParser().parseFromString( html, 'text/html' );
			var fresh = doc.querySelector( '#wpbody-content' );
			var live = document.querySelector( '#wpbody-content' );
			if ( ! fresh || ! live ) {
				/* Markup we expected isn't there — admin pages we
				 * don't recognise (or core changes the structure).
				 * Don't reload; let the iframe stay as it is rather
				 * than show a spinner the user told us not to. */
				return;
			}
			/*
			 * Swap the CONTENTS of `#wpbody-content`, keeping the
			 * node. Keeping it preserves handlers delegated on it,
			 * which is where `common.js` puts the row-actions focus
			 * reveal. Core emits the container as a bare
			 * `<div id="wpbody-content">`, so the only thing this
			 * discards is any attribute a plugin added to `fresh`.
			 */
			live.replaceChildren.apply( live, Array.prototype.slice.call( fresh.childNodes ) );
			_openstationReinitListTables();
			try {
				document.dispatchEvent( new CustomEvent( 'os-soft-reloaded' ) );
			} catch ( _err ) {}
			/* Some WP scripts re-init on DOMContentLoaded only — let
			 * pages opt-in to a re-init by listening to the event
			 * above. We intentionally do NOT re-fire DOMContentLoaded;
			 * that's almost always wrong (double-init of jQuery/WP). */
		} ).catch( function ( err ) {
			/* Network error — leave the iframe untouched. The user's
			 * next manual interaction will refresh state, and the
			 * next broadcast will retry. */
			if ( window.console && window.console.warn ) {
				window.console.warn( '[openstation] soft-reload skipped:', err );
			}
		} ).then( function () {
			_openstationSoftReloadInFlight = false;
			if ( _openstationSoftReloadQueued ) {
				_openstationSoftReloadQueued = false;
				_openstationSoftReload();
			}
		} );
	}

	document.addEventListener( 'os-broadcast', function ( e ) {
		var detail = e.detail || {};
		var topic = detail.topic;
		if ( ! topic ) return;
		if ( _openstationSoftReloadTopicMatches( topic ) ) {
			_openstationSoftReload();
		}
	} );

	window.addEventListener( 'message', function( e ) {
		if ( e.origin !== origin ) {
			return;
		}
		if ( ! e.data || e.data.type !== 'os-toggle-panel' ) {
			return;
		}
		var target = null;
		if ( e.data.panel === 'screen-options' && screenOptionsBtn ) {
			target = screenOptionsBtn;
		} else if ( e.data.panel === 'help' && helpBtn ) {
			target = helpBtn;
		}
		if ( ! target ) {
			return;
		}
		if ( target.getAttribute( 'aria-expanded' ) !== 'true' ) {
			var other = target === screenOptionsBtn ? helpBtn : screenOptionsBtn;
			forceClose( other );
		}
		target.click();
	} );

	/* -----------------------------------------------------------------
	 * Connection bridge — iframe side.
	 *
	 * Plugins call `wp.os.iframe.publish(topic, payload)` /
	 * `subscribe(topic, cb)` / `onConnection(cb)` to talk to a parent-
	 * side `wp.os.connect()` caller. The shell only routes;
	 * topic semantics are plugin-defined.
	 *
	 * Connections are tracked locally so `onConnection` can fire when
	 * the parent opens a new channel (typical use: start emitting
	 * heavy events only after at least one consumer subscribed). Each
	 * connection carries a topic-allowlist negotiated at handshake
	 * time — wildcard ('*') subscribers see everything.
	 * ----------------------------------------------------------------- */
	var _wpdConnections = {};
	var _wpdConnectionListeners = [];
	var _wpdSubs = {};   // topic → [cb, ...]
	var _wpdChannelSubs = {};   // channel → [cb, ...] (window-channel API)
	var _wpdParentOrigin = window.location.origin;
	var _wpdWindowId = null;        // host window id, from the handshake
	var _wpdWindowIdWaiters = [];   // pending whenWindowId() resolvers

	/* Stash the host window's id (the parent's handshake carries
	 * `targetWindowId`) and flush any `whenWindowId()` waiters. Same
	 * contract as `assets/js/iframe-bridge.js`. */
	function _wpdSetWindowId( id ) {
		if ( ! id || _wpdWindowId === id ) {
			return;
		}
		_wpdWindowId = id;
		var waiters = _wpdWindowIdWaiters.splice( 0 );
		for ( var i = 0; i < waiters.length; i++ ) {
			try {
				waiters[ i ]( id );
			} catch ( _err ) { /* swallow */ }
		}
	}

	function _wpdEmitToParent( connectionId, topic, payload ) {
		try {
			window.parent.postMessage( {
				type: 'os-bridge-publish',
				connectionId: connectionId,
				topic: topic,
				payload: payload
			}, _wpdParentOrigin );
		} catch ( _err ) { /* parent gone */ }
	}

	window.addEventListener( 'message', function ( ev ) {
		if ( ev.origin !== _wpdParentOrigin ) {
			return;
		}
		var data = ev && ev.data;
		if ( ! data || typeof data !== 'object' || typeof data.type !== 'string' ) {
			return;
		}

		if ( data.type === 'os-bridge-beforeunload-query' ) {
			var prevent = false;
			var msg = '';

			function shimReturnValue( beforeUnloadEv ) {
				Object.defineProperty( beforeUnloadEv, 'returnValue', {
					get: function() { return this._returnValue || ''; },
					set: function( v ) { this._returnValue = v; }
				} );
			}

			function checkPrevent( beforeUnloadEv, result ) {
				var hasRes = typeof result === 'string' && result !== '';
				var hasRetVal = typeof beforeUnloadEv.returnValue === 'string' && beforeUnloadEv.returnValue !== '';
				if ( beforeUnloadEv.defaultPrevented || hasRes || hasRetVal ) {
					prevent = true;
					if ( hasRes ) {
						msg = result;
					} else if ( hasRetVal ) {
						msg = beforeUnloadEv.returnValue;
					}
				}
			}

			var unloadEvent;
			try {
				unloadEvent = new Event( 'beforeunload', { cancelable: true } );
			} catch ( _err ) {
				unloadEvent = document.createEvent( 'Event' );
				unloadEvent.initEvent( 'beforeunload', false, true );
			}
			shimReturnValue( unloadEvent );

			if ( typeof window.onbeforeunload === 'function' ) {
				var res = window.onbeforeunload( unloadEvent );
				checkPrevent( unloadEvent, res );
			}
			if ( ! prevent ) {
				var dispatchEvent;
				try {
					dispatchEvent = new Event( 'beforeunload', { cancelable: true } );
				} catch ( _err ) {
					dispatchEvent = document.createEvent( 'Event' );
					dispatchEvent.initEvent( 'beforeunload', false, true );
				}
				shimReturnValue( dispatchEvent );
				window.dispatchEvent( dispatchEvent );
				checkPrevent( dispatchEvent, null );
			}

			try {
				/* Echo the asker's correlation id when there is one.
				 * The pre-CLOSE query sends none and is answered by
				 * the window's own message handler; the pre-NAVIGATION
				 * query sends one and is answered by the promise that
				 * asked. Without the echo the two share one reply and
				 * a tab click closes the window. */
				var reply = {
					type: 'os-bridge-beforeunload-response',
					prevent: prevent,
					message: msg
				};
				if ( typeof data.requestId === 'string' && data.requestId !== '' ) {
					reply.requestId = data.requestId;
				}
				window.parent.postMessage( reply, _wpdParentOrigin );
			} catch ( _err ) { /* swallow */ }
			return;
		}

		if ( data.type === 'os-bridge-handshake' && typeof data.connectionId === 'string' ) {
			/* The parent's handshake carries the host window id —
			 * stash it so `wp.os.iframe.windowId` and
			 * `whenWindowId()` can serve callers that need to know
			 * which native window opened this iframe. */
			if ( typeof data.targetWindowId === 'string' && data.targetWindowId !== '' ) {
				_wpdSetWindowId( data.targetWindowId );
			}
			if ( _wpdConnections[ data.connectionId ] ) {
				/* Re-handshake on iframe-ready re-arm — no-op besides
				 * acking again so the parent can resume. */
				try {
					window.parent.postMessage( {
						type: 'os-bridge-handshake-ack',
						connectionId: data.connectionId
					}, _wpdParentOrigin );
				} catch ( _err ) { /* swallow */ }
				return;
			}
			var conn = {
				id: data.connectionId,
				topics: Array.isArray( data.topics ) ? data.topics.slice() : []
			};
			_wpdConnections[ conn.id ] = conn;
			try {
				window.parent.postMessage( {
					type: 'os-bridge-handshake-ack',
					connectionId: conn.id
				}, _wpdParentOrigin );
			} catch ( _err ) { /* swallow */ }
			for ( var i = 0; i < _wpdConnectionListeners.length; i++ ) {
				try {
					_wpdConnectionListeners[ i ]( {
						id: conn.id,
						topics: conn.topics.slice()
					} );
				} catch ( _err ) { /* swallow listener */ }
			}
			return;
		}

		if ( data.type === 'os-bridge-publish' && typeof data.topic === 'string' ) {
			var bucket = _wpdSubs[ data.topic ];
			if ( bucket ) {
				for ( var j = 0; j < bucket.length; j++ ) {
					try {
						bucket[ j ]( data.payload, { topic: data.topic, connectionId: data.connectionId } );
					} catch ( _err ) { /* swallow subscriber */ }
				}
			}
			var wildcard = _wpdSubs[ '*' ];
			if ( wildcard ) {
				for ( var k = 0; k < wildcard.length; k++ ) {
					try {
						wildcard[ k ]( data.payload, { topic: data.topic, connectionId: data.connectionId } );
					} catch ( _err ) { /* swallow */ }
				}
			}
			return;
		}

		if ( data.type === 'os-bridge-disconnect' && typeof data.connectionId === 'string' ) {
			delete _wpdConnections[ data.connectionId ];
			return;
		}

		/* Unified window-channel delivery from the parent. Fires
		 * every `wp.os.on( channel, cb )` subscriber for the
		 * matching channel — same protocol as
		 * `assets/js/iframe-bridge.js`. */
		if ( data.type === 'os-window-send' && typeof data.channel === 'string' && data.channel !== '' ) {
			var meta = { channel: data.channel };
			var cBucket = _wpdChannelSubs[ data.channel ];
			if ( cBucket ) {
				var cBucketSnap = cBucket.slice();
				for ( var ci = 0; ci < cBucketSnap.length; ci++ ) {
					try {
						cBucketSnap[ ci ]( data.payload, meta );
					} catch ( _err ) { /* swallow */ }
				}
			}
			var cWildcard = _wpdChannelSubs[ '*' ];
			if ( cWildcard ) {
				var cWildcardSnap = cWildcard.slice();
				for ( var cw = 0; cw < cWildcardSnap.length; cw++ ) {
					try {
						cWildcardSnap[ cw ]( data.payload, meta );
					} catch ( _err ) { /* swallow */ }
				}
			}
		}
	} );

	var iframeApi = {
		/**
		 * Publish a payload under a topic. Sent to every connection
		 * — typical case is one connection per parent caller, but
		 * a debug console may have several at once.
		 */
		publish: function ( topic, payload ) {
			if ( typeof topic !== 'string' || topic === '' ) {
				return;
			}
			var ids = Object.keys( _wpdConnections );
			for ( var i = 0; i < ids.length; i++ ) {
				_wpdEmitToParent( ids[ i ], topic, payload );
			}
		},
		/**
		 * Subscribe to a topic. Returns an unsubscribe function.
		 * Use `'*'` to receive every published payload (debugging).
		 */
		subscribe: function ( topic, cb ) {
			if ( typeof topic !== 'string' || topic === '' || typeof cb !== 'function' ) {
				return function () {};
			}
			var bucket = _wpdSubs[ topic ];
			if ( ! bucket ) {
				bucket = [];
				_wpdSubs[ topic ] = bucket;
			}
			bucket.push( cb );
			return function () {
				var i = bucket.indexOf( cb );
				if ( i >= 0 ) {
					bucket.splice( i, 1 );
				}
			};
		},
		/**
		 * Notified whenever a parent caller opens a connection. Use
		 * to start emitting heavy publish events only when somebody
		 * is listening.
		 */
		onConnection: function ( cb ) {
			if ( typeof cb !== 'function' ) {
				return function () {};
			}
			_wpdConnectionListeners.push( cb );
			/* Replay current connections — late subscribers still
			 * see who's already there. */
			var ids = Object.keys( _wpdConnections );
			for ( var i = 0; i < ids.length; i++ ) {
				try {
					cb( {
						id: _wpdConnections[ ids[ i ] ].id,
						topics: _wpdConnections[ ids[ i ] ].topics.slice()
					} );
				} catch ( _err ) { /* swallow */ }
			}
			return function () {
				var idx = _wpdConnectionListeners.indexOf( cb );
				if ( idx >= 0 ) {
					_wpdConnectionListeners.splice( idx, 1 );
				}
			};
		},
		/**
		 * Iframe-initiated connection request. See
		 * `assets/js/iframe-bridge.js` — same shape, same protocol.
		 */
		requestConnection: function ( opts ) {
			opts = opts || {};
			var topics = Array.isArray( opts.topics ) ? opts.topics.slice() : [];
			var requestId = 'wpdir-' + Math.random().toString( 36 ).slice( 2, 10 );

			return new Promise( function ( resolve, reject ) {
				var settled = false;
				var timeoutMs = typeof opts.timeoutMs === 'number'
					? opts.timeoutMs
					: 5000;

				function settle( ok, value ) {
					if ( settled ) {
						return;
					}
					settled = true;
					window.removeEventListener( 'message', onAck );
					clearTimeout( timer );
					if ( ok ) {
						resolve( value );
					} else {
						reject( value );
					}
				}

				function onAck( ev ) {
					if ( ev.origin !== _wpdParentOrigin ) {
						return;
					}
					var d = ev && ev.data;
					if (
						! d ||
						typeof d !== 'object' ||
						d.type !== 'os-bridge-connection-ack' ||
						d.requestId !== requestId
					) {
						return;
					}
					if ( d.accepted ) {
						var summary = {
							id: typeof d.connectionId === 'string' ? d.connectionId : '',
							topics: topics.slice()
						};
						if ( typeof opts.onOpen === 'function' ) {
							try { opts.onOpen( summary ); } catch ( _err ) { /* swallow */ }
						}
						settle( true, summary );
					} else {
						settle( false, new Error( d.reason || 'rejected' ) );
					}
				}
				window.addEventListener( 'message', onAck );

				var timer = setTimeout( function () {
					settle( false, new Error( 'timeout' ) );
				}, timeoutMs );

				try {
					window.parent.postMessage( {
						type: 'os-bridge-connection-request',
						requestId: requestId,
						topics: topics
					}, _wpdParentOrigin );
				} catch ( err ) {
					settle( false, err );
				}
			} );
		},
		/**
		 * Window-chrome helpers. See `assets/js/iframe-bridge.js` —
		 * same shape, same protocol. `setSlot` is HTML-only
		 * (sandboxed via `textContent` on the parent side).
		 */
		chrome: {
			setTheme: function ( tokens ) {
				try {
					window.parent.postMessage( {
						type: 'os-chrome-theme',
						tokens: tokens || {}
					}, _wpdParentOrigin );
				} catch ( _err ) { /* parent gone */ }
			},
			setControls: function ( config ) {
				try {
					window.parent.postMessage( {
						type: 'os-chrome-controls',
						config: config === undefined ? null : config
					}, _wpdParentOrigin );
				} catch ( _err ) { /* parent gone */ }
			},
			setSlot: function ( name, html ) {
				if ( typeof name !== 'string' || name === '' ) {
					return;
				}
				try {
					window.parent.postMessage( {
						type: 'os-chrome-slot',
						slot: name,
						html: typeof html === 'string' ? html : ''
					}, _wpdParentOrigin );
				} catch ( _err ) { /* parent gone */ }
			}
		},
		/**
		 * The id of the window the parent shell opened to host this
		 * iframe. Populated by the first connection handshake (the
		 * parent's handshake carries `targetWindowId`). `null` until
		 * then.
		 */
		get windowId() {
			return _wpdWindowId;
		},
		/**
		 * Resolve once `windowId` is populated by the first handshake.
		 * Resolves immediately if already known. Never rejects — guard
		 * with `isParentReachable()` first.
		 */
		whenWindowId: function () {
			if ( _wpdWindowId !== null ) {
				return Promise.resolve( _wpdWindowId );
			}
			return new Promise( function ( resolve ) {
				_wpdWindowIdWaiters.push( resolve );
			} );
		},
		/**
		 * Whether the parent frame is same-origin and reachable. All
		 * bridge messages hard-filter on origin — a cross-origin
		 * parent silently drops everything we post. Use this predicate
		 * to fail fast instead of debugging vanishing messages.
		 */
		isParentReachable: function () {
			if ( ! window.parent || window.parent === window ) {
				return false;
			}
			try {
				/* Cross-origin parents throw on `.location.origin`
				 * access; same-origin parents return a string we can
				 * compare to our own origin. */
				return window.parent.location.origin === _wpdParentOrigin;
			} catch ( _err ) {
				return false;
			}
		}
	};

	if ( ! window.wp ) { window.wp = {}; }
	if ( ! window.wp.os ) { window.wp.os = {}; }
	window.wp.os.iframe = iframeApi;

	/* Unified window-channel API. Mirror of the equivalent block
	 * in `assets/js/iframe-bridge.js` — keep both in sync. The
	 * parent shell posts `os-window-send` on
	 * `Window.send( channel, payload )`; iframe-side handlers
	 * register via `wp.os.on( channel, cb )`. Sending the
	 * other way (`wp.os.send`) posts up to the parent where
	 * `Window.on( channel, cb )` subscribers fire. */
	if ( typeof window.wp.os.send !== 'function' ) {
		window.wp.os.send = function ( channel, payload ) {
			if ( typeof channel !== 'string' || channel === '' ) {
				return;
			}
			try {
				window.parent.postMessage( {
					type: 'os-window-publish',
					channel: channel,
					payload: payload
				}, _wpdParentOrigin );
			} catch ( _err ) { /* parent gone */ }
		};
	}
	if ( typeof window.wp.os.on !== 'function' ) {
		window.wp.os.on = function ( channel, cb ) {
			if ( typeof channel !== 'string' || channel === '' || typeof cb !== 'function' ) {
				return function () {};
			}
			var bucket = _wpdChannelSubs[ channel ];
			if ( ! bucket ) {
				bucket = [];
				_wpdChannelSubs[ channel ] = bucket;
			}
			bucket.push( cb );
			return function () {
				var i = bucket.indexOf( cb );
				if ( i >= 0 ) {
					bucket.splice( i, 1 );
				}
			};
		};
	}

	/* -----------------------------------------------------------------
	 * Stale-nonce recovery after a session-expiry re-login.
	 *
	 * When the user's session expires while a chromeless window is
	 * open, this iframe does NOT show core's `wp-auth-check` login
	 * modal — `openstation_chromeless_suppress_auth_check()` keeps
	 * the modal assets out of chromeless requests so the parent
	 * shell owns the single prompt for the whole desktop. Detection
	 * still works without the modal JS: core attaches the
	 * `wp-auth-check` boolean to every heartbeat response
	 * server-side, and this iframe's own heartbeat keeps ticking.
	 *
	 * After re-auth the auth cookie is fresh — but every per-page
	 * nonce cached in JS globals (`_wpUpdatesSettings.ajax_nonce`,
	 * `commonL10n.nonce`, Gutenberg's `wpApiSettings.nonce`, etc.)
	 * was minted under the OLD session and is now rejected by
	 * `check_ajax_referer`. WP reports that as "Cookie check
	 * failed" on the next plugin Install / Activate / Update click,
	 * which is misleading: the cookie is fine; the nonce is stale.
	 *
	 * Fix: watch jQuery's `heartbeat-tick`. If we ever see
	 * `wp-auth-check: false` and then later see the same field flip
	 * back to `true`, the user re-authed mid-session and every
	 * cached nonce in this iframe is stale — reload so they
	 * regenerate from the fresh session. The parent is nudged
	 * first (`os-reauth-detected`) so its own recovery
	 * (`src/auth-recovery/index.ts`: in-place nonce refresh + a
	 * reload sweep over sibling iframes that haven't ticked yet)
	 * starts immediately instead of waiting for the parent's
	 * heartbeat schedule.
	 *
	 * If jQuery never loads on this page (rare — most admin screens
	 * pull it for heartbeat already), this block is a no-op.
	 * ----------------------------------------------------------------- */
	( function _wpdInstallAuthCheckRecovery() {
		var attached = false;
		var sawLoggedOut = false;
		function attach() {
			if ( attached || ! window.jQuery ) {
				return;
			}
			attached = true;
			window.jQuery( document ).on( 'heartbeat-tick.osAuthRecover', function ( ev, data ) {
				if ( ! data || typeof data !== 'object' || ! ( 'wp-auth-check' in data ) ) {
					return;
				}
				if ( data[ 'wp-auth-check' ] === false ) {
					sawLoggedOut = true;
					return;
				}
				if ( sawLoggedOut && data[ 'wp-auth-check' ] === true ) {
					sawLoggedOut = false;
					// Tell the parent shell BEFORE we reload so it
					// doesn't have to wait for its own heartbeat
					// tick (up to 60s on an idle shell) to discover
					// the cookie is fresh. Parent runs its full
					// recovery path on receipt — overlay teardown,
					// iframe reload sweep, then a hard reload.
					try {
						if ( window.parent && window.parent !== window ) {
							window.parent.postMessage(
								{ type: 'os-reauth-detected' },
								window.location.origin
							);
						}
					} catch ( _err ) { /* parent gone */ }
					try { window.location.reload(); } catch ( _err ) { /* swallow */ }
				}
			} );
		}
		attach();
		if ( document.readyState === 'loading' ) {
			document.addEventListener( 'DOMContentLoaded', attach, { once: true } );
		}
		window.addEventListener( 'load', attach, { once: true } );
	} )();

	/* -----------------------------------------------------------------
	 * Shiny-update watcher (GH#296).
	 *
	 * Core's updates.js applies plugin/theme updates and deletes over
	 * AJAX — no navigation, so the load-time payload emit above never
	 * re-fires and the shell's update notifiers (admin-bar circle-arrows
	 * count, dock Plugins badge) keep showing the pre-update numbers
	 * until a hard refresh. Watch the jQuery events updates.js triggers
	 * on `document` after each job and nudge the shell to spend one
	 * `refreshMenu()` probe, whose payload carries fresh counts.
	 *
	 * Error events are included deliberately: `wp_ajax_update_plugin`
	 * calls `wp_update_plugins()` up front, which can mutate the
	 * update transient even when the upgrade itself fails.
	 *
	 * When updates.js is processing a queue (bulk-selected shiny
	 * updates), per-job events fire while later jobs are still
	 * pending — skip those and let the final job's event send the one
	 * nudge. The shell debounces on its side too, so this is purely
	 * an optimization, not a correctness gate.
	 *
	 * If jQuery never loads on this page this block is a no-op — and
	 * so is updates.js, which requires it.
	 * ----------------------------------------------------------------- */
	( function _wpdInstallShinyUpdateWatcher() {
		var attached = false;
		function notify() {
			try {
				var queue = window.wp && window.wp.updates && window.wp.updates.queue;
				if ( queue && queue.length > 0 ) {
					return;
				}
			} catch ( _err ) { /* queue introspection is best-effort */ }
			try {
				var shell = window.top || window.parent;
				if ( shell && shell !== window ) {
					shell.postMessage(
						{ type: 'os-updates-changed' },
						window.location.origin
					);
				}
			} catch ( _err ) { /* shell gone or cross-origin */ }
		}
		function notifyPluginInstall() {
			// `wp-plugin-install-success` fires after an AJAX install on
			// plugin-install.php with no page navigation. The PHP
			// `upgrader_process_complete` hook records the change correctly,
			// but `openstation_content_changes_emit_footer` only runs on
			// chromeless page requests — admin-ajax.php is not in the
			// chromeless allowlist, so there's no in-band emit from that
			// request. The Heartbeat buffer will eventually deliver it, but
			// posting directly here lets the Installed tab refresh
			// immediately. The later Heartbeat tick will produce a second
			// broadcast; consumers handle no-op refreshes gracefully.
			try {
				var shell = window.top || window.parent;
				if ( shell && shell !== window ) {
					shell.postMessage(
						{
							type: 'os-broadcast',
							topic: 'os.plugin.changed',
							payload: { source: 'chromeless-bridge', action: 'install' }
						},
						window.location.origin
					);
				}
			} catch ( _err ) { /* shell gone or cross-origin */ }
		}
		function attach() {
			if ( attached || ! window.jQuery ) {
				return;
			}
			attached = true;
			window.jQuery( document ).on(
				[
					'wp-plugin-update-success.osUpdates',
					'wp-plugin-update-error.osUpdates',
					'wp-plugin-delete-success.osUpdates',
					'wp-theme-update-success.osUpdates',
					'wp-theme-update-error.osUpdates',
					'wp-theme-delete-success.osUpdates'
				].join( ' ' ),
				notify
			);
			window.jQuery( document ).on( 'wp-plugin-install-success.osUpdates', notifyPluginInstall );
		}
		attach();
		if ( document.readyState === 'loading' ) {
			document.addEventListener( 'DOMContentLoaded', attach, { once: true } );
		}
		window.addEventListener( 'load', attach, { once: true } );
	} )();

	/*
	 * Bridge-ready signal. Every listener installed by this script
	 * is now wired; let the parent shell know so it can fire
	 * `HOOKS.IFRAME_READY` and re-arm any connection handshakes
	 * (`src/connection/index.ts#onIframeReady`) that arrived before
	 * we were listening. Without this, every consumer of
	 * `HOOKS.IFRAME_READY` (devtools replay, connection rearm)
	 * stays silent for the lifetime of the iframe — documented
	 * surface that never actually fires.
	 *
	 * Posted to the parent's own origin only. Wrapped in try/catch
	 * because cross-origin parents (top-level admin opened outside
	 * the shell) would throw on the postMessage and we don't want a
	 * single failed dispatch to wedge anything else above.
	 */
	try {
		if ( window.parent && window.parent !== window ) {
			window.parent.postMessage(
				{ type: 'os-ready' },
				window.location.origin
			);
		}
	} catch ( _err ) { /* parent gone or cross-origin */ }
} )();
