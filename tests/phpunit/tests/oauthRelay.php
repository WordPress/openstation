<?php
/**
 * Tests for the OAuth relay scaffolding (`includes/oauth-relay.php`).
 *
 * Covers: registration validation, the static registry, state-nonce
 * issue / consume / single-use, REST start route, REST callback
 * dispatch through `on_success`. Network calls inside the callback
 * route are tested via the `pre_http_request` filter so we don't
 * actually go to a remote token endpoint.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-oauth
 */
class Tests_DesktopMode_OAuthRelay extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
		// Clean transients between tests so a leaked state doesn't
		// leak into the next assertion.
		global $wpdb;
		$wpdb->query(
			"DELETE FROM {$wpdb->options} WHERE option_name LIKE '_transient_desktop_mode_oauth_state_%'"
		);
	}

	public function tear_down() {
		desktop_mode_unregister_oauth_relay( 'tumblrlike' );
		desktop_mode_unregister_oauth_relay( 'denied' );
		remove_all_filters( 'pre_http_request' );
		// `desktop_mode_oauth_render_callback_html` adds a self-
		// removing `rest_pre_serve_request` filter — but tests that
		// build a response without dispatching it through the REST
		// server leave the closure attached. Wipe to keep tests
		// hermetic.
		remove_all_filters( 'rest_pre_serve_request' );
		remove_all_actions( 'desktop_mode_oauth_relay_registered' );
		remove_all_actions( 'desktop_mode_oauth_relay_connected' );
		parent::tear_down();
	}

	/**
	 * @covers ::desktop_mode_register_oauth_relay
	 */
	public function test_registration_succeeds_with_valid_args() {
		$result = desktop_mode_register_oauth_relay( 'tumblrlike', array(
			'authorize_url' => 'https://example.com/oauth/authorize',
			'token_url'     => 'https://api.example.com/oauth/token',
			'client_id'     => 'cid',
			'client_secret' => 'csecret',
			'scope'         => 'basic',
			'on_success'    => static function () {},
		) );

		$this->assertTrue( $result );
		$entry = desktop_mode_oauth_relay_registry( 'tumblrlike' );
		$this->assertIsArray( $entry );
		$this->assertSame( 'tumblrlike', $entry['service'] );
	}

	/**
	 * @covers ::desktop_mode_register_oauth_relay
	 */
	public function test_registration_rejects_missing_authorize_url() {
		$result = desktop_mode_register_oauth_relay( 'tumblrlike', array(
			'token_url'     => 'https://api.example.com/oauth/token',
			'client_id'     => 'cid',
			'client_secret' => 'csecret',
			'on_success'    => static function () {},
		) );

		$this->assertWPError( $result );
		$this->assertSame( 'desktop_mode_oauth_missing_authorize_url', $result->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_register_oauth_relay
	 */
	public function test_registration_rejects_non_callable_on_success() {
		$result = desktop_mode_register_oauth_relay( 'tumblrlike', array(
			'authorize_url' => 'https://example.com/oauth/authorize',
			'token_url'     => 'https://api.example.com/oauth/token',
			'client_id'     => 'cid',
			'client_secret' => 'csecret',
			'on_success'    => 'not-a-callable-string-12345',
		) );

		$this->assertWPError( $result );
		$this->assertSame( 'desktop_mode_oauth_missing_on_success', $result->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_register_oauth_relay
	 */
	public function test_registration_rejects_javascript_url() {
		$result = desktop_mode_register_oauth_relay( 'tumblrlike', array(
			'authorize_url' => 'javascript:alert(1)',
			'token_url'     => 'https://api.example.com/oauth/token',
			'client_id'     => 'cid',
			'client_secret' => 'csecret',
			'on_success'    => static function () {},
		) );

		$this->assertWPError( $result );
		$this->assertSame( 'desktop_mode_oauth_invalid_url', $result->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_oauth_issue_state
	 * @covers ::desktop_mode_oauth_consume_state
	 */
	public function test_state_round_trip_is_single_use() {
		$state = desktop_mode_oauth_issue_state( self::$admin_id, 'tumblrlike' );
		$this->assertNotEmpty( $state );

		$first = desktop_mode_oauth_consume_state( $state );
		$this->assertIsArray( $first );
		$this->assertSame( self::$admin_id, $first['user_id'] );
		$this->assertSame( 'tumblrlike', $first['service'] );

		// Replay must miss — the transient was deleted.
		$second = desktop_mode_oauth_consume_state( $state );
		$this->assertNull( $second );
	}

	/**
	 * @covers ::desktop_mode_oauth_consume_state
	 */
	public function test_consume_returns_null_for_unknown_state() {
		$this->assertNull( desktop_mode_oauth_consume_state( 'never-issued' ) );
		$this->assertNull( desktop_mode_oauth_consume_state( '' ) );
	}

	/**
	 * @covers ::desktop_mode_rest_oauth_start
	 */
	public function test_rest_start_returns_authorize_url_with_state() {
		desktop_mode_register_oauth_relay( 'tumblrlike', array(
			'authorize_url' => 'https://example.com/oauth/authorize',
			'token_url'     => 'https://api.example.com/oauth/token',
			'client_id'     => 'cid',
			'client_secret' => 'csecret',
			'scope'         => 'basic write',
			'on_success'    => static function () {},
		) );

		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/oauth/start' );
		$request->set_body_params( array( 'service' => 'tumblrlike' ) );
		$response = desktop_mode_rest_oauth_start( $request );

		$this->assertInstanceOf( 'WP_REST_Response', $response );
		$data = $response->get_data();
		$this->assertNotEmpty( $data['authorize_url'] );
		$this->assertNotEmpty( $data['state'] );

		$parsed = wp_parse_url( $data['authorize_url'] );
		parse_str( $parsed['query'], $query );
		$this->assertSame( 'cid', $query['client_id'] );
		$this->assertSame( 'code', $query['response_type'] );
		$this->assertSame( $data['state'], $query['state'] );
		// Scope was URL-encoded twice through `add_query_arg` +
		// `rawurlencode`, so the decoded value comes back with a `+`
		// or %20 — assert on decoded equality.
		$this->assertSame( 'basic write', urldecode( $query['scope'] ) );
	}

	/**
	 * @covers ::desktop_mode_rest_oauth_start
	 */
	public function test_rest_start_404s_for_unknown_service() {
		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/oauth/start' );
		$request->set_body_params( array( 'service' => 'never-registered' ) );
		$response = desktop_mode_rest_oauth_start( $request );

		$this->assertWPError( $response );
		$this->assertSame( 'desktop_mode_oauth_unknown_service', $response->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_rest_oauth_start
	 */
	public function test_rest_start_capability_gate_denies_subscriber() {
		$subscriber = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		wp_set_current_user( $subscriber );

		desktop_mode_register_oauth_relay( 'denied', array(
			'authorize_url' => 'https://example.com/oauth/authorize',
			'token_url'     => 'https://api.example.com/oauth/token',
			'client_id'     => 'cid',
			'client_secret' => 'csecret',
			'on_success'    => static function () {},
			'capabilities'  => array( 'manage_options' ),
		) );

		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/oauth/start' );
		$request->set_body_params( array( 'service' => 'denied' ) );
		$response = desktop_mode_rest_oauth_start( $request );

		$this->assertWPError( $response );
		$this->assertSame( 'desktop_mode_oauth_capability_denied', $response->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_rest_oauth_callback
	 */
	public function test_rest_callback_invalid_state_yields_html_with_invalid_state_payload() {
		$request = new WP_REST_Request( 'GET', '/desktop-mode/v1/oauth/callback' );
		$request->set_query_params( array( 'state' => 'never-issued', 'code' => 'abc' ) );
		$response = desktop_mode_rest_oauth_callback( $request );

		$this->assertInstanceOf( 'WP_REST_Response', $response );
		$body = (string) $response->get_data();
		$this->assertStringContainsString( 'invalid_state', $body );
		$this->assertStringContainsString( 'desktop-mode-oauth-callback', $body );
	}

	/**
	 * @covers ::desktop_mode_rest_oauth_callback
	 */
	public function test_rest_callback_success_invokes_on_success_and_fires_action() {
		$received_user = null;
		$received_tokens = null;
		$received_service = null;
		$action_calls = array();

		desktop_mode_register_oauth_relay( 'tumblrlike', array(
			'authorize_url' => 'https://example.com/oauth/authorize',
			'token_url'     => 'https://api.example.com/oauth/token',
			'client_id'     => 'cid',
			'client_secret' => 'csecret',
			'on_success'    => function ( $user_id, $tokens, $service ) use ( &$received_user, &$received_tokens, &$received_service ) {
				$received_user    = $user_id;
				$received_tokens  = $tokens;
				$received_service = $service;
			},
		) );

		add_action( 'desktop_mode_oauth_relay_connected', static function ( $service, $user_id ) use ( &$action_calls ) {
			$action_calls[] = compact( 'service', 'user_id' );
		}, 10, 2 );

		// Issue a state ourselves, then exercise the callback.
		$state = desktop_mode_oauth_issue_state( self::$admin_id, 'tumblrlike' );

		add_filter( 'pre_http_request', static function ( $preempt, $args, $url ) {
			if ( false !== strpos( $url, 'api.example.com/oauth/token' ) ) {
				return array(
					'response' => array( 'code' => 200, 'message' => 'OK' ),
					'body'     => wp_json_encode( array(
						'access_token'  => 'tok-aaa',
						'refresh_token' => 'tok-rrr',
						'expires_in'    => 3600,
					) ),
					'headers'  => array(),
					'cookies'  => array(),
					'filename' => null,
				);
			}
			return $preempt;
		}, 10, 3 );

		$request = new WP_REST_Request( 'GET', '/desktop-mode/v1/oauth/callback' );
		$request->set_query_params( array( 'state' => $state, 'code' => 'auth-code' ) );
		$response = desktop_mode_rest_oauth_callback( $request );

		$this->assertInstanceOf( 'WP_REST_Response', $response );
		$body = (string) $response->get_data();
		$this->assertStringContainsString( '"ok":true', $body );

		$this->assertSame( self::$admin_id, $received_user );
		$this->assertSame( 'tumblrlike', $received_service );
		$this->assertIsArray( $received_tokens );
		$this->assertSame( 'tok-aaa', $received_tokens['access_token'] );

		$this->assertCount( 1, $action_calls );
		$this->assertSame( 'tumblrlike', $action_calls[0]['service'] );
	}

	/**
	 * @covers ::desktop_mode_rest_oauth_callback
	 */
	public function test_rest_callback_token_exchange_failure_does_not_fire_on_success() {
		$success_count = 0;
		desktop_mode_register_oauth_relay( 'tumblrlike', array(
			'authorize_url' => 'https://example.com/oauth/authorize',
			'token_url'     => 'https://api.example.com/oauth/token',
			'client_id'     => 'cid',
			'client_secret' => 'csecret',
			'on_success'    => static function () use ( &$success_count ) {
				$success_count++;
			},
		) );

		$state = desktop_mode_oauth_issue_state( self::$admin_id, 'tumblrlike' );

		add_filter( 'pre_http_request', static function () {
			return array(
				'response' => array( 'code' => 401, 'message' => 'Unauthorized' ),
				'body'     => '{"error":"invalid_grant"}',
				'headers'  => array(),
				'cookies'  => array(),
				'filename' => null,
			);
		} );

		$request = new WP_REST_Request( 'GET', '/desktop-mode/v1/oauth/callback' );
		$request->set_query_params( array( 'state' => $state, 'code' => 'auth-code' ) );
		$response = desktop_mode_rest_oauth_callback( $request );

		$body = (string) $response->get_data();
		$this->assertStringContainsString( 'token_exchange_failed', $body );
		$this->assertSame( 0, $success_count );
	}

	/**
	 * Regression for the 0.8.2 bug where the popup HTML was JSON-
	 * encoded by `WP_REST_Server::serve_request()` and the script
	 * inside it never executed (popup never closed).
	 *
	 * The fix registers a `rest_pre_serve_request` filter that
	 * echoes the raw HTML and short-circuits JSON serialization.
	 * This test exercises that filter directly: assert that for the
	 * `/desktop-mode/v1/oauth/callback` route the filter:
	 *
	 *   - returns `true` (signal to REST server: "I served it")
	 *   - emits a body that starts with `<!doctype`, NOT `"`
	 *   - includes the postMessage payload literally (not JSON-escaped)
	 *
	 * If the filter ever regresses to data-as-JSON, this test fails.
	 *
	 * @covers ::desktop_mode_oauth_render_callback_html
	 */
	public function test_render_callback_html_echoes_raw_html_not_json_encoded() {
		$response = desktop_mode_oauth_render_callback_html( array(
			'ok'      => true,
			'service' => 'tumblrlike',
		) );
		$this->assertInstanceOf( 'WP_REST_Response', $response );

		$request = new WP_REST_Request( 'GET', '/desktop-mode/v1/oauth/callback' );
		// Core's `_oembed_rest_pre_serve_request` is registered on
		// this filter and signature-requires 4 args; pass the REST
		// server as the 4th so the chain runs cleanly through every
		// registered callback.
		$server = rest_get_server();

		ob_start();
		$served = apply_filters( 'rest_pre_serve_request', false, $response, $request, $server );
		$body = ob_get_clean();

		$this->assertTrue( $served, 'Filter must signal it served the response.' );
		$this->assertStringStartsWith(
			'<!doctype',
			$body,
			'Body must be raw HTML, not a JSON-encoded string starting with `"`.'
		);
		$this->assertStringContainsString( 'desktop-mode-oauth-callback', $body );
		$this->assertStringContainsString( 'window.opener.postMessage', $body );

		// Payload is embedded as a real JS literal — `"ok":true`,
		// NOT the HTML-entity-encoded `&quot;ok&quot;:true` shape
		// that `esc_js` produces. Inside a `<script>` element HTML
		// entities are NOT decoded by the JS engine, so the entity
		// form would throw a syntax error and the popup would never
		// post-message its opener. Pin both directions:
		$this->assertStringContainsString(
			'"ok":true',
			$body,
			'Payload must be a real JS literal, not HTML-entity-encoded.'
		);
		$this->assertStringNotContainsString(
			'&quot;',
			$body,
			'Body must not HTML-entity-encode quotes inside the script block.'
		);
	}

	/**
	 * The filter is route-scoped — a request to a different REST
	 * endpoint must NOT trigger the OAuth HTML echo. This guards
	 * against a misconfigured filter clobbering every REST response
	 * on the site.
	 *
	 * @covers ::desktop_mode_oauth_render_callback_html
	 */
	public function test_render_callback_html_filter_is_route_scoped() {
		desktop_mode_oauth_render_callback_html( array(
			'ok'      => true,
			'service' => 'tumblrlike',
		) );

		// Different route — filter must pass through cleanly without echoing.
		$request = new WP_REST_Request( 'GET', '/wp/v2/posts' );
		$server  = rest_get_server();

		ob_start();
		$served = apply_filters( 'rest_pre_serve_request', false, null, $request, $server );
		$body = ob_get_clean();

		$this->assertFalse( $served, 'Filter must not claim to serve unrelated REST routes.' );
		$this->assertSame( '', $body, 'Filter must not echo for unrelated REST routes.' );
	}

	/**
	 * The filter self-removes after firing so a subsequent REST
	 * request to the same route doesn't replay the previous
	 * request's payload (the closure captures `$html` per call).
	 *
	 * Asserted by behaviour, not by `has_filter` count — core's
	 * `_oembed_rest_pre_serve_request` is permanently registered on
	 * this hook, so a count-based check would always be true. The
	 * right shape: fire twice, assert only the first fire echoes
	 * our payload.
	 *
	 * @covers ::desktop_mode_oauth_render_callback_html
	 */
	public function test_render_callback_html_filter_self_removes_after_firing() {
		desktop_mode_oauth_render_callback_html( array( 'ok' => true, 'service' => 'a' ) );
		$request = new WP_REST_Request( 'GET', '/desktop-mode/v1/oauth/callback' );
		$server  = rest_get_server();

		ob_start();
		$served_first = apply_filters( 'rest_pre_serve_request', false, null, $request, $server );
		$body_first = ob_get_clean();
		$this->assertTrue( $served_first );
		$this->assertStringContainsString( '<!doctype', $body_first );

		// Second fire of the same hook with the same request must
		// NOT re-echo our HTML — the filter detached itself after
		// the first fire.
		ob_start();
		$served_second = apply_filters( 'rest_pre_serve_request', false, null, $request, $server );
		$body_second = ob_get_clean();
		$this->assertFalse(
			$served_second,
			'Filter must not re-serve after self-removal.'
		);
		$this->assertStringNotContainsString(
			'<!doctype',
			$body_second,
			'Filter must not re-echo HTML after self-removal — the closure would otherwise replay a stale payload.'
		);
	}

	/**
	 * @covers ::desktop_mode_rest_oauth_callback
	 */
	public function test_rest_callback_handles_authorize_denied_query_param() {
		desktop_mode_register_oauth_relay( 'tumblrlike', array(
			'authorize_url' => 'https://example.com/oauth/authorize',
			'token_url'     => 'https://api.example.com/oauth/token',
			'client_id'     => 'cid',
			'client_secret' => 'csecret',
			'on_success'    => static function () {},
		) );

		$state = desktop_mode_oauth_issue_state( self::$admin_id, 'tumblrlike' );

		$request = new WP_REST_Request( 'GET', '/desktop-mode/v1/oauth/callback' );
		$request->set_query_params( array(
			'state' => $state,
			'error' => 'access_denied',
		) );
		$response = desktop_mode_rest_oauth_callback( $request );

		$body = (string) $response->get_data();
		$this->assertStringContainsString( 'authorize_denied', $body );
	}
}
