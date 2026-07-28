<?php
/**
 * Desktop Mode — Games schema.
 *
 * Two custom tables back the game system:
 *
 *   - `_desktop_mode_game_scores` — one row per finished game run.
 *     `score` is the sort key for the leaderboard; the flexible
 *     per-game fields (words typed, accuracy, level, …) live in the
 *     `meta` JSON column, mirroring how file placements store their
 *     flexible payload. Indexed on `(game, score)` for the
 *     leaderboard query and `(game, user_id)` for per-player views.
 *
 *   - `_desktop_mode_game_challenges` — one row per score-to-beat
 *     challenge between two users. `updated_at_ms` is the Heartbeat
 *     high-water mark: clients send the highest value they've seen
 *     and the server returns only rows that moved past it.
 *
 * `state` columns are VARCHAR rather than ENUM, matching the
 * folder-shares table (house style — dbDelta and ENUM don't mix).
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

define( 'DESKTOP_MODE_GAMES_SCHEMA_VERSION', '1' );
define( 'DESKTOP_MODE_GAMES_SCHEMA_OPTION', 'desktop_mode_games_schema_version' );

/**
 * Returns the per-table names with the active prefix applied.
 *
 * @return array{ scores: string, challenges: string }
 */
function desktop_mode_games_table_names() {
	global $wpdb;
	return array(
		'scores'     => $wpdb->prefix . 'desktop_mode_game_scores',
		'challenges' => $wpdb->prefix . 'desktop_mode_game_challenges',
	);
}

/**
 * Idempotent `dbDelta` call. Hooked on plugin activation and lazily
 * on `admin_init` / `rest_api_init` / `init` (gated by a
 * version-option mismatch) so a manual file-copy install still ends
 * up with the tables.
 */
function desktop_mode_games_install_schema() {
	global $wpdb;

	require_once ABSPATH . 'wp-admin/includes/upgrade.php';

	$tables          = desktop_mode_games_table_names();
	$charset_collate = $wpdb->get_charset_collate();

	$scores_sql = "CREATE TABLE {$tables['scores']} (
		id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
		game VARCHAR(64) NOT NULL,
		user_id BIGINT UNSIGNED NOT NULL,
		score BIGINT NOT NULL DEFAULT 0,
		meta LONGTEXT NULL,
		created_at_ms BIGINT UNSIGNED NOT NULL DEFAULT 0,
		PRIMARY KEY  (id),
		KEY game_score (game, score),
		KEY game_user (game, user_id),
		KEY created_at_ms (created_at_ms)
	) $charset_collate;";

	$challenges_sql = "CREATE TABLE {$tables['challenges']} (
		id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
		game VARCHAR(64) NOT NULL,
		challenger_id BIGINT UNSIGNED NOT NULL,
		recipient_id BIGINT UNSIGNED NOT NULL,
		score_to_beat BIGINT NOT NULL DEFAULT 0,
		score_meta LONGTEXT NULL,
		state VARCHAR(16) NOT NULL DEFAULT 'pending',
		result VARCHAR(16) NULL,
		result_score BIGINT NULL,
		result_meta LONGTEXT NULL,
		created_at_ms BIGINT UNSIGNED NOT NULL DEFAULT 0,
		decided_at_ms BIGINT UNSIGNED NULL,
		completed_at_ms BIGINT UNSIGNED NULL,
		updated_at_ms BIGINT UNSIGNED NOT NULL DEFAULT 0,
		PRIMARY KEY  (id),
		KEY recipient_state (recipient_id, state),
		KEY challenger_state (challenger_id, state),
		KEY updated_at_ms (updated_at_ms)
	) $charset_collate;";

	dbDelta( $scores_sql );
	dbDelta( $challenges_sql );

	// Belt-and-suspenders: dbDelta's DESCRIBE-based table detection has
	// documented failure modes (see the files schema for the full
	// rationale) — verify both tables physically exist and CREATE them
	// explicitly when not.
	desktop_mode_games_ensure_table( $tables['scores'], $scores_sql );
	desktop_mode_games_ensure_table( $tables['challenges'], $challenges_sql );

	update_option( DESKTOP_MODE_GAMES_SCHEMA_OPTION, DESKTOP_MODE_GAMES_SCHEMA_VERSION );

	/**
	 * Fires after the games schema is installed / migrated.
	 *
	 * @param string $version The version that was installed.
	 */
	do_action( 'desktop_mode_games_schema_installed', DESKTOP_MODE_GAMES_SCHEMA_VERSION );
}

/**
 * Create a table via `CREATE TABLE IF NOT EXISTS` when
 * INFORMATION_SCHEMA says dbDelta left it missing. Errors are
 * suppressed around the CREATE so a concurrent worker that won the
 * same race doesn't log a benign "already exists".
 *
 * @internal
 *
 * @param string $table Fully-prefixed table name.
 * @param string $sql   The dbDelta CREATE TABLE statement for it.
 */
function desktop_mode_games_ensure_table( $table, $sql ) {
	global $wpdb;

	$exists = (int) $wpdb->get_var(
		$wpdb->prepare(
			"SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
			WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s",
			$table
		)
	);
	if ( 0 < $exists ) {
		return;
	}
	$create        = str_replace( 'CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS ', $sql );
	$prev_suppress = $wpdb->suppress_errors( true );
	// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
	$wpdb->query( $create );
	$wpdb->suppress_errors( $prev_suppress );
}

/**
 * Lazy migrator — runs when the stored schema version doesn't match
 * the constant. Idempotent: `dbDelta` itself is a no-op when the
 * tables already match.
 */
function desktop_mode_games_maybe_install_schema() {
	$installed = get_option( DESKTOP_MODE_GAMES_SCHEMA_OPTION, '' );
	if ( $installed === DESKTOP_MODE_GAMES_SCHEMA_VERSION ) {
		return;
	}
	desktop_mode_games_install_schema();
}
add_action( 'admin_init', 'desktop_mode_games_maybe_install_schema' );
// REST + Heartbeat requests never fire `admin_init` — without these a
// session hitting the scores endpoint before any admin page load
// would query missing tables.
add_action( 'rest_api_init', 'desktop_mode_games_maybe_install_schema' );
add_action( 'init', 'desktop_mode_games_maybe_install_schema', 1 );
register_activation_hook( DESKTOP_MODE_FILE, 'desktop_mode_games_install_schema' );

/**
 * Current epoch-ms timestamp. Centralized so the store and the
 * Heartbeat channel stay in lock-step.
 *
 * @return int
 */
function desktop_mode_games_now_ms() {
	return (int) round( microtime( true ) * 1000 );
}
