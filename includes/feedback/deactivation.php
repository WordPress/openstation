<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_FEEDBACK_REASONS = array( 'changed_too_much', 'missing_features', 'too_buggy', 'other' );

const OPENSTATION_FEEDBACK_CONTEXTS = array( 'classic', 'chromeless', 'app' );

const OPENSTATION_FEEDBACK_DETAILS_MAX = 1000;

function openstation_deactivation_feedback_client_config( $context ) {
	if ( ! in_array( $context, OPENSTATION_FEEDBACK_CONTEXTS, true ) ) {
		$context = 'classic';
	}
	return array(
		'plugin'    => plugin_basename( OPENSTATION_FILE ),
		'restUrl'   => esc_url_raw( rest_url( 'desktop-mode/v1/feedback/deactivation' ) ),
		'restNonce' => wp_create_nonce( 'wp_rest' ),
		'context'   => $context,
	);
}

function openstation_deactivation_feedback_app_config() {
	if ( ! openstation_deactivation_feedback_enabled() ) {
		return null;
	}
	$script = function_exists( 'openstation_resolve_script_payload' )
		? openstation_resolve_script_payload( 'os-deactivation-feedback' )
		: array();
	$url    = ! empty( $script['url'] )
		? (string) $script['url']
		: OPENSTATION_URL . 'assets/js/deactivation-feedback' . openstation_asset_suffix() . '.js';
	return array(
		'script'   => array(
			'url'          => esc_url_raw( $url ),
			'translations' => isset( $script['translations'] ) ? (string) $script['translations'] : '',
		),
		'styleUrl' => esc_url_raw( OPENSTATION_URL . 'assets/css/deactivation-feedback.css' ),
		'restUrl'  => esc_url_raw( rest_url( 'desktop-mode/v1/feedback/deactivation' ) ),
	);
}

function openstation_feedback_enqueue_deactivation_dialog( $hook_suffix ) {
	if ( 'plugins.php' !== $hook_suffix || ! current_user_can( 'activate_plugins' ) ) {
		return;
	}
	if ( ! openstation_deactivation_feedback_enabled() ) {
		return;
	}
	$context = function_exists( 'openstation_is_chromeless_request' ) && openstation_is_chromeless_request()
		? 'chromeless'
		: 'classic';
	wp_enqueue_style( 'os-deactivation-feedback' );
	wp_enqueue_script( 'os-deactivation-feedback' );
	wp_add_inline_script(
		'os-deactivation-feedback',
		'window.openStationDeactivationFeedbackConfig = ' . wp_json_encode( openstation_deactivation_feedback_client_config( $context ) ) . ';',
		'before'
	);
}
add_action( 'admin_enqueue_scripts', 'openstation_feedback_enqueue_deactivation_dialog' );

function openstation_feedback_stamp_moment( $stamp ) {
	if ( null === $stamp || 'activation' !== $stamp['via'] || $stamp['at'] <= 0 ) {
		return null;
	}
	return (int) $stamp['at'];
}

function openstation_feedback_days_between( $from, $to ) {
	if ( null === $from || null === $to ) {
		return null;
	}
	return max( 0, (int) floor( ( $to - $from ) / DAY_IN_SECONDS ) );
}

function openstation_deactivation_feedback_payload( $reasons, $details = '', $context = 'classic' ) {

	$reasons = array_values(
		array_intersect( OPENSTATION_FEEDBACK_REASONS, array_map( 'strval', (array) $reasons ) )
	);
	if ( empty( $reasons ) ) {
		$reasons = array( 'other' );
	}
	if ( ! in_array( $context, OPENSTATION_FEEDBACK_CONTEXTS, true ) ) {
		$context = 'classic';
	}
	$details = sanitize_textarea_field( (string) $details );
	if ( mb_strlen( $details ) > OPENSTATION_FEEDBACK_DETAILS_MAX ) {
		$details = mb_substr( $details, 0, OPENSTATION_FEEDBACK_DETAILS_MAX );
	}

	$enabled_users = function_exists( 'openstation_users_with_prior_desktop_use' )
		? openstation_users_with_prior_desktop_use()
		: array();

	$php = explode( '.', PHP_VERSION );

	$installed_at     = openstation_feedback_stamp_moment( openstation_get_install_stamp() );
	$first_enabled_at = openstation_feedback_stamp_moment( openstation_get_first_enabled_stamp() );

	$active_plugins = count(
		array_unique(
			array_merge(
				(array) get_option( 'active_plugins', array() ),
				is_multisite() ? array_keys( (array) get_site_option( 'active_sitewide_plugins', array() ) ) : array()
			)
		)
	);

	return array(
		'id'                      => wp_generate_uuid4(),
		'reasons'                 => $reasons,
		'details'                 => $details,
		'plugin_version'          => OPENSTATION_VERSION,
		'wp_version'              => get_bloginfo( 'version' ),
		'php_version'             => $php[0] . '.' . ( isset( $php[1] ) ? $php[1] : '0' ),
		'locale'                  => get_locale(),
		'multisite'               => is_multisite(),
		'install_age_days'        => openstation_feedback_days_between( $installed_at, time() ),
		'ever_enabled'            => count( $enabled_users ) > 0,
		'enabled_user_count'      => count( $enabled_users ),
		'first_enable_delay_days' => openstation_feedback_days_between( $installed_at, $first_enabled_at ),
		'deactivator_enabled'     => openstation_is_enabled(),
		'active_plugins'          => $active_plugins,
		'context'                 => $context,
	);
}

function openstation_deactivation_feedback_forward( array $payload ) {

	$endpoint = (string) apply_filters( 'openstation_deactivation_feedback_endpoint', OPENSTATION_FEEDBACK_ENDPOINT );
	if ( '' === $endpoint ) {
		return false;
	}
	$response = wp_remote_post(
		$endpoint,
		array(
			'timeout'     => 3,
			'redirection' => 0,
			'user-agent'  => 'WP OpenStation feedback/' . OPENSTATION_VERSION,
			'headers'     => array( 'Content-Type' => 'application/json' ),
			'body'        => wp_json_encode( $payload ),
		)
	);
	return ! is_wp_error( $response ) && 2 === (int) floor( wp_remote_retrieve_response_code( $response ) / 100 );
}
