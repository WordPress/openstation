<?php
/**
 * A small, opt-in allowlist of well-known *library* admin notices that render
 * globally (so they repeat in every desktop window) and can be re-derived from
 * authoritative state. Unlike arbitrary plugin `admin_notices` — which we
 * deliberately leave alone (see docs/core-notices-audit.md) — these are shared
 * libraries bundled across many plugins, common enough to warrant a targeted
 * case. Each entry is detached in-window and surfaced once in the shell, the
 * same pattern as the core notices.
 *
 * @since 0.9.4
 * @package DesktopMode
 */

defined( 'ABSPATH' ) || exit;

/**
 * The allowlisted plugin/library notices for the current user, as shell
 * descriptors (same shape as `desktop_mode_get_core_notices()`).
 *
 * @since 0.9.4
 *
 * @return array<int,array{id:string,title:string,message:string,actionLabel:string,actionUrl:string}>
 */
function desktop_mode_get_plugin_notices() {
	$builders = array(
		'desktop_mode_plugin_notice_action_scheduler',
	);

	$notices = array();
	foreach ( $builders as $builder ) {
		$notice = $builder();
		if ( $notice ) {
			$notices[] = $notice;
		}
	}

	/**
	 * Filters the allowlisted plugin/library notices surfaced once in the
	 * desktop shell. Return an empty array to suppress them all, or unset
	 * individual entries by `id`.
	 *
	 * @since 0.9.4
	 *
	 * @param array $notices List of notice descriptors.
	 */
	return apply_filters( 'desktop_mode_plugin_notices', $notices );
}

/**
 * Action Scheduler's "N past-due actions found" warning — bundled by
 * WooCommerce, Jetpack, and many other plugins, and printed globally on
 * `admin_notices` (with no throttle while past-due actions exist, so it
 * repeats in every window). Re-derived here from Action Scheduler's own store,
 * mirroring `ActionScheduler_AdminView::check_pastdue_actions()` including its
 * filters, so the count matches what Action Scheduler would show.
 *
 * @since 0.9.4
 *
 * @return array|null
 */
function desktop_mode_plugin_notice_action_scheduler() {
	if ( ! class_exists( 'ActionScheduler_Store' ) || ! function_exists( 'as_get_datetime_object' ) ) {
		return null;
	}

	// Capability gate — mirrors `action_scheduler_check_pastdue_actions`.
	if ( ! apply_filters( 'action_scheduler_check_pastdue_actions', current_user_can( 'manage_options' ) ) ) {
		return null;
	}

	$threshold_seconds = (int) apply_filters( 'action_scheduler_pastdue_actions_seconds', DAY_IN_SECONDS );
	$threshold_min     = (int) apply_filters( 'action_scheduler_pastdue_actions_min', 1 );

	// A third party can preempt Action Scheduler's own check; when it does the
	// count is opaque, so mirror Action Scheduler and don't surface.
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
			/* translators: %d: number of past-due scheduled actions. */
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

/**
 * Detaches the allowlisted plugin/library notices inside chromeless iframes so
 * they don't repeat in every window — the shell surfaces each once (see
 * `desktop_mode_get_plugin_notices()`).
 *
 * @since 0.9.4
 */
function desktop_mode_chromeless_suppress_plugin_notices() {
	if ( ! desktop_mode_is_chromeless_request() ) {
		return;
	}

	// Action Scheduler registers the notice as an instance method on its
	// `ActionScheduler_AdminView` singleton (during `init`, before this runs).
	if ( class_exists( 'ActionScheduler_AdminView' ) ) {
		remove_action(
			'admin_notices',
			array( ActionScheduler_AdminView::instance(), 'maybe_check_pastdue_actions' )
		);
	}
}
add_action( 'admin_init', 'desktop_mode_chromeless_suppress_plugin_notices' );
