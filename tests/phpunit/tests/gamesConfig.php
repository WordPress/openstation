<?php
/**
 * Tests for the games framework config: the shared dictionary URL
 * and its injection into every game's payload `config`, plus the
 * built-in Alphabet Soup registration.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group desktop-mode-games
 */
class Tests_OpenStation_GamesConfig extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		set_current_screen( OPENSTATION_SHELL_SCREEN_ID );
		wp_set_current_user( self::$admin_id );
		openstation_flush_script_handle_registries();
	}

	public function tear_down() {
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );
		remove_all_filters( 'openstation_games_words_url' );
		remove_all_filters( 'openstation_shell_config' );
		foreach ( array( 'cfg-game', 'alphabet-soup' ) as $id ) {
			openstation_unregister_game( $id );
		}
		parent::tear_down();
	}

	private function payload_entry( $id ) {
		foreach ( openstation_build_desktop_games_payload() as $row ) {
			if ( $id === $row['id'] ) {
				return $row;
			}
		}
		return null;
	}

	/**
	 * @covers ::openstation_games_words_url
	 */
	public function test_words_url_points_at_the_shared_asset() {
		$url = openstation_games_words_url();
		$this->assertStringContainsString( 'assets/games/words.txt', $url );
		// The committed asset exists, so the URL must be cache-busted.
		$this->assertStringContainsString( 'ver=', $url );
	}

	/**
	 * @covers ::openstation_games_words_url
	 */
	public function test_words_url_is_filterable() {
		add_filter(
			'openstation_games_words_url',
			static function () {
				return 'https://example.test/custom-words.txt';
			}
		);
		$this->assertSame( 'https://example.test/custom-words.txt', openstation_games_words_url() );
	}

	/**
	 * @covers ::openstation_games_framework_config
	 */
	public function test_framework_config_is_injected_into_every_game() {
		openstation_register_game( 'cfg-game', array(
			'title'  => 'Config Game',
			'script' => 'cfg-game-script',
		) );
		$entry = $this->payload_entry( 'cfg-game' );
		$this->assertNotNull( $entry );
		$this->assertSame( openstation_games_words_url(), $entry['config']['wordsUrl'] );
	}

	/**
	 * @covers ::openstation_build_desktop_games_payload
	 */
	public function test_game_config_wins_over_framework_config() {
		openstation_register_game( 'cfg-game', array(
			'title'  => 'Config Game',
			'script' => 'cfg-game-script',
			'config' => array( 'wordsUrl' => 'https://example.test/own-words.txt' ),
		) );
		$entry = $this->payload_entry( 'cfg-game' );
		$this->assertNotNull( $entry );
		$this->assertSame( 'https://example.test/own-words.txt', $entry['config']['wordsUrl'] );
	}

	/**
	 * Regression: the boot-time shell config must carry the
	 * `serverGames` payload key — without it the games registry only
	 * fills after the first chromeless live-refresh and the Games
	 * hub boots empty.
	 *
	 * @covers ::openstation_enqueue_assets
	 */
	public function test_shell_config_ships_server_games_at_boot() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		openstation_register_game( 'cfg-game', array(
			'title'  => 'Config Game',
			'script' => 'cfg-game-script',
		) );

		$received = null;
		add_filter(
			'openstation_shell_config',
			function ( $config ) use ( &$received ) {
				$received = $config;
				return $config;
			}
		);

		openstation_enqueue_assets();

		$this->assertIsArray( $received );
		$this->assertArrayHasKey( 'serverGames', $received );
		$this->assertContains( 'cfg-game', wp_list_pluck( $received['serverGames'], 'id' ) );
	}

	/**
	 * @covers ::openstation_alphabet_soup_register
	 */
	public function test_alphabet_soup_registers_with_score_columns() {
		openstation_alphabet_soup_register();
		$this->assertTrue( openstation_games_is_registered( 'alphabet-soup' ) );
		$entry = openstation_games_registry( 'alphabet-soup' );
		$this->assertSame( 'os-game-alphabet-soup', $entry['script'] );
		$this->assertSame(
			array( 'score', 'mode', 'size', 'words', 'wpm', 'accuracy', 'streak', 'wave', 'time' ),
			wp_list_pluck( $entry['score_columns'], 'key' )
		);
		$this->assertStringStartsWith( 'data:image/svg+xml;base64,', $entry['icon'] );
		// The payload hands it the framework dictionary.
		$payload = $this->payload_entry( 'alphabet-soup' );
		$this->assertNotNull( $payload );
		$this->assertSame( openstation_games_words_url(), $payload['config']['wordsUrl'] );
	}
}
