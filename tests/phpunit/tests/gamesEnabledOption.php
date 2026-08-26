<?php
/**
 * Tests for the site-wide games kill switch: the `games` extended
 * option, `openstation_games_enabled()` + its filter, and the
 * `serverGames` payload gate.
 *
 * The framework is opt-in (option off by default); the test-suite
 * bootstrap force-enables it via the `openstation_games_enabled`
 * filter so the module loads for the games test classes. This class
 * removes that filter in `set_up()` to test the real option-driven
 * behavior — the test framework restores hooks after every test.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group desktop-mode-games
 */
class Tests_OpenStation_GamesEnabledOption extends WP_UnitTestCase {

	public function set_up() {
		parent::set_up();
		// Strip the suite-wide force-enable (see tests/phpunit/bootstrap.php)
		// so these tests see the shipped default. Restored automatically.
		remove_all_filters( 'openstation_games_enabled' );
	}

	public function tear_down() {
		delete_option( OPENSTATION_EXTENDED_OPTIONS_KEY );
		openstation_unregister_game( 'kill-switch-game' );
		parent::tear_down();
	}

	/**
	 * @covers ::openstation_get_extended_options
	 * @covers ::openstation_games_enabled
	 */
	public function test_games_default_to_disabled() {
		$options = openstation_get_extended_options();
		$this->assertFalse( $options['games'] );
		$this->assertFalse( openstation_games_enabled() );
	}

	/**
	 * @covers ::openstation_save_extended_options
	 * @covers ::openstation_get_extended_options
	 */
	public function test_explicit_true_survives_the_default_being_false() {
		openstation_save_extended_options( array( 'games' => true ) );
		$options = openstation_get_extended_options();
		$this->assertTrue( $options['games'] );
	}

	/**
	 * A save payload that omits a key must not reset it — protects an
	 * explicit opt-in from stale clients that predate the key.
	 *
	 * @covers ::openstation_save_extended_options
	 */
	public function test_save_without_the_key_keeps_the_stored_value() {
		openstation_save_extended_options( array( 'games' => true ) );
		openstation_save_extended_options( array( 'media_library_enhanced' => true ) );

		$options = openstation_get_extended_options();
		$this->assertTrue( $options['games'] );
		$this->assertTrue( $options['media_library_enhanced'] );
	}

	/**
	 * @covers ::openstation_games_enabled
	 */
	public function test_enabled_reflects_the_option() {
		openstation_save_extended_options( array( 'games' => true ) );
		$this->assertTrue( openstation_games_enabled() );

		openstation_save_extended_options( array( 'games' => false ) );
		$this->assertFalse( openstation_games_enabled() );
	}

	/**
	 * @covers ::openstation_games_enabled
	 */
	public function test_filter_overrides_the_option_both_ways() {
		add_filter( 'openstation_games_enabled', '__return_true' );
		$this->assertTrue( openstation_games_enabled() );
		remove_filter( 'openstation_games_enabled', '__return_true' );

		openstation_save_extended_options( array( 'games' => true ) );
		add_filter( 'openstation_games_enabled', '__return_false' );
		$this->assertFalse( openstation_games_enabled() );
	}

	/**
	 * @covers ::openstation_build_desktop_games_payload
	 */
	public function test_payload_is_empty_while_disabled() {
		openstation_register_game(
			'kill-switch-game',
			array(
				'title'  => 'Kill Switch',
				'script' => 'kill-switch-game-script',
			)
		);

		$this->assertSame( array(), openstation_build_desktop_games_payload() );

		openstation_save_extended_options( array( 'games' => true ) );
		$this->assertNotEmpty( openstation_build_desktop_games_payload() );

		openstation_save_extended_options( array( 'games' => false ) );
		$this->assertSame( array(), openstation_build_desktop_games_payload() );
	}
}
