<?php
/**
 * OpenStation — Heartbeat-driven nonce refresh.
 *
 * WordPress nonces are valid for `nonce_life` (24 hours by default).
 * The desktop shell is a long-running SPA whose per-window config
 * blobs bake `wp_create_nonce()` values into the page at render
 * time, so any session that stays open past the 24-hour mark hits
 * `rest_cookie_invalid_nonce` ("Cookie check failed") on the next
 * REST call — even though the auth cookie is still valid.
 *
 * Fix: on every Heartbeat tick, return a fresh copy of every nonce
 * action the shell cares about, keyed by action string. The client
 * subscribes via `src/nonce-refresh.ts` and rewrites the cached
 * values in place. `wp_create_nonce()` returns the same value
 * inside a single 12-hour tick window, so the actual nonce string
 * only changes when the tick rolls — well before the 24-hour hard
 * expiry catches the cached value.
 *
 * Default actions covered:
 *
 *   - `wp_rest` — the canonical REST cookie nonce. Used by every
 *      window that stashes a `restNonce` in its config blob, plus
 *      the shell-wide auto-injection in `src/inject-rest-nonce.ts`.
 *   - `desktop-mode-plugins` — admin-ajax nonce for our
 *      browse/install/upload/reviews handlers.
 *   - `updates` — Core's wp.updates nonce used by
 *      `wp_ajax_install_plugin` / `wp_ajax_update_plugin`.
 *
 * Plugin authors who need to extend the set can hook
 * `openstation_nonce_refresh_actions` and add their own nonce
 * action strings. The client side picks the new fields up
 * automatically through the same heartbeat field — feature modules
 * just need to register a target for the field they care about via
 * the JS-side `registerNonceTarget()` helper.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Heartbeat field name. Public — `src/nonce-refresh.ts` subscribes
 * to this string. Keep the value stable across versions or update
 * both ends.
 *
 * The VALUE keeps its pre-rebrand spelling on purpose: it is a
 * persisted or externally-visible identifier, so renaming it would
 * orphan data already written by live installs (or break a live
 * URL). The mismatch between this constant's name and its value is
 * deliberate — it is NOT a half-finished rename.
 */
const OPENSTATION_NONCE_REFRESH_FIELD = 'desktop_mode_nonces';

/**
 * Heartbeat field carrying the authenticated user's identity.
 * `src/auth-recovery/index.ts` compares `uid` against the shell's
 * boot-time viewer and hard-reloads when a *different* user logged
 * in through the session-expired prompt — in-place nonce refresh
 * would otherwise leave user A's desktop issuing user B's requests.
 *
 * The VALUE keeps its pre-rebrand spelling on purpose: it is a
 * persisted or externally-visible identifier, so renaming it would
 * orphan data already written by live installs (or break a live
 * URL). The mismatch between this constant's name and its value is
 * deliberate — it is NOT a half-finished rename.
 */
const OPENSTATION_AUTH_FIELD = 'desktop_mode_auth';

/**
 * Mint a fresh map of `{ action => nonce }` for every action the
 * shell needs to keep alive past `nonce_life`. The set is
 * filterable so other native windows / third-party plugins can
 * extend it; the only requirement is that the action string match
 * whatever was passed to `wp_create_nonce()` at registration.
 *
 * @return array<string,string> Map of nonce-action => current nonce value.
 */
function openstation_nonce_refresh_build_payload() {
	$actions = array(
		'wp_rest',
		'desktop-mode-plugins',
		'updates',
	);

	/**
	 * Filter the set of nonce actions refreshed on every Heartbeat tick.
	 *
	 * Each entry must be a literal nonce action string (the same value
	 * passed to `wp_create_nonce()` wherever the original was minted).
	 *
	 * @param string[] $actions Default nonce actions.
	 */
	$actions = (array) apply_filters( 'openstation_nonce_refresh_actions', $actions );

	$payload = array();
	foreach ( $actions as $action ) {
		if ( ! is_string( $action ) || '' === $action ) {
			continue;
		}
		$payload[ $action ] = wp_create_nonce( $action );
	}
	return $payload;
}

/**
 * Heartbeat handler — attach the fresh nonce map to every tick
 * from a user who has OpenStation enabled.
 *
 * Gated on `openstation_is_enabled()` (not just `is_user_logged_in()`)
 * so users on classic admin screens — editors on post-edit pages,
 * subscribers reading the front-end heartbeat — don't carry the
 * payload around. The shell's nonces only need refreshing for
 * users who actually run the shell.
 *
 * The cost is tiny when fired (three `wp_create_nonce()` calls,
 * all hot-cached inside a single request) — the gate is about
 * not shipping irrelevant data to non-shell users on every tick.
 *
 * @param array $response Heartbeat response (filter return value).
 * @param array $data     Client-sent payload. Unused here.
 * @return array
 */
function openstation_nonce_refresh_heartbeat_received( $response, $data ) {
	unset( $data );
	if ( ! is_array( $response ) ) {
		$response = array();
	}
	if ( ! function_exists( 'openstation_is_enabled' ) || ! openstation_is_enabled() ) {
		return $response;
	}
	$response[ OPENSTATION_NONCE_REFRESH_FIELD ] = openstation_nonce_refresh_build_payload();
	$response[ OPENSTATION_AUTH_FIELD ]          = array( 'uid' => get_current_user_id() );
	return $response;
}
add_filter( 'heartbeat_received', 'openstation_nonce_refresh_heartbeat_received', 5, 2 );

/**
 * Nonce-refresh rider for the `nonces_expired` heartbeat path.
 *
 * When the Heartbeat POST arrives with a stale `heartbeat-nonce`
 * (the first tick after a re-login, or any tick once the nonce
 * aged past `nonce_life`), core short-circuits before
 * `heartbeat_received` / `heartbeat_send` ever run — the response
 * is built solely from the `wp_refresh_nonces` filter. Without
 * this hook the shell would only receive fresh
 * `desktop_mode_nonces` on the FOLLOWING tick, leaving a window
 * where every cached nonce is rejected ("Cookie check failed").
 *
 * Riding the same payload here means one round-trip heals the
 * shell: the tick that says "your nonces expired" also delivers
 * the replacements. Client-side, `heartbeat.js` still fires
 * `heartbeat-tick` for this response, so the regular
 * `src/nonce-refresh.ts` subscriber picks the map up unchanged.
 *
 * @param array $response Heartbeat response (filter return value).
 * @return array
 */
function openstation_nonce_refresh_on_expired( $response ) {
	if ( ! is_array( $response ) ) {
		$response = array();
	}
	if ( ! function_exists( 'openstation_is_enabled' ) || ! openstation_is_enabled() ) {
		return $response;
	}
	$response[ OPENSTATION_NONCE_REFRESH_FIELD ] = openstation_nonce_refresh_build_payload();
	$response[ OPENSTATION_AUTH_FIELD ]          = array( 'uid' => get_current_user_id() );
	return $response;
}
add_filter( 'wp_refresh_nonces', 'openstation_nonce_refresh_on_expired', 5 );
