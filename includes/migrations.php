<?php
/**
 * OpenStation — one-time data migrations.
 *
 * A tiny, option-versioned migration runner modeled on the lazy schema
 * installer in `includes/desktop-files/schema.php`: a stored option holds
 * the highest migration version that has run; on every admin load we
 * compare it against {@see OPENSTATION_MIGRATION_VERSION} and run any
 * pending migrations exactly once. Guarded so it is a cheap no-op after
 * the first successful pass.
 *
 * On a site with no history the runner fires at activation instead, so
 * nothing here ever has to infer the past of a site from evidence that
 * site wrote after it was installed. See
 * {@see openstation_run_migrations_on_activation}.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Highest migration version shipped by the plugin.
 *
 * Bump this (and add a matching branch in
 * {@see openstation_run_pending_migrations}) whenever a new one-time
 * migration is needed.
 *
 * A new migration runs on every install, including brand-new ones: on a
 * site with no history the runner fires at activation
 * ({@see openstation_run_migrations_on_activation}) rather than on the
 * first `admin_init`.
 *
 * - 1: native list windows flipped from opt-out (default ON) to opt-in
 *   Beta (default OFF). Clears the five `native*Enabled` flags from every
 *   user who had them persisted so the whole install reverts to opt-in.
 * - 2: post & taxonomy-term AI analysis was removed (the copilot now only
 *   analyzes comments for spam, and the assistant finds content via native
 *   WordPress search). Unschedules any queued `desktop_mode_ai_analyze_post`
 *   / `desktop_mode_ai_analyze_term` cron events left over from prior versions.
 * - 3: the copilot dropped its self-managed AI credentials in favour of
 *   WordPress 7.0 Connectors. Deletes the platform key option and strips the
 *   per-user `apiKey` / `apiKeys` / `provider` / `transport` fields from the
 *   stored OS settings so no provider secret lingers in the database.
 * - 4: the OpenStation brand. Moves anyone still sitting on the PRE-brand
 *   defaults — accent `wp-blue`, wallpaper `dark` — onto the new ones,
 *   Pulse and Galaxy. Without it the rebrand only reaches fresh accounts:
 *   the stored snapshot is authoritative over the shipped default, so an
 *   existing desk keeps a blue accent on every focus ring, tab underline
 *   and sort arrow.
 * - 5: flags the users who were using Desktop Mode before the rename, so
 *   the shell can explain the new name once to the people it happened
 *   to and to nobody else. Sets user meta and nothing else — see
 *   {@see openstation_migrate_flag_rebrand_notice} for why that is a
 *   separate migration from 4.
 * - 6: the Trash stopped registering a desktop icon. Removes the
 *   placement the shell had auto-placed for it and closes the hole that
 *   leaves in the icon column.
 */
const OPENSTATION_MIGRATION_VERSION = 6;

/**
 * Option storing the highest migration version that has run. autoload=no.
 *
 * The VALUE keeps its pre-rebrand spelling on purpose: it is a
 * persisted or externally-visible identifier, so renaming it would
 * orphan data already written by live installs (or break a live
 * URL). The mismatch between this constant's name and its value is
 * deliberate — it is NOT a half-finished rename.
 */
const OPENSTATION_MIGRATION_OPTION = 'desktop_mode_migration_version';

/**
 * Runs any pending migrations, then records the new high-water mark.
 *
 * Idempotent: bails immediately when the stored version is already at
 * or above the shipped version, so it is safe to fire on every request.
 *
 * @return void
 */
function openstation_maybe_run_migrations() {
	$installed = (int) get_option( OPENSTATION_MIGRATION_OPTION, 0 );
	if ( $installed >= OPENSTATION_MIGRATION_VERSION ) {
		return;
	}

	openstation_run_pending_migrations( $installed );

	update_option( OPENSTATION_MIGRATION_OPTION, OPENSTATION_MIGRATION_VERSION, false );
}
add_action( 'admin_init', 'openstation_maybe_run_migrations' );

/**
 * Runs the pending migrations at activation, on a site with no history.
 *
 * Migration 5 infers who used the shell before the rename from user meta
 * that a site can write to itself between activation and the first
 * `admin_init` (the portal auto-enable). Running at activation is the
 * one moment that window is still shut, so the same runner reaches the
 * same conclusion about the same site and cannot be fooled by evidence
 * that arrives later.
 *
 * The whole runner, not a subset: migrations 2 and 3 clear leftover AI
 * cron events and a stored provider credential, neither of which any
 * user meta predicts.
 *
 * @return void
 */
function openstation_run_migrations_on_activation() {
	// Migrations have already run here; their high-water mark is the
	// truth and the runner would be a no-op anyway.
	if ( false !== get_option( OPENSTATION_MIGRATION_OPTION, false ) ) {
		return;
	}

	// The site has history, so this is a reactivation and not a new
	// install. Leave it to `admin_init`, where migration 5 reads meta
	// that is genuinely older than this request.
	$prior_users = openstation_users_with_prior_desktop_use();
	if ( ! empty( $prior_users ) ) {
		return;
	}

	openstation_maybe_run_migrations();
}
register_activation_hook( OPENSTATION_FILE, 'openstation_run_migrations_on_activation' );

/**
 * Dispatches each migration whose version is newer than what has run.
 *
 * @param int $from The highest migration version already applied.
 * @return void
 */
function openstation_run_pending_migrations( $from ) {
	$from = (int) $from;

	if ( $from < 1 ) {
		openstation_migrate_os_settings_optin();
	}

	if ( $from < 2 ) {
		openstation_migrate_unschedule_post_term_ai();
	}

	if ( $from < 3 ) {
		openstation_migrate_delete_ai_keys();
	}

	if ( $from < 4 ) {
		openstation_migrate_brand_defaults();
	}

	if ( $from < 5 ) {
		openstation_migrate_flag_rebrand_notice( $from );
	}

	if ( $from < 6 ) {
		openstation_migrate_close_recycle_bin_icon_gap();
	}
}

/**
 * Grid the desktop auto-placer lays icons out on: 16px of padding, a
 * 96px column, a 110px row. Mirrored from `src/desktop-files/grid.ts`
 * via {@see openstation_files_auto_place_orphans}, which is what wrote
 * the coordinates this migration edits.
 */
const OPENSTATION_DESKTOP_GRID_ROW_H = 110;

/**
 * Migration 6 — take back the Trash's desktop icon, and close the hole.
 *
 * The bin used to register a desktop icon, and every viewer's first
 * hydrate auto-placed it into the icon column. Now that the
 * registration is gone the placement is dead weight: it is no longer
 * served (`OpenStation_Shortcut_File::can_read()` is false without a
 * registry entry), so the tile has already vanished on its own. What it
 * leaves behind is an empty cell with the icons that were under it
 * still sitting where they were.
 *
 * So: delete the row, and pull everything below it in the same column
 * up by one. Same column only, because the auto-placer fills
 * column-major, so a column is the run the bin was part of. This does
 * move tiles a user may have arranged, which is the point — the shell
 * put that icon there and the shell is taking it away, so the shell
 * tidies up after itself rather than leaving a gap nobody chose.
 *
 * A user who wants the bin back on the wallpaper picks "On the desktop"
 * in Apps & Plugins, which promotes the dock tile and never touches
 * these rows.
 *
 * @return void
 */
function openstation_migrate_close_recycle_bin_icon_gap() {
	global $wpdb;

	if ( ! function_exists( 'openstation_files_table_names' ) ) {
		return;
	}
	$tables = openstation_files_table_names();
	$tbl    = $tables['placements'];

	// The files schema installs lazily, so a site that never opened
	// the desktop has no table to migrate.
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

	// Shift first, delete second: the derived table has to still find
	// the bin's own row to know which cell is being vacated. It is
	// materialized before the update runs, so reading and writing the
	// same table in one statement is fine here.
	//
	// The UNIQUE index on (owner_id, parent_id, file_type, file_ref)
	// guarantees at most one bin row per owner, so no row can be
	// shifted twice.
	$wpdb->query(
		$wpdb->prepare(
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name, not user input.
			"UPDATE `{$tbl}` AS p
			INNER JOIN (
				SELECT owner_id, x, y FROM `{$tbl}`
				WHERE parent_id = 0
					AND file_type = 'shortcut'
					AND file_ref  = %s
			) AS bin
				ON p.owner_id = bin.owner_id
				AND p.x       = bin.x
				AND p.y       > bin.y
			SET p.y = p.y - %d
			WHERE p.parent_id = 0
				AND p.trashed_at_ms IS NULL",
			'desktop-mode-recycle-bin',
			OPENSTATION_DESKTOP_GRID_ROW_H
		)
	);

	$wpdb->delete(
		$tbl,
		array(
			'parent_id' => 0,
			'file_type' => 'shortcut',
			'file_ref'  => 'desktop-mode-recycle-bin',
		),
		array( '%d', '%s', '%s' )
	);
}

/**
 * User meta marking someone as a Desktop Mode user from before the rebrand.
 *
 * Present and truthy => the shell offers this user the one-off rebrand
 * announcement, once. Absent => they never used the plugin under its old
 * name, so there is no rename to explain to them. Written only by
 * migration 5, and only for users who were actually using Desktop Mode
 * at the moment it ran.
 *
 * The VALUE keeps the pre-rebrand spelling for the reason every other
 * stored key does — see {@see OPENSTATION_MIGRATION_OPTION}.
 */
const OPENSTATION_REBRAND_NOTICE_META_KEY = 'desktop_mode_rebrand_notice';

/**
 * Slug the rebrand announcement records in `desktop_mode_seen_intros`.
 *
 * A slug in the shared registry rather than a bespoke meta key, so the
 * announcement is dismissed, reset and reasoned about exactly like the
 * native-window intros beside it.
 */
const OPENSTATION_REBRAND_INTRO_SLUG = 'openstation-rebrand';

/**
 * Every user who carries proof of having used the shell on this site:
 * `desktop_mode_mode` (the per-user opt-in, tested for EXISTENCE rather
 * than for being `'1'`, since switching back to classic empties the
 * value but leaves the row) or a saved `desktop_mode_os_settings`.
 *
 * @return int[] User IDs, unsorted and deduplicated.
 */
function openstation_users_with_prior_desktop_use() {
	return array_map(
		'intval',
		array_unique(
			array_merge(
				get_users(
					array(
						'fields'       => 'ID',
						'meta_key'     => 'desktop_mode_mode', // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key -- runs once per install; the key is indexed in usermeta and both callers are guarded to a single pass.
						'meta_compare' => 'EXISTS',
					)
				),
				get_users(
					array(
						'fields'       => 'ID',
						'meta_key'     => OPENSTATION_OS_SETTINGS_META_KEY, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key -- see above.
						'meta_compare' => 'EXISTS',
					)
				)
			)
		)
	);
}

/**
 * Migration 5 — remember who was using Desktop Mode before the rebrand.
 *
 * Migration 4 moved the pre-brand *defaults* onto the brand ones. This
 * one answers a different question: not "what should this desk look
 * like" but "does this person need to be told why it changed". Someone
 * who has been running Desktop Mode for months opens wp-admin one
 * morning to a differently-named, differently-coloured shell; without a
 * word of explanation that reads as a compromised site, not a release.
 *
 * Two gates. The install gate is a bare "has the rebrand already
 * happened here", and the user gate does the actual work.
 *
 * **The install** must not already be past the rebrand: `$from < 4`. A
 * `4` means migration 4 has run, which today means a checkout tracking
 * trunk between the two release tags. Not a surprised user.
 *
 * Note what is deliberately NOT tested: whether `$from` is zero. It is
 * tempting to read `0` as "fresh install, nothing to explain", and that
 * reading is wrong in the one direction that matters. The migration
 * runner itself only shipped in 0.9.1, so an install still on 0.9.0 or
 * earlier that updates straight to the rebrand release has no stored
 * version at all and arrives here with `$from === 0`, indistinguishable
 * from a brand new site. Those are the installs that update rarely,
 * which makes them the ones most likely to be blindsided by a rename,
 * and gating on `$from > 0` would have silenced precisely them.
 *
 * **The user** has to have actually used it — see
 * {@see openstation_users_with_prior_desktop_use} for what counts as
 * proof. That separates a long-dormant install from a genuinely new one
 * without needing to date the install at all, and it keeps the
 * announcement away from an editor who joined an old site last week and
 * enabled OpenStation this morning.
 *
 * What that gate does NOT do on its own is prove the evidence is old.
 * On a new install it can be written between activation and the first
 * `admin_init`, and then read back here as history. That window is
 * closed by {@see openstation_run_migrations_on_activation}, which runs
 * this migration before anything can write it.
 *
 * Deliberately NOT folded into migration 4, even though the two ship
 * together: 4 has already run on trunk checkouts, and a migration that
 * has run does not run again. Extending it would have silently skipped
 * the flag exactly where it was easiest to believe it had been set.
 *
 * Flags are never cleared. Dismissal lives in the seen-intros registry,
 * so one admin dismissing the announcement does not silence it for
 * their editors, and "Reset what's-new dialogs" in OpenStation Preferences
 * → Features brings it back with every other intro.
 *
 * @param int $from The highest migration version already applied.
 * @return void
 */
function openstation_migrate_flag_rebrand_notice( $from ) {
	if ( (int) $from >= 4 ) {
		return;
	}

	foreach ( openstation_users_with_prior_desktop_use() as $user_id ) {
		update_user_meta( $user_id, OPENSTATION_REBRAND_NOTICE_META_KEY, 1 );
	}
}

/**
 * Whether the current user should be offered the rebrand announcement.
 *
 * Two gates: migration 5 flagged this user as one who was using Desktop
 * Mode before the rename, and they have not already dismissed it. The
 * seen-intros registry owns the second one, which is what makes the
 * announcement behave like every other one-time dialog — including
 * being brought back by "Reset what's-new dialogs".
 *
 * Only ever consulted while building the shell config, which is itself
 * behind the `openstation_is_enabled()` / not-classic guard in
 * `includes/render/assets.php`. So the announcement cannot reach the
 * classic admin or a chromeless iframe: the bundle that would show it
 * is not loaded there.
 *
 * @return bool
 */
function openstation_should_show_rebrand_notice() {
	$user_id = get_current_user_id();
	if ( ! $user_id ) {
		return false;
	}

	if ( ! get_user_meta( $user_id, OPENSTATION_REBRAND_NOTICE_META_KEY, true ) ) {
		return false;
	}

	return ! openstation_has_seen_intro( $user_id, OPENSTATION_REBRAND_INTRO_SLUG );
}

/**
 * Migration 4 — move the pre-brand defaults onto the OpenStation ones.
 *
 * The stored OS-settings snapshot outranks the shipped default, so
 * changing `openstation_default_os_settings()` reaches new accounts and
 * nobody else. Every existing desk would keep `wp-blue` on its focus
 * rings, tab underlines, sort arrows and selection washes, and keep the
 * graphite `dark` desk under the station's chrome — a half-applied
 * rebrand, which reads as a bug rather than as a choice.
 *
 * **Only values still equal to the OLD default are touched.** A user who
 * picked Indigo, or the Snow wallpaper, expressed a preference and keeps
 * it. The one unavoidable cost is the user who deliberately chose
 * WordPress Blue — indistinguishable from never having chosen at all,
 * because it WAS the default — and for them it is one click in
 * OS Settings → Appearance to set it back.
 *
 * Users with no stored settings are skipped entirely: they read the new
 * defaults already.
 *
 * @return void
 */
function openstation_migrate_brand_defaults() {
	// The pre-brand => brand value map, keyed by OS-settings field.
	// Deliberately not filterable: this runs once, against one release's
	// stored defaults, and a third party rewriting which values get
	// migrated would leave desks in a state no later migration accounts
	// for.
	$map = array(
		'accent'    => array(
			'from' => 'wp-blue',
			'to'   => 'pulse',
		),
		'wallpaper' => array(
			'from' => 'dark',
			'to'   => 'galaxy',
		),
	);

	$user_ids = get_users(
		array(
			'fields'       => 'ID',
			'meta_key'     => OPENSTATION_OS_SETTINGS_META_KEY, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key -- one-time migration; the key is indexed in usermeta and the scan is guarded to run once.
			'meta_compare' => 'EXISTS',
		)
	);

	foreach ( $user_ids as $user_id ) {
		$raw = get_user_meta( (int) $user_id, OPENSTATION_OS_SETTINGS_META_KEY, true );
		if ( ! is_array( $raw ) ) {
			continue;
		}

		$changed = false;
		foreach ( $map as $key => $move ) {
			if ( ! isset( $move['from'], $move['to'] ) ) {
				continue;
			}
			// An absent key already resolves to the new default.
			if ( isset( $raw[ $key ] ) && $move['from'] === $raw[ $key ] ) {
				$raw[ $key ] = $move['to'];
				$changed     = true;
			}
		}

		if ( $changed ) {
			openstation_save_os_settings( (int) $user_id, $raw );
		}
	}
}

/**
 * Migration 1 — reset the native list windows to opt-in.
 *
 * The native Posts/Pages/Users/Plugins/Comments windows used to default
 * ON (opt-out). The shell persists the whole OS-settings object on every
 * change, so most active users already have these flags stored as `true`
 * and would keep the native UI even after the default flips. This clears
 * the five flags from every user who has the meta, leaving the rest of
 * their settings (wallpaper, accent, dock order, …) untouched. On the
 * next read the cleared keys fall back to the new `false` default, so the
 * whole install lands on opt-in and users re-enable each window from
 * OS Settings → Features → Beta features.
 *
 * Only users who actually have the meta are queried — fresh accounts and
 * users who never touched OS Settings are skipped entirely.
 *
 * @return void
 */
function openstation_migrate_os_settings_optin() {
	$flags = array(
		'nativePostsEnabled',
		'nativePagesEnabled',
		'nativeUsersEnabled',
		'nativePluginsEnabled',
		'nativeCommentsEnabled',
	);

	$user_ids = get_users(
		array(
			'fields'       => 'ID',
			'meta_key'     => OPENSTATION_OS_SETTINGS_META_KEY, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key -- one-time migration; the key is indexed in usermeta and the scan is guarded to run once.
			'meta_compare' => 'EXISTS',
		)
	);

	foreach ( $user_ids as $user_id ) {
		$raw = get_user_meta( (int) $user_id, OPENSTATION_OS_SETTINGS_META_KEY, true );
		if ( ! is_array( $raw ) ) {
			continue;
		}

		$changed = false;
		foreach ( $flags as $flag ) {
			if ( array_key_exists( $flag, $raw ) ) {
				unset( $raw[ $flag ] );
				$changed = true;
			}
		}

		if ( ! $changed ) {
			continue;
		}

		// Re-save through the canonical sanitizer so the cleared flags are
		// backfilled with the new `false` default and the rest of the
		// settings array is normalized exactly as a client write would be.
		openstation_save_os_settings( (int) $user_id, $raw );
	}
}

/**
 * Migration 2 — unschedule leftover post/term AI analysis jobs.
 *
 * Post and taxonomy-term analysis was removed: the copilot now only
 * analyzes comments (for the spam score), and the AI assistant finds
 * content with native WordPress keyword search. Their cron callbacks no
 * longer exist, so any single-events still queued from a prior version
 * would simply no-op — but we clear them so the cron array stays tidy and
 * `wp cron event list` doesn't show orphaned hooks.
 *
 * Existing `_desktop_mode_ai_analysis` meta on posts/terms is left in place
 * (hidden, harmless, and cheap to ignore).
 *
 * @return void
 */
function openstation_migrate_unschedule_post_term_ai() {
	wp_unschedule_hook( 'desktop_mode_ai_analyze_post' );
	wp_unschedule_hook( 'desktop_mode_ai_analyze_term' );
}

/**
 * Migration 3 — delete self-managed AI credentials.
 *
 * WordPress 7.0 owns provider credentials (Settings → Connectors), so the
 * copilot no longer stores keys of its own. Remove the platform key option and
 * strip the now-unused key / provider / model / transport fields from every
 * user's stored OS settings so no secret is left behind. The only `ai` field
 * that remains is `enabled` (the per-user assistant toggle), backfilled from
 * defaults on next read.
 *
 * @return void
 */
function openstation_migrate_delete_ai_keys() {
	// Platform-wide key option (formerly `desktop_mode_ai_platform`).
	delete_option( 'desktop_mode_ai_platform' );

	$user_ids = get_users(
		array(
			'fields'       => 'ID',
			'meta_key'     => OPENSTATION_OS_SETTINGS_META_KEY, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key -- one-time migration; guarded to run once.
			'meta_compare' => 'EXISTS',
		)
	);

	foreach ( $user_ids as $user_id ) {
		$raw = get_user_meta( (int) $user_id, OPENSTATION_OS_SETTINGS_META_KEY, true );
		if ( ! is_array( $raw ) || ! isset( $raw['ai'] ) || ! is_array( $raw['ai'] ) ) {
			continue;
		}

		// Strip every legacy AI field: the self-managed credentials/transport,
		// plus the `provider` / `model` preferences — provider + model selection
		// is now delegated entirely to the Core AI Client.
		$changed = false;
		foreach ( array( 'apiKey', 'apiKeys', 'transport', 'provider', 'model' ) as $stale ) {
			if ( array_key_exists( $stale, $raw['ai'] ) ) {
				unset( $raw['ai'][ $stale ] );
				$changed = true;
			}
		}

		if ( ! $changed ) {
			continue;
		}

		openstation_save_os_settings( (int) $user_id, $raw );
	}
}
