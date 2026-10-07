<?php

class Tests_OpenStation_OsSettings extends WP_UnitTestCase {

	public function test_open_windows_as_round_trip_and_invalid_value_fallback() {
		$this->assertSame( 'default', openstation_default_os_settings()['openWindowsAs'] );
		$user = self::factory()->user->create();
		foreach ( array( 'default', 'maximized', 'focused' ) as $mode ) {
			openstation_save_os_settings( $user, array( 'openWindowsAs' => $mode ) );
			$this->assertSame( $mode, openstation_get_os_settings( $user )['openWindowsAs'] );
		}
		foreach ( array( 'fullscreen', array( 'focused' ), null ) as $invalid ) {
			$clean = openstation_sanitize_os_settings( array( 'openWindowsAs' => $invalid ) );
			$this->assertSame( 'default', $clean['openWindowsAs'] );
		}
	}

	public function test_mio_master_aliases_and_wallpaper_preference_round_trip() {
		$this->assertFalse( openstation_default_os_settings()['mioApiEnabled'] );
		$this->assertTrue( openstation_default_os_settings()['mioShowOnWallpaper'] );
		$user = self::factory()->user->create();
		openstation_save_os_settings( $user, array( 'mioEnabled' => true, 'mioApiEnabled' => false, 'mioShowOnWallpaper' => false ) );
		$saved = openstation_get_os_settings( $user );
		$this->assertTrue( $saved['mioEnabled'] );
		$this->assertTrue( $saved['mioApiEnabled'] );
		$this->assertFalse( $saved['mioShowOnWallpaper'] );
		$this->assertTrue( openstation_sanitize_os_settings( array( 'mioApiEnabled' => true ) )['mioEnabled'] );
	}

	public function test_mio_alias_only_rest_patch_overrides_saved_master() {
		$user = self::factory()->user->create();
		wp_set_current_user( $user );
		openstation_save_os_settings( $user, array( 'mioEnabled' => true ) );
		foreach ( array( array( 'mioApiEnabled' => false ), array( 'mioEnabled' => true ) ) as $patch ) {
			$request = new WP_REST_Request( 'POST' );
			$request->set_param( 'settings', $patch );
			openstation_rest_save_os_settings( $request );
			$saved = openstation_get_os_settings( $user );
			$this->assertSame( reset( $patch ), $saved['mioEnabled'] );
			$this->assertSame( $saved['mioEnabled'], $saved['mioApiEnabled'] );
		}
	}

	public function test_default_includes_desktop_layout() {
		$defaults = openstation_default_os_settings();
		$this->assertArrayHasKey( 'desktopLayout', $defaults );
		$this->assertSame( 'unified', $defaults['desktopLayout'] );
	}

	public function test_default_dock_placement_is_bottom() {
		$defaults = openstation_default_os_settings();
		$this->assertArrayHasKey( 'dockPlacement', $defaults );
		$this->assertSame( 'bottom', $defaults['dockPlacement'] );
	}

	public function test_default_admin_bar_mode_is_hidden() {
		$defaults = openstation_default_os_settings();
		$this->assertArrayHasKey( 'adminBarMode', $defaults );
		$this->assertSame( 'hidden', $defaults['adminBarMode'] );
	}

	public function test_sanitize_keeps_known_admin_bar_mode() {
		foreach ( OPENSTATION_OS_SETTINGS_ADMIN_BAR_MODES as $mode ) {
			$clean = openstation_sanitize_os_settings( array( 'adminBarMode' => $mode ) );
			$this->assertSame( $mode, $clean['adminBarMode'], "mode '{$mode}' should round-trip" );
		}
	}

	public function test_sanitize_falls_back_to_default_for_unknown_admin_bar_mode() {
		$clean = openstation_sanitize_os_settings( array( 'adminBarMode' => 'peekaboo' ) );
		$this->assertSame( 'hidden', $clean['adminBarMode'] );
	}

	public function test_default_dock_behavior_is_static() {
		$defaults = openstation_default_os_settings();
		$this->assertArrayHasKey( 'dockBehavior', $defaults );
		$this->assertSame( 'static', $defaults['dockBehavior'] );
	}

	public function test_sanitize_keeps_known_dock_behavior() {
		foreach ( array( 'static', 'dynamic' ) as $behavior ) {
			$clean = openstation_sanitize_os_settings( array( 'dockBehavior' => $behavior ) );
			$this->assertSame( $behavior, $clean['dockBehavior'], "behavior '{$behavior}' should round-trip" );
		}
	}

	public function test_sanitize_keeps_side_dock_behavior_independently() {
		$clean = openstation_sanitize_os_settings(
			array(
				'dockBehavior'     => 'static',
				'sideDockBehavior' => 'dynamic',
			)
		);
		$this->assertSame( 'static', $clean['dockBehavior'] );
		$this->assertSame( 'dynamic', $clean['sideDockBehavior'] );

		$clean = openstation_sanitize_os_settings( array( 'sideDockBehavior' => 'peekaboo' ) );
		$this->assertSame( 'static', $clean['sideDockBehavior'] );
	}

	public function test_sanitize_falls_back_to_default_for_unknown_dock_behavior() {
		$clean = openstation_sanitize_os_settings( array( 'dockBehavior' => 'peekaboo' ) );
		$this->assertSame( 'static', $clean['dockBehavior'] );
	}

	public function test_sanitize_falls_back_when_admin_bar_mode_missing() {
		$clean = openstation_sanitize_os_settings( array( 'wallpaper' => 'dark' ) );
		$this->assertSame( 'hidden', $clean['adminBarMode'] );
	}

	public function test_sanitize_keeps_known_layout_value() {
		foreach ( array( 'classic', 'unified' ) as $layout ) {
			$clean = openstation_sanitize_os_settings( array( 'desktopLayout' => $layout ) );
			$this->assertSame( $layout, $clean['desktopLayout'], "layout '{$layout}' should round-trip" );
		}
	}

	public function test_sanitize_falls_back_to_default_for_unknown_layout() {
		$clean = openstation_sanitize_os_settings( array( 'desktopLayout' => 'invalid-mode' ) );
		$this->assertSame( 'unified', $clean['desktopLayout'] );
	}

	public function test_sanitize_falls_back_when_layout_missing() {
		$clean = openstation_sanitize_os_settings( array( 'wallpaper' => 'dark' ) );
		$this->assertSame( 'unified', $clean['desktopLayout'] );
	}

	public function test_sanitize_keeps_known_dock_placement() {
		foreach ( OPENSTATION_OS_SETTINGS_DOCK_PLACEMENTS as $placement ) {
			$clean = openstation_sanitize_os_settings( array( 'dockPlacement' => $placement ) );
			$this->assertSame(
				$placement,
				$clean['dockPlacement'],
				"placement '{$placement}' should round-trip"
			);
		}
	}

	public function test_sanitize_falls_back_to_default_for_unknown_dock_placement() {
		$clean = openstation_sanitize_os_settings( array( 'dockPlacement' => 'ceiling' ) );
		$this->assertSame( 'bottom', $clean['dockPlacement'] );
	}

	public function test_user_meta_round_trip_keeps_dock_placement() {
		$user_id = self::factory()->user->create();
		openstation_save_os_settings(
			$user_id,
			array(
				'desktopLayout' => 'unified',
				'dockPlacement' => 'left',
			)
		);
		$loaded = openstation_get_os_settings( $user_id );
		$this->assertSame( 'left', $loaded['dockPlacement'] );
	}

	public function test_user_meta_round_trip_keeps_desktop_layout() {
		$user_id = self::factory()->user->create();
		openstation_save_os_settings(
			$user_id,
			array(
				'wallpaper'     => 'dark',
				'desktopLayout' => 'classic',
			)
		);
		$loaded = openstation_get_os_settings( $user_id );
		$this->assertSame( 'classic', $loaded['desktopLayout'] );
	}

	public function test_default_includes_dock_rail_renderer() {
		$defaults = openstation_default_os_settings();
		$this->assertArrayHasKey( 'dockRailRenderer', $defaults );
		$this->assertSame( 'default', $defaults['dockRailRenderer'] );
	}

	public function test_sanitize_keeps_well_formed_dock_rail_renderer() {
		$clean = openstation_sanitize_os_settings(
			array( 'dockRailRenderer' => 'my-ring' )
		);
		$this->assertSame( 'my-ring', $clean['dockRailRenderer'] );
	}

	public function test_user_meta_round_trip_keeps_dock_rail_renderer() {
		$user_id = self::factory()->user->create();
		openstation_save_os_settings(
			$user_id,
			array( 'dockRailRenderer' => 'fan' )
		);
		$loaded = openstation_get_os_settings( $user_id );
		$this->assertSame( 'fan', $loaded['dockRailRenderer'] );
	}

	public function test_default_ai_assistant_is_opt_in() {
		$defaults = openstation_default_os_settings();
		$this->assertFalse( $defaults['ai']['enabled'] );
	}

	public function test_sanitize_keeps_ai_enabled_toggle() {
		$clean = openstation_sanitize_os_settings(
			array( 'ai' => array( 'enabled' => true ) )
		);
		$this->assertTrue( $clean['ai']['enabled'] );
	}

	public function test_default_station_home_is_opt_in() {
		$defaults = openstation_default_os_settings();
		$this->assertFalse( $defaults['stationHomeEnabled'] );
	}

	public function test_sanitize_keeps_station_home_opt_in() {
		$clean = openstation_sanitize_os_settings(
			array( 'stationHomeEnabled' => true )
		);
		$this->assertTrue( $clean['stationHomeEnabled'] );

		$clean = openstation_sanitize_os_settings(
			array( 'stationHomeEnabled' => '' )
		);
		$this->assertFalse( $clean['stationHomeEnabled'] );
	}

	public function test_default_admin_asset_cache_is_opt_out() {
		$defaults = openstation_default_os_settings();
		$this->assertTrue( $defaults['adminAssetCacheEnabled'] );
	}

	public function test_sanitize_uses_site_wide_admin_asset_cache() {
		$clean = openstation_sanitize_os_settings( array( 'adminAssetCacheEnabled' => false ) );
		$this->assertTrue( $clean['adminAssetCacheEnabled'] );
		openstation_save_extended_options( array( 'admin_asset_cache' => false ) );
		$clean = openstation_sanitize_os_settings( array( 'adminAssetCacheEnabled' => true ) );
		$this->assertFalse( $clean['adminAssetCacheEnabled'] );
	}

	public function test_default_window_prewarm_is_opt_out() {
		$defaults = openstation_default_os_settings();
		$this->assertTrue( $defaults['windowPrewarmEnabled'] );
	}

	public function test_sanitize_uses_site_wide_window_prewarm() {
		$clean = openstation_sanitize_os_settings( array( 'windowPrewarmEnabled' => false ) );
		$this->assertTrue( $clean['windowPrewarmEnabled'] );
		openstation_save_extended_options( array( 'window_prewarm' => false ) );
		$clean = openstation_sanitize_os_settings( array( 'windowPrewarmEnabled' => true ) );
		$this->assertFalse( $clean['windowPrewarmEnabled'] );
	}

	public function test_sanitize_drops_legacy_ai_credential_and_preference_fields() {
		$clean = openstation_sanitize_os_settings(
			array(
				'ai' => array(
					'enabled'   => true,
					'apiKey'    => 'sk-secret',
					'apiKeys'   => array( 'openai' => 'sk-x' ),
					'transport' => 'sse',
					'provider'  => 'openai',
					'model'     => 'gpt-4o',
				),
			)
		);
		$this->assertTrue( $clean['ai']['enabled'] );
		$this->assertArrayNotHasKey( 'apiKey', $clean['ai'] );
		$this->assertArrayNotHasKey( 'apiKeys', $clean['ai'] );
		$this->assertArrayNotHasKey( 'transport', $clean['ai'] );
		$this->assertArrayNotHasKey( 'provider', $clean['ai'] );
		$this->assertArrayNotHasKey( 'model', $clean['ai'] );
	}

	public function test_default_includes_empty_dock_promoted_positions() {
		$defaults = openstation_default_os_settings();
		$this->assertArrayHasKey( 'dockPromotedPositions', $defaults );
		$this->assertSame( array(), $defaults['dockPromotedPositions'] );
	}

	public function test_sanitize_keeps_well_formed_dock_promoted_positions() {
		$clean = openstation_sanitize_os_settings(
			array(
				'dockPromotedPositions' => array(
					'edit-php'    => array( 'x' => 200, 'y' => 150 ),
					'upload-php'  => array( 'x' => 320, 'y' => 240 ),
				),
			)
		);
		$this->assertArrayHasKey( 'dockPromotedPositions', $clean );
		$this->assertCount( 2, $clean['dockPromotedPositions'] );
		$this->assertSame(
			array( 'x' => 200, 'y' => 150 ),
			$clean['dockPromotedPositions']['edit-php']
		);
	}

	public function test_sanitize_normalizes_dock_promoted_position_keys() {
		$clean = openstation_sanitize_os_settings(
			array(
				'dockPromotedPositions' => array(
					'Edit Php' => array( 'x' => 10, 'y' => 20 ),
				),
			)
		);
		$this->assertArrayNotHasKey( 'Edit Php', $clean['dockPromotedPositions'] );
		$this->assertArrayHasKey( 'editphp', $clean['dockPromotedPositions'] );
	}

	public function test_sanitize_drops_malformed_dock_promoted_position_values() {
		$clean = openstation_sanitize_os_settings(
			array(
				'dockPromotedPositions' => array(
					'a' => array( 'x' => 'not-a-number', 'y' => 0 ),
					'b' => array( 'x' => 0 ),
					'c' => 'not-an-array',
					'd' => array( 'x' => 50, 'y' => 60 ),
				),
			)
		);
		$this->assertSame(
			array( 'd' => array( 'x' => 50, 'y' => 60 ) ),
			$clean['dockPromotedPositions']
		);
	}

	public function test_sanitize_drops_absurd_dock_promoted_position_coords() {
		$clean = openstation_sanitize_os_settings(
			array(
				'dockPromotedPositions' => array(
					'huge'    => array( 'x' => 999999999, 'y' => 0 ),
					'neg'     => array( 'x' => -999999999, 'y' => 0 ),
					'normal'  => array( 'x' => 100, 'y' => 100 ),
				),
			)
		);
		$this->assertSame(
			array( 'normal' => array( 'x' => 100, 'y' => 100 ) ),
			$clean['dockPromotedPositions']
		);
	}

	public function test_sanitize_caps_dock_promoted_positions_at_256() {
		$input = array();
		for ( $i = 0; $i < 300; $i++ ) {
			$input[ 'item-' . $i ] = array( 'x' => $i, 'y' => $i );
		}
		$clean = openstation_sanitize_os_settings(
			array( 'dockPromotedPositions' => $input )
		);
		$this->assertCount( 256, $clean['dockPromotedPositions'] );
	}

	public function test_sanitize_strips_rail_prefixes_from_nav_order() {
		$clean = openstation_sanitize_os_settings(
			array(
				'navOrder' => array( 'desktop:my-icon', 'edit-php', 'dock:woocommerce' ),
			)
		);
		$this->assertSame(
			array( 'my-icon', 'edit-php', 'woocommerce' ),
			$clean['navOrder']
		);
	}

	public function test_sanitize_normalizes_nav_order_ids() {
		$clean = openstation_sanitize_os_settings(
			array(
				'navOrder' => array( 'Edit Php', '<script>x', 'desktop:My-Icon' ),
			)
		);
		$this->assertSame(
			array( 'editphp', 'scriptx', 'my-icon' ),
			$clean['navOrder']
		);
	}

	public function test_default_nav_placement_is_empty() {
		$defaults = openstation_default_os_settings();
		$this->assertSame( array(), $defaults['navPlacement'] );
		$this->assertSame( array(), $defaults['navOrder'] );
	}

	public function test_sanitize_keeps_valid_nav_placements() {
		$clean = openstation_sanitize_os_settings(
			array(
				'navPlacement' => array(
					'edit-php'     => 'rail',
					'games'        => 'desktop',
					'woocommerce'  => 'both',
					'os-mio'       => 'hidden',
				),
			)
		);
		$this->assertSame(
			array(
				'edit-php'    => 'rail',
				'games'       => 'desktop',
				'woocommerce' => 'both',
				'os-mio'      => 'hidden',
			),
			$clean['navPlacement']
		);
	}

	public function test_sanitize_drops_unknown_nav_placements() {
		$clean = openstation_sanitize_os_settings(
			array(
				'navPlacement' => array(
					'edit-php' => 'dock',
					'games'    => 'nowhere',
					'ok'       => 'rail',
				),
			)
		);
		$this->assertSame( array( 'ok' => 'rail' ), $clean['navPlacement'] );
	}

	public function test_sanitize_carries_over_item_visibility() {
		$clean = openstation_sanitize_os_settings(
			array(
				'itemVisibility' => array(
					'edit-php'    => 'dock',
					'games'       => 'desktop',
					'woocommerce' => 'both',
					'os-mio'      => 'hidden',
				),
			)
		);
		$this->assertSame(
			array(
				'edit-php'    => 'rail',
				'games'       => 'desktop',
				'woocommerce' => 'both',
				'os-mio'      => 'hidden',
			),
			$clean['navPlacement']
		);
	}

	public function test_item_visibility_carry_over_canonicalizes_ids() {
		$out = openstation_migrate_item_visibility(
			array(
				'desktop:my-icon' => 'dock',
				'dock:woocommerce' => 'desktop',
				'games'           => 'hidden',
				'my-icon'         => 'both',
			)
		);
		$this->assertSame(
			array(
				'my-icon'     => 'both',
				'woocommerce' => 'desktop',
				'games'       => 'hidden',
			),
			$out
		);
	}

	public function test_nav_placement_wins_over_legacy_item_visibility() {
		$clean = openstation_sanitize_os_settings(
			array(
				'navPlacement'   => array( 'games' => 'rail' ),
				'itemVisibility' => array( 'games' => 'hidden' ),
			)
		);
		$this->assertSame( array( 'games' => 'rail' ), $clean['navPlacement'] );
	}

	public function test_sanitize_carries_over_dock_order() {
		$clean = openstation_sanitize_os_settings(
			array( 'dockOrder' => array( 'dock:woocommerce', 'edit-php' ) )
		);
		$this->assertSame(
			array( 'woocommerce', 'edit-php' ),
			$clean['navOrder']
		);
	}

	public function test_default_developer_mode_is_off() {
		$defaults = openstation_default_os_settings();
		$this->assertArrayHasKey( 'developerModeEnabled', $defaults );
		$this->assertFalse( $defaults['developerModeEnabled'] );
	}

	public function test_sanitize_keeps_developer_mode_enabled_true() {
		$clean = openstation_sanitize_os_settings( array( 'developerModeEnabled' => true ) );
		$this->assertTrue( $clean['developerModeEnabled'] );
	}

	public function test_sanitize_falls_back_to_default_when_developer_mode_missing() {
		$clean = openstation_sanitize_os_settings( array( 'wallpaper' => 'dark' ) );
		$this->assertFalse( $clean['developerModeEnabled'] );
	}

	public function test_user_meta_round_trip_keeps_developer_mode_enabled() {
		$user_id = self::factory()->user->create();
		openstation_save_os_settings(
			$user_id,
			array( 'developerModeEnabled' => true )
		);
		$loaded = openstation_get_os_settings( $user_id );
		$this->assertTrue( $loaded['developerModeEnabled'] );
	}

	public function test_default_window_reveal_is_off() {
		$defaults = openstation_default_os_settings();

		$this->assertSame( 'none', $defaults['windowReveal'] );
	}

	public function test_sanitize_keeps_namespaced_window_reveal() {
		$clean = openstation_sanitize_os_settings(
			array( 'windowReveal' => 'vendor/shutter' )
		);
		$this->assertSame( 'vendor/shutter', $clean['windowReveal'] );

		$clean = openstation_sanitize_os_settings(
			array( 'windowReveal' => 'none' )
		);
		$this->assertSame( 'none', $clean['windowReveal'] );
	}

	public function test_sanitize_keeps_every_built_in_window_reveal() {
		$built_ins = array(
			'sweep',
			'rise',
			'diagonal',
			'iris',
			'diamond',
			'curtain',
			'shutter',
			'blinds',
			'slats',
			'mosaic',
			'radar',
			'obturator',
		);
		foreach ( $built_ins as $id ) {
			$clean = openstation_sanitize_os_settings(
				array( 'windowReveal' => $id )
			);
			$this->assertSame( $id, $clean['windowReveal'] );
		}
	}

	public function test_sanitize_strips_bad_window_reveal_chars() {
		$clean = openstation_sanitize_os_settings(
			array( 'windowReveal' => 'Iris Wipe!<script>' )
		);

		$this->assertSame( 'iriswipescript', $clean['windowReveal'] );

		$clean = openstation_sanitize_os_settings(
			array( 'windowReveal' => '!!!' )
		);
		$this->assertSame( 'none', $clean['windowReveal'] );
	}

	public function test_sanitize_window_reveal_rejects_non_string() {
		$clean = openstation_sanitize_os_settings(
			array( 'windowReveal' => array( 'iris' ) )
		);
		$this->assertSame( 'none', $clean['windowReveal'] );
	}

	public function test_default_window_reveal_duration_is_per_reveal() {
		$defaults = openstation_default_os_settings();

		$this->assertSame( 0, $defaults['windowRevealDuration'] );
	}

	public function test_sanitize_window_reveal_duration_clamps_into_range() {
		$clean = openstation_sanitize_os_settings(
			array( 'windowRevealDuration' => 700 )
		);
		$this->assertSame( 700, $clean['windowRevealDuration'] );

		$clean = openstation_sanitize_os_settings(
			array( 'windowRevealDuration' => 999999 )
		);
		$this->assertSame( 4000, $clean['windowRevealDuration'] );

		$clean = openstation_sanitize_os_settings(
			array( 'windowRevealDuration' => 5 )
		);
		$this->assertSame( 80, $clean['windowRevealDuration'] );
	}

	public function test_sanitize_window_reveal_duration_keeps_the_zero_sentinel() {

		$clean = openstation_sanitize_os_settings(
			array( 'windowRevealDuration' => 0 )
		);
		$this->assertSame( 0, $clean['windowRevealDuration'] );

		$clean = openstation_sanitize_os_settings(
			array( 'windowRevealDuration' => -40 )
		);
		$this->assertSame( 0, $clean['windowRevealDuration'] );
	}

	public function test_sanitize_window_reveal_duration_rejects_non_numeric() {
		$clean = openstation_sanitize_os_settings(
			array( 'windowRevealDuration' => 'fast' )
		);
		$this->assertSame( 0, $clean['windowRevealDuration'] );
	}

	public function test_window_reveal_round_trips_through_user_meta() {
		$user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		update_user_meta(
			$user_id,
			'desktop_mode_os_settings',
			openstation_sanitize_os_settings( array( 'windowReveal' => 'blinds' ) )
		);
		$loaded = openstation_get_os_settings( $user_id );
		$this->assertSame( 'blinds', $loaded['windowReveal'] );
	}

	public function test_default_window_link_settings() {
		$defaults = openstation_default_os_settings();
		$this->assertSame( 'svg-splines', $defaults['windowLinkRenderer'] );
		$this->assertSame( 'always', $defaults['windowLinkVisibility'] );
	}

	public function test_sanitize_keeps_namespaced_window_link_renderer() {
		$clean = openstation_sanitize_os_settings(
			array( 'windowLinkRenderer' => 'vendor/pixi-lasers' )
		);
		$this->assertSame( 'vendor/pixi-lasers', $clean['windowLinkRenderer'] );

		$clean = openstation_sanitize_os_settings(
			array( 'windowLinkRenderer' => 'none' )
		);
		$this->assertSame( 'none', $clean['windowLinkRenderer'] );
	}

	public function test_sanitize_strips_bad_window_link_renderer_chars() {
		$clean = openstation_sanitize_os_settings(
			array( 'windowLinkRenderer' => 'SVG Splines!<script>' )
		);

		$this->assertSame( 'svgsplinesscript', $clean['windowLinkRenderer'] );

		$clean = openstation_sanitize_os_settings(
			array( 'windowLinkRenderer' => '!!!' )
		);
		$this->assertSame( 'svg-splines', $clean['windowLinkRenderer'] );
	}

	public function test_sanitize_window_link_visibility_is_allow_listed() {
		foreach ( array( 'focus', 'always', 'off' ) as $mode ) {
			$clean = openstation_sanitize_os_settings(
				array( 'windowLinkVisibility' => $mode )
			);
			$this->assertSame( $mode, $clean['windowLinkVisibility'] );
		}

		$clean = openstation_sanitize_os_settings(
			array( 'windowLinkVisibility' => 'sometimes' )
		);
		$this->assertSame( 'always', $clean['windowLinkVisibility'] );
	}

	public function test_user_meta_round_trip_keeps_window_link_settings() {
		$user_id = self::factory()->user->create();
		openstation_save_os_settings(
			$user_id,
			array(
				'windowLinkRenderer'   => 'vendor/pixi-lasers',
				'windowLinkVisibility' => 'always',
			)
		);
		$loaded = openstation_get_os_settings( $user_id );
		$this->assertSame( 'vendor/pixi-lasers', $loaded['windowLinkRenderer'] );
		$this->assertSame( 'always', $loaded['windowLinkVisibility'] );
	}

	public function test_window_links_feature_switches_default_on_and_sanitize() {
		$defaults = openstation_default_os_settings();
		$this->assertTrue( $defaults['windowLinksEnabled'] );
		$this->assertTrue( $defaults['windowLinkRaiseOnFocus'] );
		$this->assertTrue( $defaults['windowLinkHighlight'] );

		$clean = openstation_sanitize_os_settings(
			array(
				'windowLinksEnabled'     => false,
				'windowLinkRaiseOnFocus' => 0,
				'windowLinkHighlight'    => '1',
			)
		);
		$this->assertFalse( $clean['windowLinksEnabled'] );
		$this->assertFalse( $clean['windowLinkRaiseOnFocus'] );
		$this->assertTrue( $clean['windowLinkHighlight'] );

		$clean = openstation_sanitize_os_settings( array( 'wallpaper' => 'dark' ) );
		$this->assertTrue( $clean['windowLinksEnabled'] );
	}

	public function test_user_meta_round_trip_keeps_window_links_feature_switches() {
		$user_id = self::factory()->user->create();
		openstation_save_os_settings(
			$user_id,
			array(
				'windowLinksEnabled'     => false,
				'windowLinkRaiseOnFocus' => false,
			)
		);
		$loaded = openstation_get_os_settings( $user_id );
		$this->assertFalse( $loaded['windowLinksEnabled'] );
		$this->assertFalse( $loaded['windowLinkRaiseOnFocus'] );
		$this->assertTrue( $loaded['windowLinkHighlight'] );
	}

	public function test_default_includes_empty_wallpaper_settings() {
		$defaults = openstation_default_os_settings();
		$this->assertArrayHasKey( 'wallpaperSettings', $defaults );
		$this->assertSame( array(), $defaults['wallpaperSettings'] );
	}

	public function test_sanitize_keeps_well_formed_wallpaper_settings() {
		$clean = openstation_sanitize_os_settings(
			array(
				'wallpaperSettings' => array(
					'wp-snow'         => array(
						'wind'          => 40,
						'particleCount' => 900,
						'flakeSize'     => 12.5,
						'background'    => '#123456',
						'enabled'       => true,
					),

					'vendor/aquarium' => array( 'fishCount' => 7 ),
				),
			)
		);
		$this->assertSame( 40, $clean['wallpaperSettings']['wp-snow']['wind'] );
		$this->assertSame( 900, $clean['wallpaperSettings']['wp-snow']['particleCount'] );
		$this->assertSame( 12.5, $clean['wallpaperSettings']['wp-snow']['flakeSize'] );
		$this->assertSame( '#123456', $clean['wallpaperSettings']['wp-snow']['background'] );
		$this->assertTrue( $clean['wallpaperSettings']['wp-snow']['enabled'] );
		$this->assertSame( 7, $clean['wallpaperSettings']['vendor/aquarium']['fishCount'] );
	}

	public function test_sanitize_drops_malformed_wallpaper_settings() {
		$clean = openstation_sanitize_os_settings(
			array(
				'wallpaperSettings' => array(

					'wp-snow'   => array(
						'wind'   => 10,
						'nested' => array( 'evil' => true ),
					),

					'wp-empty'  => array( 'cb' => array( 1, 2 ) ),

					'<script>'  => array( 'x' => 1 ),

					'wp-string' => 'not-a-bag',
				),
			)
		);
		$this->assertSame( array( 'wind' => 10 ), $clean['wallpaperSettings']['wp-snow'] );
		$this->assertArrayNotHasKey( 'wp-empty', $clean['wallpaperSettings'] );
		$this->assertArrayNotHasKey( 'wp-string', $clean['wallpaperSettings'] );
		$this->assertArrayHasKey( 'script', $clean['wallpaperSettings'] );
		$this->assertCount( 2, $clean['wallpaperSettings'] );

		$clean = openstation_sanitize_os_settings( array( 'wallpaperSettings' => 'bogus' ) );
		$this->assertSame( array(), $clean['wallpaperSettings'] );
	}

	public function test_sanitize_caps_and_trims_wallpaper_settings() {

		$clean = openstation_sanitize_os_settings(
			array(
				'wallpaperSettings' => array(
					'wp-snow' => array( 'label' => str_repeat( 'a', 300 ) ),
				),
			)
		);
		$this->assertSame( 256, strlen( $clean['wallpaperSettings']['wp-snow']['label'] ) );

		$many = array();
		for ( $i = 0; $i < 70; $i++ ) {
			$many[ 'wp-' . $i ] = array( 'x' => $i );
		}
		$clean = openstation_sanitize_os_settings( array( 'wallpaperSettings' => $many ) );
		$this->assertCount( 64, $clean['wallpaperSettings'] );

		$bag = array();
		for ( $i = 0; $i < 40; $i++ ) {
			$bag[ 'k' . $i ] = $i;
		}
		$clean = openstation_sanitize_os_settings(
			array( 'wallpaperSettings' => array( 'wp-snow' => $bag ) )
		);
		$this->assertCount( 32, $clean['wallpaperSettings']['wp-snow'] );
	}

	public function test_user_meta_round_trip_keeps_wallpaper_settings() {
		$user_id = self::factory()->user->create();
		openstation_save_os_settings(
			$user_id,
			array(
				'wallpaperSettings' => array(
					'wp-snow' => array(
						'wind'       => 55,
						'background' => '#0c1a36',
					),
				),
			)
		);
		$loaded = openstation_get_os_settings( $user_id );
		$this->assertSame( 55, $loaded['wallpaperSettings']['wp-snow']['wind'] );
		$this->assertSame( '#0c1a36', $loaded['wallpaperSettings']['wp-snow']['background'] );
	}
}
