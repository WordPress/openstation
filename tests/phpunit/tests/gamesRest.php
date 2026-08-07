<?php
/**
 * Tests for the games REST surface: permission gates, score
 * submission/leaderboard, and the challenge lifecycle endpoints.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group desktop-mode-games
 */
class Tests_OpenStation_GamesRest extends WP_UnitTestCase {

	protected static $challenger;
	protected static $recipient;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$challenger = $factory->user->create( array( 'role' => 'subscriber', 'display_name' => 'Challenger' ) );
		self::$recipient  = $factory->user->create( array( 'role' => 'subscriber', 'display_name' => 'Recipient' ) );
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
		wp_set_current_user( self::$challenger );
	}

	public function tear_down() {
		global $wpdb;
		foreach ( openstation_games_table_names() as $t ) {
			$wpdb->query( "TRUNCATE TABLE $t" );
		}
		openstation_unregister_game( 'test-game' );
		remove_all_filters( 'openstation_games_can_challenge' );
		remove_all_filters( 'openstation_games_rest_permission' );
		parent::tear_down();
	}

	private function request( $method, $path, array $params = array() ) {
		$req = new WP_REST_Request( $method, $path );
		foreach ( $params as $k => $v ) {
			$req->set_param( $k, $v );
		}
		return $req;
	}

	/**
	 * @covers ::openstation_games_rest_permission
	 */
	public function test_permission_requires_login() {
		wp_set_current_user( 0 );
		$result = openstation_games_rest_permission();
		$this->assertWPError( $result );
		$this->assertSame( 401, $result->get_error_data()['status'] );
	}

	/**
	 * @covers ::openstation_games_rest_permission
	 */
	public function test_permission_requires_openstation() {
		delete_user_meta( self::$challenger, 'desktop_mode_mode' );
		$result = openstation_games_rest_permission();
		$this->assertWPError( $result );
		$this->assertSame( 403, $result->get_error_data()['status'] );
	}

	/**
	 * @covers ::openstation_games_rest_permission
	 */
	public function test_permission_filter_can_lock_down() {
		$this->assertTrue( openstation_games_rest_permission() );
		add_filter( 'openstation_games_rest_permission', '__return_false' );
		$result = openstation_games_rest_permission();
		$this->assertWPError( $result );
	}

	/**
	 * @covers ::openstation_games_rest_submit_score
	 */
	public function test_submit_score_404s_unknown_game() {
		$req = $this->request( 'POST', '/desktop-mode/v1/games/nope/scores', array(
			'game'  => 'nope',
			'score' => 10,
		) );
		$result = openstation_games_rest_submit_score( $req );
		$this->assertWPError( $result );
		$this->assertSame( 'openstation_unknown_game', $result->get_error_code() );
	}

	/**
	 * @covers ::openstation_games_rest_submit_score
	 * @covers ::openstation_games_rest_list_scores
	 */
	public function test_submit_then_list_scores() {
		$req = $this->request( 'POST', '/desktop-mode/v1/games/test-game/scores', array(
			'game'  => 'test-game',
			'score' => 250,
			'meta'  => array( 'wpm' => 61 ),
		) );
		$resp = openstation_games_rest_submit_score( $req );
		$this->assertNotWPError( $resp );

		$list = openstation_games_rest_list_scores( $this->request( 'GET', '/desktop-mode/v1/games/test-game/scores', array(
			'game'     => 'test-game',
			'page'     => 1,
			'per_page' => 25,
			'orderby'  => 'score',
			'order'    => 'desc',
			'user_id'  => 0,
		) ) );
		$data = $list->get_data();
		$this->assertSame( 1, $data['total'] );
		$this->assertSame( 250, $data['scores'][0]['score'] );
		$this->assertSame( 61, $data['scores'][0]['meta']['wpm'] );
		// The submitting session is the credited player — no
		// impersonation path exists.
		$this->assertSame( self::$challenger, $data['scores'][0]['userId'] );
	}

	private function create_challenge_via_rest() {
		$resp = openstation_games_rest_create_challenge( $this->request( 'POST', '/desktop-mode/v1/games/challenges', array(
			'game'         => 'test-game',
			'recipient_id' => self::$recipient,
			'score'        => 300,
			'meta'         => array( 'wpm' => 70 ),
		) ) );
		$this->assertNotWPError( $resp );
		return $resp->get_data()['challenge'];
	}

	/**
	 * @covers ::openstation_games_rest_create_challenge
	 */
	public function test_challenge_create_and_can_challenge_filter() {
		$challenge = $this->create_challenge_via_rest();
		$this->assertSame( 'pending', $challenge['state'] );
		$this->assertSame( 300, $challenge['scoreToBeat'] );

		add_filter( 'openstation_games_can_challenge', '__return_false' );
		$blocked = openstation_games_rest_create_challenge( $this->request( 'POST', '/desktop-mode/v1/games/challenges', array(
			'game'         => 'test-game',
			'recipient_id' => self::$recipient,
			'score'        => 10,
		) ) );
		$this->assertWPError( $blocked );
		$this->assertSame( 'openstation_challenge_blocked', $blocked->get_error_code() );
	}

	/**
	 * @covers ::openstation_games_rest_accept_challenge
	 */
	public function test_only_recipient_can_accept() {
		$challenge = $this->create_challenge_via_rest();

		// The challenger themselves cannot accept.
		$forbidden = openstation_games_rest_accept_challenge(
			$this->request( 'POST', "/desktop-mode/v1/games/challenges/{$challenge['id']}/accept", array( 'id' => $challenge['id'] ) )
		);
		$this->assertWPError( $forbidden );
		$this->assertSame( 403, $forbidden->get_error_data()['status'] );

		wp_set_current_user( self::$recipient );
		$resp = openstation_games_rest_accept_challenge(
			$this->request( 'POST', "/desktop-mode/v1/games/challenges/{$challenge['id']}/accept", array( 'id' => $challenge['id'] ) )
		);
		$this->assertNotWPError( $resp );
		$this->assertSame( 'accepted', $resp->get_data()['challenge']['state'] );
	}

	/**
	 * @covers ::openstation_games_rest_complete_challenge
	 */
	public function test_complete_flow_and_wrong_state_conflict() {
		$challenge = $this->create_challenge_via_rest();
		wp_set_current_user( self::$recipient );

		// Completing before accepting: 409.
		$early = openstation_games_rest_complete_challenge(
			$this->request( 'POST', "/desktop-mode/v1/games/challenges/{$challenge['id']}/complete", array(
				'id'    => $challenge['id'],
				'score' => 500,
			) )
		);
		$this->assertWPError( $early );
		$this->assertSame( 409, $early->get_error_data()['status'] );

		openstation_games_rest_accept_challenge(
			$this->request( 'POST', "/desktop-mode/v1/games/challenges/{$challenge['id']}/accept", array( 'id' => $challenge['id'] ) )
		);
		$resp = openstation_games_rest_complete_challenge(
			$this->request( 'POST', "/desktop-mode/v1/games/challenges/{$challenge['id']}/complete", array(
				'id'    => $challenge['id'],
				'score' => 500,
			) )
		);
		$this->assertNotWPError( $resp );
		$data = $resp->get_data()['challenge'];
		$this->assertSame( 'completed', $data['state'] );
		$this->assertSame( 'beaten', $data['result'] );
		$this->assertSame( 500, $data['resultScore'] );
	}

	/**
	 * @covers ::openstation_games_rest_decline_challenge
	 */
	public function test_decline() {
		$challenge = $this->create_challenge_via_rest();
		wp_set_current_user( self::$recipient );
		$resp = openstation_games_rest_decline_challenge(
			$this->request( 'POST', "/desktop-mode/v1/games/challenges/{$challenge['id']}/decline", array( 'id' => $challenge['id'] ) )
		);
		$this->assertNotWPError( $resp );
		$this->assertSame( 'declined', $resp->get_data()['challenge']['state'] );
	}

	/**
	 * @covers ::openstation_games_rest_list_challenges
	 */
	public function test_list_challenges_boxes() {
		$this->create_challenge_via_rest();

		$incoming = openstation_games_rest_list_challenges(
			$this->request( 'GET', '/desktop-mode/v1/games/challenges', array( 'box' => 'incoming', 'state' => '' ) )
		)->get_data();
		$this->assertCount( 0, $incoming['challenges'] );

		$outgoing = openstation_games_rest_list_challenges(
			$this->request( 'GET', '/desktop-mode/v1/games/challenges', array( 'box' => 'outgoing', 'state' => '' ) )
		)->get_data();
		$this->assertCount( 1, $outgoing['challenges'] );

		wp_set_current_user( self::$recipient );
		$incoming = openstation_games_rest_list_challenges(
			$this->request( 'GET', '/desktop-mode/v1/games/challenges', array( 'box' => 'incoming', 'state' => '' ) )
		)->get_data();
		$this->assertCount( 1, $incoming['challenges'] );
	}

	/**
	 * @covers ::openstation_games_rest_search_users
	 */
	public function test_users_search_excludes_viewer() {
		$resp  = openstation_games_rest_search_users(
			$this->request( 'GET', '/desktop-mode/v1/games/users/search', array( 'q' => '', 'exclude' => '' ) )
		);
		$users = $resp->get_data()['users'];
		$ids   = wp_list_pluck( $users, 'id' );
		$this->assertNotContains( self::$challenger, $ids );
		$this->assertContains( self::$recipient, $ids );
	}
}
