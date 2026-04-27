<?php
/**
 * Tests for `wp_register_desktop_icon()` and the `wp_desktop_icons`
 * filter that renders shortcut tiles on the wallpaper.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-icons
 */
class Tests_DesktopMode_Icons extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $subscriber_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id      = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$subscriber_id = $factory->user->create( array( 'role' => 'subscriber' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
		// Reset the icon registry between tests. Static closure access
		// via the public API — pass an empty key with a `null` entry
		// does nothing; we rely on per-id overwrites instead. Fresh
		// tests use fresh ids so we don't need to fully clear.
	}

	public function tear_down() {
		remove_all_actions( 'wp_desktop_icon_registered' );
		remove_all_filters( 'wp_desktop_icons' );
		parent::tear_down();
	}

	/**
	 * @covers ::wp_register_desktop_icon
	 */
	public function test_success_with_window_target() {
		$result = wp_register_desktop_icon( 'jorvy', array(
			'title'    => 'Jorvy',
			'icon'     => 'dashicons-star-filled',
			'window'   => 'jorvy',
			'position' => 10,
		) );

		$this->assertTrue( $result );

		$entry = wpdm_desktop_icon_registry( 'jorvy' );
		$this->assertIsArray( $entry );
		$this->assertSame( 'jorvy', $entry['window'] );
		$this->assertSame( '', $entry['url'] );
		$this->assertSame( 10, $entry['position'] );
	}

	/**
	 * @covers ::wp_register_desktop_icon
	 */
	public function test_success_with_url_target() {
		$url = admin_url( 'edit.php' );
		$result = wp_register_desktop_icon( 'posts-shortcut', array(
			'title' => 'All Posts',
			'icon'  => 'dashicons-admin-post',
			'url'   => $url,
		) );

		$this->assertTrue( $result );
		$entry = wpdm_desktop_icon_registry( 'posts-shortcut' );
		$this->assertSame( $url, $entry['url'] );
		$this->assertSame( '', $entry['window'] );
	}

	/**
	 * @covers ::wp_register_desktop_icon
	 */
	public function test_both_window_and_url_returns_wp_error() {
		$result = wp_register_desktop_icon( 'both', array(
			'title'  => 'Both',
			'window' => 'jorvy',
			'url'    => admin_url( 'edit.php' ),
		) );

		$this->assertWPError( $result );
		$this->assertSame( 'wp_desktop_conflicting_target', $result->get_error_code() );
	}

	/**
	 * @covers ::wp_register_desktop_icon
	 */
	public function test_neither_window_nor_url_returns_wp_error() {
		$result = wp_register_desktop_icon( 'neither', array(
			'title' => 'Neither',
		) );

		$this->assertWPError( $result );
		$this->assertSame( 'wp_desktop_missing_target', $result->get_error_code() );
	}

	/**
	 * @covers ::wp_register_desktop_icon
	 */
	public function test_missing_title_returns_wp_error() {
		$result = wp_register_desktop_icon( 'no-title', array(
			'window' => 'jorvy',
		) );

		$this->assertWPError( $result );
		$this->assertSame( 'wp_desktop_missing_title', $result->get_error_code() );
	}

	/**
	 * @covers ::wp_register_desktop_icon
	 */
	public function test_missing_id_returns_wp_error() {
		$result = wp_register_desktop_icon( '', array(
			'title'  => 'X',
			'window' => 'jorvy',
		) );

		$this->assertWPError( $result );
		$this->assertSame( 'wp_desktop_missing_id', $result->get_error_code() );
	}

	/**
	 * @covers ::wp_register_desktop_icon
	 */
	public function test_invalid_url_returns_wp_error() {
		$result = wp_register_desktop_icon( 'bad-url', array(
			'title' => 'Bad URL',
			'url'   => 'javascript:alert(1)',
		) );

		$this->assertWPError( $result );
		$this->assertSame( 'wp_desktop_invalid_url', $result->get_error_code() );
	}

	/**
	 * Malformed SVG data URIs (here: the unsupported `;utf8,` shape
	 * with an `onload` payload) are rejected by the shared
	 * `wpdm_sanitize_dock_icon` sanitizer and fall back to the
	 * generic dashicon. Well-formed `data:image/svg+xml;base64,…` and
	 * `data:image/svg+xml,<percent-encoded>` ARE accepted — see the
	 * sibling test below.
	 *
	 * @covers ::wp_register_desktop_icon
	 */
	public function test_malformed_svg_data_uri_falls_back_to_generic() {
		$result = wp_register_desktop_icon( 'svg-attempt', array(
			'title'  => 'SVG Attempt',
			'icon'   => 'data:image/svg+xml;utf8,<svg onload="alert(1)"/>',
			'window' => 'jorvy',
		) );

		$this->assertTrue( $result );
		$entry = wpdm_desktop_icon_registry( 'svg-attempt' );
		$this->assertSame( 'dashicons-admin-generic', $entry['icon'] );
	}

	/**
	 * Well-formed SVG data URIs flow through unchanged so plugin-
	 * registered desktop icons get the plugin's branded SVG instead
	 * of the gear fallback — same policy as the dock/taskbar tiles.
	 *
	 * @covers ::wp_register_desktop_icon
	 */
	public function test_well_formed_svg_data_uri_is_preserved() {
		$svg = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=';
		$result = wp_register_desktop_icon( 'svg-ok', array(
			'title'  => 'SVG OK',
			'icon'   => $svg,
			'window' => 'jorvy',
		) );

		$this->assertTrue( $result );
		$entry = wpdm_desktop_icon_registry( 'svg-ok' );
		$this->assertSame( $svg, $entry['icon'] );
	}

	/**
	 * @covers ::wp_register_desktop_icon
	 */
	public function test_capability_gate_denies_subscriber() {
		wp_set_current_user( self::$subscriber_id );

		$result = wp_register_desktop_icon( 'gated', array(
			'title'        => 'Gated',
			'window'       => 'jorvy',
			'capabilities' => array( 'manage_options' ),
		) );

		$this->assertWPError( $result );
		$this->assertSame( 'wp_desktop_capability_denied', $result->get_error_code() );
	}

	/**
	 * @covers ::wp_register_desktop_icon
	 */
	public function test_registered_action_fires_on_success() {
		$calls = array();
		add_action( 'wp_desktop_icon_registered', static function ( $id, $entry ) use ( &$calls ) {
			$calls[] = array( 'id' => $id, 'entry' => $entry );
		}, 10, 2 );

		wp_register_desktop_icon( 'fire', array(
			'title'  => 'Fire',
			'window' => 'jorvy',
		) );

		$this->assertCount( 1, $calls );
		$this->assertSame( 'fire', $calls[0]['id'] );
	}

	/**
	 * @covers ::wp_register_desktop_icon
	 */
	public function test_registered_action_does_not_fire_on_error() {
		$count = 0;
		add_action( 'wp_desktop_icon_registered', static function () use ( &$count ) {
			$count++;
		} );

		wp_register_desktop_icon( 'broken', array(
			// missing target — returns WP_Error
			'title' => 'Broken',
		) );

		$this->assertSame( 0, $count );
	}

	/**
	 * @covers ::wpdm_build_desktop_icons_payload
	 */
	public function test_payload_sorts_by_position() {
		wp_register_desktop_icon( 'second', array(
			'title'    => 'Second',
			'window'   => 'jorvy',
			'position' => 20,
		) );
		wp_register_desktop_icon( 'first', array(
			'title'    => 'First',
			'window'   => 'jorvy',
			'position' => 10,
		) );

		$payload = wpdm_build_desktop_icons_payload();

		$found_first  = null;
		$found_second = null;
		foreach ( $payload as $idx => $entry ) {
			if ( 'first' === $entry['id'] ) {
				$found_first = $idx;
			}
			if ( 'second' === $entry['id'] ) {
				$found_second = $idx;
			}
		}
		$this->assertNotNull( $found_first );
		$this->assertNotNull( $found_second );
		$this->assertLessThan( $found_second, $found_first );
	}

	/**
	 * @covers ::wpdm_build_desktop_icons_payload
	 */
	public function test_filter_can_remove_icon() {
		wp_register_desktop_icon( 'filtered-out', array(
			'title'  => 'Filtered Out',
			'window' => 'jorvy',
		) );

		add_filter( 'wp_desktop_icons', static function ( $registry ) {
			unset( $registry['filtered-out'] );
			return $registry;
		} );

		$payload = wpdm_build_desktop_icons_payload();
		$ids     = wp_list_pluck( $payload, 'id' );

		$this->assertNotContains( 'filtered-out', $ids );
	}
}
