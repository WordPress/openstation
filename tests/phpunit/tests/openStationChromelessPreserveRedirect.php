<?php

class Tests_OpenStationChromelessPreserveRedirect extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	protected $pagenow;

	public function set_up() {
		parent::set_up();
		set_current_screen( 'dashboard' );
		wp_set_current_user( self::$admin_id );
		$this->pagenow = $GLOBALS['pagenow'] ?? null;
	}

	public function tear_down() {
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );
		delete_transient( openstation_plugins_handoff_key( self::$admin_id ) );
		unset( $_GET['openstation_chromeless'], $_SERVER['REQUEST_URI'] );
		$GLOBALS['pagenow'] = $this->pagenow;
		parent::tear_down();
	}

	private function enter_chromeless() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless'] = '1';
	}

	public function test_appends_flag_to_admin_redirect_in_chromeless() {
		$this->enter_chromeless();

		$filtered = openstation_chromeless_preserve_redirect( admin_url( 'edit.php' ) );

		$this->assertStringContainsString( 'openstation_chromeless=1', $filtered );
	}

	public function test_leaves_admin_redirect_alone_when_not_chromeless() {
		$location = admin_url( 'edit.php' );

		$this->assertSame( $location, openstation_chromeless_preserve_redirect( $location ) );
	}

	public function test_leaves_non_admin_redirect_alone() {
		$this->enter_chromeless();

		$location = home_url( '/hello-world/' );

		$this->assertSame( $location, openstation_chromeless_preserve_redirect( $location ) );
	}

	public function test_does_not_double_append_when_flag_already_present() {
		$this->enter_chromeless();

		$location = admin_url( 'edit.php?openstation_chromeless=1' );
		$filtered = openstation_chromeless_preserve_redirect( $location );

		$this->assertSame( $location, $filtered );
		$this->assertSame( 1, substr_count( $filtered, 'openstation_chromeless=' ) );
	}

	public function test_leaves_empty_location_alone() {
		$this->enter_chromeless();

		$this->assertSame( '', openstation_chromeless_preserve_redirect( '' ) );
	}

	public function test_preserves_existing_query_args() {
		$this->enter_chromeless();

		$filtered = openstation_chromeless_preserve_redirect(
			admin_url( 'post.php?post=7&action=edit&message=1' )
		);

		$this->assertStringContainsString( 'post=7', $filtered );
		$this->assertStringContainsString( 'action=edit', $filtered );
		$this->assertStringContainsString( 'message=1', $filtered );
		$this->assertStringContainsString( 'openstation_chromeless=1', $filtered );
	}

	public function test_filter_is_registered_on_wp_redirect() {
		$this->assertSame(
			999,
			has_filter( 'wp_redirect', 'openstation_chromeless_preserve_redirect' )
		);
	}

	public function test_appends_flag_to_relative_admin_redirect_in_chromeless() {
		set_current_screen( 'user-new' );
		$this->enter_chromeless();

		$filtered = openstation_chromeless_preserve_redirect( 'users.php?update=add&id=42' );

		$this->assertStringContainsString( 'openstation_chromeless=1', $filtered );
		$this->assertStringContainsString( 'update=add', $filtered );
		$this->assertStringContainsString( 'id=42', $filtered );
	}

	public function test_appends_flag_to_absolute_path_admin_redirect() {
		$this->enter_chromeless();

		$filtered = openstation_chromeless_preserve_redirect( '/wp-admin/users.php?update=add' );

		$this->assertStringContainsString( 'openstation_chromeless=1', $filtered );
	}

	public function test_leaves_external_redirect_alone() {
		$this->enter_chromeless();

		$location = 'https://accounts.example.com/oauth/authorize?client_id=foo';
		$this->assertSame( $location, openstation_chromeless_preserve_redirect( $location ) );
	}

	public function test_a_plugin_redirect_off_the_plugins_screen_opens_in_its_own_window() {
		$this->enter_chromeless();
		$GLOBALS['pagenow']     = 'plugins.php';
		$_SERVER['REQUEST_URI'] = '/wp-admin/plugins.php?activate=true';
		$core                   = self_admin_url( 'plugins.php?activate=true' );
		$destination            = admin_url( 'admin.php?page=elementor-app#onboarding' );

		$this->assertSame( $core, openstation_chromeless_hand_off_plugins_redirect( $core ) );
		$this->assertSame( '/wp-admin/plugins.php?activate=true', openstation_chromeless_hand_off_plugins_redirect( $destination ) );

		ob_start();
		openstation_chromeless_open_handed_off_redirect();
		openstation_chromeless_open_handed_off_redirect();
		$markup = (string) ob_get_clean();
		$this->assertSame( 1, substr_count( $markup, '"type":"os-iframe-admin-link"' ) );
		$this->assertStringContainsString( '"url":' . wp_json_encode( $destination ), $markup );
		$this->assertStringContainsString( '"newContext":true', $markup );
	}

	public function test_a_plugin_that_redirects_again_is_let_through() {
		$this->enter_chromeless();
		$GLOBALS['pagenow']     = 'plugins.php';
		$_SERVER['REQUEST_URI'] = '/wp-admin/plugins.php?activate=true';
		$destination            = admin_url( 'admin.php?page=welcome' );

		openstation_chromeless_hand_off_plugins_redirect( $destination );

		$this->assertSame( $destination, openstation_chromeless_hand_off_plugins_redirect( $destination ) );
	}
}
