<?php
/**
 * OpenStation App Framework — Cache contract.
 *
 * A best-effort key/value cache. A miss must be indistinguishable
 * from "never stored" — apps only ever use it to skip work they can
 * redo, never as storage.
 *
 * @package OpenStation
 */

namespace OpenStation\App\Contracts;

if ( ! defined( 'ABSPATH' ) && ! defined( 'OPENSTATION_STANDALONE' ) ) {
	exit;
}

interface Cache {

	/**
	 * Read a cached value.
	 *
	 * @param string $key      Cache key.
	 * @param mixed  $fallback Returned on a miss.
	 * @return mixed
	 */
	public function get( $key, $fallback = null );

	/**
	 * Store a value.
	 *
	 * @param string $key   Cache key.
	 * @param mixed  $value Any serialisable value.
	 * @param int    $ttl   Lifetime in seconds; 0 for "as long as the host keeps it".
	 * @return void
	 */
	public function set( $key, $value, $ttl = 0 );

	/**
	 * Forget a value.
	 *
	 * @param string $key Cache key.
	 * @return void
	 */
	public function delete( $key );
}
