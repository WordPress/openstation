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
const OPENSTATION_PORTAL_PATH = 'openstation';

/**
 * The pre-rebrand portal path, still accepted.
 *
 * The portal was reachable at `/desktop-mode/` before the rename, and
 * that address is the kind of thing people bookmark or pin. It is not
 * canonical: {@see openstation_portal_url()} always emits the current
 * path, and a visit here forwards into wp-admin exactly as the canonical
 * path does, so the address bar self-corrects on the next hop.
 *
 * The VALUE keeps its pre-rebrand spelling on purpose: it is a
 * persisted or externally-visible identifier, so renaming it would
 * orphan data already written by live installs (or break a live
 * URL). The mismatch between this constant's name and its value is
 * deliberate — it is NOT a half-finished rename.
 */
const OPENSTATION_PORTAL_PATH_LEGACY = 'desktop-mode';

/**
 * Query var the admin shell reads to know it was entered via the portal.
 *
 * The VALUE keeps its pre-rebrand spelling on purpose: it is a
 * persisted or externally-visible identifier, so renaming it would
 * orphan data already written by live installs (or break a live
 * URL). The mismatch between this constant's name and its value is
 * deliberate — it is NOT a half-finished rename.
 */
const OPENSTATION_PORTAL_FLAG = 'desktop_mode_portal';

/**
 * Query var set on portal redirects whose landing page came from an
 * explicit `?target=…` URL the user (or a redirect chain originating
 * from a click) provided — as opposed to the portal picking the
 * session's focused window or the default-window fallback.
 *
 * The shell uses this to distinguish "user expressed navigation intent
 * toward this URL" (open it) from "portal had to forward somewhere"
 * (don't disturb the restored session).
 *
 * The VALUE keeps its pre-rebrand spelling on purpose: it is a
 * persisted or externally-visible identifier, so renaming it would
 * orphan data already written by live installs (or break a live
 * URL). The mismatch between this constant's name and its value is
 * deliberate — it is NOT a half-finished rename.
 */
const OPENSTATION_PORTAL_INTENT_FLAG = 'desktop_mode_portal_intent';

/**
 * Query var set by the window-title-bar "Detach" action. Tells the
 * admin_init redirect to skip portal forwarding for this request so the
 * user can view the page as classic wp-admin in a new tab even when
 * OpenStation is globally enabled for their account.
 *
 * The VALUE keeps its pre-rebrand spelling on purpose: it is a
 * persisted or externally-visible identifier, so renaming it would
 * orphan data already written by live installs (or break a live
 * URL). The mismatch between this constant's name and its value is
 * deliberate — it is NOT a half-finished rename.
 */
const OPENSTATION_CLASSIC_FLAG = 'desktop_mode_classic';

/**
 * Returns the canonical portal URL, e.g. `https://example.com/openstation/`.
 *
 * @return string
 */
function openstation_portal_url() {
	return home_url( '/' . OPENSTATION_PORTAL_PATH . '/' );
}

/**
 * Intercepts requests to `/openstation` and forwards them into the admin.
 *
 * Hooks on `parse_request` — early enough to pre-empt 404 handling but
 * late enough that `is_user_logged_in()` is reliable.
 *
 * @param WP $wp Current WordPress environment instance.
 */
function openstation_handle_portal_request( $wp ) {
	unset( $wp );

	if ( ! openstation_is_portal_request() ) {
		return;
	}

	// Logged-out: bounce through login, returning to the portal URL.
	if ( ! is_user_logged_in() ) {
		wp_safe_redirect( wp_login_url( openstation_portal_url() ) );
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
	$auto_enable = apply_filters( 'openstation_portal_auto_enable', true, $user_id );

	// CSRF guard: only flip user-meta when the request is a same-origin
	// top-level navigation. The portal is a GET URL by design (users
	// follow shared `/openstation/` links), so we can't require a nonce
	// — but we can require that the navigation originated from the
	// same site (or a typed/bookmarked URL with no Referer/Sec-Fetch-
	// Site). Off-origin hits still redirect into admin so shared
	// links keep working; they just don't silently mutate user-meta.
	if ( $auto_enable && openstation_portal_is_same_origin_navigation() && '1' !== get_user_meta( $user_id, 'desktop_mode_mode', true ) ) {
		update_user_meta( $user_id, 'desktop_mode_mode', '1' );
	}

	// Pick the landing page. Priority:
	// 1. Explicit `target` query arg, if same-origin wp-admin URL.
	// This is how `openstation_redirect_plain_admin_to_portal` preserves
	// the user's navigation intent when they follow a link to a
	// specific admin page (e.g. profile.php).
	// 2. Last-focused window from the saved session.
	// 3. Dashboard fallback.
	$target     = '';
	$has_intent = false;
	if ( ! empty( $_GET['target'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		// `esc_url_raw`, NOT `sanitize_text_field`: the latter strips
		// every `%XX` percent-encoded sequence from its input as an XSS
		// safeguard, which mangles request URIs that legitimately carry
		// encoded slashes (e.g. `plugin=dir%2Ffile.php`). The downstream
		// `openstation_sanitize_portal_target` validates the URL
		// rigorously (scheme rejection, traversal rejection, and a
		// hardcoded allowlist of canonical wp-admin filenames — see
		// `openstation_admin_target_allowlist()`) so we don't lose
		// any real safety by skipping `sanitize_text_field` here.
		$target = openstation_sanitize_portal_target( esc_url_raw( wp_unslash( $_GET['target'] ) ) ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		if ( '' !== $target ) {
			$has_intent = true;
		}
	}
	if ( '' === $target ) {
		$target = openstation_portal_entry_url( $user_id );
	}

	// Flag the forward so the shell can stamp the address bar back to
	// /openstation/ via history.replaceState once it has loaded.
	$target = add_query_arg( OPENSTATION_PORTAL_FLAG, '1', $target );

	// Second flag: the redirect resolved from an explicit `target`, so
	// the shell should treat the resulting `currentPage` as user
	// intent and auto-open it on top of the restored session. Without
	// this, a bare `/openstation/` visit and a portal-redirected
	// admin-bar click would be indistinguishable downstream.
	if ( $has_intent ) {
		$target = add_query_arg( OPENSTATION_PORTAL_INTENT_FLAG, '1', $target );
	}

	wp_safe_redirect( $target );
	exit;
}
add_action( 'parse_request', 'openstation_handle_portal_request' );

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
function openstation_portal_is_same_origin_navigation() {
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
 * `/openstation` relative to the site's home path. The pre-rebrand
 * `/desktop-mode` path is accepted too, so bookmarks made before the
 * rename still land in the shell.
 *
 * @return bool
 */
function openstation_is_portal_request() {
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

	$path = '/' . ltrim( rtrim( $path, '/' ), '/' );

	return in_array(
		$path,
		array(
			$home_path . '/' . OPENSTATION_PORTAL_PATH,
			$home_path . '/' . OPENSTATION_PORTAL_PATH_LEGACY,
		),
		true
	);
}

/**
 * Forwards plain `/wp-admin/...` requests to the `/openstation/` portal
 * when the portal would land the user somewhere other than here.
 *
 * Why: the portal honors the saved session's focused window, so a user
 * who follows a link the portal can't resolve — a network-admin URL, a
 * path outside the wp-admin allowlist — is better off on their restored
 * desktop than on a page the shell can't place.
 *
 * Why NOT unconditionally: for the ordinary case the forward is a round
 * trip to nowhere. The portal resolves `?target=` straight back to the
 * URL we are already serving and redirects here with
 * `desktop_mode_portal=1&desktop_mode_portal_intent=1` — a flag pair
 * every consumer reads as `fromPortal && ! fromPortalIntent`, i.e. as
 * indistinguishable from no flags at all. Two full WordPress bootstraps
 * bought nothing. The shell does not need the portal to reach it: it
 * enqueues on any admin page where {@see openstation_is_enabled()}, and
 * the address bar is deliberately no longer normalized to
 * `/openstation/` (see the `history.replaceState` note in
 * `src/desktop.ts` — the round trip is exactly what made reloads flash).
 * So {@see openstation_portal_forward_is_redundant()} answers the
 * portal's question locally and we render in place when the answer is
 * "right here."
 *
 * Narrowly scoped to bail on every automated or sub-request entry point
 * — AJAX, REST, cron, admin-post.php, non-GET methods — so the hook
 * can't corrupt a form submission or break an API call.
 *
 * Disable via the `openstation_admin_redirect_to_portal` filter (return
 * false). Passthrough kicks in automatically when the current request
 * is chromeless or already carries the portal flag.
 */
function openstation_redirect_plain_admin_to_portal() {
	if ( ! openstation_is_enabled() ) {
		return;
	}
	if ( openstation_is_chromeless_request() ) {
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
	if ( ! empty( $_GET[ OPENSTATION_PORTAL_FLAG ] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		return;
	}

	// The "Detach to new tab" button tags its URL with this flag so the
	// user can view one admin page classically without disabling desktop
	// mode account-wide. Only affects the single request — subsequent
	// navigations inside the tab lose the flag and follow normal rules.
	if ( ! empty( $_GET[ OPENSTATION_CLASSIC_FLAG ] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
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
	$redirect = apply_filters( 'openstation_admin_redirect_to_portal', true, get_current_user_id() );
	if ( ! $redirect ) {
		return;
	}

	// `esc_url_raw` instead of `sanitize_text_field`: the latter strips
	// every `%XX` percent-encoded sequence, which corrupts URIs whose
	// query string legitimately carries an encoded slash — e.g. WP's
	// own `plugins.php?action=activate&plugin=dir%2Ffile.php` activate
	// link. The portal handler will validate this target downstream.
	$target = isset( $_SERVER['REQUEST_URI'] ) ? esc_url_raw( wp_unslash( $_SERVER['REQUEST_URI'] ) ) : '';
	$target = is_string( $target ) ? $target : '';

	if ( openstation_portal_forward_is_redundant( $target ) ) {
		/**
		 * Filters whether to skip a portal forward that would resolve
		 * back to the URL already being served.
		 *
		 * Default: true — the forward costs two extra WordPress
		 * bootstraps and lands on the same page with flags the shell
		 * reads as a no-op. Return false to force the round trip, e.g.
		 * for a plugin that hooks `openstation_handle_portal_request`
		 * for its own side effects and needs it to run on every admin
		 * entry.
		 *
		 * @param bool   $skip        Whether to skip the redundant forward.
		 * @param string $request_uri The current request URI.
		 */
		if ( apply_filters( 'openstation_skip_redundant_portal_forward', true, $target ) ) {
			return;
		}
	}

	// Preserve the original target on the portal redirect. Without this,
	// navigating to a specific admin page (profile.php, plugins.php, any
	// deep link) loses the user's intent — the portal would forward them
	// to whichever window was last focused instead of the page they asked
	// for. The portal handler reads `target`, validates it's same-origin
	// wp-admin, and uses it as the entry URL.
	$portal_url = openstation_portal_url();
	if ( '' !== $target ) {
		$portal_url = add_query_arg( 'target', rawurlencode( $target ), $portal_url );
	}

	wp_safe_redirect( $portal_url );
	exit;
}
add_action( 'admin_init', 'openstation_redirect_plain_admin_to_portal' );

/**
 * Whether forwarding this request through `/openstation/` would land
 * the user straight back on the URL already being served.
 *
 * Answers locally, and without the HTTP round trip, the same question
 * {@see openstation_handle_portal_request()} answers after two full
 * WordPress bootstraps. True means the forward is pure overhead and the
 * caller should render in place instead.
 *
 * Deliberately conservative: every "don't know" answers false, so the
 * forward survives wherever the portal might genuinely choose a
 * different destination.
 *
 *   1. The path must resolve through the same wp-admin allowlist the
 *      portal validates `?target=` against. Anything that list rejects
 *      — a `network/` or `user/` sub-path on multisite, a filename that
 *      isn't canonical wp-admin — makes the portal fall back to the
 *      session's focused window, which is a real change of destination.
 *   2. The resolved filename must be the file this request is actually
 *      serving. If `$pagenow` disagrees with the URL path then a
 *      rewrite is in play and we can't claim to know what renders here.
 *   3. The query must survive intact. The portal drops
 *      `openstation_chromeless`, both portal flags and `target` from
 *      the URL it rebuilds, so a request carrying any of them comes
 *      back as a different URL.
 *
 * @param string $request_uri The current request URI, unslashed.
 * @return bool True when the portal would resolve this URL to itself.
 */
function openstation_portal_forward_is_redundant( $request_uri ) {
	global $pagenow;

	if ( ! is_string( $request_uri ) || '' === $request_uri ) {
		return false;
	}

	$path = wp_parse_url( $request_uri, PHP_URL_PATH );
	if ( ! is_string( $path ) || '' === $path ) {
		return false;
	}

	$admin_path = wp_parse_url( admin_url(), PHP_URL_PATH );
	$admin_path = is_string( $admin_path ) ? $admin_path : '/wp-admin/';
	if ( 0 !== strpos( $path, $admin_path ) ) {
		return false;
	}

	$file = ltrim( (string) substr( $path, strlen( $admin_path ) ), '/' );
	if ( '' === $file ) {
		$file = 'index.php';
	}

	// 1. The portal's allowlist has to accept it.
	if ( is_wp_error( openstation_resolve_admin_target( $file ) ) ) {
		return false;
	}

	// 2. …and it has to be the page we are actually serving.
	if ( ! is_string( $pagenow ) || strtolower( $file ) !== strtolower( $pagenow ) ) {
		return false;
	}

	// 3. …carrying a query the portal would hand back unchanged.
	$rewritten = array(
		'openstation_chromeless',
		OPENSTATION_PORTAL_FLAG,
		OPENSTATION_PORTAL_INTENT_FLAG,
		'target',
	);
	foreach ( $rewritten as $key ) {
		if ( isset( $_GET[ $key ] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			return false;
		}
	}

	return true;
}

/**
 * Resolves the admin URL the portal should forward to for a given user.
 *
 * Looks up the user's session and returns the URL of the window flagged
 * as `focused`. If the session is empty, has no focused window, or the
 * focused window's URL isn't same-origin admin, falls back to the
 * dashboard.
 *
 * The portal navigates the TOP window, not an iframe, so any chromeless
 * `openstation_chromeless=1` flag baked into the stored URL is stripped — a leftover
 * flag would land the user in a standalone chromeless page (no admin
 * bar, no toggle, no way out) instead of the shell.
 *
 * @param int $user_id The user whose session to consult.
 * @return string The admin URL to redirect to.
 */
function openstation_portal_entry_url( $user_id ) {
	$session = openstation_get_session( $user_id );

	// User's configured default-window preference. When disabled, we
	// still have to forward SOMEWHERE (the portal is an HTTP redirect),
	// so we land on the Dashboard URL — but the shell detects the
	// `enabled=false` state via the config and skips the auto-open,
	// leaving the user with an empty desktop as they chose.
	$default_window = openstation_get_default_window( $user_id );
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
		if ( ! openstation_url_is_same_admin( $win['url'] ) ) {
			return $fallback;
		}
		return remove_query_arg( array( 'openstation_chromeless', OPENSTATION_PORTAL_FLAG ), $win['url'] );
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
 * Strips `openstation_chromeless` and the portal flag from the query so the target
 * doesn't chain us into a chromeless standalone load or an infinite
 * redirect loop.
 *
 * @param string $raw Raw value from `$_GET['target']` (already unslashed).
 * @return string A safe absolute admin URL, or '' if the input is invalid.
 */
function openstation_sanitize_portal_target( $raw ) {
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
	// filenames (see `openstation_admin_target_allowlist()`). A
	// regex alone would accept a plausible-looking filename that
	// isn't a real core admin page (e.g. `custom_admin_page.php`)
	// and effectively become an open redirect to a 404 page served
	// under the admin path; the explicit allowlist closes that.
	$target = openstation_resolve_admin_target( $file );
	if ( is_wp_error( $target ) ) {
		return '';
	}

	if ( is_string( $query ) && '' !== $query ) {
		parse_str( $query, $args );
		unset( $args['openstation_chromeless'], $args[ OPENSTATION_PORTAL_FLAG ], $args[ OPENSTATION_PORTAL_INTENT_FLAG ], $args['target'] );
		if ( ! empty( $args ) ) {
			$target = add_query_arg( $args, $target );
		}
	}

	return $target;
}
