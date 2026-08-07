<?php
/**
 * Tests for the Heartbeat-driven nonce-refresh handler
 * (`includes/nonce-refresh.php`). Regression target is GH#250 —
 * the Plugins window's stale cached nonce surfacing as "Cookie
 * check failed" once the shell tab passed the 24-hour
 * `nonce_life` boundary.
 *
 * @group openstation
 * @group os-nonce-refresh
 */
class Tests_OpenStation_NonceRefresh extends WP_UnitTestCase {

	protected static $user_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$user_id = $factory->user->create( array( 'role' => 'administrator' ) );
		// Opt this user into OpenStation so the heartbeat gate
		// (`openstation_is_enabled()`) lets the payload through.
		update_user_meta( self::$user_id, 'desktop_mode_mode', '1' );
	}

	public function tear_down() {
		wp_set_current_user( 0 );
		parent::tear_down();
	}

	/**
	 * @covers ::openstation_nonce_refresh_heartbeat_received
	 */
	public function test_skips_anonymous_users() {
		wp_set_current_user( 0 );

		$response = openstation_nonce_refresh_heartbeat_received( array(), array() );

		$this->assertArrayNotHasKey(
			OPENSTATION_NONCE_REFRESH_FIELD,
			$response,
			'Logged-out users must not receive a refreshed nonce payload.'
		);
	}

	/**
	 * @covers ::openstation_nonce_refresh_heartbeat_received
	 */
	public function test_skips_users_without_openstation_enabled() {
		$opted_out = self::factory()->user->create( array( 'role' => 'administrator' ) );
		// No desktop_mode_mode meta -> is_enabled() returns false.
		wp_set_current_user( $opted_out );

		$response = openstation_nonce_refresh_heartbeat_received( array(), array() );

		$this->assertArrayNotHasKey(
			OPENSTATION_NONCE_REFRESH_FIELD,
			$response,
			'Users who have not opted into OpenStation must not receive the payload.'
		);
	}

	/**
	 * @covers ::openstation_nonce_refresh_heartbeat_received
	 */
	public function test_logged_in_user_receives_fresh_nonces_for_default_actions() {
		wp_set_current_user( self::$user_id );

		$response = openstation_nonce_refresh_heartbeat_received( array(), array() );

		$this->assertArrayHasKey( OPENSTATION_NONCE_REFRESH_FIELD, $response );
		$nonces = $response[ OPENSTATION_NONCE_REFRESH_FIELD ];

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
	 * @covers ::openstation_nonce_refresh_heartbeat_received
	 */
	public function test_preserves_pre_existing_response_keys() {
		wp_set_current_user( self::$user_id );

		$response = openstation_nonce_refresh_heartbeat_received(
			array( 'some_other_feature' => 'untouched' ),
			array()
		);

		$this->assertSame( 'untouched', $response['some_other_feature'] );
		$this->assertArrayHasKey( OPENSTATION_NONCE_REFRESH_FIELD, $response );
	}

	/**
	 * @covers ::openstation_nonce_refresh_build_payload
	 */
	public function test_filter_can_add_custom_actions() {
		wp_set_current_user( self::$user_id );

		$callback = function ( $actions ) {
			$actions[] = 'my-plugin/custom';
			return $actions;
		};
		add_filter( 'openstation_nonce_refresh_actions', $callback );

		$payload = openstation_nonce_refresh_build_payload();

		remove_filter( 'openstation_nonce_refresh_actions', $callback );

		$this->assertArrayHasKey( 'my-plugin/custom', $payload );
		$this->assertSame(
			1,
			wp_verify_nonce( $payload['my-plugin/custom'], 'my-plugin/custom' )
		);
	}

	/**
	 * @covers ::openstation_nonce_refresh_build_payload
	 */
	public function test_filter_can_remove_default_actions() {
		wp_set_current_user( self::$user_id );

		$callback = function () {
			return array( 'wp_rest' );
		};
		add_filter( 'openstation_nonce_refresh_actions', $callback );

		$payload = openstation_nonce_refresh_build_payload();

		remove_filter( 'openstation_nonce_refresh_actions', $callback );

		$this->assertSame( array( 'wp_rest' ), array_keys( $payload ) );
	}

	/**
	 * @covers ::openstation_nonce_refresh_build_payload
	 */
	public function test_filter_skips_non_string_and_empty_entries() {
		wp_set_current_user( self::$user_id );

		$callback = function () {
			return array( 'wp_rest', '', 0, null, false, 'updates' );
		};
		add_filter( 'openstation_nonce_refresh_actions', $callback );

		$payload = openstation_nonce_refresh_build_payload();

		remove_filter( 'openstation_nonce_refresh_actions', $callback );

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
				'openstation_nonce_refresh_heartbeat_received'
			),
			'openstation_nonce_refresh_heartbeat_received should hook heartbeat_received.'
		);
	}

	/**
	 * The functional tick also carries the viewer id so the shell's
	 * auth recovery can detect a user switch (DESKMOD-49).
	 *
	 * @covers ::openstation_nonce_refresh_heartbeat_received
	 */
	public function test_tick_carries_current_user_id() {
		wp_set_current_user( self::$user_id );

		$response = openstation_nonce_refresh_heartbeat_received( array(), array() );

		$this->assertArrayHasKey( OPENSTATION_AUTH_FIELD, $response );
		$this->assertSame(
			self::$user_id,
			$response[ OPENSTATION_AUTH_FIELD ]['uid']
		);
	}

	/**
	 * Core short-circuits the tick through `wp_refresh_nonces` when
	 * the heartbeat nonce is stale (first tick after a re-login, or
	 * plain 24-hour expiry) — `heartbeat_received` never runs on
	 * that path. The payload must ride the short-circuit response
	 * too, so one round-trip heals the shell (DESKMOD-49).
	 *
	 * @covers ::openstation_nonce_refresh_on_expired
	 */
	public function test_expired_path_carries_payload_and_uid() {
		wp_set_current_user( self::$user_id );

		$response = openstation_nonce_refresh_on_expired( array() );

		$this->assertArrayHasKey( OPENSTATION_NONCE_REFRESH_FIELD, $response );
		$this->assertSame(
			1,
			wp_verify_nonce(
				$response[ OPENSTATION_NONCE_REFRESH_FIELD ]['wp_rest'],
				'wp_rest'
			)
		);
		$this->assertSame(
			self::$user_id,
			$response[ OPENSTATION_AUTH_FIELD ]['uid']
		);
	}

	/**
	 * @covers ::openstation_nonce_refresh_on_expired
	 */
	public function test_expired_path_skips_users_without_openstation() {
		$opted_out = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $opted_out );

		$response = openstation_nonce_refresh_on_expired( array( 'nonces_expired' => true ) );

		$this->assertArrayNotHasKey( OPENSTATION_NONCE_REFRESH_FIELD, $response );
		$this->assertArrayNotHasKey( OPENSTATION_AUTH_FIELD, $response );
		$this->assertTrue( $response['nonces_expired'], 'Pre-existing keys must pass through.' );
	}

	/**
	 * @covers ::openstation_nonce_refresh_on_expired
	 */
	public function test_expired_path_filter_is_registered() {
		$this->assertNotFalse(
			has_filter(
				'wp_refresh_nonces',
				'openstation_nonce_refresh_on_expired'
			),
			'openstation_nonce_refresh_on_expired should hook wp_refresh_nonces.'
		);
	}
}
