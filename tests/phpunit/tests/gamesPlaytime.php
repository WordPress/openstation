<?php
/**
 * Tests for the games play-time store + REST endpoints: accumulation,
 * clamping, the veto filter, and per-user isolation.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-games
 */
class Tests_DesktopMode_GamesPlaytime extends WP_UnitTestCase {

	protected static $player_a;
	protected static $player_b;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$player_a = $factory->user->create( array( 'role' => 'subscriber', 'display_name' => 'Player A' ) );
		self::$player_b = $factory->user->create( array( 'role' => 'subscriber', 'display_name' => 'Player B' ) );
	}

	public function set_up() {
		parent::set_up();
		desktop_mode_register_game( 'test-game', array(
			'title'  => 'Test Game',
			'script' => 'test-game-script',
		) );
		update_user_meta( self::$player_a, 'desktop_mode_mode', '1' );
		wp_set_current_user( self::$player_a );
	}

	public function tear_down() {
		delete_user_meta( self::$player_a, DESKTOP_MODE_GAMES_PLAYTIME_META );
		delete_user_meta( self::$player_b, DESKTOP_MODE_GAMES_PLAYTIME_META );
		delete_user_meta( self::$player_a, DESKTOP_MODE_GAMES_PLAYTIME_DAYS_META );
		delete_user_meta( self::$player_b, DESKTOP_MODE_GAMES_PLAYTIME_DAYS_META );
		desktop_mode_unregister_game( 'test-game' );
		remove_all_filters( 'desktop_mode_games' );
		remove_all_filters( 'desktop_mode_game_playtime_pre_record' );
		remove_all_filters( 'desktop_mode_games_playtime_max_increment' );
		remove_all_filters( 'desktop_mode_games_playtime_history_days' );
		parent::tear_down();
	}

	/**
	 * @covers ::desktop_mode_games_add_playtime
	 * @covers ::desktop_mode_games_get_playtime
	 */
	public function test_playtime_accumulates_per_game() {
		$this->assertSame( 45, desktop_mode_games_add_playtime( 'test-game', self::$player_a, 45 ) );
		$this->assertSame( 105, desktop_mode_games_add_playtime( 'test-game', self::$player_a, 60 ) );
		$this->assertSame( 105, desktop_mode_games_get_playtime( self::$player_a, 'test-game' ) );
		$this->assertSame( array( 'test-game' => 105 ), desktop_mode_games_get_playtime( self::$player_a ) );
	}

	/**
	 * @covers ::desktop_mode_games_add_playtime
	 */
	public function test_playtime_is_per_user() {
		desktop_mode_games_add_playtime( 'test-game', self::$player_a, 30 );
		desktop_mode_games_add_playtime( 'test-game', self::$player_b, 90 );
		$this->assertSame( 30, desktop_mode_games_get_playtime( self::$player_a, 'test-game' ) );
		$this->assertSame( 90, desktop_mode_games_get_playtime( self::$player_b, 'test-game' ) );
	}

	/**
	 * @covers ::desktop_mode_games_add_playtime
	 */
	public function test_playtime_rejects_unknown_game_and_bad_input() {
		$unknown = desktop_mode_games_add_playtime( 'nope', self::$player_a, 30 );
		$this->assertWPError( $unknown );
		$this->assertSame( 'desktop_mode_unknown_game', $unknown->get_error_code() );

		$zero = desktop_mode_games_add_playtime( 'test-game', self::$player_a, 0 );
		$this->assertWPError( $zero );
		$this->assertSame( 'desktop_mode_invalid_playtime', $zero->get_error_code() );

		$negative = desktop_mode_games_add_playtime( 'test-game', self::$player_a, -10 );
		$this->assertWPError( $negative );

		$ghost = desktop_mode_games_add_playtime( 'test-game', 0, 30 );
		$this->assertWPError( $ghost );
		$this->assertSame( 'desktop_mode_invalid_user', $ghost->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_games_add_playtime
	 */
	public function test_playtime_increment_is_clamped() {
		// One request cannot mint more than the (filterable) cap.
		$this->assertSame( 900, desktop_mode_games_add_playtime( 'test-game', self::$player_a, WEEK_IN_SECONDS ) );

		add_filter(
			'desktop_mode_games_playtime_max_increment',
			static function () {
				return 60;
			}
		);
		$this->assertSame( 960, desktop_mode_games_add_playtime( 'test-game', self::$player_a, 5000 ) );
	}

	/**
	 * @covers ::desktop_mode_games_add_playtime
	 */
	public function test_pre_record_filter_vetoes() {
		add_filter(
			'desktop_mode_game_playtime_pre_record',
			static function () {
				return new WP_Error( 'nope', 'Blocked.' );
			}
		);
		$result = desktop_mode_games_add_playtime( 'test-game', self::$player_a, 30 );
		$this->assertWPError( $result );
		$this->assertSame( 'nope', $result->get_error_code() );
		$this->assertSame( 0, desktop_mode_games_get_playtime( self::$player_a, 'test-game' ) );
	}

	/**
	 * @covers ::desktop_mode_games_get_playtime
	 */
	public function test_get_playtime_survives_corrupt_meta() {
		update_user_meta( self::$player_a, DESKTOP_MODE_GAMES_PLAYTIME_META, 'not-an-array' );
		$this->assertSame( array(), desktop_mode_games_get_playtime( self::$player_a ) );
		$this->assertSame( 0, desktop_mode_games_get_playtime( self::$player_a, 'test-game' ) );

		update_user_meta( self::$player_a, DESKTOP_MODE_GAMES_PLAYTIME_META, array( 'test-game' => -50, '' => 10 ) );
		$this->assertSame( array( 'test-game' => 0 ), desktop_mode_games_get_playtime( self::$player_a ) );
	}

	/**
	 * @covers ::desktop_mode_games_add_playtime
	 * @covers ::desktop_mode_games_get_playtime_daily
	 */
	public function test_playtime_buckets_by_day() {
		$today = desktop_mode_games_playtime_today_key();
		desktop_mode_games_add_playtime( 'test-game', self::$player_a, 45 );
		desktop_mode_games_add_playtime( 'test-game', self::$player_a, 15 );

		$days = desktop_mode_games_get_playtime_daily( self::$player_a, 'test-game' );
		$this->assertSame( array( $today => 60 ), $days );
		$this->assertSame(
			array( 'test-game' => array( $today => 60 ) ),
			desktop_mode_games_get_playtime_daily( self::$player_a )
		);
	}

	/**
	 * @covers ::desktop_mode_games_add_playtime
	 */
	public function test_playtime_daily_buckets_are_pruned() {
		$today = desktop_mode_games_playtime_today_key();
		$stale = current_datetime()->modify( '-60 days' )->format( 'Y-m-d' );
		$kept  = current_datetime()->modify( '-3 days' )->format( 'Y-m-d' );
		update_user_meta(
			self::$player_a,
			DESKTOP_MODE_GAMES_PLAYTIME_DAYS_META,
			array( 'test-game' => array( $stale => 500, $kept => 120 ) )
		);

		desktop_mode_games_add_playtime( 'test-game', self::$player_a, 30 );

		$days = desktop_mode_games_get_playtime_daily( self::$player_a, 'test-game' );
		$this->assertArrayNotHasKey( $stale, $days );
		$this->assertSame( 120, $days[ $kept ] );
		$this->assertSame( 30, $days[ $today ] );

		// The lifetime total is untouched by pruning.
		$this->assertSame( 30, desktop_mode_games_get_playtime( self::$player_a, 'test-game' ) );
	}

	/**
	 * @covers ::desktop_mode_games_get_playtime_daily
	 */
	public function test_get_playtime_daily_survives_corrupt_meta() {
		update_user_meta( self::$player_a, DESKTOP_MODE_GAMES_PLAYTIME_DAYS_META, 'nope' );
		$this->assertSame( array(), desktop_mode_games_get_playtime_daily( self::$player_a ) );

		update_user_meta(
			self::$player_a,
			DESKTOP_MODE_GAMES_PLAYTIME_DAYS_META,
			array( 'test-game' => array( 'not-a-date' => 10, '2026-01-02' => -5 ) )
		);
		$this->assertSame(
			array( '2026-01-02' => 0 ),
			desktop_mode_games_get_playtime_daily( self::$player_a, 'test-game' )
		);
	}

	/**
	 * @covers ::desktop_mode_games_rest_record_playtime
	 * @covers ::desktop_mode_games_rest_get_playtime
	 */
	public function test_rest_record_then_get() {
		$req = new WP_REST_Request( 'POST', '/desktop-mode/v1/games/test-game/playtime' );
		$req->set_param( 'game', 'test-game' );
		$req->set_param( 'seconds', 75 );
		$resp = desktop_mode_games_rest_record_playtime( $req );
		$this->assertNotWPError( $resp );
		$this->assertSame( 75, $resp->get_data()['total'] );

		$data = desktop_mode_games_rest_get_playtime()->get_data();
		// Cast: the map is emitted as an object so an empty map JSON-
		// encodes as `{}` rather than `[]`.
		$this->assertSame( 75, ( (array) $data['playtime'] )['test-game'] );

		$today = desktop_mode_games_playtime_today_key();
		$this->assertSame( $today, $data['today'] );
		$daily = (array) $data['daily'];
		$this->assertSame( 75, ( (array) $daily['test-game'] )[ $today ] );
	}

	/**
	 * @covers ::desktop_mode_games_rest_record_playtime
	 */
	public function test_rest_record_404s_unknown_game() {
		$req = new WP_REST_Request( 'POST', '/desktop-mode/v1/games/nope/playtime' );
		$req->set_param( 'game', 'nope' );
		$req->set_param( 'seconds', 30 );
		$result = desktop_mode_games_rest_record_playtime( $req );
		$this->assertWPError( $result );
		$this->assertSame( 'desktop_mode_unknown_game', $result->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_games_rest_get_playtime
	 */
	public function test_rest_get_empty_map_encodes_as_object() {
		$data = desktop_mode_games_rest_get_playtime()->get_data();
		$this->assertSame( '{}', wp_json_encode( $data['playtime'] ) );
	}
}
