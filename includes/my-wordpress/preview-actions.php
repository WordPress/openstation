<?php

defined( 'ABSPATH' ) || exit;

function openstation_my_wordpress_collect_preview_actions() {

	$actions = (array) apply_filters( 'openstation_my_wordpress_preview_actions', array() );

	$out = array();
	foreach ( $actions as $action ) {
		if ( ! is_array( $action ) || empty( $action['id'] ) || empty( $action['label'] ) ) {
			continue;
		}
		$cap = isset( $action['capability'] ) && '' !== $action['capability']
			? (string) $action['capability']
			: 'read';
		if ( ! current_user_can( $cap ) ) {
			continue;
		}
		$descriptor = array(
			'id'    => (string) $action['id'],
			'label' => (string) $action['label'],
		);
		if ( ! empty( $action['icon'] ) ) {
			$descriptor['icon'] = (string) $action['icon'];
		}
		if ( ! empty( $action['mime'] ) ) {
			$descriptor['mime'] = (string) $action['mime'];
		}
		if ( ! empty( $action['sections'] ) && is_array( $action['sections'] ) ) {
			$descriptor['sections'] = array_values( array_map( 'strval', $action['sections'] ) );
		}
		if ( ! empty( $action['script'] ) ) {
			$descriptor['script'] = (string) $action['script'];
		}
		$out[] = $descriptor;
	}
	return $out;
}

function openstation_my_wordpress_enqueue_preview_action_scripts() {
	if ( ! function_exists( 'openstation_my_wordpress_user_can_use' ) || ! openstation_my_wordpress_user_can_use() ) {
		return;
	}
	$actions = openstation_my_wordpress_collect_preview_actions();
	foreach ( $actions as $action ) {
		if ( ! empty( $action['script'] ) && wp_script_is( (string) $action['script'], 'registered' ) ) {
			wp_enqueue_script( (string) $action['script'] );
		}
	}
}
add_action( 'admin_enqueue_scripts', 'openstation_my_wordpress_enqueue_preview_action_scripts', 40 );
