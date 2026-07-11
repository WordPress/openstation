<?php
/**
 * Tests for the command-palette admin-menu map builder.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 *
 * @covers ::desktop_mode_build_command_menu_map
 */
class Tests_DesktopMode_CommandMenuMap extends WP_UnitTestCase {

	/**
	 * Legacy file-path slugs (WP-Sweep's `wp-sweep/admin.php`,
	 * registered via `add_management_page()`) contain `.php` yet are
	 * registered plugin pages — the map must route them through
	 * `menu_page_url()` (→ `tools.php?page=wp-sweep/admin.php`), not
	 * treat them as a raw file link that 404s.
	 */
	public function test_registered_file_path_slug_routes_through_parent() {
		global $menu, $submenu, $_parent_pages;
		$menu_backup    = $menu;
		$submenu_backup = $submenu;

		$menu    = array(
			array( 'Tools', '', 'tools.php', '', '', 'menu-tools', '' ),
		);
		$submenu = array(
			'tools.php' => array(
				array( 'Sweep', '', 'wp-sweep/admin.php' ),
			),
		);

		$_parent_pages['wp-sweep/admin.php'] = 'tools.php';

		$map = desktop_mode_build_command_menu_map();

		$menu    = $menu_backup;
		$submenu = $submenu_backup;
		unset( $_parent_pages['wp-sweep/admin.php'] );

		$sweep = null;
		foreach ( $map as $entry ) {
			if ( 'tools.php-wp-sweep/admin.php' === $entry['name'] ) {
				$sweep = $entry;
				break;
			}
		}
		$this->assertNotNull( $sweep, 'expected the Sweep submenu entry in the command map' );
		$this->assertStringContainsString( 'tools.php', $sweep['url'] );
		parse_str( (string) wp_parse_url( html_entity_decode( $sweep['url'] ), PHP_URL_QUERY ), $args );
		$this->assertSame( 'wp-sweep/admin.php', $args['page'] );
	}

	/**
	 * Plain `.php` file slugs with no page registration keep the
	 * direct-link behavior.
	 */
	public function test_unregistered_file_slug_stays_direct_link() {
		global $menu, $submenu;
		$menu_backup    = $menu;
		$submenu_backup = $submenu;

		$menu    = array(
			array( 'Posts', '', 'edit.php', '', '', 'menu-posts', '' ),
		);
		$submenu = array();

		$map = desktop_mode_build_command_menu_map();

		$menu    = $menu_backup;
		$submenu = $submenu_backup;

		$posts = null;
		foreach ( $map as $entry ) {
			if ( 'edit.php' === $entry['name'] ) {
				$posts = $entry;
				break;
			}
		}
		$this->assertNotNull( $posts, 'expected the Posts entry in the command map' );
		$this->assertSame( 'edit.php', $posts['url'] );
	}
}
