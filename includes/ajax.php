<?php

defined( 'ABSPATH' ) || exit;

function openstation_ajax_save() {
	check_ajax_referer( 'save-openstation', 'nonce' );

	if ( ! current_user_can( 'read' ) ) {
		wp_send_json_error( 'openstation_forbidden', 403 );
	}

	$allowed = apply_filters( 'openstation_mode_enabled', true, get_current_user_id() );
	if ( ! $allowed ) {
		wp_send_json_error( 'openstation_disabled' );
	}

	$enabled = ! empty( $_POST['enabled'] ) && '1' === $_POST['enabled'] ? '1' : '';

	update_user_meta( get_current_user_id(), 'desktop_mode_mode', $enabled );

	if ( '1' === $enabled ) {
		openstation_record_user_enabled( get_current_user_id() );
	} else {
		openstation_record_user_disabled( get_current_user_id() );
	}

	$in_network = ! empty( $_POST['network'] ) && current_user_can( 'manage_network' );
	$admin      = $in_network ? network_admin_url() : admin_url();
	$redirect   = '1' === $enabled
		? openstation_shell_url( $admin . 'index.php', false, $in_network )
		: $admin;

	wp_send_json_success(
		array(
			'enabled'  => $enabled,
			'redirect' => esc_url_raw( $redirect ),
		)
	);
}
add_action( 'wp_ajax_save-openstation', 'openstation_ajax_save' );
