<?php

defined( 'ABSPATH' ) || exit;

function openstation_get_plugin_notices() {
	$builders = array(
		'openstation_plugin_notice_action_scheduler',
	);

	$notices = array();
	foreach ( $builders as $builder ) {
		$notice = $builder();
		if ( $notice ) {
			$notices[] = $notice;
		}
	}

	return apply_filters( 'openstation_plugin_notices', $notices );
}

function openstation_plugin_notice_action_scheduler() {

	if ( ! class_exists( 'ActionScheduler_Store' ) || ! function_exists( 'as_get_datetime_object' ) ) {
		return null;
	}

	if ( ! apply_filters( 'action_scheduler_check_pastdue_actions', current_user_can( 'manage_options' ) ) ) {
		return null;
	}

	$threshold_seconds = (int) apply_filters( 'action_scheduler_pastdue_actions_seconds', DAY_IN_SECONDS );
	$threshold_min     = (int) apply_filters( 'action_scheduler_pastdue_actions_min', 1 );

	if ( ! is_null( apply_filters( 'action_scheduler_pastdue_actions_check_pre', null ) ) ) {
		return null;
	}

	$query_args = array(
		'date'     => as_get_datetime_object( time() - $threshold_seconds ),
		'status'   => ActionScheduler_Store::STATUS_PENDING,
		'per_page' => $threshold_min,
	);

	$count = (int) ActionScheduler_Store::instance()->query_actions( $query_args, 'count' );

	$check = (bool) apply_filters(
		'action_scheduler_pastdue_actions_check',
		$count >= $threshold_min,
		$count,
		$threshold_seconds,
		$threshold_min
	);
	if ( ! $check ) {
		return null;
	}

	$url = add_query_arg(
		array(
			'page'   => 'action-scheduler',
			'status' => 'past-due',
			'order'  => 'asc',
		),
		admin_url( 'tools.php' )
	);

	return array(
		'id'          => 'action-scheduler-pastdue',
		'title'       => __( 'Scheduled Actions', 'desktop-mode' ),
		'message'     => sprintf(

			_n(
				'Action Scheduler: %d past-due action found; something may be wrong.',
				'Action Scheduler: %d past-due actions found; something may be wrong.',
				$count,
				'desktop-mode'
			),
			$count
		),
		'actionLabel' => __( 'View actions', 'desktop-mode' ),
		'actionUrl'   => $url,
	);
}

function openstation_chromeless_suppress_plugin_notices() {
	if ( ! openstation_is_chromeless_request() ) {
		return;
	}

	if ( class_exists( 'ActionScheduler_AdminView' ) ) {
		$callback = array( ActionScheduler_AdminView::instance(), 'maybe_check_pastdue_actions' );
		$priority = has_action( 'admin_notices', $callback );
		if ( false !== $priority ) {
			remove_action( 'admin_notices', $callback, $priority );
		}
	}
}
add_action( 'admin_init', 'openstation_chromeless_suppress_plugin_notices' );
