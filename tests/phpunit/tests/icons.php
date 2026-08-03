<?php
/**
 * Tests for `open_station_register_icon()` and the `open_station_icons`
 * filter that renders shortcut tiles on the wallpaper.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-icons
 */
class Tests_OpenStation_Icons extends WP_UnitTestCase {

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
		remove_all_actions( 'open_station_icon_registered' );
		remove_all_filters( 'open_station_icons' );
		parent::tear_down();
	}

	/**
	 * @covers ::open_station_register_icon
	 */
	public function test_success_with_window_target() {
		$result = open_station_register_icon( 'jorvy', array(
			'title'    => 'Jorvy',
			'icon'     => 'dashicons-star-filled',
			'window'   => 'jorvy',
			'position' => 10,
		) );

		$this->assertTrue( $result );

		$entry = open_station_desktop_icon_registry( 'jorvy' );
		$this->assertIsArray( $entry );
		$this->assertSame( 'jorvy', $entry['window'] );
		$this->assertSame( '', $entry['url'] );
		$this->assertSame( 10, $entry['position'] );
	}

	/**
	 * @covers ::open_station_register_icon
	 */
	public function test_success_with_url_target() {
		$url = admin_url( 'edit.php' );
		$result = open_station_register_icon( 'posts-shortcut', array(
			'title' => 'All Posts',
			'icon'  => 'dashicons-admin-post',
			'url'   => $url,
		) );

		$this->assertTrue( $result );
		$entry = open_station_desktop_icon_registry( 'posts-shortcut' );
		$this->assertSame( $url, $entry['url'] );
		$this->assertSame( '', $entry['window'] );
	}

	/**
	 * @covers ::open_station_register_icon
	 */
	public function test_both_window_and_url_returns_wp_error() {
		$result = open_station_register_icon( 'both', array(
			'title'  => 'Both',
			'window' => 'jorvy',
			'url'    => admin_url( 'edit.php' ),
		) );

		$this->assertWPError( $result );
		$this->assertSame( 'open_station_conflicting_target', $result->get_error_code() );
	}

	/**
	 * @covers ::open_station_register_icon
	 */
	public function test_neither_window_nor_url_returns_wp_error() {
		$result = open_station_register_icon( 'neither', array(
			'title' => 'Neither',
		) );

		$this->assertWPError( $result );
		$this->assertSame( 'open_station_missing_target', $result->get_error_code() );
	}

	/**
	 * @covers ::open_station_register_icon
	 */
	public function test_missing_title_returns_wp_error() {
		$result = open_station_register_icon( 'no-title', array(
			'window' => 'jorvy',
		) );

		$this->assertWPError( $result );
		$this->assertSame( 'open_station_missing_title', $result->get_error_code() );
	}

	/**
	 * @covers ::open_station_register_icon
	 */
	public function test_missing_id_returns_wp_error() {
		$result = open_station_register_icon( '', array(
			'title'  => 'X',
			'window' => 'jorvy',
		) );

		$this->assertWPError( $result );
		$this->assertSame( 'open_station_missing_id', $result->get_error_code() );
	}

	/**
	 * @covers ::open_station_register_icon
	 */
	public function test_invalid_url_returns_wp_error() {
		$result = open_station_register_icon( 'bad-url', array(
			'title' => 'Bad URL',
			'url'   => 'javascript:alert(1)',
		) );

		$this->assertWPError( $result );
		$this->assertSame( 'open_station_invalid_url', $result->get_error_code() );
	}

	/**
	 * Malformed SVG data URIs (here: the unsupported `;utf8,` shape
	 * with an `onload` payload) are rejected by the shared
	 * `open_station_sanitize_dock_icon` sanitizer and fall back to the
	 * generic dashicon. Well-formed `data:image/svg+xml;base64,…` and
	 * `data:image/svg+xml,<percent-encoded>` ARE accepted — see the
	 * sibling test below.
	 *
	 * @covers ::open_station_register_icon
	 */
	public function test_malformed_svg_data_uri_falls_back_to_generic() {
		$result = open_station_register_icon( 'svg-attempt', array(
			'title'  => 'SVG Attempt',
			'icon'   => 'data:image/svg+xml;utf8,<svg onload="alert(1)"/>',
			'window' => 'jorvy',
		) );

		$this->assertTrue( $result );
		$entry = open_station_desktop_icon_registry( 'svg-attempt' );
		$this->assertSame( 'dashicons-admin-generic', $entry['icon'] );
	}

	/**
	 * Well-formed SVG data URIs flow through unchanged so plugin-
	 * registered desktop icons get the plugin's branded SVG instead
	 * of the gear fallback — same policy as the dock/taskbar tiles.
	 *
	 * @covers ::open_station_register_icon
	 */
	public function test_well_formed_svg_data_uri_is_preserved() {
		$svg = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=';
		$result = open_station_register_icon( 'svg-ok', array(
			'title'  => 'SVG OK',
			'icon'   => $svg,
			'window' => 'jorvy',
		) );

		$this->assertTrue( $result );
		$entry = open_station_desktop_icon_registry( 'svg-ok' );
		$this->assertSame( $svg, $entry['icon'] );
	}

	/**
	 * `icon_svg` shorthand: raw SVG markup is base64-encoded into a
	 * `data:image/svg+xml;base64,…` URI and stored on `icon`.
	 *
	 * @covers ::open_station_register_icon
	 */
	public function test_icon_svg_shorthand_encodes_to_data_uri() {
		$svg    = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';
		$result = open_station_register_icon( 'svg-shorthand', array(
			'title'    => 'SVG Shorthand',
			'icon_svg' => $svg,
			'window'   => 'jorvy',
		) );

		$this->assertTrue( $result );
		$entry    = open_station_desktop_icon_registry( 'svg-shorthand' );
		$expected = 'data:image/svg+xml;base64,' . base64_encode( $svg );
		$this->assertSame( $expected, $entry['icon'] );
	}

	/**
	 * `icon_svg` wins over `icon` when both are passed.
	 *
	 * @covers ::open_station_register_icon
	 */
	public function test_icon_svg_wins_over_icon() {
		$svg    = '<svg xmlns="http://www.w3.org/2000/svg"/>';
		$result = open_station_register_icon( 'svg-wins', array(
			'title'    => 'SVG Wins',
			'icon'     => 'dashicons-star-filled',
			'icon_svg' => $svg,
			'window'   => 'jorvy',
		) );

		$this->assertTrue( $result );
		$entry = open_station_desktop_icon_registry( 'svg-wins' );
		$this->assertStringStartsWith( 'data:image/svg+xml;base64,', $entry['icon'] );
	}

	/**
	 * SVG markup containing a <script> tag is rejected outright —
	 * defence-in-depth on top of the browser's `<img src=…>` SVG sandbox.
	 *
	 * @covers ::open_station_register_icon
	 */
	public function test_icon_svg_rejects_embedded_script() {
		$result = open_station_register_icon( 'svg-script', array(
			'title'    => 'SVG with script',
			'icon_svg' => '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
			'window'   => 'jorvy',
		) );

		$this->assertWPError( $result );
		$this->assertSame( 'open_station_invalid_icon_svg', $result->get_error_code() );
	}

	/**
	 * SVG markup that doesn't start with `<svg>` is rejected.
	 *
	 * @covers ::open_station_register_icon
	 */
	public function test_icon_svg_rejects_non_svg_markup() {
		$result = open_station_register_icon( 'svg-bogus', array(
			'title'    => 'Not an SVG',
			'icon_svg' => '<div>oops</div>',
			'window'   => 'jorvy',
		) );

		$this->assertWPError( $result );
		$this->assertSame( 'open_station_invalid_icon_svg', $result->get_error_code() );
	}

	/**
	 * @covers ::open_station_register_icon
	 */
	public function test_capability_gate_denies_subscriber() {
		wp_set_current_user( self::$subscriber_id );

		$result = open_station_register_icon( 'gated', array(
			'title'        => 'Gated',
			'window'       => 'jorvy',
			'capabilities' => array( 'manage_options' ),
		) );

		$this->assertWPError( $result );
		$this->assertSame( 'open_station_capability_denied', $result->get_error_code() );
	}

	/**
	 * @covers ::open_station_register_icon
	 */
	public function test_registered_action_fires_on_success() {
		$calls = array();
		add_action( 'open_station_icon_registered', static function ( $id, $entry ) use ( &$calls ) {
			$calls[] = array( 'id' => $id, 'entry' => $entry );
		}, 10, 2 );

		open_station_register_icon( 'fire', array(
			'title'  => 'Fire',
			'window' => 'jorvy',
		) );

		$this->assertCount( 1, $calls );
		$this->assertSame( 'fire', $calls[0]['id'] );
	}

	/**
	 * @covers ::open_station_register_icon
	 */
	public function test_registered_action_does_not_fire_on_error() {
		$count = 0;
		add_action( 'open_station_icon_registered', static function () use ( &$count ) {
			$count++;
		} );

		open_station_register_icon( 'broken', array(
			// missing target — returns WP_Error
			'title' => 'Broken',
		) );

		$this->assertSame( 0, $count );
	}

	/**
	 * @covers ::open_station_build_desktop_icons_payload
	 */
	public function test_payload_sorts_by_position() {
		open_station_register_icon( 'second', array(
			'title'    => 'Second',
			'window'   => 'jorvy',
			'position' => 20,
		) );
		open_station_register_icon( 'first', array(
			'title'    => 'First',
			'window'   => 'jorvy',
			'position' => 10,
		) );

		$payload = open_station_build_desktop_icons_payload();

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
	 * Pinned icons render before any unpinned icon regardless of
	 * `position`. Verifies both the registry round-trip and the
	 * payload-builder sort order.
	 *
	 * @covers ::open_station_register_icon
	 * @covers ::open_station_build_desktop_icons_payload
	 */
	public function test_pinned_icon_sorts_before_unpinned() {
		open_station_register_icon( 'unpinned-low', array(
			'title'    => 'Unpinned Low',
			'window'   => 'jorvy',
			'position' => -50, // way below the pinned default
		) );
		open_station_register_icon( 'pinned-high', array(
			'title'    => 'Pinned High',
			'window'   => 'jorvy',
			'pinned'   => true,
			'position' => 999,
		) );

		// Round-trip the flag through the registry.
		$entry = open_station_desktop_icon_registry( 'pinned-high' );
		$this->assertTrue( $entry['pinned'] );

		// Default is unpinned.
		$entry = open_station_desktop_icon_registry( 'unpinned-low' );
		$this->assertFalse( $entry['pinned'] );

		// Payload puts pinned first regardless of position.
		$payload    = open_station_build_desktop_icons_payload();
		$pinned_idx = null;
		$unpinned_idx = null;
		foreach ( $payload as $idx => $row ) {
			if ( 'pinned-high' === $row['id'] ) {
				$pinned_idx = $idx;
			}
			if ( 'unpinned-low' === $row['id'] ) {
				$unpinned_idx = $idx;
			}
		}
		$this->assertNotNull( $pinned_idx );
		$this->assertNotNull( $unpinned_idx );
		$this->assertLessThan( $unpinned_idx, $pinned_idx );
	}

	/**
	 * @covers ::open_station_build_desktop_icons_payload
	 */
	public function test_filter_can_remove_icon() {
		open_station_register_icon( 'filtered-out', array(
			'title'  => 'Filtered Out',
			'window' => 'jorvy',
		) );

		add_filter( 'open_station_icons', static function ( $registry ) {
			unset( $registry['filtered-out'] );
			return $registry;
		} );

		$payload = open_station_build_desktop_icons_payload();
		$ids     = wp_list_pluck( $payload, 'id' );

		$this->assertNotContains( 'filtered-out', $ids );
	}
}
