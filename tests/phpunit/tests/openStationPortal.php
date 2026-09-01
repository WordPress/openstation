<?php
/**
 * Tests for the `/openstation` portal entry point.
 *
 * Covers URL detection, auto-enabling the user toggle, entry-URL
 * resolution from the saved session, and redirect behavior for
 * logged-in vs logged-out users.
 *
 * `parse_request` calls `wp_safe_redirect` + `exit`; we intercept by
 * throwing from the `wp_redirect` filter so we can inspect the target
 * URL without the process actually exiting.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-portal
 */
class Tests_OpenStation_Portal extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $subscriber_id;

	/**
	 * `$pagenow` as the test bootstrap left it, restored on tear-down.
	 *
	 * The admin_init redirect guard compares the request path against
	 * the page actually being served, so tests that exercise it have to
	 * fake `$pagenow` to match the URI they set.
	 *
	 * @var string|null
	 */
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

	/**
	 * Invokes the admin_init redirect guard and captures any redirect
	 * target, same interception technique as capture_redirect() below.
	 */
	private function capture_admin_init_redirect() {
		return $this->capture_with( 'openstation_redirect_plain_admin_to_portal' );
	}

	/**
	 * Invokes the portal handler and returns the redirect URL it would
	 * have sent.
	 *
	 * The handler follows `wp_safe_redirect()` with an unconditional `exit;`,
	 * so returning `false` from the `wp_redirect` filter only stops the
	 * header — the caller's `exit` still kills the test process. We throw
	 * from the filter instead to unwind execution before the `exit;` is
	 * reached, then catch the exception here and hand back the URL.
	 *
	 * @return string|null Redirect URL, or null if no redirect was attempted.
	 */
	private function capture_redirect( $request_uri ) {
		$_SERVER['REQUEST_URI'] = $request_uri;
		return $this->capture_with( 'openstation_handle_portal_request', null );
	}

	/**
	 * Shared capture implementation: hook `wp_redirect` with a throwing
	 * filter, run $callable, and return the captured URL (or null).
	 *
	 * @param callable $callable The handler to invoke.
	 * @param mixed    ...$args  Arguments to pass to the handler.
	 * @return string|null
	 */
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

	/**
	 * @covers ::openstation_portal_url
	 */
	public function test_portal_url_is_canonical() {
		$this->assertSame( home_url( '/openstation/' ), openstation_portal_url() );
	}

	/**
	 * @covers ::openstation_is_portal_request
	 */
	public function test_is_portal_request_detects_exact_path() {
		$_SERVER['REQUEST_URI'] = '/openstation';
		$this->assertTrue( openstation_is_portal_request() );
	}

	/**
	 * @covers ::openstation_is_portal_request
	 */
	public function test_is_portal_request_detects_trailing_slash() {
		$_SERVER['REQUEST_URI'] = '/openstation/';
		$this->assertTrue( openstation_is_portal_request() );
	}

	/**
	 * @covers ::openstation_is_portal_request
	 */
	public function test_is_portal_request_ignores_query_string() {
		$_SERVER['REQUEST_URI'] = '/openstation/?foo=bar';
		$this->assertTrue( openstation_is_portal_request() );
	}

	/**
	 * @covers ::openstation_is_portal_request
	 */
	public function test_is_portal_request_rejects_subpaths() {
		$_SERVER['REQUEST_URI'] = '/openstation/foo';
		$this->assertFalse( openstation_is_portal_request() );
	}

	/**
	 * The portal answered to `/desktop-mode/` before the rebrand, and
	 * that is a bookmarkable address, so it keeps working.
	 *
	 * @covers ::openstation_is_portal_request
	 */
	public function test_is_portal_request_accepts_the_legacy_path() {
		foreach ( array( '/desktop-mode', '/desktop-mode/', '/desktop-mode/?foo=bar' ) as $uri ) {
			$_SERVER['REQUEST_URI'] = $uri;
			$this->assertTrue( openstation_is_portal_request(), $uri );
		}
	}

	/**
	 * The legacy path is an alias, not a second canonical address:
	 * subpaths under it are no more valid than under the current one.
	 *
	 * @covers ::openstation_is_portal_request
	 */
	public function test_is_portal_request_rejects_legacy_subpaths() {
		$_SERVER['REQUEST_URI'] = '/desktop-mode/foo';
		$this->assertFalse( openstation_is_portal_request() );
	}

	/**
	 * @covers ::openstation_portal_url
	 */
	public function test_portal_url_stays_canonical_despite_the_alias() {
		$this->assertSame( home_url( '/openstation/' ), openstation_portal_url() );
	}

	/**
	 * @covers ::openstation_is_portal_request
	 */
	public function test_is_portal_request_rejects_unrelated_paths() {
		$_SERVER['REQUEST_URI'] = '/wp-admin/';
		$this->assertFalse( openstation_is_portal_request() );
	}

	/**
	 * @covers ::openstation_is_portal_request
	 */
	public function test_is_portal_request_false_when_uri_missing() {
		unset( $_SERVER['REQUEST_URI'] );
		$this->assertFalse( openstation_is_portal_request() );
	}

	/**
	 * @covers ::openstation_handle_portal_request
	 */
	public function test_handler_is_noop_when_not_portal() {
		wp_set_current_user( self::$admin_id );
		$redirect = $this->capture_redirect( '/wp-admin/' );

		$this->assertNull( $redirect );
	}

	/**
	 * @covers ::openstation_handle_portal_request
	 */
	public function test_logged_out_user_redirected_to_login() {
		wp_set_current_user( 0 );
		$redirect = $this->capture_redirect( '/openstation/' );

		$this->assertNotNull( $redirect );
		$this->assertStringContainsString( 'wp-login.php', $redirect );
		$this->assertStringContainsString( rawurlencode( openstation_portal_url() ), $redirect );
	}

	/**
	 * @covers ::openstation_handle_portal_request
	 */
	public function test_logged_in_user_auto_enabled() {
		wp_set_current_user( self::$admin_id );
		$this->assertSame( '', get_user_meta( self::$admin_id, 'desktop_mode_mode', true ) );

		$this->capture_redirect( '/openstation/' );

		$this->assertSame( '1', get_user_meta( self::$admin_id, 'desktop_mode_mode', true ) );
	}

	/**
	 * @covers ::openstation_handle_portal_request
	 */
	public function test_portal_redirects_to_the_shell_screen() {
		wp_set_current_user( self::$admin_id );
		$redirect = $this->capture_redirect( '/openstation/' );

		$this->assertNotNull( $redirect );
		$this->assertSame( openstation_shell_url(), $redirect );
		$this->assertTrue( openstation_url_is_shell_screen( $redirect ) );
	}

	/**
	 * @covers ::openstation_handle_portal_request
	 */
	public function test_auto_enable_filter_can_disable_auto_toggle() {
		wp_set_current_user( self::$admin_id );
		add_filter( 'openstation_portal_auto_enable', '__return_false' );

		$this->capture_redirect( '/openstation/' );

		$this->assertSame( '', get_user_meta( self::$admin_id, 'desktop_mode_mode', true ) );
	}

	/**
	 * @covers ::openstation_handle_portal_request
	 */
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

	/**
	 * @covers ::openstation_handle_portal_request
	 */
	public function test_auto_enable_noop_when_meta_already_set() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		$count_before = did_action( 'update_user_meta' );
		$this->capture_redirect( '/openstation/' );

		// Still '1' — we didn't flip it off and back on.
		$this->assertSame( '1', get_user_meta( self::$admin_id, 'desktop_mode_mode', true ) );
	}

	/**
	 * @covers ::openstation_portal_entry_url
	 */
	public function test_entry_url_falls_back_to_dashboard_when_session_empty() {
		$this->assertSame( admin_url( 'index.php' ), openstation_portal_entry_url( self::$admin_id ) );
	}

	/**
	 * The portal navigates the top window. A focused-window URL carrying
	 * `openstation_chromeless=1` (iframe flag) would land the top window in chromeless
	 * mode with no admin bar, no toggle, and no way out. Strip it.
	 *
	 * @covers ::openstation_portal_entry_url
	 */
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

	/**
	 * @covers ::openstation_portal_entry_url
	 */
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

	/**
	 * @covers ::openstation_portal_entry_url
	 */
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

	/**
	 * With no `REQUEST_URI` to inspect, the guard can't prove the
	 * forward is redundant, so it falls through to the portal — and
	 * with nothing to preserve, it forwards to the bare portal URL.
	 *
	 * @covers ::openstation_redirect_plain_admin_to_portal
	 */
	public function test_admin_redirect_sends_desktop_user_to_portal() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_SERVER['REQUEST_METHOD'] = 'GET';

		$redirect = $this->capture_admin_init_redirect();

		$this->assertSame( openstation_portal_url(), $redirect );
	}

	/**
	 * @covers ::openstation_redirect_plain_admin_to_portal
	 */
	public function test_admin_redirect_noop_when_openstation_off() {
		wp_set_current_user( self::$admin_id );
		$_SERVER['REQUEST_METHOD'] = 'GET';

		$this->assertNull( $this->capture_admin_init_redirect() );
	}

	/**
	 * The user admin (`wp-admin/user/`) renders classic: it has no
	 * shell screen, and its URLs never survive the target allowlist —
	 * without the pass-through the redirect claimed the request and
	 * silently forwarded the user to the site desktop.
	 *
	 * @covers ::openstation_redirect_plain_admin_to_portal
	 */
	public function test_admin_redirect_leaves_the_user_admin_classic() {
		if ( ! is_multisite() ) {
			$this->markTestSkipped( 'The user admin only exists on multisite.' );
		}
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_SERVER['REQUEST_METHOD'] = 'GET';
		// A `-user` suffixed screen id is what makes `is_user_admin()`
		// true, the same signal the live request carries.
		set_current_screen( 'index-user' );

		$this->assertNull( $this->capture_admin_init_redirect() );
	}

	/**
	 * @covers ::openstation_redirect_plain_admin_to_portal
	 */
	public function test_admin_redirect_noop_on_chromeless_request() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_SERVER['REQUEST_METHOD'] = 'GET';
		$_GET['openstation_chromeless']        = '1';

		$this->assertNull( $this->capture_admin_init_redirect() );
	}

	/**
	 * The frozen `desktop_mode_portal` flag is the desktop's pre-screen
	 * address: a URL carrying it goes to the shell screen with that URL
	 * as the target, flags stripped.
	 *
	 * @covers ::openstation_redirect_plain_admin_to_portal
	 */
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

	/**
	 * The intent flag travels with the alias.
	 *
	 * @covers ::openstation_redirect_plain_admin_to_portal
	 */
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

	/**
	 * An alias whose URL the allowlist rejects still reaches the
	 * desktop — the bare screen, which resolves the entry itself.
	 *
	 * @covers ::openstation_redirect_plain_admin_to_portal
	 */
	public function test_admin_redirect_alias_with_an_unresolvable_url_lands_on_the_bare_screen() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_SERVER['REQUEST_METHOD']              = 'GET';
		// Not `network/sites.php`: the network admin's own screens
		// resolve now, so an unresolvable URL has to be one no admin
		// serves.
		$_SERVER['REQUEST_URI']                 = '/wp-admin/not-a-real-screen.php?' . OPENSTATION_PORTAL_FLAG . '=1&' . OPENSTATION_PORTAL_INTENT_FLAG . '=1';
		$GLOBALS['pagenow']                     = 'not-a-real-screen.php';
		$_GET[ OPENSTATION_PORTAL_FLAG ]        = '1';
		$_GET[ OPENSTATION_PORTAL_INTENT_FLAG ] = '1';

		$this->assertSame( openstation_shell_url(), $this->capture_admin_init_redirect() );
	}

	/**
	 * A network admin URL reaches the NETWORK shell screen, carrying
	 * itself as the target. The two admins have separate screens
	 * because a window on one is a window on the other's desktop
	 * otherwise, with the wrong dock behind it.
	 *
	 * @covers ::openstation_sanitize_portal_target
	 * @covers ::openstation_shell_url
	 */
	public function test_a_network_admin_target_resolves_to_the_network_screen() {
		$resolved = openstation_sanitize_portal_target( '/wp-admin/network/sites.php' );

		$this->assertSame( network_admin_url( 'sites.php' ), $resolved );
		$this->assertSame(
			openstation_shell_url( $resolved, true, true ),
			openstation_shell_url( $resolved, true )
		);
	}

	/**
	 * The alias outranks `openstation_admin_redirect_to_portal`: a URL
	 * naming the desktop is not a plain admin page.
	 *
	 * @covers ::openstation_redirect_plain_admin_to_portal
	 */
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

	/**
	 * The screen every branch redirects to is itself a plain admin GET
	 * and must never be redirected again.
	 *
	 * @covers ::openstation_redirect_plain_admin_to_portal
	 */
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

	/**
	 * A solo boot renders one window in place, wherever it landed.
	 *
	 * @covers ::openstation_redirect_plain_admin_to_portal
	 */
	public function test_admin_redirect_noop_on_a_solo_request() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_SERVER['REQUEST_METHOD']     = 'GET';
		$_SERVER['REQUEST_URI']        = '/wp-admin/?openstation_solo=os-files';
		$GLOBALS['pagenow']            = 'index.php';
		$_GET[ OPENSTATION_SOLO_FLAG ] = 'os-files';

		$this->assertNull( $this->capture_admin_init_redirect() );
	}

	/**
	 * @covers ::openstation_redirect_plain_admin_to_portal
	 */
	public function test_admin_redirect_noop_on_post_method() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_SERVER['REQUEST_METHOD'] = 'POST';

		$this->assertNull( $this->capture_admin_init_redirect() );
	}

	/**
	 * @covers ::openstation_redirect_plain_admin_to_portal
	 */
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

	/**
	 * The detach button opens a URL tagged with `desktop_mode_classic=1`.
	 * That tag tells the admin_init redirect to leave this one request
	 * alone so the user can view the page as classic wp-admin in a new
	 * tab without flipping off OpenStation account-wide.
	 *
	 * @covers ::openstation_redirect_plain_admin_to_portal
	 */
	public function test_admin_redirect_noop_when_classic_flag_present() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_SERVER['REQUEST_METHOD']      = 'GET';
		$_GET[ OPENSTATION_CLASSIC_FLAG ] = '1';

		$this->assertNull( $this->capture_admin_init_redirect() );
	}

	/**
	 * @covers ::openstation_redirect_plain_admin_to_portal
	 */
	public function test_admin_redirect_filter_can_disable() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_SERVER['REQUEST_METHOD'] = 'GET';
		add_filter( 'openstation_admin_redirect_to_portal', '__return_false' );

		$this->assertNull( $this->capture_admin_init_redirect() );
	}

	/**
	 * An ordinary admin URL goes straight to the shell screen, one hop.
	 *
	 * `/wp-admin/edit.php?post_type=page` resolves through the portal's
	 * allowlist back to itself, so routing through `/openstation/` would
	 * spend a WordPress bootstrap to learn what is already known. The
	 * URL is the target, and it is the user's intent.
	 *
	 * @covers ::openstation_redirect_plain_admin_to_portal
	 */
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

	/**
	 * The bare admin root — the URL the perf report measured — resolves
	 * to `index.php`, which is what WordPress serves there anyway.
	 *
	 * @covers ::openstation_redirect_plain_admin_to_portal
	 */
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

	/**
	 * A plain admin page rendered with the redirect disabled is classic
	 * admin: the shell lives on its screen and at `/openstation/` only.
	 *
	 * @covers ::openstation_redirect_plain_admin_to_portal
	 * @covers ::openstation_is_shell_request
	 */
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

	/**
	 * Multisite network-admin URLs still forward. `network/sites.php`
	 * carries a sub-path, which the wp-admin allowlist rejects, so the
	 * portal genuinely picks a different destination (the session's
	 * focused window) — the case the forward still exists to serve.
	 *
	 * @covers ::openstation_redirect_plain_admin_to_portal
	 */
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

	/**
	 * The portal drops `target` from the URL it rebuilds, so a request
	 * already carrying one comes back different and must still forward.
	 *
	 * @covers ::openstation_redirect_plain_admin_to_portal
	 */
	public function test_admin_redirect_still_forwards_when_query_would_be_rewritten() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_SERVER['REQUEST_METHOD'] = 'GET';
		$_SERVER['REQUEST_URI']    = '/wp-admin/edit.php?target=%2Fwp-admin%2Findex.php';
		$GLOBALS['pagenow']        = 'edit.php';
		$_GET['target']            = '/wp-admin/index.php';

		$this->assertNotNull( $this->capture_admin_init_redirect() );
	}

	/**
	 * A plugin that hooks `openstation_handle_portal_request` for its
	 * own side effects can force the round trip back on.
	 *
	 * @covers ::openstation_redirect_plain_admin_to_portal
	 */
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

	/**
	 * @covers ::openstation_portal_forward_is_redundant
	 */
	public function test_forward_is_redundant_for_allowlisted_page_being_served() {
		$GLOBALS['pagenow'] = 'edit.php';

		$this->assertTrue( openstation_portal_forward_is_redundant( '/wp-admin/edit.php?post_type=page' ) );
	}

	/**
	 * `$pagenow` disagreeing with the URL path means a rewrite is in
	 * play and we can't claim to know what renders here, so the forward
	 * stands.
	 *
	 * @covers ::openstation_portal_forward_is_redundant
	 */
	public function test_forward_is_not_redundant_when_pagenow_disagrees() {
		$GLOBALS['pagenow'] = 'index.php';

		$this->assertFalse( openstation_portal_forward_is_redundant( '/wp-admin/edit.php' ) );
	}

	/**
	 * @covers ::openstation_portal_forward_is_redundant
	 */
	public function test_forward_is_not_redundant_outside_the_admin_path() {
		$GLOBALS['pagenow'] = 'index.php';

		$this->assertFalse( openstation_portal_forward_is_redundant( '/blog/hello-world/' ) );
	}

	/**
	 * @covers ::openstation_portal_forward_is_redundant
	 */
	public function test_forward_is_not_redundant_without_a_request_uri() {
		$GLOBALS['pagenow'] = 'index.php';

		$this->assertFalse( openstation_portal_forward_is_redundant( '' ) );
	}

	/**
	 * @covers ::openstation_portal_forward_is_redundant
	 */
	public function test_forward_is_not_redundant_when_a_stripped_query_arg_is_present() {
		$GLOBALS['pagenow'] = 'edit.php';
		$_GET['target']     = '/wp-admin/index.php';

		$this->assertFalse( openstation_portal_forward_is_redundant( '/wp-admin/edit.php' ) );
	}

	/**
	 * Regression: a request URI carrying a percent-encoded slash in a
	 * query arg (e.g. `plugin=dir%2Ffile.php` on the WP "Activate
	 * Plugin" link) must survive the redirect to the portal with the
	 * encoding intact.
	 *
	 * `sanitize_text_field` strips every `%XX` sequence as an XSS
	 * safeguard — fine for plain text, catastrophic for request URIs.
	 * We use `esc_url_raw` instead, which preserves percent-encoded
	 * chars while still stripping control sequences.
	 *
	 * The URI is a NETWORK-admin activate link on purpose. The
	 * single-site equivalent no longer reaches this code path: the
	 * portal would resolve it straight back to itself, so
	 * {@see openstation_portal_forward_is_redundant()} short-circuits
	 * the forward and we render in place. `network/plugins.php` fails
	 * the wp-admin allowlist (sub-path), which is exactly the case the
	 * forward still exists to serve — and it carries the same encoded
	 * slash, so the regression stays pinned.
	 *
	 * @covers ::openstation_redirect_plain_admin_to_portal
	 */
	public function test_admin_redirect_preserves_percent_encoded_slashes() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_SERVER['REQUEST_METHOD'] = 'GET';
		$GLOBALS['pagenow']        = 'plugins.php';
		$_SERVER['REQUEST_URI']    = '/wp-admin/network/plugins.php?action=activate&plugin=desktop-mode-cron-manager%2Fdesktop-mode-cron-manager.php&_wpnonce=abc123';

		$redirect = $this->capture_admin_init_redirect();

		$this->assertNotNull( $redirect );

		// The captured redirect URL is the portal forward; its `target`
		// query arg must round-trip with the slash preserved (encoded
		// either as `%2F` or `%252F` once the wrapper rawurlencode kicks
		// in — the canonical form is double-encoded). What we MUST NOT
		// see is the plugin slug collapsed into one token.
		$this->assertStringNotContainsString(
			'plugin=desktop-mode-cron-managerdesktop-mode-cron-manager.php',
			$redirect
		);
		$this->assertStringNotContainsString(
			'plugin%3Ddesktop-mode-cron-managerdesktop-mode-cron-manager.php',
			$redirect
		);
	}

	/**
	 * Regression: the same percent-encoded slash must survive the
	 * portal handler's `target` round-trip when a user lands on
	 * `/openstation/?target=<encoded>`.
	 *
	 * @covers ::openstation_handle_portal_request
	 * @covers ::openstation_sanitize_portal_target
	 */
	public function test_portal_target_preserves_percent_encoded_slashes() {
		wp_set_current_user( self::$admin_id );

		// Simulate what `openstation_redirect_plain_admin_to_portal`
		// would have produced after capturing an activate URL.
		$raw_uri              = '/wp-admin/plugins.php?action=activate&plugin=desktop-mode-cron-manager%2Fdesktop-mode-cron-manager.php&_wpnonce=abc123';
		$_GET['target']       = $raw_uri;
		$_SERVER['REQUEST_URI'] = '/openstation/?target=' . rawurlencode( $raw_uri );

		try {
			$redirect = $this->capture_with( 'openstation_handle_portal_request', null );
		} finally {
			unset( $_GET['target'] );
		}

		$this->assertNotNull( $redirect );
		// The URL now travels as the shell screen's `target` arg, so the
		// encoded slash is encoded once more on the way; one decode
		// must give back exactly what the activate link said.
		$target = $this->shell_target_of( $redirect );
		$this->assertStringContainsString( 'plugin=desktop-mode-cron-manager%2Fdesktop-mode-cron-manager.php', $target );
		$this->assertStringContainsString( 'action=activate', $target );
		$this->assertStringContainsString( '_wpnonce=abc123', $target );
	}

	/**
	 * `wp-admin/admin.php` without a `page` arg is a bootstrap, not a
	 * page: core falls through its last `else` branch, never requires
	 * `admin-header.php`, and answers 200 with an empty body. The
	 * allowlist matches filenames and cannot see that, so the guard
	 * lives here — otherwise the URL becomes a window showing nothing.
	 *
	 * @covers ::openstation_sanitize_portal_target
	 */
	public function test_sanitize_target_rejects_page_less_admin_php() {
		$this->assertSame( '', openstation_sanitize_portal_target( '/wp-admin/admin.php' ) );
		$this->assertSame( '', openstation_sanitize_portal_target( '/wp-admin/admin.php?page=' ) );
		// A query that carries everything BUT a page still renders nothing.
		$this->assertSame( '', openstation_sanitize_portal_target( '/wp-admin/admin.php?action=edit&id=7' ) );
	}

	/**
	 * The guard is about the missing `page`, not about `admin.php`:
	 * every plugin screen in the admin lives at this filename.
	 *
	 * @covers ::openstation_sanitize_portal_target
	 */
	public function test_sanitize_target_keeps_admin_php_with_a_page() {
		$this->assertSame(
			admin_url( 'admin.php?page=jetpack' ),
			openstation_sanitize_portal_target( '/wp-admin/admin.php?page=jetpack' )
		);
	}

	/**
	 * Regression: a plain GET to a page-less `admin.php` used to be
	 * forwarded as `?target=%2Fwp-admin%2Fadmin.php&intent=1`. The
	 * intent flag made the shell open it on every boot — and, because
	 * the args stay in the address bar, on every reload after that.
	 * With no resolvable target the screen resolves the entry itself.
	 *
	 * @covers ::openstation_redirect_plain_admin_to_portal
	 */
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

	/**
	 * The decoded `target` arg of a shell screen URL, '' when absent.
	 *
	 * @param string $url Shell screen URL.
	 * @return string
	 */
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

		// The portal no longer resolves the session itself: it sends
		// the user to the bare screen, which resolves the focused
		// window on arrival (see `openstation_shell_boot_target()`).
		$this->assertSame( openstation_shell_url(), $redirect );
		$this->assertSame( admin_url( $target_path ), openstation_portal_entry_url( self::$admin_id ) );
	}

	/**
	 * Bare `/openstation/` visits — no `?target=` — must NOT carry
	 * `intent`. The shell uses its absence as the signal that the
	 * screen picked the landing page itself (default window /
	 * session-focused), so a restored session shouldn't be disturbed.
	 *
	 * @covers ::openstation_handle_portal_request
	 */
	public function test_portal_bare_visit_omits_intent_flag() {
		wp_set_current_user( self::$admin_id );

		$redirect = $this->capture_redirect( '/openstation/' );

		$this->assertNotNull( $redirect );
		$this->assertTrue( openstation_url_is_shell_screen( $redirect ) );
		$this->assertStringNotContainsString( 'target=', $redirect );
		$this->assertStringNotContainsString( 'intent=', $redirect );
	}

	/**
	 * Regression for the "Edit Post" admin-bar click from the front end:
	 * `/wp-admin/post.php?post=…&action=edit` → portal redirect →
	 * `/wp-admin/post.php?…&desktop_mode_portal=1&desktop_mode_portal_intent=1`.
	 * Without the intent flag the shell would suppress the auto-open
	 * whenever the user has a saved session, swallowing their click.
	 *
	 * @covers ::openstation_handle_portal_request
	 */
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

	/**
	 * If `?target=` is supplied but the URL fails the wp-admin
	 * whitelist (off-site, missing file, etc.), the portal falls back
	 * to the session/default landing — which is portal-picked, not
	 * user intent. The intent flag must NOT survive that fallback.
	 *
	 * @covers ::openstation_handle_portal_request
	 */
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

	/**
	 * The intent flag must not leak into the derived `currentPage`
	 * passed to the shell. Otherwise the window id derived from the URL
	 * would diverge from the dock's id for the same admin page, and
	 * clicking the dock icon for an already-auto-opened page would
	 * spawn a duplicate window.
	 *
	 * @covers ::openstation_handle_portal_request
	 * @covers ::openstation_sanitize_portal_target
	 */
	public function test_portal_target_with_existing_intent_flag_is_normalised() {
		wp_set_current_user( self::$admin_id );
		// User crafts (or a bookmark embeds) a target whose query string
		// already carries the intent marker. The sanitizer drops the
		// duplicate so we don't end up with `…intent=1&…intent=1`.
		$raw_uri                = '/wp-admin/edit.php?post_type=page&' . OPENSTATION_PORTAL_INTENT_FLAG . '=1';
		$_GET['target']         = $raw_uri;
		$_SERVER['REQUEST_URI'] = '/openstation/?target=' . rawurlencode( $raw_uri );

		try {
			$redirect = $this->capture_with( 'openstation_handle_portal_request', null );
		} finally {
			unset( $_GET['target'] );
		}

		$this->assertNotNull( $redirect );
		// The frozen flag is gone from the target; intent travels once,
		// as the screen's own arg.
		$this->assertStringNotContainsString( OPENSTATION_PORTAL_INTENT_FLAG, $this->shell_target_of( $redirect ) );
		$this->assertSame( 1, substr_count( $redirect, 'intent=1' ) );
	}
}
