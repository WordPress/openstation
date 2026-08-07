<?php
/**
 * Tests for the optional `style` arg on `openstation_register_window()`
 * and its companion resolver `openstation_resolve_style_payload()`.
 *
 * Closes the live-refresh CSS gap: when a peer plugin is activated
 * mid-session, the parent shell already finished `wp_print_styles`,
 * so the plugin's stylesheet is missing on the page until F5. The
 * `style` arg + payload `styleUrl` lets the shell lazy-inject a
 * `<link rel="stylesheet">` from the chromeless `plugins.php` bridge.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-native-window-style
 */
class Tests_OpenStation_NativeWindowStyle extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );

		// Each test starts with a clean style registry — wp_styles()
		// is process-global and prior tests can leak handles in.
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

	// --------------------------------------------------------------
	// openstation_resolve_style_payload
	// --------------------------------------------------------------

	/**
	 * @covers ::openstation_resolve_style_payload
	 */
	public function test_resolve_style_payload_unregistered_handle_returns_empty() {
		$payload = openstation_resolve_style_payload( 'never-registered' );
		$this->assertSame( '', $payload['url'] );
		$this->assertSame( array(), $payload['inline'] );
	}

	/**
	 * @covers ::openstation_resolve_style_payload
	 */
	public function test_resolve_style_payload_returns_url_with_version() {
		$this->register_demo_style();
		$payload = openstation_resolve_style_payload( 'jorvy-style' );

		$this->assertNotSame( '', $payload['url'] );
		$this->assertStringContainsString( 'jorvy.css', $payload['url'] );
		$this->assertStringContainsString( 'ver=1.0.0', $payload['url'] );
	}

	/**
	 * @covers ::openstation_resolve_style_payload
	 */
	public function test_resolve_style_payload_harvests_inline_style() {
		$this->register_demo_style();
		wp_add_inline_style( 'jorvy-style', '.jorvy { color: red; }' );

		$payload = openstation_resolve_style_payload( 'jorvy-style' );

		$this->assertCount( 1, $payload['inline'] );
		$this->assertSame( '.jorvy { color: red; }', $payload['inline'][0] );
	}

	/**
	 * @covers ::openstation_resolve_style_payload
	 */
	public function test_resolve_style_payload_relative_src_is_prefixed_with_site_url() {
		wp_register_style( 'rel-style', '/wp-content/plugins/foo/foo.css', array(), '2' );
		$payload = openstation_resolve_style_payload( 'rel-style' );

		$this->assertStringStartsWith( site_url(), $payload['url'] );
	}

	// --------------------------------------------------------------
	// Payload integration
	// --------------------------------------------------------------

	/**
	 * The native-windows payload picks up `styleUrl` /
	 * `styleHandle` / `styleInline` when the registration declares a
	 * `style` arg whose handle is registered with `wp_register_style`.
	 *
	 * @covers ::openstation_build_native_windows_payload
	 */
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

	/**
	 * Backwards compatibility: omitting `style` keeps the entry's
	 * style fields empty — never a `WP_Error`, never a missing key.
	 *
	 * @covers ::openstation_build_native_windows_payload
	 */
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

	/**
	 * Declaring a `style` handle that was never registered with
	 * `wp_register_style()` is silently dropped — same shape as the
	 * script side. Plugin authors get a rendered window with no CSS
	 * (their own bug to fix), not a fatal.
	 *
	 * @covers ::openstation_build_native_windows_payload
	 */
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
