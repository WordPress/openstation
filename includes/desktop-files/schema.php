<?php
/**
 * Desktop Mode — Files-on-the-Desktop schema.
 *
 * Three custom tables back the system:
 *
 *   - `_desktop_mode_file_placements` — every (user, parent_folder,
 *     type, ref, x, y, sort) tuple. Indexed on `(user_id, parent_id)`
 *     and `(file_type, file_ref)` for two queries we run constantly:
 *     "show me what's on user X's folder Y" and "where else does
 *     this entity appear" (used when an entity is deleted to clean
 *     up dangling placements).
 *
 *   - `_desktop_mode_folders` — folder rows. Owned by one user, with
 *     a share mode (`private` | `users` | `roles` | `all`) and a
 *     JSON `share_meta` column carrying user/role lists. Folders
 *     live independently of where they're placed (a folder placed
 *     on user A's desktop root can also appear inside user B's
 *     "Projects" folder via a placement).
 *
 *   - `_desktop_mode_file_tombstones` — id ledger of removals so the
 *     Heartbeat delta sync (Phase 6) can tell connected clients
 *     "this placement / folder is gone." Pruned daily.
 *
 * dbDelta is the only safe path for schema migrations against the
 * Core tables environment — Phase 6 re-uses this file by bumping
 * `DESKTOP_MODE_FILES_SCHEMA_VERSION` and adding columns.
 *
 * @package WPDesktopMode
 * @since   0.9.0
 */

defined( 'ABSPATH' ) || exit;

define( 'DESKTOP_MODE_FILES_SCHEMA_VERSION', '1' );
define( 'DESKTOP_MODE_FILES_SCHEMA_OPTION', 'desktop_mode_files_schema_version' );

/**
 * Returns the per-table names with the active prefix applied.
 *
 * @since 0.9.0
 *
 * @return array{ placements: string, folders: string, tombstones: string }
 */
function desktop_mode_files_table_names() {
	global $wpdb;
	return array(
		'placements' => $wpdb->prefix . 'desktop_mode_file_placements',
		'folders'    => $wpdb->prefix . 'desktop_mode_folders',
		'tombstones' => $wpdb->prefix . 'desktop_mode_file_tombstones',
	);
}

/**
 * Idempotent `dbDelta` call. Hooked on plugin activation and on
 * `admin_init` (gated by a version-option mismatch) so a manual
 * file copy install still ends up with the tables.
 *
 * @since 0.9.0
 */
function desktop_mode_files_install_schema() {
	global $wpdb;

	require_once ABSPATH . 'wp-admin/includes/upgrade.php';

	$tables           = desktop_mode_files_table_names();
	$charset_collate  = $wpdb->get_charset_collate();

	$placements_sql = "CREATE TABLE {$tables['placements']} (
		id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
		user_id BIGINT UNSIGNED NOT NULL,
		parent_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
		file_type VARCHAR(64) NOT NULL,
		file_ref VARCHAR(255) NOT NULL DEFAULT '',
		x INT NOT NULL DEFAULT 0,
		y INT NOT NULL DEFAULT 0,
		sort_order INT NOT NULL DEFAULT 0,
		updated_at_ms BIGINT UNSIGNED NOT NULL DEFAULT 0,
		meta LONGTEXT NULL,
		PRIMARY KEY  (id),
		KEY user_parent (user_id, parent_id),
		KEY type_ref (file_type, file_ref),
		KEY updated_at_ms (updated_at_ms)
	) $charset_collate;";

	$folders_sql = "CREATE TABLE {$tables['folders']} (
		id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
		owner_id BIGINT UNSIGNED NOT NULL,
		name VARCHAR(255) NOT NULL DEFAULT '',
		share_mode VARCHAR(16) NOT NULL DEFAULT 'private',
		share_meta LONGTEXT NULL,
		updated_at_ms BIGINT UNSIGNED NOT NULL DEFAULT 0,
		PRIMARY KEY  (id),
		KEY owner_id (owner_id),
		KEY share_mode (share_mode),
		KEY updated_at_ms (updated_at_ms)
	) $charset_collate;";

	$tombstones_sql = "CREATE TABLE {$tables['tombstones']} (
		id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
		kind VARCHAR(16) NOT NULL,
		ref_id BIGINT UNSIGNED NOT NULL,
		removed_at_ms BIGINT UNSIGNED NOT NULL,
		PRIMARY KEY  (id),
		KEY kind_removed (kind, removed_at_ms)
	) $charset_collate;";

	dbDelta( $placements_sql );
	dbDelta( $folders_sql );
	dbDelta( $tombstones_sql );

	update_option( DESKTOP_MODE_FILES_SCHEMA_OPTION, DESKTOP_MODE_FILES_SCHEMA_VERSION );

	/**
	 * Fires after the files schema is installed / migrated.
	 *
	 * @since 0.9.0
	 *
	 * @param string $version The version that was installed.
	 */
	do_action( 'desktop_mode_files_schema_installed', DESKTOP_MODE_FILES_SCHEMA_VERSION );
}

/**
 * Lazy migrator — runs on `admin_init` when the stored schema
 * version doesn't match the constant. Idempotent: `dbDelta`
 * itself is a no-op when the table already matches.
 *
 * @since 0.9.0
 */
function desktop_mode_files_maybe_install_schema() {
	$installed = get_option( DESKTOP_MODE_FILES_SCHEMA_OPTION, '' );
	if ( $installed === DESKTOP_MODE_FILES_SCHEMA_VERSION ) {
		return;
	}
	desktop_mode_files_install_schema();
}
add_action( 'admin_init', 'desktop_mode_files_maybe_install_schema' );
register_activation_hook( DESKTOP_MODE_FILE, 'desktop_mode_files_install_schema' );

/**
 * Current epoch-ms timestamp. Centralized so the store and the
 * tombstone writer stay in lock-step.
 *
 * @since 0.9.0
 *
 * @return int
 */
function desktop_mode_files_now_ms() {
	return (int) round( microtime( true ) * 1000 );
}
