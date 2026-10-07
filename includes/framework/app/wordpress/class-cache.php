<?php

namespace OpenStation\App\WordPress;

use OpenStation\App\Contracts\Cache as CacheContract;

defined( 'ABSPATH' ) || exit;

final class Cache implements CacheContract {

	const GROUP = 'openstation_apps';

	public function get( $key, $fallback = null ) {
		$found = false;
		$value = wp_cache_get( (string) $key, self::GROUP, false, $found );
		return $found ? $value : $fallback;
	}

	public function set( $key, $value, $ttl = 0 ) {
		wp_cache_set( (string) $key, $value, self::GROUP, max( 0, (int) $ttl ) );
	}

	public function delete( $key ) {
		wp_cache_delete( (string) $key, self::GROUP );
	}
}
