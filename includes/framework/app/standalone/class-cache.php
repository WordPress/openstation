<?php

namespace OpenStation\App\Standalone;

use OpenStation\App\Contracts\Cache as CacheContract;

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

final class Cache implements CacheContract {

	private $items = array();

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

	public function set( $key, $value, $ttl = 0 ) {
		$ttl                 = (int) $ttl;
		$this->items[ $key ] = array( $ttl > 0 ? time() + $ttl : 0, $value );
	}

	public function delete( $key ) {
		unset( $this->items[ $key ] );
	}
}
