<?php
/**
 * OpenStation — Chromeless iframe bridge.
 *
 * Two cooperative pieces emitted into chromeless admin pages:
 *
 *   - `openstation_chromeless_offset_neutralizer_script()` —
 *     runs on `admin_head @ 1` and rewrites positioned-element
 *     `top` values that match common admin-bar offsets (32px /
 *     46px) to 0 inside chromeless iframes. Catches plugins that
 *     hardcode the admin-bar height instead of using the WP CSS
 *     custom property.
 *
 *   - `openstation_chromeless_bridge_script()` — runs on
 *     `admin_footer` and emits the chromeless ↔ shell bridge
 *     script that handles screen-meta detection, command-palette
 *     harvesting, plugin-changed payloads, etc. The biggest
 *     hook in the original render.php (~1,950 LOC) — the bulk is
 *     the inline JS string the iframe runs.
 *
 * Extracted from `render.php` during the architecture-0.8.1 PHP
 * slicing (phase 6).
 *
 * @package OpenStation
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
 * Scoped via the `os-chromeless` body class. Runs ONE
 * full walk at DOMContentLoaded, then watches for late additions
 * with a `MutationObserver` so React-mounted components are
 * corrected as they appear instead of via a second full-DOM walk
 * at `load`. The observer only inspects added nodes, not the
 * whole document.
 *
 * The observer callback itself does NO style reads: it only
 * enqueues added elements and schedules one idle flush
 * (`requestIdleCallback`, 500 ms timeout backstop; plain
 * `setTimeout` fallback). Every `getComputedStyle()` read forces
 * a synchronous style recalculation, and a MutationObserver
 * callback runs as a microtask BEFORE the next paint — so reading
 * computed style in the callback puts a forced style flush on the
 * exact path Gutenberg hammers hardest while the user types
 * (block toolbar mounts, popovers, autocompleters; hundreds of
 * descendants per batch). Deferring the walk to idle time takes
 * the neutralizer off the typing path entirely; a late-mounted
 * plugin header is corrected a frame or two later, which is
 * imperceptible for elements that only just appeared.
 *
 * Fallback for very old browsers without `MutationObserver`:
 * keep the second walk at `load`. The current minimum (IE 11+)
 * already ships MO, so the fallback only fires on extreme
 * outliers — but it's free insurance.
 */
function openstation_chromeless_offset_neutralizer_script() {
	if ( ! openstation_is_chromeless_request() ) {
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
		'openstation_chromeless_admin_bar_top_values',
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
	$js .= 'if(!el||el.nodeType!==1)return;';
	$js .= 'var cs;';
	$js .= 'try{cs=getComputedStyle(el);}catch(_e){return;}';
	$js .= "if(cs.position==='static')return;";
	$js .= "if(TOPS[cs.top]){el.style.setProperty('top','0px','important');}";
	$js .= '}';
	$js .= 'function walkSubtree(root){';
	$js .= 'if(!root)return;';
	$js .= 'if(root.nodeType===1){fixOne(root);}';
	$js .= "var els=root.querySelectorAll?root.querySelectorAll('*'):[];";
	$js .= 'for(var i=0;i<els.length;i++){fixOne(els[i]);}';
	$js .= '}';
	// Added nodes are queued and walked in ONE idle-time flush. The
	// observer callback must never read computed style itself — it
	// runs before the next paint, so a style read there is a forced
	// synchronous recalc on the editor's typing path.
	$js .= 'var queue=[];';
	$js .= 'var scheduled=false;';
	$js .= 'function flush(){';
	$js .= 'scheduled=false;';
	$js .= 'var batch=queue;';
	$js .= 'queue=[];';
	$js .= 'for(var i=0;i<batch.length;i++){';
	// Skip nodes detached between enqueue and flush (transient
	// popovers, React unmounts) — nothing visible to correct, and
	// getComputedStyle on a detached tree is wasted work.
	$js .= 'if(batch[i].isConnected===false)continue;';
	$js .= 'walkSubtree(batch[i]);';
	$js .= '}';
	$js .= '}';
	$js .= 'function schedule(){';
	$js .= 'if(scheduled)return;';
	$js .= 'scheduled=true;';
	$js .= 'if(window.requestIdleCallback){window.requestIdleCallback(flush,{timeout:500});}';
	$js .= 'else{window.setTimeout(flush,200);}';
	$js .= '}';
	$js .= 'var started=false;';
	$js .= 'function start(){';
	$js .= 'if(started)return;';
	$js .= "if(!document.body||!document.body.classList.contains('os-chromeless'))return;";
	$js .= 'started=true;';
	$js .= 'var MO=window.MutationObserver;';
	$js .= 'if(MO){';
	$js .= 'var observer=new MO(function(records){';
	$js .= 'var found=false;';
	$js .= 'for(var r=0;r<records.length;r++){';
	$js .= 'var rec=records[r];';
	$js .= "if(rec.type!=='childList')continue;";
	$js .= 'var added=rec.addedNodes;';
	$js .= 'for(var n=0;n<added.length;n++){';
	// Element nodes only — rich-text edits insert text nodes by the
	// dozen, and those can never carry a positioned offset.
	$js .= 'if(added[n].nodeType===1){queue.push(added[n]);found=true;}';
	$js .= '}';
	$js .= '}';
	$js .= 'if(found){schedule();}';
	$js .= '});';
	$js .= 'observer.observe(document.body,{childList:true,subtree:true});';
	$js .= '}';
	$js .= 'walkSubtree(document.body);';
	// Defense in depth — pre-MutationObserver browsers fall back to the
	// original double-walk so React-mounted components added between
	// DOMContentLoaded and load still get neutralized.
	$js .= 'if(!MO){';
	$js .= "window.addEventListener('load',function(){walkSubtree(document.body);},{once:true});";
	$js .= '}';
	$js .= '}';
	$js .= "if(document.readyState==='loading'){";
	$js .= "document.addEventListener('DOMContentLoaded',start,{once:true});";
	$js .= '}else{';
	$js .= 'start();';
	$js .= '}';
	$js .= '})(' . $config . ');';

	wp_print_inline_script_tag( $js );
}
add_action( 'admin_head', 'openstation_chromeless_offset_neutralizer_script', 1 );

/**
 * Short-circuit `admin.php?openstation_menu_refresh=1` requests with
 * a tiny inline-script response that postMessages the current menu
 * payload to the parent shell.
 *
 * The full chromeless bridge is hooked on `admin_footer`, which Core
 * only fires from `admin-header.php` / `admin-footer.php`. Plain
 * `admin.php` without `?page=` (or one of the other dispatch paths
 * in admin.php) never includes the footer — the file just runs the
 * `load-{$pagenow}` hook in the `else` branch and exits. The full
 * bridge therefore never emits its payload, and the parent's
 * `wp.os.refreshMenu()` waits out its 8-second timeout for a
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
function openstation_emit_menu_refresh_probe() {
	// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only payload harvest; capability-gated by chromeless gate below.
	if ( empty( $_GET['openstation_menu_refresh'] ) ) {
		return;
	}
	if ( ! openstation_is_chromeless_request() ) {
		return;
	}
	// Only short-circuit the bare `admin.php` probe — for any real
	// admin page (plugins.php, edit.php, etc.) we still want the full
	// admin-footer-hosted bridge to fire so the icon harvest runs.
	$pagenow = isset( $GLOBALS['pagenow'] ) ? (string) $GLOBALS['pagenow'] : '';
	if ( 'admin.php' !== $pagenow ) {
		return;
	}

	$payload = openstation_menu_refresh_probe_payload();
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
	echo '(function(){try{if(window.parent&&window.parent!==window){window.parent.postMessage({type:"os-plugins-changed",payload:';
	echo $encoded; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- wp_json_encode produces JSON-safe output.
	echo '},window.location.origin);}}catch(e){}})();';
	echo '</script>';
	echo '</body></html>';
	exit;
}
add_action( 'admin_init', 'openstation_emit_menu_refresh_probe', 99 );

/**
 * Build the menu payload the refresh probe emits, with the script
 * data the harvest depends on attached first.
 *
 * `openstation_build_menu_payload()` harvests every lazy native
 * window's handle-attached data — `wp_localize_script` blobs and
 * `wp_add_inline_script` snippets — via
 * `openstation_resolve_script_payload()`. Modules attach that data on
 * `admin_enqueue_scripts` at priority ≤ 5 (the contract
 * `Tests_OpenStation_LazyWindowConfigPriority` pins), which holds on
 * every payload producer except this one: the probe short-circuits
 * `admin.php` on `admin_init`, long before Core would fire the
 * enqueue hook, so nothing was ever attached and the harvested
 * entries shipped with empty `scriptBefore` / `scriptL10n` arrays.
 *
 * The shell refreshes its native-window index from every payload it
 * receives, so one probe response silently downgraded windows the
 * boot payload had delivered complete — the first lazy open of WP
 * Explorer after a menu refresh found the WooCommerce companion with
 * no `openStationWooConfig`, and the store's order bands and preview
 * panels went dark with nothing in the console to say why.
 *
 * Replaying the hook here makes the probe's request faithful to the
 * real admin page it stands in for. The output buffer guards the
 * short-circuit response: an enqueue callback that echoes must not
 * beat our `header()` calls. Enqueued handles are never printed —
 * the probe exits before any print pipeline runs.
 *
 * @return array Menu payload, same shape as `openstation_build_menu_payload()`.
 */
function openstation_menu_refresh_probe_payload() {
	if ( ! did_action( 'admin_enqueue_scripts' ) ) {
		// `admin.php` calls `set_current_screen()` AFTER `admin_init`,
		// so at probe time there is no screen yet — and Core's own
		// enqueue callbacks (the block-editor script loader among
		// them) read `get_current_screen()->id` unguarded. Build the
		// screen the real flow would have had before the hook fires.
		if ( function_exists( 'set_current_screen' ) && function_exists( 'get_current_screen' ) && ! get_current_screen() ) {
			set_current_screen( 'admin' );
		}
		ob_start();
		// phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound -- deliberate replay of Core's own hook so handle-attached script data exists before the harvest below.
		do_action( 'admin_enqueue_scripts', 'admin.php' );
		ob_end_clean();
	}

	return openstation_build_menu_payload();
}

/**
 * Outputs the chromeless screen-meta bridge script.
 *
 * Detects Screen Options / Help panels in the iframed page and relays
 * their availability + open/closed state to the parent desktop shell
 * via postMessage. The parent shell uses this to render matching
 * buttons in the window title bar.
 */
function openstation_chromeless_bridge_script() {
	if ( ! openstation_is_chromeless_request() ) {
		return;
	}

	/**
	 * Fires after chromeless content in OpenStation.
	 *
	 * @param string $hook_suffix The current admin page hook suffix.
	 */
	do_action( 'openstation_chromeless_after', isset( $GLOBALS['hook_suffix'] ) ? $GLOBALS['hook_suffix'] : '' );

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
	// switch), plus the explicit `openstation_menu_refresh=1` signal
	// the shell sets when `wp.os.refreshMenu()` spawns a hidden
	// iframe to harvest a fresh payload from real admin context.
	// Navigating to edit.php or similar doesn't change the menu so we
	// don't bother sending a payload otherwise — the debounce +
	// idempotent replaceItems on the parent side would still make it
	// safe, just wasteful.
	$menu_payload_json = 'null';
	$pagenow           = isset( $GLOBALS['pagenow'] ) ? (string) $GLOBALS['pagenow'] : '';
	$is_refresh_probe  = ! empty( $_GET['openstation_menu_refresh'] ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only payload harvest, capability-gated by the host admin page.
	if (
		$is_refresh_probe
		|| in_array(
			$pagenow,
			array( 'plugins.php', 'plugin-install.php', 'update.php', 'themes.php' ),
			true
		)
	) {
		$encoded = wp_json_encode( openstation_build_menu_payload() );
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
	$content_identity_json = wp_json_encode( openstation_build_content_identity() );
	if ( false === $content_identity_json ) {
		$content_identity_json = 'null';
	}

	// On pages that don't carry a full payload, ship the lightweight
	// menu signature so the shell can detect an off-allowlist menu
	// change (e.g. a CPT registered via a settings tool) and refresh
	// only then. The full payload already embeds its own `menuSig`, so
	// there's no point recomputing it when one is being sent. GH#325.
	$menu_sig_json = 'null';
	if ( 'null' === $menu_payload_json ) {
		$menu_sig = openstation_menu_signature();
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
	// - `topic`       — the `os.<type>.changed` topic.
	// - `path`        — wp-admin filename (`admin.php`).
	// - `query`       — required query params (exact match).
	// - `queryAbsent` — params that must NOT be present.
	//
	// The default rule covers WooCommerce's HPOS orders list.
	// `queryAbsent: [ 'action' ]` is load-bearing: with `&action=edit`
	// the same path is the single-order EDITOR, which must keep the
	// single-edit exclusion (a soft reload would destroy unsaved
	// order state). Shipped unconditionally — when WooCommerce is
	// absent the URL never renders and the rule is inert.
	$soft_reload_rules = array(
		array(
			'topic'       => 'os.shop_order.changed',
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
	 * `openstation_content_changes_record()` calls (or your own
	 * `os.<type>.changed` broadcasts) on the publish side.
	 *
	 * @param array $soft_reload_rules Rule arrays with keys `topic`,
	 *                                 `path`, `query`, `queryAbsent`.
	 */
	$soft_reload_rules = (array) apply_filters( 'openstation_soft_reload_rules', $soft_reload_rules );
	$soft_reload_json  = wp_json_encode( array_values( $soft_reload_rules ) );
	if ( ! $soft_reload_json ) {
		$soft_reload_json = '[]';
	}

	// Per-request data for the bridge bundle.
	//
	// This used to be a `str_replace()` pass over a nowdoc holding the
	// whole bridge, printed inline — roughly 125 KB of unminified
	// JavaScript in the HTML of every window, comments included. The
	// document is the one asset no cache can help with, so that cost
	// was paid in full on every window open. The code now lives in
	// `src/chromeless-bridge.js` and builds to a bundle that is
	// fetched once and served from cache (browser, and the shared
	// service-worker cache) for every later window; only these four
	// values still have to vary per request.
	//
	// `wp_json_encode` already guarantees safe JSON output, so the
	// values are interpolated as-is — the same guarantee the
	// `str_replace` pass relied on. Keys are underscore-prefixed to
	// mark them as a private contract with the bundle rather than a
	// public API; `src/chromeless-bridge.js` reads exactly these four.
	$data = sprintf(
		'window.__osChromelessData = { _menuPayload: %s, _menuSig: %s, _identity: %s, _softReload: %s };',
		$menu_payload_json,
		$menu_sig_json,
		$content_identity_json,
		$soft_reload_json
	);

	// `in_footer` + a `before` inline block reproduces exactly what the
	// old inline print did: the data is defined, then the bridge runs,
	// both at the same point in the document. No `defer` / `async` —
	// the bridge expects to execute synchronously here, and deferring
	// it would move it after the page's own footer scripts.
	// Defensive re-registration. `WP_Dependencies::enqueue()` silently
	// no-ops on a handle that isn't registered, and plugins that
	// rebuild `WP_Scripts` wholesale are a real, documented shape —
	// see `includes/render/asset-guard.php` for the same class of
	// conflict. The bridge is the one script a window genuinely cannot
	// do without: losing it costs the window its title, its links, its
	// activity ring and its refresh signalling. `wp_register_script()`
	// no-ops when the handle is already there, so this costs nothing
	// on the normal path.
	if ( ! wp_script_is( 'os-chromeless-bridge', 'registered' ) ) {
		openstation_register_assets();
	}

	wp_enqueue_script( 'os-chromeless-bridge' );
	wp_add_inline_script( 'os-chromeless-bridge', $data, 'before' );
}
add_action( 'admin_footer', 'openstation_chromeless_bridge_script' );
