<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_NETWORK_HOP_ARG = 'openstation_hop';

const OPENSTATION_NETWORK_HOP_FROM_ARG = 'openstation_hop_from';

function openstation_network_enabled() {
	$options = openstation_get_extended_options();
	$enabled = ! empty( $options['network'] );

	return (bool) apply_filters( 'openstation_network_enabled', $enabled );
}

function openstation_network_load() {
	if ( ! openstation_network_enabled() ) {
		return;
	}

	require_once OPENSTATION_DIR . 'includes/network/keys.php';
	require_once OPENSTATION_DIR . 'includes/network/identity.php';
	require_once OPENSTATION_DIR . 'includes/network/registry.php';
	require_once OPENSTATION_DIR . 'includes/network/hub.php';
	require_once OPENSTATION_DIR . 'includes/network/member.php';
	require_once OPENSTATION_DIR . 'includes/network/hop.php';
}
add_action( 'plugins_loaded', 'openstation_network_load', 5 );
