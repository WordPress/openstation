<?php

class Tests_OpenStation_Portal extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $subscriber_id;

	protected $pagenow_backup;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id      = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$subscriber_id = $factory->user->create( array( 'role' => 'subscriber' ) );
	}

	public function set_up() {
		parent::set_up();
		$this->pagenow_backup = isset( $GLOBALS['pagenow'] ) ? $GLOBALS['pagenow'] : null;
	}

	public function tear_down() {
		unset(
			$_SERVER['REQUEST_URI'],
			$_SERVER['REQUEST_METHOD'],
			$_SERVER['HTTP_SEC_FETCH_MODE'],
			$_SERVER['HTTP_SEC_FETCH_DEST'],
			$_SERVER['HTTP_REFERER'],
			$_GET[ OPENSTATION_PORTAL_FLAG ],
			$_GET[ OPENSTATION_PORTAL_INTENT_FLAG ],
			$_GET[ OPENSTATION_CLASSIC_FLAG ],
			$_GET['openstation_chromeless'],
			$_GET[ OPENSTATION_SOLO_FLAG ],
			$_GET['target'],
			$GLOBALS['plugin_page'],
			$GLOBALS['current_screen']
		);
		if ( null === $this->pagenow_backup ) {
			unset( $GLOBALS['pagenow'] );
		} else {
			$GLOBALS['pagenow'] = $this->pagenow_backup;
		}
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );
		delete_user_meta( self::$admin_id, OPENSTATION_SESSION_META_KEY );
		delete_user_meta( self::$subscriber_id, 'desktop_mode_mode' );
		remove_all_filters( 'openstation_portal_auto_enable' );
		remove_all_filters( 'openstation_admin_redirect_to_portal' );
		remove_all_filters( 'openstation_skip_redundant_portal_forward' );
		parent::tear_down();
	}

	private function capture_admin_init_redirect() {
		return $this->capture_with( 'openstation_redirect_plain_admin_to_portal' );
	}

	private function capture_redirect( $request_uri ) {
		$_SERVER['REQUEST_URI'] = $request_uri;
		return $this->capture_with( 'openstation_handle_portal_request', null );
	}

	private function capture_with( $callable, ...$args ) {
		$captured = null;
		$filter   = function ( $location ) use ( &$captured ) {
			$captured = $location;
			throw new RuntimeException( 'openstation_test_redirect_intercepted' );
		};
		add_filter( 'wp_redirect', $filter, 10, 1 );

		try {
			$callable( ...$args );
		} catch ( RuntimeException $e ) {
			if ( 'openstation_test_redirect_intercepted' !== $e->getMessage() ) {
				throw $e;
			}
		} finally {
			remove_filter( 'wp_redirect', $filter, 10 );
		}

		return $captured;
	}

	public function test_portal_url_is_canonical() {
		$this->assertSame( home_url( '/openstation/' ), openstation_portal_url() );
	}

	public function test_is_portal_request_detects_exact_path() {
		$_SERVER['REQUEST_URI'] = '/openstation';
		$this->assertTrue( openstation_is_portal_request() );
	}

	public function test_is_portal_request_detects_trailing_slash() {
		$_SERVER['REQUEST_URI'] = '/openstation/';
		$this->assertTrue( openstation_is_portal_request() );
	}

	public function test_is_portal_request_ignores_query_string() {
		$_SERVER['REQUEST_URI'] = '/openstation/?foo=bar';
		$this->assertTrue( openstation_is_portal_request() );
	}

	public function test_is_portal_request_rejects_subpaths() {
		$_SERVER['REQUEST_URI'] = '/openstation/foo';
		$this->assertFalse( openstation_is_portal_request() );
	}

	public function test_is_portal_request_accepts_the_legacy_path() {
		foreach ( array( '/desktop-mode', '/desktop-mode/', '/desktop-mode/?foo=bar' ) as $uri ) {
			$_SERVER['REQUEST_URI'] = $uri;
			$this->assertTrue( openstation_is_portal_request(), $uri );
		}
	}

	public function test_is_portal_request_rejects_legacy_subpaths() {
		$_SERVER['REQUEST_URI'] = '/desktop-mode/foo';
		$this->assertFalse( openstation_is_portal_request() );
	}

	public function test_portal_url_stays_canonical_despite_the_alias() {
		$this->assertSame( home_url( '/openstation/' ), openstation_portal_url() );
	}

	public function test_is_portal_request_rejects_unrelated_paths() {
		$_SERVER['REQUEST_URI'] = '/wp-admin/';
		$this->assertFalse( openstation_is_portal_request() );
	}

	public function test_is_portal_request_false_when_uri_missing() {
		unset( $_SERVER['REQUEST_URI'] );
		$this->assertFalse( openstation_is_portal_request() );
	}

	public function test_handler_is_noop_when_not_portal() {
		wp_set_current_user( self::$admin_id );
		$redirect = $this->capture_redirect( '/wp-admin/' );

		$this->assertNull( $redirect );
	}

	public function test_logged_out_user_redirected_to_login() {
		wp_set_current_user( 0 );
		$redirect = $this->capture_redirect( '/openstation/' );

		$this->assertNotNull( $redirect );
		$this->assertStringContainsString( 'wp-login.php', $redirect );
		$this->assertStringContainsString( rawurlencode( openstation_portal_url() ), $redirect );
	}

	public function test_logged_in_user_auto_enabled() {
		wp_set_current_user( self::$admin_id );
		$this->assertSame( '', get_user_meta( self::$admin_id, 'desktop_mode_mode', true ) );

		$this->capture_redirect( '/openstation/' );

		$this->assertSame( '1', get_user_meta( self::$admin_id, 'desktop_mode_mode', true ) );
	}

	public function test_portal_redirects_to_the_shell_screen() {
		wp_set_current_user( self::$admin_id );
		$redirect = $this->capture_redirect( '/openstation/' );

		$this->assertNotNull( $redirect );
		$this->assertSame( openstation_shell_url(), $redirect );
		$this->assertTrue( openstation_url_is_shell_screen( $redirect ) );
	}

	public function test_auto_enable_filter_can_disable_auto_toggle() {
		wp_set_current_user( self::$admin_id );
		add_filter( 'openstation_portal_auto_enable', '__return_false' );

		$this->capture_redirect( '/openstation/' );

		$this->assertSame( '', get_user_meta( self::$admin_id, 'desktop_mode_mode', true ) );
	}

	public function test_auto_enable_filter_receives_user_id() {
		wp_set_current_user( self::$admin_id );
		$expected_id = self::$admin_id;
		$received_id = null;

		add_filter(
			'openstation_portal_auto_enable',
			function ( $enable, $user_id ) use ( &$received_id ) {
				$received_id = $user_id;
				return $enable;
			},
			10,
			2
		);

		$this->capture_redirect( '/openstation/' );

		$this->assertSame( $expected_id, $received_id );
	}

	public function test_auto_enable_noop_when_meta_already_set() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		$count_before = did_action( 'update_user_meta' );
		$this->capture_redirect( '/openstation/' );

		$this->assertSame( '1', get_user_meta( self::$admin_id, 'desktop_mode_mode', true ) );
	}

	public function test_entry_url_falls_back_to_dashboard_when_session_empty() {
		$this->assertSame( admin_url( 'index.php' ), openstation_portal_entry_url( self::$admin_id ) );
	}

	public function test_entry_url_strips_chromeless_flag() {
		openstation_save_session(
			self::$admin_id,
			array(
				'windows' => array(
					array(
						'id'     => 'wp-window-plugins-php',
						'url'    => admin_url( 'plugins.php?openstation_chromeless=1&paged=2' ),
						'title'  => 'Plugins',
						'icon'   => 'dashicons-admin-plugins',
						'state'  => 'normal',
						'x'      => 0,
						'y'      => 0,
						'width'  => 800,
						'height' => 600,
					),
				),
				'focused' => 'wp-window-plugins-php',
			)
		);

		$entry = openstation_portal_entry_url( self::$admin_id );

		$this->assertStringNotContainsString( 'openstation_chromeless=1', $entry );
	}

	public function test_entry_url_returns_focused_window_url() {
		$target = admin_url( 'edit.php?post_type=page' );
		openstation_save_session(
			self::$admin_id,
			array(
				'windows' => array(
					array(
						'id'     => 'wp-window-edit-php',
						'url'    => admin_url( 'edit.php' ),
						'title'  => 'Posts',
						'icon'   => 'dashicons-admin-post',
						'state'  => 'normal',
						'x'      => 0,
						'y'      => 0,
						'width'  => 800,
						'height' => 600,
					),
					array(
						'id'     => 'wp-window-edit-php-page',
						'url'    => $target,
						'title'  => 'Pages',
						'icon'   => 'dashicons-admin-page',
						'state'  => 'normal',
						'x'      => 0,
						'y'      => 0,
						'width'  => 800,
						'height' => 600,
					),
				),
				'focused' => 'wp-window-edit-php-page',
			)
		);

		$this->assertSame( $target, openstation_portal_entry_url( self::$admin_id ) );
	}

	public function test_entry_url_falls_back_when_focused_missing() {
		openstation_save_session(
			self::$admin_id,
			array(
				'windows' => array(
					array(
						'id'     => 'wp-window-edit-php',
						'url'    => admin_url( 'edit.php' ),
						'title'  => 'Posts',
						'icon'   => 'dashicons-admin-post',
						'state'  => 'normal',
						'x'      => 0,
						'y'      => 0,
						'width'  => 800,
						'height' => 600,
					),
				),
				'focused' => 'wp-window-nonexistent',
			)
		);

		$this->assertSame( admin_url( 'index.php' ), openstation_portal_entry_url( self::$admin_id ) );
	}

	public function test_admin_redirect_sends_desktop_user_to_portal() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_SERVER['REQUEST_METHOD'] = 'GET';

		$redirect = $this->capture_admin_init_redirect();

		$this->assertSame( openstation_portal_url(), $redirect );
	}

	public function test_admin_redirect_noop_when_openstation_off() {
		wp_set_current_user( self::$admin_id );
		$_SERVER['REQUEST_METHOD'] = 'GET';

		$this->assertNull( $this->capture_admin_init_redirect() );
	}

	public function test_admin_redirect_leaves_the_user_admin_classic() {
		if ( ! is_multisite() ) {
			$this->markTestSkipped( 'The user admin only exists on multisite.' );
		}
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_SERVER['REQUEST_METHOD'] = 'GET';

		set_current_screen( 'index-user' );

		$this->assertNull( $this->capture_admin_init_redirect() );
	}

	public function test_admin_redirect_noop_on_chromeless_request() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_SERVER['REQUEST_METHOD'] = 'GET';
		$_GET['openstation_chromeless']        = '1';

		$this->assertNull( $this->capture_admin_init_redirect() );
	}

	public function test_admin_redirect_aliases_the_portal_flag_to_the_shell_screen() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_SERVER['REQUEST_METHOD']       = 'GET';
		$_SERVER['REQUEST_URI']          = '/wp-admin/index.php?' . OPENSTATION_PORTAL_FLAG . '=1';
		$GLOBALS['pagenow']              = 'index.php';
		$_GET[ OPENSTATION_PORTAL_FLAG ] = '1';

		$redirect = $this->capture_admin_init_redirect();

		$this->assertSame( openstation_shell_url( admin_url( 'index.php' ), false ), $redirect );
		$this->assertStringNotContainsString( 'intent=', $redirect );
		$this->assertStringNotContainsString( OPENSTATION_PORTAL_FLAG, rawurldecode( $redirect ) );
	}

	public function test_admin_redirect_alias_carries_intent() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_SERVER['REQUEST_METHOD']              = 'GET';
		$_SERVER['REQUEST_URI']                 = '/wp-admin/post.php?post=104&action=edit&' . OPENSTATION_PORTAL_FLAG . '=1&' . OPENSTATION_PORTAL_INTENT_FLAG . '=1';
		$GLOBALS['pagenow']                     = 'post.php';
		$_GET[ OPENSTATION_PORTAL_FLAG ]        = '1';
		$_GET[ OPENSTATION_PORTAL_INTENT_FLAG ] = '1';

		$redirect = $this->capture_admin_init_redirect();

		$this->assertSame( openstation_shell_url( admin_url( 'post.php?post=104&action=edit' ), true ), $redirect );
	}

	public function test_admin_redirect_alias_with_an_unresolvable_url_lands_on_the_bare_screen() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_SERVER['REQUEST_METHOD']              = 'GET';

		$_SERVER['REQUEST_URI']                 = '/wp-admin/not-a-real-screen.php?' . OPENSTATION_PORTAL_FLAG . '=1&' . OPENSTATION_PORTAL_INTENT_FLAG . '=1';
		$GLOBALS['pagenow']                     = 'not-a-real-screen.php';
		$_GET[ OPENSTATION_PORTAL_FLAG ]        = '1';
		$_GET[ OPENSTATION_PORTAL_INTENT_FLAG ] = '1';

		$this->assertSame( openstation_shell_url(), $this->capture_admin_init_redirect() );
	}

	public function test_a_network_admin_target_resolves_to_the_network_screen() {
		$resolved = openstation_sanitize_portal_target( '/wp-admin/network/sites.php' );

		$this->assertSame( network_admin_url( 'sites.php' ), $resolved );
		$this->assertSame(
			openstation_shell_url( $resolved, true, true ),
			openstation_shell_url( $resolved, true )
		);
	}

	public function test_admin_redirect_alias_runs_even_when_plain_redirects_are_disabled() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_SERVER['REQUEST_METHOD']       = 'GET';
		$_SERVER['REQUEST_URI']          = '/wp-admin/index.php?' . OPENSTATION_PORTAL_FLAG . '=1';
		$GLOBALS['pagenow']              = 'index.php';
		$_GET[ OPENSTATION_PORTAL_FLAG ] = '1';
		add_filter( 'openstation_admin_redirect_to_portal', '__return_false' );

		$this->assertNotNull( $this->capture_admin_init_redirect() );
	}

	public function test_admin_redirect_noop_on_the_shell_screen() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_SERVER['REQUEST_METHOD'] = 'GET';
		$_SERVER['REQUEST_URI']    = '/wp-admin/admin.php?page=openstation&target=%2Fwp-admin%2Fedit.php&intent=1';
		$GLOBALS['pagenow']        = 'admin.php';
		$GLOBALS['plugin_page']    = OPENSTATION_SHELL_PAGE_SLUG;
		set_current_screen( OPENSTATION_SHELL_SCREEN_ID );

		$this->assertNull( $this->capture_admin_init_redirect() );
	}

	public function test_admin_redirect_noop_on_a_solo_request() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_SERVER['REQUEST_METHOD']     = 'GET';
		$_SERVER['REQUEST_URI']        = '/wp-admin/?openstation_solo=os-files';
		$GLOBALS['pagenow']            = 'index.php';
		$_GET[ OPENSTATION_SOLO_FLAG ] = 'os-files';

		$this->assertNull( $this->capture_admin_init_redirect() );
	}

	public function test_admin_redirect_noop_on_post_method() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_SERVER['REQUEST_METHOD'] = 'POST';

		$this->assertNull( $this->capture_admin_init_redirect() );
	}

	public function test_admin_redirect_noop_on_admin_post_page() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_SERVER['REQUEST_METHOD'] = 'GET';
		$GLOBALS['pagenow']        = 'admin-post.php';

		try {
			$this->assertNull( $this->capture_admin_init_redirect() );
		} finally {
			unset( $GLOBALS['pagenow'] );
		}
	}

	public function test_admin_redirect_noop_when_classic_flag_present() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_SERVER['REQUEST_METHOD']      = 'GET';
		$_GET[ OPENSTATION_CLASSIC_FLAG ] = '1';

		$this->assertNull( $this->capture_admin_init_redirect() );
	}

	public function test_admin_redirect_keeps_a_navigation_from_a_classic_tab_classic() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_SERVER['REQUEST_METHOD'] = 'GET';
		$_SERVER['REQUEST_URI']    = '/wp-admin/post.php?post=2&action=elementor';
		$_SERVER['HTTP_REFERER']   = admin_url( 'post.php?post=2&action=edit&' . OPENSTATION_CLASSIC_FLAG . '=1' );
		$GLOBALS['pagenow']        = 'post.php';

		$redirect = $this->capture_admin_init_redirect();

		$this->assertSame( '/wp-admin/post.php?post=2&action=elementor&' . OPENSTATION_CLASSIC_FLAG . '=1', $redirect );
	}

	public function test_admin_redirect_filter_can_disable() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_SERVER['REQUEST_METHOD'] = 'GET';
		add_filter( 'openstation_admin_redirect_to_portal', '__return_false' );

		$this->assertNull( $this->capture_admin_init_redirect() );
	}

	public function test_admin_redirect_goes_straight_to_the_shell_screen_when_the_portal_would_only_hand_the_url_back() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_SERVER['REQUEST_METHOD'] = 'GET';
		$_SERVER['REQUEST_URI']    = '/wp-admin/edit.php?post_type=page';
		$GLOBALS['pagenow']        = 'edit.php';

		$redirect = $this->capture_admin_init_redirect();

		$this->assertSame( openstation_shell_url( admin_url( 'edit.php?post_type=page' ), true ), $redirect );
		$this->assertStringNotContainsString( openstation_portal_url(), $redirect );
	}

	public function test_admin_redirect_sends_bare_admin_root_to_the_shell_screen_with_the_dashboard() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_SERVER['REQUEST_METHOD'] = 'GET';
		$_SERVER['REQUEST_URI']    = '/wp-admin/';
		$GLOBALS['pagenow']        = 'index.php';

		$this->assertSame(
			openstation_shell_url( admin_url( 'index.php' ), true ),
			$this->capture_admin_init_redirect()
		);
	}

	public function test_admin_redirect_disabled_leaves_a_classic_page_without_the_shell() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_SERVER['REQUEST_METHOD'] = 'GET';
		$_SERVER['REQUEST_URI']    = '/wp-admin/edit.php';
		$GLOBALS['pagenow']        = 'edit.php';
		set_current_screen( 'edit-post' );
		add_filter( 'openstation_admin_redirect_to_portal', '__return_false' );

		$this->assertNull( $this->capture_admin_init_redirect() );
		$this->assertFalse( openstation_is_shell_request() );
	}

	public function test_admin_redirect_still_forwards_network_admin_path() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_SERVER['REQUEST_METHOD'] = 'GET';
		$_SERVER['REQUEST_URI']    = '/wp-admin/network/sites.php';
		$GLOBALS['pagenow']        = 'sites.php';

		$redirect = $this->capture_admin_init_redirect();

		$this->assertNotNull( $redirect );
		$this->assertStringContainsString( 'target=', $redirect );
	}

	public function test_admin_redirect_still_forwards_when_query_would_be_rewritten() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_SERVER['REQUEST_METHOD'] = 'GET';
		$_SERVER['REQUEST_URI']    = '/wp-admin/edit.php?target=%2Fwp-admin%2Findex.php';
		$GLOBALS['pagenow']        = 'edit.php';
		$_GET['target']            = '/wp-admin/index.php';

		$this->assertNotNull( $this->capture_admin_init_redirect() );
	}

	public function test_admin_redirect_skip_is_filterable() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_SERVER['REQUEST_METHOD'] = 'GET';
		$_SERVER['REQUEST_URI']    = '/wp-admin/edit.php?post_type=page';
		$GLOBALS['pagenow']        = 'edit.php';
		add_filter( 'openstation_skip_redundant_portal_forward', '__return_false' );

		$redirect = $this->capture_admin_init_redirect();

		$this->assertNotNull( $redirect );
		$this->assertStringStartsWith( openstation_portal_url(), $redirect );
		$this->assertStringContainsString( 'target=', $redirect );
	}

	public function test_forward_is_redundant_for_allowlisted_page_being_served() {
		$GLOBALS['pagenow'] = 'edit.php';

		$this->assertTrue( openstation_portal_forward_is_redundant( '/wp-admin/edit.php?post_type=page' ) );
	}

	public function test_forward_is_not_redundant_when_pagenow_disagrees() {
		$GLOBALS['pagenow'] = 'index.php';

		$this->assertFalse( openstation_portal_forward_is_redundant( '/wp-admin/edit.php' ) );
	}

	public function test_forward_is_not_redundant_outside_the_admin_path() {
		$GLOBALS['pagenow'] = 'index.php';

		$this->assertFalse( openstation_portal_forward_is_redundant( '/blog/hello-world/' ) );
	}

	public function test_forward_is_not_redundant_without_a_request_uri() {
		$GLOBALS['pagenow'] = 'index.php';

		$this->assertFalse( openstation_portal_forward_is_redundant( '' ) );
	}

	public function test_forward_is_not_redundant_when_a_stripped_query_arg_is_present() {
		$GLOBALS['pagenow'] = 'edit.php';
		$_GET['target']     = '/wp-admin/index.php';

		$this->assertFalse( openstation_portal_forward_is_redundant( '/wp-admin/edit.php' ) );
	}

	public function test_admin_redirect_preserves_percent_encoded_slashes() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_SERVER['REQUEST_METHOD'] = 'GET';
		$GLOBALS['pagenow']        = 'plugins.php';
		$_SERVER['REQUEST_URI']    = '/wp-admin/network/plugins.php?action=activate&plugin=desktop-mode-cron-manager%2Fdesktop-mode-cron-manager.php&_wpnonce=abc123';

		$redirect = $this->capture_admin_init_redirect();

		$this->assertNotNull( $redirect );

		$this->assertStringNotContainsString(
			'plugin=desktop-mode-cron-managerdesktop-mode-cron-manager.php',
			$redirect
		);
		$this->assertStringNotContainsString(
			'plugin%3Ddesktop-mode-cron-managerdesktop-mode-cron-manager.php',
			$redirect
		);
	}

	public function test_portal_target_preserves_percent_encoded_slashes() {
		wp_set_current_user( self::$admin_id );

		$raw_uri              = '/wp-admin/plugins.php?action=activate&plugin=desktop-mode-cron-manager%2Fdesktop-mode-cron-manager.php&_wpnonce=abc123';
		$_GET['target']       = $raw_uri;
		$_SERVER['REQUEST_URI'] = '/openstation/?target=' . rawurlencode( $raw_uri );

		try {
			$redirect = $this->capture_with( 'openstation_handle_portal_request', null );
		} finally {
			unset( $_GET['target'] );
		}

		$this->assertNotNull( $redirect );

		$target = $this->shell_target_of( $redirect );
		$this->assertStringContainsString( 'plugin=desktop-mode-cron-manager%2Fdesktop-mode-cron-manager.php', $target );
		$this->assertStringContainsString( 'action=activate', $target );
		$this->assertStringContainsString( '_wpnonce=abc123', $target );
	}

	public function test_sanitize_target_rejects_page_less_admin_php() {
		$this->assertSame( '', openstation_sanitize_portal_target( '/wp-admin/admin.php' ) );
		$this->assertSame( '', openstation_sanitize_portal_target( '/wp-admin/admin.php?page=' ) );

		$this->assertSame( '', openstation_sanitize_portal_target( '/wp-admin/admin.php?action=edit&id=7' ) );
	}

	public function test_sanitize_target_keeps_admin_php_with_a_page() {
		$this->assertSame(
			admin_url( 'admin.php?page=jetpack' ),
			openstation_sanitize_portal_target( '/wp-admin/admin.php?page=jetpack' )
		);
	}

	public function test_admin_redirect_does_not_target_a_page_less_admin_php() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_SERVER['REQUEST_METHOD'] = 'GET';
		$_SERVER['REQUEST_URI']    = '/wp-admin/admin.php';
		$GLOBALS['pagenow']        = 'admin.php';

		$redirect = $this->capture_admin_init_redirect();

		$this->assertNotNull( $redirect );
		$this->assertSame( '', $this->shell_target_of( $redirect ) );
		$this->assertStringNotContainsString( 'intent=1', $redirect );
	}

	private function shell_target_of( $url ) {
		$query = wp_parse_url( $url, PHP_URL_QUERY );
		if ( ! is_string( $query ) ) {
			return '';
		}
		parse_str( $query, $args );
		return isset( $args['target'] ) ? (string) $args['target'] : '';
	}

	public function test_portal_honors_session_focused_window() {
		wp_set_current_user( self::$admin_id );
		$target_path = 'edit.php?post_type=page';
		openstation_save_session(
			self::$admin_id,
			array(
				'windows' => array(
					array(
						'id'     => 'wp-window-edit-php-page',
						'url'    => admin_url( $target_path ),
						'title'  => 'Pages',
						'icon'   => 'dashicons-admin-page',
						'state'  => 'normal',
						'x'      => 0,
						'y'      => 0,
						'width'  => 800,
						'height' => 600,
					),
				),
				'focused' => 'wp-window-edit-php-page',
			)
		);

		$redirect = $this->capture_redirect( '/openstation/' );

		$this->assertSame( openstation_shell_url(), $redirect );
		$this->assertSame( admin_url( $target_path ), openstation_portal_entry_url( self::$admin_id ) );
	}

	public function test_portal_bare_visit_omits_intent_flag() {
		wp_set_current_user( self::$admin_id );

		$redirect = $this->capture_redirect( '/openstation/' );

		$this->assertNotNull( $redirect );
		$this->assertTrue( openstation_url_is_shell_screen( $redirect ) );
		$this->assertStringNotContainsString( 'target=', $redirect );
		$this->assertStringNotContainsString( 'intent=', $redirect );
	}

	public function test_portal_target_redirect_carries_intent_flag() {
		wp_set_current_user( self::$admin_id );
		$raw_uri                = '/wp-admin/post.php?post=104&action=edit';
		$_GET['target']         = $raw_uri;
		$_SERVER['REQUEST_URI'] = '/openstation/?target=' . rawurlencode( $raw_uri );

		try {
			$redirect = $this->capture_with( 'openstation_handle_portal_request', null );
		} finally {
			unset( $_GET['target'] );
		}

		$this->assertNotNull( $redirect );
		$this->assertSame( openstation_shell_url( admin_url( 'post.php?post=104&action=edit' ), true ), $redirect );
		$target = $this->shell_target_of( $redirect );
		$this->assertStringContainsString( 'post.php', $target );
		$this->assertStringContainsString( 'post=104', $target );
		$this->assertStringContainsString( 'action=edit', $target );
		$this->assertStringContainsString( 'intent=1', $redirect );
	}

	public function test_portal_invalid_target_does_not_set_intent_flag() {
		wp_set_current_user( self::$admin_id );
		$_GET['target']         = '/somewhere-not-admin/foo.php';
		$_SERVER['REQUEST_URI'] = '/openstation/?target=' . rawurlencode( '/somewhere-not-admin/foo.php' );

		try {
			$redirect = $this->capture_with( 'openstation_handle_portal_request', null );
		} finally {
			unset( $_GET['target'] );
		}

		$this->assertNotNull( $redirect );
		$this->assertSame( openstation_shell_url(), $redirect );
		$this->assertStringNotContainsString( 'intent=', $redirect );
	}

	public function test_portal_target_with_existing_intent_flag_is_normalised() {
		wp_set_current_user( self::$admin_id );

		$raw_uri                = '/wp-admin/edit.php?post_type=page&' . OPENSTATION_PORTAL_INTENT_FLAG . '=1';
		$_GET['target']         = $raw_uri;
		$_SERVER['REQUEST_URI'] = '/openstation/?target=' . rawurlencode( $raw_uri );

		try {
			$redirect = $this->capture_with( 'openstation_handle_portal_request', null );
		} finally {
			unset( $_GET['target'] );
		}

		$this->assertNotNull( $redirect );

		$this->assertStringNotContainsString( OPENSTATION_PORTAL_INTENT_FLAG, $this->shell_target_of( $redirect ) );
		$this->assertSame( 1, substr_count( $redirect, 'intent=1' ) );
	}

	public function test_admin_redirect_noop_on_a_subresource_fetch() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_SERVER['REQUEST_METHOD']      = 'GET';
		$_SERVER['REQUEST_URI']         = '/wp-admin/admin.php?page=stats&noheader&proxy&chart=admin-bar-hours-scale';
		$_SERVER['HTTP_SEC_FETCH_MODE'] = 'no-cors';
		$_SERVER['HTTP_SEC_FETCH_DEST'] = 'image';
		$GLOBALS['pagenow']             = 'admin.php';

		$this->assertNull( $this->capture_admin_init_redirect() );
	}

	public function test_admin_redirect_still_forwards_a_navigation_to_the_same_screen() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_SERVER['REQUEST_METHOD']      = 'GET';
		$_SERVER['REQUEST_URI']         = '/wp-admin/admin.php?page=stats';
		$_SERVER['HTTP_SEC_FETCH_MODE'] = 'navigate';
		$_SERVER['HTTP_SEC_FETCH_DEST'] = 'document';
		$GLOBALS['pagenow']             = 'admin.php';

		$this->assertSame(
			openstation_shell_url( admin_url( 'admin.php?page=stats' ), true ),
			$this->capture_admin_init_redirect()
		);
	}
}
