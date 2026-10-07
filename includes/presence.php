<?php
defined( 'ABSPATH' ) || exit;

const OPENSTATION_PRESENCE_OPTION = '_desktop_mode_presence';

require_once __DIR__ . '/presence-store.php';

function openstation_presence_get_all() {
	$records = openstation_presence_read_records();
	return is_wp_error( $records ) ? array() : $records;
}

function openstation_presence_record( $user_id, $active = true ) {
	return true === openstation_presence_record_result( $user_id, $active );
}

function openstation_presence_record_result( $user_id, $active = true ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return new WP_Error( 'openstation_presence_invalid_user', __( 'A user id is required.', 'desktop-mode' ) );
	}

	$can = (bool) apply_filters( 'openstation_presence_can_track', true, $user_id );
	if ( ! $can ) {
		return new WP_Error( 'openstation_presence_tracking_veto' );
	}

	$now_ms = (int) round( microtime( true ) * 1000 );
	$all    = openstation_presence_read_records( $user_id );
	if ( is_wp_error( $all ) ) {
		return $all;
	}
	$prev        = isset( $all[ $user_id ] ) ? $all[ $user_id ] : array(
		'last_seen_ms'   => 0,
		'last_active_ms' => 0,
	);
	$prev_status = openstation_presence_status_from_record( $prev );

	$next = array(
		'last_seen_ms'   => $now_ms,
		'last_active_ms' => $active ? $now_ms : (int) $prev['last_active_ms'],
	);

	$next_status = openstation_presence_status_from_record( $next );

	if ( openstation_presence_should_persist( $all, $user_id, $prev, $prev_status, $next_status, $active, $now_ms ) ) {
		$write                   = $next;
		$write['last_active_ms'] = $active ? $now_ms : 0;
		if ( ! openstation_presence_write_record( $user_id, $write ) ) {
			return new WP_Error( 'openstation_presence_write_failed', __( 'Could not save presence.', 'desktop-mode' ), array( 'status' => 503 ) );
		}
		$stored = openstation_presence_read_records( $user_id );
		if ( is_wp_error( $stored ) ) {
			return $stored;
		}
		$next        = $stored[ $user_id ] ?? $prev;
		$next_status = openstation_presence_status_from_record( $next );
	}

	do_action( 'openstation_presence_recorded', $user_id, $next );

	if ( $next_status !== $prev_status ) {

		do_action( 'openstation_presence_changed', $user_id, $next_status, $prev_status );
	}
	return true;
}

function openstation_presence_should_persist( $all, $user_id, $prev, $prev_status, $next_status, $active, $now_ms ) {
	if ( ! isset( $all[ $user_id ] ) ) {
		return true;
	}
	if ( $next_status !== $prev_status ) {
		return true;
	}

	$offline_after = (int) apply_filters( 'openstation_presence_offline_after', 120 );
	$throttle_ms   = (int) min( 60 * 1000, $offline_after * 500 );

	if ( ( $now_ms - (int) $prev['last_seen_ms'] ) >= $throttle_ms ) {
		return true;
	}
	if ( $active && ( $now_ms - (int) $prev['last_active_ms'] ) >= $throttle_ms ) {
		return true;
	}
	return false;
}

function openstation_presence_status_from_record( $record ) {
	$now_ms      = (int) round( microtime( true ) * 1000 );
	$last_seen   = isset( $record['last_seen_ms'] ) ? (int) $record['last_seen_ms'] : 0;
	$last_active = isset( $record['last_active_ms'] ) ? (int) $record['last_active_ms'] : 0;

	$inactive_after = (int) apply_filters( 'openstation_presence_inactive_after', 300 );

	$offline_after = (int) apply_filters( 'openstation_presence_offline_after', 120 );

	if ( $now_ms - $last_seen > $offline_after * 1000 ) {
		return 'offline';
	}
	if ( $now_ms - $last_active > $inactive_after * 1000 ) {
		return 'inactive';
	}
	return 'online';
}

function openstation_presence_status_for_user( $user_id ) {
	$all    = openstation_presence_read_records( (int) $user_id );
	$all    = is_wp_error( $all ) ? array() : $all;
	$record = isset( $all[ (int) $user_id ] ) ? $all[ (int) $user_id ] : array();
	return openstation_presence_status_from_record( (array) $record );
}

function openstation_presence_snapshot( $user_ids = null ) {
	$all = openstation_presence_get_all();
	$out = array();

	if ( null === $user_ids ) {
		$ids = array_keys( $all );
	} else {
		$ids = array();
		foreach ( (array) $user_ids as $uid ) {
			$uid = (int) $uid;
			if ( $uid > 0 ) {
				$ids[] = $uid;
			}
		}
	}

	foreach ( $ids as $uid ) {
		$record               = isset( $all[ $uid ] ) ? $all[ $uid ] : array();
		$out[ (string) $uid ] = array(
			'status'       => openstation_presence_status_from_record( $record ),
			'lastSeenMs'   => isset( $record['last_seen_ms'] ) ? (int) $record['last_seen_ms'] : 0,
			'lastActiveMs' => isset( $record['last_active_ms'] ) ? (int) $record['last_active_ms'] : 0,
		);
	}
	return $out;
}

function openstation_presence_visible_users( $candidate_user_ids, $viewer_id = 0 ) {
	$viewer_id = (int) $viewer_id;
	if ( ! $viewer_id ) {
		$viewer_id = get_current_user_id();
	}
	$ids = array();
	foreach ( (array) $candidate_user_ids as $uid ) {
		$uid = (int) $uid;
		if ( $uid > 0 ) {
			$ids[] = $uid;
		}
	}
	$ids = array_values( array_unique( $ids ) );

	return (array) apply_filters( 'openstation_presence_visible_users', $ids, $viewer_id );
}

function openstation_presence_cron_prune() {
	global $wpdb;

	if ( ! openstation_presence_migrate_storage() ) {
		return;
	}
	$table  = openstation_presence_table();
	$cutoff = (int) round( microtime( true ) * 1000 ) - 14 * DAY_IN_SECONDS * 1000;
	$wpdb->query( $wpdb->prepare( "DELETE FROM $table WHERE last_seen_ms < %d", $cutoff ) );
	openstation_presence_invalidate_records();
}
add_action( 'desktop_mode_presence_daily_prune', 'openstation_presence_cron_prune' );

function openstation_presence_schedule_cron() {
	if ( ! wp_next_scheduled( 'desktop_mode_presence_daily_prune' ) ) {
		wp_schedule_event( time() + DAY_IN_SECONDS, 'daily', 'desktop_mode_presence_daily_prune' );
	}
}
add_action( 'init', 'openstation_presence_schedule_cron', 50 );

function openstation_presence_heartbeat_received( $response, $data ) {
	if ( ! is_array( $response ) ) {
		$response = array();
	}
	if ( empty( $data['openstation_presence_active'] ) ) {
		return $response;
	}
	if ( ! function_exists( 'openstation_is_enabled' ) || ! openstation_is_enabled() ) {
		return $response;
	}
	$user_id     = (int) get_current_user_id();
	$user_active = ! empty( $data['openstation_user_active'] );

	openstation_presence_migration_tick();
	openstation_presence_record( $user_id, $user_active );

	$all_ids = array_keys( openstation_presence_get_all() );
	$visible = openstation_presence_visible_users( $all_ids, $user_id );

	$response['openstation_presence'] = array(
		'snapshot'     => openstation_presence_snapshot( $visible ),
		'serverTimeMs' => (int) round( microtime( true ) * 1000 ),
	);
	return $response;
}
add_filter( 'heartbeat_received', 'openstation_presence_heartbeat_received', 5, 2 );

function openstation_presence_rest_permission() {
	return openstation_rest_require_enabled();
}

function openstation_presence_register_rest_routes() {
	register_rest_route(
		'desktop-mode/v1',
		'/presence',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => 'openstation_presence_rest_permission',
				'callback'            => 'openstation_presence_rest_get',
			),
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => 'openstation_presence_rest_permission',
				'callback'            => 'openstation_presence_rest_post',
				'args'                => array(
					'active'   => array( 'type' => 'boolean' ),
					'inactive' => array( 'type' => 'boolean' ),
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'openstation_presence_register_rest_routes' );

function openstation_presence_rest_get() {
	openstation_presence_migration_tick();
	$viewer_id = (int) get_current_user_id();
	$all_ids   = array_keys( openstation_presence_get_all() );
	$visible   = openstation_presence_visible_users( $all_ids, $viewer_id );
	return rest_ensure_response(
		array(
			'snapshot'     => openstation_presence_snapshot( $visible ),
			'serverTimeMs' => (int) round( microtime( true ) * 1000 ),
		)
	);
}

function openstation_presence_rest_post( WP_REST_Request $request ) {
	openstation_presence_migration_tick();
	$user_id  = (int) get_current_user_id();
	$active   = $request->get_param( 'active' );
	$inactive = (bool) $request->get_param( 'inactive' );

	if ( $inactive ) {

		$all = openstation_presence_read_records( $user_id );
		if ( is_wp_error( $all ) ) {
			return $all;
		}
		$rec                   = isset( $all[ $user_id ] ) ? $all[ $user_id ] : array(
			'last_seen_ms'   => 0,
			'last_active_ms' => 0,
		);
		$prev_status           = openstation_presence_status_from_record( $rec );
		$rec['last_seen_ms']   = (int) round( microtime( true ) * 1000 );
		$rec['last_active_ms'] = 0;
		if ( ! openstation_presence_write_record( $user_id, $rec, true ) ) {
			return new WP_Error( 'openstation_presence_write_failed', __( 'Could not save presence.', 'desktop-mode' ), array( 'status' => 503 ) );
		}

		$next_status = openstation_presence_status_from_record( $rec );
		do_action( 'openstation_presence_recorded', $user_id, $rec );
		if ( $next_status !== $prev_status ) {
			do_action( 'openstation_presence_changed', $user_id, $next_status, $prev_status );
		}
	} else {
		$flag   = ( null === $active ) ? true : (bool) $active;
		$result = openstation_presence_record_result( $user_id, $flag );
		if ( is_wp_error( $result ) && 'openstation_presence_tracking_veto' !== $result->get_error_code() ) {
			return $result;
		}
	}

	return rest_ensure_response( array( 'ok' => true ) );
}
