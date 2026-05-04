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
class Tests_DesktopMode_WpDesktopMenuItemUrl extends WP_UnitTestCase {

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

	public function test_embedded_query_param_with_only_key() {
		// Trailing `&` with no value — must not crash, must still
		// produce a valid `?page=…` URL.
		$result = desktop_mode_menu_item_url( 'wc-admin&' );
		parse_str( wp_parse_url( html_entity_decode( $result ), PHP_URL_QUERY ), $args );
		$this->assertSame( 'wc-admin', $args['page'] );
	}
}
