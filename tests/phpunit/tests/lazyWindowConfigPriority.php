<?php

class Tests_OpenStation_LazyWindowConfigPriority extends WP_UnitTestCase {

	public function data_lazy_window_config_localizers() {
		return array(

			'games' => array( 'openstation_games_localize_config' ),
		);
	}

	public function test_config_attaches_before_the_payload_harvest( $localizer ) {
		$harvest = has_action( 'admin_enqueue_scripts', 'openstation_enqueue_assets' );

		$this->assertNotFalse( $harvest, 'The payload harvest must be hooked.' );

		if ( ! function_exists( $localizer ) ) {
			$this->markTestSkipped( "The {$localizer} module is not loaded in this environment." );
		}

		$priority = has_action( 'admin_enqueue_scripts', $localizer );

		$this->assertNotFalse( $priority, "{$localizer} must be hooked." );
		$this->assertLessThan(
			$harvest,
			$priority,
			"{$localizer} attaches config after the payload harvest at priority {$harvest}: on the lazy path its bundle ships with no config."
		);
	}
}
