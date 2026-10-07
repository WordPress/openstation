<?php

class Tests_OpenStation_DesktopObjectTitles extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
	}

	public function tear_down() {
		remove_all_filters( 'openstation_site_title' );
		parent::tear_down();
	}

	public function test_recycle_bin_window_is_titled_trash() {
		openstation_apps_register_windows();

		$entry = openstation_native_window_registry( 'desktop-mode-recycle-bin' );

		$this->assertSame( 'Trash', $entry['title'] );
	}

	public function test_recycle_bin_registers_no_desktop_icon() {

		openstation_unregister_icon( 'desktop-mode-recycle-bin' );

		openstation_apps_register_windows();

		$this->assertNull(
			openstation_desktop_icon_registry( 'desktop-mode-recycle-bin' )
		);
	}

	public function test_recycle_bin_tile_is_placeable() {
		openstation_apps_register_windows();

		$entry = openstation_native_window_registry( 'desktop-mode-recycle-bin' );

		$this->assertTrue( $entry['placeable'] );
	}

	public function test_recycle_bin_keeps_its_window_id() {
		openstation_apps_register_windows();

		$this->assertIsArray(
			openstation_native_window_registry( 'desktop-mode-recycle-bin' )
		);
	}

	public function test_content_graph_window_and_icon_are_titled_corkboard() {
		openstation_content_graph_register_window();

		$entry = openstation_native_window_registry( 'desktop-mode-content-graph' );
		$icon  = openstation_desktop_icon_registry( 'desktop-mode-content-graph' );

		$this->assertSame( 'Corkboard', $entry['title'] );
		$this->assertSame( 'Corkboard', $icon['title'] );
	}

	public function test_content_graph_uses_the_corkboard_svg() {
		openstation_content_graph_register_window();

		$entry    = openstation_native_window_registry( 'desktop-mode-content-graph' );
		$icon     = openstation_desktop_icon_registry( 'desktop-mode-content-graph' );
		$expected = 'data:image/svg+xml;base64,'
			. base64_encode( openstation_content_graph_icon_svg() );

		$this->assertSame( $expected, $entry['icon'] );
		$this->assertSame( $expected, $icon['icon'] );
	}

	public function test_corkboard_svg_survives_the_icon_sanitizer() {
		$uri = 'data:image/svg+xml;base64,'
			. base64_encode( openstation_content_graph_icon_svg() );

		$this->assertSame( $uri, openstation_sanitize_dock_icon( $uri ) );
	}

	public function test_corkboard_svg_is_drawn_entirely_in_current_color() {
		$svg = openstation_content_graph_icon_svg();

		$this->assertStringStartsWith( '<svg', $svg );
		$this->assertStringContainsString( 'viewBox="0 0 64 64"', $svg );
		$this->assertStringContainsString( 'currentColor', $svg );
		$this->assertDoesNotMatchRegularExpression( '/(fill|stroke)="#/', $svg );
	}

	public function test_corkboard_svg_keeps_its_nodes_legible() {
		$svg = openstation_content_graph_icon_svg();

		preg_match_all( '/r="([0-9.]+)"/', $svg, $matches );
		$radii = array_map( 'floatval', $matches[1] );

		$this->assertCount( 4, $radii );

		$this->assertGreaterThanOrEqual( 5.0, min( $radii ) );

		sort( $radii );
		$hub = array_pop( $radii );
		$this->assertGreaterThan( max( $radii ), $hub );
	}

	public function test_built_in_app_icons_are_all_silhouettes() {
		$icons = array(
			'games'        => openstation_games_icon_svg(),
			'recycle-bin'  => openstation_recycle_bin_icon_svg(),
			'my-wordpress' => openstation_my_wordpress_icon_svg(),
			'corkboard'    => openstation_content_graph_icon_svg(),
		);

		foreach ( $icons as $name => $svg ) {
			$this->assertStringStartsWith( '<svg', $svg, $name );
			$this->assertStringContainsString( 'viewBox="0 0 64 64"', $svg, $name );
			$this->assertStringContainsString( 'currentColor', $svg, $name );
			$this->assertDoesNotMatchRegularExpression( '/(fill|stroke)="#/', $svg, $name );

			$uri = 'data:image/svg+xml;base64,' . base64_encode( $svg );
			$this->assertSame( $uri, openstation_sanitize_dock_icon( $uri ), $name );
		}
	}

	public function test_recycle_bin_uses_its_own_svg() {
		openstation_apps_register_windows();

		$entry = openstation_native_window_registry( 'desktop-mode-recycle-bin' );

		$expected = 'data:image/svg+xml;base64,'
			. base64_encode( openstation_recycle_bin_icon_svg() );

		$this->assertSame( $expected, $entry['icon'] );
	}

	public function test_content_graph_config_carries_the_site_title() {
		add_filter(
			'openstation_site_title',
			static function () {
				return "Izzi's Gym";
			}
		);

		openstation_content_graph_register_window();

		$entry = openstation_native_window_registry( 'desktop-mode-content-graph' );

		$this->assertSame( "Izzi's Gym", $entry['config']['siteName'] );
	}

	public function test_content_graph_keeps_its_window_id() {
		openstation_content_graph_register_window();

		$this->assertIsArray(
			openstation_native_window_registry( 'desktop-mode-content-graph' )
		);
	}
}
