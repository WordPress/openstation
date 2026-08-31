<?php
/**
 * OpenStation App Framework — WordPress Cache adapter.
 *
 * Backed by the object cache under one group. Without a persistent
 * object cache drop-in this only lives for the request, which is
 * exactly the contract: a miss is always safe.
 *
 * @package OpenStation
 */

namespace OpenStation\App\WordPress;

use OpenStation\App\Contracts\Cache as CacheContract;

defined( 'ABSPATH' ) || exit;

/**
 * Object-cache backed cache.
 */
final class Cache implements CacheContract {

	const GROUP = 'openstation_apps';

	/** {@inheritDoc} */
	public function get( $key, $fallback = null ) {
		$found = false;
		$value = wp_cache_get( (string) $key, self::GROUP, false, $found );
		return $found ? $value : $fallback;
	}

	/** {@inheritDoc} */
	public function set( $key, $value, $ttl = 0 ) {
		wp_cache_set( (string) $key, $value, self::GROUP, max( 0, (int) $ttl ) );
	}

	/** {@inheritDoc} */
	public function delete( $key ) {
		wp_cache_delete( (string) $key, self::GROUP );
	}
}
