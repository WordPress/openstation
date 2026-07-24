<?php
/**
 * Desktop Mode — Files-on-the-Desktop schema.
 *
 * Five custom tables back the system:
 *
 *   - `_desktop_mode_file_placements` — every (user, parent_folder,
 *     type, ref, x, y, sort) tuple. Indexed on `(owner_id, parent_id)`
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
 *   - `_desktop_mode_folder_shares` — one row per (folder, principal)
 *     grant: user- or role-principal, `read` | `write` capability,
 *     `pending` | `accepted` | `denied` state.
 *
 *   - `_desktop_mode_share_user_decisions` — per-user opt-ins for
 *     role-principal shares (each member of the role accepts or
 *     denies individually; the shares row itself stays `pending`).
 *
 * dbDelta is the only safe path for schema migrations against the
 * Core tables environment — Phase 6 re-uses this file by bumping
 * `DESKTOP_MODE_FILES_SCHEMA_VERSION` and adding columns.
 *
 * @package WPDesktopMode
 * @since   0.9.0
 */

defined( 'ABSPATH' ) || exit;

define( 'DESKTOP_MODE_FILES_SCHEMA_VERSION', '13' );
define( 'DESKTOP_MODE_FILES_SCHEMA_OPTION', 'desktop_mode_files_schema_version' );

/**
 * Returns the per-table names with the active prefix applied.
 *
 * @since 0.9.0
 *
 * @return array{ placements: string, folders: string, tombstones: string, shares: string, decisions: string }
 */
function desktop_mode_files_table_names() {
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

	// Schema v13 (since 0.9.6): real per-user file storage. One row
	// per uploaded file; the bytes live flat on disk under
	// `uploads/desktop-mode-files/<owner_id>/<disk_name>` with a
	// server-generated extensionless `disk_name` (UUID) — hierarchy,
	// naming, and sharing are entirely DB concerns (folders +
	// placements + shares tables), the disk is a dumb blob store.
	// No UNIQUE keys beyond the PK on purpose: dbDelta's UNIQUE-KEY
	// quirks (see the shares-table comment below) don't apply, and
	// disk_name uniqueness is guaranteed by the UUID generator plus
	// a collision check at write time.
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

	// Schema v9 — per-principal grants (`folder_shares` table) +
	// per-user opt-in decisions (`share_user_decisions` table).
	// `share_meta` on the folders row stays as a diagnostic-only
	// column; visibility is computed entirely from the shares
	// table.
	//
	// Shares + decisions are intentionally NOT routed through
	// dbDelta. Their `ensure_*_table()` helpers below are the sole
	// creators. dbDelta uses `DESCRIBE` to detect existing tables
	// and falls back to a bare `CREATE TABLE` (no IF NOT EXISTS)
	// when DESCRIBE returns empty — under certain MySQL / MariaDB
	// configurations (case-folding mismatches, transient connection
	// states, the `lower_case_table_names` quirk on case-sensitive
	// filesystems) DESCRIBE can fail on a table that physically
	// exists, and dbDelta then issues a CREATE that blows up with
	// "Table … already exists" (MySQL error 1050). The `ensure_*`
	// helpers use INFORMATION_SCHEMA + explicit `CREATE TABLE IF NOT
	// EXISTS`, which is bullet-proof; v9 → vN column additions are
	// handled by `ALTER TABLE … ADD COLUMN` inside the same helper.

	// v11: rename `placements.user_id` to `placements.owner_id` so
	// the placements + folders tables use the same column name for
	// the same concept. Must run BEFORE dbDelta — once the
	// `$placements_sql` definition switches from `user_id` to
	// `owner_id`, dbDelta on an existing v≤10 install would see
	// `owner_id` as a missing column and ADD it (leaving the old
	// `user_id` in place + the new `owner_id` NULL). Running the
	// CHANGE COLUMN first means dbDelta sees the table already
	// matches the desired shape.
	desktop_mode_files_rename_user_id_to_owner_id();

	dbDelta( $placements_sql );
	dbDelta( $folders_sql );
	dbDelta( $tombstones_sql );
	dbDelta( $stored_files_sql );

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
	// `(owner_id, parent_id, file_type, file_ref)` rows down to
	// the lowest id.
	desktop_mode_files_dedupe_placements();

	// v5: enforce uniqueness at the DB level so a future bug
	// (or a racing pair of REST requests) can never re-create
	// the duplicate shortcuts again. Must run AFTER dedupe —
	// adding a unique key against duplicate rows would fail.
	desktop_mode_files_ensure_unique_placement_index();

	// v9: belt-and-suspenders existence check for the shares +
	// decisions tables. The folder-sharing feature is the
	// canonical source of truth for "who can see this folder" —
	// the `share_meta` JSON column on the folders table remains
	// for diagnostic purposes only and is not consulted by the
	// visibility resolver.
	desktop_mode_files_ensure_shares_table();
	desktop_mode_files_ensure_decisions_table();

	// v10: `updated_by` column on placements so the If-Match 409
	// conflict toast names the SESSION that actually won the race,
	// not just whoever currently owns the row. Critical for the
	// shared-write scenario where User B (writer recipient) moves a
	// placement and User C gets the conflict — without this column,
	// the toast would blame User A (owner of the row).
	desktop_mode_files_ensure_updated_by_column();

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

	// Two-worker race protection: between the INFORMATION_SCHEMA
	// check and the ALTER, a concurrent worker (cron + admin-init,
	// REST + heartbeat) can run the same check, see the column
	// missing, and both fire ALTER. The second hits MySQL error
	// 1060 ("Duplicate column"). Suppressing wpdb errors around
	// the ALTER swallows that benign log line. The column ends up
	// present either way — we re-verify with a second
	// INFORMATION_SCHEMA query and only surface an error when the
	// column is genuinely missing after the attempt.
	$ensure = static function ( $table, $column, $definition ) use ( $wpdb ) {
		$col_exists = static function () use ( $wpdb, $table, $column ) {
			return (int) $wpdb->get_var(
				$wpdb->prepare(
					"SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
					WHERE TABLE_SCHEMA = DATABASE()
						AND TABLE_NAME = %s
						AND COLUMN_NAME = %s",
					$table,
					$column
				)
			);
		};
		if ( $col_exists() > 0 ) {
			return;
		}
		$prev_suppress = $wpdb->suppress_errors( true );
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$wpdb->query( "ALTER TABLE `{$table}` ADD COLUMN `{$column}` {$definition}" );
		$wpdb->suppress_errors( $prev_suppress );
		// Belt-and-suspenders: if the column STILL isn't there
		// after the ALTER (real schema error, not a race), retry
		// once unsuppressed so WP_DEBUG users see the cause.
		if ( $col_exists() === 0 ) {
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
 * Collapse duplicate `(owner_id, parent_id, file_type, file_ref)`
 * placement rows down to the lowest id, deleting the rest. The
 * DELETE is restricted to `file_type IN ('shortcut','folder')` —
 * the types where legacy duplicates were actually observed. Note
 * that the v5 `placement_unique` index added right after this
 * covers EVERY file type, so duplicates of any type within the
 * same (owner, parent) are disallowed at the DB level; if legacy
 * duplicates of another type exist, the (error-suppressed)
 * `ADD UNIQUE` in
 * `desktop_mode_files_ensure_unique_placement_index()` will fail
 * and leave the index absent until those rows are cleaned up.
 *
 * @since 0.8.0
 * @internal
 */
function desktop_mode_files_dedupe_placements() {
	global $wpdb;
	$tables = desktop_mode_files_table_names();
	$tbl    = $tables['placements'];

	// Once the unique index exists, MySQL prevents duplicate
	// inserts at the DB level — dedupe is a no-op and the
	// table-scanning DELETE is pure waste on every install_schema
	// call. Skip in that case so the cost is paid exactly once,
	// during the v4 → v5 migration.
	$has_unique = (int) $wpdb->get_var(
		$wpdb->prepare(
			"SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
			WHERE TABLE_SCHEMA = DATABASE()
				AND TABLE_NAME   = %s
				AND INDEX_NAME   = %s",
			$tbl,
			'placement_unique'
		)
	);
	if ( $has_unique > 0 ) {
		return;
	}

	// Self-join keeps the minimum id per (user_id, parent_id,
	// file_type, file_ref) and deletes everything else. Restricted
	// to shortcut + folder placements, where duplicates are never
	// intentional.
	// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
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

/**
 * Add a UNIQUE index on
 * `(owner_id, parent_id, file_type, file_ref)` to make duplicate
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
		// Suppress errors on the ADD KEY in case a concurrent
		// worker won the same race (MySQL 1061: "Duplicate key
		// name"). The index ends up present either way; the
		// check-then-add pattern is benign under contention.
		$prev_suppress = $wpdb->suppress_errors( true );
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$wpdb->query(
			"ALTER TABLE `{$tbl}`
			ADD UNIQUE KEY `placement_unique`
				(owner_id, parent_id, file_type, file_ref)"
		);
		$wpdb->suppress_errors( $prev_suppress );
	}
}

/**
 * Add the v10 `updated_by` column to the placements table.
 *
 * Tracks which user last mutated the row (created, moved, restored).
 * Used by `desktop_mode_files_check_if_match()` so the If-Match 409
 * conflict toast attributes the change to the SESSION that won the
 * race rather than to the row's static owner — critical when a
 * writer recipient of a shared folder rearranges placements and
 * another viewer hits a stale `If-Match`.
 *
 * NULL on legacy rows (pre-v10). The conflict resolver falls back
 * to `owner_id` when this column is NULL, matching the old behavior.
 *
 * @since 0.8.5 (schema v10)
 * @internal
 */
function desktop_mode_files_ensure_updated_by_column() {
	global $wpdb;
	$tables = desktop_mode_files_table_names();
	$tbl    = $tables['placements'];
	$exists = (int) $wpdb->get_var(
		$wpdb->prepare(
			"SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
			WHERE TABLE_SCHEMA = DATABASE()
				AND TABLE_NAME = %s
				AND COLUMN_NAME = %s",
			$tbl,
			'updated_by'
		)
	);
	if ( 0 === $exists ) {
		// Suppress errors so a concurrent worker that already won
		// the same race doesn't fire a benign MySQL 1060
		// ("Duplicate column"). The column ends up present either
		// way.
		$prev_suppress = $wpdb->suppress_errors( true );
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$wpdb->query( "ALTER TABLE `{$tbl}` ADD COLUMN `updated_by` BIGINT UNSIGNED NULL AFTER `owner_id`" );
		$wpdb->suppress_errors( $prev_suppress );
	}
}

/**
 * Rename `placements.user_id` to `placements.owner_id` and the
 * matching `user_parent` index to `owner_parent`. The two
 * desktop-mode-owned tables historically used different names for
 * the same "row's owner" concept — folders carried `owner_id` from
 * day one, placements carried `user_id`. v11 unifies them so SQL
 * and PHP read identically across the two tables.
 *
 * Idempotent: skips when the table doesn't exist (fresh install —
 * dbDelta runs after this and creates the table with the new
 * column name directly) and when the column is already renamed.
 *
 * Must run BEFORE `dbDelta( $placements_sql )` in
 * `desktop_mode_files_install_schema()` — dbDelta does NOT rename
 * columns, so against a v≤10 table whose definition says
 * `owner_id` it would ADD a new `owner_id` column and leave the
 * stale `user_id` in place. Running the CHANGE COLUMN first puts
 * the table in the desired shape so dbDelta sees no diff.
 *
 * Schema version was bumped from 11 to 12 so any install that
 * stamped 11 but never actually renamed the column (a silent
 * partial run during dev iteration) gets a clean retry. The
 * function is idempotent — early-returns when `user_id` is absent,
 * so healthy v11 installs see a cheap no-op on the retry.
 *
 * @since 0.8.9 (schema v11, redelivered at v12)
 * @internal
 */
function desktop_mode_files_rename_user_id_to_owner_id() {
	global $wpdb;
	$tables = desktop_mode_files_table_names();
	$tbl    = $tables['placements'];

	// Fresh install — the table doesn't exist yet; dbDelta creates
	// it with `owner_id` directly. Nothing to migrate.
	$table_exists = (int) $wpdb->get_var(
		$wpdb->prepare(
			"SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
			WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s",
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
		return; // Already renamed (or column was never there — fresh install via test factory).
	}

	// DELIBERATELY NOT suppressing errors here. An earlier draft
	// wrapped the ALTER in `suppress_errors( true )` "in case of
	// concurrent migration race" — there's no realistic race for
	// this ALTER (schema migrations run inside one request) and the
	// suppression hid a real failure mode on at least one local
	// install: the option got stamped at v11 but the CHANGE COLUMN
	// never landed, so every later placements query 500'd silently.
	// Let any wpdb error surface to `debug.log` so the failure is
	// visible the next time this code runs.
	// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	$wpdb->query(
		"ALTER TABLE `{$tbl}` CHANGE COLUMN `user_id` `owner_id` BIGINT UNSIGNED NOT NULL"
	);

	// MySQL/MariaDB auto-update index column references on CHANGE
	// COLUMN, but the index NAMES are baked in. Rename them too so
	// `EXPLAIN`/`SHOW INDEX` output reads consistently with the
	// column.
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
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$wpdb->query( "ALTER TABLE `{$tbl}` RENAME INDEX `user_parent` TO `owner_parent`" );
	}
}

/**
 * Belt-and-suspenders verifier for the v8 `shares` table. `dbDelta`
 * has known edge cases where a brand-new table with `UNIQUE KEY`
 * declarations on a non-`utf8mb4` collation gets silently skipped
 * on some MySQL/MariaDB combos; we mirror the trash-columns
 * pattern and `CREATE TABLE IF NOT EXISTS` the row explicitly.
 *
 * @since 0.8.5
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
			// Same TOCTOU rationale as the other ensure_* helpers
			// — concurrent worker that already added the column
			// surfaces a benign MySQL 1060 we should swallow.
			$prev_suppress = $wpdb->suppress_errors( true );
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$wpdb->query( "ALTER TABLE `{$tbl}` ADD COLUMN `target_type` VARCHAR(32) NOT NULL DEFAULT 'folder' AFTER `id`" );
			$wpdb->suppress_errors( $prev_suppress );
		}
	}
}

/**
 * Belt-and-suspenders verifier for the decisions table.
 *
 * @since 0.8.5
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
