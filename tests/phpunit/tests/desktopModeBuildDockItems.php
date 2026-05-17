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
 * @covers ::desktop_mode_build_dock_items
 */
class Tests_DesktopMode_BuildDockItems extends WP_UnitTestCase {

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
		desktop_mode_flush_script_handle_registries();
	}

	public function tear_down() {
		global $menu, $submenu;
		$menu    = $this->original_menu;
		$submenu = $this->original_submenu;
		remove_all_filters( 'desktop_mode_dock_items' );
		remove_all_filters( 'desktop_mode_dock_item' );
		remove_all_filters( 'desktop_mode_dock_placement' );
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
		$this->assertSame( array(), desktop_mode_build_dock_items() );
	}

	public function test_skips_separators() {
		global $menu;
		$menu = array(
			array( '', 'read', 'separator1', '', 'wp-menu-separator' ),
			$this->make_menu_row( 'Posts', 'edit_posts', 'edit.php' ),
		);

		$items = desktop_mode_build_dock_items();

		$this->assertCount( 1, $items );
		$this->assertSame( 'Posts', $items[0]['title'] );
	}

	public function test_skips_items_with_empty_slug() {
		global $menu;
		$menu = array(
			array( 'No Slug', 'read', '', '', '', 'menu-noslug', '' ),
			$this->make_menu_row( 'Posts', 'edit_posts', 'edit.php' ),
		);

		$items = desktop_mode_build_dock_items();

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

		$items = desktop_mode_build_dock_items();

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

		$items = desktop_mode_build_dock_items();

		$this->assertSame( 'Plugins', $items[0]['title'] );
		$this->assertSame( 3, $items[0]['badge'] );
	}

	public function test_no_badge_when_count_class_missing() {
		global $menu;
		$menu = array( $this->make_menu_row( 'Posts', 'edit_posts', 'edit.php' ) );

		$items = desktop_mode_build_dock_items();
		$this->assertSame( 0, $items[0]['badge'] );
	}

	public function test_falls_back_to_generic_icon_when_unset() {
		global $menu;
		$menu = array(
			// Index 6 (icon) is empty.
			array( 'Custom', 'read', 'custom.php', '', '', 'menu-custom', '' ),
		);

		$items = desktop_mode_build_dock_items();
		$this->assertSame( 'dashicons-admin-generic', $items[0]['icon'] );
	}

	public function test_includes_submenu_items_user_can_access() {
		global $menu, $submenu;
		$menu               = array( $this->make_menu_row( 'Posts', 'edit_posts', 'edit.php' ) );
		$submenu['edit.php'] = array(
			// WordPress's auto-prepended self-link — stripped by the
			// dock builder so the JS layer's `submenu.length > 0`
			// invariant ("has real children") holds.
			array( 'All Posts', 'edit_posts', 'edit.php' ),
			array( 'Add New', 'edit_posts', 'post-new.php' ),
			array( 'Tags', 'manage_categories', 'edit-tags.php?taxonomy=post_tag' ),
		);

		$items = desktop_mode_build_dock_items();

		// Self-link stripped — only the two genuine children survive.
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

		$items = desktop_mode_build_dock_items();

		// `All Posts` is the self-link (stripped). `Add New` is
		// capability-filtered out (subscribers can't `edit_posts`).
		// `Tags` survives both gates.
		$this->assertCount( 1, $items[0]['submenu'] );
		$this->assertSame( 'Tags', $items[0]['submenu'][0]['title'] );
	}

	/**
	 * Plugins register hidden submenu rows by passing `menu_title => null`
	 * to `add_submenu_page()` — the page stays reachable but classic
	 * admin's left-menu row has no label. WooCommerce uses this for the
	 * `wc-addons` Extensions row (it's a duplicate of a labeled
	 * "Extensions" entry registered separately). Without filtering, the
	 * dock renders an empty, label-less tab.
	 */
	public function test_skips_submenu_items_with_empty_title() {
		global $menu, $submenu;
		$menu               = array( $this->make_menu_row( 'WooCommerce', 'manage_options', 'woocommerce' ) );
		$submenu['woocommerce'] = array(
			array( 'WooCommerce', 'manage_options', 'woocommerce' ),     // self-link, stripped
			array( 'Home', 'manage_options', 'wc-admin' ),
			array( null, 'manage_options', 'wc-addons' ),                 // hidden row
			array( '', 'manage_options', 'wc-empty-string' ),             // also empty
			array( '   ', 'manage_options', 'wc-whitespace' ),            // whitespace only
			array( 'Extensions', 'manage_options', 'wc-addons-shop' ),
		);

		$items  = desktop_mode_build_dock_items();
		$titles = wp_list_pluck( $items[0]['submenu'], 'title' );

		$this->assertContains( 'Home', $titles );
		$this->assertContains( 'Extensions', $titles );
		$this->assertNotContains( '', $titles );
		$this->assertNotContains( null, $titles );
		// Verify only the labeled rows survive — the three empty ones
		// are filtered out and don't ship as ghost tabs.
		$this->assertCount( 2, $items[0]['submenu'] );
	}

	public function test_skips_hide_if_no_customize_submenu_items() {
		global $menu, $submenu;
		$menu                  = array( $this->make_menu_row( 'Themes', 'edit_theme_options', 'themes.php' ) );
		$submenu['themes.php'] = array(
			array( 'Themes', 'edit_theme_options', 'themes.php' ), // self-link, also stripped
			array( 'Customize', 'customize', 'customize.php', '', 'hide-if-no-customize' ),
			array( 'Menus', 'edit_theme_options', 'nav-menus.php' ),
		);

		$items = desktop_mode_build_dock_items();

		$titles = wp_list_pluck( $items[0]['submenu'], 'title' );
		$this->assertNotContains( 'Themes', $titles );      // self-link strip
		$this->assertNotContains( 'Customize', $titles );   // hide-if-no-customize
		$this->assertContains( 'Menus', $titles );          // genuine child
	}

	/**
	 * Self-link strip — pin the invariant the JS layer documents
	 * (`submenu.length > 0` reliably means "has real children").
	 *
	 * Every parent menu page WordPress registers via
	 * `add_menu_page()` auto-prepends a child entry whose URL
	 * matches the parent's. Without the strip, every top-level
	 * item appears to "have a submenu" — the user-reported gap
	 * that motivated this fix.
	 */
	public function test_strips_self_link_submenu_entry() {
		global $menu, $submenu;
		$menu               = array( $this->make_menu_row( 'Comments', 'edit_posts', 'edit-comments.php' ) );

		// A leaf menu — no real children. WordPress would still
		// prepend a self-link in some scenarios; assert that the
		// dock builder yields an empty submenu in either case.
		$submenu['edit-comments.php'] = array(
			array( 'Comments', 'edit_posts', 'edit-comments.php' ),
		);
		$leaf_only = desktop_mode_build_dock_items();
		$this->assertSame( array(), $leaf_only[0]['submenu'] );

		// A parent with one self-link + one real child — only the
		// real child survives.
		$submenu['edit-comments.php'] = array(
			array( 'Comments', 'edit_posts', 'edit-comments.php' ),
			array( 'Recent', 'edit_posts', 'edit-comments.php?status=approved' ),
		);
		$with_real_child = desktop_mode_build_dock_items();
		$this->assertCount( 1, $with_real_child[0]['submenu'] );
		$this->assertSame( 'Recent', $with_real_child[0]['submenu'][0]['title'] );
	}

	/**
	 * Mirrors `wp-admin/menu-header.php`: when a parent menu has
	 * submenu entries whose URL differs from the parent's slug-derived
	 * URL, the parent's clickable URL must point at the first such
	 * submenu — not at `admin.php?page=<parent-slug>`.
	 *
	 * Reproduces the WooCommerce regression: WC registers its
	 * top-level menu with slug `woocommerce` and a null callback, then
	 * registers `Home` as the first submenu at slug `wc-admin`.
	 * Hitting `admin.php?page=woocommerce` directly invokes WC's stub
	 * callback and 500s; the working landing page is `?page=wc-admin`.
	 *
	 * Classic admin never navigates to `?page=woocommerce` because
	 * `menu-header.php` rewrites the parent link. The dock builder
	 * must do the same so plugins of this shape (Yoast SEO and
	 * others share the pattern) load instead of erroring.
	 */
	public function test_parent_url_falls_through_to_first_submenu_when_different() {
		global $menu, $submenu;
		$menu                  = array( $this->make_menu_row( 'WooCommerce', 'read', 'woocommerce' ) );
		$submenu['woocommerce'] = array(
			array( 'Home',     'read', 'wc-admin' ),
			array( 'Orders',   'read', 'wc-orders' ),
			array( 'Products', 'read', 'edit.php?post_type=product' ),
		);

		$items = desktop_mode_build_dock_items();

		$this->assertCount( 1, $items );
		$this->assertSame(
			admin_url( 'admin.php?page=wc-admin' ),
			$items[0]['url'],
			'Parent URL should be rewritten to the first visible submenu (mirrors wp-admin/menu-header.php).'
		);
		// All three submenu entries are real children — none of them
		// match the original `?page=woocommerce` self-link, so none
		// are stripped.
		$this->assertCount( 3, $items[0]['submenu'] );
	}

	/**
	 * Pin the no-op case: when WP auto-prepends a self-link as the
	 * first submenu (slug == parent slug), the rewrite is a no-op —
	 * the parent URL stays at `admin.php?page=<slug>` (or the file
	 * path for Core menus). This is the historical behavior; a
	 * regression here would change every Core menu's URL.
	 */
	public function test_parent_url_unchanged_when_first_submenu_is_self_link() {
		global $menu, $submenu;
		$menu               = array( $this->make_menu_row( 'Posts', 'edit_posts', 'edit.php' ) );
		$submenu['edit.php'] = array(
			array( 'All Posts', 'edit_posts', 'edit.php' ),       // self-link
			array( 'Add New',   'edit_posts', 'post-new.php' ),
		);

		$items = desktop_mode_build_dock_items();

		$this->assertSame( admin_url( 'edit.php' ), $items[0]['url'] );
		// Self-link still gets stripped; only the real child remains.
		$this->assertCount( 1, $items[0]['submenu'] );
		$this->assertSame( 'Add New', $items[0]['submenu'][0]['title'] );
	}

	/**
	 * Capability filtering interacts with the parent-URL rewrite:
	 * the "first submenu" we follow is the first one the current
	 * user can actually access. A submenu the user can't see must
	 * not become the parent's effective URL.
	 */
	public function test_parent_url_falls_through_to_first_capability_passing_submenu() {
		global $menu, $submenu;
		$subscriber_id = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		wp_set_current_user( $subscriber_id );

		$menu                = array( $this->make_menu_row( 'Tools', 'read', 'tools-root' ) );
		$submenu['tools-root'] = array(
			array( 'Admin Only', 'manage_options', 'admin-only' ),  // filtered out
			array( 'Public',     'read',           'public-page' ), // visible
		);

		$items = desktop_mode_build_dock_items();

		$this->assertCount( 1, $items );
		$this->assertSame( admin_url( 'admin.php?page=public-page' ), $items[0]['url'] );
	}

	public function test_desktop_mode_dock_item_filter_can_modify_each_entry() {
		global $menu;
		$menu = array( $this->make_menu_row( 'Posts', 'edit_posts', 'edit.php' ) );

		add_filter(
			'desktop_mode_dock_item',
			function ( $item, $slug ) {
				$item['title'] = strtoupper( $item['title'] );
				$item['slug']  = $slug;
				return $item;
			},
			10,
			2
		);

		$items = desktop_mode_build_dock_items();
		$this->assertSame( 'POSTS', $items[0]['title'] );
		$this->assertSame( 'edit.php', $items[0]['slug'] );
	}

	public function test_desktop_mode_dock_items_filter_can_replace_full_list() {
		global $menu;
		$menu = array( $this->make_menu_row( 'Posts', 'edit_posts', 'edit.php' ) );

		add_filter(
			'desktop_mode_dock_items',
			function () {
				return array( array( 'id' => 'replaced', 'title' => 'Replaced' ) );
			}
		);

		$items = desktop_mode_build_dock_items();
		$this->assertCount( 1, $items );
		$this->assertSame( 'replaced', $items[0]['id'] );
	}

	/**
	 * Dashicons values are passed through intact — these are CSS class
	 * names baked into Core's menu config and safe to render.
	 *
	 * @covers ::desktop_mode_sanitize_dock_icon
	 */
	public function test_icon_dashicon_class_preserved() {
		global $menu;
		$menu = array( $this->make_menu_row( 'Posts', 'edit_posts', 'edit.php', '', '', '', 'dashicons-admin-post' ) );

		$items = desktop_mode_build_dock_items();

		$this->assertSame( 'dashicons-admin-post', $items[0]['icon'] );
	}

	/**
	 * Falling back to the generic icon when the menu row doesn't supply
	 * one (or supplies an empty string) keeps the shell renderable.
	 *
	 * @covers ::desktop_mode_sanitize_dock_icon
	 */
	public function test_icon_falls_back_to_generic_when_empty() {
		global $menu;
		$menu = array( $this->make_menu_row( 'Posts', 'edit_posts', 'edit.php', '', '', '', '' ) );

		$items = desktop_mode_build_dock_items();

		$this->assertSame( 'dashicons-admin-generic', $items[0]['icon'] );
	}

	/**
	 * Core treats 'none' and 'div' as "no inline icon, style via CSS".
	 * The shell has no special handling for them, so collapsing to the
	 * generic dashicon gives a safe, visible fallback.
	 *
	 * @covers ::desktop_mode_sanitize_dock_icon
	 */
	public function test_icon_none_and_div_collapse_to_generic() {
		global $menu;
		$menu = array(
			$this->make_menu_row( 'None', 'read', 'none.php', '', '', 'hook-none', 'none' ),
			$this->make_menu_row( 'Div',  'read', 'div.php',  '', '', 'hook-div',  'div' ),
		);

		$items = desktop_mode_build_dock_items();

		$this->assertSame( 'dashicons-admin-generic', $items[0]['icon'] );
		$this->assertSame( 'dashicons-admin-generic', $items[1]['icon'] );
	}

	/**
	 * http(s) URLs — e.g. a plugin bundling its own PNG — pass through
	 * esc_url_raw so scheme-shaped bytes can't slip past.
	 *
	 * @covers ::desktop_mode_sanitize_dock_icon
	 */
	public function test_icon_http_url_preserved_after_sanitizing() {
		global $menu;
		$menu = array(
			$this->make_menu_row( 'X', 'read', 'x.php', '', '', 'hook-x', 'https://example.com/icon.png' ),
		);

		$items = desktop_mode_build_dock_items();

		$this->assertSame( 'https://example.com/icon.png', $items[0]['icon'] );
	}

	/**
	 * Inline SVG data URIs are the canonical menu-icon shape for
	 * modern WP plugins (Yoast, WooCommerce, Jetpack, etc.). The
	 * shell renders them via CSS `background-image`, which sandboxes
	 * scripts inside the SVG just like an `<img>` would, so passing
	 * a well-formed `data:image/svg+xml;base64,…` value through is
	 * safe and necessary — without it every plugin tile collapses to
	 * the gear fallback. The strict regex in `desktop_mode_sanitize_dock_icon`
	 * still rejects malformed shapes and non-SVG `data:` schemes
	 * (covered by sibling tests).
	 *
	 * @covers ::desktop_mode_sanitize_dock_icon
	 */
	public function test_icon_well_formed_svg_data_uri_passes_through() {
		global $menu;
		$svg  = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=';
		$menu = array( $this->make_menu_row( 'Y', 'read', 'y.php', '', '', 'hook-y', $svg ) );

		$items = desktop_mode_build_dock_items();

		$this->assertSame( $svg, $items[0]['icon'] );
	}

	/**
	 * A `javascript:` URL from a hostile plugin would execute as soon as
	 * the shell wrote it to an `<img src>` or anchor. Must be dropped to
	 * the fallback icon, not passed through.
	 *
	 * @covers ::desktop_mode_sanitize_dock_icon
	 */
	public function test_icon_javascript_url_is_rejected() {
		global $menu;
		$menu = array( $this->make_menu_row( 'Z', 'read', 'z.php', '', '', 'hook-z', 'javascript:alert(1)' ) );

		$items = desktop_mode_build_dock_items();

		$this->assertSame( 'dashicons-admin-generic', $items[0]['icon'] );
	}

	/**
	 * Non-image data URIs (e.g. `data:text/html,<script>...`) are a
	 * common XSS vector and must be rejected, even though `data:` itself
	 * is allowed for the SVG case.
	 *
	 * @covers ::desktop_mode_sanitize_dock_icon
	 */
	public function test_icon_non_svg_data_uri_is_rejected() {
		global $menu;
		$menu = array(
			$this->make_menu_row( 'A', 'read', 'a.php', '', '', 'hook-a', 'data:text/html,<script>alert(1)</script>' ),
		);

		$items = desktop_mode_build_dock_items();

		$this->assertSame( 'dashicons-admin-generic', $items[0]['icon'] );
	}

	/**
	 * A dashicons-prefixed value with embedded quotes would let a
	 * hostile plugin break out of the class attribute on the shell side.
	 * Strip everything that isn't a legal dashicon class character.
	 *
	 * @covers ::desktop_mode_sanitize_dock_icon
	 */
	public function test_icon_dashicon_breakout_attempt_is_scrubbed() {
		global $menu;
		$menu = array(
			$this->make_menu_row( 'B', 'read', 'b.php', '', '', 'hook-b', 'dashicons-admin-post" onerror="alert(1)' ),
		);

		$items = desktop_mode_build_dock_items();

		$this->assertSame( 'dashicons-admin-postonerroralert1', $items[0]['icon'] );
		$this->assertStringNotContainsString( '"', $items[0]['icon'] );
		$this->assertStringNotContainsString( ' ', $items[0]['icon'] );
	}

	/**
	 * Every built dock item carries a `placement` field — defaults to
	 * `'dock'` for every menu (the unified rail hosts both core and
	 * plugin items) — and an `isCore` flag the renderer uses to insert
	 * a visual separator between the core cluster and the plugin
	 * cluster.
	 *
	 * @covers ::desktop_mode_build_dock_items
	 * @covers ::desktop_mode_is_core_menu_slug
	 * @covers ::desktop_mode_dock_placement
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

		$items = desktop_mode_build_dock_items();
		$by_id = array();
		foreach ( $items as $item ) {
			$by_id[ $item['id'] ] = $item;
		}

		// Every visible item lands on the unified dock by default.
		$this->assertSame( 'dock', $by_id['menu-index-php']['placement'] );
		$this->assertSame( 'dock', $by_id['menu-edit-php']['placement'] );
		$this->assertSame( 'dock', $by_id['menu-options-general-php']['placement'] );
		$this->assertSame( 'dock', $by_id['menu-plugins-php']['placement'] );
		$this->assertSame( 'dock', $by_id['menu-woocommerce']['placement'] );
		$this->assertSame( 'dock', $by_id['menu-wpseo_dashboard']['placement'] );

		// `isCore` is what the JS renderer uses to insert the visual
		// separator between core and plugin tile clusters.
		$this->assertTrue( $by_id['menu-index-php']['isCore'] );
		$this->assertTrue( $by_id['menu-edit-php']['isCore'] );
		$this->assertTrue( $by_id['menu-options-general-php']['isCore'] );
		$this->assertTrue( $by_id['menu-plugins-php']['isCore'] );
		$this->assertFalse( $by_id['menu-woocommerce']['isCore'] );
		$this->assertFalse( $by_id['menu-wpseo_dashboard']['isCore'] );
	}

	/**
	 * CPTs registered by plugins route through `edit.php?post_type=…`.
	 * They should be treated as Core (left dock) because conceptually
	 * they're content, same as Posts and Pages.
	 *
	 * @covers ::desktop_mode_is_core_menu_slug
	 */
	public function test_cpt_routes_count_as_core() {
		$this->assertTrue( desktop_mode_is_core_menu_slug( 'edit.php?post_type=product' ) );
		$this->assertTrue( desktop_mode_is_core_menu_slug( 'edit.php?post_type=wp_block' ) );
	}

	/**
	 * `desktop_mode_dock_placement` lets plugins + site admins hide
	 * any menu item from the dock. Returning anything else coerces
	 * back to `'dock'` (the default).
	 *
	 * @covers ::desktop_mode_dock_placement
	 */
	public function test_placement_filter_can_hide_items() {
		add_filter(
			'desktop_mode_dock_placement',
			static function ( $placement, $slug ) {
				if ( 'background-tool' === $slug ) {
					return 'hidden';
				}
				return $placement;
			},
			10,
			2
		);

		// Hidden items disappear from the dock.
		$this->assertSame( 'hidden', desktop_mode_dock_placement( 'background-tool' ) );
		// Unrelated slugs still get the default answer.
		$this->assertSame( 'dock', desktop_mode_dock_placement( 'edit.php' ) );
		$this->assertSame( 'dock', desktop_mode_dock_placement( 'jetpack' ) );
	}

	/**
	 * A filter that returns garbage is ignored — items default to
	 * `'dock'` to keep the shell rendering predictably.
	 *
	 * @covers ::desktop_mode_dock_placement
	 */
	public function test_placement_filter_rejects_unknown_values() {
		add_filter(
			'desktop_mode_dock_placement',
			static function () {
				return 'sidebar'; // not a valid placement
			}
		);
		$this->assertSame( 'dock', desktop_mode_dock_placement( 'edit.php' ) );
		$this->assertSame( 'dock', desktop_mode_dock_placement( 'some-plugin' ) );
	}

	/**
	 * Plugins that don't want to claim chrome real estate can return
	 * `'hidden'` from the placement filter. The item must disappear
	 * from the unified dock payload while still being a valid
	 * server-side menu entry.
	 *
	 * @covers ::desktop_mode_dock_placement
	 * @covers ::desktop_mode_build_menu_payload
	 */
	public function test_hidden_placement_removes_item_from_dock() {
		add_filter(
			'desktop_mode_dock_placement',
			static function ( $placement, $slug ) {
				if ( 'background-tool' === $slug ) {
					return 'hidden';
				}
				return $placement;
			},
			10,
			2
		);

		$this->assertSame( 'hidden', desktop_mode_dock_placement( 'background-tool' ) );

		global $menu;
		$menu = array(
			$this->make_menu_row( 'Background Tool', 'manage_options', 'background-tool' ),
			$this->make_menu_row( 'Other Plugin', 'manage_options', 'other-plugin' ),
		);

		$payload  = desktop_mode_build_menu_payload();
		$dock_ids = wp_list_pluck( $payload['dockItems'], 'id' );

		$this->assertNotContains( 'menu-background-tool', $dock_ids );
		$this->assertContains( 'menu-other-plugin', $dock_ids );
	}

	/**
	 * Core menu slugs never resolve to a plugin file — even if some
	 * callback happens to be registered on the page hook. The classifier
	 * short-circuits before reflecting on $wp_filter, so the dock never
	 * shows a "Deactivate" action for Dashboard, Posts, Plugins, etc.
	 *
	 * @covers ::desktop_mode_resolve_menu_plugin_file
	 */
	public function test_resolve_plugin_file_returns_null_for_core_slugs() {
		$this->assertNull( desktop_mode_resolve_menu_plugin_file( 'index.php' ) );
		$this->assertNull( desktop_mode_resolve_menu_plugin_file( 'plugins.php' ) );
		$this->assertNull( desktop_mode_resolve_menu_plugin_file( 'edit.php' ) );
		$this->assertNull( desktop_mode_resolve_menu_plugin_file( 'edit.php?post_type=page' ) );
	}

	/**
	 * Unknown slugs with no registered page hook (or no plugin-owned
	 * callbacks on it) resolve to null. The right-click menu then skips
	 * the deactivate option entirely — better than a false positive
	 * that would 404 on the REST mutation.
	 *
	 * @covers ::desktop_mode_resolve_menu_plugin_file
	 */
	public function test_resolve_plugin_file_returns_null_for_unknown_slug() {
		$this->assertNull(
			desktop_mode_resolve_menu_plugin_file( 'nonexistent-menu-slug-xyz' )
		);
	}

	/**
	 * Desktop Mode is always its own special case — even when its own
	 * code registers a callback for a menu page hook, we MUST return
	 * null so the dock right-click can never offer to deactivate the
	 * very plugin rendering the dock. The plugins-window's
	 * self-deactivate path handles that scenario with the right
	 * confirmation + reload affordances.
	 *
	 * @covers ::desktop_mode_resolve_menu_plugin_file
	 */
	/**
	 * Positive path: a callback whose declaring file lives under
	 * `WP_PLUGIN_DIR/<folder>/…` resolves to the plugin file
	 * `get_plugins()` has under that folder.
	 *
	 * Setup is messy on purpose — we need a real on-disk PHP file
	 * inside the plugins directory (Reflection reads the absolute
	 * path) and a matching entry in `get_plugins()`. The fixture is
	 * written, included, used, and torn down within a single test.
	 *
	 * @covers ::desktop_mode_resolve_menu_plugin_file
	 * @covers ::desktop_mode_plugin_file_for_path
	 */
	public function test_resolve_plugin_file_returns_plugin_basename_when_callback_lives_in_plugin_dir() {
		$fake_folder = 'dm-positive-resolver-fixture';
		$fake_dir    = WP_PLUGIN_DIR . '/' . $fake_folder;
		$fake_basename = $fake_folder . '/' . $fake_folder . '.php';
		$fake_file   = WP_PLUGIN_DIR . '/' . $fake_basename;

		if ( ! is_dir( $fake_dir ) ) {
			mkdir( $fake_dir, 0755, true );
		}
		// Write a real plugin header so `get_plugins()` discovers the
		// fixture on its filesystem scan after we bust the plugin cache.
		// Without a `Plugin Name:` header WP skips the file entirely.
		file_put_contents(
			$fake_file,
			"<?php\n/**\n * Plugin Name: DM Positive Resolver Fixture\n * Version: 0.0.0\n */\nfunction dm_positive_resolver_fixture_render() {}\n"
		);
		require_once $fake_file;

		$inject = static function ( $plugins ) use ( $fake_basename ) {
			$plugins[ $fake_basename ] = array(
				'Name'        => 'DM Positive Resolver Fixture',
				'Version'     => '0.0.0',
				'Description' => 'Fixture for desktop-mode resolver test.',
			);
			return $plugins;
		};
		add_filter( 'all_plugins', $inject );
		// `get_plugins()` caches results per request and only runs the
		// `all_plugins` filter on a cache miss. The bootstrap has
		// almost certainly populated that cache already, so we must
		// invalidate it for our injected entry to be visible.
		wp_cache_delete( 'plugins', 'plugins' );

		$slug     = 'dm-positive-resolver-fixture-page';
		$hookname = get_plugin_page_hookname( $slug, '' );
		add_action( $hookname, 'dm_positive_resolver_fixture_render' );

		$resolved = desktop_mode_resolve_menu_plugin_file( $slug );

		remove_action( $hookname, 'dm_positive_resolver_fixture_render' );
		remove_filter( 'all_plugins', $inject );
		wp_cache_delete( 'plugins', 'plugins' );
		// Best-effort cleanup; harmless if the file is already gone.
		// phpcs:ignore WordPress.WP.AlternativeFunctions.unlink_unlink
		@unlink( $fake_file );
		// phpcs:ignore WordPress.WP.AlternativeFunctions.rmdir_rmdir
		@rmdir( $fake_dir );

		$this->assertSame( $fake_basename, $resolved );
	}

	public function test_resolve_plugin_file_excludes_desktop_mode_itself() {
		$slug     = 'desktop-mode-self-test';
		$hookname = get_plugin_page_hookname( $slug, '' );
		$callback = static function () {
			return null;
		};
		add_action( $hookname, $callback );

		$resolved = desktop_mode_resolve_menu_plugin_file( $slug );

		remove_action( $hookname, $callback );

		// The closure is declared in this test file, which lives under
		// `tests/phpunit/tests/` — outside `WP_PLUGIN_DIR` — so the
		// resolver must return null. (If a future change ever placed
		// the test harness inside the plugin dir, the self-exclusion
		// guard below would still catch the desktop-mode case.)
		$this->assertNull( $resolved );
	}
}
