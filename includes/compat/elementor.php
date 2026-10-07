<?php

defined( 'ABSPATH' ) || exit;

function openstation_compat_elementor_dock_placement( $placement, $menu_slug ) {
	if ( 'elementor' !== $menu_slug && 'edit.php?post_type=elementor_library' !== $menu_slug ) {
		return $placement;
	}
	return empty( $GLOBALS['admin_page_hooks']['elementor-home'] ) ? $placement : 'hidden';
}
add_filter( 'openstation_dock_placement', 'openstation_compat_elementor_dock_placement', 10, 2 );

add_action( 'elementor/editor/wp_head', 'openstation_chromeless_navigation_ping_script' );
