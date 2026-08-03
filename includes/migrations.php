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
 */
const OPENSTATION_MIGRATION_VERSION = 4;

/** Option storing the highest migration version that has run. autoload=no. */
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
	/**
	 * Filters the pre-brand => brand value map the rebrand migration
	 * applies, keyed by OS-settings field. Return an empty array to skip
	 * the migration entirely and leave every stored preference alone.
	 *
	 * @param array $map Map of setting key => array( 'from' => old, 'to' => new ).
	 */
	$map = (array) apply_filters(
		'openstation_brand_migration_map',
		array(
			'accent'    => array( 'from' => 'wp-blue', 'to' => 'pulse' ),
			'wallpaper' => array( 'from' => 'dark', 'to' => 'galaxy' ),
		)
	);
	if ( empty( $map ) ) {
		return;
	}

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
			'fields'     => 'ID',
			'meta_key'   => OPENSTATION_OS_SETTINGS_META_KEY, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key -- one-time migration; the key is indexed in usermeta and the scan is guarded to run once.
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
