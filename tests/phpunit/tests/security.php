<?php

class Tests_OpenStation_Security extends WP_UnitTestCase {

	public function test_same_admin_url_passes() {
		$this->assertTrue( openstation_url_is_same_admin( admin_url( 'edit.php' ) ) );
		$this->assertTrue( openstation_url_is_same_admin( admin_url( 'plugins.php?page=foo' ) ) );
	}

	public function test_empty_or_non_string_rejected() {
		$this->assertFalse( openstation_url_is_same_admin( '' ) );
		$this->assertFalse( openstation_url_is_same_admin( null ) );
		$this->assertFalse( openstation_url_is_same_admin( 123 ) );
		$this->assertFalse( openstation_url_is_same_admin( array( 'url' => admin_url() ) ) );
	}

	public function test_cross_origin_rejected() {
		$this->assertFalse( openstation_url_is_same_admin( 'https://evil.example.com/wp-admin/edit.php' ) );
		$this->assertFalse( openstation_url_is_same_admin( 'http://evil.example.com/wp-admin/' ) );
	}

	public function test_protocol_relative_rejected() {
		$this->assertFalse( openstation_url_is_same_admin( '//evil.example.com/wp-admin/edit.php' ) );
	}

	public function test_look_alike_path_rejected() {
		$home_host = wp_parse_url( home_url(), PHP_URL_HOST );
		$this->assertFalse(
			openstation_url_is_same_admin( 'http://' . $home_host . '/wp-administrator/edit.php' )
		);
	}

	public function test_resolve_admin_target_valid_file() {
		$resolved = openstation_resolve_admin_target( 'edit.php' );
		$this->assertIsString( $resolved );
		$this->assertStringContainsString( '/wp-admin/edit.php', $resolved );
	}

	public function test_resolve_admin_target_path_traversal_rejected() {
		$this->assertWPError( openstation_resolve_admin_target( '../../wp-config.php' ) );
		$this->assertWPError( openstation_resolve_admin_target( '..\\..\\wp-config.php' ) );
		$this->assertWPError( openstation_resolve_admin_target( 'sub/edit.php' ) );
	}

	public function test_resolve_admin_target_empty_rejected() {
		$this->assertWPError( openstation_resolve_admin_target( '' ) );
		$this->assertWPError( openstation_resolve_admin_target( null ) );
	}

	public function test_resolve_admin_target_nonexistent_file_rejected() {
		$error = openstation_resolve_admin_target( 'definitely-not-a-real-admin-page.php' );
		$this->assertWPError( $error );
		$this->assertSame( 'openstation_unknown_target', $error->get_error_code() );
	}

	public function test_resolve_admin_target_non_php_rejected() {
		$this->assertWPError( openstation_resolve_admin_target( 'edit' ) );
		$this->assertWPError( openstation_resolve_admin_target( 'edit.html' ) );
		$this->assertWPError( openstation_resolve_admin_target( 'index.php?shenanigans=1' ) );
	}

	public function test_dashicon_class_allowed() {
		$this->assertSame( 'dashicons-admin-post', openstation_sanitize_dock_icon( 'dashicons-admin-post' ) );
		$this->assertSame( 'dashicons-admin-generic', openstation_sanitize_dock_icon( '' ) );
	}

	public function test_http_image_url_allowed() {
		$this->assertSame(
			'https://example.com/icon.png',
			openstation_sanitize_dock_icon( 'https://example.com/icon.png' )
		);
	}

	public function test_svg_data_uri_allowed() {
		$base64 = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
		$this->assertSame( $base64, openstation_sanitize_dock_icon( $base64 ) );

		$encoded = 'data:image/svg+xml,%3Csvg%2F%3E';
		$this->assertSame( $encoded, openstation_sanitize_dock_icon( $encoded ) );

		$mixed_case = 'DATA:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
		$this->assertSame( $mixed_case, openstation_sanitize_dock_icon( $mixed_case ) );
	}

	public function test_data_uri_rejected_when_not_svg_or_malformed() {
		$fallback = 'dashicons-admin-generic';
		$this->assertSame( $fallback, openstation_sanitize_dock_icon( 'data:text/html,<script>alert(1)</script>' ) );
		$this->assertSame( $fallback, openstation_sanitize_dock_icon( 'data:application/javascript,alert(1)' ) );

		$this->assertSame( $fallback, openstation_sanitize_dock_icon( 'data:image/svg+xml;utf8,<svg onload="alert(1)"></svg>' ) );

		$this->assertSame( $fallback, openstation_sanitize_dock_icon( 'data:image/svg+xml;base64,PHN2Z" onerror=alert(1) x="' ) );
		$this->assertSame( $fallback, openstation_sanitize_dock_icon( "data:image/svg+xml;base64,PHN2\nZz4=" ) );
	}

	public function test_javascript_uri_rejected() {
		$fallback = 'dashicons-admin-generic';
		$this->assertSame( $fallback, openstation_sanitize_dock_icon( 'javascript:alert(1)' ) );
		$this->assertSame( $fallback, openstation_sanitize_dock_icon( 'file:///etc/passwd' ) );
		$this->assertSame( $fallback, openstation_sanitize_dock_icon( 'vbscript:MsgBox' ) );
	}

	public function test_dimension_clamps_to_bounds() {
		$this->assertSame( 100, openstation_sanitize_session_dimension( 100, 0, 1000 ) );
		$this->assertSame( 1000, openstation_sanitize_session_dimension( 99999, 0, 1000 ) );
		$this->assertSame( 0, openstation_sanitize_session_dimension( -500, 0, 1000 ) );
	}

	public function test_dimension_non_numeric_returns_min() {
		$this->assertSame( 50, openstation_sanitize_session_dimension( 'garbage', 50, 1000 ) );
		$this->assertSame( 50, openstation_sanitize_session_dimension( array( 200 ), 50, 1000 ) );
		$this->assertSame( 50, openstation_sanitize_session_dimension( null, 50, 1000 ) );
		$this->assertSame( 50, openstation_sanitize_session_dimension( INF, 50, 1000 ) );
		$this->assertSame( 50, openstation_sanitize_session_dimension( NAN, 50, 1000 ) );
	}

	public function test_dimension_numeric_string_accepted() {
		$this->assertSame( 200, openstation_sanitize_session_dimension( '  200  ', 0, 1000 ) );
		$this->assertSame( 200, openstation_sanitize_session_dimension( '200', 0, 1000 ) );
	}

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
		$clean = openstation_sanitize_session( $session );
		$this->assertSame( array(), $clean['windows'] );
	}

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
		$clean = openstation_sanitize_session( $session );
		$this->assertCount( 1, $clean['windows'] );
		$tabs = $clean['windows'][0]['externalTabs'] ?? array();
		$this->assertCount( 1, $tabs );
		$this->assertSame( 'https://example.com/ok', $tabs[0]['url'] );
	}

	public function test_portal_target_nonexistent_file_rejected() {
		$this->assertSame(
			'',
			openstation_sanitize_portal_target( '/wp-admin/definitely-not-a-real-page.php' )
		);
	}

	public function test_portal_target_valid_admin_page_accepted() {
		$resolved = openstation_sanitize_portal_target( '/wp-admin/edit.php?post_type=page' );
		$this->assertNotSame( '', $resolved );
		$this->assertStringContainsString( 'edit.php', $resolved );
		$this->assertStringContainsString( 'post_type=page', $resolved );
	}
}
