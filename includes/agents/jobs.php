<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_AGENT_JOB_LIFETIME = 2 * HOUR_IN_SECONDS;

function openstation_agents_register_job_routes() {
	if ( ! openstation_agents_enabled() ) {
		return;
	}
	register_rest_route(
		'desktop-mode/v1',
		'/agents/(?P<id>\d+)/jobs/(?P<job>[a-f0-9-]{36})',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'permission_callback' => 'openstation_agents_rest_invoke_permission',
			'callback'            => 'openstation_agents_rest_job',
		)
	);
}
add_action( 'rest_api_init', 'openstation_agents_register_job_routes' );

function openstation_agent_job_get( $id ) {
	if ( ! is_string( $id ) || ! wp_is_uuid( $id ) ) {
		return null;
	}
	$job = get_option( 'openstation_agent_job_' . $id );
	return is_array( $job ) ? $job : null;
}

function openstation_agent_job_insert( $key, $value ) {
	global $wpdb;
	$inserted = $wpdb->query( $wpdb->prepare( "INSERT IGNORE INTO {$wpdb->options} (option_name, option_value, autoload) VALUES (%s, %s, 'no')", $key, maybe_serialize( $value ) ) );
	wp_cache_delete( $key, 'options' );
	wp_cache_delete( 'notoptions', 'options' );
	return 1 === $inserted;
}

function openstation_agent_job_status( array $job ) {
	$status = $job['status'];
	$error  = isset( $job['error'] ) ? $job['error'] : null;
	if ( in_array( $status, array( 'queued', 'running' ), true ) && time() >= $job['deadline'] ) {
		$status = 'failed';
		$error  = array(
			'code'    => 'openstation_agent_job_interrupted',
			'message' => __( 'The background worker did not finish. Some work may already have been applied. Check the site before submitting the task again.', 'desktop-mode' ),
		);
	}
	return array(
		'jobId'     => $job['id'],
		'status'    => $status,
		'createdAt' => $job['created'],
		'pollAfter' => 3,
		'result'    => 'completed' === $status ? $job['result'] : null,
		'error'     => $error,
	);
}

function openstation_agents_rest_job( WP_REST_Request $request ) {
	$job = openstation_agent_job_get( (string) $request['job'] );
	if ( ! $job || get_current_user_id() !== $job['owner'] || (int) $request['id'] !== $job['agent'] ) {
		return new WP_Error( 'openstation_agent_job_not_found', __( 'Agent job not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	$response = rest_ensure_response( openstation_agent_job_status( $job ) );
	$response->header( 'Cache-Control', 'no-store, private' );
	return $response;
}

function openstation_agent_job_release( array $job ) {
	global $wpdb;
	$key = 'openstation_agent_job_active_' . $job['owner'] . '_' . $job['agent'];

	$wpdb->query( $wpdb->prepare( "DELETE FROM {$wpdb->options} WHERE option_name = %s AND option_value = %s", $key, $job['id'] . '|' . $job['deadline'] ) );
	wp_cache_delete( $key, 'options' );
}

function openstation_agents_rest_enqueue_job( WP_REST_Request $request ) {
	$id = strtolower( (string) $request['requestId'] );
	if ( ! wp_is_uuid( $id ) ) {
		return new WP_Error( 'openstation_agent_job_id_required', __( 'An async invocation requires a request UUID.', 'desktop-mode' ), array( 'status' => 400 ) );
	}
	$message = sanitize_textarea_field( (string) $request['message'] );
	if ( '' === trim( $message ) || strlen( $message ) > 20000 ) {
		return new WP_Error( 'openstation_agent_job_message', __( 'Send a message between 1 and 20,000 bytes.', 'desktop-mode' ), array( 'status' => 400 ) );
	}
	$job      = array(
		'id'       => $id,
		'owner'    => get_current_user_id(),
		'agent'    => (int) $request['id'],
		'message'  => $message,
		'source'   => (string) $request['source'],
		'history'  => openstation_agent_runner_sanitize_history( (array) $request['history'] ),
		'status'   => 'queued',
		'created'  => time(),
		'deadline' => time() + OPENSTATION_AGENT_JOB_LIFETIME,
	);
	$existing = openstation_agent_job_get( $id );
	if ( $existing ) {
		foreach ( array( 'owner', 'agent', 'message', 'source', 'history' ) as $field ) {
			if ( $existing[ $field ] !== $job[ $field ] ) {
				return new WP_Error( 'openstation_agent_job_conflict', __( 'That request ID is already in use.', 'desktop-mode' ), array( 'status' => 409 ) );
			}
		}
		return new WP_REST_Response( openstation_agent_job_status( $existing ), 202, array( 'Cache-Control' => 'no-store, private' ) );
	}
	if ( ! openstation_agent_runner_available() ) {
		return new WP_Error( 'openstation_agent_ai_unavailable', __( 'Configure an AI connector to run agents.', 'desktop-mode' ), array( 'status' => 503 ) );
	}

	$slot       = 'openstation_agent_job_active_' . $job['owner'] . '_' . $job['agent'];
	$slot_value = explode( '|', (string) get_option( $slot, '' ) );
	$previous   = openstation_agent_job_get( $slot_value[0] );
	if ( ! $previous && isset( $slot_value[1] ) && time() >= (int) $slot_value[1] ) {
		openstation_agent_job_release(
			array_merge(
				$job,
				array(
					'id'       => $slot_value[0],
					'deadline' => (int) $slot_value[1],
				)
			)
		);
	}
	if ( $previous && ( time() >= $previous['deadline'] || in_array( $previous['status'], array( 'completed', 'failed' ), true ) ) ) {
		openstation_agent_job_release( $previous );
	}
	if ( ! openstation_agent_job_insert( $slot, $id . '|' . $job['deadline'] ) ) {
		return new WP_Error( 'openstation_agent_job_busy', __( 'This agent is still handling your previous request. Wait for its answer before sending another.', 'desktop-mode' ), array( 'status' => 409 ) );
	}
	if ( ! openstation_agent_job_insert( 'openstation_agent_job_' . $id, $job ) ) {
		openstation_agent_job_release( $job );
		return new WP_Error( 'openstation_agent_job_conflict', __( 'The request could not be saved. Retry with the same request ID.', 'desktop-mode' ), array( 'status' => 409 ) );
	}

	$scheduled = wp_schedule_single_event( time(), 'openstation_agent_job_run', array( $id ), true );
	$cleanup   = wp_schedule_single_event( time() + DAY_IN_SECONDS, 'openstation_agent_job_cleanup', array( $id ), true );
	if ( is_wp_error( $scheduled ) || ! $scheduled || is_wp_error( $cleanup ) || ! $cleanup ) {
		wp_clear_scheduled_hook( 'openstation_agent_job_run', array( $id ) );
		wp_clear_scheduled_hook( 'openstation_agent_job_cleanup', array( $id ) );
		openstation_agent_job_release( $job );
		delete_option( 'openstation_agent_job_' . $id );
		return new WP_Error( 'openstation_agent_job_schedule', __( 'WordPress could not schedule the background job.', 'desktop-mode' ), array( 'status' => 503 ) );
	} else {
		openstation_agent_job_wake( $id );
	}
	return new WP_REST_Response( openstation_agent_job_status( openstation_agent_job_get( $id ) ), 202, array( 'Cache-Control' => 'no-store, private' ) );
}

function openstation_agent_job_wake( $id ) {

	if ( ! ( defined( 'DISABLE_WP_CRON' ) && DISABLE_WP_CRON ) && ! ( defined( 'ALTERNATE_WP_CRON' ) && ALTERNATE_WP_CRON ) ) {
		spawn_cron();
	}
	if ( function_exists( 'fastcgi_finish_request' ) ) {
		add_action(
			'shutdown',
			static function () use ( $id ) {
				ignore_user_abort( true );
				if ( fastcgi_finish_request() ) {
					openstation_agent_job_run( $id );
				}
			},
			PHP_INT_MAX
		);
	}
}

function openstation_agent_job_finish( array $job, $result ) {
	$job['status'] = is_wp_error( $result ) ? 'failed' : 'completed';
	$job['result'] = is_wp_error( $result ) ? null : $result;
	$job['error']  = is_wp_error( $result ) ? array(
		'code'    => $result->get_error_code(),
		'message' => $result->get_error_message(),
	) : null;
	update_option( 'openstation_agent_job_' . $job['id'], $job, false );
	openstation_agent_job_release( $job );

	do_action( 'openstation_agent_job_finished', $job['id'], $job['owner'], openstation_agent_job_status( $job ) );
}

function openstation_agent_job_run( $id ) {
	$job = openstation_agent_job_get( $id );
	if ( ! $job || 'queued' !== $job['status'] || ! openstation_agent_job_insert( 'openstation_agent_job_claim_' . $id, time() ) ) {
		return;
	}
	if ( time() >= $job['deadline'] ) {
		openstation_agent_job_finish( $job, new WP_Error( 'openstation_agent_job_expired', __( 'The queued job expired before a worker could start it.', 'desktop-mode' ) ) );
		return;
	}
	$job['status'] = 'running';
	update_option( 'openstation_agent_job_' . $id, $job, false );
	$finished = false;
	register_shutdown_function(
		static function () use ( &$finished, $job ) {
			if ( ! $finished ) {
				openstation_agent_job_finish( $job, new WP_Error( 'openstation_agent_job_interrupted', __( 'The background worker stopped unexpectedly. Some work may already have been applied. Check the site before submitting again.', 'desktop-mode' ) ) );
			}
		}
	);
	ignore_user_abort( true );
	if ( function_exists( 'set_time_limit' ) ) {
		set_time_limit( 0 );
	}
	$previous = get_current_user_id();
	try {
		wp_set_current_user( $job['owner'] );
		if ( ! get_userdata( $job['owner'] ) || ! openstation_agents_enabled() || ! openstation_agents_user_can_invoke() || ! openstation_agent_user_can_invoke_agent( $job['agent'], $job['source'] ) ) {
			$result = new WP_Error( 'openstation_agents_forbidden', __( 'You no longer have permission to run this agent.', 'desktop-mode' ) );
		} else {
			$result = openstation_agent_invoke(
				$job['agent'],
				$job['message'],
				array(
					'source'  => $job['source'],
					'invoker' => $job['owner'],
					'history' => $job['history'],
				)
			);
		}
	} catch ( Throwable $error ) {
		$result = new WP_Error( 'openstation_agent_job_failed', __( 'The background agent encountered an unexpected error. Check the site before submitting again.', 'desktop-mode' ) );
	} finally {
		wp_set_current_user( $previous );
	}
	openstation_agent_job_finish( $job, $result );
	$finished = true;
}
add_action( 'openstation_agent_job_run', 'openstation_agent_job_run' );

function openstation_agent_job_cleanup( $id ) {
	$job = openstation_agent_job_get( $id );
	if ( $job ) {
		openstation_agent_job_release( $job );
		delete_option( 'openstation_agent_job_' . $id );
		delete_option( 'openstation_agent_job_claim_' . $id );
		wp_clear_scheduled_hook( 'openstation_agent_job_run', array( $id ) );
	}
}
add_action( 'openstation_agent_job_cleanup', 'openstation_agent_job_cleanup' );
