<?php
/**
 * Tests for the deactivation feedback route.
 *
 * Guards the gate (not the usual `openstation_rest_require_enabled()`:
 * the person deactivating usually has OpenStation off), the anonymity
 * promise in `readme.txt` (exactly the documented keys, nothing that
 * identifies the site or the user), and the host opt-out.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-feedback
 */
class Tests_OpenStation_DeactivationFeedback extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $subscriber_id;

	/** What the last stubbed forward received, decoded. */
	private $forwarded = null;

	/** How many forwards the stub saw. */
	private $forward_calls = 0;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id      = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$subscriber_id = $factory->user->create( array( 'role' => 'subscriber' ) );
		if ( is_multisite() ) {
			grant_super_admin( self::$admin_id );
		}
	}

	public function set_up() {
		parent::set_up();
		remove_all_filters( 'pre_http_request' );
		remove_all_filters( 'openstation_deactivation_feedback_payload' );
		remove_all_filters( 'openstation_deactivation_feedback_enabled' );
		$this->forwarded     = null;
		$this->forward_calls = 0;
		add_filter( 'pre_http_request', array( $this, 'stub_forward' ), 10, 3 );
	}

	public function tear_down() {
		remove_all_filters( 'pre_http_request' );
		remove_all_filters( 'openstation_deactivation_feedback_payload' );
		remove_all_filters( 'openstation_deactivation_feedback_enabled' );
		parent::tear_down();
	}

	/** Capture the forward instead of hitting the network. */
	public function stub_forward( $preempt, $args, $url ) {
		if ( false === strpos( $url, '/deactivation' ) ) {
			return $preempt;
		}
		$this->forward_calls++;
		$this->forwarded = json_decode( $args['body'], true );
		return array(
			'response' => array(
				'code'    => 200,
				'message' => 'OK',
			),
			'body'     => '',
			'headers'  => array(),
			'cookies'  => array(),
		);
	}

	private function post( array $params ) {
		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/feedback/deactivation' );
		foreach ( $params as $key => $value ) {
			$request->set_param( $key, $value );
		}
		return rest_do_request( $request );
	}

	public function test_subscriber_is_refused_and_nothing_is_forwarded() {
		wp_set_current_user( self::$subscriber_id );

		$response = $this->post( array( 'reason' => 'other' ) );

		$this->assertSame( 403, $response->get_status() );
		$this->assertSame( 0, $this->forward_calls );
	}

	public function test_admin_submission_forwards_exactly_the_documented_payload() {
		wp_set_current_user( self::$admin_id );

		$response = $this->post(
			array(
				'reason'  => 'broke_something',
				'details' => str_repeat( 'x', 1200 ),
				'context' => 'app',
			)
		);

		$this->assertSame( 200, $response->get_status() );
		$this->assertTrue( $response->get_data()['sent'] );
		$this->assertSame( 1, $this->forward_calls );

		$payload = $this->forwarded;
		$this->assertSame(
			array(
				'id',
				'reason',
				'details',
				'plugin_version',
				'wp_version',
				'php_version',
				'locale',
				'multisite',
				'install_age_days',
				'ever_enabled',
				'enabled_user_count',
				'first_enable_delay_days',
				'deactivator_enabled',
				'active_plugins',
				'context',
			),
			array_keys( $payload )
		);
		$this->assertSame( 'broke_something', $payload['reason'] );
		$this->assertSame( 1000, strlen( $payload['details'] ) );
		$this->assertSame( 'app', $payload['context'] );
		$this->assertSame( OPENSTATION_VERSION, $payload['plugin_version'] );
		$this->assertMatchesRegularExpression( '/^\d+\.\d+$/', $payload['php_version'] );
		$this->assertNull( $payload['install_age_days'] );
		$this->assertIsInt( $payload['active_plugins'] );

		// Anonymous: nothing about the site or the person.
		$encoded = wp_json_encode( $payload );
		$this->assertStringNotContainsString( home_url(), $encoded );
		$this->assertStringNotContainsString( wp_get_current_user()->user_email, $encoded );
		$this->assertStringNotContainsString( wp_get_current_user()->user_login, $encoded );
	}

	public function test_empty_filtered_payload_suppresses_the_forward() {
		wp_set_current_user( self::$admin_id );
		add_filter( 'openstation_deactivation_feedback_payload', '__return_empty_array' );

		$response = $this->post( array( 'reason' => 'not_for_me' ) );

		$this->assertSame( 200, $response->get_status() );
		$this->assertFalse( $response->get_data()['sent'] );
		$this->assertSame( 0, $this->forward_calls );
	}

	public function test_feature_flag_off_closes_the_route() {
		wp_set_current_user( self::$admin_id );
		add_filter( 'openstation_deactivation_feedback_enabled', '__return_false' );

		$response = $this->post( array( 'reason' => 'other' ) );

		$this->assertSame( 403, $response->get_status() );
		$this->assertSame( 0, $this->forward_calls );
	}
}
