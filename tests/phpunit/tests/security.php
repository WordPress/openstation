<?php
/**
 * Security-hardening tests for the OpenStation plugin.
 *
 * Covers the Phase-1 hardeners introduced alongside the DX refactor:
 * the URL helpers that replace raw `strpos()` same-origin checks, the
 * admin-target file whitelist, the dock-icon sanitizer that now rejects
 * `data:` URIs outright, and the session dimension clamp that rejects
 * non-numeric input instead of silently coercing it to zero.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-security
 */
class Tests_OpenStation_Security extends WP_UnitTestCase {

	/**
	 * @covers ::open_station_url_is_same_admin
	 */
	public function test_same_admin_url_passes() {
		$this->assertTrue( open_station_url_is_same_admin( admin_url( 'edit.php' ) ) );
		$this->assertTrue( open_station_url_is_same_admin( admin_url( 'plugins.php?page=foo' ) ) );
	}

	/**
	 * @covers ::open_station_url_is_same_admin
	 */
	public function test_empty_or_non_string_rejected() {
		$this->assertFalse( open_station_url_is_same_admin( '' ) );
		$this->assertFalse( open_station_url_is_same_admin( null ) );
		$this->assertFalse( open_station_url_is_same_admin( 123 ) );
		$this->assertFalse( open_station_url_is_same_admin( array( 'url' => admin_url() ) ) );
	}

	/**
	 * Cross-origin URL must fail the same-origin check, even when its
	 * path happens to start with `/wp-admin/` — a raw `strpos` against
	 * the stringified admin URL would accept a URL whose normalization
	 * happens to share the prefix.
	 *
	 * @covers ::open_station_url_is_same_admin
	 */
	public function test_cross_origin_rejected() {
		$this->assertFalse( open_station_url_is_same_admin( 'https://evil.example.com/wp-admin/edit.php' ) );
		$this->assertFalse( open_station_url_is_same_admin( 'http://evil.example.com/wp-admin/' ) );
	}

	/**
	 * Protocol-relative URLs (`//evil.com/…`) can smuggle cross-origin
	 * addresses past a prefix check — parse + host compare catches them.
	 *
	 * @covers ::open_station_url_is_same_admin
	 */
	public function test_protocol_relative_rejected() {
		$this->assertFalse( open_station_url_is_same_admin( '//evil.example.com/wp-admin/edit.php' ) );
	}

	/**
	 * A URL whose path is prefix-similar but not under `/wp-admin/`
	 * (e.g. `/wp-administrator/…`) must not pass.
	 *
	 * @covers ::open_station_url_is_same_admin
	 */
	public function test_look_alike_path_rejected() {
		$home_host = wp_parse_url( home_url(), PHP_URL_HOST );
		$this->assertFalse(
			open_station_url_is_same_admin( 'http://' . $home_host . '/wp-administrator/edit.php' )
		);
	}

	/**
	 * @covers ::open_station_resolve_admin_target
	 */
	public function test_resolve_admin_target_valid_file() {
		$resolved = open_station_resolve_admin_target( 'edit.php' );
		$this->assertIsString( $resolved );
		$this->assertStringContainsString( '/wp-admin/edit.php', $resolved );
	}

	/**
	 * @covers ::open_station_resolve_admin_target
	 */
	public function test_resolve_admin_target_path_traversal_rejected() {
		$this->assertWPError( open_station_resolve_admin_target( '../../wp-config.php' ) );
		$this->assertWPError( open_station_resolve_admin_target( '..\\..\\wp-config.php' ) );
		$this->assertWPError( open_station_resolve_admin_target( 'sub/edit.php' ) );
	}

	/**
	 * @covers ::open_station_resolve_admin_target
	 */
	public function test_resolve_admin_target_empty_rejected() {
		$this->assertWPError( open_station_resolve_admin_target( '' ) );
		$this->assertWPError( open_station_resolve_admin_target( null ) );
	}

	/**
	 * Plausibly-formatted but nonexistent filenames must be rejected —
	 * the filesystem check is what separates a real admin page from an
	 * attacker-chosen string that happens to match the allow-regex.
	 *
	 * @covers ::open_station_resolve_admin_target
	 */
	public function test_resolve_admin_target_nonexistent_file_rejected() {
		$error = open_station_resolve_admin_target( 'definitely-not-a-real-admin-page.php' );
		$this->assertWPError( $error );
		$this->assertSame( 'open_station_unknown_target', $error->get_error_code() );
	}

	/**
	 * @covers ::open_station_resolve_admin_target
	 */
	public function test_resolve_admin_target_non_php_rejected() {
		$this->assertWPError( open_station_resolve_admin_target( 'edit' ) );
		$this->assertWPError( open_station_resolve_admin_target( 'edit.html' ) );
		$this->assertWPError( open_station_resolve_admin_target( 'index.php?shenanigans=1' ) );
	}

	/**
	 * @covers ::open_station_sanitize_dock_icon
	 */
	public function test_dashicon_class_allowed() {
		$this->assertSame( 'dashicons-admin-post', open_station_sanitize_dock_icon( 'dashicons-admin-post' ) );
		$this->assertSame( 'dashicons-admin-generic', open_station_sanitize_dock_icon( '' ) );
	}

	/**
	 * @covers ::open_station_sanitize_dock_icon
	 */
	public function test_http_image_url_allowed() {
		$this->assertSame(
			'https://example.com/icon.png',
			open_station_sanitize_dock_icon( 'https://example.com/icon.png' )
		);
	}

	/**
	 * `data:image/svg+xml` icons are accepted in two well-formed
	 * shapes (`;base64,<base64>` and `,<percent-encoded>`) because
	 * that's how WordPress plugins universally ship their admin-menu
	 * icon (Yoast, WooCommerce, Jetpack, et al.). The shell renders
	 * them via CSS `background-image`, which sandboxes scripts inside
	 * the SVG just like an `<img>` would. Rejecting them across the
	 * board collapses every plugin's branded icon to the gear fallback.
	 *
	 * Malformed SVG data URIs and non-SVG `data:` schemes still bounce.
	 *
	 * @covers ::open_station_sanitize_dock_icon
	 */
	public function test_svg_data_uri_allowed() {
		$base64 = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
		$this->assertSame( $base64, open_station_sanitize_dock_icon( $base64 ) );

		$encoded = 'data:image/svg+xml,%3Csvg%2F%3E';
		$this->assertSame( $encoded, open_station_sanitize_dock_icon( $encoded ) );

		// Scheme casing is allowed (browsers accept it); payload casing
		// stays as-given (base64 alphabet is case-sensitive).
		$mixed_case = 'DATA:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
		$this->assertSame( $mixed_case, open_station_sanitize_dock_icon( $mixed_case ) );
	}

	/**
	 * Non-SVG `data:` schemes and malformed SVG data URIs return the
	 * fallback. The earlier blanket rejection was overzealous, but
	 * the targeted rejection of the dangerous shapes still holds.
	 *
	 * @covers ::open_station_sanitize_dock_icon
	 */
	public function test_data_uri_rejected_when_not_svg_or_malformed() {
		$fallback = 'dashicons-admin-generic';
		$this->assertSame( $fallback, open_station_sanitize_dock_icon( 'data:text/html,<script>alert(1)</script>' ) );
		$this->assertSame( $fallback, open_station_sanitize_dock_icon( 'data:application/javascript,alert(1)' ) );
		// `;utf8,` is not one of the two valid SVG payload encodings —
		// treat the unrecognised parameter as malformed.
		$this->assertSame( $fallback, open_station_sanitize_dock_icon( 'data:image/svg+xml;utf8,<svg onload="alert(1)"></svg>' ) );
		// Smuggled quote / whitespace in the base64 payload — strict
		// regex must reject.
		$this->assertSame( $fallback, open_station_sanitize_dock_icon( 'data:image/svg+xml;base64,PHN2Z" onerror=alert(1) x="' ) );
		$this->assertSame( $fallback, open_station_sanitize_dock_icon( "data:image/svg+xml;base64,PHN2\nZz4=" ) );
	}

	/**
	 * @covers ::open_station_sanitize_dock_icon
	 */
	public function test_javascript_uri_rejected() {
		$fallback = 'dashicons-admin-generic';
		$this->assertSame( $fallback, open_station_sanitize_dock_icon( 'javascript:alert(1)' ) );
		$this->assertSame( $fallback, open_station_sanitize_dock_icon( 'file:///etc/passwd' ) );
		$this->assertSame( $fallback, open_station_sanitize_dock_icon( 'vbscript:MsgBox' ) );
	}

	/**
	 * @covers ::open_station_sanitize_session_dimension
	 */
	public function test_dimension_clamps_to_bounds() {
		$this->assertSame( 100, open_station_sanitize_session_dimension( 100, 0, 1000 ) );
		$this->assertSame( 1000, open_station_sanitize_session_dimension( 99999, 0, 1000 ) );
		$this->assertSame( 0, open_station_sanitize_session_dimension( -500, 0, 1000 ) );
	}

	/**
	 * Non-numeric inputs (strings without a leading number, arrays,
	 * objects, NAN, INF) return `$min` rather than silently coercing
	 * to zero via PHP's permissive `(int)` cast.
	 *
	 * @covers ::open_station_sanitize_session_dimension
	 */
	public function test_dimension_non_numeric_returns_min() {
		$this->assertSame( 50, open_station_sanitize_session_dimension( 'garbage', 50, 1000 ) );
		$this->assertSame( 50, open_station_sanitize_session_dimension( array( 200 ), 50, 1000 ) );
		$this->assertSame( 50, open_station_sanitize_session_dimension( null, 50, 1000 ) );
		$this->assertSame( 50, open_station_sanitize_session_dimension( INF, 50, 1000 ) );
		$this->assertSame( 50, open_station_sanitize_session_dimension( NAN, 50, 1000 ) );
	}

	/**
	 * Whitespace-wrapped numeric strings are accepted — users of the
	 * helper don't want to trim upstream, and PHP's `is_numeric()`
	 * accepts leading/trailing whitespace after a `trim()`.
	 *
	 * @covers ::open_station_sanitize_session_dimension
	 */
	public function test_dimension_numeric_string_accepted() {
		$this->assertSame( 200, open_station_sanitize_session_dimension( '  200  ', 0, 1000 ) );
		$this->assertSame( 200, open_station_sanitize_session_dimension( '200', 0, 1000 ) );
	}

	/**
	 * Session sanitizer drops windows whose URL points off-origin —
	 * the `open_station_url_is_same_admin()` gate replaces the prior `strpos`
	 * check and now rejects protocol-relative + cross-origin URLs that
	 * a prefix comparison would have accepted.
	 *
	 * @covers ::open_station_sanitize_session
	 */
	public function test_session_rejects_cross_origin_window() {
		$session = array(
			'windows' => array(
				array(
					'id'     => 'evil',
					'url'    => 'https://evil.example.com/wp-admin/edit.php',
					'title'  => 'Posts',
					'icon'   => 'dashicons-admin-post',
					'state'  => 'normal',
					'x'      => 0,
					'y'      => 0,
					'width'  => 800,
					'height' => 600,
				),
			),
		);
		$clean = open_station_sanitize_session( $session );
		$this->assertSame( array(), $clean['windows'] );
	}

	/**
	 * External-tab URLs are hard-capped at 2048 characters to keep
	 * user meta from ballooning on a runaway client. Over-length URLs
	 * are dropped silently (not truncated — a truncated URL points
	 * somewhere we don't control).
	 *
	 * @covers ::open_station_sanitize_session
	 */
	public function test_session_drops_oversized_external_tab_urls() {
		$long_url = 'https://example.com/' . str_repeat( 'a', 2100 );
		$session = array(
			'windows' => array(
				array(
					'id'    => 'wp-window-edit-php',
					'url'   => admin_url( 'edit.php' ),
					'state' => 'normal',
					'x'     => 0,
					'y'     => 0,
					'width' => 800,
					'height' => 600,
					'externalTabs' => array(
						array( 'url' => $long_url, 'label' => 'Too long' ),
						array( 'url' => 'https://example.com/ok', 'label' => 'OK' ),
					),
				),
			),
		);
		$clean = open_station_sanitize_session( $session );
		$this->assertCount( 1, $clean['windows'] );
		$tabs = $clean['windows'][0]['externalTabs'] ?? array();
		$this->assertCount( 1, $tabs );
		$this->assertSame( 'https://example.com/ok', $tabs[0]['url'] );
	}

	/**
	 * Portal `target` sanitization must now go through the file-
	 * exists whitelist — a name like `definitely-not-a-real-page.php`
	 * that matches the previous regex-only check is rejected because
	 * no such file ships in `wp-admin/`.
	 *
	 * @covers ::open_station_sanitize_portal_target
	 */
	public function test_portal_target_nonexistent_file_rejected() {
		$this->assertSame(
			'',
			open_station_sanitize_portal_target( '/wp-admin/definitely-not-a-real-page.php' )
		);
	}

	/**
	 * @covers ::open_station_sanitize_portal_target
	 */
	public function test_portal_target_valid_admin_page_accepted() {
		$resolved = open_station_sanitize_portal_target( '/wp-admin/edit.php?post_type=page' );
		$this->assertNotSame( '', $resolved );
		$this->assertStringContainsString( 'edit.php', $resolved );
		$this->assertStringContainsString( 'post_type=page', $resolved );
	}
}
