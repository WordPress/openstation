<?php
/**
 * Core-update notice — the desktop-native replacement for WordPress's
 * per-screen update nag.
 *
 * WordPress core prints "WordPress X is available! Please update now."
 * on *every* admin screen (`update_nag()` on `admin_notices`). Because
 * Desktop Mode renders each screen as its own window, that banner would
 * repeat in every open window. So we:
 *
 *   1. Detach core's nag inside every chromeless window — see
 *      `desktop_mode_chromeless_suppress_update_nags()` in
 *      `includes/core/routing.php`.
 *   2. Surface the update *once*, as a single persistent + dismissible
 *      toast in the desktop shell, driven by the descriptor this file
 *      computes and ships in the shell config as `coreUpdate`.
 *
 * The descriptor is intentionally minimal — `version` + `url` — so the
 * shell owns the presentation (message, "Update now" action,
 * dismissal) rather than inheriting core's markup.
 *
 * @since 0.9.3
 * @package DesktopMode
 */

defined( 'ABSPATH' ) || exit;

/**
 * Resolve the pending WordPress core update, if any, into the compact
 * descriptor the shell renders as a toast.
 *
 * Reads WordPress's authoritative update state (the same
 * `get_preferred_from_update_core()` core's own `update_nag()` uses),
 * gated on the `update_core` capability so users who can't update never
 * see the toast. Returns `null` when no upgrade is pending or the user
 * lacks the capability.
 *
 * @since 0.9.3
 *
 * @return array{version:string,url:string}|null Descriptor, or `null`.
 */
function desktop_mode_get_core_update() {
	if ( ! current_user_can( 'update_core' ) ) {
		return null;
	}

	// `get_preferred_from_update_core()` lives in
	// wp-admin/includes/update.php, loaded on admin requests. Guard
	// defensively in case this runs in an unusual context.
	if ( ! function_exists( 'get_preferred_from_update_core' ) ) {
		require_once ABSPATH . 'wp-admin/includes/update.php';
	}
	if ( ! function_exists( 'get_preferred_from_update_core' ) ) {
		return null;
	}

	$cur = get_preferred_from_update_core();
	if ( ! isset( $cur->response ) || 'upgrade' !== $cur->response ) {
		return null;
	}

	$version = isset( $cur->current ) ? (string) $cur->current : '';
	if ( '' === $version ) {
		return null;
	}

	$update = array(
		'version' => $version,
		// `self_admin_url()` resolves to the network update screen on
		// multisite (where `update_core` is a super-admin action) and
		// the site update screen otherwise — matching where the
		// capability actually lets the user act.
		'url'     => self_admin_url( 'update-core.php' ),
	);

	/**
	 * Filter the core-update descriptor before it ships to the shell.
	 *
	 * Return `null` to suppress the desktop update toast entirely —
	 * useful for sites that manage core updates out-of-band and don't
	 * want the nag surfaced at all.
	 *
	 * @since 0.9.3
	 *
	 * @param array{version:string,url:string}|null $update The descriptor.
	 */
	$update = apply_filters( 'desktop_mode_core_update_notice', $update );

	return ( is_array( $update ) && ! empty( $update['version'] ) ) ? $update : null;
}
