<?php

class Tests_OpenStation_PwaForceReplaceSw extends WP_UnitTestCase {

	public function tear_down() {
		remove_all_filters( 'openstation_pwa_force_replace_sw' );
		parent::tear_down();
	}

	public function test_defaults_to_false() {
		$this->assertFalse( openstation_pwa_force_replace_sw() );
	}

	public function test_filter_can_opt_in() {
		add_filter( 'openstation_pwa_force_replace_sw', '__return_true' );
		$this->assertTrue( openstation_pwa_force_replace_sw() );
	}

	public function test_non_boolean_return_is_coerced() {
		add_filter(
			'openstation_pwa_force_replace_sw',
			static function () {
				return 1;
			}
		);
		$this->assertSame( true, openstation_pwa_force_replace_sw() );

		remove_all_filters( 'openstation_pwa_force_replace_sw' );

		add_filter(
			'openstation_pwa_force_replace_sw',
			static function () {
				return '';
			}
		);
		$this->assertSame( false, openstation_pwa_force_replace_sw() );
	}
}
