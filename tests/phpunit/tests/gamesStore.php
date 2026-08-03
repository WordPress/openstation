<?php
/**
 * Tests for the games store: score persistence + sanitization, the
 * leaderboard query, and the challenge state machine.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group desktop-mode-games
 */
class Tests_OpenStation_GamesStore extends WP_UnitTestCase {

	protected static $player_a;
	protected static $player_b;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$player_a = $factory->user->create( array( 'role' => 'editor', 'display_name' => 'Player A' ) );
		self::$player_b = $factory->user->create( array( 'role' => 'editor', 'display_name' => 'Player B' ) );
	}

	public function set_up() {
		parent::set_up();
		open_station_games_install_schema();
		wp_set_current_user( self::$player_a );
		open_station_register_game( 'test-game', array(
			'title'  => 'Test Game',
			'script' => 'test-game-script',
		) );
	}

	public function tear_down() {
		global $wpdb;
		foreach ( open_station_games_table_names() as $t ) {
			$wpdb->query( "TRUNCATE TABLE $t" );
		}
		open_station_unregister_game( 'test-game' );
		remove_all_filters( 'open_station_games' );
		remove_all_filters( 'open_station_game_score_pre_save' );
		parent::tear_down();
	}

	/**
	 * @covers ::open_station_games_save_score
	 */
	public function test_save_score_rejects_unknown_game() {
		$result = open_station_games_save_score( 'nope', self::$player_a, 10 );
		$this->assertWPError( $result );
		$this->assertSame( 'open_station_unknown_game', $result->get_error_code() );
	}

	/**
	 * @covers ::open_station_games_save_score
	 */
	public function test_save_score_clamps_negative_scores() {
		$id = open_station_games_save_score( 'test-game', self::$player_a, -50 );
		$this->assertIsInt( $id );
		$scores = open_station_games_get_scores( 'test-game' );
		$this->assertSame( 0, $scores['rows'][0]['score'] );
	}

	/**
	 * @covers ::open_station_games_sanitize_score_meta
	 */
	public function test_score_meta_is_bounded_and_flat() {
		$meta = array(
			'wpm'      => 62.5,
			'level'    => 7,
			'Bad Key!' => 'kept-under-sanitized-key',
			'nested'   => array( 'not' => 'allowed' ),
			'note'     => str_repeat( 'x', 500 ),
		);
		for ( $i = 0; $i < 30; $i++ ) {
			$meta[ "extra_$i" ] = $i;
		}
		$clean = open_station_games_sanitize_score_meta( $meta );
		$this->assertLessThanOrEqual( 20, count( $clean ) );
		$this->assertSame( 62.5, $clean['wpm'] );
		$this->assertArrayNotHasKey( 'nested', $clean );
		$this->assertSame( 200, strlen( $clean['note'] ) );
	}

	/**
	 * @covers ::open_station_games_save_score
	 */
	public function test_pre_save_filter_vetoes() {
		add_filter(
			'open_station_game_score_pre_save',
			static function () {
				return new WP_Error( 'nope', 'Blocked.' );
			}
		);
		$result = open_station_games_save_score( 'test-game', self::$player_a, 10 );
		$this->assertWPError( $result );
		$this->assertSame( 'nope', $result->get_error_code() );
		$scores = open_station_games_get_scores( 'test-game' );
		$this->assertSame( 0, $scores['total'] );
	}

	/**
	 * @covers ::open_station_games_get_scores
	 */
	public function test_leaderboard_orders_and_pages() {
		foreach ( array( 10, 30, 20 ) as $score ) {
			open_station_games_save_score( 'test-game', self::$player_a, $score );
		}
		open_station_games_save_score( 'test-game', self::$player_b, 40 );

		$page1 = open_station_games_get_scores( 'test-game', array( 'per_page' => 2 ) );
		$this->assertSame( 4, $page1['total'] );
		$this->assertSame( array( 40, 30 ), wp_list_pluck( $page1['rows'], 'score' ) );

		$page2 = open_station_games_get_scores( 'test-game', array( 'per_page' => 2, 'page' => 2 ) );
		$this->assertSame( array( 20, 10 ), wp_list_pluck( $page2['rows'], 'score' ) );

		$mine = open_station_games_get_scores( 'test-game', array( 'user_id' => self::$player_b ) );
		$this->assertSame( 1, $mine['total'] );
		$this->assertSame( 'Player B', $mine['rows'][0]['userName'] );
		$this->assertNotEmpty( $mine['rows'][0]['userAvatar'] );
	}

	/**
	 * @covers ::open_station_games_create_challenge
	 */
	public function test_create_challenge_validates_parties() {
		$self = open_station_games_create_challenge( 'test-game', self::$player_a, self::$player_a, 10 );
		$this->assertWPError( $self );
		$this->assertSame( 'open_station_self_challenge', $self->get_error_code() );

		$ghost = open_station_games_create_challenge( 'test-game', self::$player_a, 999999, 10 );
		$this->assertWPError( $ghost );
		$this->assertSame( 'open_station_invalid_recipient', $ghost->get_error_code() );
	}

	/**
	 * @covers ::open_station_games_set_challenge_state
	 * @covers ::open_station_games_complete_challenge
	 */
	public function test_challenge_state_machine() {
		$id = open_station_games_create_challenge( 'test-game', self::$player_a, self::$player_b, 100 );
		$this->assertIsInt( $id );
		$row = open_station_games_get_challenge( $id );
		$this->assertSame( 'pending', $row['state'] );

		// Completing a pending challenge is illegal.
		$early = open_station_games_complete_challenge( $id, 120 );
		$this->assertWPError( $early );
		$this->assertSame( 'open_station_challenge_state_conflict', $early->get_error_code() );

		$this->assertTrue( open_station_games_set_challenge_state( $id, 'accepted' ) );

		// A decided challenge cannot be re-decided.
		$again = open_station_games_set_challenge_state( $id, 'declined' );
		$this->assertWPError( $again );
		$this->assertSame( 'open_station_challenge_state_conflict', $again->get_error_code() );

		$updated = open_station_games_complete_challenge( $id, 120, array( 'wpm' => 60 ) );
		$this->assertIsArray( $updated );
		$this->assertSame( 'completed', $updated['state'] );
		$this->assertSame( 'beaten', $updated['result'] );
		$this->assertSame( 120, (int) $updated['result_score'] );

		// The run also landed on the leaderboard, credited to the
		// recipient.
		$scores = open_station_games_get_scores( 'test-game' );
		$this->assertSame( 1, $scores['total'] );
		$this->assertSame( self::$player_b, $scores['rows'][0]['userId'] );
	}

	/**
	 * @covers ::open_station_games_complete_challenge
	 */
	public function test_matching_score_does_not_beat() {
		$id = open_station_games_create_challenge( 'test-game', self::$player_a, self::$player_b, 100 );
		open_station_games_set_challenge_state( $id, 'accepted' );
		$updated = open_station_games_complete_challenge( $id, 100 );
		$this->assertSame( 'not_beaten', $updated['result'] );
	}

	/**
	 * @covers ::open_station_games_get_challenges_for_user
	 */
	public function test_challenge_deltas_are_version_gated() {
		$id = open_station_games_create_challenge( 'test-game', self::$player_a, self::$player_b, 100 );

		$all = open_station_games_get_challenges_for_user( self::$player_b, 0 );
		$this->assertCount( 1, $all );

		$version = (int) $all[0]['updated_at_ms'];
		$this->assertSame( array(), open_station_games_get_challenges_for_user( self::$player_b, $version ) );

		// A state change bumps the row past the client's version.
		open_station_games_set_challenge_state( $id, 'accepted' );
		$fresh = open_station_games_get_challenges_for_user( self::$player_a, $version );
		$this->assertCount( 1, $fresh );
		$this->assertSame( 'accepted', $fresh[0]['state'] );
	}

	/**
	 * @covers ::open_station_games_shape_challenge
	 */
	public function test_shape_challenge_carries_both_parties() {
		$id    = open_station_games_create_challenge( 'test-game', self::$player_a, self::$player_b, 100, array( 'wpm' => 50 ) );
		$shape = open_station_games_shape_challenge( open_station_games_get_challenge( $id ) );
		$this->assertSame( 'Player A', $shape['challengerName'] );
		$this->assertSame( 'Player B', $shape['recipientName'] );
		$this->assertSame( 100, $shape['scoreToBeat'] );
		$this->assertSame( 50, $shape['scoreMeta']['wpm'] );
		$this->assertSame( 'pending', $shape['state'] );
		$this->assertNull( $shape['result'] );
	}
}
