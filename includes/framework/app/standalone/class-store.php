<?php

namespace OpenStation\App\Standalone;

use OpenStation\App\Contracts\Store as StoreContract;

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

final class Store implements StoreContract {

	private $data = array(
		'user' => array(),
		'site' => array(),
	);

	public function get( $scope, $key, $fallback = null ) {
		return isset( $this->data[ $scope ] ) && array_key_exists( $key, $this->data[ $scope ] )
			? $this->data[ $scope ][ $key ]
			: $fallback;
	}

	public function set( $scope, $key, $value ) {
		$this->data[ $scope ][ $key ] = $value;
	}

	public function delete( $scope, $key ) {
		unset( $this->data[ $scope ][ $key ] );
	}
}
