<?php

defined( 'ABSPATH' ) || exit;

function openstation_create_registry( $initial = array() ) {
	$state = is_array( $initial ) ? $initial : array();
	return static function ( $id = '', $entry = null ) use ( &$state ) {

		if ( '__flush__' === (string) $id ) {
			$state = array();
			return array();
		}

		if ( '' === (string) $id ) {
			return $state;
		}

		if ( null !== $entry ) {
			$state[ (string) $id ] = $entry;
			return $entry;
		}

		$key = (string) $id;
		return isset( $state[ $key ] ) ? $state[ $key ] : null;
	};
}

function openstation_create_script_registry( $initial = array() ) {
	$state = is_array( $initial ) ? $initial : array();
	return static function ( $handle = '', $value = null ) use ( &$state ) {
		if ( '__flush__' === (string) $handle ) {
			$state = array();
			return array();
		}
		if ( '' === (string) $handle ) {
			return $state;
		}
		if ( null !== $value ) {
			$state[ (string) $handle ] = (bool) $value;
			return (bool) $value;
		}
		$key = (string) $handle;
		return isset( $state[ $key ] ) ? $state[ $key ] : false;
	};
}
