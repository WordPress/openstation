<?php

defined( 'ABSPATH' ) || exit;

function openstation_plugin_row_action_links( $links ) {
	if ( ! is_array( $links ) ) {
		$links = array();
	}
	if ( ! current_user_can( 'read' ) ) {
		return $links;
	}
	if ( openstation_is_chromeless_request() ) {
		return $links;
	}

	if ( openstation_is_enabled() ) {
		$link = sprintf(
			'<a href="%s">%s</a>',
			esc_url( openstation_shell_url() ),
			esc_html__( 'Open OpenStation', 'desktop-mode' )
		);
	} else {
		$link = sprintf(
			'<a href="%s">%s</a>',
			esc_url( openstation_portal_url() ),
			esc_html__( 'Turn on OpenStation', 'desktop-mode' )
		);
	}

	return array_merge( array( 'openstation' => $link ), $links );
}
add_filter( 'plugin_action_links_' . plugin_basename( OPENSTATION_FILE ), 'openstation_plugin_row_action_links' );
add_filter( 'network_admin_plugin_action_links_' . plugin_basename( OPENSTATION_FILE ), 'openstation_plugin_row_action_links' );
