<?php
/**
 * OpenStation App Framework — template helpers.
 *
 * The four functions an `.osx.php` view needs and nothing more:
 *
 *     use function OpenStation\App\Html\{ esc, attr, json, tag };
 *
 *     <os-badge tone="<?php echo esc( $tone ); ?>"><?php echo esc( $label ); ?></os-badge>
 *     <os-select<?php echo attr( array( 'value' => $id, 'disabled' => $off ) ); ?>>
 *     <os-histogram series="<?php echo json( $series ); ?>"></os-histogram>
 *
 * Host-agnostic on purpose — no `esc_html()` — so the same view
 * renders on WordPress and on a bare PHP host. `esc()` and `json()`
 * are registered as escaping functions in `phpcs.xml.dist`.
 *
 * @package OpenStation
 */

namespace OpenStation\App\Html;

if ( ! defined( 'ABSPATH' ) && ! defined( 'OPENSTATION_STANDALONE' ) ) {
	exit;
}

/**
 * Escape text for an HTML text node or a quoted attribute.
 *
 * @param mixed $text Anything stringable.
 * @return string
 */
function esc( $text ) {
	return htmlspecialchars( (string) $text, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8' );
}

/**
 * Serialise a value as JSON, escaped for a quoted attribute.
 *
 * @param mixed $value JSON-serialisable value.
 * @return string
 */
function json( $value ) {
	return esc( (string) json_encode( $value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) );
}

/**
 * Render an attribute list from an array, leading space included.
 *
 * `true` renders a bare boolean attribute, `false`/`null` render
 * nothing, arrays and objects render as JSON, everything else is
 * escaped. So `array( 'value' => 'x', 'open' => $is_open )` gives
 * ` value="x" open` or ` value="x"`.
 *
 * @param array<string,mixed> $attrs Attribute map.
 * @return string
 */
function attr( array $attrs ) {
	$out = '';
	foreach ( $attrs as $name => $value ) {
		if ( false === $value || null === $value ) {
			continue;
		}
		$name = (string) $name;
		if ( '' === $name || ! preg_match( '/^[a-zA-Z_:][-a-zA-Z0-9_:.]*$/', $name ) ) {
			continue;
		}
		if ( true === $value ) {
			$out .= ' ' . $name;
			continue;
		}
		if ( is_array( $value ) || is_object( $value ) ) {
			$out .= ' ' . $name . '="' . json( $value ) . '"';
			continue;
		}
		$out .= ' ' . $name . '="' . esc( $value ) . '"';
	}
	return $out;
}

/**
 * Render one element. `$inner` is HTML the caller already escaped
 * (or built with these helpers) — pass `esc( $text )` for text.
 *
 * @param string              $name  Tag name.
 * @param array<string,mixed> $attrs Attribute map, see {@see attr()}.
 * @param string              $inner Inner HTML. Ignored for void elements.
 * @return string
 */
function tag( $name, array $attrs = array(), $inner = '' ) {
	static $void = array( 'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr' );

	$name = strtolower( (string) preg_replace( '/[^a-zA-Z0-9-]/', '', (string) $name ) );
	if ( '' === $name ) {
		return '';
	}
	$open = '<' . $name . attr( $attrs ) . '>';
	if ( in_array( $name, $void, true ) ) {
		return $open;
	}
	return $open . (string) $inner . '</' . $name . '>';
}

/**
 * Build a class attribute value from conditionals.
 *
 * `classes( 'row', array( 'is-open' => $open, 'is-busy' => $busy ) )`
 * → `row is-open` when only `$open` is true.
 *
 * @param string|array ...$parts Class names, or `name => condition` maps.
 * @return string
 */
function classes( ...$parts ) {
	$out = array();
	foreach ( $parts as $part ) {
		if ( is_array( $part ) ) {
			foreach ( $part as $name => $condition ) {
				if ( is_int( $name ) ) {
					if ( '' !== (string) $condition ) {
						$out[] = (string) $condition;
					}
				} elseif ( $condition ) {
					$out[] = (string) $name;
				}
			}
		} elseif ( '' !== (string) $part ) {
			$out[] = (string) $part;
		}
	}
	return implode( ' ', array_unique( $out ) );
}
