<?php
/**
 * Tests for `desktop_mode_sanitize_os_settings()` — the gatekeeper
 * between the JS layer and user meta. A field that's not in the
 * sanitizer's allow-list silently disappears on every round-trip,
 * which is the bug class this file is meant to catch.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-os-settings
 */
class Tests_DesktopMode_OsSettings extends WP_UnitTestCase {

	/**
	 * @covers ::desktop_mode_default_os_settings
	 */
	public function test_default_includes_desktop_layout() {
		$defaults = desktop_mode_default_os_settings();
		$this->assertArrayHasKey( 'desktopLayout', $defaults );
		$this->assertSame( 'classic', $defaults['desktopLayout'] );
	}

	/**
	 * @covers ::desktop_mode_sanitize_os_settings
	 */
	public function test_sanitize_keeps_known_layout_value() {
		foreach ( array( 'classic', 'unified', 'spatial' ) as $layout ) {
			$clean = desktop_mode_sanitize_os_settings( array( 'desktopLayout' => $layout ) );
			$this->assertSame( $layout, $clean['desktopLayout'], "layout '{$layout}' should round-trip" );
		}
	}

	/**
	 * @covers ::desktop_mode_sanitize_os_settings
	 */
	public function test_sanitize_falls_back_to_default_for_unknown_layout() {
		$clean = desktop_mode_sanitize_os_settings( array( 'desktopLayout' => 'invalid-mode' ) );
		$this->assertSame( 'classic', $clean['desktopLayout'] );
	}

	/**
	 * @covers ::desktop_mode_sanitize_os_settings
	 */
	public function test_sanitize_falls_back_when_layout_missing() {
		$clean = desktop_mode_sanitize_os_settings( array( 'wallpaper' => 'dark' ) );
		$this->assertSame( 'classic', $clean['desktopLayout'] );
	}

	/**
	 * Round-trip via user meta: a real `update_user_meta` write
	 * followed by `get_user_meta` must preserve `desktopLayout`.
	 * This is the regression that drove the fix — the JS layer was
	 * silently re-defaulting to `classic` on refresh because the
	 * sanitizer was dropping the field.
	 *
	 * @covers ::desktop_mode_save_os_settings
	 * @covers ::desktop_mode_get_os_settings
	 */
	public function test_user_meta_round_trip_keeps_desktop_layout() {
		$user_id = self::factory()->user->create();
		desktop_mode_save_os_settings(
			$user_id,
			array(
				'wallpaper'     => 'dark',
				'desktopLayout' => 'spatial',
			)
		);
		$loaded = desktop_mode_get_os_settings( $user_id );
		$this->assertSame( 'spatial', $loaded['desktopLayout'] );
	}


	// ----------------------------------------------------------
	// dockRailRenderer — renderers register at runtime from JS,
	// so the sanitize step accepts any sanitize_key()-clean id;
	// resolution falls back to `'default'` at use time.
	// ----------------------------------------------------------

	/**
	 * @covers ::desktop_mode_default_os_settings
	 */
	public function test_default_includes_dock_rail_renderer() {
		$defaults = desktop_mode_default_os_settings();
		$this->assertArrayHasKey( 'dockRailRenderer', $defaults );
		$this->assertSame( 'default', $defaults['dockRailRenderer'] );
	}

	/**
	 * @covers ::desktop_mode_sanitize_os_settings
	 */
	public function test_sanitize_keeps_well_formed_dock_rail_renderer() {
		$clean = desktop_mode_sanitize_os_settings(
			array( 'dockRailRenderer' => 'my-ring' )
		);
		$this->assertSame( 'my-ring', $clean['dockRailRenderer'] );
	}

	/**
	 * @covers ::desktop_mode_save_os_settings
	 * @covers ::desktop_mode_get_os_settings
	 */
	public function test_user_meta_round_trip_keeps_dock_rail_renderer() {
		$user_id = self::factory()->user->create();
		desktop_mode_save_os_settings(
			$user_id,
			array( 'dockRailRenderer' => 'fan' )
		);
		$loaded = desktop_mode_get_os_settings( $user_id );
		$this->assertSame( 'fan', $loaded['dockRailRenderer'] );
	}

	/**
	 * @covers ::desktop_mode_default_os_settings
	 */
	public function test_default_ai_transport_is_off() {
		$defaults = desktop_mode_default_os_settings();
		$this->assertArrayHasKey( 'transport', $defaults['ai'] );
		$this->assertSame( 'off', $defaults['ai']['transport'] );
	}

	/**
	 * @covers ::desktop_mode_sanitize_os_settings
	 */
	public function test_sanitize_keeps_known_ai_transport() {
		$clean = desktop_mode_sanitize_os_settings(
			array( 'ai' => array( 'transport' => 'sse' ) )
		);
		$this->assertSame( 'sse', $clean['ai']['transport'] );
	}

	/**
	 * @covers ::desktop_mode_sanitize_os_settings
	 */
	public function test_sanitize_rejects_unknown_ai_transport() {
		$clean = desktop_mode_sanitize_os_settings(
			array( 'ai' => array( 'transport' => 'websocket' ) )
		);
		$this->assertSame( 'off', $clean['ai']['transport'] );
	}
}
