<?php
/**
 * Tests for `openstation_sanitize_os_settings()` — the gatekeeper
 * between the JS layer and user meta. A field that's not in the
 * sanitizer's allow-list silently disappears on every round-trip,
 * which is the bug class this file is meant to catch.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-settings
 */
class Tests_OpenStation_OsSettings extends WP_UnitTestCase {

	/**
	 * @covers ::openstation_default_os_settings
	 */
	public function test_default_includes_desktop_layout() {
		$defaults = openstation_default_os_settings();
		$this->assertArrayHasKey( 'desktopLayout', $defaults );
		$this->assertSame( 'unified', $defaults['desktopLayout'] );
	}

	/**
	 * The single dock ships on the bottom edge.
	 *
	 * @covers ::openstation_default_os_settings
	 */
	public function test_default_dock_placement_is_bottom() {
		$defaults = openstation_default_os_settings();
		$this->assertArrayHasKey( 'dockPlacement', $defaults );
		$this->assertSame( 'bottom', $defaults['dockPlacement'] );
	}

	/**
	 * A desktop whose navigation is consolidated into one dock has no
	 * second place for navigation to live, so the admin bar ships
	 * hidden. The dock's Exit tile is the way back to classic admin.
	 *
	 * @covers ::openstation_default_os_settings
	 */
	public function test_default_admin_bar_mode_is_hidden() {
		$defaults = openstation_default_os_settings();
		$this->assertArrayHasKey( 'adminBarMode', $defaults );
		$this->assertSame( 'hidden', $defaults['adminBarMode'] );
	}

	/**
	 * @covers ::openstation_sanitize_os_settings
	 */
	public function test_sanitize_keeps_known_admin_bar_mode() {
		foreach ( OPENSTATION_OS_SETTINGS_ADMIN_BAR_MODES as $mode ) {
			$clean = openstation_sanitize_os_settings( array( 'adminBarMode' => $mode ) );
			$this->assertSame( $mode, $clean['adminBarMode'], "mode '{$mode}' should round-trip" );
		}
	}

	/**
	 * An unusable value must not survive into user meta — the shell
	 * would emit `os-admin-bar-<junk>`, which matches no
	 * rule, and the bar would silently render static while the
	 * picker showed something else.
	 *
	 * @covers ::openstation_sanitize_os_settings
	 */
	public function test_sanitize_falls_back_to_default_for_unknown_admin_bar_mode() {
		$clean = openstation_sanitize_os_settings( array( 'adminBarMode' => 'peekaboo' ) );
		$this->assertSame( 'hidden', $clean['adminBarMode'] );
	}

	/**
	 * @covers ::openstation_sanitize_os_settings
	 */
	public function test_sanitize_falls_back_when_admin_bar_mode_missing() {
		$clean = openstation_sanitize_os_settings( array( 'wallpaper' => 'dark' ) );
		$this->assertSame( 'hidden', $clean['adminBarMode'] );
	}

	/**
	 * @covers ::openstation_sanitize_os_settings
	 */
	public function test_sanitize_keeps_known_layout_value() {
		foreach ( array( 'classic', 'unified' ) as $layout ) {
			$clean = openstation_sanitize_os_settings( array( 'desktopLayout' => $layout ) );
			$this->assertSame( $layout, $clean['desktopLayout'], "layout '{$layout}' should round-trip" );
		}
	}

	/**
	 * @covers ::openstation_sanitize_os_settings
	 */
	public function test_sanitize_falls_back_to_default_for_unknown_layout() {
		$clean = openstation_sanitize_os_settings( array( 'desktopLayout' => 'invalid-mode' ) );
		$this->assertSame( 'unified', $clean['desktopLayout'] );
	}

	/**
	 * @covers ::openstation_sanitize_os_settings
	 */
	public function test_sanitize_falls_back_when_layout_missing() {
		$clean = openstation_sanitize_os_settings( array( 'wallpaper' => 'dark' ) );
		$this->assertSame( 'unified', $clean['desktopLayout'] );
	}

	/**
	 * @covers ::openstation_sanitize_os_settings
	 */
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

	/**
	 * An unusable edge must not survive into user meta: the dock writes
	 * the value straight into `data-os-dock-placement`, which
	 * matches none of the placement rules, and the rail would render
	 * unpositioned.
	 *
	 * @covers ::openstation_sanitize_os_settings
	 */
	public function test_sanitize_falls_back_to_default_for_unknown_dock_placement() {
		$clean = openstation_sanitize_os_settings( array( 'dockPlacement' => 'ceiling' ) );
		$this->assertSame( 'bottom', $clean['dockPlacement'] );
	}

	/**
	 * @covers ::openstation_save_os_settings
	 * @covers ::openstation_get_os_settings
	 */
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

	/**
	 * Round-trip via user meta: a real `update_user_meta` write
	 * followed by `get_user_meta` must preserve `desktopLayout`.
	 * This is the regression that drove the fix — the JS layer was
	 * silently re-defaulting to the shipped layout on refresh because the
	 * sanitizer was dropping the field.
	 *
	 * @covers ::openstation_save_os_settings
	 * @covers ::openstation_get_os_settings
	 */
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


	// ----------------------------------------------------------
	// dockRailRenderer — renderers register at runtime from JS,
	// so the sanitize step accepts any sanitize_key()-clean id;
	// resolution falls back to `'default'` at use time.
	// ----------------------------------------------------------

	/**
	 * @covers ::openstation_default_os_settings
	 */
	public function test_default_includes_dock_rail_renderer() {
		$defaults = openstation_default_os_settings();
		$this->assertArrayHasKey( 'dockRailRenderer', $defaults );
		$this->assertSame( 'default', $defaults['dockRailRenderer'] );
	}

	/**
	 * @covers ::openstation_sanitize_os_settings
	 */
	public function test_sanitize_keeps_well_formed_dock_rail_renderer() {
		$clean = openstation_sanitize_os_settings(
			array( 'dockRailRenderer' => 'my-ring' )
		);
		$this->assertSame( 'my-ring', $clean['dockRailRenderer'] );
	}

	/**
	 * @covers ::openstation_save_os_settings
	 * @covers ::openstation_get_os_settings
	 */
	public function test_user_meta_round_trip_keeps_dock_rail_renderer() {
		$user_id = self::factory()->user->create();
		openstation_save_os_settings(
			$user_id,
			array( 'dockRailRenderer' => 'fan' )
		);
		$loaded = openstation_get_os_settings( $user_id );
		$this->assertSame( 'fan', $loaded['dockRailRenderer'] );
	}

	/**
	 * @covers ::openstation_default_os_settings
	 */
	public function test_default_ai_assistant_is_opt_in() {
		$defaults = openstation_default_os_settings();
		$this->assertFalse( $defaults['ai']['enabled'] );
	}

	/**
	 * @covers ::openstation_sanitize_os_settings
	 */
	public function test_sanitize_keeps_ai_enabled_toggle() {
		$clean = openstation_sanitize_os_settings(
			array( 'ai' => array( 'enabled' => true ) )
		);
		$this->assertTrue( $clean['ai']['enabled'] );
	}

	/**
	 * @covers ::openstation_sanitize_os_settings
	 */
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

	// ────────────────────────────────────────────────────────────────
	// dockPromotedPositions — persisted x/y for dock-item icons the
	// user promoted to the desktop wallpaper.
	// ────────────────────────────────────────────────────────────────

	/**
	 * @covers ::openstation_default_os_settings
	 */
	public function test_default_includes_empty_dock_promoted_positions() {
		$defaults = openstation_default_os_settings();
		$this->assertArrayHasKey( 'dockPromotedPositions', $defaults );
		$this->assertSame( array(), $defaults['dockPromotedPositions'] );
	}

	/**
	 * @covers ::openstation_sanitize_os_settings
	 */
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

	/**
	 * Slugs go through `sanitize_key()`, so values from an evil JSON
	 * blob with spaces / uppercase get normalized rather than passed
	 * through verbatim.
	 *
	 * @covers ::openstation_sanitize_os_settings
	 */
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

	/**
	 * Non-numeric / missing coords are dropped — the JS shouldn't
	 * receive a half-shaped position that would crash the synthesizer.
	 *
	 * @covers ::openstation_sanitize_os_settings
	 */
	public function test_sanitize_drops_malformed_dock_promoted_position_values() {
		$clean = openstation_sanitize_os_settings(
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
	 * @covers ::openstation_sanitize_os_settings
	 */
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

	/**
	 * Cap-at-256 prevents an evil blob from ballooning user meta.
	 *
	 * @covers ::openstation_sanitize_os_settings
	 */
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

	/**
	 * dockOrder entries may carry a rail-synthesis prefix
	 * (`desktop:<id>` / `dock:<id>`) for cross-rail tiles the user
	 * promoted. `sanitize_key()` would strip the colon and silently
	 * break the JS order match (and risk an id collision) on reload, so
	 * the sanitizer must preserve it.
	 *
	 * @covers ::openstation_sanitize_os_settings
	 */
	public function test_sanitize_preserves_rail_prefix_colon_in_dock_order() {
		$clean = openstation_sanitize_os_settings(
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
	 * @covers ::openstation_sanitize_os_settings
	 */
	public function test_sanitize_normalizes_dock_order_ids() {
		$clean = openstation_sanitize_os_settings(
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
	 * @covers ::openstation_default_os_settings
	 */
	public function test_default_developer_mode_is_off() {
		$defaults = openstation_default_os_settings();
		$this->assertArrayHasKey( 'developerModeEnabled', $defaults );
		$this->assertFalse( $defaults['developerModeEnabled'] );
	}

	/**
	 * @covers ::openstation_sanitize_os_settings
	 */
	public function test_sanitize_keeps_developer_mode_enabled_true() {
		$clean = openstation_sanitize_os_settings( array( 'developerModeEnabled' => true ) );
		$this->assertTrue( $clean['developerModeEnabled'] );
	}

	/**
	 * @covers ::openstation_sanitize_os_settings
	 */
	public function test_sanitize_falls_back_to_default_when_developer_mode_missing() {
		$clean = openstation_sanitize_os_settings( array( 'wallpaper' => 'dark' ) );
		$this->assertFalse( $clean['developerModeEnabled'] );
	}

	/**
	 * @covers ::openstation_save_os_settings
	 * @covers ::openstation_get_os_settings
	 */
	public function test_user_meta_round_trip_keeps_developer_mode_enabled() {
		$user_id = self::factory()->user->create();
		openstation_save_os_settings(
			$user_id,
			array( 'developerModeEnabled' => true )
		);
		$loaded = openstation_get_os_settings( $user_id );
		$this->assertTrue( $loaded['developerModeEnabled'] );
	}

	// ────────────────────────────────────────────────────────────────
	// windowReveal — the clip-path transition that uncovers a window's
	// content once it finishes loading. Ids follow the JS registry
	// charset (slashes for vendor/sub-id) and are deliberately NOT
	// allow-listed: the JS surface resolves at play time and treats an
	// unknown id as "no reveal", so a reveal belonging to a
	// temporarily-deactivated plugin survives the round-trip.
	// ────────────────────────────────────────────────────────────────

	/**
	 * @covers ::openstation_default_os_settings
	 */
	public function test_default_window_reveal_is_off() {
		$defaults = openstation_default_os_settings();
		// A reveal plays on every window load, so it is the user's to
		// opt into rather than something the shell turns on for them.
		$this->assertSame( 'none', $defaults['windowReveal'] );
	}

	/**
	 * @covers ::openstation_sanitize_os_settings
	 */
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

	/**
	 * @covers ::openstation_sanitize_os_settings
	 */
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

	/**
	 * @covers ::openstation_sanitize_os_settings
	 */
	public function test_sanitize_strips_bad_window_reveal_chars() {
		$clean = openstation_sanitize_os_settings(
			array( 'windowReveal' => 'Iris Wipe!<script>' )
		);
		// Uppercase folds, everything outside [a-z0-9_/-] drops.
		$this->assertSame( 'iriswipescript', $clean['windowReveal'] );

		// Nothing left after stripping falls back to the default rather
		// than persisting an empty id.
		$clean = openstation_sanitize_os_settings(
			array( 'windowReveal' => '!!!' )
		);
		$this->assertSame( 'none', $clean['windowReveal'] );
	}

	/**
	 * @covers ::openstation_sanitize_os_settings
	 */
	public function test_sanitize_window_reveal_rejects_non_string() {
		$clean = openstation_sanitize_os_settings(
			array( 'windowReveal' => array( 'iris' ) )
		);
		$this->assertSame( 'none', $clean['windowReveal'] );
	}

	/**
	 * @covers ::openstation_default_os_settings
	 */
	public function test_default_window_reveal_duration_is_per_reveal() {
		$defaults = openstation_default_os_settings();
		// 0 is the "no override" sentinel — every reveal keeps the
		// duration its own def asked for.
		$this->assertSame( 0, $defaults['windowRevealDuration'] );
	}

	/**
	 * @covers ::openstation_sanitize_os_settings
	 */
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

	/**
	 * @covers ::openstation_sanitize_os_settings
	 */
	public function test_sanitize_window_reveal_duration_keeps_the_zero_sentinel() {
		// 0 is a real value, not a missing one: it means "per reveal".
		// Clamping it up to the minimum would silently take the choice
		// away from anyone who picked "Default".
		$clean = openstation_sanitize_os_settings(
			array( 'windowRevealDuration' => 0 )
		);
		$this->assertSame( 0, $clean['windowRevealDuration'] );

		$clean = openstation_sanitize_os_settings(
			array( 'windowRevealDuration' => -40 )
		);
		$this->assertSame( 0, $clean['windowRevealDuration'] );
	}

	/**
	 * @covers ::openstation_sanitize_os_settings
	 */
	public function test_sanitize_window_reveal_duration_rejects_non_numeric() {
		$clean = openstation_sanitize_os_settings(
			array( 'windowRevealDuration' => 'fast' )
		);
		$this->assertSame( 0, $clean['windowRevealDuration'] );
	}

	/**
	 * The setting has to survive a save → load round-trip through user
	 * meta, since that is the path the shell actually reads at boot.
	 *
	 * @covers ::openstation_get_os_settings
	 */
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

	// ────────────────────────────────────────────────────────────────
	// windowLinkRenderer / windowLinkVisibility — how (and when) the
	// relation ties between related windows are drawn. Renderer ids
	// follow the JS registry charset (slashes for vendor/sub-id);
	// visibility is a small closed set.
	// ────────────────────────────────────────────────────────────────

	/**
	 * @covers ::openstation_default_os_settings
	 */
	public function test_default_window_link_settings() {
		$defaults = openstation_default_os_settings();
		$this->assertSame( 'svg-splines', $defaults['windowLinkRenderer'] );
		$this->assertSame( 'always', $defaults['windowLinkVisibility'] );
	}

	/**
	 * @covers ::openstation_sanitize_os_settings
	 */
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

	/**
	 * @covers ::openstation_sanitize_os_settings
	 */
	public function test_sanitize_strips_bad_window_link_renderer_chars() {
		$clean = openstation_sanitize_os_settings(
			array( 'windowLinkRenderer' => 'SVG Splines!<script>' )
		);
		// Uppercase folds, everything outside [a-z0-9_/-] drops.
		$this->assertSame( 'svgsplinesscript', $clean['windowLinkRenderer'] );

		$clean = openstation_sanitize_os_settings(
			array( 'windowLinkRenderer' => '!!!' )
		);
		$this->assertSame( 'svg-splines', $clean['windowLinkRenderer'] );
	}

	/**
	 * @covers ::openstation_sanitize_os_settings
	 */
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

	/**
	 * @covers ::openstation_save_os_settings
	 * @covers ::openstation_get_os_settings
	 */
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

	/**
	 * @covers ::openstation_default_os_settings
	 * @covers ::openstation_sanitize_os_settings
	 */
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

		// Missing keys fall back to defaults.
		$clean = openstation_sanitize_os_settings( array( 'wallpaper' => 'dark' ) );
		$this->assertTrue( $clean['windowLinksEnabled'] );
	}

	/**
	 * @covers ::openstation_save_os_settings
	 * @covers ::openstation_get_os_settings
	 */
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

	/**
	 * @covers ::openstation_default_os_settings
	 */
	public function test_default_includes_empty_wallpaper_settings() {
		$defaults = openstation_default_os_settings();
		$this->assertArrayHasKey( 'wallpaperSettings', $defaults );
		$this->assertSame( array(), $defaults['wallpaperSettings'] );
	}

	/**
	 * @covers ::openstation_sanitize_os_settings
	 */
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
	 * @covers ::openstation_sanitize_os_settings
	 */
	public function test_sanitize_drops_malformed_wallpaper_settings() {
		$clean = openstation_sanitize_os_settings(
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
		$clean = openstation_sanitize_os_settings( array( 'wallpaperSettings' => 'bogus' ) );
		$this->assertSame( array(), $clean['wallpaperSettings'] );
	}

	/**
	 * @covers ::openstation_sanitize_os_settings
	 */
	public function test_sanitize_caps_and_trims_wallpaper_settings() {
		// String values are length-capped at 256 characters.
		$clean = openstation_sanitize_os_settings(
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
		$clean = openstation_sanitize_os_settings( array( 'wallpaperSettings' => $many ) );
		$this->assertCount( 64, $clean['wallpaperSettings'] );

		// Keys per bag cap at 32.
		$bag = array();
		for ( $i = 0; $i < 40; $i++ ) {
			$bag[ 'k' . $i ] = $i;
		}
		$clean = openstation_sanitize_os_settings(
			array( 'wallpaperSettings' => array( 'wp-snow' => $bag ) )
		);
		$this->assertCount( 32, $clean['wallpaperSettings']['wp-snow'] );
	}

	/**
	 * @covers ::openstation_save_os_settings
	 * @covers ::openstation_get_os_settings
	 */
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
