<?php
/**
 * Desktop Mode AJAX endpoints.
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/**
 * Handles saving the user's desktop mode preference via AJAX.
 *
 * @since 0.1.0
 */
function desktop_mode_ajax_save() {
	check_ajax_referer( 'save-desktop-mode', 'nonce' );

	// A valid nonce proves *this* request was authored by the current
	// user, but WP's cap system is the authoritative gate for "is this
	// account allowed to touch admin state at all". `read` is the
	// minimum cap every admin-visible role carries; subscribers on sites
	// that revoke it have no business flipping an admin-UI preference.
	if ( ! current_user_can( 'read' ) ) {
		wp_send_json_error( 'desktop_mode_forbidden', 403 );
	}

	/**
	 * Filters whether desktop mode is available for this user.
	 *
	 * Plugins can disable desktop mode for certain roles, capabilities, or conditions.
	 *
	 * @since 0.1.0
	 *
	 * @param bool $enabled Whether desktop mode is enabled. Default true.
	 * @param int  $user_id The current user ID.
	 */
	$allowed = apply_filters( 'desktop_mode_mode_enabled', true, get_current_user_id() );
	if ( ! $allowed ) {
		wp_send_json_error( 'desktop_mode_disabled' );
	}

	$enabled = ! empty( $_POST['enabled'] ) && '1' === $_POST['enabled'] ? '1' : '';

	update_user_meta( get_current_user_id(), 'desktop_mode_mode', $enabled );

	// Tell the client where to land. Enabling from classic admin forwards
	// through the portal so the shell takes over and the address bar
	// collapses to /wp-desktop/. Disabling from the shell jumps to a
	// plain admin URL — NOT the portal, which would auto-re-enable the
	// mode via the `desktop_mode_portal_auto_enable` filter and trap the
	// user in a loop.
	$redirect = '1' === $enabled ? desktop_mode_portal_url() : admin_url();

	wp_send_json_success(
		array(
			'enabled'  => $enabled,
			'redirect' => esc_url_raw( $redirect ),
		)
	);
}
add_action( 'wp_ajax_save-desktop-mode', 'desktop_mode_ajax_save' );
