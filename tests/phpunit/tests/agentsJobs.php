<?php

class Tests_OpenStation_AgentsJobs extends WP_UnitTestCase {
	private $owner;
	private $agent;
	private $calls;

	public function set_up() {
		parent::set_up();
		$this->owner = self::factory()->user->create( array( 'role' => 'editor' ) );
		 $admin = self::factory()->user->create( array( 'role' => 'administrator' ) );
		if ( is_multisite() ) { grant_super_admin( $admin ); }
		wp_set_current_user( $admin );
		$this->agent = openstation_agent_create( array( 'name' => 'Async test', 'role' => 'author', 'instructions' => 'Answer.', 'abilities' => array() ) );
		$this->assertNotWPError( $this->agent );
		wp_set_current_user( $this->owner );
		$this->calls = 0;
		add_filter( 'pre_http_request', '__return_true' );
		add_filter( 'openstation_agent_runner_generate', array( $this, 'generate' ) );
	}

	public function generate() {
		++$this->calls;
		$this->assertSame( $this->agent->ID, get_current_user_id() );
		return array( 'text' => 'Finished async.', 'function_calls' => array(), 'message' => null );
	}

	private function submit( $id = null, $message = 'Do the task.' ) {
		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/agents/' . $this->agent->ID . '/invoke' );
		$request->set_body_params( array( 'async' => true, 'requestId' => $id ? $id : wp_generate_uuid4(), 'message' => $message ) );
		return rest_get_server()->dispatch( $request );
	}

	private function poll( $id, $agent_id = null ) {
		return rest_get_server()->dispatch( new WP_REST_Request( 'GET', '/desktop-mode/v1/agents/' . ( $agent_id ? $agent_id : $this->agent->ID ) . '/jobs/' . $id ) );
	}

	public function test_submission_and_poll_are_short_and_do_not_generate() {
		$response = $this->submit();
		$this->assertSame( 202, $response->get_status() );
		$job = $response->get_data();
		$this->assertSame( 'queued', $job['status'] );
		$this->assertSame( 0, $this->calls );
		$this->assertNotFalse( wp_next_scheduled( 'openstation_agent_job_run', array( $job['jobId'] ) ) );
		$status = $this->poll( $job['jobId'] );
		$this->assertSame( 'queued', $status->get_data()['status'] );
		$this->assertSame( 'no-store, private', $status->get_headers()['Cache-Control'] );
		$this->assertArrayNotHasKey( 'history', $status->get_data() );
		$this->assertArrayNotHasKey( 'message', $status->get_data() );
		$this->assertSame( 0, $this->calls );
		wp_set_current_user( 0 );
		openstation_agent_job_run( $job['jobId'] );
		$this->assertSame( 0, get_current_user_id() );
		wp_set_current_user( $this->owner );
		$status = $this->poll( $job['jobId'] )->get_data();
		$this->assertSame( 'completed', $status['status'] );
		$this->assertSame( 'Finished async.', $status['result']['text'] );
		openstation_agent_job_run( $job['jobId'] );
		$this->assertSame( 1, $this->calls );
	}

	public function test_idempotency_conflicts_and_queue_bound() {
		$id = wp_generate_uuid4();
		$this->assertSame( 202, $this->submit( $id )->get_status() );
		$this->assertSame( $id, $this->submit( $id )->get_data()['jobId'] );
		$this->assertSame( 409, $this->submit( $id, 'Different task.' )->get_status() );
		$this->assertSame( 409, $this->submit()->get_status() );
		openstation_agent_job_run( $id );
		$this->assertSame( 'completed', $this->submit( $id )->get_data()['status'] );
		$this->assertSame( 202, $this->submit()->get_status() );
		$this->assertSame( 1, $this->calls );
	}

	public function test_status_is_owner_and_agent_scoped_even_for_admins() {
		$id = $this->submit()->get_data()['jobId'];
		$this->assertSame( 404, $this->poll( $id, 999999 )->get_status() );
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
		$this->assertSame( 404, $this->poll( $id )->get_status() );
		wp_set_current_user( 0 );
		$this->assertSame( 401, $this->poll( $id )->get_status() );
		$this->assertSame( 401, $this->submit()->get_status() );
	}

	public function test_worker_rechecks_invoker_permissions() {
		$id = $this->submit()->get_data()['jobId'];
		$owner = get_user_by( 'id', $this->owner );
		$owner->set_role( 'subscriber' );
		wp_set_current_user( 0 );
		openstation_agent_job_run( $id );
		$this->assertSame( 'failed', openstation_agent_job_get( $id )['status'] );
		$this->assertSame( 'openstation_agents_forbidden', openstation_agent_job_get( $id )['error']['code'] );
		$this->assertSame( 0, $this->calls );
		$this->assertSame( 0, get_current_user_id() );
	}

	public function test_background_invocation_keeps_the_humans_capability_ceiling() {
		$owner = get_user_by( 'id', $this->owner );
		$owner->set_role( 'contributor' );
		wp_set_current_user( 0 );
		wp_set_current_user( $this->owner );
		$id = $this->submit()->get_data()['jobId'];
		$can_publish = null;
		add_filter( 'openstation_agent_runner_generate', static function ( $result ) use ( &$can_publish ) {
			$can_publish = current_user_can( 'publish_posts' );
			return $result;
		}, 20 );
		wp_set_current_user( 0 );
		openstation_agent_job_run( $id );
		$this->assertFalse( $can_publish );
		$this->assertSame( 0, get_current_user_id() );
		$this->assertSame( 'completed', openstation_agent_job_get( $id )['status'] );
	}

	public function test_disabling_agents_fails_queued_work_but_keeps_cleanup_available() {
		$id = $this->submit()->get_data()['jobId'];
		add_filter( 'openstation_agents_enabled', '__return_false', 100 );
		openstation_agent_job_run( $id );
		$this->assertSame( 'failed', openstation_agent_job_get( $id )['status'] );
		$this->assertSame( 0, $this->calls );
		do_action( 'openstation_agent_job_cleanup', $id );
		$this->assertNull( openstation_agent_job_get( $id ) );
	}

	public function test_claim_cannot_be_overwritten_or_replayed_with_stale_cache() {
		$id = $this->submit()->get_data()['jobId'];
		$key = 'openstation_agent_job_claim_' . $id;
		$this->assertTrue( openstation_agent_job_insert( $key, 1 ) );
		wp_cache_delete( $key, 'options' );
		wp_cache_set( 'notoptions', array( $key => true ), 'options' );
		$this->assertFalse( openstation_agent_job_insert( $key, 2 ) );
		$this->assertSame( '1', (string) get_option( $key ) );
		openstation_agent_job_run( $id );
		$this->assertSame( 0, $this->calls );
	}

	public function test_worker_errors_are_persisted_without_replaying() {
		$id = $this->submit()->get_data()['jobId'];
		add_filter( 'openstation_agent_runner_generate', static function () { throw new RuntimeException( 'private stack detail' ); }, 20 );
		openstation_agent_job_run( $id );
		$job = $this->poll( $id )->get_data();
		$this->assertSame( 'failed', $job['status'] );
		$this->assertStringNotContainsString( 'private stack detail', $job['error']['message'] );
		$this->assertSame( $this->owner, get_current_user_id() );
		openstation_agent_job_run( $id );
		$this->assertSame( 1, $this->calls );
	}

	public function test_expiry_and_cleanup_do_not_execute_or_release_a_newer_slot() {
		$id = $this->submit()->get_data()['jobId'];
		$job = openstation_agent_job_get( $id );
		$job['deadline'] = time() - 1;
		update_option( 'openstation_agent_job_' . $id, $job, false );
		$this->assertSame( 'failed', $this->poll( $id )->get_data()['status'] );
		openstation_agent_job_run( $id );
		$this->assertSame( 0, $this->calls );
		$slot = 'openstation_agent_job_active_' . $this->owner . '_' . $this->agent->ID;
		update_option( $slot, 'another-job', false );
		openstation_agent_job_cleanup( $id );
		$this->assertNull( openstation_agent_job_get( $id ) );
		$this->assertFalse( get_option( 'openstation_agent_job_claim_' . $id ) );
		$this->assertSame( 'another-job', get_option( $slot ) );
	}

	public function test_invalid_requests_and_failed_scheduling_never_execute() {
		$this->assertSame( 400, $this->submit( 'invalid' )->get_status() );
		$this->assertSame( 400, $this->submit( null, '   ' )->get_status() );
		add_filter( 'pre_schedule_event', '__return_false' );
		$id = wp_generate_uuid4();
		$this->assertSame( 503, $this->submit( $id )->get_status() );
		$this->assertNull( openstation_agent_job_get( $id ) );
		openstation_agent_job_run( $id );
		$this->assertSame( 0, $this->calls );
	}
}
