<?php

class Tests_OpenStation_BuildDockItems extends WP_UnitTestCase {

	protected static $admin_id;

	protected $original_menu;
	protected $original_submenu;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );

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
		openstation_flush_script_handle_registries();
	}

	public function tear_down() {
		global $menu, $submenu;
		$menu    = $this->original_menu;
		$submenu = $this->original_submenu;
		remove_all_filters( 'openstation_dock_items' );
		remove_all_filters( 'openstation_dock_item' );
		remove_all_filters( 'openstation_dock_placement' );
		parent::tear_down();
	}

	private function make_menu_row( $title, $cap, $slug, $page_title = '', $classes = '', $hookname = '', $icon = 'dashicons-admin-post' ) {
		return array(
			$title,
			$cap,
			$slug,
			$page_title,
			$classes,
			$hookname ?: 'menu-' . sanitize_key( str_replace( '.', '-', $slug ) ),
			$icon,
		);
	}

	public function test_returns_empty_array_when_menu_globals_are_empty() {
		global $menu;
		$menu = array();
		$this->assertSame( array(), openstation_build_dock_items() );
	}

	public function test_skips_separators() {
		global $menu;
		$menu = array(
			array( '', 'read', 'separator1', '', 'wp-menu-separator' ),
			$this->make_menu_row( 'Posts', 'edit_posts', 'edit.php' ),
		);

		$items = openstation_build_dock_items();

		$this->assertCount( 1, $items );
		$this->assertSame( 'Posts', $items[0]['title'] );
	}

	public function test_skips_items_with_empty_slug() {
		global $menu;
		$menu = array(
			array( 'No Slug', 'read', '', '', '', 'menu-noslug', '' ),
			$this->make_menu_row( 'Posts', 'edit_posts', 'edit.php' ),
		);

		$items = openstation_build_dock_items();

		$this->assertCount( 1, $items );
		$this->assertSame( 'Posts', $items[0]['title'] );
	}

	public function test_filters_items_by_capability() {
		global $menu;

		$subscriber_id = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		wp_set_current_user( $subscriber_id );

		$menu = array(
			$this->make_menu_row( 'Read', 'read', 'index.php' ),
			$this->make_menu_row( 'Settings', 'manage_options', 'options-general.php' ),
		);

		$items = openstation_build_dock_items();

		$titles = wp_list_pluck( $items, 'title' );
		$this->assertContains( 'Read', $titles );
		$this->assertNotContains( 'Settings', $titles );
	}

	public function test_extracts_update_badge_and_strips_span_from_title() {
		global $menu;
		$menu = array(
			array(
				'Appearance <span class="update-plugins count-3"><span class="theme-count">3</span></span>',
				'switch_themes',
				'themes.php',
				'',
				'',
				'menu-appearance',
				'dashicons-admin-appearance',
			),
		);

		$items = openstation_build_dock_items();

		$this->assertSame( 'Appearance', $items[0]['title'] );
		$this->assertSame( 3, $items[0]['badge'] );
	}

	public function test_plugins_dock_badge_recomputed_from_installed_plugin_intersection() {
		if ( is_multisite() ) {
			$this->markTestSkipped( 'Plugins menu badge is suppressed on multisite by Core.' );
		}

		global $menu;

		$menu = array(
			array(
				'Plugins <span class="update-plugins count-3"><span class="plugin-count">3</span></span>',
				'activate_plugins',
				'plugins.php',
				'',
				'',
				'menu-plugins',
				'dashicons-admin-plugins',
			),
		);

		require_once ABSPATH . 'wp-admin/includes/plugin.php';
		$installed = get_plugins();

		$this->assertArrayHasKey( 'desktop-mode/desktop-mode.php', $installed );

		set_site_transient(
			'update_plugins',
			(object) array(
				'last_checked' => time(),
				'response'     => array(
					'desktop-mode/desktop-mode.php'   => (object) array(
						'new_version' => '999.0.0',
						'package'     => '',
						'slug'        => 'desktop-mode',
					),
					'orphan-one/orphan-one.php'       => (object) array(
						'new_version' => '1.0.0',
						'package'     => '',
						'slug'        => 'orphan-one',
					),
					'orphan-two/orphan-two.php'       => (object) array(
						'new_version' => '1.0.0',
						'package'     => '',
						'slug'        => 'orphan-two',
					),
				),
			)
		);

		try {
			$items = openstation_build_dock_items();
			$this->assertSame( 1, $items[0]['badge'] );
		} finally {
			delete_site_transient( 'update_plugins' );
		}
	}

	public function test_plugins_dock_badge_is_zero_when_transient_is_empty() {
		if ( is_multisite() ) {
			$this->markTestSkipped( 'Plugins menu badge is suppressed on multisite by Core.' );
		}

		global $menu;
		$menu = array(
			array(
				'Plugins <span class="update-plugins count-2"><span class="plugin-count">2</span></span>',
				'activate_plugins',
				'plugins.php',
				'',
				'',
				'menu-plugins',
				'dashicons-admin-plugins',
			),
		);

		delete_site_transient( 'update_plugins' );

		$items = openstation_build_dock_items();
		$this->assertSame( 0, $items[0]['badge'] );
	}

	public function test_no_badge_when_count_class_missing() {
		global $menu;
		$menu = array( $this->make_menu_row( 'Posts', 'edit_posts', 'edit.php' ) );

		$items = openstation_build_dock_items();
		$this->assertSame( 0, $items[0]['badge'] );
	}

	public function test_falls_back_to_generic_icon_when_unset() {
		global $menu;
		$menu = array(

			array( 'Custom', 'read', 'custom.php', '', '', 'menu-custom', '' ),
		);

		$items = openstation_build_dock_items();
		$this->assertSame( 'dashicons-admin-generic', $items[0]['icon'] );
	}

	public function test_includes_submenu_items_user_can_access() {
		global $menu, $submenu;
		$menu               = array( $this->make_menu_row( 'Posts', 'edit_posts', 'edit.php' ) );
		$submenu['edit.php'] = array(

			array( 'All Posts', 'edit_posts', 'edit.php' ),
			array( 'Add New', 'edit_posts', 'post-new.php' ),
			array( 'Tags', 'manage_categories', 'edit-tags.php?taxonomy=post_tag' ),
		);

		$items = openstation_build_dock_items();

		$this->assertCount( 2, $items[0]['submenu'] );
		$titles = wp_list_pluck( $items[0]['submenu'], 'title' );
		$this->assertSame( array( 'Add New', 'Tags' ), $titles );
	}

	public function test_filters_submenu_by_capability() {
		global $menu, $submenu;
		$subscriber_id = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		wp_set_current_user( $subscriber_id );

		$menu                = array( $this->make_menu_row( 'Posts', 'read', 'edit.php' ) );
		$submenu['edit.php'] = array(
			array( 'All Posts', 'read', 'edit.php' ),
			array( 'Add New', 'edit_posts', 'post-new.php' ),
			array( 'Tags', 'read', 'edit-tags.php?taxonomy=post_tag' ),
		);

		$items = openstation_build_dock_items();

		$this->assertCount( 1, $items[0]['submenu'] );
		$this->assertSame( 'Tags', $items[0]['submenu'][0]['title'] );
	}

	public function test_keeps_the_self_link_label_on_self_label() {
		global $menu, $submenu;

		$menu[] = array( 'Posts', 'read', 'edit.php', '', 'menu-top', 'menu-posts', 'dashicons-admin-post' );

		$submenu['edit.php'] = array(
			array( 'All Posts', 'read', 'edit.php' ),
			array( 'Tags', 'read', 'edit-tags.php?taxonomy=post_tag' ),
		);

		$items = openstation_build_dock_items();

		$this->assertSame( 'All Posts', $items[0]['selfLabel'] );

		$this->assertSame(
			array( 'Tags' ),
			wp_list_pluck( $items[0]['submenu'], 'title' )
		);
	}

	public function test_self_label_is_empty_without_a_self_link() {
		global $menu, $submenu;

		$menu[] = array( 'Tools', 'read', 'tools.php', '', 'menu-top', 'menu-tools', 'dashicons-admin-tools' );

		$submenu['tools.php'] = array(
			array( 'Import', 'read', 'import.php' ),
		);

		$items = openstation_build_dock_items();

		$this->assertSame( '', $items[0]['selfLabel'] );
	}

	public function test_skips_submenu_items_with_empty_title() {
		global $menu, $submenu;
		$menu               = array( $this->make_menu_row( 'WooCommerce', 'manage_options', 'woocommerce' ) );
		$submenu['woocommerce'] = array(
			array( 'WooCommerce', 'manage_options', 'woocommerce' ),
			array( 'Home', 'manage_options', 'wc-admin' ),
			array( null, 'manage_options', 'wc-addons' ),
			array( '', 'manage_options', 'wc-empty-string' ),
			array( '   ', 'manage_options', 'wc-whitespace' ),
			array( 'Extensions', 'manage_options', 'wc-addons-shop' ),
		);

		$items  = openstation_build_dock_items();
		$titles = wp_list_pluck( $items[0]['submenu'], 'title' );

		$this->assertContains( 'Home', $titles );
		$this->assertContains( 'Extensions', $titles );
		$this->assertNotContains( '', $titles );
		$this->assertNotContains( null, $titles );

		$this->assertCount( 2, $items[0]['submenu'] );
	}

	public function test_preserves_hide_if_no_customize_submenu_items() {
		global $menu, $submenu;
		$menu                  = array( $this->make_menu_row( 'Themes', 'edit_theme_options', 'themes.php' ) );
		$submenu['themes.php'] = array(
			array( 'Themes', 'edit_theme_options', 'themes.php' ),
			array( 'Customize', 'customize', 'customize.php', '', 'hide-if-no-customize' ),
			array( 'Menus', 'edit_theme_options', 'nav-menus.php' ),
		);

		$items = openstation_build_dock_items();

		$titles = wp_list_pluck( $items[0]['submenu'], 'title' );
		$this->assertNotContains( 'Themes', $titles );
		$this->assertContains( 'Customize', $titles );
		$this->assertContains( 'Menus', $titles );
	}

	public function test_strips_self_link_submenu_entry() {
		global $menu, $submenu;
		$menu               = array( $this->make_menu_row( 'Comments', 'edit_posts', 'edit-comments.php' ) );

		$submenu['edit-comments.php'] = array(
			array( 'Comments', 'edit_posts', 'edit-comments.php' ),
		);
		$leaf_only = openstation_build_dock_items();
		$this->assertSame( array(), $leaf_only[0]['submenu'] );

		$submenu['edit-comments.php'] = array(
			array( 'Comments', 'edit_posts', 'edit-comments.php' ),
			array( 'Recent', 'edit_posts', 'edit-comments.php?status=approved' ),
		);
		$with_real_child = openstation_build_dock_items();
		$this->assertCount( 1, $with_real_child[0]['submenu'] );
		$this->assertSame( 'Recent', $with_real_child[0]['submenu'][0]['title'] );
	}

	public function test_parent_url_falls_through_to_first_submenu_when_different() {
		global $menu, $submenu;
		$menu                  = array( $this->make_menu_row( 'WooCommerce', 'read', 'woocommerce' ) );
		$submenu['woocommerce'] = array(
			array( 'Home',     'read', 'wc-admin' ),
			array( 'Orders',   'read', 'wc-orders' ),
			array( 'Products', 'read', 'edit.php?post_type=product' ),
		);

		$items = openstation_build_dock_items();

		$this->assertCount( 1, $items );
		$this->assertSame(
			admin_url( 'admin.php?page=wc-admin' ),
			$items[0]['url'],
			'Parent URL should be rewritten to the first visible submenu (mirrors wp-admin/menu-header.php).'
		);

		$this->assertCount( 3, $items[0]['submenu'] );
	}

	public function test_parent_url_unchanged_when_first_submenu_is_self_link() {
		global $menu, $submenu;
		$menu               = array( $this->make_menu_row( 'Posts', 'edit_posts', 'edit.php' ) );
		$submenu['edit.php'] = array(
			array( 'All Posts', 'edit_posts', 'edit.php' ),
			array( 'Add New',   'edit_posts', 'post-new.php' ),
		);

		$items = openstation_build_dock_items();

		$this->assertSame( admin_url( 'edit.php' ), $items[0]['url'] );

		$this->assertCount( 1, $items[0]['submenu'] );
		$this->assertSame( 'Add New', $items[0]['submenu'][0]['title'] );
	}

	public function test_parent_url_falls_through_to_first_capability_passing_submenu() {
		global $menu, $submenu;
		$subscriber_id = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		wp_set_current_user( $subscriber_id );

		$menu                = array( $this->make_menu_row( 'Tools', 'read', 'tools-root' ) );
		$submenu['tools-root'] = array(
			array( 'Admin Only', 'manage_options', 'admin-only' ),
			array( 'Public',     'read',           'public-page' ),
		);

		$items = openstation_build_dock_items();

		$this->assertCount( 1, $items );
		$this->assertSame( admin_url( 'admin.php?page=public-page' ), $items[0]['url'] );
	}

	public function test_openstation_dock_item_filter_can_modify_each_entry() {
		global $menu;
		$menu = array( $this->make_menu_row( 'Posts', 'edit_posts', 'edit.php' ) );

		add_filter(
			'openstation_dock_item',
			function ( $item, $slug ) {
				$item['title'] = strtoupper( $item['title'] );
				$item['slug']  = $slug;
				return $item;
			},
			10,
			2
		);

		$items = openstation_build_dock_items();
		$this->assertSame( 'POSTS', $items[0]['title'] );
		$this->assertSame( 'edit.php', $items[0]['slug'] );
	}

	public function test_openstation_dock_items_filter_can_replace_full_list() {
		global $menu;
		$menu = array( $this->make_menu_row( 'Posts', 'edit_posts', 'edit.php' ) );

		add_filter(
			'openstation_dock_items',
			function () {
				return array( array( 'id' => 'replaced', 'title' => 'Replaced' ) );
			}
		);

		$items = openstation_build_dock_items();
		$this->assertCount( 1, $items );
		$this->assertSame( 'replaced', $items[0]['id'] );
	}

	public function test_icon_dashicon_class_preserved() {
		global $menu;
		$menu = array( $this->make_menu_row( 'Posts', 'edit_posts', 'edit.php', '', '', '', 'dashicons-admin-post' ) );

		$items = openstation_build_dock_items();

		$this->assertSame( 'dashicons-admin-post', $items[0]['icon'] );
	}

	public function test_icon_falls_back_to_generic_when_empty() {
		global $menu;
		$menu = array( $this->make_menu_row( 'Posts', 'edit_posts', 'edit.php', '', '', '', '' ) );

		$items = openstation_build_dock_items();

		$this->assertSame( 'dashicons-admin-generic', $items[0]['icon'] );
	}

	public function test_icon_none_and_div_collapse_to_generic() {
		global $menu;
		$menu = array(
			$this->make_menu_row( 'None', 'read', 'none.php', '', '', 'hook-none', 'none' ),
			$this->make_menu_row( 'Div',  'read', 'div.php',  '', '', 'hook-div',  'div' ),
		);

		$items = openstation_build_dock_items();

		$this->assertSame( 'dashicons-admin-generic', $items[0]['icon'] );
		$this->assertSame( 'dashicons-admin-generic', $items[1]['icon'] );
	}

	public function test_icon_http_url_preserved_after_sanitizing() {
		global $menu;
		$menu = array(
			$this->make_menu_row( 'X', 'read', 'x.php', '', '', 'hook-x', 'https://example.com/icon.png' ),
		);

		$items = openstation_build_dock_items();

		$this->assertSame( 'https://example.com/icon.png', $items[0]['icon'] );
	}

	public function test_icon_well_formed_svg_data_uri_passes_through() {
		global $menu;
		$svg  = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=';
		$menu = array( $this->make_menu_row( 'Y', 'read', 'y.php', '', '', 'hook-y', $svg ) );

		$items = openstation_build_dock_items();

		$this->assertSame( $svg, $items[0]['icon'] );
	}

	public function test_icon_javascript_url_is_rejected() {
		global $menu;
		$menu = array( $this->make_menu_row( 'Z', 'read', 'z.php', '', '', 'hook-z', 'javascript:alert(1)' ) );

		$items = openstation_build_dock_items();

		$this->assertSame( 'dashicons-admin-generic', $items[0]['icon'] );
	}

	public function test_icon_non_svg_data_uri_is_rejected() {
		global $menu;
		$menu = array(
			$this->make_menu_row( 'A', 'read', 'a.php', '', '', 'hook-a', 'data:text/html,<script>alert(1)</script>' ),
		);

		$items = openstation_build_dock_items();

		$this->assertSame( 'dashicons-admin-generic', $items[0]['icon'] );
	}

	public function test_icon_dashicon_breakout_attempt_is_scrubbed() {
		global $menu;
		$menu = array(
			$this->make_menu_row( 'B', 'read', 'b.php', '', '', 'hook-b', 'dashicons-admin-post" onerror="alert(1)' ),
		);

		$items = openstation_build_dock_items();

		$this->assertSame( 'dashicons-admin-postonerroralert1', $items[0]['icon'] );
		$this->assertStringNotContainsString( '"', $items[0]['icon'] );
		$this->assertStringNotContainsString( ' ', $items[0]['icon'] );
	}

	public function test_placement_distinguishes_core_from_plugin_menus() {
		global $menu;
		$menu = array(
			$this->make_menu_row( 'Dashboard', 'read', 'index.php' ),
			$this->make_menu_row( 'Posts', 'edit_posts', 'edit.php' ),
			$this->make_menu_row( 'Settings', 'manage_options', 'options-general.php' ),
			$this->make_menu_row( 'Plugins', 'activate_plugins', 'plugins.php' ),

			$this->make_menu_row( 'WooCommerce', 'read', 'woocommerce' ),
			$this->make_menu_row( 'Yoast SEO', 'read', 'wpseo_dashboard' ),
		);

		$items = openstation_build_dock_items();
		$by_id = array();
		foreach ( $items as $item ) {
			$by_id[ $item['id'] ] = $item;
		}

		$this->assertSame( 'dock', $by_id['menu-index-php']['placement'] );
		$this->assertSame( 'dock', $by_id['menu-edit-php']['placement'] );
		$this->assertSame( 'dock', $by_id['menu-options-general-php']['placement'] );
		$this->assertSame( 'dock', $by_id['menu-plugins-php']['placement'] );
		$this->assertSame( 'dock', $by_id['menu-woocommerce']['placement'] );
		$this->assertSame( 'dock', $by_id['menu-wpseo_dashboard']['placement'] );

		$this->assertTrue( $by_id['menu-index-php']['isCore'] );
		$this->assertTrue( $by_id['menu-edit-php']['isCore'] );
		$this->assertTrue( $by_id['menu-options-general-php']['isCore'] );
		$this->assertTrue( $by_id['menu-plugins-php']['isCore'] );
		$this->assertFalse( $by_id['menu-woocommerce']['isCore'] );
		$this->assertFalse( $by_id['menu-wpseo_dashboard']['isCore'] );
	}

	public function test_cpt_routes_count_as_core() {
		$this->assertTrue( openstation_is_core_menu_slug( 'edit.php?post_type=product' ) );
		$this->assertTrue( openstation_is_core_menu_slug( 'edit.php?post_type=wp_block' ) );
	}

	public function test_placement_filter_can_hide_items() {
		add_filter(
			'openstation_dock_placement',
			static function ( $placement, $slug ) {
				if ( 'background-tool' === $slug ) {
					return 'hidden';
				}
				return $placement;
			},
			10,
			2
		);

		$this->assertSame( 'hidden', openstation_dock_placement( 'background-tool' ) );

		$this->assertSame( 'dock', openstation_dock_placement( 'edit.php' ) );
		$this->assertSame( 'dock', openstation_dock_placement( 'jetpack' ) );
	}

	public function test_elementor_4_legacy_menus_stay_out_of_the_dock() {
		global $admin_page_hooks;

		$this->assertSame( 'dock', openstation_dock_placement( 'elementor' ) );

		$admin_page_hooks['elementor-home'] = 'elementor';
		try {
			$this->assertSame( 'hidden', openstation_dock_placement( 'elementor' ) );
			$this->assertSame( 'hidden', openstation_dock_placement( 'edit.php?post_type=elementor_library' ) );
			$this->assertSame( 'dock', openstation_dock_placement( 'elementor-home' ) );
		} finally {
			unset( $admin_page_hooks['elementor-home'] );
		}
	}

	public function test_placement_filter_rejects_unknown_values() {
		add_filter(
			'openstation_dock_placement',
			static function () {
				return 'sidebar';
			}
		);
		$this->assertSame( 'dock', openstation_dock_placement( 'edit.php' ) );
		$this->assertSame( 'dock', openstation_dock_placement( 'some-plugin' ) );
	}

	public function test_hidden_placement_removes_item_from_dock() {
		add_filter(
			'openstation_dock_placement',
			static function ( $placement, $slug ) {
				if ( 'background-tool' === $slug ) {
					return 'hidden';
				}
				return $placement;
			},
			10,
			2
		);

		$this->assertSame( 'hidden', openstation_dock_placement( 'background-tool' ) );

		global $menu;
		$menu = array(
			$this->make_menu_row( 'Background Tool', 'manage_options', 'background-tool' ),
			$this->make_menu_row( 'Other Plugin', 'manage_options', 'other-plugin' ),
		);

		$payload  = openstation_build_menu_payload();
		$dock_ids = wp_list_pluck( $payload['dockItems'], 'id' );

		$this->assertNotContains( 'menu-background-tool', $dock_ids );
		$this->assertContains( 'menu-other-plugin', $dock_ids );
	}

	public function test_payload_carries_update_counts() {
		require_once ABSPATH . 'wp-admin/includes/update.php';

		global $menu;
		$menu = array(
			$this->make_menu_row( 'Dashboard', 'read', 'index.php' ),
		);

		set_site_transient(
			'update_plugins',
			(object) array(
				'response' => array(
					'foo/foo.php' => (object) array( 'new_version' => '2.0' ),
					'bar/bar.php' => (object) array( 'new_version' => '1.1' ),
				),
			)
		);

		$payload = openstation_build_menu_payload();

		$this->assertArrayHasKey( 'updateCounts', $payload );
		$counts = $payload['updateCounts'];
		$this->assertSame( 2, $counts['total'] );
		$this->assertSame( '2', $counts['formatted'] );
		$this->assertSame( '2 updates available', $counts['text'] );
		$this->assertSame( network_admin_url( 'update-core.php' ), $counts['url'] );

		set_site_transient( 'update_plugins', (object) array( 'response' => array() ) );
		$payload = openstation_build_menu_payload();
		$this->assertSame( 0, $payload['updateCounts']['total'] );
	}

	public function test_resolve_plugin_file_returns_null_for_core_slugs() {
		$this->assertNull( openstation_resolve_menu_plugin_file( 'index.php' ) );
		$this->assertNull( openstation_resolve_menu_plugin_file( 'plugins.php' ) );
		$this->assertNull( openstation_resolve_menu_plugin_file( 'edit.php' ) );
		$this->assertNull( openstation_resolve_menu_plugin_file( 'edit.php?post_type=page' ) );
	}

	public function test_resolve_plugin_file_returns_null_for_unknown_slug() {
		$this->assertNull(
			openstation_resolve_menu_plugin_file( 'nonexistent-menu-slug-xyz' )
		);
	}

	public function test_resolve_plugin_file_returns_plugin_basename_when_callback_lives_in_plugin_dir() {
		$fake_folder   = 'dm-positive-resolver-fixture';
		$fake_dir      = WP_PLUGIN_DIR . '/' . $fake_folder;
		$fake_basename = $fake_folder . '/' . $fake_folder . '.php';
		$fake_file     = WP_PLUGIN_DIR . '/' . $fake_basename;

		if ( ! is_dir( $fake_dir ) ) {
			mkdir( $fake_dir, 0755, true );
		}

		file_put_contents(
			$fake_file,
			"<?php\n/**\n * Plugin Name: DM Positive Resolver Fixture\n * Version: 0.0.0\n */\nfunction dm_positive_resolver_fixture_render() {}\n"
		);
		require_once $fake_file;

		$inject = static function ( $plugins ) use ( $fake_basename ) {
			$plugins[ $fake_basename ] = array(
				'Name'        => 'DM Positive Resolver Fixture',
				'Version'     => '0.0.0',
				'Description' => 'Fixture for openstation resolver test.',
			);
			return $plugins;
		};
		add_filter( 'all_plugins', $inject );

		wp_cache_delete( 'plugins', 'plugins' );

		$slug     = 'dm-positive-resolver-fixture-page';
		$hookname = get_plugin_page_hookname( $slug, '' );
		add_action( $hookname, 'dm_positive_resolver_fixture_render' );

		try {
			$resolved = openstation_resolve_menu_plugin_file( $slug );
			$this->assertSame( $fake_basename, $resolved );
		} finally {
			remove_action( $hookname, 'dm_positive_resolver_fixture_render' );
			remove_filter( 'all_plugins', $inject );
			wp_cache_delete( 'plugins', 'plugins' );

			@unlink( $fake_file );

			@rmdir( $fake_dir );
		}
	}

	public function test_resolve_plugin_file_excludes_openstation_itself() {
		$slug     = 'os-self-exclusion-test';
		$hookname = get_plugin_page_hookname( $slug, '' );

		$callback_file = ( new ReflectionFunction( 'openstation_is_pure_core_file' ) )
			->getFileName();
		$this->assertNotFalse(
			$callback_file,
			'Cannot reflect on openstation_is_pure_core_file — test cannot exercise self-exclusion.'
		);
		$this->assertStringStartsWith(
			wp_normalize_path( WP_PLUGIN_DIR ) . '/',
			wp_normalize_path( $callback_file ),
			'OpenStation must live under WP_PLUGIN_DIR for the self-exclusion branch to trigger.'
		);

		add_action( $hookname, 'openstation_is_pure_core_file' );
		try {
			$resolved = openstation_resolve_menu_plugin_file( $slug );
		} finally {
			remove_action( $hookname, 'openstation_is_pure_core_file' );
		}

		$this->assertNull( $resolved );
	}
}
