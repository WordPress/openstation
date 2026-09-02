<?php
/**
 * OpenStation App Framework — standalone Cache adapter.
 *
 * In-process only: lives for the request, honours TTLs, forgets
 * everything when the process ends.
 *
 * @package OpenStation
 */

namespace OpenStation\App\Standalone;

use OpenStation\App\Contracts\Cache as CacheContract;

// Direct access, unless a standalone host is booting on bare PHP.
if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

/**
 * Per-process cache.
 */
final class Cache implements CacheContract {

	/**
	 * `key => array( expires_at|0, value )`.
	 *
	 * @var array<string,array{0:int,1:mixed}>
	 */
	private $items = array();

	/** {@inheritDoc} */
	public function get( $key, $fallback = null ) {
		if ( ! isset( $this->items[ $key ] ) ) {
			return $fallback;
		}
		list( $expires_at, $value ) = $this->items[ $key ];
		if ( 0 !== $expires_at && $expires_at < time() ) {
			unset( $this->items[ $key ] );
			return $fallback;
		}
		return $value;
	}

	/** {@inheritDoc} */
	public function set( $key, $value, $ttl = 0 ) {
		$ttl                 = (int) $ttl;
		$this->items[ $key ] = array( $ttl > 0 ? time() + $ttl : 0, $value );
	}

	/** {@inheritDoc} */
	public function delete( $key ) {
		unset( $this->items[ $key ] );
	}
}
