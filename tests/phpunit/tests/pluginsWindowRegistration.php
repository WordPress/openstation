<?php
/**
 * Tests for the native Plugins window's PHP registration + cap gates.
 *
 * The Plugins window is gated on `activate_plugins` (broad gate) plus
 * the `nativePluginsEnabled` opt-out toggle. Per-action mutation caps
 * (`install_plugins`, `delete_plugins`, `upload_plugins`) are
 * enforced inside the AJAX callbacks themselves; these tests cover
 * the registration gate + the per-row capability surface
 * (`open_station_plugins_window_caps`).
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-plugins-window
 */
class Tests_OpenStation_PluginsWindowRegistration extends WP_UnitTestCase {

	private $admin_id;
	private $editor_id;
	private $subscriber_id;

	public function set_up() {
		parent::set_up();

		$this->admin_id      = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$this->editor_id     = self::factory()->user->create( array( 'role' => 'editor' ) );
		$this->subscriber_id = self::factory()->user->create( array( 'role' => 'subscriber' ) );
	}

	public function tear_down() {
		// Make sure no test leaks an opt-in state into the next.
		remove_all_filters( 'open_station_plugins_window_user_can_register' );
		remove_all_filters( 'open_station_plugins_window_user_can_use' );
		remove_all_filters( 'open_station_plugins_window_auto_updates_enabled' );
		remove_all_filters( 'open_station_plugins_window_refresh_updates' );
		remove_all_filters( 'open_station_plugins_window_icon_url' );
		remove_all_filters( 'open_station_plugins_window_local_icon_candidates' );
		remove_all_filters( 'auto_update_plugin' );
		parent::tear_down();
	}

	// ----------------------------------------------------------------
	// `_user_can_register` — cap-only gate. Decoupled from the opt-in
	// so flipping the OS-Settings toggle takes effect mid-session.
	// ----------------------------------------------------------------

	/**
	 * @covers ::open_station_plugins_window_user_can_register
	 */
	public function test_register_gate_open_for_admin_without_opt_in() {
		wp_set_current_user( $this->admin_id );
		$this->assertTrue( open_station_plugins_window_user_can_register() );
	}

	/**
	 * @covers ::open_station_plugins_window_user_can_register
	 */
	public function test_register_gate_closed_for_editor() {
		// Editors don't have `activate_plugins` on a single-site install.
		wp_set_current_user( $this->editor_id );
		$this->assertFalse( open_station_plugins_window_user_can_register() );
	}

	/**
	 * @covers ::open_station_plugins_window_user_can_register
	 */
	public function test_register_gate_closed_for_subscriber() {
		wp_set_current_user( $this->subscriber_id );
		$this->assertFalse( open_station_plugins_window_user_can_register() );
	}

	/**
	 * @covers ::open_station_plugins_window_user_can_register
	 */
	public function test_register_gate_closed_for_logged_out_user() {
		wp_set_current_user( 0 );
		$this->assertFalse( open_station_plugins_window_user_can_register() );
	}

	/**
	 * @covers ::open_station_plugins_window_user_can_register
	 */
	public function test_register_filter_can_block_a_capable_user() {
		wp_set_current_user( $this->admin_id );
		add_filter( 'open_station_plugins_window_user_can_register', '__return_false' );
		$this->assertFalse( open_station_plugins_window_user_can_register() );
	}

	// ----------------------------------------------------------------
	// `_user_can_use` — combined cap + opt-in.
	// ----------------------------------------------------------------

	/**
	 * Opt-in Beta: an admin who has not turned the native
	 * Plugins window on gets the classic iframe. Opting in opens the gate.
	 *
	 * @covers ::open_station_plugins_window_user_can_use
	 */
	public function test_gate_closed_by_default_until_admin_opts_in() {
		wp_set_current_user( $this->admin_id );
		$this->assertFalse( open_station_plugins_window_user_can_use() );

		open_station_save_os_settings(
			$this->admin_id,
			array( 'nativePluginsEnabled' => true )
		);
		$this->assertTrue( open_station_plugins_window_user_can_use() );
	}

	/**
	 * @covers ::open_station_plugins_window_user_can_use
	 */
	public function test_gate_closes_when_admin_opts_out() {
		wp_set_current_user( $this->admin_id );
		open_station_save_os_settings(
			$this->admin_id,
			array( 'nativePluginsEnabled' => false )
		);
		$this->assertFalse( open_station_plugins_window_user_can_use() );
	}

	/**
	 * @covers ::open_station_plugins_window_user_can_use
	 */
	public function test_gate_closed_for_logged_out_user() {
		wp_set_current_user( 0 );
		$this->assertFalse( open_station_plugins_window_user_can_use() );
	}

	/**
	 * @covers ::open_station_plugins_window_user_can_use
	 */
	public function test_filter_can_force_gate_open() {
		wp_set_current_user( $this->editor_id );
		// Editor lacks `activate_plugins` — default would be closed.
		$this->assertFalse( open_station_plugins_window_user_can_use() );

		add_filter( 'open_station_plugins_window_user_can_use', '__return_true' );
		$this->assertTrue( open_station_plugins_window_user_can_use() );
	}

	/**
	 * @covers ::open_station_plugins_window_user_can_use
	 */
	public function test_filter_can_force_gate_closed() {
		wp_set_current_user( $this->admin_id );
		add_filter( 'open_station_plugins_window_user_can_use', '__return_false' );
		$this->assertFalse( open_station_plugins_window_user_can_use() );
	}

	// ----------------------------------------------------------------
	// `_caps` — per-action capability surface.
	// ----------------------------------------------------------------

	/**
	 * @covers ::open_station_plugins_window_caps
	 */
	public function test_caps_admin_has_every_action() {
		wp_set_current_user( $this->admin_id );
		$caps = open_station_plugins_window_caps();
		$this->assertTrue( $caps['activate'] );
		$this->assertTrue( $caps['install'] );
		$this->assertTrue( $caps['delete'] );
		$this->assertTrue( $caps['upload'] );
	}

	/**
	 * @covers ::open_station_plugins_window_caps
	 */
	public function test_caps_editor_has_no_plugin_actions() {
		wp_set_current_user( $this->editor_id );
		$caps = open_station_plugins_window_caps();
		$this->assertFalse( $caps['activate'] );
		$this->assertFalse( $caps['install'] );
		$this->assertFalse( $caps['delete'] );
		$this->assertFalse( $caps['upload'] );
	}

	/**
	 * @covers ::open_station_plugins_window_caps
	 */
	public function test_caps_logged_out_user_returns_false_for_every_action() {
		wp_set_current_user( 0 );
		$caps = open_station_plugins_window_caps();
		$this->assertFalse( $caps['activate'] );
		$this->assertFalse( $caps['install'] );
		$this->assertFalse( $caps['delete'] );
		$this->assertFalse( $caps['upload'] );
	}

	/**
	 * The OS Settings opt-out flag must round-trip through sanitize +
	 * load — a regression that drops the key on save would silently
	 * unset every user who toggled the setting off.
	 *
	 * @covers ::open_station_save_os_settings
	 * @covers ::open_station_get_os_settings
	 */
	public function test_native_plugins_enabled_round_trips_through_os_settings() {
		open_station_save_os_settings(
			$this->admin_id,
			array( 'nativePluginsEnabled' => false )
		);
		$loaded = open_station_get_os_settings( $this->admin_id );
		$this->assertArrayHasKey( 'nativePluginsEnabled', $loaded );
		$this->assertFalse( $loaded['nativePluginsEnabled'] );

		open_station_save_os_settings(
			$this->admin_id,
			array( 'nativePluginsEnabled' => true )
		);
		$loaded = open_station_get_os_settings( $this->admin_id );
		$this->assertTrue( $loaded['nativePluginsEnabled'] );
	}

	/**
	 * Default OS Settings payload must include the flag with its
	 * documented default (false / opt-in Beta).
	 *
	 * @covers ::open_station_default_os_settings
	 */
	public function test_native_plugins_enabled_defaults_off() {
		$defaults = open_station_default_os_settings();
		$this->assertArrayHasKey( 'nativePluginsEnabled', $defaults );
		$this->assertFalse( $defaults['nativePluginsEnabled'] );
	}

	/**
	 * REST-field decorator output for `open_station_can_manage` must
	 * encode the per-row state correctly: an active plugin can be
	 * deactivated but not deleted; an inactive plugin can be activated
	 * AND deleted.
	 *
	 * @covers ::open_station_plugins_window_field_can_manage
	 */
	public function test_can_manage_field_for_active_plugin_row() {
		wp_set_current_user( $this->admin_id );
		$row = array(
			'plugin' => 'fake/fake.php',
			'status' => 'active',
		);
		$flags = open_station_plugins_window_field_can_manage( $row );
		$this->assertFalse( $flags['activate'] );
		$this->assertTrue( $flags['deactivate'] );
		$this->assertFalse( $flags['delete'] );
	}

	/**
	 * @covers ::open_station_plugins_window_field_can_manage
	 */
	public function test_can_manage_field_for_inactive_plugin_row() {
		wp_set_current_user( $this->admin_id );
		$row = array(
			'plugin' => 'fake/fake.php',
			'status' => 'inactive',
		);
		$flags = open_station_plugins_window_field_can_manage( $row );
		$this->assertTrue( $flags['activate'] );
		$this->assertFalse( $flags['deactivate'] );
		$this->assertTrue( $flags['delete'] );
	}

	/**
	 * Update-available decorator should report `false` when the
	 * `update_plugins` transient has no entry for the row.
	 *
	 * @covers ::open_station_plugins_window_field_update_available
	 */
	public function test_update_available_field_reports_false_when_no_update() {
		// Force a clean state — the test bootstrap may have populated
		// the transient with whatever the install last fetched. Stamp
		// `last_checked` to now so the lazy refresh helper short-
		// circuits (we don't want a wp.org HTTP call from the test
		// suite).
		set_site_transient(
			'update_plugins',
			(object) array(
				'last_checked' => time(),
				'response'     => array(),
			)
		);
		$row = array( 'plugin' => 'never/installed.php' );
		$out = open_station_plugins_window_field_update_available( $row );
		$this->assertFalse( $out['available'] );
		$this->assertNull( $out['new_version'] );
	}

	/**
	 * Regression: when the `update_plugins` transient HAS an entry
	 * for the row, the decorator must report `available: true` plus
	 * the available version — this is what feeds the "Update
	 * available" filter and the inline Update action.
	 *
	 * @covers ::open_station_plugins_window_field_update_available
	 */
	public function test_update_available_field_reports_true_when_transient_has_entry() {
		set_site_transient(
			'update_plugins',
			(object) array(
				'last_checked' => time(),
				'response'     => array(
					// Transients key plugin files by their FULL path
					// including the `.php` extension.
					'hello-dolly/hello.php' => (object) array(
						'new_version' => '99.0.0',
						'package'     => 'https://downloads.wordpress.org/plugin/hello-dolly.99.0.0.zip',
						'slug'        => 'hello-dolly',
					),
				),
			)
		);
		// Core's REST controller strips the `.php` extension from the
		// `plugin` field — this row mirrors what we actually receive.
		// Asserting on this shape guards against future regressions of
		// the "transient lookup misses because of the `.php` strip" bug.
		$row = array( 'plugin' => 'hello-dolly/hello' );
		$out = open_station_plugins_window_field_update_available( $row );
		$this->assertTrue( $out['available'] );
		$this->assertSame( '99.0.0', $out['new_version'] );
		$this->assertSame(
			'https://downloads.wordpress.org/plugin/hello-dolly.99.0.0.zip',
			$out['package'],
			'`package` is the download URL the JS gates the Update button on.'
		);
		$this->assertSame( 'hello-dolly', $out['slug'] );
	}

	/**
	 * Plugins without a `package` URL (premium / private hosts) should
	 * still be flagged `available: true`, but the empty `package`
	 * signals to the JS to surface the "Auto-update unavailable" hint
	 * rather than the "Update now" button — mirrors Core's own
	 * fallback in `wp_plugin_update_row()`.
	 *
	 * @covers ::open_station_plugins_window_field_update_available
	 */
	public function test_update_available_field_handles_missing_package() {
		set_site_transient(
			'update_plugins',
			(object) array(
				'last_checked' => time(),
				'response'     => array(
					'premium/premium.php' => (object) array(
						'new_version' => '2.0',
						// no `package` — premium plugin without a wp.org zip.
					),
				),
			)
		);
		$row = array( 'plugin' => 'premium/premium' );
		$out = open_station_plugins_window_field_update_available( $row );
		$this->assertTrue( $out['available'] );
		$this->assertSame( '2.0', $out['new_version'] );
		$this->assertSame( '', $out['package'] );
	}

	/**
	 * The Plugins-window caps surface must expose the `update_plugins`
	 * cap so the JS can hide / show the Update action without
	 * re-deriving caps client-side. Server still re-validates every
	 * update through `wp_ajax_update_plugin`.
	 *
	 * @covers ::open_station_plugins_window_caps
	 */
	public function test_caps_surface_includes_update_for_admins() {
		wp_set_current_user( $this->admin_id );
		$caps = open_station_plugins_window_caps();
		$this->assertArrayHasKey( 'update', $caps );
		$this->assertTrue( $caps['update'] );
	}

	/**
	 * @covers ::open_station_plugins_window_caps
	 */
	public function test_caps_surface_denies_update_for_editor() {
		wp_set_current_user( $this->editor_id );
		$caps = open_station_plugins_window_caps();
		$this->assertFalse( $caps['update'] );
	}

	/**
	 * The lazy refresh helper must respect Core's 12h throttle: when
	 * the transient was checked under 12h ago, it must NOT clobber
	 * the cached snapshot (otherwise every REST hit could chain a
	 * wp.org HTTPS round-trip).
	 *
	 * @covers ::open_station_plugins_window_maybe_refresh_update_transient
	 */
	public function test_maybe_refresh_respects_12h_throttle() {
		$snapshot = (object) array(
			'last_checked' => time() - 60, // 1 minute ago.
			'response'     => array( 'foo/foo.php' => (object) array( 'new_version' => '2.0' ) ),
		);
		set_site_transient( 'update_plugins', $snapshot );

		open_station_plugins_window_maybe_refresh_update_transient();

		$after = get_site_transient( 'update_plugins' );
		$this->assertEquals( $snapshot, $after, 'Fresh transient should not be refreshed.' );
	}

	/**
	 * The `open_station_plugins_window_refresh_updates` filter must
	 * be able to opt a site out of the lazy refresh entirely — even
	 * when the cached snapshot is well over 12h old.
	 *
	 * @covers ::open_station_plugins_window_maybe_refresh_update_transient
	 */
	public function test_maybe_refresh_filter_can_opt_out() {
		$snapshot = (object) array(
			'last_checked' => time() - DAY_IN_SECONDS, // way past 12h.
			'response'     => array(),
		);
		set_site_transient( 'update_plugins', $snapshot );

		add_filter( 'open_station_plugins_window_refresh_updates', '__return_false' );
		open_station_plugins_window_maybe_refresh_update_transient();
		remove_filter( 'open_station_plugins_window_refresh_updates', '__return_false' );

		$after = get_site_transient( 'update_plugins' );
		$this->assertEquals(
			$snapshot,
			$after,
			'Filter returning false should skip the refresh and leave the stale snapshot untouched.'
		);
	}

	/**
	 * `open_station_icon_url` should derive a wp.org icon URL from the
	 * plugin's folder name — the wp.org repo slug. Textdomain is a
	 * fallback only for single-file plugins.
	 *
	 * @covers ::open_station_plugins_window_field_icon_url
	 */
	public function test_icon_url_derives_from_folder_slug() {
		$row = array(
			'plugin'     => 'akismet/akismet.php',
			'textdomain' => 'akismet',
		);
		$url = open_station_plugins_window_field_icon_url( $row );
		$this->assertSame(
			'https://ps.w.org/akismet/assets/icon.svg',
			$url
		);
	}

	/**
	 * Folder name and textdomain often diverge (e.g. WooCommerce ships
	 * folder `woocommerce` but text domain `woo`). The .org repo URL
	 * is keyed on the folder, so that's what we must use.
	 *
	 * @covers ::open_station_plugins_window_field_icon_url
	 */
	public function test_icon_url_prefers_folder_over_mismatched_textdomain() {
		$row = array(
			'plugin'     => 'woocommerce/woocommerce.php',
			'textdomain' => 'woo',
		);
		$url = open_station_plugins_window_field_icon_url( $row );
		$this->assertSame(
			'https://ps.w.org/woocommerce/assets/icon.svg',
			$url
		);
	}

	/**
	 * Plugins with no `Text Domain:` header still resolve via folder
	 * name — the dominant cause of the "blank icon" regression that
	 * the textdomain-only resolver produced.
	 *
	 * @covers ::open_station_plugins_window_field_icon_url
	 */
	public function test_icon_url_works_without_textdomain() {
		$row = array( 'plugin' => 'something/something.php' );
		$this->assertSame(
			'https://ps.w.org/something/assets/icon.svg',
			open_station_plugins_window_field_icon_url( $row )
		);
	}

	/**
	 * Single-file plugins (no folder) fall back to textdomain. With
	 * neither folder nor textdomain available, the field is null and
	 * JS paints the placeholder.
	 *
	 * @covers ::open_station_plugins_window_field_icon_url
	 */
	public function test_icon_url_single_file_uses_textdomain_fallback() {
		$row = array(
			'plugin'     => 'hello.php',
			'textdomain' => 'hello-dolly',
		);
		$this->assertSame(
			'https://ps.w.org/hello-dolly/assets/icon.svg',
			open_station_plugins_window_field_icon_url( $row )
		);

		$this->assertNull(
			open_station_plugins_window_field_icon_url( array( 'plugin' => 'hello.php' ) )
		);
	}

	/**
	 * @covers ::open_station_plugins_window_field_icon_url
	 */
	public function test_icon_url_filter_can_override() {
		add_filter(
			'open_station_plugins_window_icon_url',
			static function ( $url, $slug ) {
				return 'https://cdn.example.com/' . $slug . '.png';
			},
			10,
			2
		);
		$row = array(
			'plugin'     => 'custom/custom.php',
			'textdomain' => 'custom',
		);
		$url = open_station_plugins_window_field_icon_url( $row );
		$this->assertSame( 'https://cdn.example.com/custom.png', $url );
		remove_all_filters( 'open_station_plugins_window_icon_url' );
	}

	/**
	 * Plugins that ship their own card icon inside their folder (the
	 * common shape for premium / internal / native-bundled plugins
	 * not on the .org repo) should resolve to the LOCAL URL — not the
	 * wp.org SVN URL that would 404 through every fallback variant.
	 *
	 * @covers ::open_station_plugins_window_field_icon_url
	 * @covers ::open_station_plugins_window_local_icon_url
	 */
	public function test_icon_url_prefers_local_assets_icon_svg() {
		$folder = 'dm-local-icon-fixture';
		$root   = WP_PLUGIN_DIR . '/' . $folder;
		wp_mkdir_p( $root . '/assets' );
		file_put_contents( $root . '/assets/icon.svg', '<svg/>' );

		try {
			$url = open_station_plugins_window_field_icon_url(
				array( 'plugin' => $folder . '/' . $folder . '.php' )
			);
			$this->assertSame(
				plugins_url( 'assets/icon.svg', WP_PLUGIN_DIR . '/' . $folder . '/' . $folder . '.php' ),
				$url
			);
			$this->assertStringContainsString( '/' . $folder . '/assets/icon.svg', (string) $url );
		} finally {
			unlink( $root . '/assets/icon.svg' );
			rmdir( $root . '/assets' );
			rmdir( $root );
		}
	}

	/**
	 * Plugins that ship only the PNG variants in their folder still
	 * resolve locally. The probe walks SVG → 256 PNG → 128 PNG
	 * (mirroring the wp.org SVN convention) and returns the first hit.
	 *
	 * @covers ::open_station_plugins_window_local_icon_url
	 */
	public function test_icon_url_falls_through_to_local_png_variants() {
		$folder = 'dm-local-icon-png-fixture';
		$root   = WP_PLUGIN_DIR . '/' . $folder;
		wp_mkdir_p( $root . '/assets' );
		file_put_contents( $root . '/assets/icon-256x256.png', 'png' );

		try {
			$url = open_station_plugins_window_field_icon_url(
				array( 'plugin' => $folder . '/' . $folder . '.php' )
			);
			$this->assertStringContainsString( '/' . $folder . '/assets/icon-256x256.png', (string) $url );
		} finally {
			unlink( $root . '/assets/icon-256x256.png' );
			rmdir( $root . '/assets' );
			rmdir( $root );
		}
	}

	/**
	 * When the plugin folder ships no recognizable icon, fall back to
	 * the wp.org SVN URL — the original behavior. This is the
	 * regression guard for the 90 % of installed plugins that are on
	 * the .org repo and use the SVN /assets/ layout (not the plugin
	 * folder's /assets/).
	 *
	 * @covers ::open_station_plugins_window_field_icon_url
	 * @covers ::open_station_plugins_window_local_icon_url
	 */
	public function test_icon_url_falls_back_to_wp_org_when_no_local_icon() {
		// Use a folder name very unlikely to exist on disk.
		$row = array( 'plugin' => 'this-plugin-folder-does-not-exist-on-disk/main.php' );
		$this->assertSame(
			'https://ps.w.org/this-plugin-folder-does-not-exist-on-disk/assets/icon.svg',
			open_station_plugins_window_field_icon_url( $row )
		);
	}

	/**
	 * The `open_station_plugins_window_local_icon_candidates` filter
	 * lets a host support a non-standard icon convention without
	 * forking the resolver. Plugins that ship `branding/logo.svg`
	 * (or any other shape) can be picked up by appending a candidate.
	 *
	 * @covers ::open_station_plugins_window_local_icon_url
	 */
	public function test_icon_url_local_candidates_filter() {
		$folder = 'dm-local-icon-custom-fixture';
		$root   = WP_PLUGIN_DIR . '/' . $folder;
		wp_mkdir_p( $root . '/branding' );
		file_put_contents( $root . '/branding/logo.svg', '<svg/>' );

		add_filter(
			'open_station_plugins_window_local_icon_candidates',
			static function ( $candidates ) {
				$candidates[] = 'branding/logo.svg';
				return $candidates;
			}
		);

		try {
			$url = open_station_plugins_window_field_icon_url(
				array( 'plugin' => $folder . '/' . $folder . '.php' )
			);
			$this->assertStringContainsString( '/' . $folder . '/branding/logo.svg', (string) $url );
		} finally {
			remove_all_filters( 'open_station_plugins_window_local_icon_candidates' );
			unlink( $root . '/branding/logo.svg' );
			rmdir( $root . '/branding' );
			rmdir( $root );
		}
	}

	/**
	 * Single-file plugins (`hello.php`) have no folder to scan — the
	 * local probe must short-circuit and never poke the filesystem at
	 * `WP_PLUGIN_DIR/./assets/icon.svg`.
	 *
	 * @covers ::open_station_plugins_window_local_icon_url
	 */
	public function test_icon_url_single_file_plugin_skips_local_probe() {
		$this->assertNull(
			open_station_plugins_window_local_icon_url( 'hello.php' )
		);
		$this->assertNull(
			open_station_plugins_window_local_icon_url( '' )
		);
	}

	// ----------------------------------------------------------------
	// Force-refresh query-string detector — GH#202.
	// ----------------------------------------------------------------

	/**
	 * @covers ::open_station_plugins_window_force_refresh_requested
	 */
	public function test_force_refresh_detector_returns_false_when_param_absent() {
		unset( $_GET['open_station_force_refresh'] );
		$this->assertFalse( open_station_plugins_window_force_refresh_requested() );
	}

	/**
	 * @covers ::open_station_plugins_window_force_refresh_requested
	 */
	public function test_force_refresh_detector_accepts_one() {
		$_GET['open_station_force_refresh'] = '1';
		try {
			$this->assertTrue( open_station_plugins_window_force_refresh_requested() );
		} finally {
			unset( $_GET['open_station_force_refresh'] );
		}
	}

	/**
	 * @covers ::open_station_plugins_window_force_refresh_requested
	 */
	public function test_force_refresh_detector_accepts_true() {
		$_GET['open_station_force_refresh'] = 'true';
		try {
			$this->assertTrue( open_station_plugins_window_force_refresh_requested() );
		} finally {
			unset( $_GET['open_station_force_refresh'] );
		}
	}

	/**
	 * @covers ::open_station_plugins_window_force_refresh_requested
	 */
	public function test_force_refresh_detector_rejects_other_values() {
		$_GET['open_station_force_refresh'] = '0';
		try {
			$this->assertFalse( open_station_plugins_window_force_refresh_requested() );
		} finally {
			unset( $_GET['open_station_force_refresh'] );
		}
	}

	// ----------------------------------------------------------------
	// `open_station_auto_update` REST field — per-row auto-update state.
	// ----------------------------------------------------------------

	/**
	 * Plugin whose file is in the `auto_update_plugins` site option and
	 * has an entry in the `update_plugins` transient should report
	 * `enabled: true, supported: true, forced: null` — the most common
	 * happy-path shape.
	 *
	 * @covers ::open_station_plugins_window_field_auto_update
	 */
	public function test_auto_update_field_reports_enabled_when_in_option_and_supported() {
		update_site_option( 'auto_update_plugins', array( 'akismet/akismet.php' ) );
		set_site_transient(
			'update_plugins',
			(object) array(
				'last_checked' => time(),
				'response'     => array(),
				// `no_update` rows mean "checked in, no update right now" —
				// Core treats that as `update-supported`.
				'no_update'    => array(
					'akismet/akismet.php' => (object) array( 'slug' => 'akismet' ),
				),
			)
		);
		// REST controller strips `.php`.
		$row = array(
			'plugin'     => 'akismet/akismet',
			'textdomain' => 'akismet',
		);
		$out = open_station_plugins_window_field_auto_update( $row );
		$this->assertTrue( $out['enabled'] );
		$this->assertTrue( $out['supported'] );
		$this->assertNull( $out['forced'] );
	}

	/**
	 * @covers ::open_station_plugins_window_field_auto_update
	 */
	public function test_auto_update_field_reports_disabled_when_not_in_option() {
		update_site_option( 'auto_update_plugins', array() );
		set_site_transient(
			'update_plugins',
			(object) array(
				'last_checked' => time(),
				'response'     => array(),
				'no_update'    => array(
					'akismet/akismet.php' => (object) array( 'slug' => 'akismet' ),
				),
			)
		);
		$row = array(
			'plugin'     => 'akismet/akismet',
			'textdomain' => 'akismet',
		);
		$out = open_station_plugins_window_field_auto_update( $row );
		$this->assertFalse( $out['enabled'] );
		$this->assertTrue( $out['supported'] );
		$this->assertNull( $out['forced'] );
	}

	/**
	 * Plugins missing from both the `response` and `no_update` maps in
	 * the transient have `supported: false` — Core hides the toggle
	 * entirely in that case so users don't enable an auto-update that
	 * can never fire (premium / private plugins).
	 *
	 * @covers ::open_station_plugins_window_field_auto_update
	 */
	public function test_auto_update_field_reports_unsupported_when_not_in_transient() {
		update_site_option( 'auto_update_plugins', array() );
		set_site_transient(
			'update_plugins',
			(object) array(
				'last_checked' => time(),
				'response'     => array(),
				'no_update'    => array(),
			)
		);
		$row = array( 'plugin' => 'premium/premium' );
		$out = open_station_plugins_window_field_auto_update( $row );
		$this->assertFalse( $out['enabled'] );
		$this->assertFalse( $out['supported'] );
		$this->assertNull( $out['forced'] );
	}

	/**
	 * The `auto_update_plugin` filter forces the state irrespective of
	 * the site option. Mirrors Core's rendering where a forced row
	 * shows a read-only "Auto-updates enabled" label.
	 *
	 * @covers ::open_station_plugins_window_field_auto_update
	 */
	public function test_auto_update_field_respects_filter_forcing_enabled() {
		update_site_option( 'auto_update_plugins', array() );
		set_site_transient(
			'update_plugins',
			(object) array(
				'last_checked' => time(),
				'response'     => array(),
				'no_update'    => array(
					'forced/forced.php' => (object) array( 'slug' => 'forced' ),
				),
			)
		);
		$callback = static function ( $update, $item ) {
			if ( isset( $item->plugin ) && 'forced/forced.php' === $item->plugin ) {
				return true;
			}
			return $update;
		};
		add_filter( 'auto_update_plugin', $callback, 10, 2 );
		try {
			$row = array( 'plugin' => 'forced/forced' );
			$out = open_station_plugins_window_field_auto_update( $row );
			$this->assertTrue( $out['forced'] );
			$this->assertTrue(
				$out['enabled'],
				'A filter that pins forced=true must yield enabled=true even when the option is empty.'
			);
		} finally {
			remove_filter( 'auto_update_plugin', $callback, 10 );
		}
	}

	/**
	 * Filter pinning the state to disabled must yield
	 * `enabled: false, forced: false` so the JS can render the
	 * read-only "Auto-updates disabled" label and skip the toggle.
	 *
	 * @covers ::open_station_plugins_window_field_auto_update
	 */
	public function test_auto_update_field_respects_filter_forcing_disabled() {
		// Plugin IS in the option, but filter says disabled — filter wins.
		update_site_option( 'auto_update_plugins', array( 'forced/forced.php' ) );
		set_site_transient(
			'update_plugins',
			(object) array(
				'last_checked' => time(),
				'response'     => array(),
				'no_update'    => array(
					'forced/forced.php' => (object) array( 'slug' => 'forced' ),
				),
			)
		);
		$callback = static function ( $update, $item ) {
			if ( isset( $item->plugin ) && 'forced/forced.php' === $item->plugin ) {
				return false;
			}
			return $update;
		};
		add_filter( 'auto_update_plugin', $callback, 10, 2 );
		try {
			$row = array( 'plugin' => 'forced/forced' );
			$out = open_station_plugins_window_field_auto_update( $row );
			$this->assertFalse( $out['forced'] );
			$this->assertFalse( $out['enabled'] );
		} finally {
			remove_filter( 'auto_update_plugin', $callback, 10 );
		}
	}

	// ----------------------------------------------------------------
	// `open_station_plugins_window_auto_updates_enabled` — global gate.
	// ----------------------------------------------------------------

	/**
	 * Filter must be able to flip the column off even when the
	 * underlying gate would say yes — hosts that manage auto-updates
	 * externally (managed WordPress, internal mirrors) can suppress
	 * the in-window toggle and rely on the existing channel instead.
	 *
	 * @covers ::open_station_plugins_window_auto_updates_enabled
	 */
	public function test_auto_updates_enabled_filter_can_force_off() {
		wp_set_current_user( $this->admin_id );
		add_filter( 'open_station_plugins_window_auto_updates_enabled', '__return_false' );
		try {
			$this->assertFalse( open_station_plugins_window_auto_updates_enabled() );
		} finally {
			remove_all_filters( 'open_station_plugins_window_auto_updates_enabled' );
		}
	}

	/**
	 * Logged-out users (or users without `update_plugins`) must not see
	 * the column. Multisite admins on a single-site context likewise
	 * are gated by the `manage_network_plugins` check.
	 *
	 * @covers ::open_station_plugins_window_auto_updates_enabled
	 */
	public function test_auto_updates_enabled_closed_for_users_without_update_cap() {
		wp_set_current_user( $this->editor_id );
		$this->assertFalse( open_station_plugins_window_auto_updates_enabled() );
		wp_set_current_user( 0 );
		$this->assertFalse( open_station_plugins_window_auto_updates_enabled() );
	}

	/**
	 * The opportunistic prime path respects the 12h `last_checked`
	 * throttle (mirrors `_maybe_update_plugins()`), but the explicit
	 * force path must always invalidate the transient so the next
	 * read fans out to api.wordpress.org.
	 *
	 * @covers ::open_station_plugins_window_maybe_refresh_update_transient
	 */
	public function test_force_refresh_deletes_the_update_plugins_transient_and_calls_wp_update_plugins() {
		// Seed a fresh-looking transient — under normal posture the
		// throttle would skip the refresh entirely.
		set_site_transient(
			'update_plugins',
			(object) array(
				'last_checked' => time(),
				'response'     => array(),
				'checked'      => array(),
			)
		);

		// Block real wp.org calls during the force path so the test
		// doesn't depend on outbound HTTP. Counting hits to
		// `pre_http_request` is also how we assert that
		// `wp_update_plugins()` actually ran (it's the only path
		// inside the force branch that issues an outbound request).
		$http_attempts = 0;
		$blocker       = static function () use ( &$http_attempts ) {
			++$http_attempts;
			// Returning a WP_Error keeps wp_update_plugins from writing
			// the transient back, so we can prove the delete step ran.
			return new WP_Error( 'http_blocked', 'blocked in tests' );
		};
		add_filter( 'pre_http_request', $blocker );
		try {
			open_station_plugins_window_maybe_refresh_update_transient( true );
		} finally {
			remove_filter( 'pre_http_request', $blocker );
		}

		$this->assertGreaterThan(
			0,
			$http_attempts,
			'Force path must call wp_update_plugins() (an outbound api.wordpress.org request).'
		);

		// The cached "no updates" snapshot must be gone. Core may write
		// back a minimal `{ last_checked }` stub after a failed wp.org
		// call to throttle retries — that's fine; what matters is that
		// the stale `response` map is no longer there for the field
		// callback to read.
		$after = get_site_transient( 'update_plugins' );
		if ( is_object( $after ) ) {
			$this->assertEmpty(
				(array) ( $after->response ?? array() ),
				'Force path must clear the cached `response` map.'
			);
		} else {
			$this->assertFalse( $after );
		}
	}

	/**
	 * Hosts that opt out of wp.org checks via the filter must stay
	 * opted out even on the explicit force path.
	 *
	 * @covers ::open_station_plugins_window_maybe_refresh_update_transient
	 */
	public function test_force_refresh_respects_short_circuit_filter() {
		$initial = (object) array(
			'last_checked' => time() - DAY_IN_SECONDS, // would normally trigger refresh
			'response'     => array(),
			'checked'      => array(),
		);
		set_site_transient( 'update_plugins', $initial );

		$saw_force = null;
		add_filter(
			'open_station_plugins_window_refresh_updates',
			static function ( $refresh, $force ) use ( &$saw_force ) {
				$saw_force = $force;
				return false;
			},
			10,
			2
		);

		try {
			open_station_plugins_window_maybe_refresh_update_transient( true );
		} finally {
			remove_all_filters( 'open_station_plugins_window_refresh_updates' );
		}

		$this->assertTrue( $saw_force, 'Filter must receive the force flag.' );
		// Compare by value — `get_site_transient` re-hydrates the option
		// into a new stdClass instance, so identity comparison is wrong.
		$this->assertEquals(
			$initial,
			get_site_transient( 'update_plugins' ),
			'Filter must be able to suppress even the force-refresh path.'
		);
	}
}
