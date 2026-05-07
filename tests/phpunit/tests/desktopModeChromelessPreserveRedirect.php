<?php
/**
 * Tests for desktop_mode_chromeless_preserve_redirect() — the wp_redirect
 * filter that re-appends `desktop_mode_chromeless=1` to same-site admin redirects so
 * chromeless iframes don't "break out" of chromeless mode after a
 * POST-then-redirect flow (e.g., saving a classic-editor post).
 *
 * @package WPDesktopMode
 *
 * @group desktop-mode
 */
class Tests_WPDesktopChromelessPreserveRedirect extends WP_UnitTestCase {

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
		unset( $_GET['desktop_mode_chromeless'] );
		parent::tear_down();
	}

	private function enter_chromeless() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['desktop_mode_chromeless'] = '1';
	}

	/**
	 * @covers ::desktop_mode_chromeless_preserve_redirect
	 */
	public function test_appends_flag_to_admin_redirect_in_chromeless() {
		$this->enter_chromeless();

		$filtered = desktop_mode_chromeless_preserve_redirect( admin_url( 'edit.php' ) );

		$this->assertStringContainsString( 'desktop_mode_chromeless=1', $filtered );
	}

	/**
	 * @covers ::desktop_mode_chromeless_preserve_redirect
	 */
	public function test_leaves_admin_redirect_alone_when_not_chromeless() {
		$location = admin_url( 'edit.php' );

		$this->assertSame( $location, desktop_mode_chromeless_preserve_redirect( $location ) );
	}

	/**
	 * @covers ::desktop_mode_chromeless_preserve_redirect
	 */
	public function test_leaves_non_admin_redirect_alone() {
		$this->enter_chromeless();

		$location = home_url( '/hello-world/' );

		$this->assertSame( $location, desktop_mode_chromeless_preserve_redirect( $location ) );
	}

	/**
	 * @covers ::desktop_mode_chromeless_preserve_redirect
	 */
	public function test_does_not_double_append_when_flag_already_present() {
		$this->enter_chromeless();

		$location = admin_url( 'edit.php?desktop_mode_chromeless=1' );
		$filtered = desktop_mode_chromeless_preserve_redirect( $location );

		$this->assertSame( $location, $filtered );
		$this->assertSame( 1, substr_count( $filtered, 'desktop_mode_chromeless=' ) );
	}

	/**
	 * @covers ::desktop_mode_chromeless_preserve_redirect
	 */
	public function test_leaves_empty_location_alone() {
		$this->enter_chromeless();

		$this->assertSame( '', desktop_mode_chromeless_preserve_redirect( '' ) );
	}

	/**
	 * @covers ::desktop_mode_chromeless_preserve_redirect
	 */
	public function test_preserves_existing_query_args() {
		$this->enter_chromeless();

		$filtered = desktop_mode_chromeless_preserve_redirect(
			admin_url( 'post.php?post=7&action=edit&message=1' )
		);

		$this->assertStringContainsString( 'post=7', $filtered );
		$this->assertStringContainsString( 'action=edit', $filtered );
		$this->assertStringContainsString( 'message=1', $filtered );
		$this->assertStringContainsString( 'desktop_mode_chromeless=1', $filtered );
	}

	/**
	 * The filter must be wired on `wp_redirect` so Core's redirect path
	 * actually runs through it.
	 *
	 * @covers ::desktop_mode_chromeless_preserve_redirect
	 */
	public function test_filter_is_registered_on_wp_redirect() {
		$this->assertSame(
			999,
			has_filter( 'wp_redirect', 'desktop_mode_chromeless_preserve_redirect' )
		);
	}

	/**
	 * Regression: `user-new.php` redirects with `wp_redirect( 'users.php?...' )`
	 * — a relative URL. The earlier `strpos( $location, '/wp-admin/' )`
	 * check skipped these and the iframe ended up loading the next page
	 * without `desktop_mode_chromeless=1`, which painted the full desktop
	 * shell inside the window. The relative-target branch in
	 * `desktop_mode_is_admin_redirect_target()` must catch it whenever
	 * `is_admin()` is true.
	 *
	 * @covers ::desktop_mode_chromeless_preserve_redirect
	 * @covers ::desktop_mode_is_admin_redirect_target
	 */
	public function test_appends_flag_to_relative_admin_redirect_in_chromeless() {
		set_current_screen( 'user-new' );
		$this->enter_chromeless();

		$filtered = desktop_mode_chromeless_preserve_redirect( 'users.php?update=add&id=42' );

		$this->assertStringContainsString( 'desktop_mode_chromeless=1', $filtered );
		$this->assertStringContainsString( 'update=add', $filtered );
		$this->assertStringContainsString( 'id=42', $filtered );
	}

	/**
	 * Absolute-path admin URLs (without scheme/host) get the flag too —
	 * `wp_redirect( '/wp-admin/users.php' )` is rare but legal.
	 *
	 * @covers ::desktop_mode_chromeless_preserve_redirect
	 * @covers ::desktop_mode_is_admin_redirect_target
	 */
	public function test_appends_flag_to_absolute_path_admin_redirect() {
		$this->enter_chromeless();

		$filtered = desktop_mode_chromeless_preserve_redirect( '/wp-admin/users.php?update=add' );

		$this->assertStringContainsString( 'desktop_mode_chromeless=1', $filtered );
	}

	/**
	 * An external host is left alone — login → SSO providers, OAuth
	 * callbacks etc. shouldn't get our query flag tattooed on them.
	 *
	 * @covers ::desktop_mode_chromeless_preserve_redirect
	 * @covers ::desktop_mode_is_admin_redirect_target
	 */
	public function test_leaves_external_redirect_alone() {
		$this->enter_chromeless();

		$location = 'https://accounts.example.com/oauth/authorize?client_id=foo';
		$this->assertSame( $location, desktop_mode_chromeless_preserve_redirect( $location ) );
	}
}
