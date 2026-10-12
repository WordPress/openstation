<?php
/**
 * OpenStation — the shell tour's server-side gate.
 *
 * The tour itself is JavaScript (`src/shell-tour/`), five coachmarks
 * on a user's first boot: where the menus are, how to change the
 * layout, then open a window, snap it, press ⌘K. The
 * server decides two things about it: whether this site offers it at
 * all (the `openstation_show_shell_tour` filter), and whether this
 * user has already had it — the latter through the seen-intros
 * registry under the slug below, which is what gives the tour per-user
 * persistence across browsers, the "Reset what's-new dialogs" button
 * and the `os-intros-reset` event for free.
 *
 * Existing users do not get the tour on update: migration 10 marks the
 * slug seen for everyone who used the shell before it shipped. Reset
 * brings it back for anyone who wants it.
 *
 * A user who skips it gets a desktop icon to take it later, until they
 * walk a run to the end.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/** Slug stored in `desktop_mode_seen_intros` once the tour has run. */
const OPENSTATION_SHELL_TOUR_INTRO_SLUG = 'shell-tour';

/** Recorded when a run ends before the last card: Skip or Escape. */
const OPENSTATION_SHELL_TOUR_SKIPPED_SLUG = 'shell-tour-skipped';

/** Recorded when a run reaches the last card and the user clicks Done. */
const OPENSTATION_SHELL_TOUR_DONE_SLUG = 'shell-tour-done';

/** The desktop icon that relaunches an unfinished tour. */
const OPENSTATION_SHELL_TOUR_ICON_ID = 'openstation-shell-tour';

/**
 * Whether the shell should offer this user the tour on boot.
 *
 * The seen-state is deliberately NOT folded in here: the shell reads
 * `config.seenIntros` for that, and keeps reading it after a reset so
 * an instant replay works without a new boot payload. This answers
 * the site-level question only.
 *
 * @param int $user_id User ID. Defaults to the current user.
 * @return bool
 */
function openstation_should_offer_shell_tour( $user_id = 0 ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		$user_id = get_current_user_id();
	}

	/**
	 * Filters whether the first-boot shell tour is offered to a user.
	 *
	 * Return `false` to suppress the tour site-wide (a managed host
	 * with its own onboarding) or for a role. A user who already took
	 * or skipped it is excluded by the seen-intros registry before
	 * this filter matters.
	 *
	 * @param bool $offer   Whether to offer the tour. Default true.
	 * @param int  $user_id The user booting the shell.
	 */
	return (bool) apply_filters( 'openstation_show_shell_tour', true, $user_id );
}

/**
 * Whether this user left the tour unfinished: they skipped it, by the
 * button or by Escape, and have not walked a run to the end since.
 *
 * Existing users are not unfinished. Migration 10 records them as
 * having SEEN the tour, never as having skipped it, so an update does
 * not put the icon on a veteran's desk.
 *
 * @param int $user_id User ID. Defaults to the current user.
 * @return bool
 */
function openstation_shell_tour_is_unfinished( $user_id = 0 ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		$user_id = get_current_user_id();
	}
	if ( $user_id <= 0 ) {
		return false;
	}
	return openstation_has_seen_intro( $user_id, OPENSTATION_SHELL_TOUR_SKIPPED_SLUG )
		&& ! openstation_has_seen_intro( $user_id, OPENSTATION_SHELL_TOUR_DONE_SLUG );
}

/**
 * Put the relaunch icon on the desk of a user who left the tour unfinished.
 *
 * Added through `openstation_icons` rather than `openstation_register_icon()`,
 * and on purpose: the registry requires a window or a URL to open, and this
 * icon has neither. A click on it IS the request, caught by the shell on
 * `os.os-icon.clicked`; the client opens no target for an entry that has
 * none. The filter is the documented way to inject a virtual entry, and it
 * is keyed by id because that is what the placement store reads.
 *
 * Like any other desktop icon, right-click offers "Hide from desktop".
 *
 * @param array $registry Desktop icon entries, keyed by id.
 * @return array
 */
function openstation_shell_tour_relaunch_icon( $registry ) {
	if ( ! is_array( $registry ) ) {
		return $registry;
	}
	if ( ! openstation_should_offer_shell_tour() || ! openstation_shell_tour_is_unfinished() ) {
		return $registry;
	}
	$registry[ OPENSTATION_SHELL_TOUR_ICON_ID ] = array(
		'id'       => OPENSTATION_SHELL_TOUR_ICON_ID,
		'title'    => __( 'Take the tour', 'desktop-mode' ),
		'icon'     => 'dashicons-welcome-learn-more',
		'window'   => '',
		'url'      => '',
		'position' => 100,
		'pinned'   => false,
	);
	return $registry;
}
add_filter( 'openstation_icons', 'openstation_shell_tour_relaunch_icon' );
