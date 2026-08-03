<?php
/**
 * Reports a pending WordPress core update to the shell as the `coreUpdate`
 * config value. The shell resolves the release art and renders the
 * notification client-side (see `src/update-notice.ts`).
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Whether `$available` is a new major (X.Y branch) relative to `$installed`
 * — `6.9.2 -> 7.0` is major, `7.0 -> 7.0.2` is not.
 *
 * @param string $installed Installed version.
 * @param string $available Available version.
 * @return bool
 */
function openstation_is_major_update( $installed, $available ) {
	$branch = static function ( $v ) {
		$p = explode( '.', (string) $v );
		return ( isset( $p[0] ) ? $p[0] : '0' ) . '.' . ( isset( $p[1] ) ? $p[1] : '0' );
	};
	return version_compare( $branch( $available ), $branch( $installed ), '>' );
}

/**
 * The X.Y branch for a version (`7.0.2` -> `7.0`).
 *
 * @param string $version Version string.
 * @return string
 */
function openstation_release_branch( $version ) {
	$p = explode( '.', (string) $version );
	return ( isset( $p[0] ) ? $p[0] : '0' ) . '.' . ( isset( $p[1] ) ? $p[1] : '0' );
}

/**
 * The pending core update as a shell descriptor, or null when none is
 * pending / the user can't `update_core`.
 *
 * `version` is the branch when crossing into a new major (the codename is
 * added client-side), else the exact version; `available` is the exact
 * version (the dismissal key); `crossing` flags a new major.
 *
 * @return array{version:string,available:string,branch:string,url:string,crossing:bool}|null
 */
function openstation_get_core_update() {
	if ( ! current_user_can( 'update_core' ) ) {
		return null;
	}

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

	/**
	 * Whether to show the desktop core-update notification. Return false
	 * to hide it.
	 *
	 * @param bool $show Default true.
	 */
	if ( ! apply_filters( 'openstation_show_core_update_notice', true ) ) {
		return null;
	}

	$branch   = openstation_release_branch( $available );
	$crossing = openstation_is_major_update( get_bloginfo( 'version' ), $available );

	return array(
		'version'   => $crossing ? $branch : $available,
		'available' => $available,
		'branch'    => $branch,
		'url'       => self_admin_url( 'update-core.php' ),
		'crossing'  => $crossing,
	);
}
