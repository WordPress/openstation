<?php
/**
 * OpenStation — Shared workspaces: claiming a link, and the pin.
 *
 * Opening a share link does one of three things, decided here and
 * nowhere else:
 *
 *   - **Pins** an ordinary user. Their desks are stashed, the shared
 *     workspace becomes their main and only desk, OpenStation is turned
 *     on for them, and it stays that way until an admin releases them.
 *   - **Adds** the workspace as an ordinary desk for someone who can
 *     manage shares. An admin checking their own link must not be
 *     locked out of their admin.
 *   - **Lands** anyone who already claimed that link on their copy.
 *     A link duplicates once per user, ever.
 *
 * The pin is enforced on the server, on every session read and write
 * (the `openstation_session` filter), not by hiding buttons: a client
 * that sends a second desk, or a request that turns OpenStation off,
 * simply does not get what it asked for.
 *
 * Both records are USER OPTIONS (`update_user_option()`), which Core
 * prefixes per site: a share is a post on one site, and a pin on site A
 * must not lock the same user's desk on site B.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/** User option: the share this user is pinned to, and the stash that undoes it. */
const OPENSTATION_WORKSPACE_PIN_OPTION = 'openstation_workspace_pin';

/** User option: every share this user has claimed, keyed by share id. */
const OPENSTATION_WORKSPACE_CLAIMS_OPTION = 'openstation_workspace_claims';

/** The desk a pinned user has. The main desk — the only one. */
const OPENSTATION_WORKSPACE_PINNED_DESKTOP = 'desktop-1';

/**
 * The user's pin, or null.
 *
 * @param int $user_id User id.
 * @return array{share:int, version:int, stash:mixed, claimed:int}|null
 */
function openstation_workspace_pin_get( $user_id ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return null;
	}
	$pin = get_user_option( OPENSTATION_WORKSPACE_PIN_OPTION, $user_id );
	if ( ! is_array( $pin ) || empty( $pin['share'] ) ) {
		return null;
	}
	return array(
		'share'   => (int) $pin['share'],
		'version' => isset( $pin['version'] ) ? (int) $pin['version'] : 0,
		'stash'   => $pin['stash'] ?? null,
		'claimed' => isset( $pin['claimed'] ) ? (int) $pin['claimed'] : 0,
	);
}

/**
 * Whether a user is pinned to a shared workspace on this site.
 *
 * @param int $user_id Optional. Defaults to the current user.
 * @return bool
 */
function openstation_workspace_is_pinned( $user_id = 0 ) {
	$user_id = $user_id ? (int) $user_id : get_current_user_id();
	return null !== openstation_workspace_pin_get( $user_id );
}

/**
 * The shares a user has claimed.
 *
 * @param int $user_id User id.
 * @return array<int, array{desktop:string, at:int}>
 */
function openstation_workspace_claims_get( $user_id ) {
	$claims = get_user_option( OPENSTATION_WORKSPACE_CLAIMS_OPTION, (int) $user_id );
	if ( ! is_array( $claims ) ) {
		return array();
	}
	$out = array();
	foreach ( $claims as $share_id => $claim ) {
		if ( (int) $share_id > 0 && is_array( $claim ) ) {
			$out[ (int) $share_id ] = array(
				'desktop' => isset( $claim['desktop'] ) ? sanitize_key( (string) $claim['desktop'] ) : '',
				'at'      => isset( $claim['at'] ) ? (int) $claim['at'] : 0,
			);
		}
	}
	return $out;
}

/**
 * Users holding one of the two records, on this site.
 *
 * @param string $option User option name.
 * @return int[]
 */
function openstation_workspace_users_with_option( $option ) {
	global $wpdb;
	return array_map(
		'intval',
		get_users(
			array(
				'blog_id'  => 0,
				'fields'   => 'ID',
				'meta_key' => $wpdb->get_blog_prefix() . $option, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key -- admin-only listing.
				'number'   => 1000,
			)
		)
	);
}

/**
 * Users currently pinned to a share.
 *
 * @param int $share_id Share id.
 * @return int[]
 */
function openstation_workspace_share_pinned_users( $share_id ) {
	$out = array();
	foreach ( openstation_workspace_users_with_option( OPENSTATION_WORKSPACE_PIN_OPTION ) as $user_id ) {
		$pin = openstation_workspace_pin_get( $user_id );
		if ( $pin && (int) $share_id === $pin['share'] ) {
			$out[] = $user_id;
		}
	}
	return $out;
}

/**
 * Everyone who has claimed a share — pinned or not.
 *
 * @param int $share_id Share id.
 * @return array<int, array{user:int, name:string, email:string, pinned:bool, at:int}>
 */
function openstation_workspace_share_claimants( $share_id ) {
	$share_id = (int) $share_id;
	$out      = array();
	foreach ( openstation_workspace_users_with_option( OPENSTATION_WORKSPACE_CLAIMS_OPTION ) as $user_id ) {
		$claims = openstation_workspace_claims_get( $user_id );
		if ( ! isset( $claims[ $share_id ] ) ) {
			continue;
		}
		$user = get_userdata( $user_id );
		if ( ! $user ) {
			continue;
		}
		$pin   = openstation_workspace_pin_get( $user_id );
		$out[] = array(
			'user'   => $user_id,
			'name'   => (string) $user->display_name,
			'email'  => (string) $user->user_email,
			'pinned' => $pin && $share_id === $pin['share'],
			'at'     => $claims[ $share_id ]['at'],
		);
	}
	usort(
		$out,
		static function ( $a, $b ) {
			return $b['at'] <=> $a['at'];
		}
	);
	return $out;
}

/**
 * The raw site session blob, before any read-time shaping.
 *
 * The stash has to be exactly what the user had — including fields a
 * later version of the session reader might understand — so it is taken
 * from the meta, not from `openstation_get_session()`.
 *
 * @param int $user_id User id.
 * @return mixed
 */
function openstation_workspace_raw_session( $user_id ) {
	return get_user_meta( (int) $user_id, openstation_session_meta_key( false ), true );
}

/**
 * The desk a share becomes in someone's session.
 *
 * @param array  $share       The share.
 * @param string $desktop_id  Desk id to give it.
 * @param bool   $provisioned Whether its launch list already ran.
 * @return array
 */
function openstation_workspace_share_desktop( $share, $desktop_id, $provisioned ) {
	$profile                = is_array( $share['profile'] ) ? $share['profile'] : openstation_sanitize_workspace_profile( array() );
	$profile['provisioned'] = (bool) $provisioned;
	return array(
		'id'      => $desktop_id,
		'label'   => $share['label'],
		'profile' => $profile,
	);
}

/**
 * Opens a share link for a user.
 *
 * @param string $token   Share token from the link.
 * @param int    $user_id User opening it.
 * @return array{status:string, share:array|null, desktop:string}
 *     `status` is one of:
 *     - `pinned`   — the workspace is now their only desk;
 *     - `added`    — added as an ordinary desk (users who can share);
 *     - `already`  — they claimed it before, landed on their copy;
 *     - `managed`  — pinned to a different share; nothing changed;
 *     - `disabled` — the link was turned off before they claimed it;
 *     - `not-allowed` — the account may not receive shared workspaces
 *       ({@see openstation_workspace_claim_capability()}); nothing changed;
 *     - `invalid`  — no such link.
 */
function openstation_workspace_share_claim( $token, $user_id ) {
	$user_id = (int) $user_id;
	$share   = openstation_workspace_share_find_by_token( $token );
	$result  = array(
		'status'  => 'invalid',
		'share'   => $share,
		'desktop' => '',
	);
	if ( ! $share || $user_id <= 0 ) {
		return $result;
	}

	$claims = openstation_workspace_claims_get( $user_id );
	$pin    = openstation_workspace_pin_get( $user_id );

	if ( isset( $claims[ $share['id'] ] ) ) {
		// Once per user, ever. The link stays useful: it brings them
		// back to the copy they have.
		$result['status']  = 'already';
		$result['desktop'] = $claims[ $share['id'] ]['desktop'];
		if ( ! $pin && '' !== $result['desktop'] ) {
			openstation_workspace_session_activate( $user_id, $result['desktop'] );
		}
	} elseif ( $share['disabled'] ) {
		$result['status'] = 'disabled';
	} elseif ( $pin ) {
		$result['status'] = 'managed';
	} elseif ( ! openstation_workspace_user_can_share( $user_id ) && ! openstation_workspace_user_can_claim( $user_id ) ) {
		$result['status'] = 'not-allowed';
	} elseif ( openstation_workspace_user_can_share( $user_id ) ) {
		$result['status']  = 'added';
		$result['desktop'] = openstation_workspace_session_add_desk( $user_id, $share );
		// Opening the link is asking to see it, on a desktop.
		update_user_meta( $user_id, 'desktop_mode_mode', '1' );
	} else {
		$result['status']  = 'pinned';
		$result['desktop'] = OPENSTATION_WORKSPACE_PINNED_DESKTOP;
		openstation_workspace_pin_apply( $user_id, $share );
	}

	if ( in_array( $result['status'], array( 'pinned', 'added' ), true ) ) {
		$claims[ $share['id'] ] = array(
			'desktop' => $result['desktop'],
			'at'      => openstation_session_now_ms(),
		);
		update_user_option( $user_id, OPENSTATION_WORKSPACE_CLAIMS_OPTION, $claims );
	}

	/**
	 * Fires after a share link was opened, whatever came of it.
	 *
	 * @param string $status  See {@see openstation_workspace_share_claim()}.
	 * @param array  $share   The share.
	 * @param int    $user_id The user who opened it.
	 */
	do_action( 'openstation_workspace_share_claimed', $result['status'], $share, $user_id );

	return $result;
}

/**
 * Pins a user to a share: stash their session, give them the shared
 * workspace as their only desk, and turn OpenStation on for them.
 *
 * @param int   $user_id User id.
 * @param array $share   The share.
 * @return void
 */
function openstation_workspace_pin_apply( $user_id, $share ) {
	// The cosmetic settings are where the workspace STARTS the user:
	// written into their own settings, theirs to change from here.
	// Before the pin is set, so the save guard below does not apply.
	openstation_workspace_seed_cosmetics( $user_id, $share );
	update_user_option(
		$user_id,
		OPENSTATION_WORKSPACE_PIN_OPTION,
		array(
			'share'   => $share['id'],
			// Not yet provisioned at this version: the first load
			// opens the workspace's windows.
			'version' => 0,
			'stash'   => openstation_workspace_raw_session( $user_id ),
			'claimed' => openstation_session_now_ms(),
		)
	);
	update_user_meta(
		$user_id,
		openstation_session_meta_key( false ),
		array(
			'windows'       => array(),
			'desktops'      => array( openstation_workspace_share_desktop( $share, OPENSTATION_WORKSPACE_PINNED_DESKTOP, false ) ),
			'activeDesktop' => OPENSTATION_WORKSPACE_PINNED_DESKTOP,
			'focused'       => '',
			'updated'       => openstation_session_now_ms(),
		)
	);
	// Opening the link is the ask. The meta guard below only refuses
	// writes that turn OpenStation OFF, so this one goes through.
	update_user_meta( $user_id, 'desktop_mode_mode', '1' );
}

/**
 * Copies a share's cosmetic settings into a user's own saved settings.
 *
 * @param int   $user_id User id.
 * @param array $share   The share.
 * @return void
 */
function openstation_workspace_seed_cosmetics( $user_id, $share ) {
	$patch = array_intersect_key(
		(array) ( $share['profile']['appearance'] ?? array() ),
		array_flip( openstation_workspace_cosmetic_setting_keys() )
	);
	if ( empty( $patch ) ) {
		return;
	}
	$raw = get_user_meta( $user_id, OPENSTATION_OS_SETTINGS_META_KEY, true );
	update_user_meta(
		$user_id,
		OPENSTATION_OS_SETTINGS_META_KEY,
		openstation_sanitize_os_settings( array_merge( is_array( $raw ) ? $raw : array(), $patch ) )
	);
}

/**
 * The settings a share LOCKS for the users it pins: its patch minus
 * the cosmetic keys, which are the user's.
 *
 * @param array $share The share.
 * @return array
 */
function openstation_workspace_locked_settings( $share ) {
	return array_diff_key(
		(array) ( $share['profile']['appearance'] ?? array() ),
		array_flip( openstation_workspace_cosmetic_setting_keys() )
	);
}

/**
 * The share a user is pinned to, or null.
 *
 * @param int $user_id User id.
 * @return array|null
 */
function openstation_workspace_pinned_share( $user_id ) {
	$pin = openstation_workspace_pin_get( $user_id );
	return $pin ? openstation_workspace_share_get( $pin['share'] ) : null;
}

/**
 * Holds the locked settings on every read of a pinned user's settings.
 *
 * @param array $settings Sanitized settings.
 * @param int   $user_id  User id.
 * @return array
 */
function openstation_workspace_pin_hold_settings( $settings, $user_id ) {
	$share = openstation_workspace_pinned_share( (int) $user_id );
	return $share ? array_merge( $settings, openstation_workspace_locked_settings( $share ) ) : $settings;
}
add_filter( 'openstation_os_settings', 'openstation_workspace_pin_hold_settings', 10, 2 );

/**
 * Keeps a pinned user's saved values for the locked keys: neither the
 * workspace's values (they are held on read) nor an attempt to change
 * them reaches storage — so a release hands back exactly what they had.
 *
 * @param array $clean   Settings about to be saved.
 * @param int   $user_id User id.
 * @return array
 */
function openstation_workspace_pin_guard_settings_save( $clean, $user_id ) {
	$share = openstation_workspace_pinned_share( (int) $user_id );
	if ( ! $share ) {
		return $clean;
	}
	$raw    = get_user_meta( (int) $user_id, OPENSTATION_OS_SETTINGS_META_KEY, true );
	$stored = openstation_sanitize_os_settings( is_array( $raw ) ? $raw : array() );
	foreach ( array_keys( openstation_workspace_locked_settings( $share ) ) as $key ) {
		if ( array_key_exists( $key, $stored ) ) {
			$clean[ $key ] = $stored[ $key ];
		}
	}
	return $clean;
}
add_filter( 'openstation_os_settings_before_save', 'openstation_workspace_pin_guard_settings_save', 10, 2 );

/**
 * Releases a pinned user: their own desks come back, and the shared
 * workspace stays among them as an ordinary desk they now own.
 *
 * @param int $user_id User id.
 * @return bool Whether they were pinned.
 */
function openstation_workspace_pin_release( $user_id ) {
	$user_id = (int) $user_id;
	$pin     = openstation_workspace_pin_get( $user_id );
	if ( ! $pin ) {
		return false;
	}
	$share = openstation_workspace_share_get( $pin['share'] );

	// Delete the pin FIRST: the session filter enforces it, and a
	// write made while it is still set would be reshaped back into
	// the pinned desk.
	delete_user_option( $user_id, OPENSTATION_WORKSPACE_PIN_OPTION );

	$stash    = is_array( $pin['stash'] ) ? $pin['stash'] : openstation_empty_session();
	$desktops = isset( $stash['desktops'] ) && is_array( $stash['desktops'] ) ? array_values( $stash['desktops'] ) : array( openstation_default_desktop() );
	$claims   = openstation_workspace_claims_get( $user_id );
	if ( $share ) {
		$desk_id    = openstation_workspace_unique_desktop_id( $desktops, 'desktop-ws-' . $share['id'] );
		$desktops[] = openstation_workspace_share_desktop( $share, $desk_id, true );
		// Their copy now lives on a new desk — the link lands there.
		$claims[ $share['id'] ]['desktop'] = $desk_id;
		update_user_option( $user_id, OPENSTATION_WORKSPACE_CLAIMS_OPTION, $claims );
	}
	$stash['desktops'] = array_slice( $desktops, 0, OPENSTATION_SESSION_MAX_DESKTOPS );
	$stash['updated']  = openstation_session_now_ms();
	update_user_meta( $user_id, openstation_session_meta_key( false ), $stash );

	/**
	 * Fires after a pinned user was released.
	 *
	 * @param int        $user_id The user.
	 * @param array|null $share   The share they were pinned to, or null when it is gone.
	 */
	do_action( 'openstation_workspace_pin_released', $user_id, $share );
	return true;
}

/**
 * A desk id not yet taken in a desktops list.
 *
 * @param array  $desktops Desktops.
 * @param string $base     Preferred id.
 * @return string
 */
function openstation_workspace_unique_desktop_id( $desktops, $base ) {
	$taken = array();
	foreach ( $desktops as $d ) {
		if ( is_array( $d ) && isset( $d['id'] ) ) {
			$taken[] = (string) $d['id'];
		}
	}
	$id = $base;
	for ( $n = 2; in_array( $id, $taken, true ); $n++ ) {
		$id = $base . '-' . $n;
	}
	return $id;
}

/**
 * Adds a share as an ordinary desk and makes it the active one.
 *
 * @param int   $user_id User id.
 * @param array $share   The share.
 * @return string The desk id.
 */
function openstation_workspace_session_add_desk( $user_id, $share ) {
	$session = openstation_get_session( $user_id, false );
	$desk_id = openstation_workspace_unique_desktop_id( $session['desktops'], 'desktop-ws-' . $share['id'] );
	if ( count( $session['desktops'] ) >= OPENSTATION_SESSION_MAX_DESKTOPS ) {
		// Full. Evicting a desk to make room would be a silent loss,
		// so nothing is replaced and the user lands where they were.
		return '';
	}
	$session['desktops'][]    = openstation_workspace_share_desktop( $share, $desk_id, false );
	$session['activeDesktop'] = $desk_id;
	$session['updated']       = openstation_session_now_ms();
	update_user_meta( $user_id, openstation_session_meta_key( false ), $session );
	return $desk_id;
}

/**
 * Makes a desk the active one, when the user still has it.
 *
 * @param int    $user_id    User id.
 * @param string $desktop_id Desk id.
 * @return void
 */
function openstation_workspace_session_activate( $user_id, $desktop_id ) {
	$session = openstation_get_session( $user_id, false );
	foreach ( $session['desktops'] as $d ) {
		if ( isset( $d['id'] ) && $desktop_id === $d['id'] ) {
			$session['activeDesktop'] = $desktop_id;
			$session['updated']       = openstation_session_now_ms();
			update_user_meta( $user_id, openstation_session_meta_key( false ), $session );
			return;
		}
	}
}

/**
 * Enforces a pin on a session, on every read and every write.
 *
 * Whatever the client sent, a pinned user's session is one desk — the
 * shared workspace, as the share defines it NOW — and every window is
 * on it. The profile comes from the share, not from the client, so a
 * republish reaches the desk on the next load, and nothing the client
 * edits sticks.
 *
 * `provisioned` is the one bit the client owns: the desk opens its
 * windows once per published version. A write reporting it provisioned
 * records that version; a read reports it unprovisioned until then.
 *
 * @param array  $session Sanitized session.
 * @param int    $user_id Owner.
 * @param bool   $network Whether this is the network admin's session.
 * @param string $context `read` or `save`.
 * @return array
 */
function openstation_workspace_pin_enforce_session( $session, $user_id, $network, $context ) {
	if ( $network || ! is_array( $session ) ) {
		return $session;
	}
	$pin = openstation_workspace_pin_get( $user_id );
	if ( ! $pin ) {
		return $session;
	}
	$share = openstation_workspace_share_get( $pin['share'] );
	if ( ! $share ) {
		// The share is gone without its recipients being released
		// (deleted behind our back). A lock nobody can open is worse
		// than no lock: let go.
		openstation_workspace_pin_release( $user_id );
		return $session;
	}

	if ( 'save' === $context && $pin['version'] !== $share['version'] ) {
		foreach ( (array) ( $session['desktops'] ?? array() ) as $d ) {
			if ( isset( $d['id'], $d['profile']['provisioned'] ) && OPENSTATION_WORKSPACE_PINNED_DESKTOP === $d['id'] && $d['profile']['provisioned'] ) {
				$raw            = get_user_option( OPENSTATION_WORKSPACE_PIN_OPTION, $user_id );
				$raw['version'] = $share['version'];
				update_user_option( $user_id, OPENSTATION_WORKSPACE_PIN_OPTION, $raw );
				$pin['version'] = $share['version'];
				break;
			}
		}
	}

	$desk = openstation_workspace_share_desktop( $share, OPENSTATION_WORKSPACE_PINNED_DESKTOP, $pin['version'] === $share['version'] );
	// The desk paints only the locked settings over the user's own; the
	// cosmetic ones were seeded into their settings and are theirs now,
	// so a wallpaper they picked is not painted over on every load.
	$desk['profile']['appearance'] = openstation_workspace_locked_settings( $share );
	$session['desktops']           = array( $desk );
	$session['activeDesktop'] = OPENSTATION_WORKSPACE_PINNED_DESKTOP;
	if ( isset( $session['windows'] ) && is_array( $session['windows'] ) ) {
		foreach ( $session['windows'] as $i => $win ) {
			if ( is_array( $win ) ) {
				$session['windows'][ $i ]['desktopId'] = OPENSTATION_WORKSPACE_PINNED_DESKTOP;
			}
		}
	}
	return $session;
}
add_filter( 'openstation_session', 'openstation_workspace_pin_enforce_session', 10, 4 );

/**
 * Refuses to turn OpenStation off for a pinned user.
 *
 * On the meta write itself, so every path — the admin-bar toggle, the
 * AJAX endpoint, a REST route, a plugin — gets the same answer.
 *
 * @param null|bool $check      Short-circuit value.
 * @param int       $user_id    User id.
 * @param string    $meta_key   Meta key.
 * @param mixed     $meta_value New value.
 * @return null|bool
 */
function openstation_workspace_pin_guard_mode_meta( $check, $user_id, $meta_key, $meta_value ) {
	if ( 'desktop_mode_mode' !== $meta_key || '1' === (string) $meta_value ) {
		return $check;
	}
	return openstation_workspace_is_pinned( (int) $user_id ) ? false : $check;
}
add_filter( 'update_user_metadata', 'openstation_workspace_pin_guard_mode_meta', 10, 4 );

/**
 * Same refusal for a delete of the meta.
 *
 * @param null|bool $check    Short-circuit value.
 * @param int       $user_id  User id.
 * @param string    $meta_key Meta key.
 * @return null|bool
 */
function openstation_workspace_pin_guard_mode_meta_delete( $check, $user_id, $meta_key ) {
	if ( 'desktop_mode_mode' !== $meta_key ) {
		return $check;
	}
	return openstation_workspace_is_pinned( (int) $user_id ) ? false : $check;
}
add_filter( 'delete_user_metadata', 'openstation_workspace_pin_guard_mode_meta_delete', 10, 3 );

/**
 * Keeps OpenStation on for a pinned user even where a plugin's gate
 * would switch it off — the pin is a promise the admin made.
 *
 * Runs late so it has the last word, but never turns it on for someone
 * whose pin is not on this site.
 *
 * @param bool $enabled Whether OpenStation is enabled.
 * @param int  $user_id User id.
 * @return bool
 */
function openstation_workspace_pin_keep_enabled( $enabled, $user_id ) {
	return $enabled || openstation_workspace_is_pinned( (int) $user_id );
}
add_filter( 'openstation_mode_enabled', 'openstation_workspace_pin_keep_enabled', 100, 2 );
