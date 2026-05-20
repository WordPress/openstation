<?php
/**
 * Tests for the Heartbeat-driven nonce-refresh handler
 * (`includes/nonce-refresh.php`). Regression target is GH#250 —
 * the Plugins window's stale cached nonce surfacing as "Cookie
 * check failed" once the shell tab passed the 24-hour
 * `nonce_life` boundary.
 *
 * @group desktop-mode
 * @group desktop-mode-nonce-refresh
 */
class Tests_DesktopMode_NonceRefresh extends WP_UnitTestCase {

	protected static $user_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$user_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function tear_down() {
		wp_set_current_user( 0 );
		parent::tear_down();
	}

	/**
	 * @covers ::desktop_mode_nonce_refresh_heartbeat_received
	 */
	public function test_skips_anonymous_users() {
		wp_set_current_user( 0 );

		$response = desktop_mode_nonce_refresh_heartbeat_received( array(), array() );

		$this->assertArrayNotHasKey(
			DESKTOP_MODE_NONCE_REFRESH_FIELD,
			$response,
			'Logged-out users must not receive a refreshed nonce payload.'
		);
	}

	/**
	 * @covers ::desktop_mode_nonce_refresh_heartbeat_received
	 */
	public function test_logged_in_user_receives_fresh_nonces_for_default_actions() {
		wp_set_current_user( self::$user_id );

		$response = desktop_mode_nonce_refresh_heartbeat_received( array(), array() );

		$this->assertArrayHasKey( DESKTOP_MODE_NONCE_REFRESH_FIELD, $response );
		$nonces = $response[ DESKTOP_MODE_NONCE_REFRESH_FIELD ];

		// Default action set — the ones the Plugins window relies on.
		$this->assertArrayHasKey( 'wp_rest', $nonces );
		$this->assertArrayHasKey( 'desktop-mode-plugins', $nonces );
		$this->assertArrayHasKey( 'updates', $nonces );

		// Each value must validate against the action it's keyed by —
		// catches accidental mis-keying of the payload.
		$this->assertSame( 1, wp_verify_nonce( $nonces['wp_rest'], 'wp_rest' ) );
		$this->assertSame(
			1,
			wp_verify_nonce( $nonces['desktop-mode-plugins'], 'desktop-mode-plugins' )
		);
		$this->assertSame( 1, wp_verify_nonce( $nonces['updates'], 'updates' ) );
	}

	/**
	 * @covers ::desktop_mode_nonce_refresh_heartbeat_received
	 */
	public function test_preserves_pre_existing_response_keys() {
		wp_set_current_user( self::$user_id );

		$response = desktop_mode_nonce_refresh_heartbeat_received(
			array( 'some_other_feature' => 'untouched' ),
			array()
		);

		$this->assertSame( 'untouched', $response['some_other_feature'] );
		$this->assertArrayHasKey( DESKTOP_MODE_NONCE_REFRESH_FIELD, $response );
	}

	/**
	 * @covers ::desktop_mode_nonce_refresh_build_payload
	 */
	public function test_filter_can_add_custom_actions() {
		wp_set_current_user( self::$user_id );

		$callback = function ( $actions ) {
			$actions[] = 'my-plugin/custom';
			return $actions;
		};
		add_filter( 'desktop_mode_nonce_refresh_actions', $callback );

		$payload = desktop_mode_nonce_refresh_build_payload();

		remove_filter( 'desktop_mode_nonce_refresh_actions', $callback );

		$this->assertArrayHasKey( 'my-plugin/custom', $payload );
		$this->assertSame(
			1,
			wp_verify_nonce( $payload['my-plugin/custom'], 'my-plugin/custom' )
		);
	}

	/**
	 * @covers ::desktop_mode_nonce_refresh_build_payload
	 */
	public function test_filter_can_remove_default_actions() {
		wp_set_current_user( self::$user_id );

		$callback = function () {
			return array( 'wp_rest' );
		};
		add_filter( 'desktop_mode_nonce_refresh_actions', $callback );

		$payload = desktop_mode_nonce_refresh_build_payload();

		remove_filter( 'desktop_mode_nonce_refresh_actions', $callback );

		$this->assertSame( array( 'wp_rest' ), array_keys( $payload ) );
	}

	/**
	 * @covers ::desktop_mode_nonce_refresh_build_payload
	 */
	public function test_filter_skips_non_string_and_empty_entries() {
		wp_set_current_user( self::$user_id );

		$callback = function () {
			return array( 'wp_rest', '', 0, null, false, 'updates' );
		};
		add_filter( 'desktop_mode_nonce_refresh_actions', $callback );

		$payload = desktop_mode_nonce_refresh_build_payload();

		remove_filter( 'desktop_mode_nonce_refresh_actions', $callback );

		$this->assertSame(
			array( 'wp_rest', 'updates' ),
			array_keys( $payload ),
			'Non-string / empty action entries must be discarded.'
		);
	}

	/**
	 * Wired correctly into the `heartbeat_received` filter chain
	 * so a tick from a logged-in user really does ship the nonces.
	 */
	public function test_filter_is_registered_on_heartbeat_received() {
		$this->assertNotFalse(
			has_filter(
				'heartbeat_received',
				'desktop_mode_nonce_refresh_heartbeat_received'
			),
			'desktop_mode_nonce_refresh_heartbeat_received should hook heartbeat_received.'
		);
	}
}
