<?php
/**
 * Tests for the window-notice registry — declarative top-of-window
 * banners shipped from PHP and rendered as `<wpd-notice>` inside the
 * `after-titlebar` slot. Coverage:
 *
 *   - storage + validation of `desktop_mode_register_window_notice()`
 *   - payload shape + ordering of
 *     `desktop_mode_build_window_notices_payload()`
 *   - the `desktop_mode_window_notices` request-time filter
 *   - that the notices land in the menu payload under
 *     `serverWindowNotices`
 *
 * Module-level state is flushed in `set_up` so cross-test pollution
 * stays bounded.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-window-notices
 */
class Tests_DesktopMode_WindowNotices extends WP_UnitTestCase {

	public function set_up() {
		parent::set_up();
		desktop_mode_flush_window_notice_registry();
	}

	/**
	 * @covers ::desktop_mode_register_window_notice
	 */
	public function test_register_stores_entry() {
		$result = desktop_mode_register_window_notice(
			array(
				'id'      => 'plugin/welcome',
				'message' => 'Hello',
			)
		);
		$this->assertTrue( $result );

		$registry = desktop_mode_window_notice_registry();
		$this->assertArrayHasKey( 'plugin/welcome', $registry );
		$this->assertSame( 'Hello', $registry['plugin/welcome']['message'] );
		$this->assertSame( 'info', $registry['plugin/welcome']['tone'] );
		$this->assertTrue( $registry['plugin/welcome']['dismissible'] );
	}

	/**
	 * @covers ::desktop_mode_register_window_notice
	 */
	public function test_register_rejects_empty_id() {
		$result = desktop_mode_register_window_notice(
			array(
				'id'      => '',
				'message' => 'Hello',
			)
		);
		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'desktop_mode_missing_id', $result->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_register_window_notice
	 */
	public function test_register_rejects_empty_message() {
		$result = desktop_mode_register_window_notice(
			array(
				'id'      => 'plugin/blank',
				'message' => '',
			)
		);
		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'desktop_mode_missing_message', $result->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_register_window_notice
	 */
	public function test_register_rejects_invalid_tone() {
		$result = desktop_mode_register_window_notice(
			array(
				'id'      => 'plugin/bad-tone',
				'message' => 'Hello',
				'tone'    => 'flashy',
			)
		);
		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'desktop_mode_invalid_tone', $result->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_register_window_notice
	 */
	public function test_register_rejects_invalid_id_chars() {
		$result = desktop_mode_register_window_notice(
			array(
				'id'      => 'plugin/Bad Id!',
				'message' => 'Hello',
			)
		);
		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'desktop_mode_invalid_id', $result->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_register_window_notice
	 */
	public function test_message_passes_through_wp_kses_post() {
		desktop_mode_register_window_notice(
			array(
				'id'      => 'plugin/safe',
				'message' => 'Hi <a href="https://example.com">link</a><script>alert(1)</script>',
			)
		);
		$entry = desktop_mode_window_notice_registry( 'plugin/safe' );
		$this->assertStringContainsString( '<a href="https://example.com">link</a>', $entry['message'] );
		$this->assertStringNotContainsString( '<script>', $entry['message'] );
	}

	/**
	 * @covers ::desktop_mode_build_window_notices_payload
	 */
	public function test_payload_returns_entries_in_order() {
		desktop_mode_register_window_notice(
			array(
				'id'      => 'plugin/b',
				'message' => 'B',
				'order'   => 200,
			)
		);
		desktop_mode_register_window_notice(
			array(
				'id'      => 'plugin/a',
				'message' => 'A',
				'order'   => 50,
			)
		);
		desktop_mode_register_window_notice(
			array(
				'id'      => 'plugin/c',
				'message' => 'C',
				'order'   => 100,
			)
		);

		$payload = desktop_mode_build_window_notices_payload();
		$this->assertCount( 3, $payload );
		$this->assertSame( 'plugin/a', $payload[0]['id'] );
		$this->assertSame( 'plugin/c', $payload[1]['id'] );
		$this->assertSame( 'plugin/b', $payload[2]['id'] );
	}

	/**
	 * @covers ::desktop_mode_build_window_notices_payload
	 */
	public function test_filter_can_append_request_time_notices() {
		desktop_mode_register_window_notice(
			array(
				'id'      => 'plugin/static',
				'message' => 'Static',
			)
		);
		add_filter(
			'desktop_mode_window_notices',
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
		$payload = desktop_mode_build_window_notices_payload();
		$this->assertSame( 'plugin/dynamic', $payload[0]['id'] );
		$this->assertSame( 'plugin/static', $payload[1]['id'] );

		remove_all_filters( 'desktop_mode_window_notices' );
	}

	/**
	 * @covers ::desktop_mode_register_window_notice
	 */
	public function test_register_fires_action() {
		$captured = null;
		add_action(
			'desktop_mode_window_notice_registered',
			static function ( $id, $entry ) use ( &$captured ) {
				$captured = array(
					'id'    => $id,
					'entry' => $entry,
				);
			},
			10,
			2
		);
		desktop_mode_register_window_notice(
			array(
				'id'      => 'plugin/action-test',
				'message' => 'Hi',
			)
		);
		$this->assertNotNull( $captured );
		$this->assertSame( 'plugin/action-test', $captured['id'] );
		$this->assertSame( 'Hi', $captured['entry']['message'] );

		remove_all_actions( 'desktop_mode_window_notice_registered' );
	}

	/**
	 * @covers ::desktop_mode_build_menu_payload
	 */
	public function test_menu_payload_includes_server_window_notices() {
		desktop_mode_register_window_notice(
			array(
				'id'      => 'plugin/menu-payload',
				'message' => 'Menu',
			)
		);
		$payload = desktop_mode_build_menu_payload();
		$this->assertArrayHasKey( 'serverWindowNotices', $payload );
		$ids = array_column( $payload['serverWindowNotices'], 'id' );
		$this->assertContains( 'plugin/menu-payload', $ids );
	}
}
