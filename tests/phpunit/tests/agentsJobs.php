<?php
/**
 * Durable agent job regression tests.
 *
 * @package OpenStation
 * @group openstation
 * @group os-agents
 * @covers ::openstation_agents_rest_enqueue_job
 * @covers ::openstation_agents_rest_job
 * @covers ::openstation_agent_job_run
 * @covers ::openstation_agent_job_status
 * @covers ::openstation_agent_job_is_stale
 * @covers ::openstation_agent_job_stale_bound
 * @covers ::openstation_agent_job_insert
 * @covers ::openstation_agent_job_release
 * @covers ::openstation_agent_job_finish
 * @covers ::openstation_agent_job_cleanup
 * @covers ::openstation_agents_register_job_routes
 * @covers ::openstation_agent_runner_loop
 */
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

	/**
	 * Make the stubbed model call one tool per round for $rounds rounds, then
	 * answer with $final (the default answer when null). $observe sees every turn;
	 * $spend (`{ usage, model }`) is reported with every tool round.
	 */
	private function call_tools( $rounds, $final = null, $observe = null, $spend = array() ) {
		add_filter( 'openstation_agent_runner_generate', static function ( $result, $history ) use ( $rounds, $final, $observe, $spend ) {
			if ( $observe ) {
				$observe();
			}
			$done = count( wp_list_filter( $history, array( 'type' => 'tool_results' ) ) );
			if ( $done < $rounds ) {
				return array( 'text' => '', 'function_calls' => array( array( 'call_id' => 'call-' . $done, 'name' => 'lookup', 'arguments' => array( 'round' => $done + 1 ) ) ), 'message' => null ) + $spend;
			}
			return null === $final ? $result : $final;
		}, 20, 2 );
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

	public function test_progress_is_written_after_each_tool_round_without_outputs() {
		$id    = $this->submit()->get_data()['jobId'];
		$agent = $this->agent->ID;
		$seen  = array();
		$this->call_tools( 2, null, static function () use ( $id, $agent, &$seen ) {
			$seen[] = openstation_agent_job_get( $id )['progress'] ?? null;
			// A nested or chained run in the same worker must not write into this job.
			$foreign = array(
				'turn'      => 9,
				'toolCalls' => array( array( 'callId' => 'x', 'name' => 'foreign', 'args' => array(), 'output' => 'secret', 'error' => null ) ),
			);
			do_action( 'openstation_agent_turn_completed', $agent + 1, $foreign, array( 'jobId' => $id ) );
			do_action( 'openstation_agent_turn_completed', $agent, $foreign, array( 'jobId' => wp_generate_uuid4() ) );
			do_action( 'openstation_agent_turn_completed', $agent, $foreign, array() );
		} );
		openstation_agent_job_run( $id );
		$this->assertSame( array( 'lookup', 'lookup' ), wp_list_pluck( openstation_agent_job_get( $id )['progress']['toolCalls'], 'name' ) );
		$this->assertNull( $seen[0] );
		$this->assertSame( 1, $seen[1]['turn'] );
		$this->assertCount( 1, $seen[1]['toolCalls'] );
		$this->assertSame( array( 'name', 'args', 'error' ), array_keys( $seen[1]['toolCalls'][0] ) );
		$this->assertSame( 'lookup', $seen[1]['toolCalls'][0]['name'] );
		$this->assertSame( array( 'round' => 1 ), $seen[1]['toolCalls'][0]['args'] );
		$this->assertNotEmpty( $seen[1]['toolCalls'][0]['error'] );
		$this->assertSame( 2, $seen[2]['turn'] );
		$this->assertSame( array( array( 'round' => 1 ), array( 'round' => 2 ) ), wp_list_pluck( $seen[2]['toolCalls'], 'args' ) );
		$this->assertGreaterThan( 0, $seen[2]['updatedAt'] );
		// A generator that reports no spend records none, never a zeroed count.
		$this->assertNull( $seen[2]['usage'] );
		$this->assertNull( $seen[2]['model'] );
		$status = $this->poll( $id )->get_data();
		$this->assertSame( 'completed', $status['status'] );
		$this->assertNull( $status['progress'] );
		$this->assertCount( 2, $status['result']['toolCalls'] );
		$this->assertArrayHasKey( 'output', $status['result']['toolCalls'][0] );
	}

	public function test_progress_carries_the_usage_so_far() {
		$id   = $this->submit()->get_data()['jobId'];
		$seen = array();
		$this->call_tools(
			2,
			null,
			static function () use ( $id, &$seen ) {
				$seen[] = openstation_agent_job_get( $id )['progress'] ?? null;
			},
			array(
				'usage' => array( 'prompt' => 10, 'completion' => 5, 'total' => 15, 'cached' => 7 ),
				'model' => array( 'id' => 'qa-model', 'name' => 'QA', 'provider' => 'private' ),
			)
		);
		openstation_agent_job_run( $id );
		$this->assertSame( array( 'prompt' => 10, 'completion' => 5, 'total' => 15 ), $seen[1]['usage'] );
		$this->assertSame( array( 'prompt' => 20, 'completion' => 10, 'total' => 30 ), $seen[2]['usage'] );
		$this->assertSame( array( 'id' => 'qa-model', 'name' => 'QA' ), $seen[2]['model'] );
		$status = $this->poll( $id )->get_data();
		$this->assertSame( 'completed', $status['status'] );
		$this->assertNull( $status['progress'] );
		$this->assertSame( array( 'prompt' => 20, 'completion' => 10, 'total' => 30 ), $status['result']['usage'] );
	}

	public function test_failed_and_interrupted_jobs_keep_progress_for_the_owner_only() {
		$id = $this->submit()->get_data()['jobId'];
		$this->call_tools(
			1,
			new WP_Error( 'qa_fail', 'QA forced failure' ),
			null,
			array(
				'usage' => array( 'prompt' => 10, 'completion' => 5, 'total' => 15 ),
				'model' => array( 'id' => 'qa-model', 'name' => 'QA' ),
			)
		);
		openstation_agent_job_run( $id );
		$status = $this->poll( $id )->get_data();
		$this->assertSame( 'failed', $status['status'] );
		$this->assertSame( 'QA forced failure', $status['error']['message'] );
		$this->assertSame( 1, $status['progress']['turn'] );
		$this->assertSame( array( 'lookup' ), wp_list_pluck( $status['progress']['toolCalls'], 'name' ) );
		$this->assertSame( array( 'prompt' => 10, 'completion' => 5, 'total' => 15 ), $status['progress']['usage'] );
		$this->assertSame( array( 'id' => 'qa-model', 'name' => 'QA' ), $status['progress']['model'] );

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
		$response = $this->poll( $id );
		$this->assertSame( 404, $response->get_status() );
		$this->assertArrayNotHasKey( 'progress', $response->get_data() );
		wp_set_current_user( $this->owner );

		$stale             = openstation_agent_job_get( $this->submit()->get_data()['jobId'] );
		$stale['status']   = 'running';
		$stale['deadline'] = time() - 1;
		$stale['progress'] = $status['progress'];
		update_option( 'openstation_agent_job_' . $stale['id'], $stale, false );
		$status = $this->poll( $stale['id'] )->get_data();
		$this->assertSame( 'failed', $status['status'] );
		$this->assertSame( 'openstation_agent_job_interrupted', $status['error']['code'] );
		$this->assertSame( $stale['progress'], $status['progress'] );
	}

	/** Store the job as running, last heard from $ago seconds ago. */
	private function running( $id, $ago, $progress = null ) {
		$job              = openstation_agent_job_get( $id );
		$job['status']    = 'running';
		$job['heartbeat'] = time() - $ago;
		if ( $progress ) {
			$job['progress'] = $progress;
		}
		update_option( 'openstation_agent_job_' . $id, $job, false );
		return $job;
	}

	public function test_a_silent_worker_reads_as_interrupted_without_a_write() {
		$bound = openstation_agent_job_stale_bound( $this->agent->ID );
		$this->assertSame( 420, $bound );
		$id = $this->submit()->get_data()['jobId'];
		$this->running( $id, $bound );
		$status = $this->poll( $id )->get_data();
		$this->assertSame( 'failed', $status['status'] );
		$this->assertSame( 'openstation_agent_job_interrupted', $status['error']['code'] );
		$this->assertNull( $status['progress'] );
		$this->assertArrayNotHasKey( 'heartbeat', $status );
		$this->assertSame( 'running', openstation_agent_job_get( $id )['status'] );

		$progress = array( 'turn' => 1, 'toolCalls' => array( array( 'name' => 'lookup', 'args' => array(), 'error' => null ) ), 'updatedAt' => time() - $bound );
		$this->running( $id, $bound, $progress );
		$status = $this->poll( $id )->get_data();
		$this->assertSame( 'failed', $status['status'] );
		$this->assertSame( 'openstation_agent_job_interrupted', $status['error']['code'] );
		$this->assertSame( $progress, $status['progress'] );
	}

	public function test_a_live_worker_reads_running_and_beats_before_the_first_request() {
		$id   = $this->submit()->get_data()['jobId'];
		$seen = null;
		add_filter( 'openstation_agent_runner_generate', static function ( $result ) use ( $id, &$seen ) {
			if ( null === $seen ) {
				$seen = openstation_agent_job_get( $id );
			}
			return $result;
		}, 20 );
		openstation_agent_job_run( $id );
		$this->assertSame( 'running', $seen['status'] );
		$this->assertGreaterThanOrEqual( time() - 5, $seen['heartbeat'] );
		$this->assertSame( 'running', openstation_agent_job_status( $seen )['status'] );
	}

	public function test_a_stale_job_frees_its_slot_and_its_late_finish_keeps_the_new_one() {
		$id = $this->submit()->get_data()['jobId'];
		$this->running( $id, 0 );
		$this->assertSame( 409, $this->submit()->get_status() );
		$old      = $this->running( $id, 1000 );
		$response = $this->submit();
		$this->assertSame( 202, $response->get_status() );
		$new = openstation_agent_job_get( $response->get_data()['jobId'] );
		// The old worker was alive after all: its answer lands, the new slot stays.
		openstation_agent_job_finish( $old, array( 'text' => 'Late answer.', 'callToActions' => array(), 'toolCalls' => array(), 'turns' => 1 ) );
		$this->assertSame( $new['id'] . '|' . $new['deadline'], get_option( 'openstation_agent_job_active_' . $this->owner . '_' . $this->agent->ID ) );
		$this->assertSame( 'completed', $this->poll( $id )->get_data()['status'] );
		$this->assertSame( 0, $this->calls );
	}

	public function test_a_stale_bound_of_zero_disables_the_check() {
		add_filter( 'openstation_agent_job_stale_after', '__return_zero' );
		$id = $this->submit()->get_data()['jobId'];
		$this->running( $id, 1000 );
		$this->assertSame( 'running', $this->poll( $id )->get_data()['status'] );
	}

	public function test_synchronous_invoke_writes_no_job_option() {
		$written = array();
		$track   = static function ( $option ) use ( &$written ) {
			$written[] = $option;
		};
		add_action( 'added_option', $track );
		add_action( 'updated_option', $track );
		$rounds = 0;
		add_action( 'openstation_agent_turn_completed', static function () use ( &$rounds ) {
			++$rounds;
		} );
		$this->call_tools( 2 );
		$result = openstation_agent_invoke( $this->agent->ID, 'Do it now.' );
		$this->assertSame( 'Finished async.', $result['text'] );
		$this->assertCount( 2, $result['toolCalls'] );
		$this->assertSame( 2, $rounds );
		$this->assertSame( array(), preg_grep( '/^openstation_agent_job_/', $written ) );
	}
}
