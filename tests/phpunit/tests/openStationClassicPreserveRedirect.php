<?php
/**
 * Tests for openstation_classic_preserve_redirect() — the wp_redirect
 * filter that re-appends `desktop_mode_classic=1` to same-site admin
 * redirects so detached tabs stay classic after server-built redirects
 * (POST-then-redirect flows like saving a post or activating a plugin).
 *
 * @package OpenStation
 *
 * @group openstation
 */
class Tests_OpenStationClassicPreserveRedirect extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		set_current_screen( 'dashboard' );
		wp_set_current_user( self::$admin_id );
	}

	public function tear_down() {
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );
		unset( $_GET['openstation_chromeless'], $_GET[ OPENSTATION_CLASSIC_FLAG ] );
		parent::tear_down();
	}

	private function enter_classic() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET[ OPENSTATION_CLASSIC_FLAG ] = '1';
	}

	/**
	 * @covers ::openstation_classic_preserve_redirect
	 */
	public function test_appends_flag_to_admin_redirect_in_classic_tab() {
		$this->enter_classic();

		$filtered = openstation_classic_preserve_redirect( admin_url( 'edit.php' ) );

		$this->assertStringContainsString( OPENSTATION_CLASSIC_FLAG . '=1', $filtered );
	}

	/**
	 * @covers ::openstation_classic_preserve_redirect
	 */
	public function test_leaves_admin_redirect_alone_when_not_classic_tab() {
		$location = admin_url( 'edit.php' );

		$this->assertSame( $location, openstation_classic_preserve_redirect( $location ) );
	}

	/**
	 * @covers ::openstation_classic_preserve_redirect
	 */
	public function test_leaves_non_admin_redirect_alone() {
		$this->enter_classic();

		$location = home_url( '/hello-world/' );

		$this->assertSame( $location, openstation_classic_preserve_redirect( $location ) );
	}

	/**
	 * @covers ::openstation_classic_preserve_redirect
	 */
	public function test_does_not_double_append_when_flag_already_present() {
		$this->enter_classic();

		$location = admin_url( 'edit.php?' . OPENSTATION_CLASSIC_FLAG . '=1' );
		$filtered = openstation_classic_preserve_redirect( $location );

		$this->assertSame( $location, $filtered );
		$this->assertSame( 1, substr_count( $filtered, OPENSTATION_CLASSIC_FLAG . '=' ) );
	}

	/**
	 * @covers ::openstation_classic_preserve_redirect
	 */
	public function test_leaves_empty_location_alone() {
		$this->enter_classic();

		$this->assertSame( '', openstation_classic_preserve_redirect( '' ) );
	}

	/**
	 * @covers ::openstation_classic_preserve_redirect
	 */
	public function test_preserves_existing_query_args() {
		$this->enter_classic();

		$filtered = openstation_classic_preserve_redirect(
			admin_url( 'post.php?post=7&action=edit&message=1' )
		);

		$this->assertStringContainsString( 'post=7', $filtered );
		$this->assertStringContainsString( 'action=edit', $filtered );
		$this->assertStringContainsString( 'message=1', $filtered );
		$this->assertStringContainsString( OPENSTATION_CLASSIC_FLAG . '=1', $filtered );
	}

	/**
	 * The filter must be wired on `wp_redirect` so Core's redirect path
	 * actually runs through it.
	 *
	 * @covers ::openstation_classic_preserve_redirect
	 */
	public function test_filter_is_registered_on_wp_redirect() {
		$this->assertSame(
			999,
			has_filter( 'wp_redirect', 'openstation_classic_preserve_redirect' )
		);
	}
}
