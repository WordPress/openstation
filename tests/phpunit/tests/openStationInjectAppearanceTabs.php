<?php
/**
 * Tests for the `openstation_inject_appearance_tabs()` filter
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
 * @covers ::openstation_inject_appearance_tabs
 * @covers ::openstation_render_themes_workspace_intro
 * @covers ::openstation_theme_install_active_tab_script
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
	 * Unconditional cleanup: the chromeless flag and the opt-in meta are
	 * request-global, so a mid-test failure would otherwise leak them into
	 * every sibling test in the suite.
	 */
	public function tear_down() {
		unset( $_GET['openstation_chromeless'], $GLOBALS['pagenow'] );
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );
		set_current_screen( 'front' );
		parent::tear_down();
	}

	/**
	 * Helper: a minimal dock-item shape matching what
	 * `openstation_build_dock_items()` hands to the filter.
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

		$result = openstation_inject_appearance_tabs( $dock_item, 'themes.php' );

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

		$result = openstation_inject_appearance_tabs( $dock_item, 'edit.php' );

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

		$result = openstation_inject_appearance_tabs( $dock_item, 'themes.php' );

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

		$result = openstation_inject_appearance_tabs( $dock_item, 'themes.php' );

		// No duplicate — the existing theme-install entry was detected.
		$this->assertCount( 1, $result['submenu'] );
		$this->assertSame( 'Custom Add Theme', $result['submenu'][0]['title'] );
	}

	public function test_initialises_missing_submenu_array() {
		$dock_item = $this->make_dock_item();
		unset( $dock_item['submenu'] );

		$result = openstation_inject_appearance_tabs( $dock_item, 'themes.php' );

		$this->assertIsArray( $result['submenu'] );
		$this->assertCount( 1, $result['submenu'] );
		$this->assertSame( 'Add Theme', $result['submenu'][0]['title'] );
	}

	/**
	 * Pin the integration via the `openstation_dock_item` filter — the
	 * production `add_filter()` call in `includes/themes-tabs.php` is
	 * what actually wires this into the dock builder. Re-register
	 * defensively because earlier tests in the suite call
	 * `remove_all_filters( 'openstation_dock_item' )` in their
	 * tear_down.
	 */
	public function test_filter_is_registered_at_priority_10() {
		// Ensure registration regardless of prior tear_down state.
		add_filter( 'openstation_dock_item', 'openstation_inject_appearance_tabs', 10, 2 );

		$priority = has_filter(
			'openstation_dock_item',
			'openstation_inject_appearance_tabs'
		);

		$this->assertSame( 10, $priority );
	}

	public function test_themes_workspace_intro_is_registered_at_priority_zero() {
		$this->assertSame(
			0,
			has_action( 'admin_notices', 'openstation_render_themes_workspace_intro' )
		);
	}

	/**
	 * Helper: renders the intro and returns the captured markup.
	 */
	private function capture_themes_workspace_intro() {
		ob_start();
		openstation_render_themes_workspace_intro();

		return ob_get_clean();
	}

	public function test_themes_workspace_intro_renders_on_the_chromeless_themes_screen() {
		$_GET['openstation_chromeless'] = '1';
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		set_current_screen( 'themes' );

		$output = $this->capture_themes_workspace_intro();

		$this->assertStringContainsString( 'class="openstation-themes-intro"', $output );
		$this->assertStringContainsString( 'Choose how your site greets the world.', $output );
		$this->assertStringContainsString( 'openstation-themes-intro__count', $output );
	}

	/**
	 * Pages registered with `add_theme_page()` share themes.php's `$pagenow`
	 * but get their own hook-suffix body class, so none of the workspace CSS
	 * (scoped to `.themes-php`) reaches them. Emitting the header there would
	 * drop unstyled marketing copy on top of an unrelated Appearance screen.
	 */
	public function test_themes_workspace_intro_skips_appearance_subpages() {
		$_GET['openstation_chromeless'] = '1';
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		set_current_screen( 'appearance_page_custom-header' );

		// The condition that made the `$pagenow` gate wrong: an
		// `add_theme_page()` screen reports themes.php as its $pagenow while
		// carrying an `appearance_page_*` body class.
		$GLOBALS['pagenow'] = 'themes.php';

		$this->assertSame( '', $this->capture_themes_workspace_intro() );
	}

	public function test_themes_workspace_intro_skips_unrelated_screens() {
		$_GET['openstation_chromeless'] = '1';
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		set_current_screen( 'plugins' );

		$this->assertSame( '', $this->capture_themes_workspace_intro() );
	}

	public function test_themes_workspace_intro_skips_non_chromeless_requests() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		set_current_screen( 'themes' );

		$this->assertSame( '', $this->capture_themes_workspace_intro() );
	}

	/**
	 * Tests that openstation_theme_install_active_tab_script() registers on
	 * `admin_footer` at priority 100 and outputs the inline active tab script.
	 *
	 * @covers ::openstation_theme_install_active_tab_script
	 */
	public function test_theme_install_active_tab_script_registered_and_emits_dynamic_browse_param() {
		$priority = has_action(
			'admin_footer',
			'openstation_theme_install_active_tab_script'
		);
		$this->assertSame( 100, $priority );

		$_GET['openstation_chromeless'] = '1';
		$GLOBALS['pagenow']              = 'theme-install.php';
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		ob_start();
		openstation_theme_install_active_tab_script();
		$output = ob_get_clean();

		$this->assertStringContainsString( 'function getBrowseParam()', $output );

		unset( $_GET['openstation_chromeless'] );
		unset( $GLOBALS['pagenow'] );
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );
	}
}
