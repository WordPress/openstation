<?php
/**
 * Tests for the OpenStation admin bar toggle node and the
 * accompanying asset-enqueue helpers that back it.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group admin-bar
 */
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
		// Re-register admin-bar style + script fresh so inline data from
		// other tests doesn't leak into the assertions below.
		wp_styles()->remove( 'admin-bar' );
		wp_scripts()->remove( 'admin-bar' );
		wp_register_style( 'admin-bar', false );
		wp_register_script( 'admin-bar', false );
		// Dequeue desktop styles/scripts from previous tests so each case
		// observes a clean enqueue state.
		// `os-window-overview` / `os-settings`
		// matter here even though no assertion names them: they list
		// `os-windows` as a dependency, and
		// `wp_style_is( …, 'enqueued' )` walks queued handles' deps —
		// a leftover queue entry would report windows as enqueued.
		// Same reason for `os-openstation-layout`, which depends on
		// `os-dock`: adding a stylesheet that hangs off one of the
		// handles asserted below means adding it here too.
		// `os-mobile` hangs off both `os-dock` and `os-windows`.
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

	/**
	 * Helper: build an admin bar and apply the toggle node.
	 */
	private function build_admin_bar() {
		$admin_bar = new WP_Admin_Bar();
		openstation_admin_bar_toggle( $admin_bar );
		return $admin_bar;
	}

	/**
	 * @covers ::openstation_admin_bar_toggle
	 */
	public function test_toggle_is_added_for_admin_in_admin() {
		wp_set_current_user( self::$admin_id );
		$bar = $this->build_admin_bar();

		$node = $bar->get_node( 'os-toggle' );
		$this->assertNotNull( $node );
		$this->assertSame( 'top-secondary', $node->parent );
	}

	/**
	 * @covers ::openstation_admin_bar_toggle
	 */
	public function test_toggle_is_not_added_for_logged_out_user() {
		wp_set_current_user( 0 );
		$bar = $this->build_admin_bar();
		$this->assertNull( $bar->get_node( 'os-toggle' ) );
	}

	/**
	 * The toggle should only render on admin screens — on the front-end
	 * the admin bar is used by logged-in users too, but the OpenStation
	 * toggle is admin-only.
	 *
	 * @covers ::openstation_admin_bar_toggle
	 */
	public function test_toggle_is_not_added_on_front_end() {
		wp_set_current_user( self::$admin_id );
		set_current_screen( 'front' );
		$bar = $this->build_admin_bar();
		$this->assertNull( $bar->get_node( 'os-toggle' ) );
	}

	/**
	 * The node is the way INTO the shell and nothing else. Once the
	 * user is viewing the desktop the admin bar carries no OpenStation
	 * nodes at all — the "Exit OpenStation" dock tile is the way back.
	 *
	 * @covers ::openstation_admin_bar_toggle
	 */
	public function test_toggle_is_not_added_when_openstation_is_active() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$bar = $this->build_admin_bar();

		$this->assertNull( $bar->get_node( 'os-toggle' ) );
	}

	/**
	 * A classic-override request (`?desktop_mode_classic=1`) is classic
	 * admin whatever the user's meta says, so it keeps the way back in.
	 *
	 * @covers ::openstation_admin_bar_toggle
	 */
	public function test_toggle_is_added_on_a_classic_override_request() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['desktop_mode_classic'] = '1';

		$bar = $this->build_admin_bar();

		unset( $_GET['desktop_mode_classic'] );
		$this->assertNotNull( $bar->get_node( 'os-toggle' ) );
	}

	/**
	 * @covers ::openstation_admin_bar_toggle
	 */
	public function test_toggle_title_advertises_openstation() {
		wp_set_current_user( self::$admin_id );
		$bar  = $this->build_admin_bar();
		$node = $bar->get_node( 'os-toggle' );

		$this->assertStringContainsString( 'OpenStation', $node->title );
	}

	/**
	 * The toggle wiring adds it to the admin_bar_menu action at priority 190
	 * so it runs before the secondary groups render. Registration happens
	 * inside WP_Admin_Bar::add_menus(), so we need to build the bar first.
	 *
	 * @covers ::openstation_admin_bar_toggle
	 */
	public function test_toggle_is_registered_on_admin_bar_menu_action() {
		wp_set_current_user( self::$admin_id );
		$admin_bar = new WP_Admin_Bar();
		$admin_bar->add_menus();

		$this->assertSame(
			190,
			has_action( 'admin_bar_menu', 'openstation_admin_bar_toggle' )
		);
	}

	/**
	 * @covers ::openstation_enqueue_toggle_assets
	 */
	public function test_toggle_assets_are_added_to_admin_bar_style() {
		wp_set_current_user( self::$admin_id );

		openstation_enqueue_toggle_assets();

		$after  = wp_styles()->get_data( 'admin-bar', 'after' );
		$inline = is_array( $after ) ? implode( '', $after ) : (string) $after;
		$this->assertStringContainsString( '#wp-admin-bar-os-toggle', $inline );
	}

	/**
	 * The OpenStation item must be block-level, exactly the bar's
	 * height. An `inline-flex` item sits on a line box aligned on the
	 * baseline and grows its <li> to 37px inside the 32px bar; under
	 * Core's float layout that is invisible, but a host that lays the
	 * secondary group out as a flex row (WordPress.com's Debug Bar
	 * does) stretches every sibling to it and paints the group's
	 * background 5px into the shell.
	 *
	 * @covers ::openstation_enqueue_toggle_assets
	 */
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

	/**
	 * The save-openstation nonce must be reachable from the toggle's
	 * click handler. Today the config is delivered via wp_localize_script
	 * on the `os-admin-bar` handle, so we assert the nonce that
	 * lands in that script's `data` matches wp_create_nonce( 'save-openstation' ).
	 *
	 * @covers ::openstation_enqueue_toggle_assets
	 */
	public function test_toggle_assets_nonce_is_baked_into_inline_script() {
		wp_set_current_user( self::$admin_id );

		openstation_enqueue_toggle_assets();

		$before = wp_scripts()->get_data( 'os-admin-bar', 'before' );
		$data   = is_array( $before ) ? implode( '', $before ) : (string) $before;
		$expected_nonce = wp_create_nonce( 'save-openstation' );
		$this->assertStringContainsString( '"nonce":"' . $expected_nonce . '"', $data );
	}

	/**
	 * The click handler's config must be emitted as a JSON literal, not
	 * string-interpolated. That way a weird nonce, URL, or filter return
	 * value can never break out of its quotes and inject script.
	 * wp_localize_script JSON-encodes its argument by definition; this
	 * test asserts the expected JSON shape lands on the os-admin-bar
	 * handle so the contract is held end-to-end.
	 *
	 * @covers ::openstation_enqueue_toggle_assets
	 */
	public function test_toggle_assets_config_is_json_encoded() {
		wp_set_current_user( self::$admin_id );

		openstation_enqueue_toggle_assets();

		$before = wp_scripts()->get_data( 'os-admin-bar', 'before' );
		$data   = is_array( $before ) ? implode( '', $before ) : (string) $before;

		// JSON-shaped properties for every value we inject.
		$this->assertMatchesRegularExpression( '/"nonce":"[a-f0-9]+"/', $data );
		$this->assertStringContainsString( '"classicUrl":"', $data );
		$this->assertStringContainsString( '"portalUrl":"', $data );
		$this->assertStringContainsString( '"ajaxUrl":"', $data );
	}

	/**
	 * The function exits early for logged-out users. We verify that by
	 * checking the toggle-specific selector is NOT in the inline CSS.
	 *
	 * @covers ::openstation_enqueue_toggle_assets
	 */
	public function test_toggle_assets_skipped_for_logged_out_user() {
		wp_set_current_user( 0 );

		openstation_enqueue_toggle_assets();

		$after  = wp_styles()->get_data( 'admin-bar', 'after' );
		$inline = is_array( $after ) ? implode( '', $after ) : (string) $after;
		$this->assertStringNotContainsString( '#wp-admin-bar-os-toggle', $inline );
	}

	/**
	 * @covers ::openstation_enqueue_assets
	 */
	public function test_openstation_assets_not_enqueued_when_mode_off() {
		wp_set_current_user( self::$admin_id );

		openstation_enqueue_assets();

		$this->assertFalse( wp_style_is( 'openstation', 'enqueued' ) );
		$this->assertFalse( wp_script_is( 'openstation', 'enqueued' ) );
	}

	/**
	 * @covers ::openstation_enqueue_assets
	 */
	public function test_openstation_assets_enqueued_when_mode_on() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		openstation_enqueue_assets();

		$this->assertTrue( wp_style_is( 'openstation', 'enqueued' ) );
		$this->assertTrue( wp_style_is( 'os-windows', 'enqueued' ) );
		$this->assertTrue( wp_style_is( 'os-dock', 'enqueued' ) );
		$this->assertTrue( wp_script_is( 'openstation', 'enqueued' ) );
	}

	/**
	 * Chromeless requests must get the chromeless stylesheet but NOT the
	 * full shell assets — the shell lives in the parent frame.
	 *
	 * @covers ::openstation_enqueue_assets
	 */
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

	/**
	 * @covers ::openstation_enqueue_assets
	 */
	public function test_openstation_assets_localize_shell_config() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		openstation_enqueue_assets();

		$data = wp_scripts()->get_data( 'openstation', 'data' );
		$this->assertNotEmpty( $data );
		$this->assertStringContainsString( 'openStationConfig', (string) $data );
		$this->assertStringContainsString( 'dockItems', (string) $data );
	}

	/**
	 * @covers ::openstation_enqueue_assets
	 */
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

	/**
	 * @covers ::openstation_enqueue_assets
	 */
	public function test_default_filters_wire_enqueue_callbacks_to_admin_enqueue_scripts() {
		$this->assertNotFalse( has_action( 'admin_enqueue_scripts', 'openstation_enqueue_toggle_assets' ) );
		$this->assertNotFalse( has_action( 'admin_enqueue_scripts', 'openstation_enqueue_assets' ) );
	}

}
