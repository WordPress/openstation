<?php
/**
 * OpenStation — Progressive Web App support.
 *
 * Lets users install the WordPress site as a desktop / mobile app from
 * the openstation shell. Three concerns live here:
 *
 *   1. Web app manifest at `/openstation/manifest.webmanifest` —
 *      served via `parse_request` like the portal URL, no rewrite-rule
 *      registration. Site name, theme color, and icons assembled from
 *      the WordPress Site Icon (when set) with a wp-logo fallback. The
 *      `openstation_pwa_manifest` filter lets plugins mutate any
 *      field before encoding.
 *
 *   2. Service worker at `/openstation/sw.js`, served with the
 *      explicit `Service-Worker-Allowed: /` header so a single SW can
 *      scope across `/openstation/` AND `/wp-admin/` (their common
 *      ancestor is `/`). The plugin lives at
 *      `/wp-content/plugins/desktop-mode/`, which is NOT a parent of
 *      `/wp-admin/`, so wp-content-served SWs cannot reach admin pages.
 *      PHP delivery sidesteps that constraint cleanly.
 *
 *   3. Two REST routes scoped to the current user:
 *        - `GET/POST /desktop-mode/v1/pwa-state` — dismissal pref for
 *          the install hint, plus notification permission record.
 *        - (future) `POST /desktop-mode/v1/push-subscription` — Web
 *          Push subscription storage. Stub left here in a comment as
 *          a hint for the v2 push PR.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * URL fragment for the manifest endpoint, joined onto the portal path.
 *
 * Kept as a constant so the JS-side script localisation and the
 * `parse_request` matcher cannot drift apart.
 */
const OPENSTATION_PWA_MANIFEST_FRAGMENT = 'manifest.webmanifest';

/**
 * URL fragment for the service worker.
 */
const OPENSTATION_PWA_SW_FRAGMENT = 'sw.js';

/**
 * User-meta key — JSON blob persisting per-user PWA UI state.
 *
 * Today: `installHintDismissed` (bool), `notificationsEnabled` (bool).
 * Future: `pushSubscription` (object) when phase 4 lands.
  *
  * The VALUE keeps its pre-rebrand spelling on purpose: it is a
  * persisted or externally-visible identifier, so renaming it would
  * orphan data already written by live installs (or break a live
  * URL). The mismatch between this constant's name and its value is
  * deliberate — it is NOT a half-finished rename.
 */
const OPENSTATION_PWA_USER_META = 'desktop_mode_pwa_state';

/**
 * Builds the absolute manifest URL.
 *
 * @return string
 */
function openstation_pwa_manifest_url() {
	return openstation_portal_url() . OPENSTATION_PWA_MANIFEST_FRAGMENT;
}

/**
 * Builds the absolute service-worker URL.
 *
 * @return string
 */
function openstation_pwa_sw_url() {
	return openstation_portal_url() . OPENSTATION_PWA_SW_FRAGMENT;
}

/**
 * Resolves whether openstation should usurp another root-scope SW.
 *
 * When `false` (default), `src/pwa/sw-register.ts` bails on registration
 * if another root-scope service worker is already on the origin — polite
 * behaviour for sites that intentionally use a different PWA plugin. When
 * `true`, our registration replaces the existing SW.
 *
 * Operators flip this to recover installability on sites where a foreign
 * SW (Super PWA, Jetpack Boost, etc.) is shadowing the openstation SW
 * and causing the "Install <site> as an app" tile to surface the
 * "another app is handling installs" toast.
 *
 * @return bool
 */
function openstation_pwa_force_replace_sw() {
	/**
	 * Filters whether openstation replaces an existing root-scope SW.
	 *
	 * Return `true` to take over from a foreign PWA plugin's service
	 * worker so openstation's "Install as app" affordance works on
	 * sites where another plugin's SW is already active.
	 *
	 * @param bool $force_replace Defaults to `false` (yield to existing SWs).
	 */
	return (bool) apply_filters( 'openstation_pwa_force_replace_sw', false );
}

/**
 * Detects which PWA endpoint the current request is targeting, if any.
 *
 * Mirrors `openstation_is_portal_request()`'s strategy: read the
 * unparsed REQUEST_URI rather than relying on rewrite-rule resolution.
 *
 * @return string Empty string when not a PWA endpoint, otherwise one
 *                of `'manifest'` | `'sw'`.
 */
function openstation_pwa_endpoint_kind() {
	$uri = isset( $_SERVER['REQUEST_URI'] ) ? wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
	if ( ! is_string( $uri ) || '' === $uri ) {
		return '';
	}
	$path = (string) wp_parse_url( $uri, PHP_URL_PATH );
	if ( '' === $path ) {
		return '';
	}
	$home_path = wp_parse_url( home_url( '/' ), PHP_URL_PATH );
	$home_path = is_string( $home_path ) ? rtrim( $home_path, '/' ) : '';
	$portal    = $home_path . '/' . trim( OPENSTATION_PORTAL_PATH, '/' ) . '/';
	if ( $path === $portal . OPENSTATION_PWA_MANIFEST_FRAGMENT ) {
		return 'manifest';
	}
	if ( $path === $portal . OPENSTATION_PWA_SW_FRAGMENT ) {
		return 'sw';
	}
	return '';
}

/**
 * Intercepts the manifest and SW endpoints, emitting the response body.
 *
 * Hooks at the same `parse_request` priority as the portal handler so
 * we beat 404 logic but the request environment (auth state, options
 * cache, etc.) is fully bootstrapped.
 *
 * Both endpoints are intentionally **public** (no `is_user_logged_in`
 * guard). The manifest is loaded by the browser BEFORE login when a
 * user revisits the install URL; the SW is fetched by the browser
 * with no cookies on update checks. Both reveal only data already
 * surfaced by the front-end (site name, blog icon, plugin version).
 *
 * @param WP $wp Current WordPress environment instance (unused).
 */
function openstation_pwa_handle_request( $wp ) {
	unset( $wp );

	$kind = openstation_pwa_endpoint_kind();
	if ( '' === $kind ) {
		return;
	}

	if ( 'manifest' === $kind ) {
		openstation_pwa_serve_manifest();
		exit;
	}

	if ( 'sw' === $kind ) {
		openstation_pwa_serve_service_worker();
		exit;
	}
}
add_action( 'parse_request', 'openstation_pwa_handle_request' );

/**
 * Builds the manifest array, applies the `openstation_pwa_manifest`
 * filter, encodes as JSON and prints it.
 */
function openstation_pwa_serve_manifest() {
	$manifest = openstation_pwa_build_manifest();

	/**
	 * Filters the web-app manifest payload before encoding.
	 *
	 * Common edits: replace the icon list with site-specific artwork,
	 * add `shortcuts` so the OS-level app menu offers
	 * deep-link entries, change `display` to `'fullscreen'`. Returning
	 * a non-array silently disables the manifest — no PHP warning, but
	 * the browser will fail the install criterion.
	 *
	 * @param array $manifest Manifest associative array.
	 */
	$manifest = apply_filters( 'openstation_pwa_manifest', $manifest );

	if ( ! is_array( $manifest ) ) {
		status_header( 500 );
		return;
	}

	header( 'Content-Type: application/manifest+json; charset=utf-8' );
	// 5-minute browser cache so a site-icon swap propagates quickly,
	// but the network isn't hit on every shell load.
	header( 'Cache-Control: public, max-age=300' );
	echo wp_json_encode( $manifest, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
}

/**
 * Assembles the default manifest fields.
 *
 * @return array
 */
function openstation_pwa_build_manifest() {
	$site_name = get_bloginfo( 'name' );
	if ( '' === $site_name ) {
		$site_name = 'WordPress';
	}
	$short_name = wp_html_excerpt( $site_name, 12, '' );
	if ( '' === $short_name ) {
		$short_name = $site_name;
	}

	// `start_url` is the actual landing URL after the `/openstation/`
	// portal redirect — pointing the PWA directly at it lets us narrow
	// `scope` to `/wp-admin/` without breaking the launch path. The
	// portal redirect still exists for typed / bookmarked
	// `/openstation/` visits in regular browser tabs.
	//
	// `scope` is `/wp-admin/`, not `/`. The wider `/` scope had two
	// failure modes that this fixes:
	//
	//   - Front-end URLs (e.g. `/2026/05/post-123/`) were considered
	//     in-scope, so Chrome's "Open in app" link-capturing redirected
	//     external-link clicks (Comments "In response to" column, etc.)
	//     into the installed PWA window instead of opening a real
	//     browser tab. Excluding the front-end from scope makes those
	//     clicks open in a browser tab as users expect.
	//   - Every same-origin `<a target="_blank">` from inside the PWA
	//     opened a NEW standalone PWA window for the same reason. With
	//     scope narrowed, only `/wp-admin/*` links capture into the
	//     PWA; everything else escapes to the system browser.
	//
	// `id` is held at the previous `/openstation/` value so existing
	// installs aren't treated as a different app and reset by Chrome
	// after this change ships.
	$start_url = admin_url( 'index.php?desktop_mode_portal=1' );
	$scope     = admin_url( '/', 'relative' );
	if ( '' === $scope ) {
		$scope = '/wp-admin/';
	}

	$manifest_url = openstation_pwa_manifest_url();

	return array(
		'name'                 => $site_name,
		'short_name'           => $short_name,
		'description'          => sprintf(
			/* translators: %s: site name */
			__( '%s — installed as a desktop app.', 'desktop-mode' ),
			$site_name
		),
		'start_url'            => $start_url,
		'scope'                => $scope,
		'id'                   => openstation_portal_url(),
		'display'              => 'standalone',
		'display_override'     => array( 'standalone', 'minimal-ui' ),
		'orientation'          => 'any',
		// Match the shell's default surface colour. Filter to override
		// per-site without redefining the whole manifest.
		'theme_color'          => '#1d2327',
		'background_color'     => '#1d2327',
		'lang'                 => get_bloginfo( 'language' ),
		'dir'                  => is_rtl() ? 'rtl' : 'ltr',
		'icons'                => openstation_pwa_default_icons(),
		// Self-reference under `related_applications` so
		// `navigator.getInstalledRelatedApps()` (Chrome / Edge) returns
		// a hit when this PWA is installed in the current profile.
		// `prefer_related_applications: false` keeps the install prompt
		// pointed at this site itself (not redirected to a related
		// native app). Without these two fields, a regular browser tab
		// has no way to detect "already installed in this profile" —
		// `display-mode: standalone` is only true inside the PWA
		// window. The detection is what powers the dock-tile click
		// handler's "X is already installed" toast.
		'related_applications' => array(
			array(
				'platform' => 'webapp',
				'url'      => $manifest_url,
				'id'       => openstation_portal_url(),
			),
		),
		'prefer_related_applications' => false,
	);
}

/**
 * Resolves the default icon set.
 *
 * Priority:
 *   1. WordPress Site Icon (`Settings → General → Site Icon`) — yields
 *      multiple PNG sizes via `get_site_icon_url()`. Authoritative
 *      when the operator has uploaded a brand mark for their site.
 *   2. Plugin-bundled icons under `assets/pwa/` — the official
 *      openstation brand mark (the same artwork shown on the
 *      WordPress.org plugin directory listing). Sizes 128 / 192 /
 *      256 / 512 cover everything from notification badges to splash
 *      screens.
 *
 * Purpose is `'any'` rather than `'any maskable'` — the brand icon
 * has rounded corners + transparent padding that Android's adaptive
 * mask would crop into. Plugins shipping a full-bleed maskable
 * variant should replace the array via `openstation_pwa_manifest`.
 *
 * @return array<int, array<string, string>>
 */
function openstation_pwa_default_icons() {
	$icons = array();

	$site_icon_id = (int) get_option( 'site_icon' );
	if ( $site_icon_id > 0 ) {
		// `get_site_icon_url()` resolves to a registered intermediate
		// size. List the canonical PWA sizes (192/512) explicitly so
		// Chrome's installability heuristic finds an entry whose
		// `sizes` field matches the returned image.
		foreach ( array( 192, 512 ) as $size ) {
			$url = get_site_icon_url( $size );
			if ( is_string( $url ) && '' !== $url ) {
				$icons[] = array(
					'src'     => $url,
					'sizes'   => $size . 'x' . $size,
					'type'    => 'image/png',
					'purpose' => 'any',
				);
			}
		}
	}

	if ( empty( $icons ) ) {
		foreach ( array( 128, 192, 256, 512 ) as $size ) {
			$icons[] = array(
				'src'     => OPENSTATION_URL . "assets/pwa/icon-{$size}.png",
				'sizes'   => "{$size}x{$size}",
				'type'    => 'image/png',
				'purpose' => 'any',
			);
		}
	}

	return $icons;
}

/**
 * Serves the service-worker bundle.
 *
 * Reads the built `assets/js/sw[.min].js` from disk and streams it back
 * with the headers a SW needs to be valid:
 *
 *   - `Content-Type: application/javascript`
 *   - `Service-Worker-Allowed: /` — required for `/`-scoped registration
 *     when the script itself is served from `/openstation/`. Without
 *     this header the browser rejects the `register()` call with
 *     `SecurityError: The path of the provided scope ('/') is not
 *     under the max scope allowed`.
 *   - `Cache-Control: no-cache, must-revalidate` — the browser already
 *     re-checks SW scripts on a 24h cycle, but caching the response
 *     defeats the immediate-update guarantee.
 *
 * Falls back to a 503 + log entry when the file is missing (a deploy
 * that didn't run `npm run build`). Logging gives the operator a
 * concrete pointer; 503 (vs. 404) tells the browser the SW genuinely
 * isn't available right now and it should retry later.
 */
function openstation_pwa_serve_service_worker() {
	$suffix = openstation_asset_suffix();
	$path   = OPENSTATION_DIR . 'assets/js/sw' . $suffix . '.js';

	if ( ! file_exists( $path ) ) {
		// Guard against hosts that disable error_log() via the
		// `disable_functions` ini directive.
		if ( function_exists( 'error_log' ) ) {
			error_log( '[openstation] service worker bundle missing at ' . $path . ' — run `npm run build` to generate it.' ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		}
		status_header( 503 );
		header( 'Cache-Control: no-cache, must-revalidate' );
		return;
	}

	$body = file_get_contents( $path ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
	if ( false === $body ) {
		status_header( 503 );
		return;
	}

	header( 'Content-Type: application/javascript; charset=utf-8' );
	header( 'Service-Worker-Allowed: /' );
	header( 'Cache-Control: no-cache, must-revalidate' );
	header( 'X-Content-Type-Options: nosniff' );

	// Stamp the SW with a CONTENT HASH so the browser's byte-equality
	// check on update notices a *real* change.
	//
	// Earlier versions stamped with the file's `filemtime()`. Problem:
	// `npm run build` rewrites `sw.min.js` on every run, bumping its
	// mtime even when the SW source is byte-identical. Each rebuild
	// produced a different stamp → different SW response → browser
	// installed a "new" SW → `controllerchange` fired → the
	// `bindControllerChangeReload` hook in `src/pwa/sw-register.ts`
	// auto-reloaded the page. The user observed a "phantom reload"
	// 2–3s after every `npm run build`, even when only an unrelated
	// bundle (e.g. `desktop.min.js`) had changed.
	//
	// A content hash collapses identical bodies onto identical stamps
	// — only a *real* change in `src/pwa/sw.ts` triggers the SW
	// update / reload pipeline. `md5` is plenty for an integrity
	// stamp here (no security implications) and short enough that the
	// inline comment stays under one line.
	$stamp = substr( md5( $body ), 0, 16 );
	printf( "/* openstation SW build: %s */\n", esc_html( $stamp ) );
	// `$body` is the SW JavaScript bundle read off disk — escaping
	// would corrupt the script. Suppress the sniff with the standard
	// `--` separator (an em-dash silently fails to satisfy phpcs).
	// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- JS bytes from disk.
	echo $body;
}

/**
 * Emits the `<link rel="manifest">` tag and the matching theme-color
 * meta into the admin `<head>` — only when openstation is the active
 * surface for this request (no chromeless iframes, no classic admin).
 *
 * Without these tags the browser never discovers the manifest and the
 * "install" criterion silently fails. Putting them in `<head>` (rather
 * than via `wp_localize_script`'s inline script tag) is what the
 * spec requires.
 */
function openstation_pwa_render_head_tags() {
	if ( ! is_admin() || ! is_user_logged_in() ) {
		return;
	}
	if ( openstation_is_chromeless_request() ) {
		return;
	}
	if ( ! openstation_is_enabled() || openstation_is_classic_request() ) {
		return;
	}

	printf(
		'<link rel="manifest" href="%s">' . "\n",
		esc_url( openstation_pwa_manifest_url() )
	);
	echo '<meta name="theme-color" content="#1d2327">' . "\n";
	// `mobile-web-app-capable` is the cross-browser standard;
	// `apple-mobile-web-app-capable` is the legacy iOS-only spelling
	// (still required by older Safari versions). Chromium logs a
	// deprecation warning if only the apple-prefixed form is present.
	// We emit both so iOS keeps treating the home-screen shortcut as
	// a standalone app while Chromium stops the warning.
	echo '<meta name="mobile-web-app-capable" content="yes">' . "\n";
	echo '<meta name="apple-mobile-web-app-capable" content="yes">' . "\n";
	echo '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">' . "\n";
	printf(
		'<meta name="apple-mobile-web-app-title" content="%s">' . "\n",
		esc_attr( get_bloginfo( 'name' ) )
	);
}
add_action( 'admin_head', 'openstation_pwa_render_head_tags', 1 );

/**
 * Reads the per-user PWA UI state.
 *
 * @param int $user_id Defaults to current user.
 * @return array{installHintDismissed: bool, notificationsEnabled: bool}
 */
function openstation_pwa_get_user_state( $user_id = 0 ) {
	if ( 0 === $user_id ) {
		$user_id = get_current_user_id();
	}
	$raw = get_user_meta( $user_id, OPENSTATION_PWA_USER_META, true );
	if ( ! is_array( $raw ) ) {
		$raw = array();
	}
	return array(
		'installHintDismissed' => ! empty( $raw['installHintDismissed'] ),
		'notificationsEnabled' => ! empty( $raw['notificationsEnabled'] ),
	);
}

/**
 * Writes the per-user PWA UI state, merging with the existing blob so
 * partial updates from the JS side don't wipe other keys.
 *
 * @param array $patch   Partial state to merge.
 * @param int   $user_id Defaults to current user.
 */
function openstation_pwa_update_user_state( array $patch, $user_id = 0 ) {
	if ( 0 === $user_id ) {
		$user_id = get_current_user_id();
	}
	$current = openstation_pwa_get_user_state( $user_id );
	$next    = array_merge( $current, $patch );
	update_user_meta( $user_id, OPENSTATION_PWA_USER_META, $next );
}

/**
 * Registers the `/desktop-mode/v1/pwa-state` REST routes.
 */
function openstation_pwa_register_rest_routes() {
	register_rest_route(
		'desktop-mode/v1',
		'/pwa-state',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => 'openstation_pwa_rest_get_state',
				'permission_callback' => 'openstation_pwa_rest_permission',
			),
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => 'openstation_pwa_rest_post_state',
				'permission_callback' => 'openstation_pwa_rest_permission',
				'args'                => array(
					'installHintDismissed' => array(
						'type'     => 'boolean',
						'required' => false,
					),
					'notificationsEnabled' => array(
						'type'     => 'boolean',
						'required' => false,
					),
				),
			),
		)
	);

	// Future: register POST /pwa-push-subscription here when phase 4
	// lands. The state route is intentionally orthogonal so the v1
	// surface stays stable when push arrives.
}
add_action( 'rest_api_init', 'openstation_pwa_register_rest_routes' );

/**
 * REST permission gate — same shape as the session routes: logged in
 * with OpenStation enabled. See
 * {@see openstation_rest_require_enabled()}.
 *
 * @return true|WP_Error
 */
function openstation_pwa_rest_permission() {
	return openstation_rest_require_enabled();
}

/**
 * GET handler — returns the current user's PWA state.
 */
function openstation_pwa_rest_get_state() {
	return rest_ensure_response( openstation_pwa_get_user_state() );
}

/**
 * POST handler — merges the supplied keys into the user's state.
 *
 * @param WP_REST_Request $request REST request.
 */
function openstation_pwa_rest_post_state( $request ) {
	$patch = array();
	if ( null !== $request->get_param( 'installHintDismissed' ) ) {
		$patch['installHintDismissed'] = (bool) $request->get_param( 'installHintDismissed' );
	}
	if ( null !== $request->get_param( 'notificationsEnabled' ) ) {
		$patch['notificationsEnabled'] = (bool) $request->get_param( 'notificationsEnabled' );
	}
	if ( ! empty( $patch ) ) {
		openstation_pwa_update_user_state( $patch );
	}
	return rest_ensure_response( openstation_pwa_get_user_state() );
}
