<?php
/**
 * Tests for the OpenStation session persistence layer.
 *
 * Covers the user-meta helpers (empty/get/save/clear), the session
 * sanitizer (URL validation, dimension clamping, state enum, windows
 * cap), and the REST endpoints (permission gate, GET/POST/DELETE).
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-session
 */
class Tests_OpenStation_Session extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		// The session REST routes now require OpenStation to be enabled
		// for the caller. Opt the test user in so the happy-path REST
		// tests exercise the route body rather than the permission gate.
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
	}

	public function tear_down() {
		delete_user_meta( self::$admin_id, OPENSTATION_SESSION_META_KEY );
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );
		parent::tear_down();
	}

	/**
	 * Helper: build a minimal valid session window payload using a
	 * same-origin admin URL so the sanitizer accepts it.
	 */
	private function make_window( array $overrides = array() ) {
		return array_merge(
			array(
				'id'     => 'wp-window-edit-php',
				'url'    => admin_url( 'edit.php' ),
				'title'  => 'Posts',
				'icon'   => 'dashicons-admin-post',
				'state'  => 'normal',
				'x'      => 100,
				'y'      => 80,
				'width'  => 800,
				'height' => 600,
			),
			$overrides
		);
	}

	/**
	 * @covers ::openstation_empty_session
	 */
	public function test_empty_session_shape() {
		$empty = openstation_empty_session();

		$this->assertSame( array(), $empty['windows'] );
		$this->assertSame( '', $empty['focused'] );
		$this->assertSame( 0, $empty['updated'] );
		// Empty sessions still ship with one default desktop — the
		// shell can't function with zero, so the bootstrap shape
		// must always include `Desktop 1` and a matching active id.
		$this->assertCount( 1, $empty['desktops'] );
		$this->assertSame( 'desktop-1', $empty['desktops'][0]['id'] );
		$this->assertSame( 'Desktop 1', $empty['desktops'][0]['label'] );
		$this->assertSame( 'desktop-1', $empty['activeDesktop'] );
	}

	/**
	 * @covers ::openstation_sanitize_session
	 */
	public function test_sanitize_persists_desktop_list_with_label_trim() {
		$session = array(
			'desktops' => array(
				array( 'id' => 'desktop-1', 'label' => 'Work' ),
				array( 'id' => 'desktop-2', 'label' => str_repeat( 'X', 100 ) ),
			),
			'activeDesktop' => 'desktop-2',
			'windows'       => array(),
		);

		$clean = openstation_sanitize_session( $session );

		$this->assertCount( 2, $clean['desktops'] );
		$this->assertSame( 'desktop-1', $clean['desktops'][0]['id'] );
		$this->assertSame( 'Work', $clean['desktops'][0]['label'] );
		$this->assertSame( 'desktop-2', $clean['desktops'][1]['id'] );
		// 64-char cap on labels.
		$this->assertSame( 64, strlen( $clean['desktops'][1]['label'] ) );
		$this->assertSame( 'desktop-2', $clean['activeDesktop'] );
	}

	/**
	 * @covers ::openstation_sanitize_session
	 */
	public function test_sanitize_falls_back_to_default_desktop_when_list_empty() {
		$clean = openstation_sanitize_session( array( 'desktops' => array() ) );

		$this->assertCount( 1, $clean['desktops'] );
		$this->assertSame( 'desktop-1', $clean['desktops'][0]['id'] );
		$this->assertSame( 'desktop-1', $clean['activeDesktop'] );
	}

	/**
	 * @covers ::openstation_sanitize_session
	 */
	public function test_sanitize_active_desktop_must_reference_real_desktop() {
		// `activeDesktop` points at a desktop that wasn't in the
		// `desktops` list — sanitizer should fall back to the first
		// real one rather than persist a dangling reference.
		$session = array(
			'desktops'      => array( array( 'id' => 'desktop-1', 'label' => 'A' ) ),
			'activeDesktop' => 'desktop-99',
		);

		$clean = openstation_sanitize_session( $session );

		$this->assertSame( 'desktop-1', $clean['activeDesktop'] );
	}

	/**
	 * @covers ::openstation_sanitize_session
	 */
	public function test_sanitize_window_with_known_desktop_id_persists_it() {
		$session = array(
			'desktops' => array(
				array( 'id' => 'desktop-1', 'label' => 'A' ),
				array( 'id' => 'desktop-2', 'label' => 'B' ),
			),
			'activeDesktop' => 'desktop-1',
			'windows'       => array(
				$this->make_window( array(
					'id'        => 'edit-php',
					'desktopId' => 'desktop-2',
				) ),
			),
		);

		$clean = openstation_sanitize_session( $session );

		$this->assertCount( 1, $clean['windows'] );
		$this->assertSame( 'desktop-2', $clean['windows'][0]['desktopId'] );
	}

	/**
	 * @covers ::openstation_sanitize_session
	 */
	public function test_sanitize_window_with_unknown_desktop_id_remaps_to_active() {
		// A window claiming a desktop id that doesn't exist (race
		// with a desktop close, or a malformed payload) should be
		// remapped to the active desktop so it remains visible after
		// restore — losing the window would be the worse UX.
		$session = array(
			'desktops'      => array( array( 'id' => 'desktop-1', 'label' => 'A' ) ),
			'activeDesktop' => 'desktop-1',
			'windows'       => array(
				$this->make_window( array(
					'id'        => 'edit-php',
					'desktopId' => 'desktop-77',
				) ),
			),
		);

		$clean = openstation_sanitize_session( $session );

		$this->assertSame( 'desktop-1', $clean['windows'][0]['desktopId'] );
	}

	/**
	 * Native windows carry a `#slug` marker instead of an admin URL.
	 * The same-admin URL check used to drop them from the session
	 * entirely, so OS Settings (and every plugin-registered native
	 * window) never came back after a reload.
	 *
	 * @covers ::openstation_sanitize_session
	 */
	public function test_sanitize_keeps_native_windows() {
		$session = array(
			'desktops'      => array( array( 'id' => 'desktop-1', 'label' => 'A' ) ),
			'activeDesktop' => 'desktop-1',
			'windows'       => array(
				array(
					'id'     => 'os-settings',
					'native' => true,
					'url'    => '#os-settings',
					'title'  => 'OS Settings',
					'icon'   => 'dashicons-desktop',
					'state'  => 'normal',
					'x'      => 120,
					'y'      => 90,
					'width'  => 820,
					'height' => 720,
				),
			),
		);

		$clean = openstation_sanitize_session( $session );

		$this->assertCount( 1, $clean['windows'] );
		$this->assertTrue( $clean['windows'][0]['native'] );
		$this->assertSame( 'os-settings', $clean['windows'][0]['id'] );
		$this->assertSame( 820, $clean['windows'][0]['width'] );
	}

	/**
	 * The stored marker is built from the sanitized id, never from
	 * the client's `url`. Nothing navigates to it, so there's no
	 * reason to round-trip a client-controlled string through user
	 * meta.
	 *
	 * @covers ::openstation_sanitize_session
	 */
	public function test_sanitize_rebuilds_native_url_from_the_id() {
		$session = array(
			'desktops'      => array( array( 'id' => 'desktop-1', 'label' => 'A' ) ),
			'activeDesktop' => 'desktop-1',
			'windows'       => array(
				array(
					'id'     => 'my-plugin-panel',
					'native' => true,
					'url'    => 'https://evil.example.com/steal',
					'title'  => 'Panel',
					'icon'   => 'dashicons-admin-generic',
					'state'  => 'normal',
					'x'      => 0,
					'y'      => 0,
					'width'  => 400,
					'height' => 300,
				),
			),
		);

		$clean = openstation_sanitize_session( $session );

		$this->assertCount( 1, $clean['windows'] );
		$this->assertSame( '#my-plugin-panel', $clean['windows'][0]['url'] );
	}

	/**
	 * Non-native windows keep the strict same-admin URL gate.
	 *
	 * @covers ::openstation_sanitize_session
	 */
	public function test_sanitize_still_drops_foreign_urls_for_iframe_windows() {
		$session = array(
			'desktops'      => array( array( 'id' => 'desktop-1', 'label' => 'A' ) ),
			'activeDesktop' => 'desktop-1',
			'windows'       => array(
				$this->make_window( array(
					'id'  => 'evil',
					'url' => 'https://evil.example.com/wp-admin/edit.php',
				) ),
			),
		);

		$clean = openstation_sanitize_session( $session );

		$this->assertCount( 0, $clean['windows'] );
	}

	/**
	 * Absent `native` stays absent — sessions of plain admin windows
	 * keep the shape they already had.
	 *
	 * @covers ::openstation_sanitize_session
	 */
	public function test_sanitize_omits_native_flag_for_iframe_windows() {
		$session = array(
			'desktops'      => array( array( 'id' => 'desktop-1', 'label' => 'A' ) ),
			'activeDesktop' => 'desktop-1',
			'windows'       => array( $this->make_window() ),
		);

		$clean = openstation_sanitize_session( $session );

		$this->assertArrayNotHasKey( 'native', $clean['windows'][0] );
	}

	/**
	 * @covers ::openstation_sanitize_session
	 */
	public function test_sanitize_caps_desktops_at_max() {
		$desktops = array();
		for ( $i = 1; $i <= ( OPENSTATION_SESSION_MAX_DESKTOPS + 5 ); $i++ ) {
			$desktops[] = array(
				'id'    => "desktop-{$i}",
				'label' => "Desktop {$i}",
			);
		}

		$clean = openstation_sanitize_session( array( 'desktops' => $desktops ) );

		$this->assertCount( OPENSTATION_SESSION_MAX_DESKTOPS, $clean['desktops'] );
	}

	/**
	 * @covers ::openstation_get_session
	 */
	public function test_get_session_returns_empty_when_meta_missing() {
		$session = openstation_get_session( self::$admin_id );

		$this->assertSame( array(), $session['windows'] );
		$this->assertSame( '', $session['focused'] );
	}

	/**
	 * @covers ::openstation_get_session
	 */
	public function test_get_session_returns_empty_for_invalid_user() {
		$this->assertSame( openstation_empty_session(), openstation_get_session( 0 ) );
		$this->assertSame( openstation_empty_session(), openstation_get_session( -5 ) );
	}

	/**
	 * @covers ::openstation_get_session
	 */
	public function test_get_session_normalizes_corrupt_meta() {
		// Scalar instead of array — must degrade gracefully.
		update_user_meta( self::$admin_id, OPENSTATION_SESSION_META_KEY, 'not-an-array' );

		$session = openstation_get_session( self::$admin_id );
		$this->assertSame( array(), $session['windows'] );
	}

	/**
	 * @covers ::openstation_save_session
	 * @covers ::openstation_get_session
	 */
	public function test_save_and_get_session_roundtrip() {
		$payload = array(
			'windows' => array( $this->make_window() ),
			'focused' => 'wp-window-edit-php',
		);

		$this->assertTrue( openstation_save_session( self::$admin_id, $payload ) );

		$stored = openstation_get_session( self::$admin_id );
		$this->assertCount( 1, $stored['windows'] );
		$this->assertSame( 'wp-window-edit-php', $stored['focused'] );
		$this->assertGreaterThan( 0, $stored['updated'] );
		$this->assertSame( admin_url( 'edit.php' ), $stored['windows'][0]['url'] );
	}

	/**
	 * @covers ::openstation_save_session
	 */
	public function test_save_session_rejects_invalid_user() {
		$this->assertFalse( openstation_save_session( 0, array() ) );
	}

	/**
	 * Two tabs open for the same user can race each other — one takes
	 * a snapshot at T, another at T+1. Whichever the server processes
	 * LAST used to win unconditionally, clobbering the newer state.
	 * The `updated` field on the incoming payload is now compared to
	 * the stored value; stale writes (incoming < stored) are rejected.
	 *
	 * @covers ::openstation_save_session
	 */
	public function test_save_session_rejects_stale_write() {
		$fresh = array(
			'windows' => array( $this->make_window() ),
			'focused' => 'wp-window-edit-php',
			'updated' => 2_000_000_000, // far future
		);
		$this->assertTrue( openstation_save_session( self::$admin_id, $fresh ) );

		$stale = array(
			'windows' => array(),
			'focused' => '',
			'updated' => 1_000_000_000, // before the stored one
		);
		$this->assertFalse(
			openstation_save_session( self::$admin_id, $stale ),
			'Stale write should be rejected so fresher state survives.'
		);

		// The windows array from the fresh write must still be intact.
		$stored = openstation_get_session( self::$admin_id );
		$this->assertCount( 1, $stored['windows'] );
	}

	/**
	 * Equal timestamps are accepted — two saves landing in the same
	 * second is a tie, and rejecting either would silently drop user
	 * work on a fast system with clock second-granularity.
	 *
	 * @covers ::openstation_save_session
	 */
	public function test_save_session_accepts_equal_timestamp() {
		$first = array(
			'windows' => array( $this->make_window() ),
			'focused' => 'wp-window-edit-php',
			'updated' => 1_500_000_000,
		);
		$second = array(
			'windows' => array( $this->make_window( array( 'id' => 'wp-window-upload-php', 'url' => admin_url( 'upload.php' ), 'title' => 'Media' ) ) ),
			'focused' => 'wp-window-upload-php',
			'updated' => 1_500_000_000, // same timestamp
		);
		$this->assertTrue( openstation_save_session( self::$admin_id, $first ) );
		$this->assertTrue( openstation_save_session( self::$admin_id, $second ) );

		$stored = openstation_get_session( self::$admin_id );
		$this->assertSame( 'wp-window-upload-php', $stored['windows'][0]['id'] );
	}

	/**
	 * The two writes that race hardest are a `keepalive` fetch still
	 * in flight and the `pagehide` beacon that supersedes it. They can
	 * land milliseconds apart, so the ordering key has to resolve
	 * milliseconds — at second granularity they tie, the tie rule
	 * hands the win to whichever the server processes last, and a
	 * stale payload reinstates a window the user just closed.
	 *
	 * @covers ::openstation_save_session
	 */
	public function test_save_session_orders_writes_within_the_same_second() {
		$base = 1_700_000_000_000; // Epoch ms.

		// Beacon: the user closed the window, snapshot has none.
		$beacon = array(
			'windows' => array(),
			'focused' => '',
			'updated' => $base + 500,
		);
		$this->assertTrue( openstation_save_session( self::$admin_id, $beacon ) );

		// The slower `keepalive` fetch, snapshotted 300ms EARLIER,
		// arrives second and still carries the window.
		$stale = array(
			'windows' => array( $this->make_window() ),
			'focused' => 'wp-window-edit-php',
			'updated' => $base + 200,
		);
		$this->assertFalse(
			openstation_save_session( self::$admin_id, $stale ),
			'A late-arriving older snapshot must not reopen a closed window.'
		);

		$stored = openstation_get_session( self::$admin_id );
		$this->assertCount(
			0,
			$stored['windows'],
			'The closed window must stay closed after a reload.'
		);
	}

	/**
	 * The server-side fallback stamp has to speak the same unit as the
	 * client's `Date.now()`. Mixing units would store a seconds value
	 * that every later millisecond comparison treats as ancient,
	 * quietly disabling the stale-write guard.
	 *
	 * @covers ::openstation_sanitize_session
	 * @covers ::openstation_session_now_ms
	 */
	public function test_sanitize_session_fallback_timestamp_is_milliseconds() {
		$clean = openstation_sanitize_session(
			array(
				'windows' => array( $this->make_window() ),
				// no `updated` — server must stamp it.
			)
		);

		// Epoch ms is ~1000x epoch seconds. Anchor on a date well in
		// the past so the assertion never goes stale.
		$this->assertGreaterThan( 1_600_000_000_000, $clean['updated'] );
	}

	/**
	 * Missing `updated` on the incoming payload should not block the
	 * save — first-write-ever and edge cases where the client couldn't
	 * compute a timestamp stay functional.
	 *
	 * @covers ::openstation_save_session
	 */
	public function test_save_session_accepts_missing_timestamp() {
		$payload = array(
			'windows' => array( $this->make_window() ),
			'focused' => 'wp-window-edit-php',
			// no `updated`
		);
		$this->assertTrue( openstation_save_session( self::$admin_id, $payload ) );
	}

	/**
	 * @covers ::openstation_clear_session
	 */
	public function test_clear_session_removes_meta() {
		update_user_meta( self::$admin_id, OPENSTATION_SESSION_META_KEY, array( 'windows' => array() ) );

		$this->assertTrue( openstation_clear_session( self::$admin_id ) );
		$this->assertSame( '', get_user_meta( self::$admin_id, OPENSTATION_SESSION_META_KEY, true ) );
	}

	/**
	 * @covers ::openstation_clear_session
	 */
	public function test_clear_session_rejects_invalid_user() {
		$this->assertFalse( openstation_clear_session( 0 ) );
	}

	/**
	 * @covers ::openstation_sanitize_session
	 */
	public function test_sanitizer_drops_windows_with_cross_origin_url() {
		$clean = openstation_sanitize_session(
			array(
				'windows' => array(
					$this->make_window( array( 'url' => 'https://evil.example.com/wp-admin/edit.php' ) ),
				),
			)
		);

		$this->assertSame( array(), $clean['windows'] );
	}

	/**
	 * @covers ::openstation_sanitize_session
	 */
	public function test_sanitizer_drops_windows_outside_admin_url() {
		$clean = openstation_sanitize_session(
			array(
				'windows' => array(
					$this->make_window( array( 'url' => home_url( '/' ) ) ),
				),
			)
		);

		$this->assertSame( array(), $clean['windows'] );
	}

	/**
	 * @covers ::openstation_sanitize_session
	 */
	public function test_sanitizer_drops_windows_with_empty_id() {
		$clean = openstation_sanitize_session(
			array(
				'windows' => array(
					$this->make_window( array( 'id' => '' ) ),
				),
			)
		);

		$this->assertSame( array(), $clean['windows'] );
	}

	/**
	 * @covers ::openstation_sanitize_session
	 */
	public function test_sanitizer_normalizes_invalid_state() {
		$clean = openstation_sanitize_session(
			array(
				'windows' => array(
					$this->make_window( array( 'state' => 'floating-around' ) ),
				),
			)
		);

		$this->assertSame( 'normal', $clean['windows'][0]['state'] );
	}

	/**
	 * @covers ::openstation_sanitize_session
	 */
	public function test_sanitizer_preserves_valid_states() {
		foreach ( OPENSTATION_SESSION_STATES as $state ) {
			$clean = openstation_sanitize_session(
				array(
					'windows' => array( $this->make_window( array( 'state' => $state ) ) ),
				)
			);
			$this->assertSame( $state, $clean['windows'][0]['state'] );
		}
	}

	/**
	 * @covers ::openstation_sanitize_session
	 * @covers ::openstation_sanitize_session_dimension
	 */
	public function test_sanitizer_clamps_out_of_range_dimensions() {
		$clean = openstation_sanitize_session(
			array(
				'windows' => array(
					$this->make_window(
						array(
							'x'      => -999999,
							'y'      => 999999,
							'width'  => -50,
							'height' => 999999,
						)
					),
				),
			)
		);

		$win = $clean['windows'][0];
		$this->assertSame( -10000, $win['x'] );
		$this->assertSame( 10000, $win['y'] );
		$this->assertSame( 0, $win['width'] );
		$this->assertSame( 20000, $win['height'] );
	}

	/**
	 * The chromeless `wp_desktop` flag is an iframe-scoped concern. Persisting
	 * it into a session URL sets up a lockout: the portal's entry URL forwards
	 * the TOP window to a chromeless page (no admin bar → no toggle → no
	 * escape). Sanitizer must scrub it on save.
	 *
	 * @covers ::openstation_sanitize_session
	 */
	public function test_sanitizer_strips_chromeless_flag_from_window_urls() {
		$clean = openstation_sanitize_session(
			array(
				'windows' => array(
					$this->make_window(
						array(
							'url' => admin_url( 'plugins.php?openstation_chromeless=1&paged=2' ),
						)
					),
				),
			)
		);

		$this->assertStringNotContainsString( 'openstation_chromeless=1', $clean['windows'][0]['url'] );
		$this->assertStringContainsString( 'paged=2', $clean['windows'][0]['url'] );
	}

	/**
	 * The "detach to new tab" flag is also request-scoped and must not
	 * survive into stored window URLs.
	 *
	 * @covers ::openstation_sanitize_session
	 */
	public function test_sanitizer_strips_classic_flag_from_window_urls() {
		$clean = openstation_sanitize_session(
			array(
				'windows' => array(
					$this->make_window(
						array(
							'url' => admin_url( 'options-general.php?' . OPENSTATION_CLASSIC_FLAG . '=1' ),
						)
					),
				),
			)
		);

		$this->assertStringNotContainsString( OPENSTATION_CLASSIC_FLAG, $clean['windows'][0]['url'] );
	}

	/**
	 * The portal flag is a transient redirect marker, not something that
	 * should persist into user meta.
	 *
	 * @covers ::openstation_sanitize_session
	 */
	public function test_sanitizer_strips_portal_flag_from_window_urls() {
		$clean = openstation_sanitize_session(
			array(
				'windows' => array(
					$this->make_window(
						array(
							'url' => admin_url( 'edit.php?' . OPENSTATION_PORTAL_FLAG . '=1' ),
						)
					),
				),
			)
		);

		$this->assertStringNotContainsString( OPENSTATION_PORTAL_FLAG, $clean['windows'][0]['url'] );
	}

	/**
	 * @covers ::openstation_sanitize_session
	 */
	public function test_sanitizer_strips_html_from_title() {
		$clean = openstation_sanitize_session(
			array(
				'windows' => array(
					$this->make_window( array( 'title' => 'Posts <script>alert(1)</script>' ) ),
				),
			)
		);

		$this->assertStringNotContainsString( '<script>', $clean['windows'][0]['title'] );
	}

	/**
	 * @covers ::openstation_sanitize_session
	 */
	public function test_sanitizer_caps_windows_at_max() {
		$too_many = array();
		for ( $i = 0; $i < OPENSTATION_SESSION_MAX_WINDOWS + 10; $i++ ) {
			$too_many[] = $this->make_window( array( 'id' => 'wp-window-' . $i ) );
		}

		$clean = openstation_sanitize_session( array( 'windows' => $too_many ) );

		$this->assertCount( OPENSTATION_SESSION_MAX_WINDOWS, $clean['windows'] );
	}

	/**
	 * @covers ::openstation_sanitize_session
	 */
	public function test_sanitizer_returns_empty_for_non_array_input() {
		$clean = openstation_sanitize_session( 'not-a-session' );

		$this->assertSame( array(), $clean['windows'] );
		$this->assertSame( '', $clean['focused'] );
		$this->assertGreaterThan( 0, $clean['updated'] );
	}

	/**
	 * @covers ::openstation_sanitize_session
	 */
	public function test_sanitizer_sanitizes_focused_id() {
		$clean = openstation_sanitize_session(
			array(
				'focused' => 'wp-window-<svg>EDIT</svg>',
				'windows' => array(),
			)
		);

		$this->assertSame( 'wp-window-svgeditsvg', $clean['focused'] );
	}

	/**
	 * @covers ::openstation_sanitize_session_dimension
	 */
	public function test_dimension_clamping() {
		$this->assertSame( 10, openstation_sanitize_session_dimension( '10', 0, 100 ) );
		$this->assertSame( 0, openstation_sanitize_session_dimension( -5, 0, 100 ) );
		$this->assertSame( 100, openstation_sanitize_session_dimension( 5000, 0, 100 ) );
		$this->assertSame( 42, openstation_sanitize_session_dimension( 42.9, 0, 100 ) );
	}

	/**
	 * @covers ::openstation_rest_session_permission
	 */
	public function test_rest_permission_denies_logged_out() {
		wp_set_current_user( 0 );
		$result = openstation_rest_session_permission();
		$this->assertWPError( $result );
		$this->assertSame( 401, $result->get_error_data()['status'] );
	}

	/**
	 * A logged-in user who hasn't enabled OpenStation is denied (403).
	 * Regression guard for the broken-access-control report.
	 *
	 * @covers ::openstation_rest_session_permission
	 */
	public function test_rest_permission_denies_logged_in_without_openstation() {
		wp_set_current_user( self::$admin_id );
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );

		$result = openstation_rest_session_permission();
		$this->assertWPError( $result );
		$this->assertSame( 403, $result->get_error_data()['status'] );
	}

	/**
	 * @covers ::openstation_rest_session_permission
	 */
	public function test_rest_permission_allows_enabled_user() {
		wp_set_current_user( self::$admin_id );
		// set_up() opts this user into OpenStation.
		$this->assertTrue( openstation_rest_session_permission() );
	}

	/**
	 * @covers ::openstation_register_session_rest_routes
	 */
	public function test_rest_routes_registered() {
		// Force REST server init so register_rest_route hooks fire.
		rest_get_server();

		$routes = rest_get_server()->get_routes();
		$this->assertArrayHasKey( '/desktop-mode/v1/session', $routes );
	}

	/**
	 * @covers ::openstation_rest_get_session
	 */
	public function test_rest_get_session_returns_current_user_session() {
		wp_set_current_user( self::$admin_id );
		openstation_save_session(
			self::$admin_id,
			array(
				'windows' => array( $this->make_window() ),
				'focused' => 'wp-window-edit-php',
			)
		);

		rest_get_server();
		$request  = new WP_REST_Request( 'GET', '/desktop-mode/v1/session' );
		$response = rest_do_request( $request );

		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( 'wp-window-edit-php', $data['focused'] );
		$this->assertCount( 1, $data['windows'] );
	}

	/**
	 * @covers ::openstation_rest_save_session
	 */
	public function test_rest_save_session_persists_payload() {
		wp_set_current_user( self::$admin_id );
		rest_get_server();

		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/session' );
		$request->set_header( 'Content-Type', 'application/json' );
		$request->set_body(
			wp_json_encode(
				array(
					'session' => array(
						'windows' => array( $this->make_window() ),
						'focused' => 'wp-window-edit-php',
					),
				)
			)
		);

		$response = rest_do_request( $request );
		$this->assertSame( 200, $response->get_status() );

		$stored = openstation_get_session( self::$admin_id );
		$this->assertCount( 1, $stored['windows'] );
		$this->assertSame( 'wp-window-edit-php', $stored['focused'] );
	}

	/**
	 * @covers ::openstation_rest_clear_session
	 */
	public function test_rest_clear_session_removes_meta() {
		wp_set_current_user( self::$admin_id );
		openstation_save_session(
			self::$admin_id,
			array( 'windows' => array( $this->make_window() ) )
		);

		rest_get_server();
		$request  = new WP_REST_Request( 'DELETE', '/desktop-mode/v1/session' );
		$response = rest_do_request( $request );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( array(), openstation_get_session( self::$admin_id )['windows'] );
	}

	/**
	 * @covers ::openstation_rest_save_session
	 */
	public function test_rest_save_session_denies_logged_out() {
		wp_set_current_user( 0 );
		rest_get_server();

		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/session' );
		$request->set_header( 'Content-Type', 'application/json' );
		$request->set_body( wp_json_encode( array( 'session' => array( 'windows' => array() ) ) ) );

		$response = rest_do_request( $request );
		$this->assertSame( 401, $response->get_status() );
	}
}
