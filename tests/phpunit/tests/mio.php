<?php

class Tests_OpenStation_Mio extends WP_UnitTestCase {

	public function tear_down() {
		remove_all_filters( 'openstation_mio_config' );
		parent::tear_down();
	}

	public function test_config_has_both_sections() {
		$config = openstation_mio_config();
		$this->assertIsArray( $config );
		$this->assertArrayHasKey( 'appearance', $config );
		$this->assertArrayHasKey( 'physics', $config );
	}

	public function test_config_carries_every_documented_key() {
		$config = openstation_mio_config();

		$appearance = array(
			'radius',
			'bodyColor',
			'bodyAlpha',
			'hueStart',
			'hueSpan',
			'hueDrift',
			'hueLoop',
			'hueAngle',
			'hueSpin',
			'saturation',
			'lightness',
			'iridescence',
			'outlineWidth',
			'linerWidth',
			'linerColor',
			'glow',
			'glowBlur',
			'eyeColor',
			'eyeScale',
		);
		foreach ( $appearance as $key ) {
			$this->assertArrayHasKey( $key, $config['appearance'], "appearance.{$key}" );
		}

		$physics = array(
			'points',
			'shapePreset',
			'shapeLobes',
			'shapeAmount',
			'shapeAngle',
			'shapeShuffle',
			'radialStiffness',
			'edgeStiffness',
			'bendStiffness',
			'pressure',
			'damping',
			'airDamping',
			'magnetStrength',
			'magnetRange',
			'magnetGrip',
			'magnetDamping',
			'floatAmplitude',
			'floatSpeed',
			'idleWobble',
			'idleWobbleSpeed',
			'speedStretch',
			'friction',
			'restitution',
			'dragStiffness',
			'throwBoost',
			'minStretch',
			'maxStretch',
			'minAngularGap',
			'limitIterations',
			'dragMaxAccel',
			'subStep',
			'maxSubSteps',
		);
		foreach ( $physics as $key ) {
			$this->assertArrayHasKey( $key, $config['physics'], "physics.{$key}" );
		}
	}

	public function test_config_is_json_encodable() {

		$this->assertIsString( wp_json_encode( openstation_mio_config() ) );
	}

	public function test_filter_can_retune_the_mio() {
		add_filter(
			'openstation_mio_config',
			static function ( $config ) {
				$config['appearance']['hueStart']    = 170;
				$config['physics']['magnetStrength'] = 3400;
				return $config;
			}
		);

		$config = openstation_mio_config();
		$this->assertSame( 170, $config['appearance']['hueStart'] );
		$this->assertSame( 3400, $config['physics']['magnetStrength'] );
	}

	public function test_non_array_filter_return_falls_back_to_defaults() {
		add_filter( 'openstation_mio_config', '__return_false' );

		$config = openstation_mio_config();
		$this->assertIsArray( $config );
		$this->assertArrayHasKey( 'appearance', $config );
	}

	public function test_mio_is_off_by_default() {
		$defaults = openstation_default_os_settings();
		$this->assertArrayHasKey( 'mioEnabled', $defaults );
		$this->assertFalse( $defaults['mioEnabled'] );
	}

	public function test_sanitize_round_trips_mio_enabled() {
		$on = openstation_sanitize_os_settings( array( 'mioEnabled' => true ) );
		$this->assertTrue( $on['mioEnabled'] );

		$off = openstation_sanitize_os_settings( array( 'mioEnabled' => false ) );
		$this->assertFalse( $off['mioEnabled'] );
	}

	public function test_sanitize_coerces_truthy_mio_values() {
		$clean = openstation_sanitize_os_settings( array( 'mioEnabled' => '1' ) );
		$this->assertTrue( $clean['mioEnabled'] );

		$clean = openstation_sanitize_os_settings( array( 'mioEnabled' => '' ) );
		$this->assertFalse( $clean['mioEnabled'] );
	}

	public function test_sanitize_defaults_mio_when_absent() {
		$clean = openstation_sanitize_os_settings( array() );
		$this->assertArrayHasKey( 'mioEnabled', $clean );
		$this->assertFalse( $clean['mioEnabled'] );
	}

	public function test_preference_persists_to_user_meta() {
		$user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $user_id );

		$clean = openstation_sanitize_os_settings( array( 'mioEnabled' => true ) );
		update_user_meta( $user_id, 'desktop_mode_os_settings', $clean );

		$stored = openstation_get_os_settings( $user_id );
		$this->assertTrue( $stored['mioEnabled'] );
	}

	public function test_look_persists_to_user_meta() {
		$user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $user_id );

		$clean = openstation_sanitize_os_settings(
			array(
				'mioStyle' => array(
					'appearance' => array( 'glow' => 2.5 ),
					'physics'    => array( 'shapePreset' => 'star' ),
				),
			)
		);
		update_user_meta( $user_id, 'desktop_mode_os_settings', $clean );

		$stored = openstation_get_os_settings( $user_id );
		$this->assertSame( 2.5, $stored['mioStyle']['appearance']['glow'] );
		$this->assertSame( 'star', $stored['mioStyle']['physics']['shapePreset'] );
	}

	public function test_sanitize_defaults_look_when_absent() {
		$clean = openstation_sanitize_os_settings( array() );
		$this->assertSame(
			array(
				'appearance' => array(),
				'physics'    => array(),
			),
			$clean['mioStyle']
		);
	}

	public function test_sanitize_look_keeps_known_keys() {
		$clean = openstation_sanitize_mio_look(
			array(
				'appearance' => array(
					'glow'      => 1.75,
					'hueStart'  => 210,
					'hueLoop'   => false,
					'bodyColor' => '#ff00aa',
				),
				'physics'    => array(
					'shapePreset' => 'heart',
					'shapeAmount' => 0.8,
					'idleWobble'  => 0,
				),
			)
		);

		$this->assertSame( 1.75, $clean['appearance']['glow'] );
		$this->assertSame( 210, $clean['appearance']['hueStart'] );
		$this->assertFalse( $clean['appearance']['hueLoop'] );
		$this->assertSame( '#ff00aa', $clean['appearance']['bodyColor'] );
		$this->assertSame( 'heart', $clean['physics']['shapePreset'] );
		$this->assertSame( 0.8, $clean['physics']['shapeAmount'] );
		$this->assertSame( 0, $clean['physics']['idleWobble'] );
	}

	public function test_sanitize_look_drops_unknown_keys() {
		$clean = openstation_sanitize_mio_look(
			array(
				'appearance' => array(
					'glow'      => 1,
					'notAThing' => 'x',
				),
				'physics'    => array(
					'shapePreset'     => 'star',
					'radialStiffness' => 9000,
					'pressure'        => 0,
					'damping'         => 0,
				),
			)
		);

		$this->assertSame( array( 'glow' => 1 ), $clean['appearance'] );
		$this->assertSame( array( 'shapePreset' => 'star' ), $clean['physics'] );
	}

	public function test_sanitize_look_survives_nonsense() {
		foreach ( array( null, 'nope', 42, array( 'appearance' => 'nope' ) ) as $raw ) {
			$this->assertSame(
				array(
					'appearance' => array(),
					'physics'    => array(),
				),
				openstation_sanitize_mio_look( $raw )
			);
		}
	}

	public function test_sanitize_look_drops_non_finite_numbers() {
		$clean = openstation_sanitize_mio_look(
			array(
				'appearance' => array(
					'glow'       => INF,
					'saturation' => NAN,
					'lightness'  => 0.5,
				),
			)
		);
		$this->assertSame( array( 'lightness' => 0.5 ), $clean['appearance'] );
	}

	public function test_look_whitelists_mirror_the_config() {
		$config = openstation_mio_config();

		foreach ( openstation_mio_look_appearance_keys() as $key ) {
			$this->assertArrayHasKey(
				$key,
				$config['appearance'],
				"Appearance key {$key} is storable but not configurable."
			);
		}
		foreach ( openstation_mio_look_physics_keys() as $key ) {
			$this->assertArrayHasKey(
				$key,
				$config['physics'],
				"Look-physics key {$key} is storable but not configurable."
			);
		}
	}
}
