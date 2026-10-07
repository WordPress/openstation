<?php

class Tests_OpenStation_GamesEnabledOption extends WP_UnitTestCase {

	public function set_up() {
		parent::set_up();

		remove_all_filters( 'openstation_games_enabled' );
	}

	public function tear_down() {
		delete_option( OPENSTATION_EXTENDED_OPTIONS_KEY );
		openstation_unregister_game( 'kill-switch-game' );
		parent::tear_down();
	}

	public function test_games_default_to_disabled() {
		$options = openstation_get_extended_options();
		$this->assertFalse( $options['games'] );
		$this->assertFalse( openstation_games_enabled() );
	}

	public function test_explicit_true_survives_the_default_being_false() {
		openstation_save_extended_options( array( 'games' => true ) );
		$options = openstation_get_extended_options();
		$this->assertTrue( $options['games'] );
	}

	public function test_save_without_the_key_keeps_the_stored_value() {
		openstation_save_extended_options( array( 'games' => true ) );
		openstation_save_extended_options( array( 'media_library_enhanced' => true ) );

		$options = openstation_get_extended_options();
		$this->assertTrue( $options['games'] );
		$this->assertTrue( $options['media_library_enhanced'] );
	}

	public function test_enabled_reflects_the_option() {
		openstation_save_extended_options( array( 'games' => true ) );
		$this->assertTrue( openstation_games_enabled() );

		openstation_save_extended_options( array( 'games' => false ) );
		$this->assertFalse( openstation_games_enabled() );
	}

	public function test_filter_overrides_the_option_both_ways() {
		add_filter( 'openstation_games_enabled', '__return_true' );
		$this->assertTrue( openstation_games_enabled() );
		remove_filter( 'openstation_games_enabled', '__return_true' );

		openstation_save_extended_options( array( 'games' => true ) );
		add_filter( 'openstation_games_enabled', '__return_false' );
		$this->assertFalse( openstation_games_enabled() );
	}

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
