<?php

defined( 'ABSPATH' ) || exit;

function openstation_get_toast_types() {

	$defaults = array(
		array(
			'id'    => 'success',
			'label' => __( 'Success', 'desktop-mode' ),
			'icon'  => 'dashicons-yes-alt',
			'tone'  => 'positive',
		),
		array(
			'id'    => 'warning',
			'label' => __( 'Warning', 'desktop-mode' ),
			'icon'  => 'dashicons-warning',
			'tone'  => 'warning',
		),
		array(
			'id'    => 'error',
			'label' => __( 'Error', 'desktop-mode' ),
			'icon'  => 'dashicons-dismiss',
			'tone'  => 'critical',
		),
		array(
			'id'    => 'shell-error',
			'label' => __( 'Shell error', 'desktop-mode' ),
			'icon'  => 'dashicons-bug',
			'tone'  => 'critical',
		),
	);

	$allowed_tones = array( 'positive', 'warning', 'critical', 'neutral' );

	$filtered = apply_filters( 'openstation_toast_types', $defaults );
	if ( ! is_array( $filtered ) ) {
		return $defaults;
	}

	$clean = array();
	$seen  = array();
	foreach ( $filtered as $entry ) {
		if ( ! is_array( $entry ) ) {
			continue;
		}
		$id    = isset( $entry['id'] ) ? sanitize_key( (string) $entry['id'] ) : '';
		$label = isset( $entry['label'] ) ? wp_strip_all_tags( (string) $entry['label'] ) : '';
		$icon  = isset( $entry['icon'] ) ? sanitize_html_class( (string) $entry['icon'] ) : '';
		$tone  = isset( $entry['tone'] ) ? sanitize_key( (string) $entry['tone'] ) : '';
		if ( '' === $id || '' === $tone || ! in_array( $tone, $allowed_tones, true ) ) {
			continue;
		}
		if ( isset( $seen[ $id ] ) ) {
			continue;
		}
		$seen[ $id ] = true;
		$clean[]     = array(
			'id'    => $id,
			'label' => '' !== $label ? $label : ucfirst( $id ),
			'icon'  => '' !== $icon ? $icon : 'dashicons-info',
			'tone'  => $tone,
		);
	}

	return empty( $clean ) ? $defaults : $clean;
}
