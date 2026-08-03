<?php
/**
 * Tests for the games registry: registration validation, score
 * column sanitization, the `open_station_games` filter, and the
 * `serverGames` payload.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group desktop-mode-games
 */
class Tests_OpenStation_GamesRegistry extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
	}

	public function tear_down() {
		remove_all_filters( 'open_station_games' );
		foreach ( array( 'test-game', 'other-game', 'filter-game' ) as $id ) {
			open_station_unregister_game( $id );
		}
		parent::tear_down();
	}

	private function register_test_game( $id = 'test-game', $overrides = array() ) {
		return open_station_register_game(
			$id,
			wp_parse_args(
				$overrides,
				array(
					'title'         => 'Test Game',
					'script'        => 'test-game-script',
					'score_columns' => array(
						array( 'key' => 'score', 'label' => 'Score', 'type' => 'number' ),
					),
				)
			)
		);
	}

	/**
	 * @covers ::open_station_register_game
	 */
	public function test_register_requires_title() {
		$result = open_station_register_game( 'test-game', array( 'script' => 'x' ) );
		$this->assertWPError( $result );
		$this->assertSame( 'open_station_missing_title', $result->get_error_code() );
	}

	/**
	 * @covers ::open_station_register_game
	 */
	public function test_register_requires_script() {
		$result = open_station_register_game( 'test-game', array( 'title' => 'X' ) );
		$this->assertWPError( $result );
		$this->assertSame( 'open_station_missing_script', $result->get_error_code() );
	}

	/**
	 * @covers ::open_station_register_game
	 */
	public function test_register_rejects_script_tag_in_icon_svg() {
		$result = $this->register_test_game( 'test-game', array(
			'icon_svg' => '<svg><script>alert(1)</script></svg>',
		) );
		$this->assertWPError( $result );
		$this->assertSame( 'open_station_invalid_icon_svg', $result->get_error_code() );
	}

	/**
	 * @covers ::open_station_register_game
	 */
	public function test_register_converts_icon_svg_to_data_uri() {
		$this->assertTrue( $this->register_test_game( 'test-game', array(
			'icon_svg' => '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
		) ) );
		$entry = open_station_games_registry( 'test-game' );
		$this->assertStringStartsWith( 'data:image/svg+xml;base64,', $entry['icon'] );
	}

	/**
	 * @covers ::open_station_games_sanitize_score_columns
	 */
	public function test_score_columns_are_sanitized() {
		$columns = open_station_games_sanitize_score_columns( array(
			array( 'key' => 'score', 'label' => 'Score', 'type' => 'number' ),
			array( 'key' => 'Time!', 'type' => 'bogus' ),
			array( 'label' => 'No key' ),
			'not-an-array',
		) );
		$this->assertCount( 2, $columns );
		$this->assertSame( 'score', $columns[0]['key'] );
		// Invalid type falls back to number; missing label falls back
		// to the key; the key itself is slug-sanitized.
		$this->assertSame( 'time', $columns[1]['key'] );
		$this->assertSame( 'time', $columns[1]['label'] );
		$this->assertSame( 'number', $columns[1]['type'] );
	}

	/**
	 * @covers ::open_station_register_game
	 */
	public function test_register_fires_action() {
		$seen = null;
		add_action(
			'open_station_game_registered',
			static function ( $id, $entry ) use ( &$seen ) {
				$seen = array( $id, $entry );
			},
			10,
			2
		);
		$this->register_test_game();
		$this->assertNotNull( $seen );
		$this->assertSame( 'test-game', $seen[0] );
		$this->assertSame( 'Test Game', $seen[1]['title'] );
	}

	/**
	 * @covers ::open_station_games_is_registered
	 */
	public function test_is_registered_sees_registry_and_filter_entries() {
		$this->assertFalse( open_station_games_is_registered( 'test-game' ) );
		$this->register_test_game();
		$this->assertTrue( open_station_games_is_registered( 'test-game' ) );

		add_filter(
			'open_station_games',
			static function ( $games ) {
				$games[] = array( 'id' => 'filter-game', 'title' => 'Filtered' );
				return $games;
			}
		);
		$this->assertTrue( open_station_games_is_registered( 'filter-game' ) );
		$this->assertFalse( open_station_games_is_registered( 'unknown-game' ) );
	}

	/**
	 * @covers ::open_station_unregister_game
	 */
	public function test_unregister_removes_entry() {
		$this->register_test_game();
		$this->assertTrue( open_station_unregister_game( 'test-game' ) );
		$this->assertFalse( open_station_games_is_registered( 'test-game' ) );
		$this->assertFalse( open_station_unregister_game( 'test-game' ) );
	}

	/**
	 * @covers ::open_station_build_desktop_games_payload
	 */
	public function test_payload_shape() {
		$this->register_test_game( 'test-game', array(
			'description' => 'A test game.',
			'config'      => array( 'wordsUrl' => 'https://example.test/words.txt' ),
		) );
		$payload = open_station_build_desktop_games_payload();
		$entry   = null;
		foreach ( $payload as $row ) {
			if ( 'test-game' === $row['id'] ) {
				$entry = $row;
			}
		}
		$this->assertNotNull( $entry );
		$this->assertSame( 'Test Game', $entry['title'] );
		$this->assertSame( 'A test game.', $entry['description'] );
		$this->assertSame( 'https://example.test/words.txt', $entry['config']['wordsUrl'] );
		$this->assertSame( array( array( 'key' => 'score', 'label' => 'Score', 'type' => 'number' ) ), $entry['scoreColumns'] );
		$this->assertArrayHasKey( 'scriptUrl', $entry );
		$this->assertSame( 'test-game-script', $entry['scriptHandle'] );
	}

	/**
	 * @covers ::open_station_build_menu_payload
	 */
	public function test_menu_payload_carries_server_games_key() {
		$this->register_test_game();
		$payload = open_station_build_menu_payload();
		$this->assertArrayHasKey( 'serverGames', $payload );
		$ids = wp_list_pluck( $payload['serverGames'], 'id' );
		$this->assertContains( 'test-game', $ids );
	}
}
