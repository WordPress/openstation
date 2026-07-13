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
}
