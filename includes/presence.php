<?php
defined( 'ABSPATH' ) || exit;
/**
 * OpenStation — framework-level presence.
 *
 * Tracks who's currently in the openstation WP-Admin and what
 * their state is — `online`, `inactive`, `offline`. Lives at
 * framework level so any plugin can consume presence without
 * depending on chat / collaboration / co-editing features being
 * enabled.
 *
 * **State machine.** Three values, derived from two timestamps:
 *
 *   - **online**   — Heartbeat seen within `_offline_after` seconds
 *                    AND user activity (mousedown / keydown) within
 *                    `_inactive_after` seconds (default 300s = 5 min).
 *   - **inactive** — Heartbeat seen within `_offline_after` but no
 *                    user activity within `_inactive_after`.
 *   - **offline**  — no Heartbeat in `_offline_after` (default 120s).
 *
 * Storage uses a site-scoped table with one row per user.
 * The legacy `_desktop_mode_presence` option is retained for recovery.
 *
 * **Public surface.** PHP helpers:
 *
 *   - `openstation_presence_record( $user_id, $active )`
 *   - `openstation_presence_status_for_user( $user_id )`
 *   - `openstation_presence_get_all()`
 *   - `openstation_presence_snapshot( $user_ids = null )`
 *
 * Filters:
 *
 *   - `openstation_presence_inactive_after` — int seconds. Default 300.
 *   - `openstation_presence_offline_after`  — int seconds. Default 120.
 *   - `openstation_presence_can_track`      — bool, $user_id. Veto.
 *   - `openstation_presence_visible_users`  — int[], $viewer_id.
 *                                             Privacy gate for who's
 *                                             surfaced to a given user.
 *
 * Actions:
 *
 *   - `openstation_presence_recorded( $user_id, $record )` — on every
 *     bump.
 *   - `openstation_presence_changed( $user_id, $new, $old )` — on
 *     state transitions only.
 *
 * REST: `/desktop-mode/v1/presence` (GET snapshot, POST mark active /
 * inactive).
 *
 * @package OpenStation
 */

/**
 * The VALUE keeps its pre-rebrand spelling on purpose: it is a
 * persisted or externally-visible identifier, so renaming it would
 * orphan data already written by live installs (or break a live
 * URL). The mismatch between this constant's name and its value is
 * deliberate — it is NOT a half-finished rename.
 */
const OPENSTATION_PRESENCE_OPTION = '_desktop_mode_presence';

require_once __DIR__ . '/presence-store.php';

/**
 * Read the current site's presence map.
 *
 * @return array<int,array{last_seen_ms:int,last_active_ms:int}>
 */
function openstation_presence_get_all() {
	$records = openstation_presence_read_records();
	return is_wp_error( $records ) ? array() : $records;
}

/**
 * Record a "user is alive" heartbeat. Bumps `last_seen_ms`. If
 * `$active` is true, also bumps `last_active_ms` (the user just
 * interacted, not just held a tab open).
 *
 * Writes are throttled unless status changes or a persisted timestamp is
 * behind by half the offline threshold (capped at 60s). Each write atomically
 * merges only this user's timestamps. Fires `openstation_presence_recorded`
 * on every accepted bump, including throttled bumps, and
 * `openstation_presence_changed` when this call observes a status transition.
 *
 * The `openstation_presence_can_track` filter is the per-user opt-out:
 * a plugin that hides specific accounts (compliance, "set yourself
 * invisible", etc.) returns false to skip the bump entirely.
 *
 * @param int  $user_id User to record.
 * @param bool $active  Pass `true` when the heartbeat is paired with
 *                      explicit user activity (mousedown, keydown).
 * @return bool True if accepted; false on invalid id, tracking veto or storage failure.
 */
function openstation_presence_record( $user_id, $active = true ) {
	return true === openstation_presence_record_result( $user_id, $active );
}

/**
 * Record presence while preserving a distinct veto and storage failure result.
 *
 * @internal
 * @param int  $user_id User to record.
 * @param bool $active Whether this request carries activity.
 * @return true|WP_Error
 */
function openstation_presence_record_result( $user_id, $active = true ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return new WP_Error( 'openstation_presence_invalid_user', __( 'A user id is required.', 'desktop-mode' ) );
	}

	/**
	 * Per-user veto on presence tracking. Return false to skip the
	 * bump entirely — useful for "appear offline" toggles, audit
	 * exemptions for sensitive accounts, or forcing a non-admin
	 * never-tracked policy.
	 *
	 * @param bool $can     Default true.
	 * @param int  $user_id The user being tracked.
	 */
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

	/**
	 * Fires on every recorded heartbeat — useful for audit logging
	 * or third-party "who's around right now" dashboards. Fires
	 * regardless of whether the computed status changed.
	 *
	 * @param int   $user_id
	 * @param array $record  { last_seen_ms, last_active_ms }
	 */
	do_action( 'openstation_presence_recorded', $user_id, $next );

	if ( $next_status !== $prev_status ) {
		/**
		 * Fires when a user's computed presence status transitions.
		 * Plugins driving "user came online / went offline" UI hook
		 * here — the recorded action above fires every tick whether
		 * the state changed or not, which would be too noisy.
		 *
		 * @param int    $user_id
		 * @param string $new_status One of `online | inactive | offline`.
		 * @param string $old_status One of `online | inactive | offline`.
		 */
		do_action( 'openstation_presence_changed', $user_id, $next_status, $prev_status );
	}
	return true;
}

/**
 * Decide whether a presence bump needs to hit the database.
 *
 * A bump must persist when:
 *
 *   - the user isn't in the map yet (first sighting),
 *   - the computed status transitioned (viewers must see it), or
 *   - a persisted timestamp has drifted by at least the throttle
 *     window — half the offline threshold, capped at 60s — so stored
 *     `last_seen_ms` can never age anywhere near the offline cutoff
 *     while the user is genuinely present.
 *
 * Everything else is a redundant rewrite and is skipped. Skipped
 * bumps still fire `openstation_presence_recorded` with the fresh
 * record — only the persisted copy lags.
 *
 * @param array  $all         Stored presence map.
 * @param int    $user_id     User being bumped.
 * @param array  $prev        Stored record for the user (zeros if new).
 * @param string $prev_status Status computed from the stored record.
 * @param string $next_status Status computed from the fresh record.
 * @param bool   $active      Whether this bump carries user activity.
 * @param int    $now_ms      Current epoch milliseconds.
 * @return bool True to persist, false to skip the write.
 */
function openstation_presence_should_persist( $all, $user_id, $prev, $prev_status, $next_status, $active, $now_ms ) {
	if ( ! isset( $all[ $user_id ] ) ) {
		return true;
	}
	if ( $next_status !== $prev_status ) {
		return true;
	}

	/** This filter is documented in includes/presence.php */
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

/**
 * Compute presence status from a record.
 *
 * Pure function — given the same `(record, now)`, always returns
 * the same answer. Filters override the thresholds, not the logic
 * order; an `online` user transitions through `inactive` to
 * `offline` if they're idle long enough.
 *
 * @param array $record { last_seen_ms?: int, last_active_ms?: int }
 * @return string `online | inactive | offline`
 */
function openstation_presence_status_from_record( $record ) {
	$now_ms      = (int) round( microtime( true ) * 1000 );
	$last_seen   = isset( $record['last_seen_ms'] ) ? (int) $record['last_seen_ms'] : 0;
	$last_active = isset( $record['last_active_ms'] ) ? (int) $record['last_active_ms'] : 0;

	/**
	 * Inactive threshold (default 300s = 5 min). Online users
	 * transition to `inactive` when they haven't moused / typed
	 * for this long, even if Heartbeat keeps firing.
	 *
	 * @param int $seconds
	 */
	$inactive_after = (int) apply_filters( 'openstation_presence_inactive_after', 300 );

	/**
	 * Offline threshold (default 120s = 2 min). Inactive / online
	 * users transition to `offline` when the last Heartbeat is
	 * older than this.
	 *
	 * @param int $seconds
	 */
	$offline_after = (int) apply_filters( 'openstation_presence_offline_after', 120 );

	if ( $now_ms - $last_seen > $offline_after * 1000 ) {
		return 'offline';
	}
	if ( $now_ms - $last_active > $inactive_after * 1000 ) {
		return 'inactive';
	}
	return 'online';
}

/**
 * Look up presence status for a single user.
 *
 * @param int $user_id
 * @return string `online | inactive | offline`
 */
function openstation_presence_status_for_user( $user_id ) {
	$all    = openstation_presence_read_records( (int) $user_id );
	$all    = is_wp_error( $all ) ? array() : $all;
	$record = isset( $all[ (int) $user_id ] ) ? $all[ (int) $user_id ] : array();
	return openstation_presence_status_from_record( (array) $record );
}

/**
 * Build a presence snapshot. With `$user_ids = null` returns every
 * tracked user; with a list returns only those ids (useful for
 * "users I care about" filtering — e.g., a plugin that surfaces
 * the subset of users relevant to the viewer).
 *
 * Output shape uses string keys so the JSON encoder produces an
 * object (not a sparse array) when the smallest id isn't 1.
 *
 * @param int[]|null $user_ids Restrict to these ids. `null` = all.
 * @return array<string,array{ status:string, lastSeenMs:int, lastActiveMs:int }>
 */
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

/**
 * Filter a list of candidate user ids down to those a given viewer
 * is allowed to see presence for. Defaults to passing the list
 * through unchanged — plugins implementing per-team / per-role
 * privacy boundaries hook `openstation_presence_visible_users`
 * (e.g., "subscribers can only see other subscribers' presence").
 *
 * @param int[] $candidate_user_ids
 * @param int   $viewer_id          Defaults to the current user.
 * @return int[]
 */
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

	/**
	 * Filter the list of user ids whose presence is visible to
	 * `$viewer_id`. Default behaviour: all candidates pass. Hook
	 * to enforce privacy — e.g., subscribers only see other
	 * subscribers; admins see everyone; an opt-out list never shows.
	 *
	 * @param int[] $ids       Candidate user ids.
	 * @param int   $viewer_id The user requesting visibility.
	 */
	return (array) apply_filters( 'openstation_presence_visible_users', $ids, $viewer_id );
}

/**
 * Daily cron: prune presence entries for users idle >14 days.
 * Deletes only rows still expired when the statement executes.
 */
function openstation_presence_cron_prune() {
	global $wpdb;
	// Do not rewrite the shared legacy map if migration is unavailable.
	if ( ! openstation_presence_migrate_storage() ) {
		return;
	}
	$table  = openstation_presence_table();
	$cutoff = (int) round( microtime( true ) * 1000 ) - 14 * DAY_IN_SECONDS * 1000;
	$wpdb->query( $wpdb->prepare( "DELETE FROM $table WHERE last_seen_ms < %d", $cutoff ) );
	openstation_presence_invalidate_records();
}
add_action( 'desktop_mode_presence_daily_prune', 'openstation_presence_cron_prune' );

/**
 * Schedule the daily cron once. Idempotent.
 */
function openstation_presence_schedule_cron() {
	if ( ! wp_next_scheduled( 'desktop_mode_presence_daily_prune' ) ) {
		wp_schedule_event( time() + DAY_IN_SECONDS, 'daily', 'desktop_mode_presence_daily_prune' );
	}
}
add_action( 'init', 'openstation_presence_schedule_cron', 50 );

/*
-------------------------------------------------------------------------
 * Heartbeat integration
 * -----------------------------------------------------------------------
 */

/**
 * Heartbeat handler — bumps presence on every tick a openstation
 * user is on the page. Returns the visible-presence snapshot in
 * the response so the client store can update without a separate
 * REST round-trip.
 *
 * Triggered by the client opting in via `openstation_presence_active:
 * true` in the heartbeat-send payload, with optional
 * `openstation_user_active` (mousedown / keydown within the
 * inactive-threshold window).
 *
 * @param array $response Pre-filtered response.
 * @param array $data     Client-sent payload.
 * @return array
 */
function openstation_presence_heartbeat_received( $response, $data ) {
	if ( ! is_array( $response ) ) {
		$response = array();
	}
	if ( empty( $data['openstation_presence_active'] ) ) {
		return $response;
	}
	// `read` as well as the opt-in, the floor the REST routes apply:
	// the opt-in is network-wide user meta, and a multisite user with
	// no role on this site must neither show up in its presence list
	// nor read it.
	if ( ! function_exists( 'openstation_is_enabled' ) || ! openstation_is_enabled() || ! current_user_can( 'read' ) ) {
		return $response;
	}
	$user_id     = (int) get_current_user_id();
	$user_active = ! empty( $data['openstation_user_active'] );

	openstation_presence_migration_tick();
	openstation_presence_record( $user_id, $user_active );

	// Snapshot the users this viewer is allowed to see — by default
	// all tracked users; plugins can narrow via the
	// `openstation_presence_visible_users` filter.
	$all_ids = array_keys( openstation_presence_get_all() );
	$visible = openstation_presence_visible_users( $all_ids, $user_id );

	$response['openstation_presence'] = array(
		'snapshot'     => openstation_presence_snapshot( $visible ),
		'serverTimeMs' => (int) round( microtime( true ) * 1000 ),
	);
	return $response;
}
add_filter( 'heartbeat_received', 'openstation_presence_heartbeat_received', 5, 2 );

/*
-------------------------------------------------------------------------
 * REST endpoints
 * -----------------------------------------------------------------------
 */

/**
 * Permission gate for presence endpoints — login required +
 * OpenStation enabled. Delegates to the shared
 * {@see openstation_rest_require_enabled()} gate.
 *
 * @return true|WP_Error
 */
function openstation_presence_rest_permission() {
	return openstation_rest_require_enabled();
}

/**
 * Register `/desktop-mode/v1/presence` routes.
 */
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

/**
 * GET /desktop-mode/v1/presence — current snapshot, narrowed by the
 * visibility filter.
 */
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

/**
 * POST /desktop-mode/v1/presence — explicit bump. Body shape:
 *
 *   - `{ active: true }`   → bump both seen + active timestamps.
 *   - `{ active: false }`  → bump seen only (window in background).
 *   - `{ inactive: true }` → bump seen only AND zero active so the
 *                            user lands on `inactive` immediately
 *                            (the "set yourself away" UI hook).
 *
 * Defaults to `{ active: true }` when neither flag is supplied —
 * the simplest "I'm here" call.
 */
function openstation_presence_rest_post( WP_REST_Request $request ) {
	openstation_presence_migration_tick();
	$user_id  = (int) get_current_user_id();
	$active   = $request->get_param( 'active' );
	$inactive = (bool) $request->get_param( 'inactive' );

	if ( $inactive ) {
		// Set the user immediately to `inactive`: bump last_seen
		// (still alive) but force last_active to zero (no recent
		// interaction).
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
