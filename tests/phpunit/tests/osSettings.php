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
	public function test_default_ai_assistant_is_opt_in() {
		$defaults = desktop_mode_default_os_settings();
		$this->assertFalse( $defaults['ai']['enabled'] );
	}

	/**
	 * @covers ::desktop_mode_sanitize_os_settings
	 */
	public function test_sanitize_keeps_ai_enabled_toggle() {
		$clean = desktop_mode_sanitize_os_settings(
			array( 'ai' => array( 'enabled' => true ) )
		);
		$this->assertTrue( $clean['ai']['enabled'] );
	}

	/**
	 * @covers ::desktop_mode_sanitize_os_settings
	 */
	public function test_sanitize_drops_legacy_ai_credential_and_preference_fields() {
		$clean = desktop_mode_sanitize_os_settings(
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

	// ────────────────────────────────────────────────────────────────
	// dockPromotedPositions — persisted x/y for dock-item icons the
	// user promoted to the desktop wallpaper.
	// ────────────────────────────────────────────────────────────────

	/**
	 * @covers ::desktop_mode_default_os_settings
	 */
	public function test_default_includes_empty_dock_promoted_positions() {
		$defaults = desktop_mode_default_os_settings();
		$this->assertArrayHasKey( 'dockPromotedPositions', $defaults );
		$this->assertSame( array(), $defaults['dockPromotedPositions'] );
	}

	/**
	 * @covers ::desktop_mode_sanitize_os_settings
	 */
	public function test_sanitize_keeps_well_formed_dock_promoted_positions() {
		$clean = desktop_mode_sanitize_os_settings(
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

	/**
	 * Slugs go through `sanitize_key()`, so values from an evil JSON
	 * blob with spaces / uppercase get normalized rather than passed
	 * through verbatim.
	 *
	 * @covers ::desktop_mode_sanitize_os_settings
	 */
	public function test_sanitize_normalizes_dock_promoted_position_keys() {
		$clean = desktop_mode_sanitize_os_settings(
			array(
				'dockPromotedPositions' => array(
					'Edit Php' => array( 'x' => 10, 'y' => 20 ),
				),
			)
		);
		$this->assertArrayNotHasKey( 'Edit Php', $clean['dockPromotedPositions'] );
		$this->assertArrayHasKey( 'editphp', $clean['dockPromotedPositions'] );
	}

	/**
	 * Non-numeric / missing coords are dropped — the JS shouldn't
	 * receive a half-shaped position that would crash the synthesizer.
	 *
	 * @covers ::desktop_mode_sanitize_os_settings
	 */
	public function test_sanitize_drops_malformed_dock_promoted_position_values() {
		$clean = desktop_mode_sanitize_os_settings(
			array(
				'dockPromotedPositions' => array(
					'a' => array( 'x' => 'not-a-number', 'y' => 0 ),
					'b' => array( 'x' => 0 ), // missing y
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

	/**
	 * Out-of-range coordinates are dropped. A corrupted JSON blob with
	 * coords of ±10^9 shouldn't make it into user meta where it could
	 * later inflate a screen-position math expression.
	 *
	 * @covers ::desktop_mode_sanitize_os_settings
	 */
	public function test_sanitize_drops_absurd_dock_promoted_position_coords() {
		$clean = desktop_mode_sanitize_os_settings(
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

	/**
	 * Cap-at-256 prevents an evil blob from ballooning user meta.
	 *
	 * @covers ::desktop_mode_sanitize_os_settings
	 */
	public function test_sanitize_caps_dock_promoted_positions_at_256() {
		$input = array();
		for ( $i = 0; $i < 300; $i++ ) {
			$input[ 'item-' . $i ] = array( 'x' => $i, 'y' => $i );
		}
		$clean = desktop_mode_sanitize_os_settings(
			array( 'dockPromotedPositions' => $input )
		);
		$this->assertCount( 256, $clean['dockPromotedPositions'] );
	}

	/**
	 * dockOrder entries may carry a rail-synthesis prefix
	 * (`desktop:<id>` / `dock:<id>`) for cross-rail tiles the user
	 * promoted. `sanitize_key()` would strip the colon and silently
	 * break the JS order match (and risk an id collision) on reload, so
	 * the sanitizer must preserve it.
	 *
	 * @covers ::desktop_mode_sanitize_os_settings
	 */
	public function test_sanitize_preserves_rail_prefix_colon_in_dock_order() {
		$clean = desktop_mode_sanitize_os_settings(
			array(
				'dockOrder' => array( 'desktop:my-icon', 'edit-php', 'dock:woocommerce' ),
			)
		);
		$this->assertSame(
			array( 'desktop:my-icon', 'edit-php', 'dock:woocommerce' ),
			$clean['dockOrder']
		);
	}

	/**
	 * The dockOrder sanitizer still rejects characters outside the JS
	 * id charset — spaces collapse, case folds, and punctuation/markup
	 * is stripped — so an evil blob can't smuggle anything unexpected
	 * into the persisted order.
	 *
	 * @covers ::desktop_mode_sanitize_os_settings
	 */
	public function test_sanitize_normalizes_dock_order_ids() {
		$clean = desktop_mode_sanitize_os_settings(
			array(
				'dockOrder' => array( 'Edit Php', '<script>x', 'desktop:My-Icon' ),
			)
		);
		$this->assertSame(
			array( 'editphp', 'scriptx', 'desktop:my-icon' ),
			$clean['dockOrder']
		);
	}

	// ────────────────────────────────────────────────────────────────
	// developerModeEnabled — per-user gate for developer-facing
	// surfaces (Starter Widget in the add-widget picker, Components
	// tab missing-import-warner demo). Off by default.
	// ────────────────────────────────────────────────────────────────

	/**
	 * @covers ::desktop_mode_default_os_settings
	 */
	public function test_default_developer_mode_is_off() {
		$defaults = desktop_mode_default_os_settings();
		$this->assertArrayHasKey( 'developerModeEnabled', $defaults );
		$this->assertFalse( $defaults['developerModeEnabled'] );
	}

	/**
	 * @covers ::desktop_mode_sanitize_os_settings
	 */
	public function test_sanitize_keeps_developer_mode_enabled_true() {
		$clean = desktop_mode_sanitize_os_settings( array( 'developerModeEnabled' => true ) );
		$this->assertTrue( $clean['developerModeEnabled'] );
	}

	/**
	 * @covers ::desktop_mode_sanitize_os_settings
	 */
	public function test_sanitize_falls_back_to_default_when_developer_mode_missing() {
		$clean = desktop_mode_sanitize_os_settings( array( 'wallpaper' => 'dark' ) );
		$this->assertFalse( $clean['developerModeEnabled'] );
	}

	/**
	 * @covers ::desktop_mode_save_os_settings
	 * @covers ::desktop_mode_get_os_settings
	 */
	public function test_user_meta_round_trip_keeps_developer_mode_enabled() {
		$user_id = self::factory()->user->create();
		desktop_mode_save_os_settings(
			$user_id,
			array( 'developerModeEnabled' => true )
		);
		$loaded = desktop_mode_get_os_settings( $user_id );
		$this->assertTrue( $loaded['developerModeEnabled'] );
	}

	// ────────────────────────────────────────────────────────────────
	// windowLinkRenderer / windowLinkVisibility — how (and when) the
	// relation ties between related windows are drawn. Renderer ids
	// follow the JS registry charset (slashes for vendor/sub-id);
	// visibility is a small closed set.
	// ────────────────────────────────────────────────────────────────

	/**
	 * @covers ::desktop_mode_default_os_settings
	 */
	public function test_default_window_link_settings() {
		$defaults = desktop_mode_default_os_settings();
		$this->assertSame( 'svg-splines', $defaults['windowLinkRenderer'] );
		$this->assertSame( 'always', $defaults['windowLinkVisibility'] );
	}

	/**
	 * @covers ::desktop_mode_sanitize_os_settings
	 */
	public function test_sanitize_keeps_namespaced_window_link_renderer() {
		$clean = desktop_mode_sanitize_os_settings(
			array( 'windowLinkRenderer' => 'vendor/pixi-lasers' )
		);
		$this->assertSame( 'vendor/pixi-lasers', $clean['windowLinkRenderer'] );

		$clean = desktop_mode_sanitize_os_settings(
			array( 'windowLinkRenderer' => 'none' )
		);
		$this->assertSame( 'none', $clean['windowLinkRenderer'] );
	}

	/**
	 * @covers ::desktop_mode_sanitize_os_settings
	 */
	public function test_sanitize_strips_bad_window_link_renderer_chars() {
		$clean = desktop_mode_sanitize_os_settings(
			array( 'windowLinkRenderer' => 'SVG Splines!<script>' )
		);
		// Uppercase folds, everything outside [a-z0-9_/-] drops.
		$this->assertSame( 'svgsplinesscript', $clean['windowLinkRenderer'] );

		$clean = desktop_mode_sanitize_os_settings(
			array( 'windowLinkRenderer' => '!!!' )
		);
		$this->assertSame( 'svg-splines', $clean['windowLinkRenderer'] );
	}

	/**
	 * @covers ::desktop_mode_sanitize_os_settings
	 */
	public function test_sanitize_window_link_visibility_is_allow_listed() {
		foreach ( array( 'focus', 'always', 'off' ) as $mode ) {
			$clean = desktop_mode_sanitize_os_settings(
				array( 'windowLinkVisibility' => $mode )
			);
			$this->assertSame( $mode, $clean['windowLinkVisibility'] );
		}

		$clean = desktop_mode_sanitize_os_settings(
			array( 'windowLinkVisibility' => 'sometimes' )
		);
		$this->assertSame( 'always', $clean['windowLinkVisibility'] );
	}

	/**
	 * @covers ::desktop_mode_save_os_settings
	 * @covers ::desktop_mode_get_os_settings
	 */
	public function test_user_meta_round_trip_keeps_window_link_settings() {
		$user_id = self::factory()->user->create();
		desktop_mode_save_os_settings(
			$user_id,
			array(
				'windowLinkRenderer'   => 'vendor/pixi-lasers',
				'windowLinkVisibility' => 'always',
			)
		);
		$loaded = desktop_mode_get_os_settings( $user_id );
		$this->assertSame( 'vendor/pixi-lasers', $loaded['windowLinkRenderer'] );
		$this->assertSame( 'always', $loaded['windowLinkVisibility'] );
	}

	/**
	 * @covers ::desktop_mode_default_os_settings
	 * @covers ::desktop_mode_sanitize_os_settings
	 */
	public function test_window_links_feature_switches_default_on_and_sanitize() {
		$defaults = desktop_mode_default_os_settings();
		$this->assertTrue( $defaults['windowLinksEnabled'] );
		$this->assertTrue( $defaults['windowLinkRaiseOnFocus'] );
		$this->assertTrue( $defaults['windowLinkHighlight'] );

		$clean = desktop_mode_sanitize_os_settings(
			array(
				'windowLinksEnabled'     => false,
				'windowLinkRaiseOnFocus' => 0,
				'windowLinkHighlight'    => '1',
			)
		);
		$this->assertFalse( $clean['windowLinksEnabled'] );
		$this->assertFalse( $clean['windowLinkRaiseOnFocus'] );
		$this->assertTrue( $clean['windowLinkHighlight'] );

		// Missing keys fall back to defaults.
		$clean = desktop_mode_sanitize_os_settings( array( 'wallpaper' => 'dark' ) );
		$this->assertTrue( $clean['windowLinksEnabled'] );
	}

	/**
	 * @covers ::desktop_mode_save_os_settings
	 * @covers ::desktop_mode_get_os_settings
	 */
	public function test_user_meta_round_trip_keeps_window_links_feature_switches() {
		$user_id = self::factory()->user->create();
		desktop_mode_save_os_settings(
			$user_id,
			array(
				'windowLinksEnabled'     => false,
				'windowLinkRaiseOnFocus' => false,
			)
		);
		$loaded = desktop_mode_get_os_settings( $user_id );
		$this->assertFalse( $loaded['windowLinksEnabled'] );
		$this->assertFalse( $loaded['windowLinkRaiseOnFocus'] );
		$this->assertTrue( $loaded['windowLinkHighlight'] );
	}

	/**
	 * @covers ::desktop_mode_default_os_settings
	 */
	public function test_default_includes_empty_wallpaper_settings() {
		$defaults = desktop_mode_default_os_settings();
		$this->assertArrayHasKey( 'wallpaperSettings', $defaults );
		$this->assertSame( array(), $defaults['wallpaperSettings'] );
	}

	/**
	 * @covers ::desktop_mode_sanitize_os_settings
	 */
	public function test_sanitize_keeps_well_formed_wallpaper_settings() {
		$clean = desktop_mode_sanitize_os_settings(
			array(
				'wallpaperSettings' => array(
					'wp-snow'         => array(
						'wind'          => 40,
						'particleCount' => 900,
						'flakeSize'     => 12.5,
						'background'    => '#123456',
						'enabled'       => true,
					),
					// Namespaced ids (`vendor/sub-id`) keep the slash.
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

	/**
	 * @covers ::desktop_mode_sanitize_os_settings
	 */
	public function test_sanitize_drops_malformed_wallpaper_settings() {
		$clean = desktop_mode_sanitize_os_settings(
			array(
				'wallpaperSettings' => array(
					// Non-scalar values are dropped; the bag survives if
					// anything valid remains.
					'wp-snow'   => array(
						'wind'   => 10,
						'nested' => array( 'evil' => true ),
					),
					// Bags with nothing valid are dropped entirely.
					'wp-empty'  => array( 'cb' => array( 1, 2 ) ),
					// Chars outside the id charset are stripped (same
					// normalization as unfocus-effect ids).
					'<script>'  => array( 'x' => 1 ),
					// Non-array bags are dropped.
					'wp-string' => 'not-a-bag',
				),
			)
		);
		$this->assertSame( array( 'wind' => 10 ), $clean['wallpaperSettings']['wp-snow'] );
		$this->assertArrayNotHasKey( 'wp-empty', $clean['wallpaperSettings'] );
		$this->assertArrayNotHasKey( 'wp-string', $clean['wallpaperSettings'] );
		$this->assertArrayHasKey( 'script', $clean['wallpaperSettings'] );
		$this->assertCount( 2, $clean['wallpaperSettings'] );

		// Non-array payload falls back to the default empty map.
		$clean = desktop_mode_sanitize_os_settings( array( 'wallpaperSettings' => 'bogus' ) );
		$this->assertSame( array(), $clean['wallpaperSettings'] );
	}

	/**
	 * @covers ::desktop_mode_sanitize_os_settings
	 */
	public function test_sanitize_caps_and_trims_wallpaper_settings() {
		// String values are length-capped at 256 characters.
		$clean = desktop_mode_sanitize_os_settings(
			array(
				'wallpaperSettings' => array(
					'wp-snow' => array( 'label' => str_repeat( 'a', 300 ) ),
				),
			)
		);
		$this->assertSame( 256, strlen( $clean['wallpaperSettings']['wp-snow']['label'] ) );

		// Wallpaper ids cap at 64 entries.
		$many = array();
		for ( $i = 0; $i < 70; $i++ ) {
			$many[ 'wp-' . $i ] = array( 'x' => $i );
		}
		$clean = desktop_mode_sanitize_os_settings( array( 'wallpaperSettings' => $many ) );
		$this->assertCount( 64, $clean['wallpaperSettings'] );

		// Keys per bag cap at 32.
		$bag = array();
		for ( $i = 0; $i < 40; $i++ ) {
			$bag[ 'k' . $i ] = $i;
		}
		$clean = desktop_mode_sanitize_os_settings(
			array( 'wallpaperSettings' => array( 'wp-snow' => $bag ) )
		);
		$this->assertCount( 32, $clean['wallpaperSettings']['wp-snow'] );
	}

	/**
	 * @covers ::desktop_mode_save_os_settings
	 * @covers ::desktop_mode_get_os_settings
	 */
	public function test_user_meta_round_trip_keeps_wallpaper_settings() {
		$user_id = self::factory()->user->create();
		desktop_mode_save_os_settings(
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
		$loaded = desktop_mode_get_os_settings( $user_id );
		$this->assertSame( 55, $loaded['wallpaperSettings']['wp-snow']['wind'] );
		$this->assertSame( '#0c1a36', $loaded['wallpaperSettings']['wp-snow']['background'] );
	}
}
