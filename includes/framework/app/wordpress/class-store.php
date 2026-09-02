<?php
/**
 * OpenStation App Framework — WordPress Store adapter.
 *
 * `user` scope is one user-meta row holding a key → value map;
 * `site` scope is one non-autoloaded option holding the same shape.
 * One row per scope keeps an app from spraying meta keys across the
 * table and makes "forget everything this app stored" one delete.
 *
 * @package OpenStation
 */

namespace OpenStation\App\WordPress;

use OpenStation\App\Contracts\Store as StoreContract;

defined( 'ABSPATH' ) || exit;

/**
 * User-meta + option backed store.
 */
final class Store implements StoreContract {

	const META_KEY = 'openstation_app_store';

	/**
	 * Read the whole map for a scope.
	 *
	 * @param string $scope `user` | `site`.
	 * @return array<string,mixed>
	 */
	private function map( $scope ) {
		if ( 'site' === $scope ) {
			$map = get_option( self::META_KEY, array() );
		} else {
			$map = get_user_meta( get_current_user_id(), self::META_KEY, true );
		}
		return is_array( $map ) ? $map : array();
	}

	/**
	 * Write the whole map for a scope.
	 *
	 * @param string              $scope `user` | `site`.
	 * @param array<string,mixed> $map   Map.
	 * @return void
	 */
	private function save( $scope, array $map ) {
		if ( 'site' === $scope ) {
			update_option( self::META_KEY, $map, false );
		} else {
			update_user_meta( get_current_user_id(), self::META_KEY, $map );
		}
	}

	/** {@inheritDoc} */
	public function get( $scope, $key, $fallback = null ) {
		$map = $this->map( $scope );
		return array_key_exists( $key, $map ) ? $map[ $key ] : $fallback;
	}

	/** {@inheritDoc} */
	public function set( $scope, $key, $value ) {
		$map         = $this->map( $scope );
		$map[ $key ] = $value;
		$this->save( $scope, $map );
	}

	/** {@inheritDoc} */
	public function delete( $scope, $key ) {
		$map = $this->map( $scope );
		unset( $map[ $key ] );
		$this->save( $scope, $map );
	}
}
