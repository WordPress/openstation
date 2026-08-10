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
		set_current_screen( 'dashboard' );
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
		foreach ( array( 'openstation', 'os-windows', 'os-window-overview', 'os-settings', 'os-dock', 'os-dock-peek', 'os-openstation-layout', 'os-chromeless' ) as $handle ) {
			wp_dequeue_style( $handle );
			wp_dequeue_script( $handle );
		}
	}

	public function tear_down() {
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );
		remove_all_filters( 'openstation_shell_config' );
		remove_all_filters( 'openstation_arrange_menu_items' );
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
	 * @covers ::openstation_admin_bar_toggle
	 */
	public function test_toggle_title_switches_when_openstation_is_active() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$bar  = $this->build_admin_bar();
		$node = $bar->get_node( 'os-toggle' );

		$this->assertStringContainsString( 'Classic Admin', $node->title );
		$this->assertSame( 'os-active', $node->meta['class'] );
	}

	/**
	 * @covers ::openstation_admin_bar_toggle
	 */
	public function test_toggle_title_advertises_openstation_when_inactive() {
		wp_set_current_user( self::$admin_id );
		$bar  = $this->build_admin_bar();
		$node = $bar->get_node( 'os-toggle' );

		$this->assertStringContainsString( 'OpenStation', $node->title );
		$this->assertSame( '', $node->meta['class'] );
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
		$this->assertMatchesRegularExpression( '/"active":(true|false)/', $data );
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

	/**
	 * The four built-in arrange items should be present when desktop
	 * mode is active. Only validates presence + parenting; each item's
	 * click wiring lives in the inline JS under the toggle assets.
	 *
	 * @covers ::openstation_admin_bar_toggle
	 */
	public function test_arrange_menu_has_builtins_when_active() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$bar = $this->build_admin_bar();

		$this->assertNotNull( $bar->get_node( 'desktop-layout-menu' ) );
		foreach ( array( 'cascade', 'overview', 'snap', 'tile' ) as $slug ) {
			$node = $bar->get_node( 'desktop-layout-' . $slug );
			$this->assertNotNull( $node, "Expected built-in item desktop-layout-$slug" );
			$this->assertSame( 'desktop-layout-menu', $node->parent );
		}
	}

	/**
	 * Plugins add entries to the Arrange submenu via the
	 * `openstation_arrange_menu_items` filter. Each entry becomes an
	 * admin-bar node under `desktop-layout-menu` with id prefixed by
	 * `desktop-layout-custom-` — the inline JS routes its click to
	 * `os.arrange.custom-action` with the original slug.
	 *
	 * @covers ::openstation_admin_bar_toggle
	 */
	public function test_arrange_menu_appends_custom_items_from_filter() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		add_filter(
			'openstation_arrange_menu_items',
			function ( $items ) {
				$items[] = array(
					'id'          => 'diagonal',
					'title'       => 'Diagonal',
					'description' => 'A perfect 45° cascade.',
				);
				return $items;
			}
		);

		$bar  = $this->build_admin_bar();
		$node = $bar->get_node( 'desktop-layout-custom-diagonal' );

		$this->assertNotNull( $node );
		$this->assertSame( 'desktop-layout-menu', $node->parent );
		$this->assertStringContainsString( 'os-layout-custom', $node->meta['class'] );
		$this->assertSame( 'A perfect 45° cascade.', $node->meta['title'] );
	}

	/**
	 * Entries missing `id` or `title` are silently dropped — plugins
	 * can't accidentally create an unrouteable menu item.
	 *
	 * @covers ::openstation_admin_bar_toggle
	 */
	public function test_arrange_menu_drops_invalid_custom_items() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		add_filter(
			'openstation_arrange_menu_items',
			function ( $items ) {
				$items[] = array( 'title' => 'No ID' );
				$items[] = array( 'id' => 'no-title' );
				$items[] = 'not-an-array';
				$items[] = array( 'id' => 'ok', 'title' => 'OK' );
				return $items;
			}
		);

		$bar = $this->build_admin_bar();

		// Only the well-formed entry should have landed.
		$this->assertNotNull( $bar->get_node( 'desktop-layout-custom-ok' ) );
		$this->assertNull( $bar->get_node( 'desktop-layout-custom-no-title' ) );
	}

	/**
	 * `position` sorts custom items; ties preserve registration order.
	 *
	 * @covers ::openstation_admin_bar_toggle
	 */
	public function test_arrange_menu_sorts_custom_items_by_position() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		add_filter(
			'openstation_arrange_menu_items',
			function ( $items ) {
				$items[] = array( 'id' => 'late',  'title' => 'Late',  'position' => 50 );
				$items[] = array( 'id' => 'early', 'title' => 'Early', 'position' => 5 );
				$items[] = array( 'id' => 'mid',   'title' => 'Mid',   'position' => 20 );
				return $items;
			}
		);

		$bar  = $this->build_admin_bar();
		$menu = $bar->get_node( 'desktop-layout-menu' );
		$this->assertNotNull( $menu );

		// Read children in registration-plus-sort order from the bar.
		$ids = array();
		foreach ( $bar->get_nodes() as $n ) {
			if ( $n->parent === 'desktop-layout-menu' && strpos( $n->id, 'desktop-layout-custom-' ) === 0 ) {
				$ids[] = $n->id;
			}
		}

		$this->assertSame(
			array(
				'desktop-layout-custom-early',
				'desktop-layout-custom-mid',
				'desktop-layout-custom-late',
			),
			$ids
		);
	}

	/**
	 * The filter only runs when the Arrange menu is actually built —
	 * i.e., the user is viewing the desktop shell. On classic admin
	 * the filter is never invoked so plugins don't waste cycles.
	 *
	 * @covers ::openstation_admin_bar_toggle
	 */
	public function test_arrange_menu_filter_not_invoked_in_classic_admin() {
		wp_set_current_user( self::$admin_id );
		// Default: desktop meta off → classic admin.
		$invocations = 0;
		add_filter(
			'openstation_arrange_menu_items',
			function ( $items ) use ( &$invocations ) {
				$invocations++;
				return $items;
			}
		);

		$this->build_admin_bar();

		$this->assertSame( 0, $invocations );
	}

	/**
	 * The shipped click router must know how to recognise a
	 * plugin-registered item. The router lives in
	 * `assets/js/admin-bar.js` (extracted from inline PHP for wp.org
	 * compliance). We assert the prefix check + custom-action dispatch
	 * are both present in that file.
	 */
	public function test_toggle_assets_route_custom_arrange_items() {
		$js_path = dirname( __DIR__, 3 ) . '/assets/js/admin-bar.js';
		$this->assertFileExists( $js_path );

		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- test-only file read.
		$js = (string) file_get_contents( $js_path );

		$this->assertStringContainsString( 'wp-admin-bar-desktop-layout-custom-', $js );
		$this->assertStringContainsString( 'os.arrange.custom-action', $js );
	}
}
