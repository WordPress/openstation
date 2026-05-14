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

define( 'DESKTOP_MODE_FILES_SCHEMA_VERSION', '9' );
define( 'DESKTOP_MODE_FILES_SCHEMA_OPTION', 'desktop_mode_files_schema_version' );
define( 'DESKTOP_MODE_FILES_SHARES_MIGRATED_OPTION', 'desktop_mode_files_shares_migrated' );

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
		'shares'     => $wpdb->prefix . 'desktop_mode_folder_shares',
		'decisions'  => $wpdb->prefix . 'desktop_mode_share_user_decisions',
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

	// Schema v2 (since 0.8.0): adds trash columns to both placements
	// and folders so deleted shortcuts and folders land in the
	// recycle bin instead of vanishing. `trashed_at_ms` is the
	// epoch-ms timestamp of the trash event (NULL = active).
	// `trashed_by` records the user that fired it (for permission
	// checks on restore). `trashed_via_folder` on placements is the
	// id of the folder whose trash cascaded the placement, so a
	// folder restore knows exactly which children to bring back —
	// precise round-trip with no time-window heuristics.
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
		trashed_at_ms BIGINT UNSIGNED NULL,
		trashed_by BIGINT UNSIGNED NULL,
		trashed_via_folder BIGINT UNSIGNED NULL,
		trashed_meta LONGTEXT NULL,
		PRIMARY KEY  (id),
		KEY user_parent (user_id, parent_id),
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

	// Schema v8 (since 0.18.0): per-principal grants. Replaces the
	// JSON `share_meta.users` / `share_meta.roles` shape with one
	// row per (target, principal) so we can carry per-recipient
	// capability + opt-in state (pending / accepted / denied).
	// `share_mode='all'` is left intact on the folders table — a
	// single column flag is the cheapest expression of "everyone."
	//
	// `target_type` defaults to `'folder'`. The column is here from
	// v8 so a future "share a post / attachment / shortcut" feature
	// only has to register a new type + an owner resolver via
	// `desktop_mode_files_shareable_types` — no schema change.
	$shares_sql = "CREATE TABLE {$tables['shares']} (
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
	) $charset_collate;";

	// Per-user decisions for role-principal shares. User-principal
	// shares carry the recipient's opt-in state on the shares row
	// itself (single user, single decision); role-principal shares
	// need a row per (share, user) so each role member can opt in
	// independently. Without this, the first role member to accept
	// or deny decides for the whole role.
	$decisions_sql = "CREATE TABLE {$tables['decisions']} (
		id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
		share_id BIGINT UNSIGNED NOT NULL,
		user_id BIGINT UNSIGNED NOT NULL,
		state VARCHAR(16) NOT NULL DEFAULT 'pending',
		decided_at_ms BIGINT UNSIGNED NOT NULL,
		PRIMARY KEY  (id),
		UNIQUE KEY uniq_share_user (share_id, user_id),
		KEY by_user (user_id, state)
	) $charset_collate;";

	dbDelta( $placements_sql );
	dbDelta( $folders_sql );
	dbDelta( $tombstones_sql );
	dbDelta( $shares_sql );
	dbDelta( $decisions_sql );

	// dbDelta has well-documented quirks with `NULL`-only columns
	// (no DEFAULT) — under some MySQL/MariaDB combos it silently
	// skips the ADD COLUMN. Verify the v2 trash columns are
	// physically present and ALTER them in directly when not.
	desktop_mode_files_ensure_trash_columns();

	// v4: clean up duplicate placements created by sessions that
	// hit the auto-orphan-placer while the v2 trash columns were
	// missing — every `WHERE trashed_at_ms IS NULL` precheck
	// returned empty, so each pageload re-inserted every
	// registered shortcut. Collapse runs of identical
	// `(user_id, parent_id, file_type, file_ref)` rows down to the
	// lowest id.
	desktop_mode_files_dedupe_placements();

	// v5: enforce uniqueness at the DB level so a future bug
	// (or a racing pair of REST requests) can never re-create
	// the duplicate shortcuts again. Must run AFTER dedupe —
	// adding a unique key against duplicate rows would fail.
	desktop_mode_files_ensure_unique_placement_index();

	// v8: belt-and-suspenders existence check for the shares
	// table, then one-shot backfill of the legacy
	// `share_meta.users` / `share_meta.roles` JSON into rows.
	desktop_mode_files_ensure_shares_table();
	desktop_mode_files_ensure_decisions_table();
	desktop_mode_files_migrate_share_meta_to_shares();

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
 * Belt-and-suspenders verifier for the v2 trash columns. Reads
 * `INFORMATION_SCHEMA.COLUMNS` for the placements + folders tables
 * and `ALTER`s in any column dbDelta missed. Idempotent: each
 * `ALTER` only fires when the column is not already there.
 *
 * @since 0.8.0
 * @internal
 */
function desktop_mode_files_ensure_trash_columns() {
	global $wpdb;
	$tables = desktop_mode_files_table_names();

	$ensure = static function ( $table, $column, $definition ) use ( $wpdb ) {
		$exists = (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
				WHERE TABLE_SCHEMA = DATABASE()
					AND TABLE_NAME = %s
					AND COLUMN_NAME = %s",
				$table,
				$column
			)
		);
		if ( 0 === $exists ) {
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$wpdb->query( "ALTER TABLE `{$table}` ADD COLUMN `{$column}` {$definition}" );
		}
	};

	$ensure( $tables['placements'], 'trashed_at_ms',      'BIGINT UNSIGNED NULL' );
	$ensure( $tables['placements'], 'trashed_by',         'BIGINT UNSIGNED NULL' );
	$ensure( $tables['placements'], 'trashed_via_folder', 'BIGINT UNSIGNED NULL' );
	// v6: ancestry snapshot — JSON capturing every folder in the
	// parent chain at trash time so a restore can resurrect the
	// chain even when a folder was hard-deleted in the meantime.
	$ensure( $tables['placements'], 'trashed_meta',       'LONGTEXT NULL' );
	$ensure( $tables['folders'],    'trashed_at_ms',      'BIGINT UNSIGNED NULL' );
	$ensure( $tables['folders'],    'trashed_by',         'BIGINT UNSIGNED NULL' );
	$ensure( $tables['folders'],    'trashed_meta',       'LONGTEXT NULL' );
}

/**
 * Collapse duplicate `(user_id, parent_id, file_type, file_ref)`
 * placement rows down to the lowest id, deleting the rest. Only
 * meaningful for `file_type IN ('shortcut','folder')` — those are
 * the types where two rows for the same ref are redundant. Other
 * types (post / page / attachment / …) might legitimately appear
 * twice on the same desktop, so the dedupe leaves them alone.
 *
 * @since 0.8.0
 * @internal
 */
function desktop_mode_files_dedupe_placements() {
	global $wpdb;
	$tables = desktop_mode_files_table_names();
	$tbl    = $tables['placements'];
	// Self-join keeps the minimum id per (user_id, parent_id,
	// file_type, file_ref) and deletes everything else. Restricted
	// to shortcut + folder placements, where duplicates are never
	// intentional.
	// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	$wpdb->query(
		"DELETE p1 FROM `{$tbl}` p1
		INNER JOIN `{$tbl}` p2
			ON p1.user_id   = p2.user_id
			AND p1.parent_id = p2.parent_id
			AND p1.file_type = p2.file_type
			AND p1.file_ref  = p2.file_ref
			AND p1.id        > p2.id
		WHERE p1.file_type IN ( 'shortcut', 'folder' )"
	);
}

/**
 * Add a UNIQUE index on
 * `(user_id, parent_id, file_type, file_ref)` to make duplicate
 * placements physically impossible. Skipped when the index is
 * already present.
 *
 * Note: `file_ref` is `VARCHAR(255)` — combined with the three
 * other columns this fits comfortably under MySQL's 3072-byte
 * InnoDB index-key limit on `utf8mb4`.
 *
 * @since 0.8.0
 * @internal
 */
function desktop_mode_files_ensure_unique_placement_index() {
	global $wpdb;
	$tables = desktop_mode_files_table_names();
	$tbl    = $tables['placements'];

	$exists = (int) $wpdb->get_var(
		$wpdb->prepare(
			"SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
			WHERE TABLE_SCHEMA = DATABASE()
				AND TABLE_NAME   = %s
				AND INDEX_NAME   = %s",
			$tbl,
			'placement_unique'
		)
	);
	if ( 0 === $exists ) {
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$wpdb->query(
			"ALTER TABLE `{$tbl}`
			ADD UNIQUE KEY `placement_unique`
				(user_id, parent_id, file_type, file_ref)"
		);
	}
}

/**
 * Belt-and-suspenders verifier for the v8 `shares` table. `dbDelta`
 * has known edge cases where a brand-new table with `UNIQUE KEY`
 * declarations on a non-`utf8mb4` collation gets silently skipped
 * on some MySQL/MariaDB combos; we mirror the trash-columns
 * pattern and `CREATE TABLE IF NOT EXISTS` the row explicitly.
 *
 * @since 0.18.0
 * @internal
 */
function desktop_mode_files_ensure_shares_table() {
	global $wpdb;
	$tables          = desktop_mode_files_table_names();
	$charset_collate = $wpdb->get_charset_collate();
	$tbl             = $tables['shares'];

	$exists = (int) $wpdb->get_var(
		$wpdb->prepare(
			"SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
			WHERE TABLE_SCHEMA = DATABASE()
				AND TABLE_NAME   = %s",
			$tbl
		)
	);
	if ( 0 === $exists ) {
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
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
		// Existing table — make sure `target_type` is there for
		// installs that ran a pre-target_type build of v8.
		$has_col = (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
				WHERE TABLE_SCHEMA = DATABASE()
					AND TABLE_NAME = %s
					AND COLUMN_NAME = %s",
				$tbl,
				'target_type'
			)
		);
		if ( 0 === $has_col ) {
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$wpdb->query( "ALTER TABLE `{$tbl}` ADD COLUMN `target_type` VARCHAR(32) NOT NULL DEFAULT 'folder' AFTER `id`" );
		}
	}
}

/**
 * Belt-and-suspenders verifier for the decisions table.
 *
 * @since 0.18.0
 * @internal
 */
function desktop_mode_files_ensure_decisions_table() {
	global $wpdb;
	$tables          = desktop_mode_files_table_names();
	$charset_collate = $wpdb->get_charset_collate();
	$tbl             = $tables['decisions'];

	$exists = (int) $wpdb->get_var(
		$wpdb->prepare(
			"SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
			WHERE TABLE_SCHEMA = DATABASE()
				AND TABLE_NAME   = %s",
			$tbl
		)
	);
	if ( 0 === $exists ) {
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
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

/**
 * One-shot backfill of the legacy `share_meta.users` /
 * `share_meta.roles` JSON shape into per-principal rows on the new
 * shares table. Idempotent: guarded by
 * `DESKTOP_MODE_FILES_SHARES_MIGRATED_OPTION`, and every INSERT is
 * an `INSERT IGNORE` so re-running against a partially-migrated
 * site is a no-op.
 *
 * Pre-existing grants migrate as `state='accepted'` (they were
 * already implicitly opt-in under the old visibility model — the
 * new opt-in is for *future* grants, not retroactive).
 *
 * @since 0.18.0
 * @internal
 */
function desktop_mode_files_migrate_share_meta_to_shares() {
	global $wpdb;
	if ( '1' === (string) get_option( DESKTOP_MODE_FILES_SHARES_MIGRATED_OPTION, '' ) ) {
		return;
	}
	$tables = desktop_mode_files_table_names();
	$rows   = $wpdb->get_results(
		"SELECT id, owner_id, share_mode, share_meta FROM {$tables['folders']} WHERE share_mode IN ( 'users', 'roles' )",
		ARRAY_A
	);
	$now = desktop_mode_files_now_ms();
	foreach ( (array) $rows as $row ) {
		$meta_raw = isset( $row['share_meta'] ) ? (string) $row['share_meta'] : '';
		$meta     = '' !== $meta_raw ? json_decode( $meta_raw, true ) : array();
		if ( ! is_array( $meta ) ) {
			$meta = array();
		}
		$folder_id  = (int) $row['id'];
		$invited_by = (int) $row['owner_id'];
		$mode       = (string) $row['share_mode'];

		if ( 'users' === $mode && isset( $meta['users'] ) && is_array( $meta['users'] ) ) {
			foreach ( $meta['users'] as $uid ) {
				$uid = (int) $uid;
				if ( $uid <= 0 ) {
					continue;
				}
				$wpdb->query(
					$wpdb->prepare(
						"INSERT IGNORE INTO {$tables['shares']}
						(folder_id, principal_type, principal_ref, capability, state, invited_by, invited_at_ms, decided_at_ms)
						VALUES (%d, %s, %s, %s, %s, %d, %d, %d)",
						$folder_id,
						'user',
						(string) $uid,
						'read',
						'accepted',
						$invited_by,
						$now,
						$now
					)
				);
			}
		}
		if ( 'roles' === $mode && isset( $meta['roles'] ) && is_array( $meta['roles'] ) ) {
			foreach ( $meta['roles'] as $role ) {
				$role = (string) $role;
				if ( '' === $role ) {
					continue;
				}
				$wpdb->query(
					$wpdb->prepare(
						"INSERT IGNORE INTO {$tables['shares']}
						(folder_id, principal_type, principal_ref, capability, state, invited_by, invited_at_ms, decided_at_ms)
						VALUES (%d, %s, %s, %s, %s, %d, %d, %d)",
						$folder_id,
						'role',
						$role,
						'read',
						'accepted',
						$invited_by,
						$now,
						$now
					)
				);
			}
		}
	}
	update_option( DESKTOP_MODE_FILES_SHARES_MIGRATED_OPTION, '1' );
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
// REST + front-end requests never fire `admin_init` — without these
// hooks a session that hits a REST endpoint before any admin page
// load would query the placements / folders tables before the v2
// trash columns exist, throwing wpdb errors and blanking the desktop.
add_action( 'rest_api_init', 'desktop_mode_files_maybe_install_schema' );
add_action( 'init', 'desktop_mode_files_maybe_install_schema', 1 );
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
