<?php
/**
 * Tests for the mascot's server surface: the configuration shipped
 * to the shell (`desktop_mode_mascot_config()` and its filter) and
 * the `mascotEnabled` per-user preference's trip through the OS
 * Settings sanitizer.
 *
 * The client re-clamps everything, so the job here is narrower but
 * load-bearing: the config must always be an array with both
 * sections present, and a plugin filter must be able to reach every
 * knob without the shell dropping the change on the floor.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-mascot
 */
class Tests_DesktopMode_Mascot extends WP_UnitTestCase {

	public function tear_down() {
		remove_all_filters( 'desktop_mode_mascot_config' );
		parent::tear_down();
	}

	/**
	 * @covers ::desktop_mode_mascot_config
	 */
	public function test_config_has_both_sections() {
		$config = desktop_mode_mascot_config();
		$this->assertIsArray( $config );
		$this->assertArrayHasKey( 'appearance', $config );
		$this->assertArrayHasKey( 'physics', $config );
	}

	/**
	 * The shape has to match `MascotConfig` in
	 * `src/mascot/types.ts`. A key that exists on one side only is
	 * silently ignored by the sanitizer, so the mismatch would never
	 * surface as an error — just as a knob that does nothing.
	 *
	 * @covers ::desktop_mode_mascot_config
	 */
	public function test_config_carries_every_documented_key() {
		$config = desktop_mode_mascot_config();

		$appearance = array(
			'radius',
			'bodyColor',
			'bodyAlpha',
			'hueStart',
			'hueSpan',
			'hueDrift',
			'saturation',
			'lightness',
			'iridescence',
			'outlineWidth',
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

	/**
	 * @covers ::desktop_mode_mascot_config
	 */
	public function test_config_is_json_encodable() {
		// It travels to the browser inside the shell config blob; a
		// value `wp_json_encode()` chokes on would break the whole
		// payload, not just the mascot.
		$this->assertIsString( wp_json_encode( desktop_mode_mascot_config() ) );
	}

	/**
	 * @covers ::desktop_mode_mascot_config
	 */
	public function test_filter_can_retune_the_mascot() {
		add_filter(
			'desktop_mode_mascot_config',
			static function ( $config ) {
				$config['appearance']['hueStart']    = 170;
				$config['physics']['magnetStrength'] = 3400;
				return $config;
			}
		);

		$config = desktop_mode_mascot_config();
		$this->assertSame( 170, $config['appearance']['hueStart'] );
		$this->assertSame( 3400, $config['physics']['magnetStrength'] );
	}

	/**
	 * A filter that returns something other than an array must not
	 * poison the shell config — fall back to the defaults.
	 *
	 * @covers ::desktop_mode_mascot_config
	 */
	public function test_non_array_filter_return_falls_back_to_defaults() {
		add_filter( 'desktop_mode_mascot_config', '__return_false' );

		$config = desktop_mode_mascot_config();
		$this->assertIsArray( $config );
		$this->assertArrayHasKey( 'appearance', $config );
	}

	/**
	 * @covers ::desktop_mode_default_os_settings
	 */
	public function test_mascot_is_off_by_default() {
		$defaults = desktop_mode_default_os_settings();
		$this->assertArrayHasKey( 'mascotEnabled', $defaults );
		$this->assertFalse( $defaults['mascotEnabled'] );
	}

	/**
	 * The wallpaper context-menu toggle writes this key. If the
	 * sanitizer's allow-list misses it, the preference silently
	 * reverts on every page load.
	 *
	 * @covers ::desktop_mode_sanitize_os_settings
	 */
	public function test_sanitize_round_trips_mascot_enabled() {
		$on = desktop_mode_sanitize_os_settings( array( 'mascotEnabled' => true ) );
		$this->assertTrue( $on['mascotEnabled'] );

		$off = desktop_mode_sanitize_os_settings( array( 'mascotEnabled' => false ) );
		$this->assertFalse( $off['mascotEnabled'] );
	}

	/**
	 * @covers ::desktop_mode_sanitize_os_settings
	 */
	public function test_sanitize_coerces_truthy_mascot_values() {
		$clean = desktop_mode_sanitize_os_settings( array( 'mascotEnabled' => '1' ) );
		$this->assertTrue( $clean['mascotEnabled'] );

		$clean = desktop_mode_sanitize_os_settings( array( 'mascotEnabled' => '' ) );
		$this->assertFalse( $clean['mascotEnabled'] );
	}

	/**
	 * @covers ::desktop_mode_sanitize_os_settings
	 */
	public function test_sanitize_defaults_mascot_when_absent() {
		$clean = desktop_mode_sanitize_os_settings( array() );
		$this->assertArrayHasKey( 'mascotEnabled', $clean );
		$this->assertFalse( $clean['mascotEnabled'] );
	}

	/**
	 * @covers ::desktop_mode_get_os_settings
	 */
	public function test_preference_persists_to_user_meta() {
		$user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $user_id );

		$clean = desktop_mode_sanitize_os_settings( array( 'mascotEnabled' => true ) );
		update_user_meta( $user_id, 'desktop_mode_os_settings', $clean );

		$stored = desktop_mode_get_os_settings( $user_id );
		$this->assertTrue( $stored['mascotEnabled'] );
	}
}
