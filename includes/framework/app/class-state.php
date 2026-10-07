<?php

namespace OpenStation\App;

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

final class State implements \ArrayAccess, \JsonSerializable {

	private $defaults;

	private $values;

	public function __construct( array $defaults, array $incoming = array() ) {
		$this->defaults = $defaults;
		$this->values   = $defaults;
		foreach ( $defaults as $key => $default ) {
			if ( array_key_exists( $key, $incoming ) ) {
				$this->values[ $key ] = self::accept( $default, $incoming[ $key ] );
			}
		}
	}

	private static function accept( $default, $value ) {
		if ( is_bool( $default ) ) {
			if ( is_bool( $value ) ) {
				return $value;
			}
			if ( is_string( $value ) || is_int( $value ) ) {
				return in_array( $value, array( '1', 1, 'true', 'on' ), true );
			}
			return $default;
		}
		if ( is_int( $default ) ) {
			return is_numeric( $value ) ? (int) $value : $default;
		}
		if ( is_float( $default ) ) {
			return is_numeric( $value ) ? (float) $value : $default;
		}
		if ( is_string( $default ) ) {
			return is_scalar( $value ) ? (string) $value : $default;
		}
		if ( is_array( $default ) ) {
			return is_array( $value ) ? $value : $default;
		}

		return is_scalar( $value ) || is_array( $value ) || null === $value ? $value : $default;
	}

	public function get( $key, $fallback = null ) {
		return array_key_exists( $key, $this->values ) ? $this->values[ $key ] : $fallback;
	}

	public function set( $key, $value ) {
		if ( array_key_exists( $key, $this->defaults ) ) {
			$this->values[ $key ] = self::accept( $this->defaults[ $key ], $value );
		}
		return $this;
	}

	public function has( $key ) {
		return array_key_exists( $key, $this->defaults );
	}

	public function toggle( $key ) {
		return $this->set( $key, ! $this->get( $key ) );
	}

	public function toggle_item( $key, $item ) {
		$list = $this->get( $key );
		if ( ! is_array( $list ) ) {
			return $this;
		}
		$index = array_search( $item, $list, true );
		if ( false === $index ) {
			$list[] = $item;
		} else {
			unset( $list[ $index ] );
		}
		return $this->set( $key, array_values( $list ) );
	}

	public function contains( $key, $item ) {
		$list = $this->get( $key );
		return is_array( $list ) && in_array( $item, $list, true );
	}

	public function reset( $key ) {
		if ( array_key_exists( $key, $this->defaults ) ) {
			$this->values[ $key ] = $this->defaults[ $key ];
		}
		return $this;
	}

	public function all() {
		return $this->values;
	}

	public function defaults() {
		return $this->defaults;
	}

	#[\ReturnTypeWillChange]
	public function jsonSerialize() {
		return $this->values;
	}

	#[\ReturnTypeWillChange]
	public function offsetExists( $offset ) {
		return $this->has( $offset );
	}

	#[\ReturnTypeWillChange]
	public function offsetGet( $offset ) {
		return $this->get( $offset );
	}

	#[\ReturnTypeWillChange]
	public function offsetSet( $offset, $value ) {
		$this->set( $offset, $value );
	}

	#[\ReturnTypeWillChange]
	public function offsetUnset( $offset ) {
		$this->reset( $offset );
	}
}
