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
 * @group openstation
 * @group os-posts-window
 */
class Tests_OpenStation_PostsWindowSettings extends WP_UnitTestCase {

	/**
	 * The native Posts window is opt-in Beta — fresh
	 * installs land on the classic iframe and users explicitly turn
	 * the native window ON. This guards against an accidental flip
	 * back to opt-out (default ON) semantics.
	 *
	 * @covers ::open_station_default_os_settings
	 */
	public function test_default_includes_native_posts_enabled() {
		$defaults = open_station_default_os_settings();
		$this->assertArrayHasKey( 'nativePostsEnabled', $defaults );
		$this->assertFalse(
			$defaults['nativePostsEnabled'],
			'`nativePostsEnabled` defaults OFF: the native Posts window is opt-in Beta; users explicitly toggle it ON to replace the classic iframe.'
		);
	}

	/**
	 * @covers ::open_station_sanitize_os_settings
	 */
	public function test_sanitize_keeps_true_value() {
		$clean = open_station_sanitize_os_settings(
			array( 'nativePostsEnabled' => true )
		);
		$this->assertTrue( $clean['nativePostsEnabled'] );
	}

	/**
	 * @covers ::open_station_sanitize_os_settings
	 */
	public function test_sanitize_keeps_false_value() {
		$clean = open_station_sanitize_os_settings(
			array( 'nativePostsEnabled' => false )
		);
		$this->assertFalse( $clean['nativePostsEnabled'] );
	}

	/**
	 * @covers ::open_station_sanitize_os_settings
	 */
	public function test_sanitize_coerces_truthy_strings() {
		$clean = open_station_sanitize_os_settings(
			array( 'nativePostsEnabled' => '1' )
		);
		$this->assertTrue( $clean['nativePostsEnabled'] );
	}

	/**
	 * @covers ::open_station_sanitize_os_settings
	 */
	public function test_sanitize_coerces_falsy_values() {
		$clean = open_station_sanitize_os_settings(
			array( 'nativePostsEnabled' => 0 )
		);
		$this->assertFalse( $clean['nativePostsEnabled'] );

		$clean = open_station_sanitize_os_settings(
			array( 'nativePostsEnabled' => '' )
		);
		$this->assertFalse( $clean['nativePostsEnabled'] );
	}

	/**
	 * @covers ::open_station_sanitize_os_settings
	 */
	public function test_sanitize_falls_back_when_missing() {
		$clean = open_station_sanitize_os_settings(
			array( 'wallpaper' => 'dark' )
		);
		$this->assertFalse(
			$clean['nativePostsEnabled'],
			'Missing field should fall back to the default — opt-in Beta means the default is OFF.'
		);
	}

	/**
	 * The regression this guards against: `open_station_save_os_settings()`
	 * (REST POST handler) writes a sanitized payload to user meta, then
	 * `open_station_get_os_settings()` (boot path / GET handler) reads
	 * it back. If the sanitizer drops the field, the user "saves" the
	 * toggle but it silently flips back off on the next page load.
	 *
	 * @covers ::open_station_save_os_settings
	 * @covers ::open_station_get_os_settings
	 */
	public function test_user_meta_round_trip_keeps_native_posts_enabled() {
		$user_id = self::factory()->user->create();
		open_station_save_os_settings(
			$user_id,
			array(
				'wallpaper'          => 'dark',
				'nativePostsEnabled' => true,
			)
		);
		$loaded = open_station_get_os_settings( $user_id );
		$this->assertTrue( $loaded['nativePostsEnabled'] );
	}

	/**
	 * Toggling off must persist too — explicit `false` should round-trip
	 * the same as `true`. (Tests the read-then-merge path; a previous
	 * implementation defaulted to off when the key was missing AND
	 * when the key was explicitly false, which was correct only by
	 * accident.)
	 *
	 * @covers ::open_station_save_os_settings
	 * @covers ::open_station_get_os_settings
	 */
	public function test_user_meta_round_trip_keeps_explicit_false() {
		$user_id = self::factory()->user->create();
		open_station_save_os_settings(
			$user_id,
			array( 'nativePostsEnabled' => true )
		);
		open_station_save_os_settings(
			$user_id,
			array( 'nativePostsEnabled' => false )
		);
		$loaded = open_station_get_os_settings( $user_id );
		$this->assertFalse( $loaded['nativePostsEnabled'] );
	}
}
