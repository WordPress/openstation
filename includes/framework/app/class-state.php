<?php
/**
 * OpenStation App Framework — window state.
 *
 * The one bag of values a window's view is a function of. The app
 * declares its shape with `App::state( $defaults )`; the client
 * echoes the bag back with every dispatch; the server rebuilds it
 * here, **admitting only declared keys and only values of the
 * declared type**. A client can therefore never smuggle in a key the
 * app did not ask for, and an action can rely on `$state->get(
 * 'range' )` being the string it was declared as.
 *
 * Everything else — parsed entries, query results, computed rows —
 * is not state. It is derived inside the view on every render, which
 * keeps the wire small and the server stateless.
 *
 * @package OpenStation
 */

namespace OpenStation\App;

if ( ! defined( 'ABSPATH' ) && ! defined( 'OPENSTATION_STANDALONE' ) ) {
	exit;
}

/**
 * Typed, schema-bound window state.
 */
final class State implements \ArrayAccess, \JsonSerializable {

	/**
	 * Declared defaults — the schema.
	 *
	 * @var array<string,mixed>
	 */
	private $defaults;

	/**
	 * Current values, always a superset of the defaults' keys.
	 *
	 * @var array<string,mixed>
	 */
	private $values;

	/**
	 * @param array<string,mixed> $defaults Declared defaults.
	 * @param array<string,mixed> $incoming Values sent by the client; filtered against the defaults.
	 */
	public function __construct( array $defaults, array $incoming = array() ) {
		$this->defaults = $defaults;
		$this->values   = $defaults;
		foreach ( $defaults as $key => $default ) {
			if ( array_key_exists( $key, $incoming ) ) {
				$this->values[ $key ] = self::accept( $default, $incoming[ $key ] );
			}
		}
	}

	/**
	 * Coerce an incoming value onto the declared default's type, or
	 * fall back to the default when the shapes disagree.
	 *
	 * @param mixed $default Declared default.
	 * @param mixed $value   Incoming value.
	 * @return mixed
	 */
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
		// A `null` default declares an untyped slot: any JSON value.
		return is_scalar( $value ) || is_array( $value ) || null === $value ? $value : $default;
	}

	/**
	 * Read a key.
	 *
	 * @param string $key      State key.
	 * @param mixed  $fallback Returned for an undeclared key.
	 * @return mixed
	 */
	public function get( $key, $fallback = null ) {
		return array_key_exists( $key, $this->values ) ? $this->values[ $key ] : $fallback;
	}

	/**
	 * Write a key. Undeclared keys are ignored — declare them in
	 * `App::state()` first.
	 *
	 * @param string $key   State key.
	 * @param mixed  $value New value.
	 * @return self
	 */
	public function set( $key, $value ) {
		if ( array_key_exists( $key, $this->defaults ) ) {
			$this->values[ $key ] = self::accept( $this->defaults[ $key ], $value );
		}
		return $this;
	}

	/**
	 * Whether a key is declared.
	 *
	 * @param string $key State key.
	 * @return bool
	 */
	public function has( $key ) {
		return array_key_exists( $key, $this->defaults );
	}

	/**
	 * Flip a boolean key.
	 *
	 * @param string $key State key.
	 * @return self
	 */
	public function toggle( $key ) {
		return $this->set( $key, ! $this->get( $key ) );
	}

	/**
	 * Add an item to a list key when absent, remove it when present.
	 * The shape every "expanded rows" / "hidden series" set needs.
	 *
	 * @param string $key  State key holding a list.
	 * @param mixed  $item Scalar item.
	 * @return self
	 */
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

	/**
	 * Whether a list key contains an item.
	 *
	 * @param string $key  State key holding a list.
	 * @param mixed  $item Scalar item.
	 * @return bool
	 */
	public function contains( $key, $item ) {
		$list = $this->get( $key );
		return is_array( $list ) && in_array( $item, $list, true );
	}

	/**
	 * Put a key back to its declared default.
	 *
	 * @param string $key State key.
	 * @return self
	 */
	public function reset( $key ) {
		if ( array_key_exists( $key, $this->defaults ) ) {
			$this->values[ $key ] = $this->defaults[ $key ];
		}
		return $this;
	}

	/**
	 * Every value, declared order.
	 *
	 * @return array<string,mixed>
	 */
	public function all() {
		return $this->values;
	}

	/**
	 * The declared defaults.
	 *
	 * @return array<string,mixed>
	 */
	public function defaults() {
		return $this->defaults;
	}

	/** {@inheritDoc} */
	#[\ReturnTypeWillChange]
	public function jsonSerialize() {
		return $this->values;
	}

	/** {@inheritDoc} */
	#[\ReturnTypeWillChange]
	public function offsetExists( $offset ) {
		return $this->has( $offset );
	}

	/** {@inheritDoc} */
	#[\ReturnTypeWillChange]
	public function offsetGet( $offset ) {
		return $this->get( $offset );
	}

	/** {@inheritDoc} */
	#[\ReturnTypeWillChange]
	public function offsetSet( $offset, $value ) {
		$this->set( $offset, $value );
	}

	/** {@inheritDoc} */
	#[\ReturnTypeWillChange]
	public function offsetUnset( $offset ) {
		$this->reset( $offset );
	}
}
