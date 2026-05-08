<?php
/**
 * Tests for the menu-slug → admin URL converter used by the dock builder.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 *
 * @covers ::desktop_mode_menu_item_url
 */
class Tests_DesktopMode_MenuItemUrl extends WP_UnitTestCase {

	public function test_passes_through_absolute_http_url() {
		$url = 'http://example.com/foo';
		$this->assertSame( esc_url_raw( $url ), desktop_mode_menu_item_url( $url ) );
	}

	public function test_passes_through_absolute_https_url() {
		$url = 'https://example.com/foo?bar=baz';
		$this->assertSame( esc_url_raw( $url ), desktop_mode_menu_item_url( $url ) );
	}

	public function test_routes_php_slug_to_admin_url() {
		$this->assertSame( esc_url_raw( admin_url( 'edit.php' ) ), desktop_mode_menu_item_url( 'edit.php' ) );
	}

	public function test_preserves_query_string_on_php_slugs() {
		$this->assertSame(
			esc_url_raw( admin_url( 'edit.php?post_type=page' ) ),
			desktop_mode_menu_item_url( 'edit.php?post_type=page' )
		);
	}

	/**
	 * Plugin pages register their slug as a plain string without ".php";
	 * those must be routed through admin.php?page=<slug>.
	 */
	public function test_routes_plugin_page_slug_through_admin_php() {
		$this->assertSame(
			esc_url_raw( admin_url( 'admin.php?page=my-plugin' ) ),
			desktop_mode_menu_item_url( 'my-plugin' )
		);
	}

	public function test_url_encodes_plugin_page_slug() {
		$this->assertSame(
			esc_url_raw( admin_url( 'admin.php?page=' . rawurlencode( 'plugin with spaces' ) ) ),
			desktop_mode_menu_item_url( 'plugin with spaces' )
		);
	}

	/**
	 * Path traversal sequences must be stripped so a malicious menu slug
	 * can't escape the wp-admin directory via the generated URL.
	 */
	public function test_strips_path_traversal_sequences() {
		$result = desktop_mode_menu_item_url( '../../etc/passwd' );
		$this->assertStringNotContainsString( '..', $result );
	}

	public function test_strips_path_traversal_in_php_slug() {
		$result = desktop_mode_menu_item_url( '../edit.php' );
		$this->assertStringNotContainsString( '..', $result );
		$this->assertStringContainsString( 'edit.php', $result );
	}

	/**
	 * `add_submenu_page()` legally accepts a slug containing query
	 * parameters (page slug + `&key=value` pairs). WooCommerce uses
	 * this for every wc-admin React route — `wc-admin&path=/customers`,
	 * `wc-admin&path=/analytics/overview`, etc.
	 *
	 * The naive `rawurlencode()` branch would mangle the `&`
	 * separator into `%26` and the embedded `=` into `%3D`, packing
	 * `path` into the `page` value and breaking WC's router (the
	 * page renders blank instead of the customer table). The
	 * embedded-query branch must split the slug, encode each part
	 * once, and reassemble with `&` as a real separator.
	 */
	public function test_routes_slug_with_embedded_query_params() {
		$result = desktop_mode_menu_item_url( 'wc-admin&path=/customers' );
		$this->assertStringContainsString( 'page=wc-admin', $result );
		$this->assertStringNotContainsString( 'page=wc-admin%26', $result );
		$this->assertStringNotContainsString( '%3D', $result );
		// `path` must arrive as a top-level query parameter so WC's
		// router resolves it instead of seeing it packed into `page`.
		parse_str( wp_parse_url( html_entity_decode( $result ), PHP_URL_QUERY ), $args );
		$this->assertSame( 'wc-admin', $args['page'] );
		$this->assertSame( '/customers', $args['path'] );
	}

	public function test_routes_slug_with_multiple_embedded_query_params() {
		$result = desktop_mode_menu_item_url( 'wc-admin&path=/analytics/orders&period=year' );
		parse_str( wp_parse_url( html_entity_decode( $result ), PHP_URL_QUERY ), $args );
		$this->assertSame( 'wc-admin', $args['page'] );
		$this->assertSame( '/analytics/orders', $args['path'] );
		$this->assertSame( 'year', $args['period'] );
	}

	/**
	 * Submenus registered under a `.php` parent (Tools, Settings,
	 * Appearance, etc.) get linked by classic admin as
	 * `parent.php?page=<slug>`, not `admin.php?page=<slug>`. The
	 * resolver mirrors `menu_page_url()`'s read of `$_parent_pages`
	 * so dockItems URLs match what WordPress actually renders in
	 * the iframe — the prerequisite for the link router's slug-
	 * equality lookup to match Tools→Scheduled Actions,
	 * Settings→Permalinks, etc.
	 *
	 * Tests pin `$_parent_pages` directly: that's the same global
	 * `add_submenu_page()` populates and `menu_page_url()` reads.
	 * Going through `add_submenu_page()` would couple the test to
	 * the runner's current-user cap, which isn't the surface under
	 * test.
	 */
	public function test_routes_submenu_slug_through_php_parent() {
		global $_parent_pages;
		$_parent_pages['scheduler'] = 'tools.php';

		$this->assertSame(
			esc_url_raw( admin_url( 'tools.php?page=scheduler' ) ),
			desktop_mode_menu_item_url( 'scheduler' )
		);

		unset( $_parent_pages['scheduler'] );
	}

	public function test_routes_submenu_slug_through_php_parent_with_embedded_query() {
		global $_parent_pages;
		$_parent_pages['scheduler'] = 'tools.php';

		$result = desktop_mode_menu_item_url( 'scheduler&status=past-due' );

		parse_str( wp_parse_url( html_entity_decode( $result ), PHP_URL_QUERY ), $args );
		$this->assertSame( 'scheduler', $args['page'] );
		$this->assertSame( 'past-due', $args['status'] );
		$this->assertStringContainsString( 'tools.php', $result );

		unset( $_parent_pages['scheduler'] );
	}

	/**
	 * Submenus registered under a slug-based parent (WooCommerce's
	 * `wc-admin` under `woocommerce`) collapse to `admin.php?page=…`
	 * — the same fallback `menu_page_url()` lands on. Validates the
	 * resolver doesn't accidentally route through a phantom
	 * `woocommerce.php`.
	 */
	public function test_routes_submenu_slug_under_slug_parent_through_admin_php() {
		global $_parent_pages;
		$_parent_pages['woocommerce'] = 'woocommerce';
		$_parent_pages['wc-admin']    = 'woocommerce';

		$this->assertSame(
			esc_url_raw( admin_url( 'admin.php?page=wc-admin' ) ),
			desktop_mode_menu_item_url( 'wc-admin' )
		);

		unset( $_parent_pages['woocommerce'], $_parent_pages['wc-admin'] );
	}

	/**
	 * Top-level slug menus (registered with `add_menu_page()`)
	 * record themselves as their own parent — `$_parent_pages[$slug]
	 * = $slug`. Core's resolver collapses these to
	 * `admin.php?page=…`; mirror that exactly.
	 */
	public function test_routes_top_level_slug_through_admin_php() {
		global $_parent_pages;
		$_parent_pages['my-top-level'] = 'my-top-level';

		$this->assertSame(
			esc_url_raw( admin_url( 'admin.php?page=my-top-level' ) ),
			desktop_mode_menu_item_url( 'my-top-level' )
		);

		unset( $_parent_pages['my-top-level'] );
	}

	/**
	 * Unregistered slug → fall back to `admin.php?page=…`. Slugs
	 * land here when a plugin populates `$submenu` directly without
	 * routing through `add_submenu_page()` (rare but seen in older
	 * plugins). Returning a valid `admin.php` URL keeps the dock
	 * functional even on those quirky registrations.
	 */
	public function test_falls_back_to_admin_php_for_unregistered_slug() {
		// No `$_parent_pages` entry — no fixture set up.
		$this->assertSame(
			esc_url_raw( admin_url( 'admin.php?page=unhooked' ) ),
			desktop_mode_menu_item_url( 'unhooked' )
		);
	}

	public function test_embedded_query_param_with_only_key() {
		// Trailing `&` with no value — must not crash, must still
		// produce a valid `?page=…` URL.
		$result = desktop_mode_menu_item_url( 'wc-admin&' );
		parse_str( wp_parse_url( html_entity_decode( $result ), PHP_URL_QUERY ), $args );
		$this->assertSame( 'wc-admin', $args['page'] );
	}
}
