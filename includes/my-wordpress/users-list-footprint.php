<?php
/**
 * Desktop Mode — "View activity footprint" row action in the classic
 * Users list table.
 *
 * Adds a hover row action to `wp-admin/users.php` that, inside the
 * desktop shell's chromeless iframe, opens the user's GitHub-style
 * activity footprint in the "My WordPress" native window. The link's
 * `href` is a real profile-edit URL so a no-JS load or a modifier /
 * middle click degrades to a sensible page; inside the shell the
 * chromeless bridge (`includes/render/chromeless-bridge.php`)
 * intercepts the `data-desktop-mode-footprint` attribute and
 * postMessages the parent to open the footprint WITHOUT navigating the
 * Users list away.
 *
 * Only rendered on chromeless requests — the one context where the
 * desktop shell is present to receive the message. In a detached
 * classic tab (`?desktop_mode_classic=1`) or with desktop mode off the
 * action is omitted rather than shown as a link that would mislabel the
 * profile editor as the footprint. When the native Users window opt-in
 * is on, `users.php` is remapped to that window and never renders this
 * classic list, so there is no conflict.
 *
 * @package WPDesktopMode
 * @since   0.23.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Append the "View activity footprint" action to a Users-table row.
 *
 * Hooked on `user_row_actions`. Returns the actions unchanged outside
 * a chromeless request, for an invalid user object, or when the
 * `desktop_mode_user_footprint_row_action` filter opts the row out.
 *
 * @since 0.23.0
 *
 * @param string[] $actions     Row action links keyed by slug.
 * @param WP_User  $user_object The user the row represents.
 * @return string[] Filtered row actions.
 */
function desktop_mode_user_footprint_row_action( $actions, $user_object ) {
	if ( ! desktop_mode_is_chromeless_request() ) {
		return $actions;
	}

	if ( ! ( $user_object instanceof WP_User ) || $user_object->ID <= 0 ) {
		return $actions;
	}

	$user_id = (int) $user_object->ID;

	/**
	 * Filters whether the "View activity footprint" row action is shown
	 * for a user in the classic Users list table.
	 *
	 * Return false to suppress the action — e.g. to scope it to a role,
	 * or to hide it on the current user's own row. Default true for any
	 * chromeless request that reaches this filter (where the row is
	 * already gated by the `list_users` capability the table requires).
	 *
	 * @since 0.23.0
	 *
	 * @param bool    $show        Whether to show the action. Default true.
	 * @param WP_User $user_object The user the row represents.
	 */
	if ( ! apply_filters( 'desktop_mode_user_footprint_row_action', true, $user_object ) ) {
		return $actions;
	}

	// Graceful fallback target, followed only when JS is off or on a
	// modifier / middle click: the profile-edit screen for this user
	// (own profile uses profile.php). Inside the shell the chromeless
	// bridge preventDefaults the click and opens the footprint instead.
	$fallback_url = get_current_user_id() === $user_id
		? admin_url( 'profile.php' )
		: add_query_arg( 'user_id', $user_id, admin_url( 'user-edit.php' ) );

	$actions['desktop-mode-footprint'] = sprintf(
		'<a href="%1$s" data-desktop-mode-footprint="%2$d" data-desktop-mode-footprint-name="%3$s">%4$s</a>',
		esc_url( $fallback_url ),
		$user_id,
		esc_attr( $user_object->display_name ),
		esc_html__( 'View activity footprint', 'desktop-mode' )
	);

	return $actions;
}
add_filter( 'user_row_actions', 'desktop_mode_user_footprint_row_action', 10, 2 );
