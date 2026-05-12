<?php
/**
 * Desktop Mode — Chromeless iframe bridge.
 *
 * Two cooperative pieces emitted into chromeless admin pages:
 *
 *   - `desktop_mode_chromeless_offset_neutralizer_script()` —
 *     runs on `admin_head @ 1` and rewrites positioned-element
 *     `top` values that match common admin-bar offsets (32px /
 *     46px) to 0 inside chromeless iframes. Catches plugins that
 *     hardcode the admin-bar height instead of using the WP CSS
 *     custom property.
 *
 *   - `desktop_mode_chromeless_bridge_script()` — runs on
 *     `admin_footer` and emits the chromeless ↔ shell bridge
 *     script that handles screen-meta detection, command-palette
 *     harvesting, plugin-changed payloads, etc. The biggest
 *     hook in the original render.php (~1,950 LOC) — the bulk is
 *     the inline JS string the iframe runs.
 *
 * Extracted from `render.php` during the architecture-0.8.1 PHP
 * slicing (phase 6).
 *
 * @package Desktop_Mode
 * @since   0.8.1
 */

defined( 'ABSPATH' ) || exit;


/**
 * Neutralizes hardcoded admin-bar offsets on positioned elements
 * inside chromeless iframes.
 *
 * Many plugins compile their CSS with the admin-bar height baked in
 * as a literal pixel value rather than referencing
 * `var(--wp-admin--admin-bar--height)`. WooCommerce's
 * `.woocommerce-layout__header` is the canonical case — it ships as
 * `top: 32px` (or `46px` on small screens) because the SCSS source
 * uses build-time interpolation (`#{$header-height + $adminbar-height-mobile}`).
 * A CSS-variable rebind cannot reach these rules because the rules
 * never read the variable.
 *
 * The only generic mitigation is a runtime DOM pass:
 *
 *   1. Walk every positioned element (`fixed | sticky | absolute`).
 *   2. Compare its computed `top` against the set of values that
 *      reserve admin-bar height (defaults: `32px`, `46px`).
 *   3. If it matches, override `top` to `0` inline with `!important`.
 *
 * The match is exact-pixel — we deliberately don't catch e.g.
 * `top: 33px` (which is almost certainly intentional and unrelated
 * to admin-bar geometry). False positives are possible but
 * unlikely; a plugin would have to use `top: 32px` for a reason
 * unrelated to the admin bar AND need that exact value to remain
 * inside chromeless. We've never seen one in the wild, and if a
 * site hits it, the filter below lets them narrow the scan.
 *
 * Scoped via the `desktop-mode-chromeless` body class, runs at
 * DOMContentLoaded and again at `load` to catch React-mounted
 * components. No MutationObserver yet — we'll add one if a plugin
 * surfaces that mounts new offending elements after `load`.
 *
 * @since 0.6.1
 */
function desktop_mode_chromeless_offset_neutralizer_script() {
	if ( ! desktop_mode_is_chromeless_request() ) {
		return;
	}

	/**
	 * Filters the set of `top` pixel values that mark a positioned
	 * element as an admin-bar offset clone.
	 *
	 * Defaults match the two admin-bar heights Core ships: `32px`
	 * for desktop, `46px` for the mobile breakpoint. Sites that
	 * customize the admin bar height (some accessibility themes
	 * raise it to 50px) can extend the list.
	 *
	 * @since 0.6.1
	 *
	 * @param string[] $values Default `[ '32px', '46px' ]`.
	 */
	$top_values = apply_filters(
		'desktop_mode_chromeless_admin_bar_top_values',
		array( '32px', '46px' )
	);

	$config = wp_json_encode(
		array(
			'tops' => array_values( array_filter( array_map( 'strval', (array) $top_values ) ) ),
		)
	);
	if ( false === $config ) {
		return;
	}

	$js = "(function(C){function fix(){if(!document.body||!document.body.classList.contains('desktop-mode-chromeless'))return;var TOPS={};for(var t=0;t<C.tops.length;t++){TOPS[C.tops[t]]=1;}var els=document.querySelectorAll('*');for(var i=0;i<els.length;i++){var el=els[i];var cs=getComputedStyle(el);if(cs.position==='static')continue;if(TOPS[cs.top]){el.style.setProperty('top','0px','important');}}}if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',fix,{once:true});}else{fix();}window.addEventListener('load',fix,{once:true});})({$config});";

	wp_print_inline_script_tag( $js );
}
add_action( 'admin_head', 'desktop_mode_chromeless_offset_neutralizer_script', 1 );

/**
 * Short-circuit `admin.php?desktop_mode_menu_refresh=1` requests with
 * a tiny inline-script response that postMessages the current menu
 * payload to the parent shell.
 *
 * The full chromeless bridge is hooked on `admin_footer`, which Core
 * only fires from `admin-header.php` / `admin-footer.php`. Plain
 * `admin.php` without `?page=` (or one of the other dispatch paths
 * in admin.php) never includes the footer — the file just runs the
 * `load-{$pagenow}` hook in the `else` branch and exits. The full
 * bridge therefore never emits its payload, and the parent's
 * `wp.desktop.refreshMenu()` waits out its 8-second timeout for a
 * message that's never coming. That's the source of "deactivating a
 * plugin leaves its dock icons behind" — the hidden probe iframe
 * the shell spawns to harvest the post-mutation menu lands on a
 * page that doesn't fire admin_footer.
 *
 * Hooking here on `admin_init @ 99` runs AFTER `wp-admin/menu.php`
 * has loaded (which fires `admin_menu` and populates `$menu`) but
 * BEFORE admin.php's per-page dispatch. We can emit the payload
 * straight away and short-circuit the rest of admin.php so the probe
 * resolves in milliseconds instead of timing out.
 *
 * No admin-header / admin-footer means no `#adminmenu` DOM, so the
 * full bridge's CSS-icon harvest doesn't run here. That's an
 * acceptable trade-off: items whose icons live in `$menu[$i][6]`
 * (the vast majority) still ship correctly; items that rely on a
 * CSS `::before` on `#adminmenu .menu-icon-<slug>` fall back to the
 * default gear icon on a live refresh until the next full page load
 * — strictly better than today's "dock doesn't update at all."
 *
 * @since 0.18.4
 */
function desktop_mode_emit_menu_refresh_probe() {
	// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only payload harvest; capability-gated by chromeless gate below.
	if ( empty( $_GET['desktop_mode_menu_refresh'] ) ) {
		return;
	}
	if ( ! desktop_mode_is_chromeless_request() ) {
		return;
	}
	// Only short-circuit the bare `admin.php` probe — for any real
	// admin page (plugins.php, edit.php, etc.) we still want the full
	// admin-footer-hosted bridge to fire so the icon harvest runs.
	$pagenow = isset( $GLOBALS['pagenow'] ) ? (string) $GLOBALS['pagenow'] : '';
	if ( 'admin.php' !== $pagenow ) {
		return;
	}

	$payload = desktop_mode_build_menu_payload();
	$encoded = wp_json_encode( $payload );
	if ( false === $encoded ) {
		return;
	}

	nocache_headers();
	header( 'Content-Type: text/html; charset=utf-8' );

	// Mirror the full bridge's message shape so the same shell-side
	// listener consumes both.
	echo '<!doctype html><html><head><meta charset="utf-8"><title></title></head><body>';
	echo '<script>';
	echo '(function(){try{if(window.parent&&window.parent!==window){window.parent.postMessage({type:"desktop-mode-plugins-changed",payload:';
	echo $encoded; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- wp_json_encode produces JSON-safe output.
	echo '},window.location.origin);}}catch(e){}})();';
	echo '</script>';
	echo '</body></html>';
	exit;
}
add_action( 'admin_init', 'desktop_mode_emit_menu_refresh_probe', 99 );

/**
 * Outputs the chromeless screen-meta bridge script.
 *
 * Detects Screen Options / Help panels in the iframed page and relays
 * their availability + open/closed state to the parent desktop shell
 * via postMessage. The parent shell uses this to render matching
 * buttons in the window title bar.
 *
 * @since 0.1.0
 */
function desktop_mode_chromeless_bridge_script() {
	if ( ! desktop_mode_is_chromeless_request() ) {
		return;
	}

	/**
	 * Fires after chromeless content in desktop mode.
	 *
	 * @since 0.1.0
	 *
	 * @param string $hook_suffix The current admin page hook suffix.
	 */
	do_action( 'desktop_mode_chromeless_after', isset( $GLOBALS['hook_suffix'] ) ? $GLOBALS['hook_suffix'] : '' );

	// Menu payload — built from the LIVE $menu / $submenu globals
	// populated by real admin-context bootstrapping. We capture it here
	// rather than making the parent refetch via REST because many
	// plugins evaluate `is_admin()` at plugin-file-load time and only
	// register their `admin_menu` hook when it returns true; in a REST
	// context `WP_ADMIN` isn't defined at load, so those plugins never
	// hook in and their menu entries are missing from any endpoint we
	// could expose. Here we're INSIDE an admin request (plugins.php,
	// plugin-install.php, update.php, themes.php) where every plugin's
	// menu registered normally, so `$menu` carries the authoritative
	// post-activation state.
	//
	// Narrowed to the set of pages whose completion commonly mutates
	// the admin menu (activation / deactivation / install / theme
	// switch), plus the explicit `desktop_mode_menu_refresh=1` signal
	// the shell sets when `wp.desktop.refreshMenu()` spawns a hidden
	// iframe to harvest a fresh payload from real admin context.
	// Navigating to edit.php or similar doesn't change the menu so we
	// don't bother sending a payload otherwise — the debounce +
	// idempotent replaceItems on the parent side would still make it
	// safe, just wasteful.
	$menu_payload_json = 'null';
	$pagenow           = isset( $GLOBALS['pagenow'] ) ? (string) $GLOBALS['pagenow'] : '';
	$is_refresh_probe  = ! empty( $_GET['desktop_mode_menu_refresh'] ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only payload harvest, capability-gated by the host admin page.
	if (
		$is_refresh_probe
		|| in_array(
			$pagenow,
			array( 'plugins.php', 'plugin-install.php', 'update.php', 'themes.php' ),
			true
		)
	) {
		$encoded = wp_json_encode( desktop_mode_build_menu_payload() );
		if ( false !== $encoded ) {
			$menu_payload_json = $encoded;
		}
	}

	// Emit via wp_print_inline_script_tag so CSP nonces and `<script>`
	// attribute hygiene go through Core rather than being hand-rolled.
	$js = <<<'JS'
//# sourceURL=desktop-mode-chromeless-bridge.js
( function() {
	// Escape hatch: a chromeless page is only meant to live inside a
	// desktop-mode window iframe. If the top window IS this page, the
	// user ended up here directly — either bookmarked it, followed a
	// stale link, or got stranded by a bad portal redirect. Without
	// an admin bar there's no toggle to turn desktop mode off, so
	// strip the chromeless flag and reload as classic admin. That
	// puts the admin bar back and lets the user decide what to do.
	if ( ! window.parent || window.parent === window ) {
		try {
			var here = new URL( window.location.href );
			if ( here.searchParams.has( 'desktop_mode_chromeless' ) ) {
				here.searchParams.delete( 'desktop_mode_chromeless' );
				here.searchParams.delete( 'desktop_mode_portal' );
				window.location.replace( here.toString() );
			}
		} catch ( err ) {
			/* URL parse failure — let the broken state stand rather than
			 * navigate somewhere worse. */
		}
		return;
	}

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
	 *     `desktop-mode-iframe-error`. Parent dispatches `HOOKS.
	 *     IFRAME_ERROR`.
	 *   - `fetch` + `XMLHttpRequest` are wrapped so every completed
	 *     request (including failures) posts
	 *     `desktop-mode-iframe-network` with `{ method, url, status,
	 *     duration, failed }`. Parent dispatches `HOOKS.
	 *     IFRAME_NETWORK_COMPLETED`.
	 *
	 * Privacy: request / response bodies are NEVER captured — only
	 * method, URL, status, duration. Monitor widgets that want the
	 * full payload must ship their own deeper wrapper (at which
	 * point they own the consent conversation).
	 */
	try {
		window.addEventListener( 'error', function ( e ) {
			try {
				window.parent.postMessage( {
					type: 'desktop-mode-iframe-error',
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
					type: 'desktop-mode-iframe-error',
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
		// `desktop-mode-instrument-set` messages from the parent shell.
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
				if ( ! d || typeof d !== 'object' || d.type !== 'desktop-mode-instrument-set' ) {
					return;
				}
				window.__wpdInstrument = {
					headers: d.headers && typeof d.headers === 'object' ? d.headers : {},
					observe: !! d.observe
				};
			} );
		} catch ( _err ) { /* swallow — instrumentation is best-effort */ }

		var wpdReportNetwork = function ( method, url, status, duration, failed, extra ) {
			try {
				var msg = {
					type: 'desktop-mode-iframe-network',
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

		// Helper — when an admin-side request returns 401/403 the
		// session is most likely toast. Don't wait up to 60s for the
		// next heartbeat tick to surface core's auth-check modal —
		// force an immediate tick. `wp.heartbeat.connectNow()` is
		// safe to call repeatedly; we still debounce to avoid storms
		// when many requests fail at once. Same-origin gate keeps us
		// out of third-party 403s. The URL gate avoids looping on
		// heartbeat itself (heartbeat shouldn't 403 — but if it does
		// the recursive connectNow would not help anyway).
		var wpdAuthCheckCooldownUntil = 0;
		var wpdMaybeForceAuthCheck = function ( status, url ) {
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
			if ( now < wpdAuthCheckCooldownUntil ) {
				return;
			}
			wpdAuthCheckCooldownUntil = now + 5000;
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
		var wpdHeadersToObject = function ( h ) {
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
		var wpdContributedHeaders = function () {
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
			var wpdOrigFetch = window.fetch;
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
				var contributed = wpdContributedHeaders();
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
					var existing = wpdHeadersToObject( init && init.headers );
					if ( input && typeof input === 'object' && input.headers ) {
						var fromReq = wpdHeadersToObject( input.headers );
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

				var promise;
				try {
					promise = wpdOrigFetch.apply( this, arguments );
				} catch ( sync ) {
					wpdReportNetwork( method, url, 0, 0, true, requestHeaders ? { requestHeaders: requestHeaders } : null );
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
						wpdReportNetwork( method, url, res.status, Math.round( dur ), ! res.ok, extra );
						wpdMaybeForceAuthCheck( res.status, url );
						return res;
					},
					function ( err ) {
						var dur = ( ( typeof performance !== 'undefined' && performance.now )
							? performance.now()
							: Date.now() ) - start;
						wpdReportNetwork( method, url, 0, Math.round( dur ), true, requestHeaders ? { requestHeaders: requestHeaders } : null );
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
			var wpdOrigOpen = XMLHttpRequest.prototype.open;
			var wpdOrigSend = XMLHttpRequest.prototype.send;
			var wpdOrigSetHeader = XMLHttpRequest.prototype.setRequestHeader;
			XMLHttpRequest.prototype.open = function ( method, url ) {
				try {
					this.__wpdMethod = method;
					this.__wpdUrl = url;
					this.__wpdReqHeaders = {};
				} catch ( _err ) { /* frozen instance — skip */ }
				return wpdOrigOpen.apply( this, arguments );
			};
			XMLHttpRequest.prototype.setRequestHeader = function ( name, value ) {
				try {
					if ( ! this.__wpdReqHeaders ) {
						this.__wpdReqHeaders = {};
					}
					this.__wpdReqHeaders[ name ] = value;
				} catch ( _err ) { /* swallow */ }
				return wpdOrigSetHeader.apply( this, arguments );
			};
			XMLHttpRequest.prototype.send = function () {
				var xhr = this;
				var start = ( typeof performance !== 'undefined' && performance.now )
					? performance.now()
					: Date.now();

				// Apply contributed headers right before send. Doing it
				// here rather than in open() means contributions added
				// after open() (e.g. in async-built request flows) still
				// land on the wire.
				var contributed = wpdContributedHeaders();
				var observe = window.__wpdInstrument && window.__wpdInstrument.observe;
				for ( var hk in contributed ) {
					if ( Object.prototype.hasOwnProperty.call( contributed, hk ) ) {
						try {
							wpdOrigSetHeader.call( xhr, hk, contributed[ hk ] );
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
					wpdReportNetwork(
						xhr.__wpdMethod,
						xhr.__wpdUrl,
						xhr.status,
						Math.round( dur ),
						xhr.status === 0 || xhr.status >= 400,
						extra
					);
					wpdMaybeForceAuthCheck( xhr.status, xhr.__wpdUrl );
				};
				try {
					xhr.addEventListener( 'loadend', fire );
				} catch ( _err ) { /* swallow */ }
				return wpdOrigSend.apply( this, arguments );
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
			var wpdOrigBeacon = navigator.sendBeacon.bind( navigator );
			navigator.sendBeacon = function ( url, data ) {
				var contributed = wpdContributedHeaders();
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
					try { ok = !! wpdOrigBeacon( url, data ); } catch ( _e ) { ok = false; }
					wpdReportNetwork( 'POST', url, ok ? 200 : 0, 0, ! ok );
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
							wpdReportNetwork( 'POST', url, res.status, Math.round( dur ), ! res.ok, observe ? { requestHeaders: headers } : null );
						},
						function () {
							var dur = ( ( typeof performance !== 'undefined' && performance.now )
								? performance.now()
								: Date.now() ) - start;
							wpdReportNetwork( 'POST', url, 0, Math.round( dur ), true, observe ? { requestHeaders: headers } : null );
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
	var __DESKTOP_MODE_MENU_PAYLOAD__ = /*__DESKTOP_MODE_MENU_PAYLOAD__*/;
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
			__DESKTOP_MODE_MENU_PAYLOAD__
			&& Array.isArray( __DESKTOP_MODE_MENU_PAYLOAD__.dockItems )
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

				var __wpdItems = __DESKTOP_MODE_MENU_PAYLOAD__.dockItems;
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
	try {
		if ( __DESKTOP_MODE_MENU_PAYLOAD__ ) {
			window.parent.postMessage(
				{
					type: 'desktop-mode-plugins-changed',
					payload: __DESKTOP_MODE_MENU_PAYLOAD__
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
	 * `desktop_mode_chromeless=1` flag appended so navigation inside the iframe stays
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
	 *   - URLs that already carry desktop_mode_chromeless=
	 */
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
		if ( url.searchParams.has( 'desktop_mode_chromeless' ) ) {
			return null;
		}
		url.searchParams.set( 'desktop_mode_chromeless', '1' );
		return url.toString();
	}

	/*
	 * Classify a link so we know whether to rewrite it (admin),
	 * escalate it to the parent shell (external / non-admin), or let
	 * the browser navigate naturally (mailto, anchor, download, etc.).
	 *
	 *   'admin'       — same-origin /wp-admin/ URL we rewrite in place.
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
			return 'admin';
		}
		return 'external';
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
		if ( link.target && link.target !== '' && link.target !== '_self' ) {
			return;
		}
		if ( link.hasAttribute( 'download' ) ) {
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
		 */
		if (
			link.classList.contains( 'install-now' ) ||
			link.classList.contains( 'update-link' ) ||
			link.classList.contains( 'update-now' ) ||
			link.classList.contains( 'delete-plugin' ) ||
			link.classList.contains( 'delete-theme' ) ||
			link.classList.contains( 'install-theme' )
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
				var adminLabel = ( link.textContent || '' ).trim() ||
					link.getAttribute( 'title' ) ||
					link.getAttribute( 'aria-label' ) ||
					'';
				window.parent.postMessage(
					{
						type: 'desktop-mode-iframe-admin-link',
						url: absolute,
						label: adminLabel.slice( 0, 80 )
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
			var absolute;
			try {
				absolute = new URL( href, window.location.href ).toString();
			} catch ( err ) {
				return;
			}
			var label = ( link.textContent || '' ).trim() ||
				link.getAttribute( 'title' ) ||
				absolute;
			window.parent.postMessage(
				{
					type: 'desktop-mode-external-link',
					url: absolute,
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
	 * Focus-request bridge.
	 *
	 * Clicks inside an iframe don't cross the browsing-context
	 * boundary — the parent shell's pointerdown / focusin listeners
	 * never see them, so without this hook the only way to focus an
	 * iframe window would be clicking its title bar chrome. Post a
	 * `desktop-mode-focus-request` message on every pointerdown; the
	 * parent Window class treats it as an onFocusRequest. Capture
	 * phase so the signal fires before any stopPropagation inside
	 * a page's own handlers.
	 */
	document.addEventListener( 'pointerdown', function () {
		try {
			window.parent.postMessage(
				{ type: 'desktop-mode-focus-request' },
				window.location.origin
			);
		} catch ( err ) {
			/* cross-origin parent (shouldn't happen for chromeless
			 * pages, but don't let a throw break the bridge) */
		}
	}, true );

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
				{ type: 'desktop-mode-palette-cycle' },
				window.location.origin
			);
		} catch ( err ) { /* cross-origin parent; swallow */ }
	}, true );

	/*
	 * Command harvester — bridges `wp.data.select('core/commands')` to
	 * the parent shell.
	 *
	 * On `desktop-mode-commands-subscribe` from the parent, subscribe to
	 * the `core/commands` store and post `desktop-mode-commands-list` on
	 * every change (de-duplicated). On `desktop-mode-commands-invoke`, run
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
				{ type: 'desktop-mode-commands-list', commands: list },
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
		if ( e.data.type === 'desktop-mode-commands-subscribe' ) {
			__wpdSubscribeCommands();
		} else if ( e.data.type === 'desktop-mode-commands-unsubscribe' ) {
			__wpdUnsubscribeCommands();
		} else if ( e.data.type === 'desktop-mode-commands-invoke' && typeof e.data.name === 'string' ) {
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
			{ type: 'desktop-mode-bridge-ready' },
			__wpdCommandsOrigin
		);
	} catch ( _err ) {
		/* parent gone or cross-origin — bridge handshake will retry on next load */
	}

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
					type:      'desktop-mode-window-switch',
					direction: e.shiftKey ? 'prev' : 'next'
				},
				window.location.origin
			);
		} catch ( err ) { /* cross-origin parent; swallow */ }
	}, true );

	// Skip if the standalone iframe-bridge bundle already wired
	// screen-meta hoisting on this page. Two bridges racing to read
	// `aria-expanded` and reflect state would double-fire the
	// `desktop-mode-screen-meta-state` message and flicker the
	// title-bar buttons.
	if ( window.__desktopModeScreenMetaInstalled ) {
		return;
	}
	window.__desktopModeScreenMetaInstalled = true;

	var links = document.getElementById( 'screen-meta-links' );
	if ( ! links ) {
		return;
	}
	var screenOptionsBtn = document.getElementById( 'show-settings-link' );
	var helpBtn = document.getElementById( 'contextual-help-link' );
	var panels = [];
	if ( screenOptionsBtn ) {
		panels.push( 'screen-options' );
	}
	if ( helpBtn ) {
		panels.push( 'help' );
	}
	if ( panels.length === 0 ) {
		return;
	}

	var origin = window.location.origin;

	window.parent.postMessage( {
		type: 'desktop-mode-screen-meta',
		panels: panels
	}, origin );

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
			type: 'desktop-mode-screen-meta-state',
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
	 * `wp.desktop.broadcast(topic, payload)` (see `src/broadcast.ts`).
	 * It posts `{ type: 'desktop-mode-broadcast', topic, payload }` to
	 * every open iframe. Here we re-dispatch that as a CustomEvent
	 * on the iframe's own document so admin pages can subscribe with
	 * plain `document.addEventListener( 'desktop-mode-broadcast', cb )`
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
		if ( ! e.data || e.data.type !== 'desktop-mode-broadcast' ) {
			return;
		}
		try {
			document.dispatchEvent( new CustomEvent( 'desktop-mode-broadcast', {
				detail: { topic: e.data.topic, payload: e.data.payload }
			} ) );
		} catch ( _err ) { /* old browser without CustomEvent ctor — ignore */ }
	} );

	/* -----------------------------------------------------------------
	 * Soft-reload — iframe-side default handler.
	 *
	 * When a `desktop-mode.<post_type>.changed` broadcast fires AND the
	 * current iframe is on a known list page for that post type, we
	 * fetch the current URL and replace the iframe's `#wpbody-content`
	 * in place. The user sees the new state of the list — restored
	 * post appears, deleted media disappears — without the WP loading
	 * spinner that `location.reload()` would show.
	 *
	 * Single-edit pages (`post.php`, `post-new.php`) are deliberately
	 * NOT in the rule set: replacing their body would destroy any
	 * unsaved Gutenberg/classic-editor state. Plugins that want
	 * specific behaviour for those pages can subscribe to the same
	 * topic on `document` and handle it themselves.
	 *
	 * The fetch carries a custom header so a later phase can serve a
	 * minimal partial response if we want to optimise; for now WP
	 * returns the full admin page and we just pluck the body.
	 *
	 * WP list-table JS uses event delegation on `document`/`body`,
	 * which survives `replaceWith`. If a specific page breaks after
	 * a swap (e.g. inline-edit double-binding), that page's plugin
	 * should listen for `desktop-mode-soft-reloaded` and rebind.
	 * ----------------------------------------------------------------- */
	var DESKTOP_MODE_SOFT_RELOAD_RULES = [
		{
			topic: 'desktop-mode.post.changed',
			match: function () {
				if ( ! _desktop_modeEndsWith( location.pathname, '/wp-admin/edit.php' ) ) return false;
				var t = new URLSearchParams( location.search ).get( 'post_type' );
				return t === null || t === 'post';
			}
		},
		{
			topic: 'desktop-mode.page.changed',
			match: function () {
				if ( ! _desktop_modeEndsWith( location.pathname, '/wp-admin/edit.php' ) ) return false;
				return new URLSearchParams( location.search ).get( 'post_type' ) === 'page';
			}
		},
		{
			topic: 'desktop-mode.attachment.changed',
			match: function () {
				return _desktop_modeEndsWith( location.pathname, '/wp-admin/upload.php' );
			}
		},
		{
			topic: 'desktop-mode.comment.changed',
			match: function () {
				return _desktop_modeEndsWith( location.pathname, '/wp-admin/edit-comments.php' );
			}
		}
	];

	function _desktop_modeEndsWith( s, suffix ) { return s.lastIndexOf( suffix ) === s.length - suffix.length; }

	var _desktop_modeSoftReloadInFlight = false;
	var _desktop_modeSoftReloadQueued = false;

	function _desktop_modeSoftReload() {
		if ( _desktop_modeSoftReloadInFlight ) {
			_desktop_modeSoftReloadQueued = true;
			return;
		}
		_desktop_modeSoftReloadInFlight = true;
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
			live.replaceWith( fresh );
			try {
				document.dispatchEvent( new CustomEvent( 'desktop-mode-soft-reloaded' ) );
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
				window.console.warn( '[desktop-mode] soft-reload skipped:', err );
			}
		} ).then( function () {
			_desktop_modeSoftReloadInFlight = false;
			if ( _desktop_modeSoftReloadQueued ) {
				_desktop_modeSoftReloadQueued = false;
				_desktop_modeSoftReload();
			}
		} );
	}

	document.addEventListener( 'desktop-mode-broadcast', function ( e ) {
		var detail = e.detail || {};
		var topic = detail.topic;
		if ( ! topic ) return;
		for ( var i = 0; i < DESKTOP_MODE_SOFT_RELOAD_RULES.length; i++ ) {
			var r = DESKTOP_MODE_SOFT_RELOAD_RULES[ i ];
			if ( r.topic === topic && r.match() ) {
				_desktop_modeSoftReload();
				return;
			}
		}
	} );

	window.addEventListener( 'message', function( e ) {
		if ( e.origin !== origin ) {
			return;
		}
		if ( ! e.data || e.data.type !== 'desktop-mode-toggle-panel' ) {
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
	 * Plugins call `wp.desktop.iframe.publish(topic, payload)` /
	 * `subscribe(topic, cb)` / `onConnection(cb)` to talk to a parent-
	 * side `wp.desktop.connect()` caller. The shell only routes;
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

	function _wpdEmitToParent( connectionId, topic, payload ) {
		try {
			window.parent.postMessage( {
				type: 'desktop-mode-bridge-publish',
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

		if ( data.type === 'desktop-mode-bridge-handshake' && typeof data.connectionId === 'string' ) {
			if ( _wpdConnections[ data.connectionId ] ) {
				/* Re-handshake on iframe-ready re-arm — no-op besides
				 * acking again so the parent can resume. */
				try {
					window.parent.postMessage( {
						type: 'desktop-mode-bridge-handshake-ack',
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
					type: 'desktop-mode-bridge-handshake-ack',
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

		if ( data.type === 'desktop-mode-bridge-publish' && typeof data.topic === 'string' ) {
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

		if ( data.type === 'desktop-mode-bridge-disconnect' && typeof data.connectionId === 'string' ) {
			delete _wpdConnections[ data.connectionId ];
			return;
		}

		/* Unified window-channel delivery from the parent. Fires
		 * every `wp.desktop.on( channel, cb )` subscriber for the
		 * matching channel — same protocol as
		 * `assets/js/iframe-bridge.js`. */
		if ( data.type === 'desktop-mode-window-send' && typeof data.channel === 'string' && data.channel !== '' ) {
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
			return;
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
				var i = _wpdConnectionListeners.indexOf( cb );
				if ( i >= 0 ) {
					_wpdConnectionListeners.splice( i, 1 );
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
						d.type !== 'desktop-mode-bridge-connection-ack' ||
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
						type: 'desktop-mode-bridge-connection-request',
						requestId: requestId,
						topics: topics
					}, _wpdParentOrigin );
				} catch ( err ) {
					settle( false, err );
				}
			} );
		}
	};

	if ( ! window.wp ) { window.wp = {}; }
	if ( ! window.wp.desktop ) { window.wp.desktop = {}; }
	window.wp.desktop.iframe = iframeApi;

	/* Unified window-channel API. Mirror of the equivalent block
	 * in `assets/js/iframe-bridge.js` — keep both in sync. The
	 * parent shell posts `desktop-mode-window-send` on
	 * `Window.send( channel, payload )`; iframe-side handlers
	 * register via `wp.desktop.on( channel, cb )`. Sending the
	 * other way (`wp.desktop.send`) posts up to the parent where
	 * `Window.on( channel, cb )` subscribers fire. */
	if ( typeof window.wp.desktop.send !== 'function' ) {
		window.wp.desktop.send = function ( channel, payload ) {
			if ( typeof channel !== 'string' || channel === '' ) {
				return;
			}
			try {
				window.parent.postMessage( {
					type: 'desktop-mode-window-publish',
					channel: channel,
					payload: payload
				}, _wpdParentOrigin );
			} catch ( _err ) { /* parent gone */ }
		};
	}
	if ( typeof window.wp.desktop.on !== 'function' ) {
		window.wp.desktop.on = function ( channel, cb ) {
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
	 * Stale-nonce recovery after wp-auth-check re-authentication.
	 *
	 * When the user's session expires while a chromeless window is
	 * open, core's `wp-auth-check.js` shows its login iframe inside
	 * this page. After re-auth the auth cookie is fresh — but every
	 * per-page nonce cached in JS globals
	 * (`_wpUpdatesSettings.ajax_nonce`, `commonL10n.nonce`, Gutenberg's
	 * `wpApiSettings.nonce`, etc.) was minted under the OLD nonce-tick
	 * and is now rejected by `check_ajax_referer`. WP reports that as
	 * "Cookie check failed" on the next plugin Install / Activate /
	 * Update click, which is misleading: the cookie is fine; the
	 * nonce is stale.
	 *
	 * Fix: watch jQuery's `heartbeat-tick`. If we ever see
	 * `wp-auth-check: false` (the modal trigger) and then later see
	 * the same field flip back to `true`, the user re-authed
	 * mid-session and every cached nonce in this iframe is stale —
	 * reload so they regenerate from the fresh session.
	 *
	 * Per-iframe scope is intentional: each chromeless iframe carries
	 * its own jQuery + heartbeat stack and its own nonce caches.
	 * Siblings recover on their own next tick. We don't broadcast a
	 * reload to peers because the parent shell may still be running
	 * core's confirm() prompts and we don't want to surprise-reload
	 * windows with unsaved state.
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
			window.jQuery( document ).on( 'heartbeat-tick.wpdAuthRecover', function ( ev, data ) {
				if ( ! data || typeof data !== 'object' || ! ( 'wp-auth-check' in data ) ) {
					return;
				}
				if ( data[ 'wp-auth-check' ] === false ) {
					sawLoggedOut = true;
					return;
				}
				if ( sawLoggedOut && data[ 'wp-auth-check' ] === true ) {
					sawLoggedOut = false;
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
} )();
JS;

	// Substitute the server-built menu payload into the bridge
	// script. `wp_json_encode` guarantees safe JSON output — no need
	// for an additional escape pass. When the page isn't on our
	// menu-altering allowlist the placeholder resolves to `null` and
	// the bridge skips the postMessage.
	$js = str_replace( '/*__DESKTOP_MODE_MENU_PAYLOAD__*/', $menu_payload_json, $js );

	wp_print_inline_script_tag( $js );
}
add_action( 'admin_footer', 'desktop_mode_chromeless_bridge_script' );
