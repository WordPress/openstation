<?php
/**
 * Tests for the Desktop Mode core helpers.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 */
class Tests_DesktopMode_DesktopMode extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function tear_down() {
		unset( $_GET['desktop_mode_chromeless'], $_GET[ DESKTOP_MODE_CLASSIC_FLAG ] );
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );
		parent::tear_down();
	}

	/**
	 * @covers ::desktop_mode_is_enabled
	 */
	public function test_returns_false_for_logged_out_user() {
		wp_set_current_user( 0 );
		$this->assertFalse( desktop_mode_is_enabled() );
	}

	/**
	 * @covers ::desktop_mode_is_enabled
	 */
	public function test_returns_false_when_meta_is_missing() {
		wp_set_current_user( self::$admin_id );
		$this->assertFalse( desktop_mode_is_enabled() );
	}

	/**
	 * @covers ::desktop_mode_is_enabled
	 */
	public function test_returns_false_when_meta_is_empty_string() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '' );
		$this->assertFalse( desktop_mode_is_enabled() );
	}

	/**
	 * @covers ::desktop_mode_is_enabled
	 */
	public function test_returns_true_when_meta_is_one() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$this->assertTrue( desktop_mode_is_enabled() );
	}

	/**
	 * Truthy-but-not-'1' values must NOT enable desktop mode. The AJAX
	 * handler stores either '1' or empty string, so anything else
	 * (legacy data, manual edits, plugin tampering) is treated as off.
	 *
	 * @covers ::desktop_mode_is_enabled
	 */
	public function test_returns_false_for_non_one_truthy_meta() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', 'true' );
		$this->assertFalse( desktop_mode_is_enabled() );

		update_user_meta( self::$admin_id, 'desktop_mode_mode', '0' );
		$this->assertFalse( desktop_mode_is_enabled() );
	}

	/**
	 * @covers ::desktop_mode_is_chromeless_request
	 */
	public function test_chromeless_false_without_query_param() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$this->assertFalse( desktop_mode_is_chromeless_request() );
	}

	/**
	 * @covers ::desktop_mode_is_chromeless_request
	 */
	public function test_chromeless_false_when_param_is_not_one() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['desktop_mode_chromeless'] = 'yes';
		$this->assertFalse( desktop_mode_is_chromeless_request() );
	}

	/**
	 * Critical security check: the chromeless query param MUST NOT
	 * strip admin chrome unless the user actually has desktop mode
	 * enabled. Otherwise anyone could send a victim a link with
	 * ?desktop_mode_chromeless=1 and load admin pages without the navigation.
	 *
	 * @covers ::desktop_mode_is_chromeless_request
	 */
	public function test_chromeless_false_when_user_has_desktop_mode_off() {
		wp_set_current_user( self::$admin_id );
		// Meta intentionally not set.
		$_GET['desktop_mode_chromeless'] = '1';
		$this->assertFalse( desktop_mode_is_chromeless_request() );
	}

	/**
	 * @covers ::desktop_mode_is_chromeless_request
	 */
	public function test_chromeless_false_for_logged_out_user_with_param() {
		wp_set_current_user( 0 );
		$_GET['desktop_mode_chromeless'] = '1';
		$this->assertFalse( desktop_mode_is_chromeless_request() );
	}

	/**
	 * @covers ::desktop_mode_is_chromeless_request
	 */
	public function test_chromeless_true_when_param_set_and_user_opted_in() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['desktop_mode_chromeless'] = '1';
		$this->assertTrue( desktop_mode_is_chromeless_request() );
	}

	/**
	 * @covers ::desktop_mode_chromeless_hide_admin_bar
	 */
	public function test_show_admin_bar_filter_returns_false_in_chromeless() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['desktop_mode_chromeless'] = '1';
		$this->assertFalse( desktop_mode_chromeless_hide_admin_bar( true ) );
	}

	/**
	 * @covers ::desktop_mode_chromeless_hide_admin_bar
	 */
	public function test_show_admin_bar_filter_passes_through_outside_chromeless() {
		wp_set_current_user( self::$admin_id );
		// No chromeless param, no meta — both conditions for chromeless fail.
		$this->assertTrue( desktop_mode_chromeless_hide_admin_bar( true ) );
		$this->assertFalse( desktop_mode_chromeless_hide_admin_bar( false ) );
	}

	/**
	 * The filter is registered at module load via add_filter().
	 * Verify it actually fires through apply_filters('show_admin_bar').
	 *
	 * @covers ::desktop_mode_chromeless_hide_admin_bar
	 */
	public function test_show_admin_bar_filter_is_wired() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['desktop_mode_chromeless'] = '1';
		$this->assertFalse( apply_filters( 'show_admin_bar', true ) );
	}

	/**
	 * @covers ::desktop_mode_is_classic_request
	 */
	public function test_classic_request_false_without_query_param() {
		$this->assertFalse( desktop_mode_is_classic_request() );
	}

	/**
	 * @covers ::desktop_mode_is_classic_request
	 */
	public function test_classic_request_false_when_param_is_not_one() {
		$_GET[ DESKTOP_MODE_CLASSIC_FLAG ] = 'yes';
		$this->assertFalse( desktop_mode_is_classic_request() );
	}

	/**
	 * The classic override is a per-request flag. It must work even when
	 * the user isn't logged in (there's no shell to hide in that case,
	 * but the helper shouldn't falsely return true for ambiguous values).
	 *
	 * @covers ::desktop_mode_is_classic_request
	 */
	public function test_classic_request_true_when_param_is_one() {
		$_GET[ DESKTOP_MODE_CLASSIC_FLAG ] = '1';
		$this->assertTrue( desktop_mode_is_classic_request() );
	}

	/**
	 * Classic override is orthogonal to the user's account preference —
	 * `desktop_mode_is_enabled()` should still reflect the stored meta even
	 * when the per-request classic flag is active, because the admin-bar
	 * toggle reads meta to label itself correctly.
	 *
	 * @covers ::desktop_mode_is_enabled
	 * @covers ::desktop_mode_is_classic_request
	 */
	public function test_classic_request_does_not_change_desktop_mode_helper() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET[ DESKTOP_MODE_CLASSIC_FLAG ] = '1';

		$this->assertTrue( desktop_mode_is_enabled() );
		$this->assertTrue( desktop_mode_is_classic_request() );
	}
}
