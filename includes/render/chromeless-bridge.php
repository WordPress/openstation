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
 * Scoped via the `desktop-mode-chromeless` body class. Runs ONE
 * full walk at DOMContentLoaded, then watches for late additions
 * with a `MutationObserver` so React-mounted components are
 * corrected as they appear instead of via a second full-DOM walk
 * at `load`. The observer only inspects added nodes, not the
 * whole document, which is roughly two orders of magnitude
 * cheaper than the old double-walk on a busy Gutenberg or
 * WooCommerce admin page (~2,000+ `getComputedStyle()` calls
 * collapsed into a one-time initial walk plus per-addition
 * checks).
 *
 * Fallback for very old browsers without `MutationObserver`:
 * keep the second walk at `load`. The current minimum (IE 11+)
 * already ships MO, so the fallback only fires on extreme
 * outliers — but it's free insurance.
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

	// Build the inline JS as a concatenated single-quoted string —
	// Plugin Check disallows heredoc syntax (PluginCheck.CodeAnalysis.
	// Heredoc.NotAllowed), so the source is uglier than the original
	// `<<<JS … JS;` block but functionally identical. The trailing
	// `$config` JSON is appended at the end so the whole body is a
	// closure receiving a `{tops: [...]}` argument.
	$js  = '(function(C){';
	$js .= 'var TOPS={};';
	$js .= 'for(var t=0;t<C.tops.length;t++){TOPS[C.tops[t]]=1;}';
	$js .= 'function fixOne(el){';
	$js .=   'if(!el||el.nodeType!==1)return;';
	$js .=   'var cs;';
	$js .=   'try{cs=getComputedStyle(el);}catch(_e){return;}';
	$js .=   "if(cs.position==='static')return;";
	$js .=   "if(TOPS[cs.top]){el.style.setProperty('top','0px','important');}";
	$js .= '}';
	$js .= 'function walkSubtree(root){';
	$js .=   'if(!root)return;';
	$js .=   'if(root.nodeType===1){fixOne(root);}';
	$js .=   "var els=root.querySelectorAll?root.querySelectorAll('*'):[];";
	$js .=   'for(var i=0;i<els.length;i++){fixOne(els[i]);}';
	$js .= '}';
	$js .= 'var started=false;';
	$js .= 'function start(){';
	$js .=   'if(started)return;';
	$js .=   "if(!document.body||!document.body.classList.contains('desktop-mode-chromeless'))return;";
	$js .=   'started=true;';
	$js .=   'var MO=window.MutationObserver;';
	$js .=   'if(MO){';
	$js .=     'var observer=new MO(function(records){';
	$js .=       'for(var r=0;r<records.length;r++){';
	$js .=         'var rec=records[r];';
	$js .=         "if(rec.type!=='childList')continue;";
	$js .=         'var added=rec.addedNodes;';
	$js .=         'for(var n=0;n<added.length;n++){walkSubtree(added[n]);}';
	$js .=       '}';
	$js .=     '});';
	$js .=     'observer.observe(document.body,{childList:true,subtree:true});';
	$js .=   '}';
	$js .=   'walkSubtree(document.body);';
	// Defense in depth — pre-MutationObserver browsers fall back to the
	// original double-walk so React-mounted components added between
	// DOMContentLoaded and load still get neutralized.
	$js .=   'if(!MO){';
	$js .=     "window.addEventListener('load',function(){walkSubtree(document.body);},{once:true});";
	$js .=   '}';
	$js .= '}';
	$js .= "if(document.readyState==='loading'){";
	$js .=   "document.addEventListener('DOMContentLoaded',start,{once:true});";
	$js .= '}else{';
	$js .=   'start();';
	$js .= '}';
	$js .= '})(' . $config . ');';

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
 */
function desktop_mode_chromeless_bridge_script() {
	if ( ! desktop_mode_is_chromeless_request() ) {
		return;
	}

	/**
	 * Fires after chromeless content in desktop mode.
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

	// Content identity — which object this admin page shows ("comment 45
	// of post 123"). Built here, in real admin context, because the URL
	// alone can't resolve relations like comment → parent post. Always
	// emitted (including `null`) so navigating an iframe from an
	// identified page to an unidentified one clears the stale identity
	// in the parent's relations engine.
	$content_identity_json = wp_json_encode( desktop_mode_build_content_identity() );
	if ( false === $content_identity_json ) {
		$content_identity_json = 'null';
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
	 * window relations. The `desktop-mode-ready` signal intentionally
	 * stays LAST — it means "every listener below is wired".
	 */
	try {
		window.parent.postMessage(
			{
				type: 'desktop-mode-content-identity',
				identity: /*__DESKTOP_MODE_CONTENT_IDENTITY__*/
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
								type: 'desktop-mode-broadcast',
								topic:
									'desktop-mode.' +
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
									type: 'desktop-mode-content-identity',
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
	var __DESKTOP_MODE_MENU_SIG__ = /*__DESKTOP_MODE_MENU_SIG__*/;
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
		if ( __DESKTOP_MODE_MENU_PAYLOAD__ ) {
			__wpdShell.postMessage(
				{
					type: 'desktop-mode-plugins-changed',
					payload: __DESKTOP_MODE_MENU_PAYLOAD__
				},
				window.location.origin
			);
		} else if ( __DESKTOP_MODE_MENU_SIG__ ) {
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
					type: 'desktop-mode-menu-signature',
					sig: __DESKTOP_MODE_MENU_SIG__
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
		 * Activity-footprint launcher. A "View activity footprint" row
		 * action (added to the Users list table by
		 * `desktop_mode_user_footprint_row_action`) carries the target
		 * user id in `data-desktop-mode-footprint`. The iframe has no
		 * shell API of its own, so we escalate the click to the parent
		 * shell, which opens the My WordPress window on that user's
		 * footprint. Checked BEFORE classifyLink so the link's real
		 * href — a graceful profile-edit fallback for no-JS — is never
		 * followed inside the shell. Modifier-key / middle clicks are
		 * already filtered above, so cmd/ctrl-click still opens that
		 * fallback in a new browser tab.
		 */
		var footprintAttr = link.getAttribute( 'data-desktop-mode-footprint' );
		if ( footprintAttr ) {
			var footprintUid = parseInt( footprintAttr, 10 );
			if ( footprintUid > 0 ) {
				e.preventDefault();
				try {
					window.parent.postMessage(
						{
							type: 'desktop-mode-open-user-footprint',
							userId: footprintUid,
							userName: link.getAttribute( 'data-desktop-mode-footprint-name' ) || ''
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
	function postFocusRequest() {
		try {
			window.parent.postMessage(
				{ type: 'desktop-mode-focus-request' },
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
					type: 'desktop-mode-os-file-drop',
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
	if ( ! window.__desktopModeDragHoverForwarderInstalled ) {
		window.__desktopModeDragHoverForwarderInstalled = true;
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
						type: 'desktop-mode-drag-hover',
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
	 * mascot's gaze (`src/mascot/pointer.ts`) — gets a throttled
	 * stream of this frame's client coordinates and rebases them
	 * through the iframe element's own rect.
	 *
	 * Strictly opt-in: the parent posts
	 * `desktop-mode-pointer-track { enabled: true }` when a consumer
	 * starts, and `{ enabled: false }` when the last one stops. A
	 * shell with no consumer never turns this on and pays nothing.
	 * `desktop-mode-bridge-ready` (emitted at the end of this script,
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
	if ( ! window.__desktopModePointerForwarderInstalled ) {
		window.__desktopModePointerForwarderInstalled = true;
		var pointerTrackOn = false;
		var pointerLastSent = 0;
		window.addEventListener( 'message', function ( e ) {
			if ( e.origin !== window.location.origin ) return;
			if ( ! e.data || e.data.type !== 'desktop-mode-pointer-track' ) return;
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
						type: 'desktop-mode-pointer-move',
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
		type: 'desktop-mode-screen-meta',
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
	 * `desktop-mode.<type>.changed` topic — so every custom post
	 * type's `edit.php?post_type=X` screen participates with zero
	 * per-type code. Non-`edit.php` list screens (e.g. WooCommerce's
	 * HPOS `admin.php?page=wc-orders`) are covered by declarative
	 * extra rules, filterable server-side via
	 * `desktop_mode_soft_reload_rules`.
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
	var DESKTOP_MODE_SOFT_RELOAD_EXTRAS = /*__DESKTOP_MODE_SOFT_RELOAD_EXTRAS__*/;

	function _desktop_modeEndsWith( s, suffix ) { return s.lastIndexOf( suffix ) === s.length - suffix.length; }

	function _desktop_modeListType() {
		if ( _desktop_modeEndsWith( location.pathname, '/wp-admin/edit.php' ) ) {
			return new URLSearchParams( location.search ).get( 'post_type' ) || 'post';
		}
		if ( _desktop_modeEndsWith( location.pathname, '/wp-admin/upload.php' ) ) {
			return 'attachment';
		}
		if ( _desktop_modeEndsWith( location.pathname, '/wp-admin/edit-comments.php' ) ) {
			return 'comment';
		}
		if ( _desktop_modeEndsWith( location.pathname, '/wp-admin/plugins.php' ) ) {
			return 'plugin';
		}
		// plugin-install.php is intentionally not a soft-reload target.
		// Reloading that page mid-session would discard the user's search
		// results or reset an in-progress install. The page still emits
		// plugin.changed (via notifyPluginInstall below); it just doesn't
		// reload itself in response to one.
		return null;
	}

	function _desktop_modeMatchesExtraRule( rule ) {
		if ( ! rule || ! rule.path ) {
			return false;
		}
		if ( ! _desktop_modeEndsWith( location.pathname, '/wp-admin/' + rule.path ) ) {
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

	function _desktop_modeSoftReloadTopicMatches( topic ) {
		var m = /^desktop-mode\.(.+)\.changed$/.exec( topic );
		if ( m && m[ 1 ] === _desktop_modeListType() ) {
			return true;
		}
		for ( var i = 0; i < DESKTOP_MODE_SOFT_RELOAD_EXTRAS.length; i++ ) {
			var rule = DESKTOP_MODE_SOFT_RELOAD_EXTRAS[ i ];
			if ( rule && rule.topic === topic && _desktop_modeMatchesExtraRule( rule ) ) {
				return true;
			}
		}
		return false;
	}

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
		if ( _desktop_modeSoftReloadTopicMatches( topic ) ) {
			_desktop_modeSoftReload();
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

		if ( data.type === 'desktop-mode-bridge-beforeunload-query' ) {
			var prevent = false;
			var msg = '';

			function shimReturnValue( ev ) {
				Object.defineProperty( ev, 'returnValue', {
					get: function() { return this._returnValue || ''; },
					set: function( v ) { this._returnValue = v; }
				} );
			}

			function checkPrevent( ev, result ) {
				var hasRes = typeof result === 'string' && result !== '';
				var hasRetVal = typeof ev.returnValue === 'string' && ev.returnValue !== '';
				if ( ev.defaultPrevented || hasRes || hasRetVal ) {
					prevent = true;
					if ( hasRes ) {
						msg = result;
					} else if ( hasRetVal ) {
						msg = ev.returnValue;
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
				window.parent.postMessage( {
					type: 'desktop-mode-bridge-beforeunload-response',
					prevent: prevent,
					message: msg
				}, _wpdParentOrigin );
			} catch ( _err ) { /* swallow */ }
			return;
		}

		if ( data.type === 'desktop-mode-bridge-handshake' && typeof data.connectionId === 'string' ) {
			/* The parent's handshake carries the host window id —
			 * stash it so `wp.desktop.iframe.windowId` and
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
						type: 'desktop-mode-chrome-theme',
						tokens: tokens || {}
					}, _wpdParentOrigin );
				} catch ( _err ) { /* parent gone */ }
			},
			setControls: function ( config ) {
				try {
					window.parent.postMessage( {
						type: 'desktop-mode-chrome-controls',
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
						type: 'desktop-mode-chrome-slot',
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
	 * Stale-nonce recovery after a session-expiry re-login.
	 *
	 * When the user's session expires while a chromeless window is
	 * open, this iframe does NOT show core's `wp-auth-check` login
	 * modal — `desktop_mode_chromeless_suppress_auth_check()` keeps
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
	 * first (`desktop-mode-reauth-detected`) so its own recovery
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
					// Tell the parent shell BEFORE we reload so it
					// doesn't have to wait for its own heartbeat
					// tick (up to 60s on an idle shell) to discover
					// the cookie is fresh. Parent runs its full
					// recovery path on receipt — overlay teardown,
					// iframe reload sweep, then a hard reload.
					try {
						if ( window.parent && window.parent !== window ) {
							window.parent.postMessage(
								{ type: 'desktop-mode-reauth-detected' },
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
						{ type: 'desktop-mode-updates-changed' },
						window.location.origin
					);
				}
			} catch ( _err ) { /* shell gone or cross-origin */ }
		}
		function notifyPluginInstall() {
			// `wp-plugin-install-success` fires after an AJAX install on
			// plugin-install.php with no page navigation. The PHP
			// `upgrader_process_complete` hook records the change correctly,
			// but `desktop_mode_content_changes_emit_footer` only runs on
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
							type: 'desktop-mode-broadcast',
							topic: 'desktop-mode.plugin.changed',
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
					'wp-plugin-update-success.wpdUpdates',
					'wp-plugin-update-error.wpdUpdates',
					'wp-plugin-delete-success.wpdUpdates',
					'wp-theme-update-success.wpdUpdates',
					'wp-theme-update-error.wpdUpdates',
					'wp-theme-delete-success.wpdUpdates'
				].join( ' ' ),
				notify
			);
			window.jQuery( document ).on( 'wp-plugin-install-success.wpdUpdates', notifyPluginInstall );
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
				{ type: 'desktop-mode-ready' },
				window.location.origin
			);
		}
	} catch ( _err ) { /* parent gone or cross-origin */ }
} )();
JS;

	// On pages that don't carry a full payload, ship the lightweight
	// menu signature so the shell can detect an off-allowlist menu
	// change (e.g. a CPT registered via a settings tool) and refresh
	// only then. The full payload already embeds its own `menuSig`, so
	// there's no point recomputing it when one is being sent. GH#325.
	$menu_sig_json = 'null';
	if ( 'null' === $menu_payload_json ) {
		$menu_sig = desktop_mode_menu_signature();
		if ( '' !== $menu_sig ) {
			$encoded_sig = wp_json_encode( $menu_sig );
			if ( false !== $encoded_sig ) {
				$menu_sig_json = $encoded_sig;
			}
		}
	}

	// Declarative soft-reload rules for list screens that are NOT a
	// standard `edit.php?post_type=<type>` / `upload.php` /
	// `edit-comments.php` page (those are matched generically in the
	// bridge script). Rule shape:
	//   - `topic`       — the `desktop-mode.<type>.changed` topic.
	//   - `path`        — wp-admin filename (`admin.php`).
	//   - `query`       — required query params (exact match).
	//   - `queryAbsent` — params that must NOT be present.
	//
	// The default rule covers WooCommerce's HPOS orders list.
	// `queryAbsent: [ 'action' ]` is load-bearing: with `&action=edit`
	// the same path is the single-order EDITOR, which must keep the
	// single-edit exclusion (a soft reload would destroy unsaved
	// order state). Shipped unconditionally — when WooCommerce is
	// absent the URL never renders and the rule is inert.
	$soft_reload_rules = array(
		array(
			'topic'       => 'desktop-mode.shop_order.changed',
			'path'        => 'admin.php',
			'query'       => array( 'page' => 'wc-orders' ),
			'queryAbsent' => array( 'action' ),
		),
	);

	/**
	 * Filters the declarative soft-reload rules injected into every
	 * chromeless iframe.
	 *
	 * Lets a plugin whose list screen lives on a custom admin URL
	 * participate in cross-window refresh: pair a rule here with
	 * `desktop_mode_content_changes_record()` calls (or your own
	 * `desktop-mode.<type>.changed` broadcasts) on the publish side.
	 *
	 * @param array $soft_reload_rules Rule arrays with keys `topic`,
	 *                                 `path`, `query`, `queryAbsent`.
	 */
	$soft_reload_rules = (array) apply_filters( 'desktop_mode_soft_reload_rules', $soft_reload_rules );
	$soft_reload_json  = wp_json_encode( array_values( $soft_reload_rules ) );
	if ( ! $soft_reload_json ) {
		$soft_reload_json = '[]';
	}

	// Substitute the server-built menu payload into the bridge
	// script. `wp_json_encode` guarantees safe JSON output — no need
	// for an additional escape pass. When the page isn't on our
	// menu-altering allowlist the placeholder resolves to `null` and
	// the bridge skips the postMessage.
	$js = str_replace( '/*__DESKTOP_MODE_MENU_PAYLOAD__*/', $menu_payload_json, $js );
	$js = str_replace( '/*__DESKTOP_MODE_MENU_SIG__*/', $menu_sig_json, $js );
	$js = str_replace( '/*__DESKTOP_MODE_CONTENT_IDENTITY__*/', $content_identity_json, $js );
	$js = str_replace( '/*__DESKTOP_MODE_SOFT_RELOAD_EXTRAS__*/', $soft_reload_json, $js );

	wp_print_inline_script_tag( $js );
}
add_action( 'admin_footer', 'desktop_mode_chromeless_bridge_script' );
