<?php
/**
 * OpenStation — `/openstation` Portal Entry Point.
 *
 * Registers `/openstation` as a shareable URL that behaves like the
 * front door of the desktop UI:
 *   1. Logged-out users are bounced through `wp-login.php` with a
 *      redirect back to `/openstation/`.
 *   2. Logged-in users with basic admin-read capability have the
 *      `desktop_mode_mode` user-meta toggle auto-enabled on first visit,
 *      then are forwarded into `wp-admin` at whichever window was
 *      last focused in their saved session (or the dashboard as
 *      fallback).
 *
 * The URL is served virtually (no rewrite rules, no `.htaccess`
 * surgery) by intercepting `parse_request` before WordPress routes the
 * URL to 404. This keeps the plugin drop-in.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/** The URL path that triggers the portal handler. */
const OPEN_STATION_PORTAL_PATH = 'openstation';

/** Query var the admin shell reads to know it was entered via the portal. */
const OPEN_STATION_PORTAL_FLAG = 'desktop_mode_portal';

/**
 * Query var set on portal redirects whose landing page came from an
 * explicit `?target=…` URL the user (or a redirect chain originating
 * from a click) provided — as opposed to the portal picking the
 * session's focused window or the default-window fallback.
 *
 * The shell uses this to distinguish "user expressed navigation intent
 * toward this URL" (open it) from "portal had to forward somewhere"
 * (don't disturb the restored session).
 */
const OPEN_STATION_PORTAL_INTENT_FLAG = 'desktop_mode_portal_intent';

/**
 * Query var set by the window-title-bar "Detach" action. Tells the
 * admin_init redirect to skip portal forwarding for this request so the
 * user can view the page as classic wp-admin in a new tab even when
 * OpenStation is globally enabled for their account.
 */
const OPEN_STATION_CLASSIC_FLAG = 'desktop_mode_classic';

/**
 * Returns the canonical portal URL, e.g. `https://example.com/desktop-mode/`.
 *
 * @return string
 */
function open_station_portal_url() {
	return home_url( '/' . OPEN_STATION_PORTAL_PATH . '/' );
}

/**
 * Intercepts requests to `/openstation` and forwards them into the admin.
 *
 * Hooks on `parse_request` — early enough to pre-empt 404 handling but
 * late enough that `is_user_logged_in()` is reliable.
 *
 * @param WP $wp Current WordPress environment instance.
 */
function open_station_handle_portal_request( $wp ) {
	unset( $wp );

	if ( ! open_station_is_portal_request() ) {
		return;
	}

	// Logged-out: bounce through login, returning to the portal URL.
	if ( ! is_user_logged_in() ) {
		wp_safe_redirect( wp_login_url( open_station_portal_url() ) );
		exit;
	}

	// Require basic admin-read capability so subscribers of sites that
	// blocked `read` from admin don't land in a broken window.
	if ( ! current_user_can( 'read' ) ) {
		wp_die(
			esc_html__( 'Sorry, you are not allowed to access the WordPress desktop.', 'desktop-mode' ),
			'',
			array( 'response' => 403 )
		);
	}

	$user_id = get_current_user_id();

	/**
	 * Filters whether visiting the `/openstation` portal should auto-enable
	 * OpenStation for the current user.
	 *
	 * Default: true — the portal is an explicit opt-in action, so flipping
	 * the user meta mirrors the intent of visiting the URL.
	 *
	 * @param bool $auto_enable Whether to auto-enable OpenStation.
	 * @param int  $user_id     The current user's ID.
	 */
	$auto_enable = apply_filters( 'open_station_portal_auto_enable', true, $user_id );

	// CSRF guard: only flip user-meta when the request is a same-origin
	// top-level navigation. The portal is a GET URL by design (users
	// follow shared `/openstation/` links), so we can't require a nonce
	// — but we can require that the navigation originated from the
	// same site (or a typed/bookmarked URL with no Referer/Sec-Fetch-
	// Site). Off-origin hits still redirect into admin so shared
	// links keep working; they just don't silently mutate user-meta.
	if ( $auto_enable && open_station_portal_is_same_origin_navigation() && '1' !== get_user_meta( $user_id, 'desktop_mode_mode', true ) ) {
		update_user_meta( $user_id, 'desktop_mode_mode', '1' );
	}

	// Pick the landing page. Priority:
	//   1. Explicit `target` query arg, if same-origin wp-admin URL.
	//      This is how `open_station_redirect_plain_admin_to_portal` preserves
	//      the user's navigation intent when they follow a link to a
	//      specific admin page (e.g. profile.php).
	//   2. Last-focused window from the saved session.
	//   3. Dashboard fallback.
	$target      = '';
	$has_intent  = false;
	if ( ! empty( $_GET['target'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		// `esc_url_raw`, NOT `sanitize_text_field`: the latter strips
		// every `%XX` percent-encoded sequence from its input as an XSS
		// safeguard, which mangles request URIs that legitimately carry
		// encoded slashes (e.g. `plugin=dir%2Ffile.php`). The downstream
		// `open_station_sanitize_portal_target` validates the URL
		// rigorously (scheme rejection, traversal rejection, and a
		// hardcoded allowlist of canonical wp-admin filenames — see
		// `open_station_admin_target_allowlist()`) so we don't lose
		// any real safety by skipping `sanitize_text_field` here.
		$target = open_station_sanitize_portal_target( esc_url_raw( wp_unslash( $_GET['target'] ) ) ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		if ( '' !== $target ) {
			$has_intent = true;
		}
	}
	if ( '' === $target ) {
		$target = open_station_portal_entry_url( $user_id );
	}

	// Flag the forward so the shell can stamp the address bar back to
	// /openstation/ via history.replaceState once it has loaded.
	$target = add_query_arg( OPEN_STATION_PORTAL_FLAG, '1', $target );

	// Second flag: the redirect resolved from an explicit `target`, so
	// the shell should treat the resulting `currentPage` as user
	// intent and auto-open it on top of the restored session. Without
	// this, a bare `/openstation/` visit and a portal-redirected
	// admin-bar click would be indistinguishable downstream.
	if ( $has_intent ) {
		$target = add_query_arg( OPEN_STATION_PORTAL_INTENT_FLAG, '1', $target );
	}

	wp_safe_redirect( $target );
	exit;
}
add_action( 'parse_request', 'open_station_handle_portal_request' );

/**
 * Decides whether the current request to the portal can mutate
 * user-meta safely (same-origin) or should only redirect (cross-
 * origin, possibly CSRF).
 *
 * Logic mirrors the `Sec-Fetch-Site` heuristic browsers use:
 *
 *   - `Sec-Fetch-Site: same-origin | same-site | none` → trusted
 *     (the request originated from this site, or from a typed URL
 *     / bookmark with no referrer info).
 *   - `Sec-Fetch-Site: cross-site` → untrusted (a third-party page
 *     pointed the user at the portal — could be an `<img>` tag).
 *   - Header missing (older browsers): fall back to `Referer` —
 *     same host or empty referrer is trusted, anything else isn't.
 *
 * @return bool
 */
function open_station_portal_is_same_origin_navigation() {
	if ( ! empty( $_SERVER['HTTP_SEC_FETCH_SITE'] ) ) {
		$site = strtolower( sanitize_text_field( wp_unslash( $_SERVER['HTTP_SEC_FETCH_SITE'] ) ) );
		return in_array( $site, array( 'same-origin', 'same-site', 'none' ), true );
	}

	if ( empty( $_SERVER['HTTP_REFERER'] ) ) {
		return true;
	}

	$referer_host = wp_parse_url( esc_url_raw( wp_unslash( $_SERVER['HTTP_REFERER'] ) ), PHP_URL_HOST );
	$home_host    = wp_parse_url( home_url(), PHP_URL_HOST );

	if ( ! is_string( $referer_host ) || '' === $referer_host ) {
		return true;
	}

	return is_string( $home_host ) && strtolower( $referer_host ) === strtolower( $home_host );
}

/**
 * Detects whether the current request is for the portal URL.
 *
 * Strips any query string and trailing slash and compares against
 * `/openstation` relative to the site's home path.
 *
 * @return bool
 */
function open_station_is_portal_request() {
	if ( empty( $_SERVER['REQUEST_URI'] ) ) {
		return false;
	}

	// `esc_url_raw` instead of `sanitize_text_field` so percent-encoded
	// chars in the URI (notably `%2F` from query-arg slashes) survive
	// long enough for `wp_parse_url` to split path / query correctly.
	$uri  = esc_url_raw( wp_unslash( $_SERVER['REQUEST_URI'] ) );
	$path = wp_parse_url( $uri, PHP_URL_PATH );
	if ( ! is_string( $path ) ) {
		return false;
	}

	$home_path = wp_parse_url( home_url( '/' ), PHP_URL_PATH );
	$home_path = is_string( $home_path ) ? rtrim( $home_path, '/' ) : '';

	$expected = $home_path . '/' . OPEN_STATION_PORTAL_PATH;
	$path     = '/' . ltrim( rtrim( $path, '/' ), '/' );

	return $path === $expected;
}

/**
 * Forwards plain `/wp-admin/...` requests to the `/openstation/` portal
 * when the current user has OpenStation enabled.
 *
 * Why: when OpenStation is on, `/openstation/` is meant to be the one
 * canonical address. A user who bookmarks `/wp-admin/plugins.php` or
 * follows an old admin link should still land in the shell, not in
 * vanilla admin with the shell glued over the top. Running through the
 * portal unifies the address bar and honors the saved session's focused
 * window.
 *
 * Narrowly scoped to bail on every automated or sub-request entry point
 * — AJAX, REST, cron, admin-post.php, non-GET methods — so the hook
 * can't corrupt a form submission or break an API call.
 *
 * Disable via the `open_station_admin_redirect_to_portal` filter (return
 * false). Passthrough kicks in automatically when the current request
 * is chromeless or already carries the portal flag.
 */
function open_station_redirect_plain_admin_to_portal() {
	if ( ! open_station_is_enabled() ) {
		return;
	}
	if ( open_station_is_chromeless_request() ) {
		return;
	}
	if ( wp_doing_ajax() || wp_doing_cron() ) {
		return;
	}
	if ( defined( 'REST_REQUEST' ) && REST_REQUEST ) {
		return;
	}
	if ( ! empty( $_SERVER['REQUEST_METHOD'] ) && 'GET' !== strtoupper( sanitize_text_field( wp_unslash( $_SERVER['REQUEST_METHOD'] ) ) ) ) {
		return;
	}

	// The portal handler adds this flag after it forwards into admin.
	// Bailing here keeps us out of an infinite redirect loop.
	if ( ! empty( $_GET[ OPEN_STATION_PORTAL_FLAG ] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		return;
	}

	// The "Detach to new tab" button tags its URL with this flag so the
	// user can view one admin page classically without disabling desktop
	// mode account-wide. Only affects the single request — subsequent
	// navigations inside the tab lose the flag and follow normal rules.
	if ( ! empty( $_GET[ OPEN_STATION_CLASSIC_FLAG ] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		return;
	}

	// admin-post.php and admin-ajax.php handle form submissions and JSON
	// endpoints; redirecting them would break the call.
	global $pagenow;
	if ( in_array( $pagenow, array( 'admin-post.php', 'admin-ajax.php' ), true ) ) {
		return;
	}

	/**
	 * Filters whether plain admin URLs should redirect to the portal
	 * when OpenStation is active.
	 *
	 * @param bool $redirect Whether to redirect. Default true.
	 * @param int  $user_id  The current user's ID.
	 */
	$redirect = apply_filters( 'open_station_admin_redirect_to_portal', true, get_current_user_id() );
	if ( ! $redirect ) {
		return;
	}

	// Preserve the original target on the portal redirect. Without this,
	// navigating to a specific admin page (profile.php, plugins.php, any
	// deep link) loses the user's intent — the portal would forward them
	// to whichever window was last focused instead of the page they asked
	// for. The portal handler reads `target`, validates it's same-origin
	// wp-admin, and uses it as the entry URL.
	$portal_url = open_station_portal_url();
	// `esc_url_raw` instead of `sanitize_text_field`: the latter strips
	// every `%XX` percent-encoded sequence, which corrupts URIs whose
	// query string legitimately carries an encoded slash — e.g. WP's
	// own `plugins.php?action=activate&plugin=dir%2Ffile.php` activate
	// link. The portal handler will validate this target downstream.
	$target = isset( $_SERVER['REQUEST_URI'] ) ? esc_url_raw( wp_unslash( $_SERVER['REQUEST_URI'] ) ) : '';
	if ( is_string( $target ) && '' !== $target ) {
		$portal_url = add_query_arg( 'target', rawurlencode( $target ), $portal_url );
	}

	wp_safe_redirect( $portal_url );
	exit;
}
add_action( 'admin_init', 'open_station_redirect_plain_admin_to_portal' );

/**
 * Resolves the admin URL the portal should forward to for a given user.
 *
 * Looks up the user's session and returns the URL of the window flagged
 * as `focused`. If the session is empty, has no focused window, or the
 * focused window's URL isn't same-origin admin, falls back to the
 * dashboard.
 *
 * The portal navigates the TOP window, not an iframe, so any chromeless
 * `open_station_chromeless=1` flag baked into the stored URL is stripped — a leftover
 * flag would land the user in a standalone chromeless page (no admin
 * bar, no toggle, no way out) instead of the shell.
 *
 * @param int $user_id The user whose session to consult.
 * @return string The admin URL to redirect to.
 */
function open_station_portal_entry_url( $user_id ) {
	$session = open_station_get_session( $user_id );

	// User's configured default-window preference. When disabled, we
	// still have to forward SOMEWHERE (the portal is an HTTP redirect),
	// so we land on the Dashboard URL — but the shell detects the
	// `enabled=false` state via the config and skips the auto-open,
	// leaving the user with an empty desktop as they chose.
	$default_window = open_station_get_default_window( $user_id );
	$fallback       = $default_window['url'];

	// Native marker (e.g. "native:os-settings") is not a
	// redirectable URL. The portal MUST forward somewhere — the
	// redirect happens at HTTP level — so we land on the admin home
	// and let the shell pick up `defaultWindow.url` from the config
	// after init and call nativeWindows.openById( <slug> ).
	if ( is_string( $fallback ) && 0 === strpos( $fallback, 'native:' ) ) {
		$fallback = admin_url();
	}

	if ( empty( $session['focused'] ) || empty( $session['windows'] ) ) {
		return $fallback;
	}

	foreach ( $session['windows'] as $win ) {
		if ( ! isset( $win['id'], $win['url'] ) ) {
			continue;
		}
		if ( $win['id'] !== $session['focused'] ) {
			continue;
		}
		if ( ! open_station_url_is_same_admin( $win['url'] ) ) {
			return $fallback;
		}
		return remove_query_arg( array( 'open_station_chromeless', OPEN_STATION_PORTAL_FLAG ), $win['url'] );
	}

	return $fallback;
}

/**
 * Validates and normalizes a `target` query arg on the portal URL.
 *
 * Accepts a raw request-URI-shaped string (path + optional query, e.g.
 * `/wp-admin/profile.php?foo=bar`) and returns a fully-qualified admin
 * URL if — and only if — it resolves to a same-origin `wp-admin/` path.
 * Everything else returns an empty string so the caller falls back to
 * the saved-session entry URL.
 *
 * Strips `open_station_chromeless` and the portal flag from the query so the target
 * doesn't chain us into a chromeless standalone load or an infinite
 * redirect loop.
 *
 * @param string $raw Raw value from `$_GET['target']` (already unslashed).
 * @return string A safe absolute admin URL, or '' if the input is invalid.
 */
function open_station_sanitize_portal_target( $raw ) {
	if ( ! is_string( $raw ) || '' === $raw ) {
		return '';
	}

	// Reject URIs with a scheme or protocol-relative prefix — we only
	// accept relative paths so there's no way to redirect off-site.
	if ( preg_match( '#^([a-z][a-z0-9+.-]*:|//)#i', $raw ) ) {
		return '';
	}

	// Must be an absolute path starting with /.
	if ( '/' !== $raw[0] ) {
		return '';
	}

	$path  = wp_parse_url( $raw, PHP_URL_PATH );
	$query = wp_parse_url( $raw, PHP_URL_QUERY );
	if ( ! is_string( $path ) || '' === $path ) {
		return '';
	}

	$admin_path = wp_parse_url( admin_url(), PHP_URL_PATH );
	$admin_path = is_string( $admin_path ) ? $admin_path : '/wp-admin/';
	if ( 0 !== strpos( $path, $admin_path ) ) {
		return '';
	}

	$file = substr( $path, strlen( $admin_path ) );
	$file = ltrim( (string) $file, '/' );
	if ( '' === $file ) {
		$file = 'index.php';
	}

	// Resolve against the hardcoded allowlist of canonical wp-admin
	// filenames (see `open_station_admin_target_allowlist()`). A
	// regex alone would accept a plausible-looking filename that
	// isn't a real core admin page (e.g. `custom_admin_page.php`)
	// and effectively become an open redirect to a 404 page served
	// under the admin path; the explicit allowlist closes that.
	$target = open_station_resolve_admin_target( $file );
	if ( is_wp_error( $target ) ) {
		return '';
	}

	if ( is_string( $query ) && '' !== $query ) {
		parse_str( $query, $args );
		unset( $args['open_station_chromeless'], $args[ OPEN_STATION_PORTAL_FLAG ], $args[ OPEN_STATION_PORTAL_INTENT_FLAG ], $args['target'] );
		if ( ! empty( $args ) ) {
			$target = add_query_arg( $args, $target );
		}
	}

	return $target;
}
