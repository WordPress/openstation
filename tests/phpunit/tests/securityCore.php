<?php
/**
 * Security regressions for the core OpenStation surface: the shared
 * REST gate, the notes and presence channels, the games opponent
 * picker, the window-links related entities, the OAuth relay callback
 * and the desktop-theme SVG sanitizer.
 *
 * Each test pins one hole closed, from the lowest role that could
 * reach it. "A user with no role on this site" stands in for the
 * multisite case: the OpenStation opt-in is network-wide user meta,
 * so a member of one site is "enabled" on every other, where
 * `current_user_can( 'read' )` is false for them.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-security
 */
class Tests_OpenStation_SecurityCore extends WP_UnitTestCase {

	/**
	 * Administrator.
	 *
	 * @var int
	 */
	protected static $admin_id;

	/**
	 * Contributor.
	 *
	 * @var int
	 */
	protected static $contributor_id;

	/**
	 * Subscriber.
	 *
	 * @var int
	 */
	protected static $subscriber_id;

	/**
	 * A user with no role on the current site (the multisite outsider).
	 *
	 * @var int
	 */
	protected static $outsider_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id       = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$contributor_id = $factory->user->create( array( 'role' => 'contributor' ) );
		self::$subscriber_id  = $factory->user->create( array( 'role' => 'subscriber' ) );
		self::$outsider_id    = $factory->user->create( array( 'role' => '' ) );
		foreach ( array( self::$admin_id, self::$contributor_id, self::$subscriber_id, self::$outsider_id ) as $user_id ) {
			update_user_meta( $user_id, 'desktop_mode_mode', '1' );
		}
	}

	public function tear_down() {
		unset( $_COOKIE[ LOGGED_IN_COOKIE ] );
		openstation_unregister_oauth_relay( 'securitycore' );
		remove_all_filters( 'pre_http_request' );
		remove_all_filters( 'rest_pre_serve_request' );
		wp_set_current_user( 0 );
		parent::tear_down();
	}

	/*
	 * Shared REST gate.
	 */

	/**
	 * The files and recycle-bin routes keep their own base gates; both
	 * carry the same per-site `read` floor as the shared one.
	 *
	 * @covers ::openstation_files_rest_permission
	 * @covers ::openstation_recycle_bin_rest_permission
	 */
	public function test_files_and_recycle_bin_gates_refuse_a_user_without_a_role_on_the_site() {
		wp_set_current_user( self::$outsider_id );
		foreach ( array( 'openstation_files_rest_permission', 'openstation_recycle_bin_rest_permission' ) as $gate ) {
			$result = call_user_func( $gate );
			$this->assertWPError( $result, $gate );
			$this->assertSame( 403, $result->get_error_data()['status'], $gate );
		}

		wp_set_current_user( self::$subscriber_id );
		$this->assertTrue( openstation_files_rest_permission() );
		$this->assertTrue( openstation_recycle_bin_rest_permission() );
	}


	/**
	 * @covers ::openstation_rest_require_enabled
	 */
	public function test_rest_gate_refuses_an_enabled_user_without_a_role_on_the_site() {
		wp_set_current_user( self::$outsider_id );
		$this->assertTrue( openstation_is_enabled(), 'Precondition: the opt-in alone says yes.' );

		$result = openstation_rest_require_enabled();

		$this->assertWPError( $result );
		$this->assertSame( 403, $result->get_error_data()['status'] );
	}

	/**
	 * @covers ::openstation_rest_require_enabled
	 */
	public function test_rest_gate_still_admits_a_subscriber_who_enabled_openstation() {
		wp_set_current_user( self::$subscriber_id );
		$this->assertTrue( openstation_rest_require_enabled() );
	}

	/*
	 * Notes and presence: cross-site reach on a multisite.
	 */

	/**
	 * @covers ::openstation_notes_rest_permission
	 */
	public function test_notes_permission_refuses_a_user_without_a_role_on_the_site() {
		wp_set_current_user( self::$outsider_id );

		$result = openstation_notes_rest_permission();

		$this->assertWPError( $result );
		$this->assertSame( 403, $result->get_error_data()['status'] );

		wp_set_current_user( self::$subscriber_id );
		$this->assertTrue( openstation_notes_rest_permission() );
	}

	/**
	 * @covers ::openstation_notes_heartbeat_received
	 */
	public function test_notes_heartbeat_withholds_public_notes_from_a_user_without_a_role() {
		wp_set_current_user( self::$admin_id );
		self::factory()->post->create(
			array(
				'post_type'    => OPENSTATION_NOTES_POST_TYPE,
				'post_status'  => 'publish',
				'post_author'  => self::$admin_id,
				'post_content' => 'Site-only memo',
			)
		);
		$data = array( 'openstation_notes_subscribe' => array( 'knownIds' => array() ) );

		wp_set_current_user( self::$outsider_id );
		$response = openstation_notes_heartbeat_received( array(), $data );
		$this->assertArrayNotHasKey( 'openstation_notes', $response );

		wp_set_current_user( self::$subscriber_id );
		$response = openstation_notes_heartbeat_received( array(), $data );
		$this->assertArrayHasKey( 'openstation_notes', $response );
	}

	/**
	 * @covers ::openstation_presence_heartbeat_received
	 */
	public function test_presence_heartbeat_ignores_a_user_without_a_role() {
		wp_set_current_user( self::$outsider_id );

		$response = openstation_presence_heartbeat_received( array(), array( 'openstation_presence_active' => true ) );

		$this->assertArrayNotHasKey( 'openstation_presence', $response );
	}

	/*
	 * Games opponent picker: email substring oracle.
	 */

	/**
	 * @covers ::openstation_games_rest_search_users
	 */
	public function test_games_user_search_does_not_match_on_email_for_a_subscriber() {
		if ( ! function_exists( 'openstation_games_rest_search_users' ) ) {
			$this->markTestSkipped( 'Games module not loaded.' );
		}
		$victim_id = self::factory()->user->create(
			array(
				'role'          => 'administrator',
				'user_login'    => 'gamesvictim',
				'user_nicename' => 'gamesvictim',
				'display_name'  => 'Victim',
				'user_email'    => 'qz-hidden-mailbox@example.org',
			)
		);

		$request = new WP_REST_Request( 'GET', '/desktop-mode/v1/games/users/search' );
		$request->set_param( 'q', 'qz-hidden-mailbox' );
		$request->set_param( 'exclude', '' );

		wp_set_current_user( self::$subscriber_id );
		$found = wp_list_pluck( openstation_games_rest_search_users( $request )->get_data()['users'], 'id' );
		$this->assertNotContains( $victim_id, $found, 'A subscriber must not find a user by a fragment of their email.' );

		wp_set_current_user( self::$admin_id );
		$found = wp_list_pluck( openstation_games_rest_search_users( $request )->get_data()['users'], 'id' );
		$this->assertContains( $victim_id, $found, 'A user who may list users still searches the email column.' );
	}

	/*
	 * Window links: titles of posts the viewer cannot read.
	 */

	/**
	 * A contributor's own draft that links another author's private
	 * post and embeds its attachment must not surface either title.
	 *
	 * @covers ::openstation_window_related_entities_for_post
	 * @covers ::openstation_window_links_extract_references
	 */
	public function test_related_entities_withhold_posts_and_media_the_viewer_cannot_read() {
		wp_set_current_user( self::$admin_id );
		$private_id = self::factory()->post->create(
			array(
				'post_status' => 'private',
				'post_author' => self::$admin_id,
				'post_title'  => 'Acquisition Plan',
			)
		);
		$media_id   = self::factory()->attachment->create_object(
			'secret.jpg',
			$private_id,
			array(
				'post_mime_type' => 'image/jpeg',
				'post_title'     => 'Acquisition Photo',
				'post_author'    => self::$admin_id,
			)
		);
		$draft_id   = self::factory()->post->create(
			array(
				'post_status'  => 'draft',
				'post_author'  => self::$contributor_id,
				'post_content' => '<a href="' . esc_url( home_url( '/?p=' . $private_id ) ) . '">x</a>'
					. '<img class="wp-image-' . $media_id . '" src="x.jpg" />',
			)
		);

		wp_set_current_user( self::$contributor_id );
		$this->assertTrue( current_user_can( 'edit_post', $draft_id ), 'Precondition: the contributor may open their draft.' );

		$labels = wp_list_pluck( openstation_window_related_entities_for_post( get_post( $draft_id ) ), 'label' );
		$this->assertNotContains( 'Private: Acquisition Plan', $labels );
		$this->assertNotContains( 'Acquisition Plan', $labels );
		$this->assertNotContains( 'Acquisition Photo', $labels );

		$refs = wp_list_pluck( openstation_window_links_extract_references( get_post( $draft_id ) ), 'id' );
		$this->assertNotContains( $private_id, $refs );
		$this->assertNotContains( $media_id, $refs );

		// The same draft seen by someone who may read both still lists them.
		wp_set_current_user( self::$admin_id );
		$ids = wp_list_pluck( openstation_window_related_entities_for_post( get_post( $draft_id ) ), 'id' );
		$this->assertContains( 'media-' . $media_id, $ids );
		if ( function_exists( 'openstation_content_graph_extract_internal_links' ) ) {
			$this->assertContains( 'link-' . $private_id, $ids );
		}
	}

	/*
	 * OAuth relay: a flow finished by another account.
	 */

	/**
	 * Register the relay these tests use and count `on_success` calls.
	 *
	 * @param int $calls Incremented on each `on_success`.
	 */
	private function register_counting_relay( &$calls ) {
		openstation_register_oauth_relay(
			'securitycore',
			array(
				'authorize_url' => 'https://example.com/oauth/authorize',
				'token_url'     => 'https://api.example.com/oauth/token',
				'client_id'     => 'cid',
				'client_secret' => 'csecret',
				'on_success'    => static function () use ( &$calls ) {
					++$calls;
				},
			)
		);
		add_filter(
			'pre_http_request',
			static function () {
				return array(
					'response' => array(
						'code'    => 200,
						'message' => 'OK',
					),
					'body'     => '{"access_token":"tok"}',
					'headers'  => array(),
					'cookies'  => array(),
					'filename' => null,
				);
			}
		);
	}

	/**
	 * Run the callback for a state, with the browser logged in as `$browser_user`.
	 *
	 * @param string $state        State.
	 * @param int    $browser_user User whose `logged_in` cookie the browser carries.
	 * @return string Callback HTML.
	 */
	private function run_callback( $state, $browser_user ) {
		if ( empty( $_SERVER['REQUEST_METHOD'] ) ) {
			$_SERVER['REQUEST_METHOD'] = 'GET';
		}
		$_COOKIE[ LOGGED_IN_COOKIE ] = wp_generate_auth_cookie( $browser_user, time() + HOUR_IN_SECONDS, 'logged_in' );
		// REST cookie auth without a nonce: no current user.
		wp_set_current_user( 0 );

		$request = new WP_REST_Request( 'GET', '/desktop-mode/v1/oauth/callback' );
		$request->set_query_params(
			array(
				'state' => $state,
				'code'  => 'auth-code',
			)
		);
		return (string) openstation_rest_oauth_callback( $request )->get_data();
	}

	/**
	 * @covers ::openstation_rest_oauth_callback
	 */
	public function test_oauth_callback_refuses_a_flow_finished_by_another_account() {
		$calls = 0;
		$this->register_counting_relay( $calls );
		$state = openstation_oauth_issue_state( self::$subscriber_id, 'securitycore' );

		$html = $this->run_callback( $state, self::$admin_id );

		$this->assertStringContainsString( 'session_mismatch', $html );
		$this->assertSame( 0, $calls, 'The code must not be exchanged onto the account that started the flow.' );
	}

	/**
	 * @covers ::openstation_rest_oauth_callback
	 */
	public function test_oauth_callback_completes_for_the_account_that_started_it() {
		$calls = 0;
		$this->register_counting_relay( $calls );
		$state = openstation_oauth_issue_state( self::$subscriber_id, 'securitycore' );

		$html = $this->run_callback( $state, self::$subscriber_id );

		$this->assertStringContainsString( '"ok":true', $html );
		$this->assertSame( 1, $calls );
	}

	/*
	 * Desktop-theme SVG sanitizer.
	 */

	/**
	 * A `javascript:` URL split by a tab (which the URL parser drops)
	 * must not survive on any attribute.
	 *
	 * @covers ::openstation_desktop_theme_sanitize_svg
	 */
	public function test_svg_sanitizer_strips_whitespace_split_javascript_urls() {
		if ( ! class_exists( 'DOMDocument' ) ) {
			$this->markTestSkipped( 'DOMDocument unavailable.' );
		}
		$file = wp_tempnam( 'securitycore.svg' );
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents
		file_put_contents(
			$file,
			'<svg xmlns="http://www.w3.org/2000/svg" xmlns:h="http://www.w3.org/1999/xhtml">'
			. '<h:form action="java&#9;script:alert(1)"><h:button formaction="jav&#10;ascript:alert(2)">go</h:button></h:form>'
			. '<rect width="10" height="10" fill="red"/></svg>'
		);

		$result = openstation_desktop_theme_sanitize_svg( $file );
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
		$clean = (string) file_get_contents( $file );
		wp_delete_file( $file );

		$this->assertTrue( $result );
		$this->assertStringNotContainsString( 'action=', $clean );
		$this->assertStringNotContainsString( 'alert', $clean );
		$this->assertStringContainsString( 'fill="red"', $clean, 'Benign attributes survive.' );
	}

	/**
	 * The doctype check is a byte match, which a UTF-16 document walks
	 * past; the parser then has to refuse the doctype itself. With
	 * entity substitution on, an entity declared there could name
	 * `file:///…/wp-config.php` and the sanitized icon would carry it.
	 *
	 * The entity here is internal so the test does not depend on what
	 * the server lets libxml read; the doctype is what must be refused.
	 *
	 * @covers ::openstation_desktop_theme_sanitize_svg
	 */
	public function test_svg_sanitizer_refuses_a_utf16_document_with_a_doctype() {
		if ( ! class_exists( 'DOMDocument' ) || ! function_exists( 'mb_convert_encoding' ) ) {
			$this->markTestSkipped( 'DOMDocument or mbstring unavailable.' );
		}
		$file = wp_tempnam( 'securitycore.svg' );
		$svg  = '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY xxe "SUBSTITUTED-MARKER">]>'
			. '<svg xmlns="http://www.w3.org/2000/svg"><title>&xxe;</title><rect width="10" height="10"/></svg>';
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents
		file_put_contents( $file, "\xFF\xFE" . mb_convert_encoding( $svg, 'UTF-16LE', 'UTF-8' ) );

		$result = openstation_desktop_theme_sanitize_svg( $file );
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
		$after = (string) file_get_contents( $file );
		wp_delete_file( $file );

		$this->assertWPError( $result );
		$this->assertSame( 'openstation_desktop_theme_bad_svg', $result->get_error_code() );
		$this->assertStringNotContainsString( 'SUBSTITUTED-MARKER', $after, 'Nothing was substituted into the file.' );
	}

	/*
	 * OAuth relay: a browser with no session at all.
	 */

	/**
	 * A handed-over authorize link most often lands in a browser that is
	 * not logged in here; that browser must not finish the flow either.
	 *
	 * @covers ::openstation_rest_oauth_callback
	 */
	public function test_oauth_callback_refuses_a_browser_with_no_session() {
		$calls = 0;
		$this->register_counting_relay( $calls );
		$state = openstation_oauth_issue_state( self::$subscriber_id, 'securitycore' );

		unset( $_COOKIE[ LOGGED_IN_COOKIE ] );
		wp_set_current_user( 0 );
		$request = new WP_REST_Request( 'GET', '/desktop-mode/v1/oauth/callback' );
		$request->set_query_params(
			array(
				'state' => $state,
				'code'  => 'auth-code',
			)
		);
		$html = (string) openstation_rest_oauth_callback( $request )->get_data();

		$this->assertStringContainsString( 'session_mismatch', $html );
		$this->assertSame( 0, $calls );
	}

	/*
	 * The two Heartbeat channels that did not share the notes gate.
	 */

	/**
	 * @covers ::openstation_files_heartbeat_received
	 * @covers ::openstation_games_heartbeat_received
	 */
	public function test_files_and_games_heartbeats_ignore_a_user_without_a_role() {
		openstation_files_install_schema();
		$files_data = array( 'openstation_files_subscribe' => array( 'folderVersions' => array() ) );
		$games_data = array( 'openstation_games_subscribe' => array() );

		wp_set_current_user( self::$outsider_id );
		$this->assertArrayNotHasKey( 'openstation_files', openstation_files_heartbeat_received( array(), $files_data ) );
		$this->assertArrayNotHasKey( 'openstation_games', openstation_games_heartbeat_received( array(), $games_data ) );

		wp_set_current_user( self::$subscriber_id );
		$this->assertArrayHasKey( 'openstation_files', openstation_files_heartbeat_received( array(), $files_data ) );
	}
}
