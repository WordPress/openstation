<?php
/**
 * Admin-ajax endpoints for OpenStation Beta.
 *
 * Two actions, both nonce- and capability-gated:
 *
 *   wp_ajax_openstation_beta_state  — assembled channel/build state.
 *                                      Accepts `refresh=1` to bypass
 *                                      the discovery caches.
 *   wp_ajax_openstation_beta_switch — install a build. Body carries
 *                                      `source` (stable|trunk|pr) and
 *                                      `id` (PR number for `pr`).
 *
 * admin-ajax (not REST) on purpose: the install path needs the
 * admin-only upgrader classes, and this mirrors the proven
 * plugins-window pattern in desktop-mode itself.
 *
 * @package OpenStationBeta
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
function openstation_beta_ajax_guard( $capability ) {
	$nonce_ok = check_ajax_referer( 'openstation-beta', '_ajax_nonce', false );
	if ( false === $nonce_ok ) {
		return new WP_Error(
			'openstation_beta_bad_nonce',
			__( 'Your session expired. Reload the page and try again.', 'openstation-beta' ),
			array( 'status' => 403 )
		);
	}
	if ( ! current_user_can( $capability ) ) {
		return new WP_Error(
			'openstation_beta_forbidden',
			__( 'You are not allowed to manage OpenStation builds.', 'openstation-beta' ),
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
function openstation_beta_ajax_error( $error ) {
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
function openstation_beta_ajax_state() {
	$guard = openstation_beta_ajax_guard( 'update_plugins' );
	if ( is_wp_error( $guard ) ) {
		openstation_beta_ajax_error( $guard );
		return;
	}

	// phpcs:ignore WordPress.Security.NonceVerification.Missing -- nonce verified in openstation_beta_ajax_guard().
	$force = ! empty( $_POST['refresh'] );
	$state = openstation_beta_state( $force );
	if ( is_wp_error( $state ) ) {
		openstation_beta_ajax_error( $state );
		return;
	}
	wp_send_json_success( $state );
}
add_action( 'wp_ajax_openstation_beta_state', 'openstation_beta_ajax_state' );

/**
 * Ajax: install a build (switch channel).
 *
 * @since 0.1.0
 */
function openstation_beta_ajax_switch() {
	$guard = openstation_beta_ajax_guard( 'install_plugins' );
	if ( is_wp_error( $guard ) ) {
		openstation_beta_ajax_error( $guard );
		return;
	}

	// phpcs:ignore WordPress.Security.NonceVerification.Missing -- nonce verified in openstation_beta_ajax_guard().
	$source = isset( $_POST['source'] ) ? sanitize_key( wp_unslash( $_POST['source'] ) ) : '';
	// phpcs:ignore WordPress.Security.NonceVerification.Missing -- nonce verified in openstation_beta_ajax_guard().
	$id = isset( $_POST['id'] ) ? sanitize_text_field( wp_unslash( $_POST['id'] ) ) : '';

	$result = openstation_beta_switch( $source, $id );
	if ( is_wp_error( $result ) ) {
		openstation_beta_ajax_error( $result );
		return;
	}
	wp_send_json_success( $result );
}
add_action( 'wp_ajax_openstation_beta_switch', 'openstation_beta_ajax_switch' );
