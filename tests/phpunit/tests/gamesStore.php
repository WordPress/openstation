<?php
/**
 * Tests for the games store: score persistence + sanitization, the
 * leaderboard query, and the challenge state machine.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-games
 */
class Tests_DesktopMode_GamesStore extends WP_UnitTestCase {

	protected static $player_a;
	protected static $player_b;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$player_a = $factory->user->create( array( 'role' => 'editor', 'display_name' => 'Player A' ) );
		self::$player_b = $factory->user->create( array( 'role' => 'editor', 'display_name' => 'Player B' ) );
	}

	public function set_up() {
		parent::set_up();
		desktop_mode_games_install_schema();
		wp_set_current_user( self::$player_a );
		desktop_mode_register_game( 'test-game', array(
			'title'  => 'Test Game',
			'script' => 'test-game-script',
		) );
	}

	public function tear_down() {
		global $wpdb;
		foreach ( desktop_mode_games_table_names() as $t ) {
			$wpdb->query( "TRUNCATE TABLE $t" );
		}
		desktop_mode_unregister_game( 'test-game' );
		remove_all_filters( 'desktop_mode_games' );
		remove_all_filters( 'desktop_mode_game_score_pre_save' );
		parent::tear_down();
	}

	/**
	 * @covers ::desktop_mode_games_save_score
	 */
	public function test_save_score_rejects_unknown_game() {
		$result = desktop_mode_games_save_score( 'nope', self::$player_a, 10 );
		$this->assertWPError( $result );
		$this->assertSame( 'desktop_mode_unknown_game', $result->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_games_save_score
	 */
	public function test_save_score_clamps_negative_scores() {
		$id = desktop_mode_games_save_score( 'test-game', self::$player_a, -50 );
		$this->assertIsInt( $id );
		$scores = desktop_mode_games_get_scores( 'test-game' );
		$this->assertSame( 0, $scores['rows'][0]['score'] );
	}

	/**
	 * @covers ::desktop_mode_games_sanitize_score_meta
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
		$clean = desktop_mode_games_sanitize_score_meta( $meta );
		$this->assertLessThanOrEqual( 20, count( $clean ) );
		$this->assertSame( 62.5, $clean['wpm'] );
		$this->assertArrayNotHasKey( 'nested', $clean );
		$this->assertSame( 200, strlen( $clean['note'] ) );
	}

	/**
	 * @covers ::desktop_mode_games_save_score
	 */
	public function test_pre_save_filter_vetoes() {
		add_filter(
			'desktop_mode_game_score_pre_save',
			static function () {
				return new WP_Error( 'nope', 'Blocked.' );
			}
		);
		$result = desktop_mode_games_save_score( 'test-game', self::$player_a, 10 );
		$this->assertWPError( $result );
		$this->assertSame( 'nope', $result->get_error_code() );
		$scores = desktop_mode_games_get_scores( 'test-game' );
		$this->assertSame( 0, $scores['total'] );
	}

	/**
	 * @covers ::desktop_mode_games_get_scores
	 */
	public function test_leaderboard_orders_and_pages() {
		foreach ( array( 10, 30, 20 ) as $score ) {
			desktop_mode_games_save_score( 'test-game', self::$player_a, $score );
		}
		desktop_mode_games_save_score( 'test-game', self::$player_b, 40 );

		$page1 = desktop_mode_games_get_scores( 'test-game', array( 'per_page' => 2 ) );
		$this->assertSame( 4, $page1['total'] );
		$this->assertSame( array( 40, 30 ), wp_list_pluck( $page1['rows'], 'score' ) );

		$page2 = desktop_mode_games_get_scores( 'test-game', array( 'per_page' => 2, 'page' => 2 ) );
		$this->assertSame( array( 20, 10 ), wp_list_pluck( $page2['rows'], 'score' ) );

		$mine = desktop_mode_games_get_scores( 'test-game', array( 'user_id' => self::$player_b ) );
		$this->assertSame( 1, $mine['total'] );
		$this->assertSame( 'Player B', $mine['rows'][0]['userName'] );
		$this->assertNotEmpty( $mine['rows'][0]['userAvatar'] );
	}

	/**
	 * @covers ::desktop_mode_games_create_challenge
	 */
	public function test_create_challenge_validates_parties() {
		$self = desktop_mode_games_create_challenge( 'test-game', self::$player_a, self::$player_a, 10 );
		$this->assertWPError( $self );
		$this->assertSame( 'desktop_mode_self_challenge', $self->get_error_code() );

		$ghost = desktop_mode_games_create_challenge( 'test-game', self::$player_a, 999999, 10 );
		$this->assertWPError( $ghost );
		$this->assertSame( 'desktop_mode_invalid_recipient', $ghost->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_games_set_challenge_state
	 * @covers ::desktop_mode_games_complete_challenge
	 */
	public function test_challenge_state_machine() {
		$id = desktop_mode_games_create_challenge( 'test-game', self::$player_a, self::$player_b, 100 );
		$this->assertIsInt( $id );
		$row = desktop_mode_games_get_challenge( $id );
		$this->assertSame( 'pending', $row['state'] );

		// Completing a pending challenge is illegal.
		$early = desktop_mode_games_complete_challenge( $id, 120 );
		$this->assertWPError( $early );
		$this->assertSame( 'desktop_mode_challenge_state_conflict', $early->get_error_code() );

		$this->assertTrue( desktop_mode_games_set_challenge_state( $id, 'accepted' ) );

		// A decided challenge cannot be re-decided.
		$again = desktop_mode_games_set_challenge_state( $id, 'declined' );
		$this->assertWPError( $again );
		$this->assertSame( 'desktop_mode_challenge_state_conflict', $again->get_error_code() );

		$updated = desktop_mode_games_complete_challenge( $id, 120, array( 'wpm' => 60 ) );
		$this->assertIsArray( $updated );
		$this->assertSame( 'completed', $updated['state'] );
		$this->assertSame( 'beaten', $updated['result'] );
		$this->assertSame( 120, (int) $updated['result_score'] );

		// The run also landed on the leaderboard, credited to the
		// recipient.
		$scores = desktop_mode_games_get_scores( 'test-game' );
		$this->assertSame( 1, $scores['total'] );
		$this->assertSame( self::$player_b, $scores['rows'][0]['userId'] );
	}

	/**
	 * @covers ::desktop_mode_games_complete_challenge
	 */
	public function test_matching_score_does_not_beat() {
		$id = desktop_mode_games_create_challenge( 'test-game', self::$player_a, self::$player_b, 100 );
		desktop_mode_games_set_challenge_state( $id, 'accepted' );
		$updated = desktop_mode_games_complete_challenge( $id, 100 );
		$this->assertSame( 'not_beaten', $updated['result'] );
	}

	/**
	 * @covers ::desktop_mode_games_get_challenges_for_user
	 */
	public function test_challenge_deltas_are_version_gated() {
		$id = desktop_mode_games_create_challenge( 'test-game', self::$player_a, self::$player_b, 100 );

		$all = desktop_mode_games_get_challenges_for_user( self::$player_b, 0 );
		$this->assertCount( 1, $all );

		$version = (int) $all[0]['updated_at_ms'];
		$this->assertSame( array(), desktop_mode_games_get_challenges_for_user( self::$player_b, $version ) );

		// A state change bumps the row past the client's version.
		desktop_mode_games_set_challenge_state( $id, 'accepted' );
		$fresh = desktop_mode_games_get_challenges_for_user( self::$player_a, $version );
		$this->assertCount( 1, $fresh );
		$this->assertSame( 'accepted', $fresh[0]['state'] );
	}

	/**
	 * @covers ::desktop_mode_games_shape_challenge
	 */
	public function test_shape_challenge_carries_both_parties() {
		$id    = desktop_mode_games_create_challenge( 'test-game', self::$player_a, self::$player_b, 100, array( 'wpm' => 50 ) );
		$shape = desktop_mode_games_shape_challenge( desktop_mode_games_get_challenge( $id ) );
		$this->assertSame( 'Player A', $shape['challengerName'] );
		$this->assertSame( 'Player B', $shape['recipientName'] );
		$this->assertSame( 100, $shape['scoreToBeat'] );
		$this->assertSame( 50, $shape['scoreMeta']['wpm'] );
		$this->assertSame( 'pending', $shape['state'] );
		$this->assertNull( $shape['result'] );
	}
}
