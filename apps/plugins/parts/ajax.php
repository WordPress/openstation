<?php

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

function openstation_plugins_window_ajax_guard( $cap ) {
	if ( ! check_ajax_referer( 'desktop-mode-plugins', '_ajax_nonce', false ) ) {
		return new WP_Error(
			'openstation_plugins_bad_nonce',
			__( 'Security check failed. Refresh the window and try again.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}

	if (
		is_multisite() &&
		in_array( $cap, array( 'install_plugins', 'upload_plugins', 'delete_plugins' ), true )
	) {
		return new WP_Error(
			'openstation_plugins_network_managed',
			__( 'Plugins are managed from the network admin on this site.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}
	if ( ! current_user_can( $cap ) ) {
		return new WP_Error(
			'openstation_plugins_forbidden',
			__( 'You are not allowed to do that.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}
	return true;
}

function openstation_plugins_window_ajax_error( WP_Error $error ) {
	$status = 500;
	$data   = $error->get_error_data();
	if ( is_array( $data ) && isset( $data['status'] ) ) {
		$status = (int) $data['status'];
	}
	wp_send_json_error(
		array(
			'code'    => $error->get_error_code(),
			'message' => $error->get_error_message(),
		),
		$status
	);
}

function openstation_plugins_window_load_plugins_api() {
	if ( ! function_exists( 'plugins_api' ) ) {
		require_once ABSPATH . 'wp-admin/includes/plugin-install.php';
	}
}

function openstation_plugins_window_ajax_slug() {

	$slug = isset( $_POST['slug'] ) ? sanitize_key( wp_unslash( (string) $_POST['slug'] ) ) : '';
	if ( '' === $slug ) {
		openstation_plugins_window_ajax_error(
			new WP_Error(
				'openstation_plugins_missing_slug',
				__( 'Missing plugin slug.', 'desktop-mode' ),
				array( 'status' => 400 )
			)
		);
	}
	return $slug;
}

function openstation_plugins_window_ajax_browse() {
	$guard = openstation_plugins_window_ajax_guard( 'install_plugins' );
	if ( is_wp_error( $guard ) ) {
		openstation_plugins_window_ajax_error( $guard );
		return;
	}
	openstation_plugins_window_load_plugins_api();

	$browse  = isset( $_POST['browse'] ) ? sanitize_key( wp_unslash( (string) $_POST['browse'] ) ) : 'featured';
	$allowed = array( 'featured', 'popular', 'recommended', 'favorites', 'new', 'beta' );
	if ( ! in_array( $browse, $allowed, true ) ) {
		$browse = 'featured';
	}
	$search   = isset( $_POST['search'] ) ? sanitize_text_field( wp_unslash( (string) $_POST['search'] ) ) : '';
	$page     = isset( $_POST['page'] ) ? max( 1, (int) $_POST['page'] ) : 1;
	$per_page = isset( $_POST['per_page'] ) ? max( 1, min( 60, (int) $_POST['per_page'] ) ) : 24;

	$api_args = array(
		'page'     => $page,
		'per_page' => $per_page,

		'fields'   => array(
			'icons'             => true,
			'banners'           => false,
			'short_description' => true,
			'description'       => false,
			'sections'          => false,
			'screenshots'       => false,
			'rating'            => true,
			'ratings'           => false,
			'num_ratings'       => true,
			'active_installs'   => true,
			'last_updated'      => true,
			'tested'            => true,
			'requires'          => true,
			'requires_php'      => true,
			'homepage'          => true,
			'compatibility'     => false,
			'group'             => false,
			'contributors'      => false,
			'donate_link'       => false,
		),
	);
	if ( '' !== $search ) {
		$api_args['search'] = $search;
	} else {
		$api_args['browse'] = $browse;
	}

	$api_args = (array) apply_filters(
		'openstation_plugins_window_browse_args',
		$api_args,
		array(
			'browse'   => $browse,
			'search'   => $search,
			'page'     => $page,
			'per_page' => $per_page,
		)
	);

	$cache_key = 'dm_pwbrowse_' . md5( wp_json_encode( $api_args ) );
	$cached    = get_transient( $cache_key );
	if ( false !== $cached && is_array( $cached ) ) {
		wp_send_json_success( $cached );
		return;
	}

	$result = plugins_api( 'query_plugins', $api_args );
	if ( is_wp_error( $result ) ) {
		openstation_plugins_window_ajax_error( $result );
		return;
	}

	$payload = array(
		'plugins' => isset( $result->plugins ) ? array_values( (array) $result->plugins ) : array(),
		'info'    => isset( $result->info ) ? (array) $result->info : array(),
	);

	$payload = (array) apply_filters( 'openstation_plugins_window_browse_response', $payload, $api_args );

	set_transient( $cache_key, $payload, 10 * MINUTE_IN_SECONDS );
	wp_send_json_success( $payload );
}
add_action( 'wp_ajax_openstation_plugins_browse', 'openstation_plugins_window_ajax_browse' );

function openstation_plugins_window_ajax_info() {
	$guard = openstation_plugins_window_ajax_guard( 'install_plugins' );
	if ( is_wp_error( $guard ) ) {
		openstation_plugins_window_ajax_error( $guard );
		return;
	}
	openstation_plugins_window_load_plugins_api();

	$slug = openstation_plugins_window_ajax_slug();
	if ( '' === $slug ) {
		return;
	}

	$cache_key = 'dm_pwinfo_' . md5( $slug );
	$cached    = get_transient( $cache_key );
	if ( false !== $cached && is_array( $cached ) ) {
		wp_send_json_success( $cached );
		return;
	}

	$result = plugins_api(
		'plugin_information',
		array(
			'slug'   => $slug,
			'fields' => array(
				'sections'          => true,
				'screenshots'       => true,
				'ratings'           => true,
				'banners'           => true,
				'icons'             => true,
				'contributors'      => false,
				'last_updated'      => true,
				'requires'          => true,
				'requires_php'      => true,
				'tested'            => true,
				'homepage'          => true,
				'short_description' => true,
				'donate_link'       => false,
				'reviews'           => false,
			),
		)
	);
	if ( is_wp_error( $result ) ) {
		openstation_plugins_window_ajax_error( $result );
		return;
	}

	$payload = (array) apply_filters( 'openstation_plugins_window_info_response', (array) $result, $slug );

	set_transient( $cache_key, $payload, HOUR_IN_SECONDS );
	wp_send_json_success( $payload );
}
add_action( 'wp_ajax_openstation_plugins_info', 'openstation_plugins_window_ajax_info' );
