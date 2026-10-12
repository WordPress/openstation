<?php
/**
 * Elementor compatibility.
 *
 * @package OpenStation\Compat
 */

defined( 'ABSPATH' ) || exit;

/**
 * Hides Elementor 4's legacy menus from the dock. Elementor keeps its
 * old "Elementor" menu and the Templates menu registered for their URLs
 * and hides both from the classic sidebar with CSS the dock can't see.
 * Keyed on the new `elementor-home` menu: before Elementor 4 these two
 * are its only menus.
 *
 * @param string $placement Dock placement, `'dock'` or `'hidden'`.
 * @param string $menu_slug Menu slug.
 * @return string
 */
function openstation_compat_elementor_dock_placement( $placement, $menu_slug ) {
	if ( 'elementor' !== $menu_slug && 'edit.php?post_type=elementor_library' !== $menu_slug ) {
		return $placement;
	}
	return empty( $GLOBALS['admin_page_hooks']['elementor-home'] ) ? $placement : 'hidden';
}
add_filter( 'openstation_dock_placement', 'openstation_compat_elementor_dock_placement', 10, 2 );

// Elementor's editor prints its own head, so `admin_head` never fires,
// and its Document-Isolation-Policy keeps the shell from reading the
// frame's location: this ping is how a window learns it shows the editor.
add_action( 'elementor/editor/wp_head', 'openstation_chromeless_navigation_ping_script' );
