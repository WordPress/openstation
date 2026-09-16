<?php
/**
 * OpenStation — the shell tour's server-side gate.
 *
 * The tour itself is JavaScript (`src/shell-tour/`), three coachmarks
 * on a user's first boot: open a window, snap it, press ⌘K. The
 * server decides two things about it: whether this site offers it at
 * all (the `openstation_show_shell_tour` filter), and whether this
 * user has already had it — the latter through the seen-intros
 * registry under the slug below, which is what gives the tour per-user
 * persistence across browsers, the "Reset what's-new dialogs" button
 * and the `os-intros-reset` event for free.
 *
 * Existing users do not get the tour on update: migration 9 marks the
 * slug seen for everyone who used the shell before it shipped. Reset
 * brings it back for anyone who wants it.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/** Slug stored in `desktop_mode_seen_intros` once the tour has run. */
const OPENSTATION_SHELL_TOUR_INTRO_SLUG = 'shell-tour';

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
