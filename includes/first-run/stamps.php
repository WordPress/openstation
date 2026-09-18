<?php
/**
 * OpenStation — first-run stamps.
 *
 * Three timestamps that answer "did this install ever get turned on,
 * and how fast?" — a question nothing on the site could answer before
 * them. OpenStation is opt-in per user, so a site can carry the plugin
 * active for months with nobody ever in the shell, and that is the
 * install that gets deleted at the next plugin cleanup.
 *
 * | Name                            | Kind          | Value                        |
 * |---------------------------------|---------------|------------------------------|
 * | `openstation_installed_at`      | option (no autoload) | `{ at, via }`         |
 * | `openstation_first_enabled_at`  | option (no autoload) | `{ at, via }`         |
 * | `openstation_enabled_at`        | user meta     | epoch seconds                |
 *
 * `via` is `activation` when the activation hook wrote the stamp at
 * the real moment, and `backfill` when the stamp was reconstructed
 * later for an install that predates it. A backfilled `at` is the
 * moment we noticed, not the moment it happened, so every age
 * computation here reports "unknown" (`null`) rather than a number
 * that would be wrong by an arbitrary amount. An install with a past
 * is recognised by the user meta the shell leaves behind — nothing
 * removes it on deactivate or delete — so a reactivation on such a
 * site is backfilled too, whatever hook wrote it.
 *
 * The user stamp and the site stamp are written by ONE helper,
 * {@see openstation_record_user_enabled()}, called from both paths
 * that flip a user on — the admin-bar toggle's AJAX handler and the
 * portal's auto-enable — so the two cannot drift. It also fires the
 * `openstation_user_enabled` action, the first enable/disable hook
 * the plugin has had; the matching `openstation_user_disabled` fires
 * from {@see openstation_record_user_disabled()}.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/** Option: when the plugin was activated on this site. autoload=no. */
const OPENSTATION_INSTALLED_AT_OPTION = 'openstation_installed_at';

/** Option: when any user first turned OpenStation on. autoload=no. */
const OPENSTATION_FIRST_ENABLED_AT_OPTION = 'openstation_first_enabled_at';

/** User meta: when this user first turned OpenStation on (epoch seconds). */
const OPENSTATION_ENABLED_AT_META_KEY = 'openstation_enabled_at';

/**
 * Normalises a stored stamp to `{ at: int, via: string }`, or null.
 *
 * @param mixed $raw Raw option value.
 * @return array{at:int,via:string}|null
 */
function openstation_normalise_stamp( $raw ) {
	if ( ! is_array( $raw ) || ! isset( $raw['at'] ) ) {
		return null;
	}
	$via = isset( $raw['via'] ) ? sanitize_key( (string) $raw['via'] ) : 'backfill';
	if ( ! in_array( $via, array( 'activation', 'backfill' ), true ) ) {
		$via = 'backfill';
	}
	return array(
		'at'  => max( 0, (int) $raw['at'] ),
		'via' => $via,
	);
}

/**
 * The install stamp, or null when nothing has written it yet.
 *
 * @return array{at:int,via:string}|null
 */
function openstation_get_install_stamp() {
	return openstation_normalise_stamp( get_option( OPENSTATION_INSTALLED_AT_OPTION, null ) );
}

/**
 * The site's first-enable stamp, or null while nobody has enabled.
 *
 * @return array{at:int,via:string}|null
 */
function openstation_get_first_enabled_stamp() {
	return openstation_normalise_stamp( get_option( OPENSTATION_FIRST_ENABLED_AT_OPTION, null ) );
}

/**
 * When the user first turned OpenStation on, in epoch seconds; 0 when
 * they never have (or did so before the stamp existed).
 *
 * @param int $user_id User ID. Defaults to the current user.
 * @return int
 */
function openstation_get_user_enabled_at( $user_id = 0 ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		$user_id = get_current_user_id();
	}
	if ( $user_id <= 0 ) {
		return 0;
	}
	return max( 0, (int) get_user_meta( $user_id, OPENSTATION_ENABLED_AT_META_KEY, true ) );
}

/**
 * Writes the install stamp if, and only if, it is absent.
 *
 * Idempotent on purpose: activation fires again on every deactivate /
 * reactivate cycle, and the first activation is the one that counts.
 *
 * A site with prior desktop use ({@see openstation_users_with_prior_desktop_use()})
 * predates the stamps whatever `$via` says: the plugin was there
 * before, was deactivated or deleted with the user meta left behind,
 * and is being activated again. Its install moment is unknown, so the
 * stamp is written as `backfill`, and so is the first-enable stamp
 * (`at: 0`) when nothing has written it, because someone did enable
 * before the stamps existed and the next enable must not pass for
 * the first. One user query, only while the stamp is absent.
 *
 * @param string $via `activation` or `backfill`.
 * @return bool True when this call wrote the stamp.
 */
function openstation_record_installed( $via = 'activation' ) {
	if ( null !== openstation_get_install_stamp() ) {
		return false;
	}
	$via = 'activation' === $via ? 'activation' : 'backfill';

	$has_past = function_exists( 'openstation_users_with_prior_desktop_use' )
		&& count( openstation_users_with_prior_desktop_use() ) > 0;
	if ( $has_past ) {
		$via = 'backfill';
		if ( null === openstation_get_first_enabled_stamp() ) {
			add_option(
				OPENSTATION_FIRST_ENABLED_AT_OPTION,
				array(
					'at'  => 0,
					'via' => 'backfill',
				),
				'',
				false
			);
		}
	}

	return (bool) add_option(
		OPENSTATION_INSTALLED_AT_OPTION,
		array(
			'at'  => time(),
			'via' => $via,
		),
		'',
		false
	);
}

/**
 * Activation: stamp the real install moment.
 *
 * @return void
 */
function openstation_stamp_install_on_activation() {
	openstation_record_installed( 'activation' );
}
register_activation_hook( OPENSTATION_FILE, 'openstation_stamp_install_on_activation' );

/**
 * Lazy backfill for installs that predate the stamp.
 *
 * Activation does not fire on an update in place, so an install
 * upgrading into this version has no stamp until someone writes one.
 * `admin_init` is the first admin request after the update, which is
 * the earliest honest "we noticed" moment; `via: backfill` records
 * that the age is unknown. Priority 20 so the migration runner
 * (priority 10) has already had its turn.
 *
 * @return void
 */
function openstation_backfill_install_stamp() {
	openstation_record_installed( 'backfill' );
}
add_action( 'admin_init', 'openstation_backfill_install_stamp', 20 );

/**
 * Records that a user turned OpenStation on.
 *
 * Stamps the user (once), stamps the site (once), then fires
 * `openstation_user_enabled`. Call it from every path that writes
 * `desktop_mode_mode = '1'`; the action fires on every enable, not
 * only the first, so a listener that wants "first time" reads
 * `$first_on_site` or compares the user's stamp against `time()`.
 *
 * @param int $user_id User ID.
 * @return bool True when this enable is the first on the whole site.
 */
function openstation_record_user_enabled( $user_id ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return false;
	}

	$now = time();

	if ( 0 === openstation_get_user_enabled_at( $user_id ) ) {
		update_user_meta( $user_id, OPENSTATION_ENABLED_AT_META_KEY, $now );
	}

	$first_on_site = false;
	if ( null === openstation_get_first_enabled_stamp() ) {
		$first_on_site = (bool) add_option(
			OPENSTATION_FIRST_ENABLED_AT_OPTION,
			array(
				'at'  => $now,
				'via' => 'activation',
			),
			'',
			false
		);
	}

	/**
	 * Fires when a user turns OpenStation on.
	 *
	 * Runs after the per-user and per-site first-enable stamps are
	 * written, on every enable (not only the first for that user).
	 *
	 * @param int  $user_id       The user who enabled OpenStation.
	 * @param bool $first_on_site True when nobody on this site had
	 *                            ever enabled it before this call.
	 */
	do_action( 'openstation_user_enabled', $user_id, $first_on_site );

	return $first_on_site;
}

/**
 * Records that a user turned OpenStation off.
 *
 * No stamp is written — the enabled stamps are "first time" facts and
 * survive a switch back to classic — but the action gives plugins
 * the other half of the lifecycle.
 *
 * @param int $user_id User ID.
 * @return void
 */
function openstation_record_user_disabled( $user_id ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return;
	}

	/**
	 * Fires when a user turns OpenStation off.
	 *
	 * @param int $user_id The user who disabled OpenStation.
	 */
	do_action( 'openstation_user_disabled', $user_id );
}

/**
 * How many whole days since the plugin was installed, or null when the
 * install stamp is missing or backfilled (age unknown).
 *
 * @return int|null
 */
function openstation_install_age_days() {
	$stamp = openstation_get_install_stamp();
	if ( null === $stamp || 'activation' !== $stamp['via'] || $stamp['at'] <= 0 ) {
		return null;
	}
	return max( 0, (int) floor( ( time() - $stamp['at'] ) / DAY_IN_SECONDS ) );
}

/**
 * Whether at least one user enabled OpenStation within `$days` of the
 * install.
 *
 * Returns `true` or `false` when both stamps are real, and `null` when
 * the answer cannot be known: the install stamp is missing or
 * backfilled, or the first enable happened before the stamps existed
 * ({@see openstation_record_installed()} records that as `at: 0, via: backfill`). A site where
 * nobody has enabled yet answers `false` once it is older than
 * `$days`, and `null` while the window is still open.
 *
 * @param int $days Window in days, from install.
 * @return bool|null
 */
function openstation_activation_within( $days ) {
	$days    = max( 0, (int) $days );
	$install = openstation_get_install_stamp();
	if ( null === $install || 'activation' !== $install['via'] || $install['at'] <= 0 ) {
		return null;
	}

	$first = openstation_get_first_enabled_stamp();
	if ( null === $first ) {
		// Nobody yet. The answer is only settled once the window closed.
		if ( time() - $install['at'] > $days * DAY_IN_SECONDS ) {
			return false;
		}
		return null;
	}
	if ( 'activation' !== $first['via'] || $first['at'] <= 0 ) {
		return null;
	}

	return ( $first['at'] - $install['at'] ) <= $days * DAY_IN_SECONDS;
}

/**
 * The three stamps as the shell config carries them, epoch seconds
 * (0 when unknown). Read-only from the client; future in-shell gates
 * ("you have used this for a week") read them without a round trip.
 *
 * @param int $user_id User ID. Defaults to the current user.
 * @return array{installedAt:int,firstEnabledAt:int,enabledAt:int}
 */
function openstation_first_run_config( $user_id = 0 ) {
	$install = openstation_get_install_stamp();
	$first   = openstation_get_first_enabled_stamp();
	return array(
		'installedAt'    => ( null !== $install && 'activation' === $install['via'] ) ? $install['at'] : 0,
		'firstEnabledAt' => ( null !== $first && 'activation' === $first['via'] ) ? $first['at'] : 0,
		'enabledAt'      => openstation_get_user_enabled_at( $user_id ),
	);
}
