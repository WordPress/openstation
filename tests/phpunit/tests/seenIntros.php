<?php

class Tests_OpenStation_SeenIntros extends WP_UnitTestCase {

	protected static $user_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$user_id = $factory->user->create( array( 'role' => 'editor' ) );
	}

	public function set_up() {
		parent::set_up();

		update_user_meta( self::$user_id, 'desktop_mode_mode', '1' );
	}

	public function tear_down() {
		delete_user_meta( self::$user_id, OPENSTATION_SEEN_INTROS_META_KEY );
		delete_user_meta( self::$user_id, 'desktop_mode_mode' );
		parent::tear_down();
	}

	public function test_get_returns_empty_array_for_unconfigured_user() {
		$this->assertSame( array(), openstation_get_seen_intros( self::$user_id ) );
	}

	public function test_get_returns_empty_array_for_invalid_meta() {
		update_user_meta( self::$user_id, OPENSTATION_SEEN_INTROS_META_KEY, 'garbage' );
		$this->assertSame( array(), openstation_get_seen_intros( self::$user_id ) );
	}

	public function test_mark_and_has_round_trip() {
		$this->assertFalse( openstation_has_seen_intro( self::$user_id, 'posts' ) );
		$this->assertTrue( openstation_mark_intro_seen( self::$user_id, 'posts' ) );
		$this->assertTrue( openstation_has_seen_intro( self::$user_id, 'posts' ) );
		$this->assertSame( array( 'posts' ), openstation_get_seen_intros( self::$user_id ) );
	}

	public function test_mark_is_idempotent() {
		openstation_mark_intro_seen( self::$user_id, 'posts' );
		openstation_mark_intro_seen( self::$user_id, 'posts' );
		$this->assertSame( array( 'posts' ), openstation_get_seen_intros( self::$user_id ) );
	}

	public function test_mark_appends_distinct_slugs() {
		openstation_mark_intro_seen( self::$user_id, 'posts' );
		openstation_mark_intro_seen( self::$user_id, 'pages' );
		$this->assertSame(
			array( 'posts', 'pages' ),
			openstation_get_seen_intros( self::$user_id )
		);
	}

	public function test_mark_rejects_invalid_input() {
		$this->assertFalse( openstation_mark_intro_seen( 0, 'posts' ) );
		$this->assertFalse( openstation_mark_intro_seen( self::$user_id, '' ) );
		$this->assertFalse( openstation_mark_intro_seen( self::$user_id, '   ' ) );
	}

	public function test_clear_wipes_the_list() {
		openstation_mark_intro_seen( self::$user_id, 'posts' );
		openstation_mark_intro_seen( self::$user_id, 'pages' );

		$this->assertTrue( openstation_clear_seen_intros( self::$user_id ) );
		$this->assertSame( array(), openstation_get_seen_intros( self::$user_id ) );
	}

	public function test_sanitize_drops_garbage_and_dedupes() {
		$out = openstation_sanitize_seen_intros( array( 'posts', 42, 'posts', '', 'PAGES' ) );

		$this->assertSame( array( 'posts', 'pages' ), $out );
	}

	public function test_sanitize_caps_at_max() {
		$big = array();
		for ( $i = 0; $i < OPENSTATION_SEEN_INTROS_MAX + 10; $i++ ) {
			$big[] = 'slug-' . $i;
		}
		$out = openstation_sanitize_seen_intros( $big );
		$this->assertCount( OPENSTATION_SEEN_INTROS_MAX, $out );
	}

	public function test_rest_mark_seen_round_trip() {
		wp_set_current_user( self::$user_id );

		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/intros/seen' );
		$request->set_param( 'slug', 'posts' );

		$response = rest_get_server()->dispatch( $request );
		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( array( 'posts' ), $response->get_data()['seenIntros'] );
		$this->assertTrue( openstation_has_seen_intro( self::$user_id, 'posts' ) );
	}

	public function test_rest_mark_seen_rejects_empty_slug() {
		wp_set_current_user( self::$user_id );

		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/intros/seen' );
		$request->set_param( 'slug', '' );

		$response = rest_get_server()->dispatch( $request );
		$this->assertSame( 400, $response->get_status() );
	}

	public function test_rest_clear_wipes_list() {
		wp_set_current_user( self::$user_id );
		openstation_mark_intro_seen( self::$user_id, 'posts' );

		$request  = new WP_REST_Request( 'DELETE', '/desktop-mode/v1/intros' );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( array(), $response->get_data()['seenIntros'] );
		$this->assertSame( array(), openstation_get_seen_intros( self::$user_id ) );
	}

	public function test_rest_requires_authentication() {
		wp_set_current_user( 0 );

		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/intros/seen' );
		$request->set_param( 'slug', 'posts' );

		$response = rest_get_server()->dispatch( $request );
		$this->assertSame( 401, $response->get_status() );
	}

	public function test_rest_welcome_slug_persists_without_openstation_enabled() {

		delete_user_meta( self::$user_id, 'desktop_mode_mode' );
		wp_set_current_user( self::$user_id );

		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/intros/seen' );
		$request->set_param( 'slug', OPENSTATION_WELCOME_INTRO_SLUG );

		$response = rest_get_server()->dispatch( $request );
		$this->assertSame( 200, $response->get_status() );
		$this->assertContains(
			OPENSTATION_WELCOME_INTRO_SLUG,
			$response->get_data()['seenIntros']
		);
		$this->assertTrue(
			openstation_has_seen_intro( self::$user_id, OPENSTATION_WELCOME_INTRO_SLUG )
		);
	}

	public function test_rest_non_welcome_slug_still_requires_enabled() {
		delete_user_meta( self::$user_id, 'desktop_mode_mode' );
		wp_set_current_user( self::$user_id );

		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/intros/seen' );
		$request->set_param( 'slug', 'posts' );

		$response = rest_get_server()->dispatch( $request );
		$this->assertSame( 403, $response->get_status() );
		$this->assertFalse( openstation_has_seen_intro( self::$user_id, 'posts' ) );
	}

	public function test_rest_activation_nudge_slug_persists_without_openstation_enabled() {
		delete_user_meta( self::$user_id, 'desktop_mode_mode' );
		wp_set_current_user( self::$user_id );

		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/intros/seen' );
		$request->set_param( 'slug', OPENSTATION_ACTIVATION_NUDGE_INTRO_SLUG );

		$response = rest_get_server()->dispatch( $request );
		$this->assertSame( 200, $response->get_status() );
		$this->assertTrue(
			openstation_has_seen_intro( self::$user_id, OPENSTATION_ACTIVATION_NUDGE_INTRO_SLUG )
		);
	}
}
