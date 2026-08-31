<?php
/**
 * OpenStation App Framework — standalone Store adapter.
 *
 * In-memory. A bare PHP host that needs durability passes its own
 * implementation to `Os::standalone( array( 'store' => … ) )`.
 *
 * @package OpenStation
 */

namespace OpenStation\App\Standalone;

use OpenStation\App\Contracts\Store as StoreContract;

if ( ! defined( 'ABSPATH' ) && ! defined( 'OPENSTATION_STANDALONE' ) ) {
	exit;
}

/**
 * In-memory key/value store.
 */
final class Store implements StoreContract {

	/**
	 * @var array<string,array<string,mixed>>
	 */
	private $data = array(
		'user' => array(),
		'site' => array(),
	);

	/** {@inheritDoc} */
	public function get( $scope, $key, $fallback = null ) {
		return isset( $this->data[ $scope ] ) && array_key_exists( $key, $this->data[ $scope ] )
			? $this->data[ $scope ][ $key ]
			: $fallback;
	}

	/** {@inheritDoc} */
	public function set( $scope, $key, $value ) {
		$this->data[ $scope ][ $key ] = $value;
	}

	/** {@inheritDoc} */
	public function delete( $scope, $key ) {
		unset( $this->data[ $scope ][ $key ] );
	}
}
