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
 * - 5: records that this install predates the rebrand, so the shell can
 *   explain the new name once to the people it happened to. Sets a flag
 *   and nothing else — see {@see openstation_migrate_flag_rebrand_notice}
 *   for why that is a separate migration from 4.
 */
const OPENSTATION_MIGRATION_VERSION = 5;

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
}

/**
 * Option marking this install as one that predates the rebrand.
 *
 * Present and truthy => the shell offers each user the one-off
 * rebrand announcement. Absent => this install has only ever known
 * the name OpenStation and there is nothing to announce. autoload=yes:
 * every shell boot reads it.
 *
 * The VALUE keeps the pre-rebrand spelling for the reason every other
 * stored key does — see {@see OPENSTATION_MIGRATION_OPTION}.
 */
const OPENSTATION_REBRAND_NOTICE_OPTION = 'desktop_mode_rebrand_notice';

/**
 * Slug the rebrand announcement records in `desktop_mode_seen_intros`.
 *
 * A slug in the shared registry rather than a bespoke meta key, so the
 * announcement is dismissed, reset and reasoned about exactly like the
 * native-window intros beside it.
 */
const OPENSTATION_REBRAND_INTRO_SLUG = 'openstation-rebrand';

/**
 * Migration 5 — remember that this install was here before the rebrand.
 *
 * Migration 4 moved the pre-brand *defaults* onto the brand ones. This
 * one answers a different question: not "what should this desk look
 * like" but "does this person need to be told why it changed". A user
 * who has been running Desktop Mode for months opens wp-admin one
 * morning to a differently-named, differently-coloured shell; without a
 * word of explanation that reads as a compromised site, not a release.
 *
 * The signal is the stored migration version as it was BEFORE this run:
 *
 *   - `1`–`3` — the install has run migrations under the old name, so
 *     it predates the rebrand. Flag it.
 *   - `0` — no migration has ever run here. That is a fresh install,
 *     which has only ever seen OpenStation. Nothing to explain.
 *   - `4` — the rebrand migration already ran, which today means a
 *     checkout tracking trunk between the two release tags. Not a
 *     surprised user.
 *
 * Deliberately NOT folded into migration 4, even though the two ship
 * together: 4 has already run on trunk checkouts, and a migration that
 * has run does not run again. Extending it would have silently skipped
 * the flag exactly where it was easiest to believe it had been set.
 *
 * Note this flags the INSTALL, not each user. Dismissal is per-user and
 * lives in the seen-intros registry, so one admin dismissing the
 * announcement does not silence it for their editors. The flag is
 * never cleared: "Reset what's-new dialogs" in OpenStation Settings →
 * Features brings the announcement back with every other intro.
 *
 * @param int $from The highest migration version already applied.
 * @return void
 */
function openstation_migrate_flag_rebrand_notice( $from ) {
	$from = (int) $from;

	/**
	 * Filters whether this install is treated as predating the rebrand.
	 *
	 * The one chance to opt a site out wholesale — a host rolling
	 * OpenStation out to fleet sites that never saw the old name, or an
	 * agency that would rather brief its clients itself. Returning false
	 * suppresses the announcement for every user on the site.
	 *
	 * @param bool $predates Whether the install predates the rebrand.
	 * @param int  $from     The highest migration version already applied.
	 */
	$predates = (bool) apply_filters(
		'openstation_install_predates_rebrand',
		$from > 0 && $from < 4,
		$from
	);

	if ( ! $predates ) {
		return;
	}

	update_option( OPENSTATION_REBRAND_NOTICE_OPTION, 1 );
}

/**
 * Whether the current user should be offered the rebrand announcement.
 *
 * Two gates: the install predates the rebrand (migration 5's flag), and
 * this user has not already dismissed it. The seen-intros registry owns
 * the second one, which is what makes the announcement behave like
 * every other one-time dialog — including being brought back by "Reset
 * what's-new dialogs".
 *
 * @return bool
 */
function openstation_should_show_rebrand_notice() {
	if ( ! get_option( OPENSTATION_REBRAND_NOTICE_OPTION ) ) {
		return false;
	}

	$user_id = get_current_user_id();
	if ( ! $user_id ) {
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
			'accent'    => array(
				'from' => 'wp-blue',
				'to'   => 'pulse',
			),
			'wallpaper' => array(
				'from' => 'dark',
				'to'   => 'galaxy',
			),
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
