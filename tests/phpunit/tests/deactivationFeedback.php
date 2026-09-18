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

		$response = $this->post( array( 'reasons' => array( 'other' ) ) );

		$this->assertSame( 403, $response->get_status() );
		$this->assertSame( 0, $this->forward_calls );
	}

	public function test_admin_submission_forwards_exactly_the_documented_payload() {
		wp_set_current_user( self::$admin_id );

		$response = $this->post(
			array(
				'reasons' => array( 'other', 'too_buggy', 'too_buggy' ),
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
				'reasons',
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
		// Deduplicated, in the dialog's order.
		$this->assertSame( array( 'too_buggy', 'other' ), $payload['reasons'] );
		$this->assertSame( 1000, strlen( $payload['details'] ) );
		$this->assertSame( 'app', $payload['context'] );
		$this->assertSame( OPENSTATION_VERSION, $payload['plugin_version'] );
		$this->assertMatchesRegularExpression( '/^\d+\.\d+$/', $payload['php_version'] );
		// No first-run stamps on this site: unknown, never a guess.
		$this->assertNull( $payload['install_age_days'] );
		$this->assertNull( $payload['first_enable_delay_days'] );
		$this->assertIsInt( $payload['active_plugins'] );

		// Anonymous: nothing about the site or the person.
		$encoded = wp_json_encode( $payload );
		$this->assertStringNotContainsString( home_url(), $encoded );
		$this->assertStringNotContainsString( wp_get_current_user()->user_email, $encoded );
		$this->assertStringNotContainsString( wp_get_current_user()->user_login, $encoded );
	}

	/**
	 * A real (`activation`) pair of first-run stamps gives the two day
	 * counts; a backfilled one is an unknown age, not a number.
	 */
	public function test_first_run_stamps_give_the_day_counts() {
		wp_set_current_user( self::$admin_id );
		$now = time();
		update_option(
			OPENSTATION_INSTALLED_AT_OPTION,
			array(
				'at'  => $now - 10 * DAY_IN_SECONDS,
				'via' => 'activation',
			)
		);
		update_option(
			OPENSTATION_FIRST_ENABLED_AT_OPTION,
			array(
				'at'  => $now - 7 * DAY_IN_SECONDS,
				'via' => 'activation',
			)
		);

		$this->post( array( 'reasons' => array( 'other' ) ) );
		$this->assertSame( 10, $this->forwarded['install_age_days'] );
		$this->assertSame( 3, $this->forwarded['first_enable_delay_days'] );

		openstation_backfill_install_stamp();
		$this->assertSame( 'activation', openstation_get_install_stamp()['via'], 'A backfill never overwrites a real stamp.' );

		update_option(
			OPENSTATION_INSTALLED_AT_OPTION,
			array(
				'at'  => $now - 10 * DAY_IN_SECONDS,
				'via' => 'backfill',
			)
		);
		$this->post( array( 'reasons' => array( 'other' ) ) );
		$this->assertNull( $this->forwarded['install_age_days'] );
		$this->assertNull( $this->forwarded['first_enable_delay_days'] );

		delete_option( OPENSTATION_INSTALLED_AT_OPTION );
		delete_option( OPENSTATION_FIRST_ENABLED_AT_OPTION );
	}

	/**
	 * Network activation leaves a plugin in a site's own list, so the
	 * count must not add it twice.
	 */
	public function test_active_plugin_count_does_not_double_count_on_a_network() {
		if ( ! is_multisite() ) {
			$this->markTestSkipped( 'Multisite only.' );
		}
		$site    = (array) get_option( 'active_plugins', array() );
		$network = (array) get_site_option( 'active_sitewide_plugins', array() );
		update_option( 'active_plugins', array_values( array_unique( array_merge( $site, array( 'dupe/dupe.php', 'site-only/site-only.php' ) ) ) ) );
		update_site_option( 'active_sitewide_plugins', $network + array( 'dupe/dupe.php' => time() ) );

		$expected = count( array_unique( array_merge( get_option( 'active_plugins' ), array_keys( get_site_option( 'active_sitewide_plugins' ) ) ) ) );
		$payload  = openstation_deactivation_feedback_payload( array( 'other' ) );
		$this->assertSame( $expected, $payload['active_plugins'] );
		$this->assertSame( count( get_option( 'active_plugins' ) ) + count( get_site_option( 'active_sitewide_plugins' ) ) - 1, $payload['active_plugins'] );

		update_option( 'active_plugins', $site );
		update_site_option( 'active_sitewide_plugins', $network );
	}

	public function test_empty_filtered_payload_suppresses_the_forward() {
		wp_set_current_user( self::$admin_id );
		add_filter( 'openstation_deactivation_feedback_payload', '__return_empty_array' );

		$response = $this->post( array( 'reasons' => array( 'missing_features' ) ) );

		$this->assertSame( 200, $response->get_status() );
		$this->assertFalse( $response->get_data()['sent'] );
		$this->assertSame( 0, $this->forward_calls );
	}

	public function test_feature_flag_off_closes_the_route() {
		wp_set_current_user( self::$admin_id );
		add_filter( 'openstation_deactivation_feedback_enabled', '__return_false' );

		$response = $this->post( array( 'reasons' => array( 'other' ) ) );

		$this->assertSame( 403, $response->get_status() );
		$this->assertSame( 0, $this->forward_calls );
	}

	public function test_unknown_reason_is_rejected_by_the_schema() {
		wp_set_current_user( self::$admin_id );

		$response = $this->post( array( 'reasons' => array( 'too_slow' ) ) );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 0, $this->forward_calls );
	}
}
