<?php
/**
 * Tests for the window-notice registry — declarative top-of-window
 * banners shipped from PHP and rendered as `<os-notice>` inside the
 * `after-titlebar` slot. Coverage:
 *
 *   - storage + validation of `open_station_register_window_notice()`
 *   - payload shape + ordering of
 *     `open_station_build_window_notices_payload()`
 *   - the `open_station_window_notices` request-time filter
 *   - that the notices land in the menu payload under
 *     `serverWindowNotices`
 *
 * Module-level state is flushed in `set_up` so cross-test pollution
 * stays bounded.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-window-notices
 */
class Tests_OpenStation_WindowNotices extends WP_UnitTestCase {

	public function set_up() {
		parent::set_up();
		open_station_flush_window_notice_registry();
	}

	/**
	 * @covers ::open_station_register_window_notice
	 */
	public function test_register_stores_entry() {
		$result = open_station_register_window_notice(
			array(
				'id'      => 'plugin/welcome',
				'message' => 'Hello',
			)
		);
		$this->assertTrue( $result );

		$registry = open_station_window_notice_registry();
		$this->assertArrayHasKey( 'plugin/welcome', $registry );
		$this->assertSame( 'Hello', $registry['plugin/welcome']['message'] );
		$this->assertSame( 'info', $registry['plugin/welcome']['tone'] );
		$this->assertTrue( $registry['plugin/welcome']['dismissible'] );
	}

	/**
	 * @covers ::open_station_register_window_notice
	 */
	public function test_register_rejects_empty_id() {
		$result = open_station_register_window_notice(
			array(
				'id'      => '',
				'message' => 'Hello',
			)
		);
		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'open_station_missing_id', $result->get_error_code() );
	}

	/**
	 * @covers ::open_station_register_window_notice
	 */
	public function test_register_rejects_empty_message() {
		$result = open_station_register_window_notice(
			array(
				'id'      => 'plugin/blank',
				'message' => '',
			)
		);
		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'open_station_missing_message', $result->get_error_code() );
	}

	/**
	 * @covers ::open_station_register_window_notice
	 */
	public function test_register_rejects_invalid_tone() {
		$result = open_station_register_window_notice(
			array(
				'id'      => 'plugin/bad-tone',
				'message' => 'Hello',
				'tone'    => 'flashy',
			)
		);
		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'open_station_invalid_tone', $result->get_error_code() );
	}

	/**
	 * @covers ::open_station_register_window_notice
	 */
	public function test_register_rejects_invalid_id_chars() {
		$result = open_station_register_window_notice(
			array(
				'id'      => 'plugin/Bad Id!',
				'message' => 'Hello',
			)
		);
		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'open_station_invalid_id', $result->get_error_code() );
	}

	/**
	 * @covers ::open_station_register_window_notice
	 */
	public function test_message_passes_through_wp_kses_post() {
		open_station_register_window_notice(
			array(
				'id'      => 'plugin/safe',
				'message' => 'Hi <a href="https://example.com">link</a><script>alert(1)</script>',
			)
		);
		$entry = open_station_window_notice_registry( 'plugin/safe' );
		$this->assertStringContainsString( '<a href="https://example.com">link</a>', $entry['message'] );
		$this->assertStringNotContainsString( '<script>', $entry['message'] );
	}

	/**
	 * @covers ::open_station_build_window_notices_payload
	 */
	public function test_payload_returns_entries_in_order() {
		open_station_register_window_notice(
			array(
				'id'      => 'plugin/b',
				'message' => 'B',
				'order'   => 200,
			)
		);
		open_station_register_window_notice(
			array(
				'id'      => 'plugin/a',
				'message' => 'A',
				'order'   => 50,
			)
		);
		open_station_register_window_notice(
			array(
				'id'      => 'plugin/c',
				'message' => 'C',
				'order'   => 100,
			)
		);

		$payload = open_station_build_window_notices_payload();
		$this->assertCount( 3, $payload );
		$this->assertSame( 'plugin/a', $payload[0]['id'] );
		$this->assertSame( 'plugin/c', $payload[1]['id'] );
		$this->assertSame( 'plugin/b', $payload[2]['id'] );
	}

	/**
	 * @covers ::open_station_build_window_notices_payload
	 */
	public function test_filter_can_append_request_time_notices() {
		open_station_register_window_notice(
			array(
				'id'      => 'plugin/static',
				'message' => 'Static',
			)
		);
		add_filter(
			'open_station_window_notices',
			static function ( $entries ) {
				$entries[] = array(
					'id'      => 'plugin/dynamic',
					'message' => 'Dynamic',
					'tone'    => 'warning',
					'order'   => 10,
				);
				return $entries;
			}
		);
		$payload = open_station_build_window_notices_payload();
		$this->assertSame( 'plugin/dynamic', $payload[0]['id'] );
		$this->assertSame( 'plugin/static', $payload[1]['id'] );

		remove_all_filters( 'open_station_window_notices' );
	}

	/**
	 * @covers ::open_station_register_window_notice
	 */
	public function test_register_fires_action() {
		$captured = null;
		add_action(
			'open_station_window_notice_registered',
			static function ( $id, $entry ) use ( &$captured ) {
				$captured = array(
					'id'    => $id,
					'entry' => $entry,
				);
			},
			10,
			2
		);
		open_station_register_window_notice(
			array(
				'id'      => 'plugin/action-test',
				'message' => 'Hi',
			)
		);
		$this->assertNotNull( $captured );
		$this->assertSame( 'plugin/action-test', $captured['id'] );
		$this->assertSame( 'Hi', $captured['entry']['message'] );

		remove_all_actions( 'open_station_window_notice_registered' );
	}

	/**
	 * @covers ::open_station_build_menu_payload
	 */
	public function test_menu_payload_includes_server_window_notices() {
		open_station_register_window_notice(
			array(
				'id'      => 'plugin/menu-payload',
				'message' => 'Menu',
			)
		);
		$payload = open_station_build_menu_payload();
		$this->assertArrayHasKey( 'serverWindowNotices', $payload );
		$ids = array_column( $payload['serverWindowNotices'], 'id' );
		$this->assertContains( 'plugin/menu-payload', $ids );
	}

	/**
	 * @covers ::open_station_build_window_notices_payload
	 */
	public function test_payload_round_trips_match_icon_and_order() {
		open_station_register_window_notice(
			array(
				'id'      => 'plugin/round-trip',
				'message' => 'Round trip',
				'icon'    => 'dashicons-info',
				'order'   => 42,
				'match'   => array(
					'windows'     => array( 'edit-php', 'edit-php-page' ),
					'urlContains' => 'wc-admin',
				),
			)
		);
		$payload = open_station_build_window_notices_payload();
		$entry   = null;
		foreach ( $payload as $candidate ) {
			if ( 'plugin/round-trip' === $candidate['id'] ) {
				$entry = $candidate;
				break;
			}
		}
		$this->assertNotNull( $entry, 'expected entry in payload' );
		$this->assertSame( 'dashicons-info', $entry['icon'] );
		$this->assertSame( 42, $entry['order'] );
		$this->assertIsArray( $entry['match'] );
		$this->assertSame(
			array( 'edit-php', 'edit-php-page' ),
			$entry['match']['windows']
		);
		$this->assertSame( 'wc-admin', $entry['match']['urlContains'] );
	}

	/**
	 * @covers ::open_station_register_window_notice
	 */
	public function test_icon_must_match_dashicons_pattern() {
		open_station_register_window_notice(
			array(
				'id'      => 'plugin/icon-valid',
				'message' => 'Valid icon',
				'icon'    => 'dashicons-info',
			)
		);
		$entry = open_station_window_notice_registry( 'plugin/icon-valid' );
		$this->assertSame( 'dashicons-info', $entry['icon'] );
	}

	/**
	 * @covers ::open_station_register_window_notice
	 */
	public function test_icon_drops_garbage_silently() {
		open_station_register_window_notice(
			array(
				'id'      => 'plugin/icon-junk',
				'message' => 'Junk icon',
				'icon'    => 'evil class injection',
			)
		);
		$entry = open_station_window_notice_registry( 'plugin/icon-junk' );
		$this->assertSame( '', $entry['icon'] );
	}

	/**
	 * @covers ::open_station_register_window_notice
	 */
	public function test_icon_drops_non_dashicons_prefix() {
		open_station_register_window_notice(
			array(
				'id'      => 'plugin/icon-no-prefix',
				'message' => 'Other class',
				'icon'    => 'fa-info',
			)
		);
		$entry = open_station_window_notice_registry( 'plugin/icon-no-prefix' );
		$this->assertSame( '', $entry['icon'] );
	}
}
