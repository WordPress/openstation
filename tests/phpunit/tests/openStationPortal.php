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

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id      = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$subscriber_id = $factory->user->create( array( 'role' => 'subscriber' ) );
	}

	public function tear_down() {
		unset(
			$_SERVER['REQUEST_URI'],
			$_SERVER['REQUEST_METHOD'],
			$_GET[ OPENSTATION_PORTAL_FLAG ],
			$_GET[ OPENSTATION_PORTAL_INTENT_FLAG ],
			$_GET[ OPENSTATION_CLASSIC_FLAG ],
			$_GET['openstation_chromeless']
		);
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );
		delete_user_meta( self::$admin_id, OPENSTATION_SESSION_META_KEY );
		delete_user_meta( self::$subscriber_id, 'desktop_mode_mode' );
		remove_all_filters( 'openstation_portal_auto_enable' );
		remove_all_filters( 'openstation_admin_redirect_to_portal' );
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
	public function test_portal_redirects_to_admin_with_flag() {
		wp_set_current_user( self::$admin_id );
		$redirect = $this->capture_redirect( '/openstation/' );

		$this->assertNotNull( $redirect );
		$this->assertStringStartsWith( admin_url(), $redirect );
		$this->assertStringContainsString( OPENSTATION_PORTAL_FLAG . '=1', $redirect );
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
	 * @covers ::openstation_handle_portal_request
	 */
	/**
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
	 * @covers ::openstation_redirect_plain_admin_to_portal
	 */
	public function test_admin_redirect_noop_when_portal_flag_already_present() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_SERVER['REQUEST_METHOD']    = 'GET';
		$_GET[ OPENSTATION_PORTAL_FLAG ] = '1';

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
	 * @covers ::openstation_redirect_plain_admin_to_portal
	 */
	public function test_admin_redirect_preserves_percent_encoded_slashes() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_SERVER['REQUEST_METHOD'] = 'GET';
		$_SERVER['REQUEST_URI']    = '/wp-admin/plugins.php?action=activate&plugin=desktop-mode-cron-manager%2Fdesktop-mode-cron-manager.php&_wpnonce=abc123';

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
		$this->assertStringContainsString( 'plugin=desktop-mode-cron-manager%2Fdesktop-mode-cron-manager.php', $redirect );
		$this->assertStringContainsString( 'action=activate', $redirect );
		$this->assertStringContainsString( '_wpnonce=abc123', $redirect );
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

		$this->assertStringContainsString( 'post_type=page', $redirect );
		$this->assertStringContainsString( OPENSTATION_PORTAL_FLAG . '=1', $redirect );
	}

	/**
	 * Bare `/openstation/` visits — no `?target=` — must NOT carry the
	 * portal-intent flag. The shell uses its absence as the signal that
	 * the portal picked the landing page itself (default window /
	 * session-focused), so a restored session shouldn't be disturbed.
	 *
	 * @covers ::openstation_handle_portal_request
	 */
	public function test_portal_bare_visit_omits_intent_flag() {
		wp_set_current_user( self::$admin_id );

		$redirect = $this->capture_redirect( '/openstation/' );

		$this->assertNotNull( $redirect );
		$this->assertStringContainsString( OPENSTATION_PORTAL_FLAG . '=1', $redirect );
		$this->assertStringNotContainsString( OPENSTATION_PORTAL_INTENT_FLAG . '=1', $redirect );
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
		$this->assertStringContainsString( 'post.php', $redirect );
		$this->assertStringContainsString( 'post=104', $redirect );
		$this->assertStringContainsString( 'action=edit', $redirect );
		$this->assertStringContainsString( OPENSTATION_PORTAL_FLAG . '=1', $redirect );
		$this->assertStringContainsString( OPENSTATION_PORTAL_INTENT_FLAG . '=1', $redirect );
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
		$this->assertStringContainsString( OPENSTATION_PORTAL_FLAG . '=1', $redirect );
		$this->assertStringNotContainsString( OPENSTATION_PORTAL_INTENT_FLAG . '=1', $redirect );
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
		// Exactly one occurrence of the intent flag in the final URL.
		$this->assertSame(
			1,
			substr_count( $redirect, OPENSTATION_PORTAL_INTENT_FLAG . '=1' )
		);
	}
}
