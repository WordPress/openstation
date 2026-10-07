<?php

namespace OpenStation\App\WordPress;

use OpenStation\App\Contracts\Store as StoreContract;

defined( 'ABSPATH' ) || exit;

final class Store implements StoreContract {

	const META_KEY = 'openstation_app_store';

	private function map( $scope ) {
		if ( 'site' === $scope ) {
			$map = get_option( self::META_KEY, array() );
		} else {
			$map = get_user_meta( get_current_user_id(), self::META_KEY, true );
		}
		return is_array( $map ) ? $map : array();
	}

	private function save( $scope, array $map ) {
		if ( 'site' === $scope ) {
			update_option( self::META_KEY, $map, false );
		} else {
			update_user_meta( get_current_user_id(), self::META_KEY, $map );
		}
	}

	public function get( $scope, $key, $fallback = null ) {
		$map = $this->map( $scope );
		return array_key_exists( $key, $map ) ? $map[ $key ] : $fallback;
	}

	public function set( $scope, $key, $value ) {
		$map         = $this->map( $scope );
		$map[ $key ] = $value;
		$this->save( $scope, $map );
	}

	public function delete( $scope, $key ) {
		$map = $this->map( $scope );
		unset( $map[ $key ] );
		$this->save( $scope, $map );
	}
}
