<?php
/**
 * OpenStation AJAX endpoints.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Handles saving the user's OpenStation preference via AJAX.
 */
function openstation_ajax_save() {
	check_ajax_referer( 'save-openstation', 'nonce' );

	// A valid nonce proves *this* request was authored by the current
	// user, but WP's cap system is the authoritative gate for "is this
	// account allowed to touch admin state at all". `read` is the
	// minimum cap every admin-visible role carries; subscribers on sites
	// that revoke it have no business flipping an admin-UI preference.
	if ( ! current_user_can( 'read' ) ) {
		wp_send_json_error( 'openstation_forbidden', 403 );
	}

	/**
	 * Filters whether OpenStation is available for this user.
	 *
	 * Plugins can disable OpenStation for certain roles, capabilities, or conditions.
	 *
	 * @param bool $enabled Whether OpenStation is enabled. Default true.
	 * @param int  $user_id The current user ID.
	 */
	$allowed = apply_filters( 'openstation_mode_enabled', true, get_current_user_id() );
	if ( ! $allowed ) {
		wp_send_json_error( 'openstation_disabled' );
	}

	$enabled = ! empty( $_POST['enabled'] ) && '1' === $_POST['enabled'] ? '1' : '';

	update_user_meta( get_current_user_id(), 'desktop_mode_mode', $enabled );

	// Tell the client where to land.
	//
	// Enabling from classic admin: land on the shell screen with the
	// Dashboard as the page it opens first. The explicit "Switch to
	// Desktop Mode" button is a deliberate user action that
	// consistently lands on the Dashboard, so users get a predictable
	// starting point regardless of what they did last session; the
	// shell still honours session restore and the user's default-window
	// pref via its own boot-time logic. Going to the screen directly
	// rather than through `/openstation/` skips a hop the portal would
	// spend re-deciding what this URL already says.
	//
	// Disabling from the shell jumps to a plain admin URL — NOT the
	// portal, which would auto-re-enable the mode via the
	// `openstation_portal_auto_enable` filter and trap the user in a
	// loop.
	$redirect = '1' === $enabled
		? openstation_shell_url( admin_url( 'index.php' ) )
		: admin_url();

	wp_send_json_success(
		array(
			'enabled'  => $enabled,
			'redirect' => esc_url_raw( $redirect ),
		)
	);
}
add_action( 'wp_ajax_save-openstation', 'openstation_ajax_save' );
