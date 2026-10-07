<?php

class Tests_OpenStation_OpenStation extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function tear_down() {
		unset( $_GET['openstation_chromeless'], $_GET[ OPENSTATION_CLASSIC_FLAG ], $_SERVER['HTTP_SEC_FETCH_MODE'] );
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );
		remove_all_filters( 'openstation_mode_enabled' );
		parent::tear_down();
	}

	public function test_returns_false_for_logged_out_user() {
		wp_set_current_user( 0 );
		$this->assertFalse( openstation_is_enabled() );
	}

	public function test_returns_false_when_meta_is_missing() {
		wp_set_current_user( self::$admin_id );
		$this->assertFalse( openstation_is_enabled() );
	}

	public function test_returns_false_when_meta_is_empty_string() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '' );
		$this->assertFalse( openstation_is_enabled() );
	}

	public function test_returns_true_when_meta_is_one() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$this->assertTrue( openstation_is_enabled() );
	}

	public function test_returns_false_for_non_one_truthy_meta() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', 'true' );
		$this->assertFalse( openstation_is_enabled() );

		update_user_meta( self::$admin_id, 'desktop_mode_mode', '0' );
		$this->assertFalse( openstation_is_enabled() );
	}

	public function test_filter_returning_false_overrides_positive_meta() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		add_filter( 'openstation_mode_enabled', '__return_false' );

		$this->assertFalse( openstation_is_enabled() );
	}

	public function test_filter_returning_true_with_positive_meta() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		add_filter( 'openstation_mode_enabled', '__return_true' );

		$this->assertTrue( openstation_is_enabled() );
	}

	public function test_filter_cannot_enable_without_meta() {
		wp_set_current_user( self::$admin_id );

		add_filter( 'openstation_mode_enabled', '__return_true' );

		$this->assertFalse( openstation_is_enabled() );
	}

	public function test_filter_receives_user_id() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		$received = null;
		add_filter(
			'openstation_mode_enabled',
			function ( $enabled, $user_id ) use ( &$received ) {
				$received = $user_id;
				return $enabled;
			},
			10,
			2
		);

		openstation_is_enabled();
		$this->assertSame( (int) self::$admin_id, (int) $received );

		$other_id = self::factory()->user->create( array( 'role' => 'editor' ) );
		update_user_meta( $other_id, 'desktop_mode_mode', '1' );

		$received = null;
		openstation_is_enabled( $other_id );
		$this->assertSame( (int) $other_id, (int) $received );
	}

	public function test_rest_require_enabled_denies_logged_out() {
		wp_set_current_user( 0 );

		$result = openstation_rest_require_enabled();

		$this->assertWPError( $result );
		$this->assertSame( 401, $result->get_error_data()['status'] );
	}

	public function test_rest_require_enabled_denies_logged_in_without_openstation() {
		$subscriber = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		wp_set_current_user( $subscriber );

		$result = openstation_rest_require_enabled();

		$this->assertWPError( $result );
		$this->assertSame( 403, $result->get_error_data()['status'] );
	}

	public function test_rest_require_enabled_allows_enabled_user() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		$this->assertTrue( openstation_rest_require_enabled() );
	}

	public function test_chromeless_false_without_query_param() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$this->assertFalse( openstation_is_chromeless_request() );
	}

	public function test_chromeless_false_when_param_is_not_one() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless'] = 'yes';
		$this->assertFalse( openstation_is_chromeless_request() );
	}

	public function test_chromeless_false_when_user_has_openstation_off() {
		wp_set_current_user( self::$admin_id );

		$_GET['openstation_chromeless'] = '1';
		$this->assertFalse( openstation_is_chromeless_request() );
	}

	public function test_chromeless_false_for_logged_out_user_with_param() {
		wp_set_current_user( 0 );
		$_GET['openstation_chromeless'] = '1';
		$this->assertFalse( openstation_is_chromeless_request() );
	}

	public function test_chromeless_true_when_param_set_and_user_opted_in() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless'] = '1';
		$this->assertTrue( openstation_is_chromeless_request() );
	}

	public function test_show_admin_bar_filter_returns_false_in_chromeless() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless'] = '1';
		$this->assertFalse( openstation_chromeless_hide_admin_bar( true ) );
	}

	public function test_show_admin_bar_filter_passes_through_outside_chromeless() {
		wp_set_current_user( self::$admin_id );

		$this->assertTrue( openstation_chromeless_hide_admin_bar( true ) );
		$this->assertFalse( openstation_chromeless_hide_admin_bar( false ) );
	}

	public function test_show_admin_bar_filter_is_wired() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless'] = '1';
		$this->assertFalse( apply_filters( 'show_admin_bar', true ) );
	}

	public function test_classic_request_false_without_query_param() {
		$this->assertFalse( openstation_is_classic_request() );
	}

	public function test_classic_request_false_when_param_is_not_one() {
		$_GET[ OPENSTATION_CLASSIC_FLAG ] = 'yes';
		$this->assertFalse( openstation_is_classic_request() );
	}

	public function test_classic_request_true_when_param_is_one() {
		$_GET[ OPENSTATION_CLASSIC_FLAG ] = '1';
		$this->assertTrue( openstation_is_classic_request() );
	}

	public function test_classic_request_does_not_change_openstation_helper() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET[ OPENSTATION_CLASSIC_FLAG ] = '1';

		$this->assertTrue( openstation_is_enabled() );
		$this->assertTrue( openstation_is_classic_request() );
	}

	public function test_subresource_request_false_without_the_header() {
		unset( $_SERVER['HTTP_SEC_FETCH_MODE'] );
		$this->assertFalse( openstation_is_subresource_request() );
	}

	public function test_subresource_request_false_for_a_navigation() {
		$_SERVER['HTTP_SEC_FETCH_MODE'] = 'navigate';
		$this->assertFalse( openstation_is_subresource_request() );
	}

	public function test_subresource_request_true_for_a_fetch() {
		$_SERVER['HTTP_SEC_FETCH_MODE'] = 'no-cors';
		$this->assertTrue( openstation_is_subresource_request() );

		$_SERVER['HTTP_SEC_FETCH_MODE'] = 'cors';
		$this->assertTrue( openstation_is_subresource_request() );
	}
}
