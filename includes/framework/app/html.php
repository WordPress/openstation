<?php

namespace OpenStation\App\Html;

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

function esc( $text ) {
	return htmlspecialchars( (string) $text, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8' );
}

function json( $value ) {
	return esc( (string) json_encode( $value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) );
}

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
