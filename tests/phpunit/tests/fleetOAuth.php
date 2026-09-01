<?php
/**
 * Tests for Fleet's OAuth 2.0 authorization server.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-fleet-oauth
 */
class Tests_OpenStation_FleetOAuth extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		add_filter( 'home_url', array( $this, 'filter_managed_site_home_url' ) );
		wp_set_current_user( self::$admin_id );
		delete_option( OPENSTATION_FLEET_OAUTH_OPTION );
		unset( $GLOBALS['openstation_fleet_oauth_auth_status'], $GLOBALS['openstation_fleet_oauth_grant'] );
		unset( $_SERVER['HTTP_AUTHORIZATION'], $_SERVER['REDIRECT_HTTP_AUTHORIZATION'], $_SERVER['REQUEST_URI'] );
	}

	public function tear_down() {
		global $wpdb;
		$wpdb->query(
			"DELETE FROM {$wpdb->options} WHERE option_name LIKE '_transient_openstation_fleet_oauth_code_%'"
		);
		delete_option( OPENSTATION_FLEET_OAUTH_OPTION );
		remove_filter( 'home_url', array( $this, 'filter_managed_site_home_url' ) );
		unset( $GLOBALS['openstation_fleet_oauth_auth_status'], $GLOBALS['openstation_fleet_oauth_grant'] );
		unset( $_SERVER['HTTP_AUTHORIZATION'], $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] );
		$_SERVER['REQUEST_URI'] = '/';
		parent::tear_down();
	}

	/**
	 * Give the OAuth server a stable HTTPS issuer inside wp-env.
	 *
	 * @param string $url Generated home URL.
	 * @return string
	 */
	public function filter_managed_site_home_url( $url ) {
		return str_replace( 'http://localhost:8891', 'https://managed.example', $url );
	}

	public function test_metadata_advertises_pkce_rotation_endpoints_and_full_site_scope() {
		$metadata = openstation_fleet_oauth_metadata();

		$this->assertSame( 'https://managed.example', $metadata['issuer'] );
		$this->assertSame( array( 'S256' ), $metadata['code_challenge_methods_supported'] );
		$this->assertContains( 'refresh_token', $metadata['grant_types_supported'] );
		$this->assertSame( array( 'site:manage' ), $metadata['scopes_supported'] );
		$this->assertStringStartsWith( 'https://managed.example/', $metadata['token_endpoint'] );
		$this->assertStringStartsWith( 'https://managed.example/', $metadata['revocation_endpoint'] );
	}

	public function test_authorization_request_requires_s256_and_exact_registered_redirect() {
		$client_id = wp_generate_uuid4();
		$request   = $this->authorization_request( $client_id );
		$this->assertIsArray( openstation_fleet_oauth_validate_authorization_request( $request ) );

		$request['code_challenge_method'] = 'plain';
		$this->assertWPError( openstation_fleet_oauth_validate_authorization_request( $request ) );

		$tokens = $this->issue_tokens( $client_id );
		$this->assertNotEmpty( $tokens['access_token'] );
		$request                         = $this->authorization_request( $client_id );
		$request['redirect_uri']         = 'https://other-hub.example/wp-admin/admin-post.php?action=fleet';
		$redirect_mismatch               = openstation_fleet_oauth_validate_authorization_request( $request );
		$this->assertWPError( $redirect_mismatch );
		$this->assertSame( 'invalid_request', $redirect_mismatch->get_error_code() );
	}

	public function test_code_exchange_stores_only_hashes_and_bearer_authenticates_the_wordpress_user() {
		$tokens = $this->issue_tokens();
		$grants = openstation_fleet_oauth_get_grants();

		$this->assertCount( 1, $grants );
		$this->assertStringNotContainsString( $tokens['access_token'], serialize( $grants ) );
		$this->assertStringNotContainsString( $tokens['refresh_token'], serialize( $grants ) );

		wp_set_current_user( 0 );
		$_SERVER['REQUEST_URI']      = '/wp-json/wp/v2/users/me';
		$_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $tokens['access_token'];
		$this->assertSame( self::$admin_id, openstation_fleet_oauth_determine_current_user( 0 ) );
		$this->assertTrue( openstation_fleet_oauth_rest_authentication_errors( null ) );
	}

	public function test_refresh_token_rotates_and_replay_revokes_the_whole_grant() {
		$client_id = wp_generate_uuid4();
		$tokens    = $this->issue_tokens( $client_id );
		$first     = $this->refresh( $tokens['refresh_token'], $client_id );

		$this->assertSame( 200, $first->get_status() );
		$this->assertNotSame( $tokens['refresh_token'], $first->get_data()['refresh_token'] );

		$replay = $this->refresh( $tokens['refresh_token'], $client_id );
		$this->assertSame( 400, $replay->get_status() );
		$this->assertSame( 'invalid_grant', $replay->get_data()['error'] );

		$grant = reset( openstation_fleet_oauth_get_grants() );
		$this->assertGreaterThan( 0, (int) $grant['revoked_at'] );
	}

	public function test_revocation_returns_success_for_unknown_tokens() {
		$request = new WP_REST_Request( 'POST', '/openstation/v1/oauth/revoke' );
		$request->set_body_params(
			array(
				'token'     => 'unknown',
				'client_id' => wp_generate_uuid4(),
			)
		);

		$this->assertSame( 200, openstation_fleet_oauth_revoke_endpoint( $request )->get_status() );
	}

	private function authorization_request( $client_id ) {
		$verifier = openstation_fleet_oauth_random_value( 32 );
		return array(
			'response_type'         => 'code',
			'client_id'             => $client_id,
			'redirect_uri'          => 'https://hub.example/wp-admin/admin-post.php?action=fleet',
			'scope'                 => OPENSTATION_FLEET_OAUTH_SCOPE,
			'state'                 => openstation_fleet_oauth_random_value( 32 ),
			'code_challenge'        => openstation_fleet_oauth_base64url_encode( hash( 'sha256', $verifier, true ) ),
			'code_challenge_method' => 'S256',
		);
	}

	private function issue_tokens( $client_id = '' ) {
		$client_id   = $client_id ? $client_id : wp_generate_uuid4();
		$verifier    = openstation_fleet_oauth_random_value( 32 );
		$code        = openstation_fleet_oauth_random_value( 32 );
		$redirect_uri = 'https://hub.example/wp-admin/admin-post.php?action=fleet';
		set_transient(
			OPENSTATION_FLEET_OAUTH_CODE_PREFIX . hash( 'sha256', $code ),
			array(
				'user_id'        => self::$admin_id,
				'client_id'      => $client_id,
				'redirect_uri'   => $redirect_uri,
				'scope'          => OPENSTATION_FLEET_OAUTH_SCOPE,
				'code_challenge' => openstation_fleet_oauth_base64url_encode( hash( 'sha256', $verifier, true ) ),
				'issued_at'      => time(),
			),
			OPENSTATION_FLEET_OAUTH_CODE_TTL
		);

		$request = new WP_REST_Request( 'POST', '/openstation/v1/oauth/token' );
		$request->set_body_params(
			array(
				'grant_type'    => 'authorization_code',
				'code'          => $code,
				'client_id'     => $client_id,
				'redirect_uri'  => $redirect_uri,
				'code_verifier' => $verifier,
			)
		);
		$response = openstation_fleet_oauth_token_endpoint( $request );
		$this->assertSame( 200, $response->get_status() );
		return $response->get_data();
	}

	private function refresh( $refresh_token, $client_id ) {
		$request = new WP_REST_Request( 'POST', '/openstation/v1/oauth/token' );
		$request->set_body_params(
			array(
				'grant_type'    => 'refresh_token',
				'refresh_token' => $refresh_token,
				'client_id'     => $client_id,
			)
		);
		return openstation_fleet_oauth_token_endpoint( $request );
	}
}
