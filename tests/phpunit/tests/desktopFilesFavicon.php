<?php

class Tests_OpenStation_Files_Favicon extends WP_UnitTestCase {

	const PNG_BYTES = "\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xfc\xff\xff?\x03\x05\x00\x06\x07\x02\xfe\xa3\x9b\xd6\xa9\x00\x00\x00\x00IEND\xaeB`\x82";

	public function set_up() {
		parent::set_up();
		remove_all_filters( 'pre_http_request' );
		remove_all_filters( 'openstation_resolve_favicon' );
	}

	public function tear_down() {
		remove_all_filters( 'pre_http_request' );
		remove_all_filters( 'openstation_resolve_favicon' );
		parent::tear_down();
	}

	private function expected_png_data_uri() {
		return 'data:image/png;base64,' . base64_encode( self::PNG_BYTES );
	}

	private function stub_http( array $responders ) {
		add_filter(
			'pre_http_request',
			static function ( $preempt, $args, $url ) use ( $responders ) {
				foreach ( $responders as $needle => $response ) {
					if ( false !== strpos( $url, $needle ) ) {
						return $response;
					}
				}
				return $preempt;
			},
			10,
			3
		);
	}

	private function http_response( $body, $code = 200, $content_type = 'text/html; charset=utf-8' ) {
		return array(
			'response' => array( 'code' => $code, 'message' => 'OK' ),
			'body'     => $body,
			'headers'  => array( 'content-type' => $content_type ),
			'cookies'  => array(),
			'filename' => null,
		);
	}

	public function test_resolves_link_tag_in_html() {
		$html = '<html><head><link rel="icon" href="/icon.png"></head></html>';
		$this->stub_http( array(
			'example.com/icon.png' => $this->http_response( self::PNG_BYTES, 200, 'image/png' ),
			'example.com'          => $this->http_response( $html ),
		) );

		$result = openstation_resolve_favicon( 'https://example.com/page' );
		$this->assertSame( $this->expected_png_data_uri(), $result );
	}

	public function test_resolves_apple_touch_icon_when_no_plain_icon() {
		$html = '<html><head><link rel="apple-touch-icon" href="/apple.png"></head></html>';
		$this->stub_http( array(
			'example.com/apple.png' => $this->http_response( self::PNG_BYTES, 200, 'image/png' ),
			'example.com'           => $this->http_response( $html ),
		) );

		$result = openstation_resolve_favicon( 'https://example.com/' );
		$this->assertSame( $this->expected_png_data_uri(), $result );
	}

	public function test_falls_back_to_root_favicon_ico() {
		$html = '<html><head><title>No icon link</title></head></html>';
		$this->stub_http( array(
			'example.com/favicon.ico' => $this->http_response( self::PNG_BYTES, 200, 'image/png' ),
			'example.com'             => $this->http_response( $html ),
		) );

		$result = openstation_resolve_favicon( 'https://example.com/some/page' );
		$this->assertSame( $this->expected_png_data_uri(), $result );
	}

	public function test_resolves_relative_href_against_page_url() {
		$html = '<html><head><link rel="icon" href="img/icon.png"></head></html>';

		$this->stub_http( array(
			'example.com/sub/img/icon.png' => $this->http_response( self::PNG_BYTES, 200, 'image/png' ),
			'example.com'                  => $this->http_response( $html ),
		) );

		$result = openstation_resolve_favicon( 'https://example.com/sub/page' );
		$this->assertSame( $this->expected_png_data_uri(), $result );
	}

	public function test_rejects_non_image_content_type() {
		$html = '<html><head><link rel="icon" href="/icon"></head></html>';
		$this->stub_http( array(
			'example.com/icon' => $this->http_response( '<html>oops</html>', 200, 'text/html' ),
			'example.com'      => $this->http_response( $html ),
		) );

		$this->assertNull( openstation_resolve_favicon( 'https://example.com/' ) );
	}

	public function test_rejects_oversize_body() {
		$html       = '<html><head><link rel="icon" href="/big.png"></head></html>';
		$big_bytes  = str_repeat( 'x', OPENSTATION_FAVICON_MAX_BYTES + 1 );
		$this->stub_http( array(
			'example.com/big.png' => $this->http_response( $big_bytes, 200, 'image/png' ),
			'example.com'         => $this->http_response( $html ),
		) );

		$this->assertNull( openstation_resolve_favicon( 'https://example.com/' ) );
	}

	public function test_rejects_html_spoofing_png_content_type() {
		$html       = '<html><head><link rel="icon" href="/spoofed.png"></head></html>';
		$fake_bytes = '<!DOCTYPE html><body>not actually a PNG</body>';
		$this->stub_http( array(
			'example.com/spoofed.png' => $this->http_response( $fake_bytes, 200, 'image/png' ),
			'example.com'             => $this->http_response( $html ),
		) );

		$this->assertNull( openstation_resolve_favicon( 'https://example.com/' ) );
	}

	public function test_returns_null_on_network_error() {
		add_filter(
			'pre_http_request',
			static function () {
				return new WP_Error( 'http_failure', 'Network down' );
			}
		);

		$this->assertNull( openstation_resolve_favicon( 'https://example.com/' ) );
	}

	public function test_returns_null_for_non_http_url() {
		$this->assertNull( openstation_resolve_favicon( 'ftp://example.com/' ) );
		$this->assertNull( openstation_resolve_favicon( 'javascript:alert(1)' ) );
		$this->assertNull( openstation_resolve_favicon( '' ) );
	}

	public function test_filter_can_override_with_synthetic_uri() {

		add_filter(
			'pre_http_request',
			static function () {
				return new WP_Error( 'http_failure', 'Network down' );
			}
		);
		add_filter(
			'openstation_resolve_favicon',
			static function () {
				return 'data:image/png;base64,SYNTHETIC';
			}
		);

		$this->assertSame(
			'data:image/png;base64,SYNTHETIC',
			openstation_resolve_favicon( 'https://example.com/' )
		);
	}

	public function test_filter_can_force_null() {

		$html = '<html><head><link rel="icon" href="/icon.png"></head></html>';
		$this->stub_http( array(
			'example.com/icon.png' => $this->http_response( self::PNG_BYTES, 200, 'image/png' ),
			'example.com'          => $this->http_response( $html ),
		) );
		add_filter( 'openstation_resolve_favicon', '__return_null' );

		$this->assertNull( openstation_resolve_favicon( 'https://example.com/' ) );
	}

	public function test_fetches_send_limit_response_size() {
		$html     = '<html><head><link rel="icon" href="/icon.png"></head></html>';
		$captured = array();
		$icon     = $this->http_response( self::PNG_BYTES, 200, 'image/png' );
		$page     = $this->http_response( $html );
		add_filter(
			'pre_http_request',
			static function ( $preempt, $args, $url ) use ( &$captured, $icon, $page ) {
				$captured[ $url ] = $args;
				return false !== strpos( $url, '/icon.png' ) ? $icon : $page;
			},
			10,
			3
		);

		$result = openstation_resolve_favicon( 'https://example.com/page' );
		$this->assertSame( $this->expected_png_data_uri(), $result );

		$this->assertArrayHasKey( 'https://example.com/page', $captured );
		$this->assertSame(
			OPENSTATION_FAVICON_MAX_PAGE_BYTES,
			$captured['https://example.com/page']['limit_response_size'],
			'Page fetch must cap the download at the page-HTML limit.'
		);

		$this->assertArrayHasKey( 'https://example.com/icon.png', $captured );
		$this->assertSame(
			OPENSTATION_FAVICON_MAX_BYTES + 1,
			$captured['https://example.com/icon.png']['limit_response_size'],
			'Icon fetch must cap the download one byte over the icon limit so the post-fetch size check still rejects truncated over-cap bodies.'
		);
	}

}
