<?php

class Tests_OpenStation_AdminBarDesktopToggle extends WP_UnitTestCase {

	protected static $admin_id;

	public static function set_up_before_class() {
		parent::set_up_before_class();
		require_once ABSPATH . WPINC . '/class-wp-admin-bar.php';
	}

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		set_current_screen( OPENSTATION_SHELL_SCREEN_ID );

		wp_styles()->remove( 'admin-bar' );
		wp_scripts()->remove( 'admin-bar' );
		wp_register_style( 'admin-bar', false );
		wp_register_script( 'admin-bar', false );

		foreach ( array( 'openstation', 'os-windows', 'os-window-overview', 'os-settings', 'os-dock', 'os-dock-peek', 'os-openstation-layout', 'os-chromeless', 'os-mobile' ) as $handle ) {
			wp_dequeue_style( $handle );
			wp_dequeue_script( $handle );
		}
	}

	public function tear_down() {
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );
		remove_all_filters( 'openstation_shell_config' );
		unset( $_GET['openstation_chromeless'] );
		parent::tear_down();
	}

	private function build_admin_bar() {
		$admin_bar = new WP_Admin_Bar();
		openstation_admin_bar_toggle( $admin_bar );
		return $admin_bar;
	}

	public function test_toggle_is_added_for_admin_in_admin() {
		wp_set_current_user( self::$admin_id );
		$bar = $this->build_admin_bar();

		$node = $bar->get_node( 'os-toggle' );
		$this->assertNotNull( $node );
		$this->assertSame( 'top-secondary', $node->parent );
	}

	public function test_toggle_is_not_added_for_logged_out_user() {
		wp_set_current_user( 0 );
		$bar = $this->build_admin_bar();
		$this->assertNull( $bar->get_node( 'os-toggle' ) );
	}

	public function test_toggle_is_not_added_on_front_end() {
		wp_set_current_user( self::$admin_id );
		set_current_screen( 'front' );
		$bar = $this->build_admin_bar();
		$this->assertNull( $bar->get_node( 'os-toggle' ) );
	}

	public function test_toggle_is_not_added_when_openstation_is_active() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$bar = $this->build_admin_bar();

		$this->assertNull( $bar->get_node( 'os-toggle' ) );
	}

	public function test_toggle_is_added_on_a_classic_override_request() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['desktop_mode_classic'] = '1';

		$bar = $this->build_admin_bar();

		unset( $_GET['desktop_mode_classic'] );
		$this->assertNotNull( $bar->get_node( 'os-toggle' ) );
	}

	public function test_toggle_title_advertises_openstation() {
		wp_set_current_user( self::$admin_id );
		$bar  = $this->build_admin_bar();
		$node = $bar->get_node( 'os-toggle' );

		$this->assertStringContainsString( 'OpenStation', $node->title );
	}

	public function test_toggle_is_registered_on_admin_bar_menu_action() {
		wp_set_current_user( self::$admin_id );
		$admin_bar = new WP_Admin_Bar();
		$admin_bar->add_menus();

		$this->assertSame(
			190,
			has_action( 'admin_bar_menu', 'openstation_admin_bar_toggle' )
		);
	}

	public function test_toggle_assets_are_added_to_admin_bar_style() {
		wp_set_current_user( self::$admin_id );

		openstation_enqueue_toggle_assets();

		$after  = wp_styles()->get_data( 'admin-bar', 'after' );
		$inline = is_array( $after ) ? implode( '', $after ) : (string) $after;
		$this->assertStringContainsString( '#wp-admin-bar-os-toggle', $inline );
	}

	public function test_toggle_items_are_block_level_flex() {
		wp_set_current_user( self::$admin_id );

		openstation_enqueue_toggle_assets();

		$after  = wp_styles()->get_data( 'admin-bar', 'after' );
		$inline = is_array( $after ) ? implode( '', $after ) : (string) $after;

		$this->assertMatchesRegularExpression(
			'/#wp-admin-bar-os-toggle > \.ab-item \{\s*display: flex;/',
			$inline,
			'The admin-bar item must be display: flex.'
		);
		$this->assertStringNotContainsString(
			"> .ab-item {\n\t\t\tdisplay: inline-flex",
			$inline,
			'An inline-flex item grows its <li> past the bar height.'
		);
	}

	public function test_toggle_assets_nonce_is_baked_into_inline_script() {
		wp_set_current_user( self::$admin_id );

		openstation_enqueue_toggle_assets();

		$before = wp_scripts()->get_data( 'os-admin-bar', 'before' );
		$data   = is_array( $before ) ? implode( '', $before ) : (string) $before;
		$expected_nonce = wp_create_nonce( 'save-openstation' );
		$this->assertStringContainsString( '"nonce":"' . $expected_nonce . '"', $data );
	}

	public function test_toggle_assets_config_is_json_encoded() {
		wp_set_current_user( self::$admin_id );

		openstation_enqueue_toggle_assets();

		$before = wp_scripts()->get_data( 'os-admin-bar', 'before' );
		$data   = is_array( $before ) ? implode( '', $before ) : (string) $before;

		$this->assertMatchesRegularExpression( '/"nonce":"[a-f0-9]+"/', $data );
		$this->assertStringContainsString( '"classicUrl":"', $data );
		$this->assertStringContainsString( '"portalUrl":"', $data );
		$this->assertStringContainsString( '"ajaxUrl":"', $data );
	}

	public function test_toggle_assets_skipped_for_logged_out_user() {
		wp_set_current_user( 0 );

		openstation_enqueue_toggle_assets();

		$after  = wp_styles()->get_data( 'admin-bar', 'after' );
		$inline = is_array( $after ) ? implode( '', $after ) : (string) $after;
		$this->assertStringNotContainsString( '#wp-admin-bar-os-toggle', $inline );
	}

	public function test_openstation_assets_not_enqueued_when_mode_off() {
		wp_set_current_user( self::$admin_id );

		openstation_enqueue_assets();

		$this->assertFalse( wp_style_is( 'openstation', 'enqueued' ) );
		$this->assertFalse( wp_script_is( 'openstation', 'enqueued' ) );
	}

	public function test_openstation_assets_enqueued_when_mode_on() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		openstation_enqueue_assets();

		$this->assertTrue( wp_style_is( 'openstation', 'enqueued' ) );
		$this->assertTrue( wp_style_is( 'os-windows', 'enqueued' ) );
		$this->assertTrue( wp_style_is( 'os-dock', 'enqueued' ) );
		$this->assertTrue( wp_script_is( 'openstation', 'enqueued' ) );
	}

	public function test_chromeless_request_enqueues_chromeless_style_only() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless'] = '1';

		openstation_enqueue_assets();

		$this->assertTrue( wp_style_is( 'os-chromeless', 'enqueued' ) );
		$this->assertFalse( wp_style_is( 'os-windows', 'enqueued' ) );
		$this->assertFalse( wp_style_is( 'os-dock', 'enqueued' ) );
		$this->assertFalse( wp_script_is( 'openstation', 'enqueued' ) );
	}

	public function test_openstation_assets_localize_shell_config() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		openstation_enqueue_assets();

		$data = wp_scripts()->get_data( 'openstation', 'data' );
		$this->assertNotEmpty( $data );
		$this->assertStringContainsString( 'openStationConfig', (string) $data );
		$this->assertStringContainsString( 'dockItems', (string) $data );
	}

	public function test_shell_config_filter_can_replace_entire_config() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		add_filter(
			'openstation_shell_config',
			function () {
				return array( 'currentTitle' => 'Filtered Title' );
			}
		);

		openstation_enqueue_assets();

		$data = (string) wp_scripts()->get_data( 'openstation', 'data' );
		$this->assertStringContainsString( 'Filtered Title', $data );
	}

	public function test_default_filters_wire_enqueue_callbacks_to_admin_enqueue_scripts() {
		$this->assertNotFalse( has_action( 'admin_enqueue_scripts', 'openstation_enqueue_toggle_assets' ) );
		$this->assertNotFalse( has_action( 'admin_enqueue_scripts', 'openstation_enqueue_assets' ) );
	}

}
