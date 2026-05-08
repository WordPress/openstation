<?php
/**
 * Tests for the `nativePostsEnabled` field on `OsSettingsState`.
 *
 * The sanitizer is the gatekeeper between the JS layer and user meta —
 * a field that's not in its allow-list silently disappears on every
 * round-trip. This file guards against the per-user opt-in for the
 * native Posts window vanishing when, say, a future field rename
 * forgets to thread `nativePostsEnabled` through.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-posts-window
 */
class Tests_DesktopMode_PostsWindowSettings extends WP_UnitTestCase {

	/**
	 * As of 0.8.0 the native Posts window is the default — fresh
	 * installs should land on it, with the legacy iframe available
	 * as an opt-OUT. This guards against an accidental flip back to
	 * opt-in semantics.
	 *
	 * @covers ::desktop_mode_default_os_settings
	 */
	public function test_default_includes_native_posts_enabled() {
		$defaults = desktop_mode_default_os_settings();
		$this->assertArrayHasKey( 'nativePostsEnabled', $defaults );
		$this->assertTrue(
			$defaults['nativePostsEnabled'],
			'`nativePostsEnabled` defaults ON: the native Posts window is the canonical Desktop Mode experience; users explicitly toggle it OFF to fall back to the classic iframe.'
		);
	}

	/**
	 * @covers ::desktop_mode_sanitize_os_settings
	 */
	public function test_sanitize_keeps_true_value() {
		$clean = desktop_mode_sanitize_os_settings(
			array( 'nativePostsEnabled' => true )
		);
		$this->assertTrue( $clean['nativePostsEnabled'] );
	}

	/**
	 * @covers ::desktop_mode_sanitize_os_settings
	 */
	public function test_sanitize_keeps_false_value() {
		$clean = desktop_mode_sanitize_os_settings(
			array( 'nativePostsEnabled' => false )
		);
		$this->assertFalse( $clean['nativePostsEnabled'] );
	}

	/**
	 * @covers ::desktop_mode_sanitize_os_settings
	 */
	public function test_sanitize_coerces_truthy_strings() {
		$clean = desktop_mode_sanitize_os_settings(
			array( 'nativePostsEnabled' => '1' )
		);
		$this->assertTrue( $clean['nativePostsEnabled'] );
	}

	/**
	 * @covers ::desktop_mode_sanitize_os_settings
	 */
	public function test_sanitize_coerces_falsy_values() {
		$clean = desktop_mode_sanitize_os_settings(
			array( 'nativePostsEnabled' => 0 )
		);
		$this->assertFalse( $clean['nativePostsEnabled'] );

		$clean = desktop_mode_sanitize_os_settings(
			array( 'nativePostsEnabled' => '' )
		);
		$this->assertFalse( $clean['nativePostsEnabled'] );
	}

	/**
	 * @covers ::desktop_mode_sanitize_os_settings
	 */
	public function test_sanitize_falls_back_when_missing() {
		$clean = desktop_mode_sanitize_os_settings(
			array( 'wallpaper' => 'dark' )
		);
		$this->assertTrue(
			$clean['nativePostsEnabled'],
			'Missing field should fall back to the default — opt-OUT means the default is ON.'
		);
	}

	/**
	 * The regression this guards against: `desktop_mode_save_os_settings()`
	 * (REST POST handler) writes a sanitized payload to user meta, then
	 * `desktop_mode_get_os_settings()` (boot path / GET handler) reads
	 * it back. If the sanitizer drops the field, the user "saves" the
	 * toggle but it silently flips back off on the next page load.
	 *
	 * @covers ::desktop_mode_save_os_settings
	 * @covers ::desktop_mode_get_os_settings
	 */
	public function test_user_meta_round_trip_keeps_native_posts_enabled() {
		$user_id = self::factory()->user->create();
		desktop_mode_save_os_settings(
			$user_id,
			array(
				'wallpaper'          => 'dark',
				'nativePostsEnabled' => true,
			)
		);
		$loaded = desktop_mode_get_os_settings( $user_id );
		$this->assertTrue( $loaded['nativePostsEnabled'] );
	}

	/**
	 * Toggling off must persist too — explicit `false` should round-trip
	 * the same as `true`. (Tests the read-then-merge path; a previous
	 * implementation defaulted to off when the key was missing AND
	 * when the key was explicitly false, which was correct only by
	 * accident.)
	 *
	 * @covers ::desktop_mode_save_os_settings
	 * @covers ::desktop_mode_get_os_settings
	 */
	public function test_user_meta_round_trip_keeps_explicit_false() {
		$user_id = self::factory()->user->create();
		desktop_mode_save_os_settings(
			$user_id,
			array( 'nativePostsEnabled' => true )
		);
		desktop_mode_save_os_settings(
			$user_id,
			array( 'nativePostsEnabled' => false )
		);
		$loaded = desktop_mode_get_os_settings( $user_id );
		$this->assertFalse( $loaded['nativePostsEnabled'] );
	}
}
