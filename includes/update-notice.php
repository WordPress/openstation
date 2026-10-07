<?php

defined( 'ABSPATH' ) || exit;

function openstation_is_major_update( $installed, $available ) {
	$branch = static function ( $v ) {
		$p = explode( '.', (string) $v );
		return ( isset( $p[0] ) ? $p[0] : '0' ) . '.' . ( isset( $p[1] ) ? $p[1] : '0' );
	};
	return version_compare( $branch( $available ), $branch( $installed ), '>' );
}

function openstation_release_branch( $version ) {
	$p = explode( '.', (string) $version );
	return ( isset( $p[0] ) ? $p[0] : '0' ) . '.' . ( isset( $p[1] ) ? $p[1] : '0' );
}

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
