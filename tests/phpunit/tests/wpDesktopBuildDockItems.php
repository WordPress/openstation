<?php
/**
 * Tests for the dock item builder that converts $menu / $submenu into
 * the JSON structure consumed by the desktop shell JavaScript.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 *
 * @covers ::wpdm_build_dock_items
 */
class Tests_DesktopMode_WpDesktopBuildDockItems extends WP_UnitTestCase {

	protected static $admin_id;

	protected $original_menu;
	protected $original_submenu;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		// Snapshot the menu globals so each test can mutate them safely.
		global $menu, $submenu;
		$this->original_menu    = $menu;
		$this->original_submenu = $submenu;
		$menu                   = array();
		$submenu                = array();
		wp_set_current_user( self::$admin_id );
		wpdm_flush_script_handle_registries();
	}

	public function tear_down() {
		global $menu, $submenu;
		$menu    = $this->original_menu;
		$submenu = $this->original_submenu;
		remove_all_filters( 'wp_desktop_dock_items' );
		remove_all_filters( 'wp_desktop_dock_item' );
		remove_all_filters( 'wp_desktop_dock_placement' );
		parent::tear_down();
	}

	/**
	 * Helper: build a $menu row in the canonical 7-element layout used
	 * throughout wp-admin/menu.php.
	 */
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
		$this->assertSame( array(), wpdm_build_dock_items() );
	}

	public function test_skips_separators() {
		global $menu;
		$menu = array(
			array( '', 'read', 'separator1', '', 'wp-menu-separator' ),
			$this->make_menu_row( 'Posts', 'edit_posts', 'edit.php' ),
		);

		$items = wpdm_build_dock_items();

		$this->assertCount( 1, $items );
		$this->assertSame( 'Posts', $items[0]['title'] );
	}

	public function test_skips_items_with_empty_slug() {
		global $menu;
		$menu = array(
			array( 'No Slug', 'read', '', '', '', 'menu-noslug', '' ),
			$this->make_menu_row( 'Posts', 'edit_posts', 'edit.php' ),
		);

		$items = wpdm_build_dock_items();

		$this->assertCount( 1, $items );
		$this->assertSame( 'Posts', $items[0]['title'] );
	}

	public function test_filters_items_by_capability() {
		global $menu;
		// Use a logged-in user without the manage_options capability so
		// the second row should be filtered out.
		$subscriber_id = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		wp_set_current_user( $subscriber_id );

		$menu = array(
			$this->make_menu_row( 'Read', 'read', 'index.php' ),
			$this->make_menu_row( 'Settings', 'manage_options', 'options-general.php' ),
		);

		$items = wpdm_build_dock_items();

		$titles = wp_list_pluck( $items, 'title' );
		$this->assertContains( 'Read', $titles );
		$this->assertNotContains( 'Settings', $titles );
	}

	/**
	 * Update badges live inside <span class="update-plugins count-N"> in
	 * the title HTML. The builder must extract the count and strip the
	 * span from the visible title.
	 */
	public function test_extracts_update_badge_and_strips_span_from_title() {
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

		$items = wpdm_build_dock_items();

		$this->assertSame( 'Plugins', $items[0]['title'] );
		$this->assertSame( 3, $items[0]['badge'] );
	}

	public function test_no_badge_when_count_class_missing() {
		global $menu;
		$menu = array( $this->make_menu_row( 'Posts', 'edit_posts', 'edit.php' ) );

		$items = wpdm_build_dock_items();
		$this->assertSame( 0, $items[0]['badge'] );
	}

	public function test_falls_back_to_generic_icon_when_unset() {
		global $menu;
		$menu = array(
			// Index 6 (icon) is empty.
			array( 'Custom', 'read', 'custom.php', '', '', 'menu-custom', '' ),
		);

		$items = wpdm_build_dock_items();
		$this->assertSame( 'dashicons-admin-generic', $items[0]['icon'] );
	}

	public function test_includes_submenu_items_user_can_access() {
		global $menu, $submenu;
		$menu               = array( $this->make_menu_row( 'Posts', 'edit_posts', 'edit.php' ) );
		$submenu['edit.php'] = array(
			array( 'All Posts', 'edit_posts', 'edit.php' ),
			array( 'Add New', 'edit_posts', 'post-new.php' ),
		);

		$items = wpdm_build_dock_items();

		$this->assertCount( 2, $items[0]['submenu'] );
		$this->assertSame( 'All Posts', $items[0]['submenu'][0]['title'] );
		$this->assertSame( 'Add New', $items[0]['submenu'][1]['title'] );
	}

	public function test_filters_submenu_by_capability() {
		global $menu, $submenu;
		$subscriber_id = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		wp_set_current_user( $subscriber_id );

		$menu                = array( $this->make_menu_row( 'Posts', 'read', 'edit.php' ) );
		$submenu['edit.php'] = array(
			array( 'All Posts', 'read', 'edit.php' ),
			array( 'Add New', 'edit_posts', 'post-new.php' ),
		);

		$items = wpdm_build_dock_items();

		$this->assertCount( 1, $items[0]['submenu'] );
		$this->assertSame( 'All Posts', $items[0]['submenu'][0]['title'] );
	}

	public function test_skips_hide_if_no_customize_submenu_items() {
		global $menu, $submenu;
		$menu                  = array( $this->make_menu_row( 'Themes', 'edit_theme_options', 'themes.php' ) );
		$submenu['themes.php'] = array(
			array( 'Themes', 'edit_theme_options', 'themes.php' ),
			array( 'Customize', 'customize', 'customize.php', '', 'hide-if-no-customize' ),
		);

		$items = wpdm_build_dock_items();

		$titles = wp_list_pluck( $items[0]['submenu'], 'title' );
		$this->assertContains( 'Themes', $titles );
		$this->assertNotContains( 'Customize', $titles );
	}

	public function test_wp_desktop_dock_item_filter_can_modify_each_entry() {
		global $menu;
		$menu = array( $this->make_menu_row( 'Posts', 'edit_posts', 'edit.php' ) );

		add_filter(
			'wp_desktop_dock_item',
			function ( $item, $slug ) {
				$item['title'] = strtoupper( $item['title'] );
				$item['slug']  = $slug;
				return $item;
			},
			10,
			2
		);

		$items = wpdm_build_dock_items();
		$this->assertSame( 'POSTS', $items[0]['title'] );
		$this->assertSame( 'edit.php', $items[0]['slug'] );
	}

	public function test_wp_desktop_dock_items_filter_can_replace_full_list() {
		global $menu;
		$menu = array( $this->make_menu_row( 'Posts', 'edit_posts', 'edit.php' ) );

		add_filter(
			'wp_desktop_dock_items',
			function () {
				return array( array( 'id' => 'replaced', 'title' => 'Replaced' ) );
			}
		);

		$items = wpdm_build_dock_items();
		$this->assertCount( 1, $items );
		$this->assertSame( 'replaced', $items[0]['id'] );
	}

	/**
	 * Dashicons values are passed through intact — these are CSS class
	 * names baked into Core's menu config and safe to render.
	 *
	 * @covers ::wpdm_sanitize_dock_icon
	 */
	public function test_icon_dashicon_class_preserved() {
		global $menu;
		$menu = array( $this->make_menu_row( 'Posts', 'edit_posts', 'edit.php', '', '', '', 'dashicons-admin-post' ) );

		$items = wpdm_build_dock_items();

		$this->assertSame( 'dashicons-admin-post', $items[0]['icon'] );
	}

	/**
	 * Falling back to the generic icon when the menu row doesn't supply
	 * one (or supplies an empty string) keeps the shell renderable.
	 *
	 * @covers ::wpdm_sanitize_dock_icon
	 */
	public function test_icon_falls_back_to_generic_when_empty() {
		global $menu;
		$menu = array( $this->make_menu_row( 'Posts', 'edit_posts', 'edit.php', '', '', '', '' ) );

		$items = wpdm_build_dock_items();

		$this->assertSame( 'dashicons-admin-generic', $items[0]['icon'] );
	}

	/**
	 * Core treats 'none' and 'div' as "no inline icon, style via CSS".
	 * The shell has no special handling for them, so collapsing to the
	 * generic dashicon gives a safe, visible fallback.
	 *
	 * @covers ::wpdm_sanitize_dock_icon
	 */
	public function test_icon_none_and_div_collapse_to_generic() {
		global $menu;
		$menu = array(
			$this->make_menu_row( 'None', 'read', 'none.php', '', '', 'hook-none', 'none' ),
			$this->make_menu_row( 'Div',  'read', 'div.php',  '', '', 'hook-div',  'div' ),
		);

		$items = wpdm_build_dock_items();

		$this->assertSame( 'dashicons-admin-generic', $items[0]['icon'] );
		$this->assertSame( 'dashicons-admin-generic', $items[1]['icon'] );
	}

	/**
	 * http(s) URLs — e.g. a plugin bundling its own PNG — pass through
	 * esc_url_raw so scheme-shaped bytes can't slip past.
	 *
	 * @covers ::wpdm_sanitize_dock_icon
	 */
	public function test_icon_http_url_preserved_after_sanitizing() {
		global $menu;
		$menu = array(
			$this->make_menu_row( 'X', 'read', 'x.php', '', '', 'hook-x', 'https://example.com/icon.png' ),
		);

		$items = wpdm_build_dock_items();

		$this->assertSame( 'https://example.com/icon.png', $items[0]['icon'] );
	}

	/**
	 * Inline SVG data URIs were previously preserved for the Core
	 * Site Health / Privacy icons, but SVG can carry script that
	 * executes when the icon is rendered as a CSS background. The
	 * sanitizer now rejects every `data:` URI and falls back to the
	 * generic dashicon. Menus that shipped an inline SVG should
	 * register a dashicons class or an http(s) image URL instead.
	 *
	 * @covers ::wpdm_sanitize_dock_icon
	 */
	public function test_icon_data_svg_rejected() {
		global $menu;
		$svg  = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=';
		$menu = array( $this->make_menu_row( 'Y', 'read', 'y.php', '', '', 'hook-y', $svg ) );

		$items = wpdm_build_dock_items();

		$this->assertSame( 'dashicons-admin-generic', $items[0]['icon'] );
	}

	/**
	 * A `javascript:` URL from a hostile plugin would execute as soon as
	 * the shell wrote it to an `<img src>` or anchor. Must be dropped to
	 * the fallback icon, not passed through.
	 *
	 * @covers ::wpdm_sanitize_dock_icon
	 */
	public function test_icon_javascript_url_is_rejected() {
		global $menu;
		$menu = array( $this->make_menu_row( 'Z', 'read', 'z.php', '', '', 'hook-z', 'javascript:alert(1)' ) );

		$items = wpdm_build_dock_items();

		$this->assertSame( 'dashicons-admin-generic', $items[0]['icon'] );
	}

	/**
	 * Non-image data URIs (e.g. `data:text/html,<script>...`) are a
	 * common XSS vector and must be rejected, even though `data:` itself
	 * is allowed for the SVG case.
	 *
	 * @covers ::wpdm_sanitize_dock_icon
	 */
	public function test_icon_non_svg_data_uri_is_rejected() {
		global $menu;
		$menu = array(
			$this->make_menu_row( 'A', 'read', 'a.php', '', '', 'hook-a', 'data:text/html,<script>alert(1)</script>' ),
		);

		$items = wpdm_build_dock_items();

		$this->assertSame( 'dashicons-admin-generic', $items[0]['icon'] );
	}

	/**
	 * A dashicons-prefixed value with embedded quotes would let a
	 * hostile plugin break out of the class attribute on the shell side.
	 * Strip everything that isn't a legal dashicon class character.
	 *
	 * @covers ::wpdm_sanitize_dock_icon
	 */
	public function test_icon_dashicon_breakout_attempt_is_scrubbed() {
		global $menu;
		$menu = array(
			$this->make_menu_row( 'B', 'read', 'b.php', '', '', 'hook-b', 'dashicons-admin-post" onerror="alert(1)' ),
		);

		$items = wpdm_build_dock_items();

		$this->assertSame( 'dashicons-admin-postonerroralert1', $items[0]['icon'] );
		$this->assertStringNotContainsString( '"', $items[0]['icon'] );
		$this->assertStringNotContainsString( ' ', $items[0]['icon'] );
	}

	/**
	 * Every built dock item carries a `placement` field — `'dock'`
	 * for core admin pages + CPTs, `'taskbar'` for plugin-installed
	 * top-level routes.
	 *
	 * @covers ::wpdm_build_dock_items
	 * @covers ::wpdm_is_core_menu_slug
	 * @covers ::wpdm_dock_placement
	 */
	public function test_placement_distinguishes_core_from_plugin_menus() {
		global $menu;
		$menu = array(
			$this->make_menu_row( 'Dashboard', 'read', 'index.php' ),
			$this->make_menu_row( 'Posts', 'edit_posts', 'edit.php' ),
			$this->make_menu_row( 'Settings', 'manage_options', 'options-general.php' ),
			$this->make_menu_row( 'Plugins', 'activate_plugins', 'plugins.php' ),
			// Plugin-registered top-level route. WP stores these as
			// the slug passed to `add_menu_page()` (no .php extension)
			// and routes them through admin.php?page=<slug>.
			$this->make_menu_row( 'WooCommerce', 'read', 'woocommerce' ),
			$this->make_menu_row( 'Yoast SEO', 'read', 'wpseo_dashboard' ),
		);

		$items = wpdm_build_dock_items();
		$by_id = array();
		foreach ( $items as $item ) {
			$by_id[ $item['id'] ] = $item;
		}

		$this->assertSame( 'dock', $by_id['menu-index-php']['placement'] );
		$this->assertSame( 'dock', $by_id['menu-edit-php']['placement'] );
		$this->assertSame( 'dock', $by_id['menu-options-general-php']['placement'] );
		$this->assertSame( 'dock', $by_id['menu-plugins-php']['placement'] );
		$this->assertSame( 'taskbar', $by_id['menu-woocommerce']['placement'] );
		$this->assertSame( 'taskbar', $by_id['menu-wpseo_dashboard']['placement'] );
	}

	/**
	 * CPTs registered by plugins route through `edit.php?post_type=…`.
	 * They should be treated as Core (left dock) because conceptually
	 * they're content, same as Posts and Pages.
	 *
	 * @covers ::wpdm_is_core_menu_slug
	 */
	public function test_cpt_routes_count_as_core() {
		$this->assertTrue( wpdm_is_core_menu_slug( 'edit.php?post_type=product' ) );
		$this->assertTrue( wpdm_is_core_menu_slug( 'edit.php?post_type=wp_block' ) );
	}

	/**
	 * `wp_desktop_dock_placement` lets plugins + site admins re-home
	 * any menu item. Return `'dock'` to promote a plugin to the left
	 * bar, `'taskbar'` to demote a core item to the bottom.
	 *
	 * @covers ::wpdm_dock_placement
	 */
	public function test_placement_filter_can_promote_or_demote() {
		add_filter(
			'wp_desktop_dock_placement',
			static function ( $placement, $slug ) {
				if ( 'jetpack' === $slug ) {
					return 'dock';
				}
				if ( 'tools.php' === $slug ) {
					return 'taskbar';
				}
				return $placement;
			},
			10,
			2
		);

		$this->assertSame( 'dock', wpdm_dock_placement( 'jetpack' ) );
		$this->assertSame( 'taskbar', wpdm_dock_placement( 'tools.php' ) );
		// Unrelated slugs still get the default answer.
		$this->assertSame( 'dock', wpdm_dock_placement( 'edit.php' ) );
		$this->assertSame( 'taskbar', wpdm_dock_placement( 'my-other-plugin' ) );
	}

	/**
	 * A filter that returns garbage is ignored — the heuristic's
	 * default wins to keep the shell rendering predictably.
	 *
	 * @covers ::wpdm_dock_placement
	 */
	public function test_placement_filter_rejects_unknown_values() {
		add_filter(
			'wp_desktop_dock_placement',
			static function () {
				return 'sidebar'; // not a valid placement
			}
		);
		$this->assertSame( 'dock', wpdm_dock_placement( 'edit.php' ) );
		$this->assertSame( 'taskbar', wpdm_dock_placement( 'some-plugin' ) );
	}

	/**
	 * Plugins that don't want to claim chrome real estate can return
	 * `'hidden'` from the placement filter. The item must disappear
	 * from both rails in the shell payload while still being a valid
	 * server-side menu entry.
	 *
	 * @covers ::wpdm_dock_placement
	 * @covers ::wpdm_build_menu_payload
	 */
	public function test_hidden_placement_removes_item_from_both_rails() {
		add_filter(
			'wp_desktop_dock_placement',
			static function ( $placement, $slug ) {
				if ( 'background-tool' === $slug ) {
					return 'hidden';
				}
				return $placement;
			},
			10,
			2
		);

		$this->assertSame( 'hidden', wpdm_dock_placement( 'background-tool' ) );

		global $menu;
		$menu = array(
			$this->make_menu_row( 'Background Tool', 'manage_options', 'background-tool' ),
			$this->make_menu_row( 'Other Plugin', 'manage_options', 'other-plugin' ),
		);

		$payload  = wpdm_build_menu_payload();
		$dock_ids = wp_list_pluck( $payload['dockItems'], 'id' );
		$bar_ids  = wp_list_pluck( $payload['taskbarItems'], 'id' );

		$this->assertNotContains( 'menu-background-tool', $dock_ids );
		$this->assertNotContains( 'menu-background-tool', $bar_ids );
		$this->assertContains( 'menu-other-plugin', $bar_ids );
	}
}
