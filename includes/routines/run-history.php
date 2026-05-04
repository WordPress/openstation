<?php
/**
 * Desktop Mode — Routines: run-history custom table.
 *
 * Append-heavy, time-ordered, never edited. Lives in its own table
 * so wp_posts indices stay lean even on sites with hundreds of
 * routines firing thousands of times each.
 *
 * Table: `{prefix}wpdm_routine_runs`
 *
 *   id          BIGINT UNSIGNED PRIMARY KEY
 *   routine_id  BIGINT UNSIGNED   (FK to wp_posts.ID, no constraint)
 *   started_at  DATETIME
 *   finished_at DATETIME NULL
 *   status      VARCHAR(16)       (`success` | `failure` | `skipped` | `running`)
 *   duration_ms INT UNSIGNED
 *   trigger_id  VARCHAR(128)
 *   payload     LONGTEXT          (JSON)
 *   steps_log   LONGTEXT          (JSON: per-step result array)
 *   error       TEXT NULL
 *
 * Indexed on `(routine_id, started_at)` for the per-routine history
 * view, and `(started_at)` for the global timeline.
 *
 * @package WPDesktopMode
 * @since   0.22.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Full table name with the WP prefix.
 *
 * @since 0.22.0
 *
 * @return string
 */
function wpdm_routine_runs_table() {
	global $wpdb;
	return $wpdb->prefix . WPDM_ROUTINE_RUNS_TABLE;
}

/**
 * Create or upgrade the runs table via dbDelta.
 *
 * Idempotent — `dbDelta` is the right tool for this exact pattern.
 *
 * @since 0.22.0
 */
function wpdm_routine_install_runs_table() {
	global $wpdb;
	$table   = wpdm_routine_runs_table();
	$charset = $wpdb->get_charset_collate();

	$sql = "CREATE TABLE $table (
		id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
		routine_id   BIGINT UNSIGNED NOT NULL,
		started_at   DATETIME NOT NULL,
		finished_at  DATETIME NULL,
		status       VARCHAR(16) NOT NULL DEFAULT 'running',
		duration_ms  INT UNSIGNED NOT NULL DEFAULT 0,
		trigger_id   VARCHAR(128) NOT NULL DEFAULT '',
		payload      LONGTEXT NULL,
		steps_log    LONGTEXT NULL,
		error        TEXT NULL,
		PRIMARY KEY  (id),
		KEY routine_started (routine_id, started_at),
		KEY started_at (started_at)
	) $charset;";

	require_once ABSPATH . 'wp-admin/includes/upgrade.php';
	dbDelta( $sql );
}

/**
 * Record a routine run.
 *
 * @since 0.22.0
 *
 * @param array $row {
 *     @type int    $routine_id  Required.
 *     @type string $status      Required.
 *     @type int    $duration_ms
 *     @type string $trigger_id
 *     @type array  $payload
 *     @type array  $steps_log
 *     @type string $error
 * }
 * @return int|false Insert id, or false on failure.
 */
function wpdm_routine_record_run( $row ) {
	global $wpdb;

	$routine_id = isset( $row['routine_id'] ) ? (int) $row['routine_id'] : 0;
	if ( $routine_id <= 0 ) {
		return false;
	}

	$now      = current_time( 'mysql', true ); // GMT
	$payload  = isset( $row['payload'] ) ? wp_json_encode( $row['payload'] ) : null;
	$steps    = isset( $row['steps_log'] ) ? wp_json_encode( $row['steps_log'] ) : null;
	$status   = isset( $row['status'] ) ? (string) $row['status'] : 'success';
	$duration = isset( $row['duration_ms'] ) ? max( 0, (int) $row['duration_ms'] ) : 0;
	$trigger  = isset( $row['trigger_id'] ) ? substr( (string) $row['trigger_id'], 0, 128 ) : '';
	$error    = isset( $row['error'] ) ? (string) $row['error'] : null;

	// Custom routine_runs table — no caching layer applies to write
	// operations on a write-heavy log. Table name is built from
	// $wpdb->prefix + a hardcoded constant in wpdm_routine_runs_table().
	$ok = $wpdb->insert( // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		wpdm_routine_runs_table(),
		array(
			'routine_id'  => $routine_id,
			'started_at'  => $now,
			'finished_at' => $now,
			'status'      => $status,
			'duration_ms' => $duration,
			'trigger_id'  => $trigger,
			'payload'     => $payload,
			'steps_log'   => $steps,
			'error'       => $error,
		),
		array( '%d', '%s', '%s', '%s', '%d', '%s', '%s', '%s', '%s' )
	);

	if ( $ok ) {
		wpdm_routine_update_stats( $routine_id, $status, $duration, $error );
		return (int) $wpdb->insert_id;
	}
	return false;
}

/**
 * Update aggregated stats meta on the routine post.
 *
 * @since 0.22.0
 *
 * @param int    $routine_id  Routine post id.
 * @param string $status      Last run status.
 * @param int    $duration_ms Last duration.
 * @param string $error       Last error message.
 */
function wpdm_routine_update_stats( $routine_id, $status, $duration_ms, $error ) {
	$row = wpdm_routine_get( $routine_id );
	if ( null === $row ) {
		return;
	}
	$stats = $row['stats'];
	$runs  = (int) $stats['runs'] + 1;
	// Running mean: (old_avg * (n-1) + new) / n.
	$prev_avg = (int) $stats['avg_ms'];
	$new_avg  = $runs > 0 ? (int) round( ( $prev_avg * ( $runs - 1 ) + $duration_ms ) / $runs ) : $duration_ms;

	$stats['runs']     = $runs;
	$stats['last_run'] = time();
	$stats['avg_ms']   = $new_avg;
	if ( 'failure' === $status ) {
		$stats['last_error'] = (string) $error;
	}

	update_post_meta( $routine_id, WPDM_ROUTINE_STATS_META, wp_json_encode( $stats ) );
}

/**
 * List recent runs for a routine.
 *
 * @since 0.22.0
 *
 * @param int $routine_id Routine post id.
 * @param int $limit      Max rows.
 * @return array<int, array>
 */
function wpdm_routine_get_runs( $routine_id, $limit = 50 ) {
	global $wpdb;
	$table      = wpdm_routine_runs_table();
	$routine_id = (int) $routine_id;
	$limit      = max( 1, min( 500, (int) $limit ) );

	// $table is built from $wpdb->prefix + the WPDM_ROUTINE_RUNS_TABLE
	// constant — both safe; the interpolated identifier cannot be
	// prepared via %s. Caching skipped: this is a real-time tail of a
	// runs log; per-call cache invalidation would defeat the purpose.
	$rows = $wpdb->get_results( // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, PluginCheck.Security.DirectDB.UnescapedDBParameter
		$wpdb->prepare(
			"SELECT id, routine_id, started_at, finished_at, status, duration_ms, trigger_id, payload, steps_log, error
			 FROM $table WHERE routine_id = %d ORDER BY started_at DESC LIMIT %d", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$routine_id,
			$limit
		),
		ARRAY_A
	);
	if ( ! is_array( $rows ) ) {
		return array();
	}
	foreach ( $rows as &$row ) {
		$row['payload']   = $row['payload'] ? json_decode( (string) $row['payload'], true ) : null;
		$row['steps_log'] = $row['steps_log'] ? json_decode( (string) $row['steps_log'], true ) : array();
	}
	return $rows;
}

/**
 * Trim runs older than N days. Hooked to a daily cron.
 *
 * @since 0.22.0
 *
 * @param int $days Retention window.
 */
function wpdm_routine_prune_runs( $days = 30 ) {
	global $wpdb;
	$days = max( 1, (int) $days );

	/**
	 * Filter the run-history retention window in days.
	 *
	 * @since 0.22.0
	 *
	 * @param int $days Default 30.
	 */
	$days = (int) apply_filters( 'wp_desktop_routine_run_retention_days', $days );

	$table = wpdm_routine_runs_table();
	// Same safety + non-cacheability rationale as wpdm_routine_get_runs() above.
	$wpdb->query( $wpdb->prepare( "DELETE FROM $table WHERE started_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL %d DAY)", $days ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, PluginCheck.Security.DirectDB.UnescapedDBParameter, WordPress.DB.PreparedSQL.InterpolatedNotPrepared
}
add_action( 'wpdm_routine_prune_runs_cron', 'wpdm_routine_prune_runs' );

/**
 * Schedule the daily prune.
 *
 * @since 0.22.0
 */
function wpdm_routine_schedule_prune() {
	if ( ! wp_next_scheduled( 'wpdm_routine_prune_runs_cron' ) ) {
		wp_schedule_event( time() + HOUR_IN_SECONDS, 'daily', 'wpdm_routine_prune_runs_cron' );
	}
}
add_action( 'init', 'wpdm_routine_schedule_prune', 20 );
