<?php
/**
 * Tests for the global core-notice descriptors + the in-window suppressor.
 *
 * Covers the builders that can be exercised without a live recovery-mode
 * session (maintenance, default password, deactivated plugins), the aggregate
 * builder, the filter, and the chromeless suppressor. See
 * docs/core-notices-audit.md.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-core-notices
 */
class Tests_OpenStation_CoreNotices extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
	}

	public function tear_down() {
		unset( $GLOBALS['upgrading'] );
		delete_option( 'wp_force_deactivated_plugins' );
		delete_site_option( 'auto_core_update_failed' );
		delete_user_option( self::$admin_id, 'default_password_nag' );
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );
		unset( $_GET['open_station_chromeless'] );
		remove_all_filters( 'open_station_core_notices' );
		parent::tear_down();
	}

	/**
	 * @covers ::open_station_core_notice_maintenance
	 */
	public function test_maintenance_notice_when_upgrading() {
		$GLOBALS['upgrading'] = time();

		$notice = open_station_core_notice_maintenance();
		$this->assertIsArray( $notice );
		$this->assertSame( 'maintenance', $notice['id'] );
		// Admin can update_core → gets the retry action.
		$this->assertStringContainsString( 'update-core.php', $notice['actionUrl'] );
	}

	/**
	 * @covers ::open_station_core_notice_maintenance
	 */
	public function test_no_maintenance_notice_when_idle() {
		$this->assertNull( open_station_core_notice_maintenance() );
	}

	/**
	 * @covers ::open_station_core_notice_default_password
	 */
	public function test_default_password_notice() {
		update_user_option( self::$admin_id, 'default_password_nag', true );

		$notice = open_station_core_notice_default_password();
		$this->assertIsArray( $notice );
		$this->assertSame( 'default-password', $notice['id'] );
		$this->assertStringContainsString( 'profile.php', $notice['actionUrl'] );
	}

	/**
	 * @covers ::open_station_core_notice_default_password
	 */
	public function test_no_default_password_notice_without_flag() {
		$this->assertNull( open_station_core_notice_default_password() );
	}

	/**
	 * @covers ::open_station_core_notice_deactivated_plugins
	 */
	public function test_deactivated_plugins_notice_lists_names() {
		update_option(
			'wp_force_deactivated_plugins',
			array(
				array( 'plugin_name' => 'Acme Widget' ),
				array( 'plugin_name' => 'Beta Tool' ),
			)
		);

		$notice = open_station_core_notice_deactivated_plugins();
		$this->assertIsArray( $notice );
		$this->assertSame( 'deactivated-plugins', $notice['id'] );
		$this->assertStringContainsString( 'Acme Widget', $notice['message'] );
		$this->assertStringContainsString( 'Beta Tool', $notice['message'] );
	}

	/**
	 * @covers ::open_station_core_notice_deactivated_plugins
	 */
	public function test_no_deactivated_plugins_notice_without_capability() {
		update_option(
			'wp_force_deactivated_plugins',
			array( array( 'plugin_name' => 'Acme Widget' ) )
		);
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );

		$this->assertNull( open_station_core_notice_deactivated_plugins() );
	}

	/**
	 * The aggregate collects each pending notice and every descriptor carries
	 * the full shape.
	 *
	 * @covers ::open_station_get_core_notices
	 */
	public function test_aggregate_shape() {
		$GLOBALS['upgrading'] = time();
		update_user_option( self::$admin_id, 'default_password_nag', true );

		$notices = open_station_get_core_notices();
		$this->assertGreaterThanOrEqual( 2, count( $notices ) );

		$ids = wp_list_pluck( $notices, 'id' );
		$this->assertContains( 'maintenance', $ids );
		$this->assertContains( 'default-password', $ids );

		foreach ( $notices as $notice ) {
			$this->assertArrayHasKey( 'id', $notice );
			$this->assertArrayHasKey( 'title', $notice );
			$this->assertArrayHasKey( 'message', $notice );
			$this->assertArrayHasKey( 'actionLabel', $notice );
			$this->assertArrayHasKey( 'actionUrl', $notice );
		}
	}

	/**
	 * @covers ::open_station_get_core_notices
	 */
	public function test_filter_can_suppress_all() {
		$GLOBALS['upgrading'] = time();
		add_filter( 'open_station_core_notices', '__return_empty_array' );

		$this->assertSame( array(), open_station_get_core_notices() );
	}

	/**
	 * The chromeless suppressor detaches the remaining global core notices so
	 * they don't repeat inside every window.
	 *
	 * @covers ::open_station_chromeless_suppress_core_notices
	 */
	public function test_suppressor_removes_notices_in_chromeless() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['open_station_chromeless'] = '1';

		add_action( 'admin_notices', 'wp_recovery_mode_nag', 1 );
		add_action( 'admin_notices', 'default_password_nag' );
		add_action( 'admin_notices', 'deactivated_plugins_notice', 5 );
		add_action( 'admin_notices', 'paused_plugins_notice', 5 );
		add_action( 'admin_notices', 'paused_themes_notice', 5 );

		open_station_chromeless_suppress_core_notices();

		$this->assertFalse( has_action( 'admin_notices', 'wp_recovery_mode_nag' ) );
		$this->assertFalse( has_action( 'admin_notices', 'default_password_nag' ) );
		$this->assertFalse( has_action( 'admin_notices', 'deactivated_plugins_notice' ) );
		$this->assertFalse( has_action( 'admin_notices', 'paused_plugins_notice' ) );
		$this->assertFalse( has_action( 'admin_notices', 'paused_themes_notice' ) );
	}

	/**
	 * Outside a chromeless request the notices are left in place.
	 *
	 * @covers ::open_station_chromeless_suppress_core_notices
	 */
	public function test_suppressor_leaves_notices_when_not_chromeless() {
		add_action( 'admin_notices', 'default_password_nag' );

		open_station_chromeless_suppress_core_notices();

		$this->assertNotFalse( has_action( 'admin_notices', 'default_password_nag' ) );

		remove_action( 'admin_notices', 'default_password_nag' );
	}
}
