<?php

defined( 'ABSPATH' ) || exit;

function openstation_ai_normalize_response_schema( array $schema ) {
	if ( openstation_ai_schema_is_object_node( $schema ) ) {
		$schema['additionalProperties'] = false;
		if ( isset( $schema['properties'] ) && is_array( $schema['properties'] ) && array() !== $schema['properties'] ) {

			$schema['required'] = array_keys( $schema['properties'] );
		}
	}

	foreach ( array( 'properties', 'patternProperties', '$defs', 'definitions' ) as $map_key ) {
		if ( isset( $schema[ $map_key ] ) && is_array( $schema[ $map_key ] ) ) {
			foreach ( $schema[ $map_key ] as $name => $sub ) {
				if ( is_array( $sub ) ) {
					$schema[ $map_key ][ $name ] = openstation_ai_normalize_response_schema( $sub );
				}
			}
		}
	}

	if ( isset( $schema['items'] ) && is_array( $schema['items'] ) ) {
		$items   = $schema['items'];
		$is_list = array_keys( $items ) === range( 0, count( $items ) - 1 );
		if ( $is_list && array() !== $items ) {

			foreach ( $items as $i => $sub ) {
				if ( is_array( $sub ) ) {
					$items[ $i ] = openstation_ai_normalize_response_schema( $sub );
				}
			}
			$schema['items'] = $items;
		} else {
			$schema['items'] = openstation_ai_normalize_response_schema( $items );
		}
	}

	foreach ( array( 'oneOf', 'allOf', 'anyOf', 'prefixItems' ) as $list_key ) {
		if ( isset( $schema[ $list_key ] ) && is_array( $schema[ $list_key ] ) ) {
			foreach ( $schema[ $list_key ] as $i => $sub ) {
				if ( is_array( $sub ) ) {
					$schema[ $list_key ][ $i ] = openstation_ai_normalize_response_schema( $sub );
				}
			}
		}
	}

	if ( isset( $schema['not'] ) && is_array( $schema['not'] ) ) {
		$schema['not'] = openstation_ai_normalize_response_schema( $schema['not'] );
	}

	return $schema;
}

function openstation_ai_schema_is_object_node( array $schema ) {
	if ( isset( $schema['type'] ) ) {
		$types = is_array( $schema['type'] ) ? $schema['type'] : array( $schema['type'] );
		return in_array( 'object', $types, true );
	}

	return isset( $schema['properties'] ) || isset( $schema['patternProperties'] );
}
