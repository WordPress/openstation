<?php

defined( 'ABSPATH' ) || exit;

define( 'OPENSTATION_FILES_SCHEMA_VERSION', '13' );

define( 'OPENSTATION_FILES_SCHEMA_OPTION', 'desktop_mode_files_schema_version' );

function openstation_files_table_names() {
	global $wpdb;
	return array(
		'placements'   => $wpdb->prefix . 'desktop_mode_file_placements',
		'folders'      => $wpdb->prefix . 'desktop_mode_folders',
		'tombstones'   => $wpdb->prefix . 'desktop_mode_file_tombstones',
		'shares'       => $wpdb->prefix . 'desktop_mode_folder_shares',
		'decisions'    => $wpdb->prefix . 'desktop_mode_share_user_decisions',
		'stored_files' => $wpdb->prefix . 'desktop_mode_stored_files',
	);
}

function openstation_files_install_schema() {
	global $wpdb;

	require_once ABSPATH . 'wp-admin/includes/upgrade.php';

	$tables          = openstation_files_table_names();
	$charset_collate = $wpdb->get_charset_collate();

	$placements_sql = "CREATE TABLE {$tables['placements']} (
		id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
		owner_id BIGINT UNSIGNED NOT NULL,
		parent_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
		file_type VARCHAR(64) NOT NULL,
		file_ref VARCHAR(255) NOT NULL DEFAULT '',
		x INT NOT NULL DEFAULT 0,
		y INT NOT NULL DEFAULT 0,
		sort_order INT NOT NULL DEFAULT 0,
		updated_at_ms BIGINT UNSIGNED NOT NULL DEFAULT 0,
		meta LONGTEXT NULL,
		trashed_at_ms BIGINT UNSIGNED NULL,
		trashed_by BIGINT UNSIGNED NULL,
		trashed_via_folder BIGINT UNSIGNED NULL,
		trashed_meta LONGTEXT NULL,
		PRIMARY KEY  (id),
		KEY owner_parent (owner_id, parent_id),
		KEY type_ref (file_type, file_ref),
		KEY updated_at_ms (updated_at_ms),
		KEY trashed_at_ms (trashed_at_ms)
	) $charset_collate;";

	$folders_sql = "CREATE TABLE {$tables['folders']} (
		id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
		owner_id BIGINT UNSIGNED NOT NULL,
		name VARCHAR(255) NOT NULL DEFAULT '',
		share_mode VARCHAR(16) NOT NULL DEFAULT 'private',
		share_meta LONGTEXT NULL,
		updated_at_ms BIGINT UNSIGNED NOT NULL DEFAULT 0,
		trashed_at_ms BIGINT UNSIGNED NULL,
		trashed_by BIGINT UNSIGNED NULL,
		trashed_meta LONGTEXT NULL,
		PRIMARY KEY  (id),
		KEY owner_id (owner_id),
		KEY share_mode (share_mode),
		KEY updated_at_ms (updated_at_ms),
		KEY trashed_at_ms (trashed_at_ms)
	) $charset_collate;";

	$tombstones_sql = "CREATE TABLE {$tables['tombstones']} (
		id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
		kind VARCHAR(16) NOT NULL,
		ref_id BIGINT UNSIGNED NOT NULL,
		removed_at_ms BIGINT UNSIGNED NOT NULL,
		PRIMARY KEY  (id),
		KEY kind_removed (kind, removed_at_ms)
	) $charset_collate;";

	$stored_files_sql = "CREATE TABLE {$tables['stored_files']} (
		id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
		owner_id BIGINT UNSIGNED NOT NULL,
		display_name VARCHAR(255) NOT NULL DEFAULT '',
		disk_name VARCHAR(64) NOT NULL DEFAULT '',
		size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
		mime VARCHAR(100) NOT NULL DEFAULT '',
		created_at_ms BIGINT UNSIGNED NOT NULL DEFAULT 0,
		updated_at_ms BIGINT UNSIGNED NOT NULL DEFAULT 0,
		PRIMARY KEY  (id),
		KEY owner_id (owner_id),
		KEY disk_name (disk_name)
	) $charset_collate;";

	openstation_files_rename_user_id_to_owner_id();

	dbDelta( $placements_sql );
	dbDelta( $folders_sql );
	dbDelta( $tombstones_sql );
	dbDelta( $stored_files_sql );

	openstation_files_ensure_trash_columns();

	openstation_files_dedupe_placements();

	openstation_files_ensure_unique_placement_index();

	openstation_files_ensure_shares_table();
	openstation_files_ensure_decisions_table();

	openstation_files_ensure_updated_by_column();

	update_option( OPENSTATION_FILES_SCHEMA_OPTION, OPENSTATION_FILES_SCHEMA_VERSION );

	do_action( 'openstation_files_schema_installed', OPENSTATION_FILES_SCHEMA_VERSION );
}

function openstation_files_ensure_trash_columns() {
	global $wpdb;
	$tables = openstation_files_table_names();

	$ensure = static function ( $table, $column, $definition ) use ( $wpdb ) {
		$col_exists = static function () use ( $wpdb, $table, $column ) {
			return (int) $wpdb->get_var(
				$wpdb->prepare(
					'SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
					WHERE TABLE_SCHEMA = DATABASE()
						AND TABLE_NAME = %s
						AND COLUMN_NAME = %s',
					$table,
					$column
				)
			);
		};
		if ( $col_exists() > 0 ) {
			return;
		}
		$prev_suppress = $wpdb->suppress_errors( true );

		$wpdb->query( "ALTER TABLE `{$table}` ADD COLUMN `{$column}` {$definition}" );
		$wpdb->suppress_errors( $prev_suppress );

		if ( $col_exists() === 0 ) {

			$wpdb->query( "ALTER TABLE `{$table}` ADD COLUMN `{$column}` {$definition}" );
		}
	};

	$ensure( $tables['placements'], 'trashed_at_ms', 'BIGINT UNSIGNED NULL' );
	$ensure( $tables['placements'], 'trashed_by', 'BIGINT UNSIGNED NULL' );
	$ensure( $tables['placements'], 'trashed_via_folder', 'BIGINT UNSIGNED NULL' );

	$ensure( $tables['placements'], 'trashed_meta', 'LONGTEXT NULL' );
	$ensure( $tables['folders'], 'trashed_at_ms', 'BIGINT UNSIGNED NULL' );
	$ensure( $tables['folders'], 'trashed_by', 'BIGINT UNSIGNED NULL' );
	$ensure( $tables['folders'], 'trashed_meta', 'LONGTEXT NULL' );
}

function openstation_files_dedupe_placements() {
	global $wpdb;
	$tables = openstation_files_table_names();
	$tbl    = $tables['placements'];

	$has_unique = (int) $wpdb->get_var(
		$wpdb->prepare(
			'SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
			WHERE TABLE_SCHEMA = DATABASE()
				AND TABLE_NAME   = %s
				AND INDEX_NAME   = %s',
			$tbl,
			'placement_unique'
		)
	);
	if ( $has_unique > 0 ) {
		return;
	}

	$wpdb->query(
		"DELETE p1 FROM `{$tbl}` p1
		INNER JOIN `{$tbl}` p2
			ON p1.owner_id  = p2.owner_id
			AND p1.parent_id = p2.parent_id
			AND p1.file_type = p2.file_type
			AND p1.file_ref  = p2.file_ref
			AND p1.id        > p2.id
		WHERE p1.file_type IN ( 'shortcut', 'folder' )"
	);
}

function openstation_files_ensure_unique_placement_index() {
	global $wpdb;
	$tables = openstation_files_table_names();
	$tbl    = $tables['placements'];

	$exists = (int) $wpdb->get_var(
		$wpdb->prepare(
			'SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
			WHERE TABLE_SCHEMA = DATABASE()
				AND TABLE_NAME   = %s
				AND INDEX_NAME   = %s',
			$tbl,
			'placement_unique'
		)
	);
	if ( 0 === $exists ) {

		$prev_suppress = $wpdb->suppress_errors( true );

		$wpdb->query(
			"ALTER TABLE `{$tbl}`
			ADD UNIQUE KEY `placement_unique`
				(owner_id, parent_id, file_type, file_ref)"
		);
		$wpdb->suppress_errors( $prev_suppress );
	}
}

function openstation_files_ensure_updated_by_column() {
	global $wpdb;
	$tables = openstation_files_table_names();
	$tbl    = $tables['placements'];
	$exists = (int) $wpdb->get_var(
		$wpdb->prepare(
			'SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
			WHERE TABLE_SCHEMA = DATABASE()
				AND TABLE_NAME = %s
				AND COLUMN_NAME = %s',
			$tbl,
			'updated_by'
		)
	);
	if ( 0 === $exists ) {

		$prev_suppress = $wpdb->suppress_errors( true );

		$wpdb->query( "ALTER TABLE `{$tbl}` ADD COLUMN `updated_by` BIGINT UNSIGNED NULL AFTER `owner_id`" );
		$wpdb->suppress_errors( $prev_suppress );
	}
}

function openstation_files_rename_user_id_to_owner_id() {
	global $wpdb;
	$tables = openstation_files_table_names();
	$tbl    = $tables['placements'];

	$table_exists = (int) $wpdb->get_var(
		$wpdb->prepare(
			'SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
			WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s',
			$tbl
		)
	);
	if ( 0 === $table_exists ) {
		return;
	}

	$has_user_id = (int) $wpdb->get_var(
		$wpdb->prepare(
			"SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
			WHERE TABLE_SCHEMA = DATABASE()
				AND TABLE_NAME = %s
				AND COLUMN_NAME = 'user_id'",
			$tbl
		)
	);
	if ( 0 === $has_user_id ) {
		return;
	}

	$wpdb->query(
		"ALTER TABLE `{$tbl}` CHANGE COLUMN `user_id` `owner_id` BIGINT UNSIGNED NOT NULL"
	);

	$has_user_parent = (int) $wpdb->get_var(
		$wpdb->prepare(
			"SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
			WHERE TABLE_SCHEMA = DATABASE()
				AND TABLE_NAME = %s
				AND INDEX_NAME = 'user_parent'",
			$tbl
		)
	);
	if ( 0 < $has_user_parent ) {

		$wpdb->query( "ALTER TABLE `{$tbl}` RENAME INDEX `user_parent` TO `owner_parent`" );
	}
}

function openstation_files_ensure_shares_table() {
	global $wpdb;
	$tables          = openstation_files_table_names();
	$charset_collate = $wpdb->get_charset_collate();
	$tbl             = $tables['shares'];

	$exists = (int) $wpdb->get_var(
		$wpdb->prepare(
			'SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
			WHERE TABLE_SCHEMA = DATABASE()
				AND TABLE_NAME   = %s',
			$tbl
		)
	);
	if ( 0 === $exists ) {

		$wpdb->query(
			"CREATE TABLE IF NOT EXISTS `{$tbl}` (
				id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
				target_type VARCHAR(32) NOT NULL DEFAULT 'folder',
				folder_id BIGINT UNSIGNED NOT NULL,
				principal_type VARCHAR(16) NOT NULL,
				principal_ref VARCHAR(191) NOT NULL,
				capability VARCHAR(8) NOT NULL DEFAULT 'read',
				state VARCHAR(16) NOT NULL DEFAULT 'pending',
				invited_by BIGINT UNSIGNED NOT NULL,
				invited_at_ms BIGINT UNSIGNED NOT NULL,
				decided_at_ms BIGINT UNSIGNED NULL,
				PRIMARY KEY  (id),
				UNIQUE KEY uniq_principal (target_type, folder_id, principal_type, principal_ref),
				KEY by_principal (principal_type, principal_ref, state),
				KEY target (target_type, folder_id)
			) $charset_collate"
		);
	} else {

		$has_col = (int) $wpdb->get_var(
			$wpdb->prepare(
				'SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
				WHERE TABLE_SCHEMA = DATABASE()
					AND TABLE_NAME = %s
					AND COLUMN_NAME = %s',
				$tbl,
				'target_type'
			)
		);
		if ( 0 === $has_col ) {

			$prev_suppress = $wpdb->suppress_errors( true );

			$wpdb->query( "ALTER TABLE `{$tbl}` ADD COLUMN `target_type` VARCHAR(32) NOT NULL DEFAULT 'folder' AFTER `id`" );
			$wpdb->suppress_errors( $prev_suppress );
		}
	}
}

function openstation_files_ensure_decisions_table() {
	global $wpdb;
	$tables          = openstation_files_table_names();
	$charset_collate = $wpdb->get_charset_collate();
	$tbl             = $tables['decisions'];

	$exists = (int) $wpdb->get_var(
		$wpdb->prepare(
			'SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
			WHERE TABLE_SCHEMA = DATABASE()
				AND TABLE_NAME   = %s',
			$tbl
		)
	);
	if ( 0 === $exists ) {

		$wpdb->query(
			"CREATE TABLE IF NOT EXISTS `{$tbl}` (
				id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
				share_id BIGINT UNSIGNED NOT NULL,
				user_id BIGINT UNSIGNED NOT NULL,
				state VARCHAR(16) NOT NULL DEFAULT 'pending',
				decided_at_ms BIGINT UNSIGNED NOT NULL,
				PRIMARY KEY  (id),
				UNIQUE KEY uniq_share_user (share_id, user_id),
				KEY by_user (user_id, state)
			) $charset_collate"
		);
	}
}

function openstation_files_maybe_install_schema() {
	$installed = get_option( OPENSTATION_FILES_SCHEMA_OPTION, '' );
	if ( OPENSTATION_FILES_SCHEMA_VERSION === $installed ) {
		return;
	}
	openstation_files_install_schema();
}
add_action( 'admin_init', 'openstation_files_maybe_install_schema' );

add_action( 'rest_api_init', 'openstation_files_maybe_install_schema' );
add_action( 'init', 'openstation_files_maybe_install_schema', 1 );
register_activation_hook( OPENSTATION_FILE, 'openstation_files_install_schema' );

function openstation_files_now_ms() {
	return (int) round( microtime( true ) * 1000 );
}
