<?php
/**
 * Tests for the native Plugins window's PHP registration + cap gates.
 *
 * The Plugins window is gated on `activate_plugins` (broad gate) plus
 * the `nativePluginsEnabled` opt-out toggle. Per-action mutation caps
 * (`install_plugins`, `delete_plugins`, `upload_plugins`) are
 * enforced inside the AJAX callbacks themselves; these tests cover
 * the registration gate + the per-row capability surface
 * (`desktop_mode_plugins_window_caps`).
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-plugins-window
 */
class Tests_DesktopMode_PluginsWindowRegistration extends WP_UnitTestCase {

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
		remove_all_filters( 'desktop_mode_plugins_window_user_can_register' );
		remove_all_filters( 'desktop_mode_plugins_window_user_can_use' );
		parent::tear_down();
	}

	// ----------------------------------------------------------------
	// `_user_can_register` — cap-only gate. Decoupled from the opt-in
	// so flipping the OS-Settings toggle takes effect mid-session.
	// ----------------------------------------------------------------

	/**
	 * @covers ::desktop_mode_plugins_window_user_can_register
	 */
	public function test_register_gate_open_for_admin_without_opt_in() {
		wp_set_current_user( $this->admin_id );
		$this->assertTrue( desktop_mode_plugins_window_user_can_register() );
	}

	/**
	 * @covers ::desktop_mode_plugins_window_user_can_register
	 */
	public function test_register_gate_closed_for_editor() {
		// Editors don't have `activate_plugins` on a single-site install.
		wp_set_current_user( $this->editor_id );
		$this->assertFalse( desktop_mode_plugins_window_user_can_register() );
	}

	/**
	 * @covers ::desktop_mode_plugins_window_user_can_register
	 */
	public function test_register_gate_closed_for_subscriber() {
		wp_set_current_user( $this->subscriber_id );
		$this->assertFalse( desktop_mode_plugins_window_user_can_register() );
	}

	/**
	 * @covers ::desktop_mode_plugins_window_user_can_register
	 */
	public function test_register_gate_closed_for_logged_out_user() {
		wp_set_current_user( 0 );
		$this->assertFalse( desktop_mode_plugins_window_user_can_register() );
	}

	/**
	 * @covers ::desktop_mode_plugins_window_user_can_register
	 */
	public function test_register_filter_can_block_a_capable_user() {
		wp_set_current_user( $this->admin_id );
		add_filter( 'desktop_mode_plugins_window_user_can_register', '__return_false' );
		$this->assertFalse( desktop_mode_plugins_window_user_can_register() );
	}

	// ----------------------------------------------------------------
	// `_user_can_use` — combined cap + opt-in.
	// ----------------------------------------------------------------

	/**
	 * @covers ::desktop_mode_plugins_window_user_can_use
	 */
	public function test_gate_open_by_default_for_admins() {
		wp_set_current_user( $this->admin_id );
		$this->assertTrue( desktop_mode_plugins_window_user_can_use() );
	}

	/**
	 * @covers ::desktop_mode_plugins_window_user_can_use
	 */
	public function test_gate_closes_when_admin_opts_out() {
		wp_set_current_user( $this->admin_id );
		desktop_mode_save_os_settings(
			$this->admin_id,
			array( 'nativePluginsEnabled' => false )
		);
		$this->assertFalse( desktop_mode_plugins_window_user_can_use() );
	}

	/**
	 * @covers ::desktop_mode_plugins_window_user_can_use
	 */
	public function test_gate_closed_for_logged_out_user() {
		wp_set_current_user( 0 );
		$this->assertFalse( desktop_mode_plugins_window_user_can_use() );
	}

	/**
	 * @covers ::desktop_mode_plugins_window_user_can_use
	 */
	public function test_filter_can_force_gate_open() {
		wp_set_current_user( $this->editor_id );
		// Editor lacks `activate_plugins` — default would be closed.
		$this->assertFalse( desktop_mode_plugins_window_user_can_use() );

		add_filter( 'desktop_mode_plugins_window_user_can_use', '__return_true' );
		$this->assertTrue( desktop_mode_plugins_window_user_can_use() );
	}

	/**
	 * @covers ::desktop_mode_plugins_window_user_can_use
	 */
	public function test_filter_can_force_gate_closed() {
		wp_set_current_user( $this->admin_id );
		add_filter( 'desktop_mode_plugins_window_user_can_use', '__return_false' );
		$this->assertFalse( desktop_mode_plugins_window_user_can_use() );
	}

	// ----------------------------------------------------------------
	// `_caps` — per-action capability surface.
	// ----------------------------------------------------------------

	/**
	 * @covers ::desktop_mode_plugins_window_caps
	 */
	public function test_caps_admin_has_every_action() {
		wp_set_current_user( $this->admin_id );
		$caps = desktop_mode_plugins_window_caps();
		$this->assertTrue( $caps['activate'] );
		$this->assertTrue( $caps['install'] );
		$this->assertTrue( $caps['delete'] );
		$this->assertTrue( $caps['upload'] );
	}

	/**
	 * @covers ::desktop_mode_plugins_window_caps
	 */
	public function test_caps_editor_has_no_plugin_actions() {
		wp_set_current_user( $this->editor_id );
		$caps = desktop_mode_plugins_window_caps();
		$this->assertFalse( $caps['activate'] );
		$this->assertFalse( $caps['install'] );
		$this->assertFalse( $caps['delete'] );
		$this->assertFalse( $caps['upload'] );
	}

	/**
	 * @covers ::desktop_mode_plugins_window_caps
	 */
	public function test_caps_logged_out_user_returns_false_for_every_action() {
		wp_set_current_user( 0 );
		$caps = desktop_mode_plugins_window_caps();
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
	 * @covers ::desktop_mode_save_os_settings
	 * @covers ::desktop_mode_get_os_settings
	 */
	public function test_native_plugins_enabled_round_trips_through_os_settings() {
		desktop_mode_save_os_settings(
			$this->admin_id,
			array( 'nativePluginsEnabled' => false )
		);
		$loaded = desktop_mode_get_os_settings( $this->admin_id );
		$this->assertArrayHasKey( 'nativePluginsEnabled', $loaded );
		$this->assertFalse( $loaded['nativePluginsEnabled'] );

		desktop_mode_save_os_settings(
			$this->admin_id,
			array( 'nativePluginsEnabled' => true )
		);
		$loaded = desktop_mode_get_os_settings( $this->admin_id );
		$this->assertTrue( $loaded['nativePluginsEnabled'] );
	}

	/**
	 * Default OS Settings payload must include the new flag with its
	 * documented default (true / opt-out).
	 *
	 * @covers ::desktop_mode_default_os_settings
	 */
	public function test_native_plugins_enabled_defaults_on() {
		$defaults = desktop_mode_default_os_settings();
		$this->assertArrayHasKey( 'nativePluginsEnabled', $defaults );
		$this->assertTrue( $defaults['nativePluginsEnabled'] );
	}

	/**
	 * REST-field decorator output for `desktop_mode_can_manage` must
	 * encode the per-row state correctly: an active plugin can be
	 * deactivated but not deleted; an inactive plugin can be activated
	 * AND deleted.
	 *
	 * @covers ::desktop_mode_plugins_window_field_can_manage
	 */
	public function test_can_manage_field_for_active_plugin_row() {
		wp_set_current_user( $this->admin_id );
		$row = array(
			'plugin' => 'fake/fake.php',
			'status' => 'active',
		);
		$flags = desktop_mode_plugins_window_field_can_manage( $row );
		$this->assertFalse( $flags['activate'] );
		$this->assertTrue( $flags['deactivate'] );
		$this->assertFalse( $flags['delete'] );
	}

	/**
	 * @covers ::desktop_mode_plugins_window_field_can_manage
	 */
	public function test_can_manage_field_for_inactive_plugin_row() {
		wp_set_current_user( $this->admin_id );
		$row = array(
			'plugin' => 'fake/fake.php',
			'status' => 'inactive',
		);
		$flags = desktop_mode_plugins_window_field_can_manage( $row );
		$this->assertTrue( $flags['activate'] );
		$this->assertFalse( $flags['deactivate'] );
		$this->assertTrue( $flags['delete'] );
	}

	/**
	 * Update-available decorator should report `false` when the
	 * `update_plugins` transient has no entry for the row.
	 *
	 * @covers ::desktop_mode_plugins_window_field_update_available
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
		$out = desktop_mode_plugins_window_field_update_available( $row );
		$this->assertFalse( $out['available'] );
		$this->assertNull( $out['new_version'] );
	}

	/**
	 * Regression: when the `update_plugins` transient HAS an entry
	 * for the row, the decorator must report `available: true` plus
	 * the available version — this is what feeds the "Update
	 * available" filter and the inline Update action.
	 *
	 * @covers ::desktop_mode_plugins_window_field_update_available
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
		$out = desktop_mode_plugins_window_field_update_available( $row );
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
	 * @covers ::desktop_mode_plugins_window_field_update_available
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
		$out = desktop_mode_plugins_window_field_update_available( $row );
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
	 * @covers ::desktop_mode_plugins_window_caps
	 */
	public function test_caps_surface_includes_update_for_admins() {
		wp_set_current_user( $this->admin_id );
		$caps = desktop_mode_plugins_window_caps();
		$this->assertArrayHasKey( 'update', $caps );
		$this->assertTrue( $caps['update'] );
	}

	/**
	 * @covers ::desktop_mode_plugins_window_caps
	 */
	public function test_caps_surface_denies_update_for_editor() {
		wp_set_current_user( $this->editor_id );
		$caps = desktop_mode_plugins_window_caps();
		$this->assertFalse( $caps['update'] );
	}

	/**
	 * The lazy refresh helper must respect Core's 12h throttle: when
	 * the transient was checked under 12h ago, it must NOT clobber
	 * the cached snapshot (otherwise every REST hit could chain a
	 * wp.org HTTPS round-trip).
	 *
	 * @covers ::desktop_mode_plugins_window_maybe_refresh_update_transient
	 */
	public function test_maybe_refresh_respects_12h_throttle() {
		$snapshot = (object) array(
			'last_checked' => time() - 60, // 1 minute ago.
			'response'     => array( 'foo/foo.php' => (object) array( 'new_version' => '2.0' ) ),
		);
		set_site_transient( 'update_plugins', $snapshot );

		desktop_mode_plugins_window_maybe_refresh_update_transient();

		$after = get_site_transient( 'update_plugins' );
		$this->assertEquals( $snapshot, $after, 'Fresh transient should not be refreshed.' );
	}

	/**
	 * The `desktop_mode_plugins_window_refresh_updates` filter must
	 * be able to opt a site out of the lazy refresh entirely — even
	 * when the cached snapshot is well over 12h old.
	 *
	 * @covers ::desktop_mode_plugins_window_maybe_refresh_update_transient
	 */
	public function test_maybe_refresh_filter_can_opt_out() {
		$snapshot = (object) array(
			'last_checked' => time() - DAY_IN_SECONDS, // way past 12h.
			'response'     => array(),
		);
		set_site_transient( 'update_plugins', $snapshot );

		add_filter( 'desktop_mode_plugins_window_refresh_updates', '__return_false' );
		desktop_mode_plugins_window_maybe_refresh_update_transient();
		remove_filter( 'desktop_mode_plugins_window_refresh_updates', '__return_false' );

		$after = get_site_transient( 'update_plugins' );
		$this->assertEquals(
			$snapshot,
			$after,
			'Filter returning false should skip the refresh and leave the stale snapshot untouched.'
		);
	}

	/**
	 * `desktop_mode_icon_url` should derive a wp.org icon URL from the
	 * row's `textdomain` and respect the per-row filter.
	 *
	 * @covers ::desktop_mode_plugins_window_field_icon_url
	 */
	public function test_icon_url_derives_from_textdomain() {
		$row = array(
			'plugin'     => 'akismet/akismet.php',
			'textdomain' => 'akismet',
		);
		$url = desktop_mode_plugins_window_field_icon_url( $row );
		$this->assertSame(
			'https://ps.w.org/akismet/assets/icon.svg',
			$url
		);
	}

	/**
	 * @covers ::desktop_mode_plugins_window_field_icon_url
	 */
	public function test_icon_url_returns_null_when_no_textdomain() {
		$row = array( 'plugin' => 'something/something.php' );
		$this->assertNull( desktop_mode_plugins_window_field_icon_url( $row ) );
	}

	/**
	 * @covers ::desktop_mode_plugins_window_field_icon_url
	 */
	public function test_icon_url_filter_can_override() {
		add_filter(
			'desktop_mode_plugins_window_icon_url',
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
		$url = desktop_mode_plugins_window_field_icon_url( $row );
		$this->assertSame( 'https://cdn.example.com/custom.png', $url );
		remove_all_filters( 'desktop_mode_plugins_window_icon_url' );
	}

	// ----------------------------------------------------------------
	// Force-refresh query-string detector — GH#202.
	// ----------------------------------------------------------------

	/**
	 * @covers ::desktop_mode_plugins_window_force_refresh_requested
	 */
	public function test_force_refresh_detector_returns_false_when_param_absent() {
		unset( $_GET['desktop_mode_force_refresh'] );
		$this->assertFalse( desktop_mode_plugins_window_force_refresh_requested() );
	}

	/**
	 * @covers ::desktop_mode_plugins_window_force_refresh_requested
	 */
	public function test_force_refresh_detector_accepts_one() {
		$_GET['desktop_mode_force_refresh'] = '1';
		try {
			$this->assertTrue( desktop_mode_plugins_window_force_refresh_requested() );
		} finally {
			unset( $_GET['desktop_mode_force_refresh'] );
		}
	}

	/**
	 * @covers ::desktop_mode_plugins_window_force_refresh_requested
	 */
	public function test_force_refresh_detector_accepts_true() {
		$_GET['desktop_mode_force_refresh'] = 'true';
		try {
			$this->assertTrue( desktop_mode_plugins_window_force_refresh_requested() );
		} finally {
			unset( $_GET['desktop_mode_force_refresh'] );
		}
	}

	/**
	 * @covers ::desktop_mode_plugins_window_force_refresh_requested
	 */
	public function test_force_refresh_detector_rejects_other_values() {
		$_GET['desktop_mode_force_refresh'] = '0';
		try {
			$this->assertFalse( desktop_mode_plugins_window_force_refresh_requested() );
		} finally {
			unset( $_GET['desktop_mode_force_refresh'] );
		}
	}

	/**
	 * The opportunistic prime path respects the 12h `last_checked`
	 * throttle (mirrors `_maybe_update_plugins()`), but the explicit
	 * force path must always invalidate the transient so the next
	 * read fans out to api.wordpress.org.
	 *
	 * @covers ::desktop_mode_plugins_window_maybe_refresh_update_transient
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
			desktop_mode_plugins_window_maybe_refresh_update_transient( true );
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
	 * @covers ::desktop_mode_plugins_window_maybe_refresh_update_transient
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
			'desktop_mode_plugins_window_refresh_updates',
			static function ( $refresh, $force ) use ( &$saw_force ) {
				$saw_force = $force;
				return false;
			},
			10,
			2
		);

		try {
			desktop_mode_plugins_window_maybe_refresh_update_transient( true );
		} finally {
			remove_all_filters( 'desktop_mode_plugins_window_refresh_updates' );
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
