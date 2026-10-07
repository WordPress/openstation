<?php

defined( 'ABSPATH' ) || exit;

function openstation_asset_guard_store( $set = null ) {
	static $expected = array(
		'styles'  => array(),
		'scripts' => array(),
	);
	if ( null !== $set ) {
		$expected = $set;
	}
	return $expected;
}

function openstation_asset_guard_snapshot() {
	$store = openstation_asset_guard_store();
	$pools = array(
		'styles'  => wp_styles(),
		'scripts' => wp_scripts(),
	);
	foreach ( $pools as $type => $dependencies ) {
		foreach ( $dependencies->queue as $handle ) {
			if ( in_array( $handle, $store[ $type ], true ) ) {
				continue;
			}
			if ( ! isset( $dependencies->registered[ $handle ] ) ) {
				continue;
			}
			$src = $dependencies->registered[ $handle ]->src;
			if ( is_string( $src ) && 0 === strpos( $src, OPENSTATION_URL ) ) {
				$store[ $type ][] = $handle;
			}
		}
	}
	openstation_asset_guard_store( $store );
}
add_action( 'admin_enqueue_scripts', 'openstation_asset_guard_snapshot', 11 );
add_action( 'admin_enqueue_scripts', 'openstation_asset_guard_snapshot', PHP_INT_MAX );

function openstation_asset_guard_collect( $dependencies, $handle, $to_do, &$missing ) {
	if (
		in_array( $handle, $to_do, true )
		|| in_array( $handle, $missing, true )
		|| in_array( $handle, $dependencies->done, true )
		|| ! isset( $dependencies->registered[ $handle ] )
	) {
		return;
	}
	foreach ( $dependencies->registered[ $handle ]->deps as $dep ) {
		openstation_asset_guard_collect( $dependencies, $dep, $to_do, $missing );
	}
	$missing[] = $handle;
}

function openstation_asset_guard_merge( $dependencies, $to_do, $handles ) {
	$missing = array();
	foreach ( $handles as $handle ) {
		if ( is_string( $handle ) && '' !== $handle ) {
			openstation_asset_guard_collect( $dependencies, $handle, $to_do, $missing );
		}
	}
	if ( empty( $missing ) ) {
		return $to_do;
	}
	return array_merge( $to_do, $missing );
}

function openstation_asset_guard_print_styles( $to_do ) {
	$store = openstation_asset_guard_store();

	$handles = apply_filters( 'openstation_guarded_styles', $store['styles'] );

	if ( empty( $handles ) || ! is_array( $handles ) ) {
		return $to_do;
	}
	return openstation_asset_guard_merge( wp_styles(), $to_do, $handles );
}
add_filter( 'print_styles_array', 'openstation_asset_guard_print_styles' );

function openstation_asset_guard_print_scripts( $to_do ) {
	if ( ! doing_action( 'admin_print_footer_scripts' ) ) {
		return $to_do;
	}
	$store = openstation_asset_guard_store();

	$handles = apply_filters( 'openstation_guarded_scripts', $store['scripts'] );

	if ( empty( $handles ) || ! is_array( $handles ) ) {
		return $to_do;
	}
	$scripts = wp_scripts();
	$merged  = openstation_asset_guard_merge( $scripts, $to_do, $handles );
	foreach ( array_diff( $merged, $to_do ) as $handle ) {
		$scripts->groups[ $handle ] = 1;
	}
	return $merged;
}
add_filter( 'print_scripts_array', 'openstation_asset_guard_print_scripts' );
