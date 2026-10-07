<?php

class Tests_OpenStation_GamesStyleHandles extends WP_UnitTestCase {

	public function set_up() {
		parent::set_up();
		if ( ! function_exists( 'openstation_games_style_handles' ) ) {
			$this->markTestSkipped( 'The games module is not loaded on this install.' );
		}
	}

	public function tear_down() {

		openstation_games_style_handles( array() );
		parent::tear_down();
	}

	public function test_it_stores_and_returns_the_handles() {
		openstation_games_style_handles( array( 'desktop-mode-games', 'os-game-inkfall' ) );

		$this->assertSame(
			array( 'desktop-mode-games', 'os-game-inkfall' ),
			openstation_games_style_handles()
		);
	}

	public function test_it_de_duplicates_and_drops_empties() {
		openstation_games_style_handles(
			array( 'desktop-mode-games', '', 'os-game-inkfall', 'desktop-mode-games' )
		);

		$this->assertSame(
			array( 'desktop-mode-games', 'os-game-inkfall' ),
			openstation_games_style_handles()
		);
	}

	public function test_resolved_handles_reach_the_deferred_style_map() {
		wp_register_style( 'os-test-game-sheet', 'https://example.org/game.css', array(), '1' );
		openstation_games_style_handles( array( 'os-test-game-sheet' ) );

		$map = openstation_build_deferred_styles( openstation_games_style_handles() );

		$this->assertArrayHasKey( 'os-test-game-sheet', $map );

		$this->assertStringStartsWith(
			'https://example.org/game.css',
			$map['os-test-game-sheet']['url']
		);
	}
}
