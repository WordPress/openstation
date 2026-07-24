<?php
/**
 * Tests for the games Heartbeat channel: subscription gating,
 * version-gated deltas, truncation, and delivery to both parties.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-games
 */
class Tests_DesktopMode_GamesHeartbeat extends WP_UnitTestCase {

	protected static $challenger;
	protected static $recipient;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$challenger = $factory->user->create( array( 'role' => 'subscriber' ) );
		self::$recipient  = $factory->user->create( array( 'role' => 'subscriber' ) );
	}

	public function set_up() {
		parent::set_up();
		desktop_mode_games_install_schema();
		desktop_mode_register_game( 'test-game', array(
			'title'  => 'Test Game',
			'script' => 'test-game-script',
		) );
		update_user_meta( self::$challenger, 'desktop_mode_mode', '1' );
		update_user_meta( self::$recipient, 'desktop_mode_mode', '1' );
		wp_set_current_user( self::$recipient );
	}

	public function tear_down() {
		global $wpdb;
		foreach ( desktop_mode_games_table_names() as $t ) {
			$wpdb->query( "TRUNCATE TABLE $t" );
		}
		desktop_mode_unregister_game( 'test-game' );
		remove_all_filters( 'desktop_mode_games_heartbeat_max_rows' );
		parent::tear_down();
	}

	private function tick( $version = 0 ) {
		return desktop_mode_games_heartbeat_received(
			array(),
			array( 'desktop_mode_games_subscribe' => array( 'challengesVersion' => $version ) )
		);
	}

	/**
	 * @covers ::desktop_mode_games_heartbeat_received
	 */
	public function test_no_subscription_no_payload() {
		$response = desktop_mode_games_heartbeat_received( array(), array() );
		$this->assertArrayNotHasKey( 'desktop_mode_games', $response );
	}

	/**
	 * @covers ::desktop_mode_games_heartbeat_received
	 */
	public function test_requires_desktop_mode_enabled() {
		delete_user_meta( self::$recipient, 'desktop_mode_mode' );
		$response = $this->tick();
		$this->assertArrayNotHasKey( 'desktop_mode_games', $response );
	}

	/**
	 * @covers ::desktop_mode_games_heartbeat_received
	 */
	public function test_recipient_sees_pending_challenge_once() {
		desktop_mode_games_create_challenge( 'test-game', self::$challenger, self::$recipient, 100 );

		$response = $this->tick( 0 );
		$this->assertArrayHasKey( 'desktop_mode_games', $response );
		$payload = $response['desktop_mode_games'];
		$this->assertCount( 1, $payload['challenges'] );
		$this->assertSame( 'pending', $payload['challenges'][0]['state'] );
		$this->assertFalse( $payload['truncated'] );

		// Advancing to the delivered high-water mark silences the
		// channel.
		$version = $payload['challenges'][0]['updatedAtMs'];
		$quiet   = $this->tick( $version );
		$this->assertSame( array(), $quiet['desktop_mode_games']['challenges'] );
	}

	/**
	 * @covers ::desktop_mode_games_heartbeat_received
	 */
	public function test_challenger_sees_completion() {
		$id = desktop_mode_games_create_challenge( 'test-game', self::$challenger, self::$recipient, 100 );
		$created_version = (int) desktop_mode_games_get_challenge( $id )['updated_at_ms'];
		desktop_mode_games_set_challenge_state( $id, 'accepted' );
		desktop_mode_games_complete_challenge( $id, 150 );

		wp_set_current_user( self::$challenger );
		$payload = $this->tick( $created_version )['desktop_mode_games'];
		$this->assertCount( 1, $payload['challenges'] );
		$this->assertSame( 'completed', $payload['challenges'][0]['state'] );
		$this->assertSame( 'beaten', $payload['challenges'][0]['result'] );
	}

	/**
	 * @covers ::desktop_mode_games_heartbeat_received
	 */
	public function test_truncation_flag_past_cap() {
		add_filter(
			'desktop_mode_games_heartbeat_max_rows',
			static function () {
				return 2;
			}
		);
		for ( $i = 0; $i < 3; $i++ ) {
			desktop_mode_games_create_challenge( 'test-game', self::$challenger, self::$recipient, 10 + $i );
		}
		$payload = $this->tick( 0 )['desktop_mode_games'];
		$this->assertCount( 2, $payload['challenges'] );
		$this->assertTrue( $payload['truncated'] );
	}
}
