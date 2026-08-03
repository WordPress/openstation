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
function open_station_ajax_save() {
	check_ajax_referer( 'save-openstation', 'nonce' );

	// A valid nonce proves *this* request was authored by the current
	// user, but WP's cap system is the authoritative gate for "is this
	// account allowed to touch admin state at all". `read` is the
	// minimum cap every admin-visible role carries; subscribers on sites
	// that revoke it have no business flipping an admin-UI preference.
	if ( ! current_user_can( 'read' ) ) {
		wp_send_json_error( 'open_station_forbidden', 403 );
	}

	/**
	 * Filters whether OpenStation is available for this user.
	 *
	 * Plugins can disable OpenStation for certain roles, capabilities, or conditions.
	 *
	 * @param bool $enabled Whether OpenStation is enabled. Default true.
	 * @param int  $user_id The current user ID.
	 */
	$allowed = apply_filters( 'open_station_mode_enabled', true, get_current_user_id() );
	if ( ! $allowed ) {
		wp_send_json_error( 'open_station_disabled' );
	}

	$enabled = ! empty( $_POST['enabled'] ) && '1' === $_POST['enabled'] ? '1' : '';

	update_user_meta( get_current_user_id(), 'desktop_mode_mode', $enabled );

	// Tell the client where to land.
	//
	// Enabling from classic admin: land directly on the Dashboard with
	// the portal flag (`wp-admin/index.php?desktop_mode_portal=1`).
	// Previously this redirected through `/openstation/` so the
	// portal handler could pick a landing page (saved-session focused
	// window, `?target=`, or Dashboard fallback). That logic remains
	// in place for users who visit `/openstation/` directly — a
	// bookmark or shared link — but the explicit "Switch to Desktop
	// Mode" button is a deliberate user action that consistently
	// lands on the Dashboard, so users get a predictable starting
	// point regardless of what they did last session. The shell still
	// honours session restore and the user's default-window pref via
	// its own boot-time logic — the URL just provides a stable entry
	// point rather than a portal hop.
	//
	// Disabling from the shell jumps to a plain admin URL — NOT the
	// portal, which would auto-re-enable the mode via the
	// `open_station_portal_auto_enable` filter and trap the user in a
	// loop.
	$redirect = '1' === $enabled
		? admin_url( 'index.php?' . OPEN_STATION_PORTAL_FLAG . '=1' )
		: admin_url();

	wp_send_json_success(
		array(
			'enabled'  => $enabled,
			'redirect' => esc_url_raw( $redirect ),
		)
	);
}
add_action( 'wp_ajax_save-openstation', 'open_station_ajax_save' );
