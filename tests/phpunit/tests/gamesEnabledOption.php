<?php
/**
 * Tests for the site-wide games kill switch: the `games` extended
 * option, `desktop_mode_games_enabled()` + its filter, and the
 * `serverGames` payload gate.
 *
 * The framework is opt-in (option off by default); the test-suite
 * bootstrap force-enables it via the `desktop_mode_games_enabled`
 * filter so the module loads for the games test classes. This class
 * removes that filter in `set_up()` to test the real option-driven
 * behavior — the test framework restores hooks after every test.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-games
 */
class Tests_DesktopMode_GamesEnabledOption extends WP_UnitTestCase {

	public function set_up() {
		parent::set_up();
		// Strip the suite-wide force-enable (see tests/phpunit/bootstrap.php)
		// so these tests see the shipped default. Restored automatically.
		remove_all_filters( 'desktop_mode_games_enabled' );
	}

	public function tear_down() {
		delete_option( DESKTOP_MODE_EXTENDED_OPTIONS_KEY );
		desktop_mode_unregister_game( 'kill-switch-game' );
		parent::tear_down();
	}

	/**
	 * @covers ::desktop_mode_get_extended_options
	 * @covers ::desktop_mode_games_enabled
	 */
	public function test_games_default_to_disabled() {
		$options = desktop_mode_get_extended_options();
		$this->assertFalse( $options['games'] );
		$this->assertFalse( desktop_mode_games_enabled() );
	}

	/**
	 * @covers ::desktop_mode_save_extended_options
	 * @covers ::desktop_mode_get_extended_options
	 */
	public function test_explicit_true_survives_the_default_being_false() {
		desktop_mode_save_extended_options( array( 'games' => true ) );
		$options = desktop_mode_get_extended_options();
		$this->assertTrue( $options['games'] );
	}

	/**
	 * A save payload that omits a key must not reset it — protects an
	 * explicit opt-in from stale clients that predate the key.
	 *
	 * @covers ::desktop_mode_save_extended_options
	 */
	public function test_save_without_the_key_keeps_the_stored_value() {
		desktop_mode_save_extended_options( array( 'games' => true ) );
		desktop_mode_save_extended_options( array( 'media_library_enhanced' => true ) );

		$options = desktop_mode_get_extended_options();
		$this->assertTrue( $options['games'] );
		$this->assertTrue( $options['media_library_enhanced'] );
	}

	/**
	 * @covers ::desktop_mode_games_enabled
	 */
	public function test_enabled_reflects_the_option() {
		desktop_mode_save_extended_options( array( 'games' => true ) );
		$this->assertTrue( desktop_mode_games_enabled() );

		desktop_mode_save_extended_options( array( 'games' => false ) );
		$this->assertFalse( desktop_mode_games_enabled() );
	}

	/**
	 * @covers ::desktop_mode_games_enabled
	 */
	public function test_filter_overrides_the_option_both_ways() {
		add_filter( 'desktop_mode_games_enabled', '__return_true' );
		$this->assertTrue( desktop_mode_games_enabled() );
		remove_filter( 'desktop_mode_games_enabled', '__return_true' );

		desktop_mode_save_extended_options( array( 'games' => true ) );
		add_filter( 'desktop_mode_games_enabled', '__return_false' );
		$this->assertFalse( desktop_mode_games_enabled() );
	}

	/**
	 * @covers ::desktop_mode_build_desktop_games_payload
	 */
	public function test_payload_is_empty_while_disabled() {
		desktop_mode_register_game(
			'kill-switch-game',
			array(
				'title'  => 'Kill Switch',
				'script' => 'kill-switch-game-script',
			)
		);

		$this->assertSame( array(), desktop_mode_build_desktop_games_payload() );

		desktop_mode_save_extended_options( array( 'games' => true ) );
		$this->assertNotEmpty( desktop_mode_build_desktop_games_payload() );

		desktop_mode_save_extended_options( array( 'games' => false ) );
		$this->assertSame( array(), desktop_mode_build_desktop_games_payload() );
	}
}
