<?php

class Tests_OpenStation_NativeWindowStyle extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );

		wp_styles()->registered = array();
	}

	private function register_demo_style( $handle = 'jorvy-style', $src = 'https://example.test/jorvy.css' ) {
		wp_register_style( $handle, $src, array(), '1.0.0' );
	}

	private function register_demo_window( $args = array() ) {
		$defaults = array(
			'title'    => 'Demo',
			'script'   => 'demo-script',
			'template' => static function () {
				echo '<p>demo</p>';
			},
		);
		$args = array_merge( $defaults, $args );
		$this->assertTrue( openstation_register_window( 'demo-style', $args ) );
	}

	public function test_resolve_style_payload_unregistered_handle_returns_empty() {
		$payload = openstation_resolve_style_payload( 'never-registered' );
		$this->assertSame( '', $payload['url'] );
		$this->assertSame( array(), $payload['inline'] );
	}

	public function test_resolve_style_payload_returns_url_with_version() {
		$this->register_demo_style();
		$payload = openstation_resolve_style_payload( 'jorvy-style' );

		$this->assertNotSame( '', $payload['url'] );
		$this->assertStringContainsString( 'jorvy.css', $payload['url'] );
		$this->assertStringContainsString( 'ver=1.0.0', $payload['url'] );
	}

	public function test_resolve_style_payload_harvests_inline_style() {
		$this->register_demo_style();
		wp_add_inline_style( 'jorvy-style', '.jorvy { color: red; }' );

		$payload = openstation_resolve_style_payload( 'jorvy-style' );

		$this->assertCount( 1, $payload['inline'] );
		$this->assertSame( '.jorvy { color: red; }', $payload['inline'][0] );
	}

	public function test_resolve_style_payload_relative_src_is_prefixed_with_site_url() {
		wp_register_style( 'rel-style', '/wp-content/plugins/foo/foo.css', array(), '2' );
		$payload = openstation_resolve_style_payload( 'rel-style' );

		$this->assertStringStartsWith( site_url(), $payload['url'] );
	}

	public function test_payload_includes_style_fields_when_handle_registered() {
		$this->register_demo_style();
		wp_add_inline_style( 'jorvy-style', '.jorvy { color: red; }' );
		$this->register_demo_window( array( 'style' => 'jorvy-style' ) );

		$payload = openstation_build_native_windows_payload();
		$entry   = null;
		foreach ( $payload as $row ) {
			if ( 'demo-style' === $row['id'] ) {
				$entry = $row;
				break;
			}
		}
		$this->assertNotNull( $entry );
		$this->assertSame( 'jorvy-style', $entry['styleHandle'] );
		$this->assertNotSame( '', $entry['styleUrl'] );
		$this->assertSame( array( '.jorvy { color: red; }' ), $entry['styleInline'] );
	}

	public function test_payload_style_fields_default_to_empty_when_arg_omitted() {
		$this->register_demo_window();

		$payload = openstation_build_native_windows_payload();
		$entry   = null;
		foreach ( $payload as $row ) {
			if ( 'demo-style' === $row['id'] ) {
				$entry = $row;
				break;
			}
		}
		$this->assertNotNull( $entry );
		$this->assertSame( '', $entry['styleHandle'] );
		$this->assertSame( '', $entry['styleUrl'] );
		$this->assertSame( array(), $entry['styleInline'] );
	}

	public function test_payload_unregistered_style_handle_drops_silently() {
		$this->register_demo_window( array( 'style' => 'never-registered' ) );

		$payload = openstation_build_native_windows_payload();
		$entry   = null;
		foreach ( $payload as $row ) {
			if ( 'demo-style' === $row['id'] ) {
				$entry = $row;
				break;
			}
		}
		$this->assertNotNull( $entry );
		$this->assertSame( 'never-registered', $entry['styleHandle'] );
		$this->assertSame( '', $entry['styleUrl'] );
	}
}
