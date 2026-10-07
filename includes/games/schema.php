<?php

defined( 'ABSPATH' ) || exit;

define( 'OPENSTATION_GAMES_SCHEMA_VERSION', '1' );

define( 'OPENSTATION_GAMES_SCHEMA_OPTION', 'desktop_mode_games_schema_version' );

function openstation_games_table_names() {
	global $wpdb;
	return array(
		'scores'     => $wpdb->prefix . 'desktop_mode_game_scores',
		'challenges' => $wpdb->prefix . 'desktop_mode_game_challenges',
	);
}

function openstation_games_install_schema() {
	global $wpdb;

	require_once ABSPATH . 'wp-admin/includes/upgrade.php';

	$tables          = openstation_games_table_names();
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

	openstation_games_ensure_table( $tables['scores'], $scores_sql );
	openstation_games_ensure_table( $tables['challenges'], $challenges_sql );

	update_option( OPENSTATION_GAMES_SCHEMA_OPTION, OPENSTATION_GAMES_SCHEMA_VERSION );

	do_action( 'openstation_games_schema_installed', OPENSTATION_GAMES_SCHEMA_VERSION );
}

function openstation_games_ensure_table( $table, $sql ) {
	global $wpdb;

	$exists = (int) $wpdb->get_var(
		$wpdb->prepare(
			'SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
			WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s',
			$table
		)
	);
	if ( 0 < $exists ) {
		return;
	}
	$create        = str_replace( 'CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS ', $sql );
	$prev_suppress = $wpdb->suppress_errors( true );

	$wpdb->query( $create );
	$wpdb->suppress_errors( $prev_suppress );
}

function openstation_games_maybe_install_schema() {
	$installed = get_option( OPENSTATION_GAMES_SCHEMA_OPTION, '' );
	if ( OPENSTATION_GAMES_SCHEMA_VERSION === $installed ) {
		return;
	}
	openstation_games_install_schema();
}
add_action( 'admin_init', 'openstation_games_maybe_install_schema' );

add_action( 'rest_api_init', 'openstation_games_maybe_install_schema' );
add_action( 'init', 'openstation_games_maybe_install_schema', 1 );
register_activation_hook( OPENSTATION_FILE, 'openstation_games_install_schema' );

function openstation_games_now_ms() {
	return (int) round( microtime( true ) * 1000 );
}
