<?php
/**
 * Admin-ajax endpoints for Desktop Mode Beta.
 *
 * Two actions, both nonce- and capability-gated:
 *
 *   wp_ajax_desktop_mode_beta_state  — assembled channel/build state.
 *                                      Accepts `refresh=1` to bypass
 *                                      the discovery caches.
 *   wp_ajax_desktop_mode_beta_switch — install a build. Body carries
 *                                      `source` (stable|trunk|pr) and
 *                                      `id` (PR number for `pr`).
 *
 * admin-ajax (not REST) on purpose: the install path needs the
 * admin-only upgrader classes, and this mirrors the proven
 * plugins-window pattern in desktop-mode itself.
 *
 * @package DesktopModeBeta
 */

defined( 'ABSPATH' ) || exit;

/**
 * Shared request guard: nonce + capability.
 *
 * @since 0.1.0
 *
 * @param string $capability Capability required for the action.
 * @return true|WP_Error
 */
function desktop_mode_beta_ajax_guard( $capability ) {
	$nonce_ok = check_ajax_referer( 'desktop-mode-beta', '_ajax_nonce', false );
	if ( false === $nonce_ok ) {
		return new WP_Error(
			'desktop_mode_beta_bad_nonce',
			__( 'Your session expired. Reload the page and try again.', 'desktop-mode-beta' ),
			array( 'status' => 403 )
		);
	}
	if ( ! current_user_can( $capability ) ) {
		return new WP_Error(
			'desktop_mode_beta_forbidden',
			__( 'You are not allowed to manage Desktop Mode builds.', 'desktop-mode-beta' ),
			array( 'status' => 403 )
		);
	}
	return true;
}

/**
 * Send a WP_Error as a JSON error response.
 *
 * @since 0.1.0
 *
 * @param WP_Error $error Error to send.
 */
function desktop_mode_beta_ajax_error( $error ) {
	$data   = $error->get_error_data();
	$status = is_array( $data ) && isset( $data['status'] ) ? (int) $data['status'] : 500;
	wp_send_json_error(
		array(
			'code'    => $error->get_error_code(),
			'message' => $error->get_error_message(),
		),
		$status
	);
}

/**
 * Ajax: current channel/build state.
 *
 * @since 0.1.0
 */
function desktop_mode_beta_ajax_state() {
	$guard = desktop_mode_beta_ajax_guard( 'update_plugins' );
	if ( is_wp_error( $guard ) ) {
		desktop_mode_beta_ajax_error( $guard );
		return;
	}

	// phpcs:ignore WordPress.Security.NonceVerification.Missing -- nonce verified in desktop_mode_beta_ajax_guard().
	$force = ! empty( $_POST['refresh'] );
	$state = desktop_mode_beta_state( $force );
	if ( is_wp_error( $state ) ) {
		desktop_mode_beta_ajax_error( $state );
		return;
	}
	wp_send_json_success( $state );
}
add_action( 'wp_ajax_desktop_mode_beta_state', 'desktop_mode_beta_ajax_state' );

/**
 * Ajax: install a build (switch channel).
 *
 * @since 0.1.0
 */
function desktop_mode_beta_ajax_switch() {
	$guard = desktop_mode_beta_ajax_guard( 'install_plugins' );
	if ( is_wp_error( $guard ) ) {
		desktop_mode_beta_ajax_error( $guard );
		return;
	}

	// phpcs:ignore WordPress.Security.NonceVerification.Missing -- nonce verified in desktop_mode_beta_ajax_guard().
	$source = isset( $_POST['source'] ) ? sanitize_key( wp_unslash( $_POST['source'] ) ) : '';
	// phpcs:ignore WordPress.Security.NonceVerification.Missing -- nonce verified in desktop_mode_beta_ajax_guard().
	$id = isset( $_POST['id'] ) ? sanitize_text_field( wp_unslash( $_POST['id'] ) ) : '';

	$result = desktop_mode_beta_switch( $source, $id );
	if ( is_wp_error( $result ) ) {
		desktop_mode_beta_ajax_error( $result );
		return;
	}
	wp_send_json_success( $result );
}
add_action( 'wp_ajax_desktop_mode_beta_switch', 'desktop_mode_beta_ajax_switch' );
