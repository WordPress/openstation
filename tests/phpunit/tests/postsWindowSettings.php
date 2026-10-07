<?php

class Tests_OpenStation_PostsWindowSettings extends WP_UnitTestCase {

	public function test_default_includes_native_posts_enabled() {
		$defaults = openstation_default_os_settings();
		$this->assertArrayHasKey( 'nativePostsEnabled', $defaults );
		$this->assertFalse(
			$defaults['nativePostsEnabled'],
			'`nativePostsEnabled` defaults OFF: the native Posts window is opt-in Beta; users explicitly toggle it ON to replace the classic iframe.'
		);
	}

	public function test_sanitize_keeps_true_value() {
		$clean = openstation_sanitize_os_settings(
			array( 'nativePostsEnabled' => true )
		);
		$this->assertTrue( $clean['nativePostsEnabled'] );
	}

	public function test_sanitize_keeps_false_value() {
		$clean = openstation_sanitize_os_settings(
			array( 'nativePostsEnabled' => false )
		);
		$this->assertFalse( $clean['nativePostsEnabled'] );
	}

	public function test_sanitize_coerces_truthy_strings() {
		$clean = openstation_sanitize_os_settings(
			array( 'nativePostsEnabled' => '1' )
		);
		$this->assertTrue( $clean['nativePostsEnabled'] );
	}

	public function test_sanitize_coerces_falsy_values() {
		$clean = openstation_sanitize_os_settings(
			array( 'nativePostsEnabled' => 0 )
		);
		$this->assertFalse( $clean['nativePostsEnabled'] );

		$clean = openstation_sanitize_os_settings(
			array( 'nativePostsEnabled' => '' )
		);
		$this->assertFalse( $clean['nativePostsEnabled'] );
	}

	public function test_sanitize_falls_back_when_missing() {
		$clean = openstation_sanitize_os_settings(
			array( 'wallpaper' => 'dark' )
		);
		$this->assertFalse(
			$clean['nativePostsEnabled'],
			'Missing field should fall back to the default — opt-in Beta means the default is OFF.'
		);
	}

	public function test_user_meta_round_trip_keeps_native_posts_enabled() {
		$user_id = self::factory()->user->create();
		openstation_save_os_settings(
			$user_id,
			array(
				'wallpaper'          => 'dark',
				'nativePostsEnabled' => true,
			)
		);
		$loaded = openstation_get_os_settings( $user_id );
		$this->assertTrue( $loaded['nativePostsEnabled'] );
	}

	public function test_user_meta_round_trip_keeps_explicit_false() {
		$user_id = self::factory()->user->create();
		openstation_save_os_settings(
			$user_id,
			array( 'nativePostsEnabled' => true )
		);
		openstation_save_os_settings(
			$user_id,
			array( 'nativePostsEnabled' => false )
		);
		$loaded = openstation_get_os_settings( $user_id );
		$this->assertFalse( $loaded['nativePostsEnabled'] );
	}

	public function test_default_includes_hidden_columns() {
		$defaults = openstation_default_os_settings();
		$this->assertArrayHasKey( 'nativePostsHiddenColumns', $defaults );
		$this->assertArrayHasKey( 'nativePagesHiddenColumns', $defaults );
		$this->assertSame( array(), $defaults['nativePostsHiddenColumns'] );
		$this->assertSame( array(), $defaults['nativePagesHiddenColumns'] );
	}

	public function test_sanitize_hidden_columns() {
		$clean = openstation_sanitize_os_settings(
			array(
				'nativePostsHiddenColumns' => array( 'author', 'tags', 'invalid@key!' ),
				'nativePagesHiddenColumns' => array( 'author', 'parent' ),
			)
		);
		$this->assertSame( array( 'author', 'tags', 'invalidkey' ), $clean['nativePostsHiddenColumns'] );
		$this->assertSame( array( 'author', 'parent' ), $clean['nativePagesHiddenColumns'] );
	}

	public function test_user_meta_round_trip_keeps_hidden_columns_independently() {
		$user_id = self::factory()->user->create();
		openstation_save_os_settings(
			$user_id,
			array(
				'nativePostsHiddenColumns' => array( 'author' ),
				'nativePagesHiddenColumns' => array( 'date' ),
			)
		);
		$loaded = openstation_get_os_settings( $user_id );
		$this->assertSame( array( 'author' ), $loaded['nativePostsHiddenColumns'] );
		$this->assertSame( array( 'date' ), $loaded['nativePagesHiddenColumns'] );
	}
}
