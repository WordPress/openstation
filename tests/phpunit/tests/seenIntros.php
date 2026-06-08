<?php
/**
 * Tests for the seen-intros user-meta surface.
 *
 * Covers the get/has/mark/clear helpers, sanitization, and the REST
 * routes (mark-seen + reset).
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-seen-intros
 */
class Tests_DesktopMode_SeenIntros extends WP_UnitTestCase {

	protected static $user_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$user_id = $factory->user->create( array( 'role' => 'editor' ) );
	}

	public function set_up() {
		parent::set_up();
		// The seen-intros REST routes now require desktop mode enabled for
		// the caller. Opt the test user in so the REST tests reach the
		// route body rather than stopping at the permission gate.
		update_user_meta( self::$user_id, 'desktop_mode_mode', '1' );
	}

	public function tear_down() {
		delete_user_meta( self::$user_id, DESKTOP_MODE_SEEN_INTROS_META_KEY );
		delete_user_meta( self::$user_id, 'desktop_mode_mode' );
		parent::tear_down();
	}

	/**
	 * @covers ::desktop_mode_get_seen_intros
	 */
	public function test_get_returns_empty_array_for_unconfigured_user() {
		$this->assertSame( array(), desktop_mode_get_seen_intros( self::$user_id ) );
	}

	/**
	 * @covers ::desktop_mode_get_seen_intros
	 */
	public function test_get_returns_empty_array_for_invalid_meta() {
		update_user_meta( self::$user_id, DESKTOP_MODE_SEEN_INTROS_META_KEY, 'garbage' );
		$this->assertSame( array(), desktop_mode_get_seen_intros( self::$user_id ) );
	}

	/**
	 * @covers ::desktop_mode_mark_intro_seen
	 * @covers ::desktop_mode_has_seen_intro
	 */
	public function test_mark_and_has_round_trip() {
		$this->assertFalse( desktop_mode_has_seen_intro( self::$user_id, 'posts' ) );
		$this->assertTrue( desktop_mode_mark_intro_seen( self::$user_id, 'posts' ) );
		$this->assertTrue( desktop_mode_has_seen_intro( self::$user_id, 'posts' ) );
		$this->assertSame( array( 'posts' ), desktop_mode_get_seen_intros( self::$user_id ) );
	}

	/**
	 * @covers ::desktop_mode_mark_intro_seen
	 */
	public function test_mark_is_idempotent() {
		desktop_mode_mark_intro_seen( self::$user_id, 'posts' );
		desktop_mode_mark_intro_seen( self::$user_id, 'posts' );
		$this->assertSame( array( 'posts' ), desktop_mode_get_seen_intros( self::$user_id ) );
	}

	/**
	 * @covers ::desktop_mode_mark_intro_seen
	 */
	public function test_mark_appends_distinct_slugs() {
		desktop_mode_mark_intro_seen( self::$user_id, 'posts' );
		desktop_mode_mark_intro_seen( self::$user_id, 'pages' );
		$this->assertSame(
			array( 'posts', 'pages' ),
			desktop_mode_get_seen_intros( self::$user_id )
		);
	}

	/**
	 * @covers ::desktop_mode_mark_intro_seen
	 */
	public function test_mark_rejects_invalid_input() {
		$this->assertFalse( desktop_mode_mark_intro_seen( 0, 'posts' ) );
		$this->assertFalse( desktop_mode_mark_intro_seen( self::$user_id, '' ) );
		$this->assertFalse( desktop_mode_mark_intro_seen( self::$user_id, '   ' ) );
	}

	/**
	 * @covers ::desktop_mode_clear_seen_intros
	 */
	public function test_clear_wipes_the_list() {
		desktop_mode_mark_intro_seen( self::$user_id, 'posts' );
		desktop_mode_mark_intro_seen( self::$user_id, 'pages' );

		$this->assertTrue( desktop_mode_clear_seen_intros( self::$user_id ) );
		$this->assertSame( array(), desktop_mode_get_seen_intros( self::$user_id ) );
	}

	/**
	 * @covers ::desktop_mode_sanitize_seen_intros
	 */
	public function test_sanitize_drops_garbage_and_dedupes() {
		$out = desktop_mode_sanitize_seen_intros( array( 'posts', 42, 'posts', '', 'PAGES' ) );
		// `sanitize_key()` lowercases — `'PAGES'` → `'pages'`.
		$this->assertSame( array( 'posts', 'pages' ), $out );
	}

	/**
	 * @covers ::desktop_mode_sanitize_seen_intros
	 */
	public function test_sanitize_caps_at_max() {
		$big = array();
		for ( $i = 0; $i < DESKTOP_MODE_SEEN_INTROS_MAX + 10; $i++ ) {
			$big[] = 'slug-' . $i;
		}
		$out = desktop_mode_sanitize_seen_intros( $big );
		$this->assertCount( DESKTOP_MODE_SEEN_INTROS_MAX, $out );
	}

	/**
	 * @covers ::desktop_mode_rest_mark_intro_seen
	 */
	public function test_rest_mark_seen_round_trip() {
		wp_set_current_user( self::$user_id );

		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/intros/seen' );
		$request->set_param( 'slug', 'posts' );

		$response = rest_get_server()->dispatch( $request );
		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( array( 'posts' ), $response->get_data()['seenIntros'] );
		$this->assertTrue( desktop_mode_has_seen_intro( self::$user_id, 'posts' ) );
	}

	/**
	 * @covers ::desktop_mode_rest_mark_intro_seen
	 */
	public function test_rest_mark_seen_rejects_empty_slug() {
		wp_set_current_user( self::$user_id );

		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/intros/seen' );
		$request->set_param( 'slug', '' );

		$response = rest_get_server()->dispatch( $request );
		$this->assertSame( 400, $response->get_status() );
	}

	/**
	 * @covers ::desktop_mode_rest_clear_seen_intros
	 */
	public function test_rest_clear_wipes_list() {
		wp_set_current_user( self::$user_id );
		desktop_mode_mark_intro_seen( self::$user_id, 'posts' );

		$request  = new WP_REST_Request( 'DELETE', '/desktop-mode/v1/intros' );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( array(), $response->get_data()['seenIntros'] );
		$this->assertSame( array(), desktop_mode_get_seen_intros( self::$user_id ) );
	}

	/**
	 * @covers ::desktop_mode_rest_seen_intros_permission
	 */
	public function test_rest_requires_authentication() {
		wp_set_current_user( 0 );

		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/intros/seen' );
		$request->set_param( 'slug', 'posts' );

		$response = rest_get_server()->dispatch( $request );
		$this->assertSame( 401, $response->get_status() );
	}

	/**
	 * Regression: the first-run welcome dialog (slug `activation-welcome`)
	 * renders only while Desktop Mode is *disabled*, so its dismissal must
	 * persist through this route without the enabled gate. Previously the
	 * shared `desktop_mode_rest_require_enabled()` gate 403'd the POST, the
	 * slug was never recorded, and the dialog re-appeared on every
	 * classic-admin page load.
	 *
	 * @covers ::desktop_mode_rest_seen_intros_permission
	 */
	public function test_rest_welcome_slug_persists_without_desktop_mode_enabled() {
		// Reproduce the exact state the welcome dialog appears in: a
		// logged-in, `read`-capable account that has NOT enabled Desktop Mode.
		delete_user_meta( self::$user_id, 'desktop_mode_mode' );
		wp_set_current_user( self::$user_id );

		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/intros/seen' );
		$request->set_param( 'slug', DESKTOP_MODE_WELCOME_INTRO_SLUG );

		$response = rest_get_server()->dispatch( $request );
		$this->assertSame( 200, $response->get_status() );
		$this->assertContains(
			DESKTOP_MODE_WELCOME_INTRO_SLUG,
			$response->get_data()['seenIntros']
		);
		$this->assertTrue(
			desktop_mode_has_seen_intro( self::$user_id, DESKTOP_MODE_WELCOME_INTRO_SLUG )
		);
	}

	/**
	 * The welcome-slug exception is scoped to that one slug: every other
	 * (in-shell) intro still requires Desktop Mode enabled, so a not-enabled
	 * caller posting e.g. `posts` is still rejected with 403.
	 *
	 * @covers ::desktop_mode_rest_seen_intros_permission
	 */
	public function test_rest_non_welcome_slug_still_requires_enabled() {
		delete_user_meta( self::$user_id, 'desktop_mode_mode' );
		wp_set_current_user( self::$user_id );

		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/intros/seen' );
		$request->set_param( 'slug', 'posts' );

		$response = rest_get_server()->dispatch( $request );
		$this->assertSame( 403, $response->get_status() );
		$this->assertFalse( desktop_mode_has_seen_intro( self::$user_id, 'posts' ) );
	}
}
