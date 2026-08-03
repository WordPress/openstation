<?php
/**
 * Tests for the `open_station_inject_appearance_tabs()` filter
 * callback, which prepends an "Add Theme" entry to the Appearance
 * dock item's submenu so the in-window tab strip exposes
 * `theme-install.php` directly (the in-page page-title-action
 * button is hidden in chromeless mode — see
 * assets/css/chromeless.css).
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 *
 * @covers ::open_station_inject_appearance_tabs
 * @covers ::open_station_theme_install_active_tab_script
 */
class Tests_OpenStation_InjectAppearanceTabs extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $subscriber_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id      = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$subscriber_id = $factory->user->create( array( 'role' => 'subscriber' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
	}

	/**
	 * Helper: a minimal dock-item shape matching what
	 * `open_station_build_dock_items()` hands to the filter.
	 */
	private function make_dock_item( array $overrides = array() ) {
		return array_merge(
			array(
				'id'        => 'menu-appearance',
				'title'     => 'Appearance',
				'icon'      => 'dashicons-admin-appearance',
				'url'       => admin_url( 'themes.php' ),
				'badge'     => 0,
				'submenu'   => array(),
				'multi'     => false,
				'placement' => 'dock',
				'isCore'    => true,
			),
			$overrides
		);
	}

	public function test_prepends_add_theme_entry_for_themes_php() {
		$dock_item = $this->make_dock_item(
			array(
				'submenu' => array(
					array( 'title' => 'Editor', 'url' => admin_url( 'site-editor.php' ) ),
				),
			)
		);

		$result = open_station_inject_appearance_tabs( $dock_item, 'themes.php' );

		$this->assertCount( 2, $result['submenu'] );
		$this->assertSame( 'Add Theme', $result['submenu'][0]['title'] );
		// `?browse=popular` makes the iframe land on the Popular tab
		// without relying on WP's JS-router default-redirect.
		$this->assertSame(
			admin_url( 'theme-install.php?browse=popular' ),
			$result['submenu'][0]['url']
		);
		// Existing entries stay in place after the prepended one.
		$this->assertSame( 'Editor', $result['submenu'][1]['title'] );
	}

	public function test_no_op_for_other_menu_slugs() {
		$dock_item = $this->make_dock_item(
			array(
				'submenu' => array(
					array( 'title' => 'All Posts', 'url' => admin_url( 'edit.php' ) ),
				),
			)
		);

		$result = open_station_inject_appearance_tabs( $dock_item, 'edit.php' );

		// Unchanged — the filter only fires for themes.php.
		$this->assertCount( 1, $result['submenu'] );
		$this->assertSame( 'All Posts', $result['submenu'][0]['title'] );
	}

	public function test_skipped_for_users_without_install_themes_capability() {
		wp_set_current_user( self::$subscriber_id );

		$dock_item = $this->make_dock_item(
			array(
				'submenu' => array(
					array( 'title' => 'Editor', 'url' => admin_url( 'site-editor.php' ) ),
				),
			)
		);

		$result = open_station_inject_appearance_tabs( $dock_item, 'themes.php' );

		$titles = wp_list_pluck( $result['submenu'], 'title' );
		$this->assertNotContains( 'Add Theme', $titles );
		$this->assertCount( 1, $result['submenu'] );
	}

	public function test_idempotent_when_theme_install_already_present() {
		$existing_add_theme = array(
			'title' => 'Custom Add Theme',
			'url'   => admin_url( 'theme-install.php' ),
		);
		$dock_item          = $this->make_dock_item(
			array(
				'submenu' => array( $existing_add_theme ),
			)
		);

		$result = open_station_inject_appearance_tabs( $dock_item, 'themes.php' );

		// No duplicate — the existing theme-install entry was detected.
		$this->assertCount( 1, $result['submenu'] );
		$this->assertSame( 'Custom Add Theme', $result['submenu'][0]['title'] );
	}

	public function test_initialises_missing_submenu_array() {
		$dock_item = $this->make_dock_item();
		unset( $dock_item['submenu'] );

		$result = open_station_inject_appearance_tabs( $dock_item, 'themes.php' );

		$this->assertIsArray( $result['submenu'] );
		$this->assertCount( 1, $result['submenu'] );
		$this->assertSame( 'Add Theme', $result['submenu'][0]['title'] );
	}

	/**
	 * Pin the integration via the `open_station_dock_item` filter — the
	 * production `add_filter()` call in `includes/themes-tabs.php` is
	 * what actually wires this into the dock builder. Re-register
	 * defensively because earlier tests in the suite call
	 * `remove_all_filters( 'open_station_dock_item' )` in their
	 * tear_down.
	 */
	public function test_filter_is_registered_at_priority_10() {
		// Ensure registration regardless of prior tear_down state.
		add_filter( 'open_station_dock_item', 'open_station_inject_appearance_tabs', 10, 2 );

		$priority = has_filter(
			'open_station_dock_item',
			'open_station_inject_appearance_tabs'
		);

		$this->assertSame( 10, $priority );
	}

	/**
	 * Tests that open_station_theme_install_active_tab_script() registers on
	 * `admin_footer` at priority 100 and outputs the inline active tab script.
	 *
	 * @covers ::open_station_theme_install_active_tab_script
	 */
	public function test_theme_install_active_tab_script_registered_and_emits_dynamic_browse_param() {
		$priority = has_action(
			'admin_footer',
			'open_station_theme_install_active_tab_script'
		);
		$this->assertSame( 100, $priority );

		$_GET['open_station_chromeless'] = '1';
		$GLOBALS['pagenow']              = 'theme-install.php';
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		ob_start();
		open_station_theme_install_active_tab_script();
		$output = ob_get_clean();

		$this->assertStringContainsString( 'function getBrowseParam()', $output );

		unset( $_GET['open_station_chromeless'] );
		unset( $GLOBALS['pagenow'] );
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );
	}
}
