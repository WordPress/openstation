<?php
/**
 * Tests for the games Heartbeat channel: subscription gating,
 * version-gated deltas, truncation, and delivery to both parties.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group desktop-mode-games
 */
class Tests_OpenStation_GamesHeartbeat extends WP_UnitTestCase {

	protected static $challenger;
	protected static $recipient;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$challenger = $factory->user->create( array( 'role' => 'subscriber' ) );
		self::$recipient  = $factory->user->create( array( 'role' => 'subscriber' ) );
	}

	public function set_up() {
		parent::set_up();
		openstation_games_install_schema();
		openstation_register_game( 'test-game', array(
			'title'  => 'Test Game',
			'script' => 'test-game-script',
		) );
		update_user_meta( self::$challenger, 'desktop_mode_mode', '1' );
		update_user_meta( self::$recipient, 'desktop_mode_mode', '1' );
		wp_set_current_user( self::$recipient );
	}

	public function tear_down() {
		global $wpdb;
		foreach ( openstation_games_table_names() as $t ) {
			$wpdb->query( "TRUNCATE TABLE $t" );
		}
		openstation_unregister_game( 'test-game' );
		remove_all_filters( 'openstation_games_heartbeat_max_rows' );
		parent::tear_down();
	}

	private function tick( $version = 0 ) {
		return openstation_games_heartbeat_received(
			array(),
			array( 'openstation_games_subscribe' => array( 'challengesVersion' => $version ) )
		);
	}

	/**
	 * @covers ::openstation_games_heartbeat_received
	 */
	public function test_no_subscription_no_payload() {
		$response = openstation_games_heartbeat_received( array(), array() );
		$this->assertArrayNotHasKey( 'openstation_games', $response );
	}

	/**
	 * @covers ::openstation_games_heartbeat_received
	 */
	public function test_requires_openstation_enabled() {
		delete_user_meta( self::$recipient, 'desktop_mode_mode' );
		$response = $this->tick();
		$this->assertArrayNotHasKey( 'openstation_games', $response );
	}

	/**
	 * @covers ::openstation_games_heartbeat_received
	 */
	public function test_recipient_sees_pending_challenge_once() {
		openstation_games_create_challenge( 'test-game', self::$challenger, self::$recipient, 100 );

		$response = $this->tick( 0 );
		$this->assertArrayHasKey( 'openstation_games', $response );
		$payload = $response['openstation_games'];
		$this->assertCount( 1, $payload['challenges'] );
		$this->assertSame( 'pending', $payload['challenges'][0]['state'] );
		$this->assertFalse( $payload['truncated'] );

		// Advancing to the delivered high-water mark silences the
		// channel.
		$version = $payload['challenges'][0]['updatedAtMs'];
		$quiet   = $this->tick( $version );
		$this->assertSame( array(), $quiet['openstation_games']['challenges'] );
	}

	/**
	 * @covers ::openstation_games_heartbeat_received
	 */
	public function test_challenger_sees_completion() {
		$id = openstation_games_create_challenge( 'test-game', self::$challenger, self::$recipient, 100 );
		$created_version = (int) openstation_games_get_challenge( $id )['updated_at_ms'];
		openstation_games_set_challenge_state( $id, 'accepted' );
		openstation_games_complete_challenge( $id, 150 );

		wp_set_current_user( self::$challenger );
		$payload = $this->tick( $created_version )['openstation_games'];
		$this->assertCount( 1, $payload['challenges'] );
		$this->assertSame( 'completed', $payload['challenges'][0]['state'] );
		$this->assertSame( 'beaten', $payload['challenges'][0]['result'] );
	}

	/**
	 * @covers ::openstation_games_heartbeat_received
	 */
	public function test_truncation_flag_past_cap() {
		add_filter(
			'openstation_games_heartbeat_max_rows',
			static function () {
				return 2;
			}
		);
		for ( $i = 0; $i < 3; $i++ ) {
			openstation_games_create_challenge( 'test-game', self::$challenger, self::$recipient, 10 + $i );
		}
		$payload = $this->tick( 0 )['openstation_games'];
		$this->assertCount( 2, $payload['challenges'] );
		$this->assertTrue( $payload['truncated'] );
	}
}
