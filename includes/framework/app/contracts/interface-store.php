<?php
/**
 * OpenStation App Framework — Store contract.
 *
 * Durable key/value storage an app may write: per acting user
 * (`user` scope) or site-wide (`site` scope). The host decides where
 * it lives — user meta and options on WordPress, files or a table on
 * a bare PHP host. Keys arrive already namespaced by the app.
 *
 * @package OpenStation
 */

namespace OpenStation\App\Contracts;

if ( ! defined( 'ABSPATH' ) && ! defined( 'OPENSTATION_STANDALONE' ) ) {
	exit;
}

interface Store {

	/**
	 * Read a stored value.
	 *
	 * @param string $scope    `user` | `site`.
	 * @param string $key      Key.
	 * @param mixed  $fallback Returned when unset.
	 * @return mixed
	 */
	public function get( $scope, $key, $fallback = null );

	/**
	 * Write a value.
	 *
	 * @param string $scope `user` | `site`.
	 * @param string $key   Key.
	 * @param mixed  $value Serialisable value.
	 * @return void
	 */
	public function set( $scope, $key, $value );

	/**
	 * Remove a value.
	 *
	 * @param string $scope `user` | `site`.
	 * @param string $key   Key.
	 * @return void
	 */
	public function delete( $scope, $key );
}
