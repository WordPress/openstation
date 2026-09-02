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
 *      then are forwarded to the shell screen
 *      (`admin.php?page=openstation`, see `includes/shell-screen.php`).
 *      An explicit `?target=` travels along as the page the shell opens
 *      first; without one the screen resolves the entry itself — the
 *      last-focused window of the saved session, else the default
 *      window, else the Dashboard.
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

	// Pick the page the shell opens first. An explicit `target` query
	// arg — a same-origin wp-admin URL — is how
	// `openstation_redirect_plain_admin_to_portal` preserves the user's
	// navigation intent when they follow a link to a specific admin
	// page (e.g. profile.php). Without one the shell screen resolves
	// the entry itself: the last-focused window from the saved
	// session, else the default window, else the Dashboard — see
	// `openstation_shell_boot_target()`. The bare screen URL is the
	// canonical address, and a reload of it re-resolves against the
	// live session rather than against the window that was focused
	// when the redirect happened.
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
	// `intent=1` rides along with an explicit target so the shell treats
	// the resulting `currentPage` as user intent and opens it on top of
	// the restored session. Without it, a bare `/openstation/` visit and
	// a portal-redirected admin-bar click would be indistinguishable
	// downstream.
	wp_safe_redirect( openstation_shell_url( $target, $has_intent ) );
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
 * Sends plain `/wp-admin/...` requests into the desktop.
 *
 * The shell is served by its own screen (`includes/shell-screen.php`),
 * so a plain admin page is never where the desktop renders: a user who
 * typed or bookmarked `/wp-admin/edit.php` is forwarded to the shell
 * screen with that URL as the page it opens first. Three routes out of
 * here, cheapest first:
 *
 *   1. **Straight to the shell screen** when the portal would only hand
 *      this URL back — an allowlisted wp-admin file that is also the
 *      page being served, carrying no query arg the portal would strip
 *      ({@see openstation_portal_forward_is_redundant()}). One
 *      redirect; the portal hop would have cost a WordPress bootstrap
 *      to learn what is already known. `openstation_skip_redundant_portal_forward`
 *      (return false) forces the hop back on for a plugin that hooks
 *      the portal handler for side effects.
 *   2. **Through `/openstation/?target=…`** otherwise — a network-admin
 *      URL, a path outside the wp-admin allowlist — so the portal can
 *      fall back to the saved session's focused window, which is a real
 *      change of destination the shell can't make from here.
 *   3. **The frozen-flag alias.** A URL carrying `desktop_mode_portal=1`
 *      is the desktop's pre-screen address: the portal used to forward
 *      to a real admin page tagged with it, and bookmarks, the PWA start
 *      URL and plugin-built links still say so. It goes to the shell
 *      screen with that URL as the target, and `intent=1` when the
 *      intent flag was present. The flags stay frozen (see AGENTS.md);
 *      only what they resolve to moved.
 *
 * Narrowly scoped to bail on every automated or sub-request entry point
 * — AJAX, REST, cron, admin-post.php, non-GET methods, and sub-resource
 * fetches (an `<img>`, a script or an XHR whose URL is an admin page,
 * see {@see openstation_is_subresource_request()}) — so the hook can't
 * corrupt a form submission, break an API call or hand an image tag an
 * HTML document. The shell screen itself, chromeless loads, solo boots
 * and classic-flagged requests pass through.
 *
 * Disable via the `openstation_admin_redirect_to_portal` filter (return
 * false); plain admin pages then render as classic admin and the
 * desktop lives at `/openstation/` only. The alias route runs before
 * the filter: a URL that names the desktop is not a plain admin page.
 */
function openstation_redirect_plain_admin_to_portal() {
	if ( ! openstation_is_enabled() ) {
		return;
	}
	// The screen the redirects land on. First in the chain: every other
	// branch below ends in a redirect here, and the screen is a plain
	// admin GET like any other.
	if ( openstation_is_shell_screen_request() ) {
		return;
	}
	if ( openstation_is_chromeless_request() ) {
		return;
	}
	// A solo boot renders one window in place, wherever it landed.
	if ( function_exists( 'openstation_is_solo_request' ) && openstation_is_solo_request() ) {
		return;
	}
	// The user admin (`wp-admin/user/`, multisite's dashboard for users
	// with no site role) renders classic. It has no shell screen of its
	// own, and its URLs never survive the target allowlist — before
	// this pass-through the redirect claimed the request anyway and
	// silently forwarded the user to the site desktop's default entry.
	if ( is_multisite() && is_user_admin() ) {
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
	// The browser says what it is fetching for. An <img>, a script or
	// an XHR aimed at an admin URL (Jetpack's admin-bar sparkline is
	// admin.php?page=stats&noheader&proxy&chart=…) is not a user
	// landing on a plain admin page, and forwarding it into the desktop
	// only swaps the bytes it asked for with the shell's HTML.
	if ( openstation_is_subresource_request() ) {
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

	// `esc_url_raw` instead of `sanitize_text_field`: the latter strips
	// every `%XX` percent-encoded sequence, which corrupts URIs whose
	// query string legitimately carries an encoded slash — e.g. WP's
	// own `plugins.php?action=activate&plugin=dir%2Ffile.php` activate
	// link. The shell screen validates the target on read.
	$target = isset( $_SERVER['REQUEST_URI'] ) ? esc_url_raw( wp_unslash( $_SERVER['REQUEST_URI'] ) ) : '';
	$target = is_string( $target ) ? $target : '';

	// Route 3: the frozen-flag alias. The sanitiser strips both flags
	// from the target; an unresolvable one leaves the screen to pick
	// the entry, exactly as the portal did for an invalid `target`.
	if ( ! empty( $_GET[ OPENSTATION_PORTAL_FLAG ] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$clean  = openstation_sanitize_portal_target( $target );
		$intent = '' !== $clean && ! empty( $_GET[ OPENSTATION_PORTAL_INTENT_FLAG ] ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		wp_safe_redirect( openstation_shell_url( $clean, $intent ) );
		exit;
	}

	/**
	 * Filters whether plain admin URLs should redirect into the desktop
	 * when OpenStation is active.
	 *
	 * @param bool $redirect Whether to redirect. Default true.
	 * @param int  $user_id  The current user's ID.
	 */
	$redirect = apply_filters( 'openstation_admin_redirect_to_portal', true, get_current_user_id() );
	if ( ! $redirect ) {
		return;
	}

	// Route 1: straight to the shell screen.
	if ( openstation_portal_forward_is_redundant( $target ) ) {
		/**
		 * Filters whether to skip the portal hop for a URL the portal
		 * would only hand straight back.
		 *
		 * Default: true — the request goes straight to the shell screen
		 * with this URL as its target. Return false to route through
		 * `/openstation/` anyway, e.g. for a plugin that hooks
		 * `openstation_handle_portal_request` for its own side effects
		 * and needs it to run on every admin entry.
		 *
		 * @param bool   $skip        Whether to skip the portal hop.
		 * @param string $request_uri The current request URI.
		 */
		if ( apply_filters( 'openstation_skip_redundant_portal_forward', true, $target ) ) {
			wp_safe_redirect( openstation_shell_url( openstation_sanitize_portal_target( $target ), true ) );
			exit;
		}
	}

	// Route 2: through the portal, target preserved. Without it,
	// navigating to a specific admin page (profile.php, plugins.php, any
	// deep link) loses the user's intent — the portal would forward them
	// to whichever window was last focused instead of the page they asked
	// for. The portal handler reads `target`, validates it's same-origin
	// wp-admin, and passes it on to the shell screen.
	$portal_url = openstation_portal_url();
	if ( '' !== $target ) {
		$portal_url = add_query_arg( 'target', rawurlencode( $target ), $portal_url );
	}

	wp_safe_redirect( $portal_url );
	exit;
}
add_action( 'admin_init', 'openstation_redirect_plain_admin_to_portal' );

/**
 * Whether forwarding this request through `/openstation/` would only
 * hand the URL already being served back as the shell's target.
 *
 * Answers locally, and without the HTTP round trip, the same question
 * {@see openstation_handle_portal_request()} answers after another
 * WordPress bootstrap. True means the hop is pure overhead and the
 * caller can send the user straight to the shell screen with this URL
 * as its target.
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
		// The shell must never open itself. A saved window pointing at
		// the shell screen cannot be produced by the shell, but a
		// hand-edited session could say so; treat it as nothing focused.
		if ( openstation_url_is_shell_screen( $win['url'] ) ) {
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

	// The network admin's own screens live one directory down and are
	// resolved against their own list. Without this a network URL came
	// back empty and the user was quietly forwarded to the site
	// dashboard, which is a different admin.
	$network = 0 === strpos( $file, 'network/' );
	if ( $network ) {
		$file = substr( $file, strlen( 'network/' ) );
	}

	if ( '' === $file ) {
		$file = 'index.php';
	}

	// Resolve against the hardcoded allowlist of canonical wp-admin
	// filenames (see `openstation_admin_target_allowlist()`). A
	// regex alone would accept a plausible-looking filename that
	// isn't a real core admin page (e.g. `custom_admin_page.php`)
	// and effectively become an open redirect to a 404 page served
	// under the admin path; the explicit allowlist closes that.
	$target = openstation_resolve_admin_target( $file, $network );
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

	// The shell screen is where a target is opened, never a target: the
	// shell would open itself in a window, and a redirect chain built
	// from it would loop. Fall back to the entry resolver instead.
	if ( openstation_url_is_shell_screen( $target ) ) {
		return '';
	}

	// `admin.php` is a bootstrap, not a page. Without a `page` arg core
	// falls through the last `else` in `wp-admin/admin.php`, never
	// requires `admin-header.php`, and answers 200 with an empty body —
	// so the URL becomes a window showing nothing. The allowlist above
	// matches filenames and cannot see the query, which is why the
	// check belongs here, beside the shell-screen one: both are URLs
	// that resolve but must not become a target. Returning '' hands the
	// caller back to the entry resolver (session's focused window, else
	// the default window, else the Dashboard).
	if ( openstation_url_is_page_less_admin_php( $target ) ) {
		return '';
	}

	return $target;
}
