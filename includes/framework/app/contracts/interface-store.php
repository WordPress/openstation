<?php

namespace OpenStation\App\Contracts;

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

interface Store {

	public function get( $scope, $key, $fallback = null );

	public function set( $scope, $key, $value );

	public function delete( $scope, $key );
}
