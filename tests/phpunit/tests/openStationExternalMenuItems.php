<?php
/**
 * Tests for how the dock payload treats admin-menu entries that point
 * off-site, and for the wp-admin originals a host leaves behind when it
 * swaps one in.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 *
 * @covers ::openstation_build_dock_items
 * @covers ::openstation_menu_item_is_external
 * @covers ::openstation_menu_item_is_hidden
 */
class Tests_OpenStation_ExternalMenuItems extends WP_UnitTestCase {

	protected static $admin_id;

	protected $original_menu;
	protected $original_submenu;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );

		// On multisite a plain administrator lacks the super-admin-only
		// capabilities these tests exercise (update_core, edit_users,
		// activate_plugins and friends). The admin fixture means "the
		// fully-capable admin", which multisite spells super admin.
		if ( is_multisite() ) {
			grant_super_admin( self::$admin_id );
		}
	}

	public function set_up() {
		parent::set_up();
		global $menu, $submenu;
		$this->original_menu    = $menu;
		$this->original_submenu = $submenu;
		$menu                   = array();
		$submenu                = array();
		wp_set_current_user( self::$admin_id );
	}

	public function tear_down() {
		global $menu, $submenu;
		$menu    = $this->original_menu;
		$submenu = $this->original_submenu;

		$map = &openstation_menu_attribution_map();
		$map = array();

		$icons = &openstation_menu_icon_snapshot();
		$icons = array();

		remove_all_filters( 'openstation_menu_item_is_external' );
		remove_all_filters( 'openstation_dock_item' );
		parent::tear_down();
	}

	private function make_menu_row( $title, $cap, $slug, $page_title = '', $classes = '', $hookname = '', $icon = 'dashicons-admin-post' ) {
		return array(
			$title,
			$cap,
			$slug,
			$page_title,
			$classes,
			$hookname ? $hookname : 'menu-' . sanitize_key( str_replace( '.', '-', $slug ) ),
			$icon,
		);
	}

	/** Make `$slug` resolve to a regular plugin, the way the admin_menu tracker would. */
	private function attribute_to_plugin( $slug, $plugin_file = 'my-plugin/my-plugin.php' ) {
		$map          = &openstation_menu_attribution_map();
		$map[ $slug ] = $plugin_file;
	}

	public function test_site_urls_are_not_external() {
		$this->assertFalse( openstation_menu_item_is_external( admin_url( 'edit.php' ) ) );
		$this->assertFalse( openstation_menu_item_is_external( home_url( '/' ) ) );
	}

	public function test_off_site_url_is_external() {
		$this->assertTrue(
			openstation_menu_item_is_external( 'https://wordpress.com/home/example.com' )
		);
	}

	public function test_external_filter_can_reclassify_a_url() {
		add_filter( 'openstation_menu_item_is_external', '__return_false' );
		$this->assertFalse(
			openstation_menu_item_is_external( 'https://wordpress.com/home/example.com' )
		);
	}

	public function test_top_level_menu_pointing_off_site_is_dropped() {
		global $menu;
		$menu = array(
			$this->make_menu_row( 'Posts', 'edit_posts', 'edit.php' ),
			$this->make_menu_row( 'My Home', 'read', 'https://wordpress.com/home/example.com' ),
		);

		$items = openstation_build_dock_items();

		$this->assertCount( 1, $items );
		$this->assertSame( 'Posts', $items[0]['title'] );
	}

	public function test_off_site_submenu_of_a_core_menu_is_dropped() {
		global $menu, $submenu;
		$menu                 = array( $this->make_menu_row( 'Tools', 'edit_posts', 'tools.php' ) );
		$submenu['tools.php'] = array(
			array( 'Available Tools', 'edit_posts', 'tools.php' ),
			array( 'Hosting', 'manage_options', 'https://wordpress.com/hosting/example.com' ),
			array( 'Import', 'import', 'import.php' ),
		);

		$items = openstation_build_dock_items();

		$titles = wp_list_pluck( $items[0]['submenu'], 'title' );
		$this->assertSame( array( 'Import' ), $titles );
	}

	public function test_off_site_submenu_of_a_plugin_menu_is_kept_and_flagged() {
		global $menu, $submenu;
		$this->attribute_to_plugin( 'my-plugin' );

		$menu                = array( $this->make_menu_row( 'My Plugin', 'manage_options', 'my-plugin' ) );
		$submenu['my-plugin'] = array(
			array( 'Settings', 'manage_options', 'my-plugin' ),
			array( 'Help', 'manage_options', 'https://example.org/docs' ),
		);

		$items = openstation_build_dock_items();

		$this->assertCount( 1, $items[0]['submenu'] );
		$this->assertSame( 'Help', $items[0]['submenu'][0]['title'] );
		$this->assertTrue( $items[0]['submenu'][0]['offSite'] );
	}

	public function test_internal_submenu_is_not_flagged_off_site() {
		global $menu, $submenu;
		$menu                = array( $this->make_menu_row( 'Posts', 'edit_posts', 'edit.php' ) );
		$submenu['edit.php'] = array(
			array( 'All Posts', 'edit_posts', 'edit.php' ),
			array( 'Add New', 'edit_posts', 'post-new.php' ),
		);

		$items = openstation_build_dock_items();

		$this->assertArrayNotHasKey( 'offSite', $items[0]['submenu'][0] );
	}

	public function test_off_site_submenu_never_becomes_the_parent_url() {
		global $menu, $submenu;
		$this->attribute_to_plugin( 'my-plugin' );

		$menu                 = array( $this->make_menu_row( 'My Plugin', 'manage_options', 'my-plugin' ) );
		$submenu['my-plugin'] = array(
			array( 'Upgrade', 'manage_options', 'https://example.org/pricing' ),
			array( 'Settings', 'manage_options', 'my-plugin-settings' ),
		);

		$items = openstation_build_dock_items();

		$this->assertSame(
			admin_url( 'admin.php?page=my-plugin-settings' ),
			$items[0]['url']
		);
	}

	public function test_hidden_submenu_entries_are_dropped() {
		global $menu, $submenu;
		$menu                 = array( $this->make_menu_row( 'Tools', 'edit_posts', 'tools.php' ) );
		$submenu['tools.php'] = array(
			array( 'Available Tools', 'edit_posts', 'tools.php' ),
			array( 'Import', 'import', 'import.php', '', 'hide-if-js' ),
		);

		$items = openstation_build_dock_items();

		$this->assertSame( array(), $items[0]['submenu'] );
	}

	public function test_hidden_original_is_restored_when_its_off_site_replacement_is_dropped() {
		global $menu, $submenu;
		// The shape Jetpack leaves behind on WordPress.com: the wp-admin
		// row marked `hide-if-js`, a Calypso duplicate carrying the same
		// label added in front of it.
		$menu                  = array( $this->make_menu_row( 'Appearance', 'switch_themes', 'themes.php' ) );
		$submenu['themes.php'] = array(
			array( 'Themes', 'switch_themes', 'https://wordpress.com/themes/example.com' ),
			array( 'Editor', 'edit_theme_options', 'site-editor.php' ),
			array( 'Themes', 'switch_themes', 'themes.php', '', 'hide-if-js' ),
		);

		$items = openstation_build_dock_items();

		// The restored row is the parent's own page, so it collapses
		// into `selfLabel` rather than becoming a child.
		$this->assertSame( 'Themes', $items[0]['selfLabel'] );
		$this->assertSame( admin_url( 'themes.php' ), $items[0]['url'] );
		// `Add Theme` is OpenStation's own injected Appearance tab.
		$titles = wp_list_pluck( $items[0]['submenu'], 'title' );
		$this->assertContains( 'Editor', $titles );
		$this->assertNotContains( 'Themes', $titles );
	}

	public function test_hidden_original_restores_a_child_page() {
		global $menu, $submenu;
		$menu                   = array( $this->make_menu_row( 'Plugins', 'activate_plugins', 'plugins.php' ) );
		$submenu['plugins.php'] = array(
			array( 'Installed Plugins', 'activate_plugins', 'plugins.php' ),
			array( 'Add New Plugin', 'install_plugins', 'https://wordpress.com/plugins/example.com' ),
			array( 'Add New Plugin', 'install_plugins', 'plugin-install.php', '', 'hide-if-js' ),
		);

		$items = openstation_build_dock_items();

		$this->assertSame(
			array( 'Add New Plugin' ),
			wp_list_pluck( $items[0]['submenu'], 'title' )
		);
		$this->assertSame(
			admin_url( 'plugin-install.php' ),
			$items[0]['submenu'][0]['url']
		);
	}

	public function test_top_level_menu_pointing_off_site_falls_back_to_its_restored_child() {
		global $menu, $submenu;
		// `Base_Admin_Menu::update_menu()` rewrites the top-level slug
		// itself when the menu has no visible children left, hiding the
		// self-link on the way past.
		$menu                   = array( $this->make_menu_row( 'Plugins', 'activate_plugins', 'https://wordpress.com/plugins/example.com' ) );
		$submenu['https://wordpress.com/plugins/example.com'] = array(
			array( 'Plugins', 'activate_plugins', 'plugins.php', '', 'hide-if-js' ),
		);

		$items = openstation_build_dock_items();

		$this->assertCount( 1, $items );
		$this->assertSame( admin_url( 'plugins.php' ), $items[0]['url'] );
		$this->assertSame( 'Plugins', $items[0]['selfLabel'] );
	}

	public function test_restored_child_does_not_steal_the_parent_url() {
		global $menu, $submenu;
		// The Plugins shape on WordPress.com: Jetpack moves Add New to
		// the top, points it at Calypso, and leaves the wp-admin row
		// behind at the end of the list. Restoring it must not make
		// "Plugins" open the installer.
		$menu                   = array( $this->make_menu_row( 'Plugins', 'activate_plugins', 'plugins.php' ) );
		$submenu['plugins.php'] = array(
			array( 'Add Plugin', 'install_plugins', 'https://wordpress.com/plugins/example.com' ),
			array( 'Installed Plugins', 'activate_plugins', 'plugins.php' ),
			array( 'Add Plugin', 'install_plugins', 'plugin-install.php', '', 'hide-if-js' ),
		);

		$items = openstation_build_dock_items();

		$this->assertSame( admin_url( 'plugins.php' ), $items[0]['url'] );
		$this->assertSame( 'Installed Plugins', $items[0]['selfLabel'] );
		$this->assertSame(
			array( 'Add Plugin' ),
			wp_list_pluck( $items[0]['submenu'], 'title' )
		);
	}

	public function test_container_menu_whose_children_were_all_off_site_is_dropped() {
		global $menu, $submenu;
		// The WordPress.com Upgrades shape: `add_menu_page()` with a
		// null callback, its self-link removed, and every child a
		// wordpress.com URL. Keeping the tile would point it at core's
		// "Cannot load paid-upgrades.php." page.
		$menu = array(
			$this->make_menu_row( 'Posts', 'edit_posts', 'edit.php' ),
			$this->make_menu_row( 'Upgrades', 'manage_options', 'paid-upgrades.php' ),
		);
		$submenu['paid-upgrades.php'] = array(
			array( 'Plans', 'manage_options', 'https://wordpress.com/plans/example.com' ),
			array( 'Domains', 'manage_options', 'https://wordpress.com/domains/manage/example.com' ),
		);

		$items = openstation_build_dock_items();

		$this->assertSame( array( 'Posts' ), wp_list_pluck( $items, 'title' ) );
	}

	public function test_container_menu_keeps_an_on_site_child_to_stand_in() {
		global $menu, $submenu;
		$menu                         = array( $this->make_menu_row( 'Upgrades', 'manage_options', 'paid-upgrades.php' ) );
		$submenu['paid-upgrades.php'] = array(
			array( 'Plans', 'manage_options', 'https://wordpress.com/plans/example.com' ),
			array( 'Receipts', 'manage_options', 'my-receipts' ),
		);

		$items = openstation_build_dock_items();

		$this->assertCount( 1, $items );
		$this->assertSame( admin_url( 'admin.php?page=my-receipts' ), $items[0]['url'] );
	}

	public function test_container_menu_with_a_registered_page_is_kept() {
		global $menu, $submenu;
		// Same shape, but something is listening on the page hook — the
		// menu renders, so it keeps its tile even with no children left.
		$menu                    = array( $this->make_menu_row( 'My Plugin', 'manage_options', 'my-plugin' ) );
		$submenu['my-plugin']    = array(
			array( 'Account', 'manage_options', 'https://example.org/account' ),
		);
		$hookname = get_plugin_page_hookname( 'my-plugin', '' );
		add_action( $hookname, '__return_null' );

		try {
			$items = openstation_build_dock_items();
		} finally {
			remove_action( $hookname, '__return_null' );
		}

		$this->assertCount( 1, $items );
		$this->assertSame( admin_url( 'admin.php?page=my-plugin' ), $items[0]['url'] );
	}

	public function test_container_check_leaves_menus_without_off_site_children_alone() {
		global $menu;
		// No off-site row was dropped here, so the container check never
		// runs and a callback-less menu keeps behaving as it always did.
		$menu = array( $this->make_menu_row( 'Empty', 'manage_options', 'empty-menu' ) );

		$items = openstation_build_dock_items();

		$this->assertCount( 1, $items );
		$this->assertSame( admin_url( 'admin.php?page=empty-menu' ), $items[0]['url'] );
	}

	public function test_rescued_tile_takes_the_identity_of_the_slug_it_adopted() {
		global $menu, $submenu;
		// Identity has to move with the URL. Left on the off-site slug,
		// this reads as a plugin menu owned by whoever registered the
		// replacement, and sorts away from the Core tiles.
		$this->attribute_to_plugin( 'https://wordpress.com/plugins/example.com', 'jetpack/jetpack.php' );

		$menu = array( $this->make_menu_row( 'Plugins', 'activate_plugins', 'https://wordpress.com/plugins/example.com' ) );
		$submenu['https://wordpress.com/plugins/example.com'] = array(
			array( 'Plugins', 'activate_plugins', 'plugins.php', '', 'hide-if-js' ),
		);

		$items = openstation_build_dock_items();

		$this->assertCount( 1, $items );
		$this->assertTrue( $items[0]['isCore'] );
		$this->assertNull( $items[0]['pluginFile'] );
		$this->assertNull( $items[0]['pluginName'] );
	}

	public function test_rescued_tile_reports_the_adopted_slug_to_the_dock_item_filter() {
		global $menu, $submenu;
		$seen = array();
		add_filter(
			'openstation_dock_item',
			static function ( $dock_item, $menu_slug ) use ( &$seen ) {
				$seen[] = $menu_slug;
				return $dock_item;
			},
			10,
			2
		);

		$menu = array( $this->make_menu_row( 'Plugins', 'activate_plugins', 'https://wordpress.com/plugins/example.com' ) );
		$submenu['https://wordpress.com/plugins/example.com'] = array(
			array( 'Plugins', 'activate_plugins', 'plugins.php', '', 'hide-if-js' ),
		);

		try {
			openstation_build_dock_items();
		} finally {
			remove_all_filters( 'openstation_dock_item' );
		}

		$this->assertSame( array( 'plugins.php' ), $seen );
	}

	public function test_off_site_parent_restores_its_own_row_by_label() {
		global $menu, $submenu;
		$menu = array( $this->make_menu_row( 'Plugins', 'activate_plugins', 'https://wordpress.com/plugins/example.com' ) );
		$submenu['https://wordpress.com/plugins/example.com'] = array(
			array( 'Plugins', 'activate_plugins', 'plugins.php', '', 'hide-if-js' ),
			array( 'Plugin File Editor', 'edit_plugins', 'plugin-editor.php', '', 'hide-if-js' ),
		);

		$items = openstation_build_dock_items();

		// The label match picks the menu's own row, not whichever hidden
		// row happens to come first.
		$this->assertCount( 1, $items );
		$this->assertSame( admin_url( 'plugins.php' ), $items[0]['url'] );
		$this->assertSame( array(), $items[0]['submenu'] );
	}

	public function test_off_site_parent_falls_back_to_any_hidden_on_site_row() {
		global $menu, $submenu;
		// A host that relabelled the menu row without relabelling the
		// self-link it had already generated. Nothing matches by label,
		// and dropping the menu would lose a page that works.
		$menu = array( $this->make_menu_row( 'Manage plugins', 'activate_plugins', 'https://wordpress.com/plugins/example.com' ) );
		$submenu['https://wordpress.com/plugins/example.com'] = array(
			array( 'Plugins', 'activate_plugins', 'plugins.php', '', 'hide-if-js' ),
		);

		$items = openstation_build_dock_items();

		$this->assertCount( 1, $items );
		$this->assertSame( admin_url( 'plugins.php' ), $items[0]['url'] );
		$this->assertTrue( $items[0]['isCore'] );
	}

	public function test_off_site_parent_prefers_an_on_site_child_over_a_hidden_row() {
		global $menu, $submenu;
		// A visible on-site child is a better stand-in than a row
		// someone hid, so the fallback stays out of the way.
		$menu = array( $this->make_menu_row( 'Manage plugins', 'activate_plugins', 'https://wordpress.com/plugins/example.com' ) );
		$submenu['https://wordpress.com/plugins/example.com'] = array(
			array( 'Plugins', 'activate_plugins', 'plugins.php', '', 'hide-if-js' ),
			array( 'Add Plugin', 'install_plugins', 'plugin-install.php' ),
		);

		$items = openstation_build_dock_items();

		$this->assertCount( 1, $items );
		$this->assertSame( admin_url( 'plugin-install.php' ), $items[0]['url'] );
	}

	public function test_hidden_top_level_menu_is_dropped() {
		global $menu;
		$menu = array(
			$this->make_menu_row( 'Posts', 'edit_posts', 'edit.php' ),
			$this->make_menu_row( 'Gone', 'read', 'gone', '', 'menu-top hide-if-js' ),
		);

		$items = openstation_build_dock_items();

		$this->assertSame( array( 'Posts' ), wp_list_pluck( $items, 'title' ) );
	}

	public function test_blanked_icon_falls_back_to_the_snapshot() {
		global $menu;
		$svg  = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
		$menu = array( $this->make_menu_row( 'Jetpack', 'manage_options', 'jetpack', '', '', '', $svg ) );

		// Snapshot while the icon is still an icon, then let something
		// on `admin_menu` blank it the way Jetpack's SVG override does.
		openstation_snapshot_menu_icons();
		$menu[0][6] = 'none';

		$items = openstation_build_dock_items();

		$this->assertSame( $svg, $items[0]['icon'] );
	}

	public function test_snapshot_keeps_the_first_icon_a_slug_wore() {
		global $menu;
		$svg  = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
		$menu = array( $this->make_menu_row( 'Thing', 'manage_options', 'thing', '', '', '', $svg ) );

		// Sampled once while the icon is real, again after a rewrite —
		// the second pass must not record the blank over the first.
		openstation_snapshot_menu_icons();
		$menu[0][6] = 'none';
		openstation_snapshot_menu_icons();

		$items = openstation_build_dock_items();

		$this->assertSame( $svg, $items[0]['icon'] );
	}

	public function test_live_icon_wins_over_the_snapshot() {
		global $menu;
		$menu = array( $this->make_menu_row( 'Thing', 'manage_options', 'thing', '', '', '', 'dashicons-cart' ) );

		openstation_snapshot_menu_icons();
		// A menu that genuinely swaps its icon still ships the new one;
		// the snapshot is a fallback, not an override.
		$menu[0][6] = 'dashicons-chart-bar';

		$items = openstation_build_dock_items();

		$this->assertSame( 'dashicons-chart-bar', $items[0]['icon'] );
	}

	public function test_blanked_icon_without_a_snapshot_stays_generic() {
		global $menu;
		$menu = array( $this->make_menu_row( 'Jetpack', 'manage_options', 'jetpack', '', '', '', 'none' ) );

		$items = openstation_build_dock_items();

		$this->assertSame( 'dashicons-admin-generic', $items[0]['icon'] );
	}
}
