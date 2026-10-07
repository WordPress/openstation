<?php

defined( 'ABSPATH' ) || exit;

function openstation_get_accent_colors() {
	$defaults = array(

		array(
			'id'    => 'pulse',
			'label' => __( 'Pulse', 'desktop-mode' ),
			'value' => '#f252fc',
		),
		array(
			'id'    => 'nebula',
			'label' => __( 'Nebula', 'desktop-mode' ),
			'value' => '#ec9bff',
		),

		array(
			'id'    => 'sirius',
			'label' => __( 'Sirius', 'desktop-mode' ),
			'value' => '#9af2ff',
		),
		array(
			'id'    => 'lagoon',
			'label' => __( 'Lagoon', 'desktop-mode' ),
			'value' => '#9f98ff',
		),
		array(
			'id'    => 'starlight',
			'label' => __( 'Starlight', 'desktop-mode' ),
			'value' => '#fffbff',
		),
		array(
			'id'    => 'wp-blue',
			'label' => __( 'WordPress Blue', 'desktop-mode' ),
			'value' => '#2271b1',
		),
		array(
			'id'    => 'indigo',
			'label' => __( 'Indigo', 'desktop-mode' ),
			'value' => '#3858e9',
		),
		array(
			'id'    => 'teal',
			'label' => __( 'Teal', 'desktop-mode' ),
			'value' => '#04a4cc',
		),
		array(
			'id'    => 'emerald',
			'label' => __( 'Emerald', 'desktop-mode' ),
			'value' => '#059669',
		),
		array(
			'id'    => 'amber',
			'label' => __( 'Amber', 'desktop-mode' ),
			'value' => '#d97706',
		),
		array(
			'id'    => 'rose',
			'label' => __( 'Rose', 'desktop-mode' ),
			'value' => '#e11d48',
		),
	);

	$filtered = apply_filters( 'openstation_accent_colors', $defaults );
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
		$value = isset( $entry['value'] ) ? sanitize_hex_color( (string) $entry['value'] ) : '';
		if ( '' === $id || '' === $label || null === $value || '' === $value ) {
			continue;
		}
		if ( isset( $seen[ $id ] ) ) {
			continue;
		}
		$seen[ $id ] = true;
		$clean[]     = array(
			'id'    => $id,
			'label' => $label,
			'value' => $value,
		);
	}

	return empty( $clean ) ? $defaults : $clean;
}
