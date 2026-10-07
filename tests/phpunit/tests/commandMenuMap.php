<?php

class Tests_OpenStation_CommandMenuMap extends WP_UnitTestCase {

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

		$map = openstation_build_command_menu_map();

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

	public function test_unregistered_file_slug_stays_direct_link() {
		global $menu, $submenu;
		$menu_backup    = $menu;
		$submenu_backup = $submenu;

		$menu    = array(
			array( 'Posts', '', 'edit.php', '', '', 'menu-posts', '' ),
		);
		$submenu = array();

		$map = openstation_build_command_menu_map();

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

	public function test_registered_url_style_slug_stays_direct_link() {
		global $menu, $submenu, $_parent_pages;
		$menu_backup    = $menu;
		$submenu_backup = $submenu;

		$menu    = array(
			array( 'ACF', '', 'edit.php?post_type=acf-field-group', '', '', 'menu-acf', '' ),
		);
		$submenu = array(
			'edit.php?post_type=acf-field-group' => array(
				array( 'Post Types', '', 'edit.php?post_type=acf-post-type' ),
			),
		);

		$_parent_pages['edit.php?post_type=acf-field-group'] = false;
		$_parent_pages['edit.php?post_type=acf-post-type']   = 'edit.php?post_type=acf-field-group';

		$map = openstation_build_command_menu_map();

		$menu    = $menu_backup;
		$submenu = $submenu_backup;
		unset(
			$_parent_pages['edit.php?post_type=acf-field-group'],
			$_parent_pages['edit.php?post_type=acf-post-type']
		);

		$acf        = null;
		$post_types = null;
		foreach ( $map as $entry ) {
			if ( 'edit.php?post_type=acf-field-group' === $entry['name'] ) {
				$acf = $entry;
			}
			if ( 'edit.php?post_type=acf-field-group-edit.php?post_type=acf-post-type' === $entry['name'] ) {
				$post_types = $entry;
			}
		}
		$this->assertNotNull( $acf, 'expected the ACF entry in the command map' );
		$this->assertSame( 'edit.php?post_type=acf-field-group', $acf['url'] );
		$this->assertNotNull( $post_types, 'expected the ACF Post Types submenu entry in the command map' );
		$this->assertSame( 'edit.php?post_type=acf-post-type', $post_types['url'] );
	}
}
