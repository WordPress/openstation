<?php
/**
 * Tests for usage feedback: the eligibility gate that decides who is
 * asked, the consent promise in `readme.txt` (exactly the documented
 * keys, an email only when one was typed, nothing that identifies the
 * site), the once-only rule, and the host opt-out.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-feedback
 */
class Tests_OpenStation_UsageFeedback extends WP_UnitTestCase {

	protected static $user_id;

	/** What the last stubbed forward received, decoded. */
	private $forwarded = null;

	/** How many forwards the stub saw. */
	private $forward_calls = 0;

	/** What the stub answers. */
	private $forward_status = 201;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$user_id = $factory->user->create(
			array(
				'role'       => 'editor',
				'user_email' => 'editor@example.test',
			)
		);
	}

	public function set_up() {
		parent::set_up();
		remove_all_filters( 'pre_http_request' );
		remove_all_filters( 'openstation_usage_feedback_payload' );
		remove_all_filters( 'openstation_usage_feedback_enabled' );
		$this->forwarded      = null;
		$this->forward_calls  = 0;
		$this->forward_status = 201;
		add_filter( 'pre_http_request', array( $this, 'stub_forward' ), 10, 3 );

		update_user_meta( self::$user_id, 'desktop_mode_mode', '1' );
		delete_user_meta( self::$user_id, OPENSTATION_ENABLED_AT_META_KEY );
		delete_user_meta( self::$user_id, OPENSTATION_SEEN_INTROS_META_KEY );
	}

	public function tear_down() {
		remove_all_filters( 'pre_http_request' );
		remove_all_filters( 'openstation_usage_feedback_payload' );
		remove_all_filters( 'openstation_usage_feedback_enabled' );
		delete_user_meta( self::$user_id, 'desktop_mode_mode' );
		parent::tear_down();
	}

	/** Capture the forward instead of hitting the network. */
	public function stub_forward( $preempt, $args, $url ) {
		if ( false === strpos( $url, '/openstation-feedback/v1/usage' ) ) {
			return $preempt;
		}
		$this->forward_calls++;
		$this->forwarded = json_decode( $args['body'], true );
		return array(
			'response' => array(
				'code'    => $this->forward_status,
				'message' => 'OK',
			),
			'body'     => '',
			'headers'  => array(),
			'cookies'  => array(),
		);
	}

	/** Pretend the user turned OpenStation on `$days` days ago. */
	private function enabled_days_ago( $days ) {
		update_user_meta( self::$user_id, OPENSTATION_ENABLED_AT_META_KEY, time() - $days * DAY_IN_SECONDS );
	}

	private function post( array $params ) {
		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/feedback/usage' );
		foreach ( $params as $key => $value ) {
			$request->set_param( $key, $value );
		}
		return rest_do_request( $request );
	}

	public function test_a_user_is_asked_after_the_threshold_and_never_before() {
		wp_set_current_user( self::$user_id );

		// No stamp: they enabled before it existed, no moment to count from.
		$this->assertNull( openstation_usage_feedback_config() );

		$this->enabled_days_ago( OPENSTATION_USAGE_FEEDBACK_MIN_DAYS - 1 );
		$this->assertNull( openstation_usage_feedback_config() );

		$this->enabled_days_ago( OPENSTATION_USAGE_FEEDBACK_MIN_DAYS );
		$config = openstation_usage_feedback_config();

		// The route, and nothing about the user: the email field starts empty.
		$this->assertSame( array( 'restUrl' ), array_keys( $config ) );
		$this->assertStringContainsString( '/desktop-mode/v1/feedback/usage', $config['restUrl'] );
	}

	public function test_a_user_who_answered_or_dismissed_is_not_asked_again() {
		wp_set_current_user( self::$user_id );
		$this->enabled_days_ago( 30 );
		openstation_mark_intro_seen( self::$user_id, OPENSTATION_USAGE_FEEDBACK_INTRO_SLUG );

		$this->assertNull( openstation_usage_feedback_config() );
	}

	public function test_a_user_with_openstation_off_is_not_asked() {
		wp_set_current_user( self::$user_id );
		$this->enabled_days_ago( 30 );
		delete_user_meta( self::$user_id, 'desktop_mode_mode' );

		$this->assertNull( openstation_usage_feedback_config() );
	}

	public function test_anonymous_submission_forwards_exactly_the_documented_payload_and_marks_the_intro_seen() {
		wp_set_current_user( self::$user_id );
		$this->enabled_days_ago( 10 );

		$response = $this->post(
			array(
				'use_case' => 'Editing posts side by side.',
				'blockers' => "Slow on my laptop.\n<script>alert(1)</script>",
			)
		);

		$this->assertSame( 200, $response->get_status() );
		$this->assertTrue( $response->get_data()['sent'] );
		$this->assertSame( 1, $this->forward_calls );

		// The disclosure in readme.txt is the contract: these keys, no more.
		$this->assertSame(
			array( 'id', 'requests', 'use_case', 'blockers', 'email', 'plugin_version', 'wp_version', 'locale', 'days_enabled' ),
			array_keys( $this->forwarded )
		);
		$this->assertSame( 'Editing posts side by side.', $this->forwarded['use_case'] );
		$this->assertSame( '', $this->forwarded['requests'] );
		$this->assertStringNotContainsString( '<script>', $this->forwarded['blockers'] );
		$this->assertSame( 10, $this->forwarded['days_enabled'] );
		$this->assertMatchesRegularExpression( '/^[0-9a-f-]{36}$/', $this->forwarded['id'] );

		// No email was typed, so none travels: not even the account's.
		$this->assertSame( '', $this->forwarded['email'] );
		$encoded = wp_json_encode( $this->forwarded );
		$this->assertStringNotContainsString( 'editor@example.test', $encoded );
		$this->assertStringNotContainsString( home_url(), $encoded );

		$this->assertTrue( openstation_has_seen_intro( self::$user_id, OPENSTATION_USAGE_FEEDBACK_INTRO_SLUG ) );
		$this->assertNull( openstation_usage_feedback_config() );
	}

	public function test_a_typed_email_is_forwarded() {
		wp_set_current_user( self::$user_id );
		$this->enabled_days_ago( 10 );

		$response = $this->post(
			array(
				'requests' => 'A better dock.',
				'email'    => 'reach-me@example.test',
			)
		);

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'reach-me@example.test', $this->forwarded['email'] );
	}

	public function test_long_answers_are_capped() {
		wp_set_current_user( self::$user_id );
		$this->enabled_days_ago( 10 );

		$this->post( array( 'requests' => str_repeat( 'a', OPENSTATION_USAGE_FEEDBACK_ANSWER_MAX + 50 ) ) );

		$this->assertSame( OPENSTATION_USAGE_FEEDBACK_ANSWER_MAX, mb_strlen( $this->forwarded['requests'] ) );
	}

	public function test_an_empty_form_is_refused_before_the_forward() {
		wp_set_current_user( self::$user_id );
		$this->enabled_days_ago( 10 );

		$response = $this->post(
			array(
				'requests' => "  \n ",
				'email'    => 'reach-me@example.test',
			)
		);

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 0, $this->forward_calls );
	}

	public function test_a_malformed_address_is_refused_before_the_forward() {
		wp_set_current_user( self::$user_id );
		$this->enabled_days_ago( 10 );

		$response = $this->post(
			array(
				'requests' => 'A better dock.',
				'email'    => 'not an address',
			)
		);

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 0, $this->forward_calls );
	}

	public function test_a_failed_forward_reports_and_leaves_the_prompt_open() {
		wp_set_current_user( self::$user_id );
		$this->enabled_days_ago( 10 );
		$this->forward_status = 500;

		$response = $this->post( array( 'requests' => 'A better dock.' ) );

		$this->assertSame( 502, $response->get_status() );
		$this->assertFalse( openstation_has_seen_intro( self::$user_id, OPENSTATION_USAGE_FEEDBACK_INTRO_SLUG ) );
	}

	public function test_empty_filtered_payload_suppresses_the_forward() {
		wp_set_current_user( self::$user_id );
		$this->enabled_days_ago( 10 );
		add_filter( 'openstation_usage_feedback_payload', '__return_empty_array' );

		$response = $this->post( array( 'requests' => 'A better dock.' ) );

		$this->assertSame( 502, $response->get_status() );
		$this->assertSame( 0, $this->forward_calls );
	}

	public function test_openstation_off_closes_the_route() {
		wp_set_current_user( self::$user_id );
		delete_user_meta( self::$user_id, 'desktop_mode_mode' );

		$response = $this->post( array( 'requests' => 'A better dock.' ) );

		$this->assertSame( 403, $response->get_status() );
		$this->assertSame( 0, $this->forward_calls );
	}

	public function test_feature_flag_off_closes_the_route_and_the_config() {
		wp_set_current_user( self::$user_id );
		$this->enabled_days_ago( 30 );
		add_filter( 'openstation_usage_feedback_enabled', '__return_false' );

		$this->assertNull( openstation_usage_feedback_config() );

		$response = $this->post( array( 'requests' => 'A better dock.' ) );
		$this->assertSame( 403, $response->get_status() );
		$this->assertSame( 0, $this->forward_calls );
	}
}
