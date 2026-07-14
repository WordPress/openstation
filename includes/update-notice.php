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
 *      descriptor this file computes and ships in the shell config as
 *      `coreUpdate`.
 *
 * For a routine minor release the shell shows a single persistent
 * toast. For a **major** release the shell has release art to work with
 * (WordPress ships music-themed "Release Edition" art every major), so
 * it upgrades the moment to an album-sleeve card whose vinyl slides out
 * — see `src/ui/components/wpd-release-card/`. The descriptor carries
 * just enough for the shell to decide: `major` + an optional `release`
 * (name + art + accent). When no art is known for a major, the shell
 * falls back to the plain toast.
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
 * Resolve the release-art descriptor for a version, if one is known.
 *
 * Keyed by the X.Y branch. WordPress ships the same album-cover +
 * emerging-record art template every major (Armstrong 7.0, Gene 6.9,
 * …); we bundle the square cover crop under `assets/releases/<X.Y>.jpg`
 * and pair it with the release codename + accent color. The
 * `desktop_mode_core_update_release` filter lets a site add art for a
 * newer release (before the plugin bundles it) or override an entry.
 *
 * @since 0.9.3
 *
 * @param string $version Available version (e.g. `7.0`).
 * @return array{name:string,artUrl:string,accent:string,accentInk:string}|null
 */
function desktop_mode_core_update_release( $version ) {
	$parts = explode( '.', (string) $version );
	$key   = ( isset( $parts[0] ) ? $parts[0] : '0' ) . '.' . ( isset( $parts[1] ) ? $parts[1] : '0' );

	// Bundled release art. `accent` tints the record label + the
	// "Update now" button; `accentInk` is the label text over that
	// accent (dark on the light orange sleeve, light on the dark blue).
	$registry = array(
		'7.0' => array(
			'name'      => 'Armstrong',
			'accent'    => '#ef5a3c',
			'accentInk' => '#171717',
		),
		'6.9' => array(
			'name'      => 'Gene',
			'accent'    => '#3d5cd6',
			'accentInk' => '#f2f4ff',
		),
	);

	$release = null;
	if ( isset( $registry[ $key ] ) ) {
		$art = DESKTOP_MODE_DIR . 'assets/releases/' . $key . '.jpg';
		if ( file_exists( $art ) ) {
			$release = array(
				'name'      => $registry[ $key ]['name'],
				'artUrl'    => esc_url_raw( DESKTOP_MODE_URL . 'assets/releases/' . $key . '.jpg' ),
				'accent'    => $registry[ $key ]['accent'],
				'accentInk' => $registry[ $key ]['accentInk'],
			);
		}
	}

	/**
	 * Filter the release-art descriptor for a major update. Return a
	 * descriptor (`name`, `artUrl`, `accent`, `accentInk`) to give the
	 * shell an album sleeve to animate, or `null` to fall back to the
	 * plain update toast.
	 *
	 * @since 0.9.3
	 *
	 * @param array|null $release The resolved descriptor, or null.
	 * @param string     $version The full available version.
	 * @param string     $key     The X.Y branch key.
	 */
	return apply_filters( 'desktop_mode_core_update_release', $release, $version, $key );
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
 * @since 0.9.3
 *
 * @return array{version:string,url:string,major:bool,release:?array}|null
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

	$major = desktop_mode_is_major_update( get_bloginfo( 'version' ), $version );

	$update = array(
		'version' => $version,
		// `self_admin_url()` resolves to the network update screen on
		// multisite (where `update_core` is a super-admin action) and
		// the site update screen otherwise — matching where the
		// capability actually lets the user act.
		'url'     => self_admin_url( 'update-core.php' ),
		'major'   => $major,
		// Release art only matters for a major; the shell ignores it
		// for minors and shows the plain toast.
		'release' => $major ? desktop_mode_core_update_release( $version ) : null,
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
	 * @param array{version:string,url:string,major:bool,release:?array}|null $update The descriptor.
	 */
	$update = apply_filters( 'desktop_mode_core_update_notice', $update );

	return ( is_array( $update ) && ! empty( $update['version'] ) ) ? $update : null;
}
