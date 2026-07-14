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
 *   2. Surface the update *once* in the desktop shell, driven by the
 *      descriptor this file ships in the shell config as `coreUpdate`.
 *
 * This file only reports *that* an update is pending and how it relates
 * to the installed version. The release **art + codename** are resolved
 * on the client (from the wordpress.org/news feed) so the notification
 * can appear once, already as the album-sleeve vinyl, without a
 * temporary toast while art loads — see `src/release-art.ts` and
 * `src/update-notice.ts`. If the client can't resolve art it falls back
 * to a plain toast.
 *
 * @since 0.9.3
 * @package DesktopMode
 */

defined( 'ABSPATH' ) || exit;

/**
 * Whether `$available` is a new **major** (X.Y branch) relative to the
 * installed version — i.e. `6.9.2 -> 7.0` is major, `7.0 -> 7.0.2` is
 * not. WordPress's own major/minor definition: majors bump X.Y, minors
 * bump the third segment.
 *
 * @since 0.9.3
 *
 * @param string $installed Installed version (e.g. `6.9.2`).
 * @param string $available Available version (e.g. `7.0`).
 * @return bool
 */
function desktop_mode_is_major_update( $installed, $available ) {
	$branch = static function ( $v ) {
		$p = explode( '.', (string) $v );
		return ( isset( $p[0] ) ? $p[0] : '0' ) . '.' . ( isset( $p[1] ) ? $p[1] : '0' );
	};
	return version_compare( $branch( $available ), $branch( $installed ), '>' );
}

/**
 * The X.Y branch key for a version (`7.0.2` -> `7.0`).
 *
 * @since 0.9.3
 *
 * @param string $version Version string.
 * @return string
 */
function desktop_mode_release_branch( $version ) {
	$p = explode( '.', (string) $version );
	return ( isset( $p[0] ) ? $p[0] : '0' ) . '.' . ( isset( $p[1] ) ? $p[1] : '0' );
}

/**
 * Resolve the pending WordPress core update, if any, into the compact
 * descriptor the shell renders.
 *
 * Reads WordPress's authoritative update state (the same
 * `get_preferred_from_update_core()` core's own `update_nag()` uses),
 * gated on the `update_core` capability so users who can't update never
 * see the notice. Returns `null` when no upgrade is pending or the user
 * lacks the capability.
 *
 * Shape:
 *   - `version` — the version to show in the message. When the update
 *     crosses into a new major (6.9 → 7.0 / 7.0.1) this is the major
 *     branch (`7.0`); within the same branch (7.0 → 7.0.1) it's the
 *     exact version (`7.0.1`).
 *   - `branch`  — the major branch (`7.0`); the client resolves art +
 *     codename for it.
 *   - `crossing` — `true` when moving into a new major. The client only
 *     shows the codename when crossing.
 *
 * @since 0.9.3
 *
 * @return array{version:string,branch:string,url:string,crossing:bool}|null
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

	$available = isset( $cur->current ) ? (string) $cur->current : '';
	if ( '' === $available ) {
		return null;
	}

	$branch   = desktop_mode_release_branch( $available );
	$crossing = desktop_mode_is_major_update( get_bloginfo( 'version' ), $available );

	$update = array(
		// Crossing a major shows the major version (+ codename, added
		// client-side); a same-branch minor shows the exact version.
		'version'  => $crossing ? $branch : $available,
		'branch'   => $branch,
		// `self_admin_url()` resolves to the network update screen on
		// multisite (where `update_core` is a super-admin action) and
		// the site update screen otherwise — matching where the
		// capability actually lets the user act.
		'url'      => self_admin_url( 'update-core.php' ),
		'crossing' => $crossing,
	);

	/**
	 * Filter the core-update descriptor before it ships to the shell.
	 *
	 * Return `null` to suppress the desktop update notice entirely —
	 * useful for sites that manage core updates out-of-band and don't
	 * want the nag surfaced at all.
	 *
	 * @since 0.9.3
	 *
	 * @param array{version:string,branch:string,url:string,crossing:bool}|null $update The descriptor.
	 */
	$update = apply_filters( 'desktop_mode_core_update_notice', $update );

	return ( is_array( $update ) && ! empty( $update['version'] ) ) ? $update : null;
}
