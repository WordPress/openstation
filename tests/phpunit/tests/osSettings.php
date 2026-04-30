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
	// submenuRenderer — same regression class as desktopLayout:
	// a sanitize allow-list that drops unknown fields silently
	// breaks the JS-side persistence on every refresh.
	// ----------------------------------------------------------

	/**
	 * @covers ::desktop_mode_default_os_settings
	 */
	public function test_default_includes_submenu_renderer() {
		$defaults = desktop_mode_default_os_settings();
		$this->assertArrayHasKey( 'submenuRenderer', $defaults );
		$this->assertSame( 'default', $defaults['submenuRenderer'] );
	}

	/**
	 * Renderer ids are JS-side runtime registrations — we don't gate
	 * on a server allow-list because plugin renderers register
	 * asynchronously. We DO require sanitize_key()-clean ids; bad
	 * input falls back to the default.
	 *
	 * @covers ::desktop_mode_sanitize_os_settings
	 */
	public function test_sanitize_keeps_well_formed_submenu_renderer() {
		$clean = desktop_mode_sanitize_os_settings(
			array( 'submenuRenderer' => 'arc-popover' )
		);
		$this->assertSame( 'arc-popover', $clean['submenuRenderer'] );
	}

	/**
	 * @covers ::desktop_mode_sanitize_os_settings
	 */
	public function test_sanitize_strips_invalid_submenu_renderer() {
		$clean = desktop_mode_sanitize_os_settings(
			array( 'submenuRenderer' => 'BAD ID WITH SPACES' )
		);
		// `sanitize_key()` rejects spaces and uppercase — the bad
		// input either becomes empty (falls back to default) or
		// becomes a slug (`bad-id-with-spaces`). Either way the
		// caller's intended-but-illegal id is rejected.
		$this->assertNotSame( 'BAD ID WITH SPACES', $clean['submenuRenderer'] );
	}

	/**
	 * @covers ::desktop_mode_save_os_settings
	 * @covers ::desktop_mode_get_os_settings
	 */
	public function test_user_meta_round_trip_keeps_submenu_renderer() {
		$user_id = self::factory()->user->create();
		desktop_mode_save_os_settings(
			$user_id,
			array( 'submenuRenderer' => 'cards' )
		);
		$loaded = desktop_mode_get_os_settings( $user_id );
		$this->assertSame( 'cards', $loaded['submenuRenderer'] );
	}
}
