<?php
/**
 * Tests for the Cron Manager capability gate.
 *
 * Covers `desktop_mode_cron_manager_user_can_use()` — the single
 * authorization chokepoint shared by every Cron Manager REST route and
 * by the window/icon registration. On multisite the gate MUST require
 * `manage_network` (Super Admin): per-site Administrators hold
 * `manage_options` but are intentionally denied code-execution
 * capabilities, and cron events run arbitrary registered callbacks.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 */
class Tests_DesktopMode_CronManagerCapabilityGate extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $editor_id;
	protected static $subscriber_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id      = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$editor_id     = $factory->user->create( array( 'role' => 'editor' ) );
		self::$subscriber_id = $factory->user->create( array( 'role' => 'subscriber' ) );

		if ( ! function_exists( 'desktop_mode_cron_manager_user_can_use' ) ) {
			require_once dirname( __DIR__, 3 ) . '/extensions/desktop-mode-cron-manager/includes/store.php';
		}
	}

	public function tear_down() {
		remove_all_filters( 'desktop_mode_cron_manager_user_can_use' );
		parent::tear_down();
	}

	/**
	 * @covers ::desktop_mode_cron_manager_user_can_use
	 */
	public function test_logged_out_user_cannot_use() {
		wp_set_current_user( 0 );

		$this->assertFalse( desktop_mode_cron_manager_user_can_use() );
	}

	/**
	 * @covers ::desktop_mode_cron_manager_user_can_use
	 */
	public function test_single_site_administrator_can_use() {
		if ( is_multisite() ) {
			$this->markTestSkipped( 'Single-site behavior; on multisite the gate requires manage_network.' );
		}

		wp_set_current_user( self::$admin_id );

		$this->assertTrue( desktop_mode_cron_manager_user_can_use() );
	}

	/**
	 * @covers ::desktop_mode_cron_manager_user_can_use
	 */
	public function test_single_site_editor_cannot_use() {
		if ( is_multisite() ) {
			$this->markTestSkipped( 'Single-site behavior; on multisite the gate requires manage_network.' );
		}

		wp_set_current_user( self::$editor_id );

		$this->assertFalse( desktop_mode_cron_manager_user_can_use() );
	}

	/**
	 * Per-site Administrators must NOT pass the gate on multisite —
	 * `manage_options` alone is not a code-execution capability there.
	 *
	 * @covers ::desktop_mode_cron_manager_user_can_use
	 */
	public function test_multisite_site_administrator_cannot_use() {
		if ( ! is_multisite() ) {
			$this->markTestSkipped( 'Multisite-only behavior.' );
		}

		wp_set_current_user( self::$admin_id );

		$this->assertTrue( current_user_can( 'manage_options' ) );
		$this->assertFalse( desktop_mode_cron_manager_user_can_use() );
	}

	/**
	 * @covers ::desktop_mode_cron_manager_user_can_use
	 */
	public function test_multisite_super_admin_can_use() {
		if ( ! is_multisite() ) {
			$this->markTestSkipped( 'Multisite-only behavior.' );
		}

		wp_set_current_user( self::$admin_id );
		grant_super_admin( self::$admin_id );

		$this->assertTrue( desktop_mode_cron_manager_user_can_use() );

		revoke_super_admin( self::$admin_id );
	}

	/**
	 * The documented filter must still be able to grant (or deny) access.
	 *
	 * @covers ::desktop_mode_cron_manager_user_can_use
	 */
	public function test_filter_can_override_the_default_gate() {
		wp_set_current_user( self::$subscriber_id );

		$this->assertFalse( desktop_mode_cron_manager_user_can_use() );

		add_filter( 'desktop_mode_cron_manager_user_can_use', '__return_true' );

		$this->assertTrue( desktop_mode_cron_manager_user_can_use() );
	}
}
