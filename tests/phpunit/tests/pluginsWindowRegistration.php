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
		// the transient with whatever the install last fetched.
		set_site_transient(
			'update_plugins',
			(object) array( 'response' => array() )
		);
		$row = array( 'plugin' => 'never/installed.php' );
		$out = desktop_mode_plugins_window_field_update_available( $row );
		$this->assertFalse( $out['available'] );
		$this->assertNull( $out['new_version'] );
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
}
