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
		$this->assertSame( esc_url( $url ), desktop_mode_menu_item_url( $url ) );
	}

	public function test_passes_through_absolute_https_url() {
		$url = 'https://example.com/foo?bar=baz';
		$this->assertSame( esc_url( $url ), desktop_mode_menu_item_url( $url ) );
	}

	public function test_routes_php_slug_to_admin_url() {
		$this->assertSame( esc_url( admin_url( 'edit.php' ) ), desktop_mode_menu_item_url( 'edit.php' ) );
	}

	public function test_preserves_query_string_on_php_slugs() {
		$this->assertSame(
			esc_url( admin_url( 'edit.php?post_type=page' ) ),
			desktop_mode_menu_item_url( 'edit.php?post_type=page' )
		);
	}

	/**
	 * Plugin pages register their slug as a plain string without ".php";
	 * those must be routed through admin.php?page=<slug>.
	 */
	public function test_routes_plugin_page_slug_through_admin_php() {
		$this->assertSame(
			esc_url( admin_url( 'admin.php?page=my-plugin' ) ),
			desktop_mode_menu_item_url( 'my-plugin' )
		);
	}

	public function test_url_encodes_plugin_page_slug() {
		$this->assertSame(
			esc_url( admin_url( 'admin.php?page=' . rawurlencode( 'plugin with spaces' ) ) ),
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
}
