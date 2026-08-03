<?php
/**
 * Tests for the OpenStation core helpers.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 */
class Tests_OpenStation_OpenStation extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function tear_down() {
		unset( $_GET['open_station_chromeless'], $_GET[ OPEN_STATION_CLASSIC_FLAG ] );
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );
		remove_all_filters( 'open_station_mode_enabled' );
		parent::tear_down();
	}

	/**
	 * @covers ::open_station_is_enabled
	 */
	public function test_returns_false_for_logged_out_user() {
		wp_set_current_user( 0 );
		$this->assertFalse( open_station_is_enabled() );
	}

	/**
	 * @covers ::open_station_is_enabled
	 */
	public function test_returns_false_when_meta_is_missing() {
		wp_set_current_user( self::$admin_id );
		$this->assertFalse( open_station_is_enabled() );
	}

	/**
	 * @covers ::open_station_is_enabled
	 */
	public function test_returns_false_when_meta_is_empty_string() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '' );
		$this->assertFalse( open_station_is_enabled() );
	}

	/**
	 * @covers ::open_station_is_enabled
	 */
	public function test_returns_true_when_meta_is_one() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$this->assertTrue( open_station_is_enabled() );
	}

	/**
	 * Truthy-but-not-'1' values must NOT enable OpenStation. The AJAX
	 * handler stores either '1' or empty string, so anything else
	 * (legacy data, manual edits, plugin tampering) is treated as off.
	 *
	 * @covers ::open_station_is_enabled
	 */
	public function test_returns_false_for_non_one_truthy_meta() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', 'true' );
		$this->assertFalse( open_station_is_enabled() );

		update_user_meta( self::$admin_id, 'desktop_mode_mode', '0' );
		$this->assertFalse( open_station_is_enabled() );
	}

	/**
	 * The `open_station_mode_enabled` filter is the documented surface for
	 * gating which users get OpenStation. A filter returning false MUST
	 * override a positive meta value so render-time gates that consult
	 * the helper (chromeless detection, payload generation, REST permission
	 * callbacks) all see the user as not-enabled.
	 *
	 * @covers ::open_station_is_enabled
	 */
	public function test_filter_returning_false_overrides_positive_meta() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		add_filter( 'open_station_mode_enabled', '__return_false' );

		$this->assertFalse( open_station_is_enabled() );
	}

	/**
	 * Filter returning true alongside positive meta is the happy path —
	 * helper returns true. Default filter wiring already returns the
	 * passed-in `$enabled` (true), so this case verifies that an
	 * explicit `__return_true` doesn't break anything either.
	 *
	 * @covers ::open_station_is_enabled
	 */
	public function test_filter_returning_true_with_positive_meta() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		add_filter( 'open_station_mode_enabled', '__return_true' );

		$this->assertTrue( open_station_is_enabled() );
	}

	/**
	 * Meta is the first gate — the filter never gets a chance to flip a
	 * not-opted-in user on. A filter returning true with no meta still
	 * leaves the user as not-enabled.
	 *
	 * @covers ::open_station_is_enabled
	 */
	public function test_filter_cannot_enable_without_meta() {
		wp_set_current_user( self::$admin_id );
		// Meta intentionally not set.
		add_filter( 'open_station_mode_enabled', '__return_true' );

		$this->assertFalse( open_station_is_enabled() );
	}

	/**
	 * Filter must receive the correct `$user_id`. When called without
	 * arguments, the helper resolves to the current user; when called
	 * with an explicit user id, that id is forwarded to the filter.
	 *
	 * @covers ::open_station_is_enabled
	 */
	public function test_filter_receives_user_id() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		$received = null;
		add_filter(
			'open_station_mode_enabled',
			function ( $enabled, $user_id ) use ( &$received ) {
				$received = $user_id;
				return $enabled;
			},
			10,
			2
		);

		open_station_is_enabled();
		$this->assertSame( (int) self::$admin_id, (int) $received );

		// Explicit user id wins over the current-user fallback.
		$other_id = self::factory()->user->create( array( 'role' => 'editor' ) );
		update_user_meta( $other_id, 'desktop_mode_mode', '1' );

		$received = null;
		open_station_is_enabled( $other_id );
		$this->assertSame( (int) $other_id, (int) $received );
	}

	/**
	 * The shared REST gate denies logged-out callers with a 401.
	 *
	 * @covers ::open_station_rest_require_enabled
	 */
	public function test_rest_require_enabled_denies_logged_out() {
		wp_set_current_user( 0 );

		$result = open_station_rest_require_enabled();

		$this->assertWPError( $result );
		$this->assertSame( 401, $result->get_error_data()['status'] );
	}

	/**
	 * A logged-in user who has NOT enabled OpenStation is denied with a
	 * 403 — this is the regression guard for the broken-access-control
	 * report (a Subscriber, or any role, reaching these routes without
	 * opting into OpenStation).
	 *
	 * @covers ::open_station_rest_require_enabled
	 */
	public function test_rest_require_enabled_denies_logged_in_without_open_station() {
		$subscriber = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		wp_set_current_user( $subscriber );
		// Meta intentionally not set — OpenStation never enabled.

		$result = open_station_rest_require_enabled();

		$this->assertWPError( $result );
		$this->assertSame( 403, $result->get_error_data()['status'] );
	}

	/**
	 * A logged-in user with OpenStation enabled passes the gate.
	 *
	 * @covers ::open_station_rest_require_enabled
	 */
	public function test_rest_require_enabled_allows_enabled_user() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		$this->assertTrue( open_station_rest_require_enabled() );
	}

	/**
	 * @covers ::open_station_is_chromeless_request
	 */
	public function test_chromeless_false_without_query_param() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$this->assertFalse( open_station_is_chromeless_request() );
	}

	/**
	 * @covers ::open_station_is_chromeless_request
	 */
	public function test_chromeless_false_when_param_is_not_one() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['open_station_chromeless'] = 'yes';
		$this->assertFalse( open_station_is_chromeless_request() );
	}

	/**
	 * Critical security check: the chromeless query param MUST NOT
	 * strip admin chrome unless the user actually has OpenStation
	 * enabled. Otherwise anyone could send a victim a link with
	 * ?open_station_chromeless=1 and load admin pages without the navigation.
	 *
	 * @covers ::open_station_is_chromeless_request
	 */
	public function test_chromeless_false_when_user_has_open_station_off() {
		wp_set_current_user( self::$admin_id );
		// Meta intentionally not set.
		$_GET['open_station_chromeless'] = '1';
		$this->assertFalse( open_station_is_chromeless_request() );
	}

	/**
	 * @covers ::open_station_is_chromeless_request
	 */
	public function test_chromeless_false_for_logged_out_user_with_param() {
		wp_set_current_user( 0 );
		$_GET['open_station_chromeless'] = '1';
		$this->assertFalse( open_station_is_chromeless_request() );
	}

	/**
	 * @covers ::open_station_is_chromeless_request
	 */
	public function test_chromeless_true_when_param_set_and_user_opted_in() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['open_station_chromeless'] = '1';
		$this->assertTrue( open_station_is_chromeless_request() );
	}

	/**
	 * @covers ::open_station_chromeless_hide_admin_bar
	 */
	public function test_show_admin_bar_filter_returns_false_in_chromeless() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['open_station_chromeless'] = '1';
		$this->assertFalse( open_station_chromeless_hide_admin_bar( true ) );
	}

	/**
	 * @covers ::open_station_chromeless_hide_admin_bar
	 */
	public function test_show_admin_bar_filter_passes_through_outside_chromeless() {
		wp_set_current_user( self::$admin_id );
		// No chromeless param, no meta — both conditions for chromeless fail.
		$this->assertTrue( open_station_chromeless_hide_admin_bar( true ) );
		$this->assertFalse( open_station_chromeless_hide_admin_bar( false ) );
	}

	/**
	 * The filter is registered at module load via add_filter().
	 * Verify it actually fires through apply_filters('show_admin_bar').
	 *
	 * @covers ::open_station_chromeless_hide_admin_bar
	 */
	public function test_show_admin_bar_filter_is_wired() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['open_station_chromeless'] = '1';
		$this->assertFalse( apply_filters( 'show_admin_bar', true ) );
	}

	/**
	 * @covers ::open_station_is_classic_request
	 */
	public function test_classic_request_false_without_query_param() {
		$this->assertFalse( open_station_is_classic_request() );
	}

	/**
	 * @covers ::open_station_is_classic_request
	 */
	public function test_classic_request_false_when_param_is_not_one() {
		$_GET[ OPEN_STATION_CLASSIC_FLAG ] = 'yes';
		$this->assertFalse( open_station_is_classic_request() );
	}

	/**
	 * The classic override is a per-request flag. It must work even when
	 * the user isn't logged in (there's no shell to hide in that case,
	 * but the helper shouldn't falsely return true for ambiguous values).
	 *
	 * @covers ::open_station_is_classic_request
	 */
	public function test_classic_request_true_when_param_is_one() {
		$_GET[ OPEN_STATION_CLASSIC_FLAG ] = '1';
		$this->assertTrue( open_station_is_classic_request() );
	}

	/**
	 * Classic override is orthogonal to the user's account preference —
	 * `open_station_is_enabled()` should still reflect the stored meta even
	 * when the per-request classic flag is active, because the admin-bar
	 * toggle reads meta to label itself correctly.
	 *
	 * @covers ::open_station_is_enabled
	 * @covers ::open_station_is_classic_request
	 */
	public function test_classic_request_does_not_change_open_station_helper() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET[ OPEN_STATION_CLASSIC_FLAG ] = '1';

		$this->assertTrue( open_station_is_enabled() );
		$this->assertTrue( open_station_is_classic_request() );
	}
}
