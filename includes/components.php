<?php

defined( 'ABSPATH' ) || exit;

function openstation_component( $tag, $attrs = array(), $content = '' ) {
	$tag = strtolower( (string) $tag );
	if ( ! preg_match( '/^os-[a-z][a-z0-9-]*$/', $tag ) ) {

		if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
			_doing_it_wrong(
				__FUNCTION__,
				sprintf(

					esc_html__( 'openstation_component() only accepts tags with the os- prefix; got "%s".', 'desktop-mode' ),
					esc_html( $tag )
				),
				'0.5.0'
			);
		}
		return;
	}

	$attr_parts = array();
	foreach ( (array) $attrs as $key => $value ) {
		$key = (string) $key;
		if ( ! preg_match( '/^[A-Za-z_][A-Za-z0-9_:.-]*$/', $key ) ) {

			continue;
		}
		if ( false === $value || null === $value ) {
			continue;
		}

		if ( 'style' === strtolower( $key ) && is_array( $value ) ) {
			$serialized = openstation_serialize_style_array( $value );
			if ( '' === $serialized ) {
				continue;
			}
			$attr_parts[] = sprintf(
				'style="%s"',
				esc_attr( $serialized )
			);
			continue;
		}
		if ( true === $value || '' === $value ) {

			$attr_parts[] = esc_attr( $key );
			continue;
		}
		if ( is_array( $value ) || is_object( $value ) ) {

			_doing_it_wrong(
				__FUNCTION__,
				sprintf(

					esc_html__( 'Attribute "%1$s" on <%2$s> received a non-scalar value (array/object). Only the `style` attribute accepts an array; other attributes must be strings, booleans, or null. The attribute was skipped.', 'desktop-mode' ),
					esc_html( $key ),
					esc_html( $tag )
				),
				'0.5.2'
			);
			continue;
		}
		$attr_parts[] = sprintf(
			'%s="%s"',
			esc_attr( $key ),
			esc_attr( (string) $value )
		);
	}

	$attr_str = $attr_parts ? ' ' . implode( ' ', $attr_parts ) : '';

	printf(
		'<%1$s%2$s>%3$s</%1$s>',

		$tag,

		$attr_str,

		$content
	);
}

const OPENSTATION_LENGTH_CSS_PROPERTIES = array(
	'width',
	'height',
	'min-width',
	'min-height',
	'max-width',
	'max-height',
	'padding',
	'padding-top',
	'padding-right',
	'padding-bottom',
	'padding-left',
	'padding-inline',
	'padding-inline-start',
	'padding-inline-end',
	'padding-block',
	'padding-block-start',
	'padding-block-end',
	'margin',
	'margin-top',
	'margin-right',
	'margin-bottom',
	'margin-left',
	'margin-inline',
	'margin-inline-start',
	'margin-inline-end',
	'margin-block',
	'margin-block-start',
	'margin-block-end',
	'gap',
	'row-gap',
	'column-gap',
	'border-width',
	'border-top-width',
	'border-right-width',
	'border-bottom-width',
	'border-left-width',
	'border-radius',
	'border-top-left-radius',
	'border-top-right-radius',
	'border-bottom-left-radius',
	'border-bottom-right-radius',
	'top',
	'right',
	'bottom',
	'left',
	'inset',
	'inset-inline-start',
	'inset-inline-end',
	'inset-block-start',
	'inset-block-end',
	'font-size',
	'letter-spacing',
	'word-spacing',
	'text-indent',
	'outline-width',
	'outline-offset',
);

function openstation_serialize_style_array( $styles ) {
	if ( ! is_array( $styles ) ) {
		return '';
	}
	$parts = array();
	foreach ( $styles as $prop => $value ) {
		$prop = strtolower( trim( (string) $prop ) );
		if ( ! preg_match( '/^-?[a-z][a-z0-9-]*$/', $prop ) ) {
			continue;
		}
		if ( false === $value || null === $value ) {
			continue;
		}
		$serialized = openstation_format_css_value( $prop, $value );
		if ( '' === $serialized ) {
			continue;
		}
		$parts[] = $prop . ': ' . $serialized;
	}
	return implode( '; ', $parts );
}

function openstation_format_css_value( $property, $value ) {
	if ( is_bool( $value ) || null === $value ) {
		return '';
	}
	$text = trim( (string) $value );
	if ( '' === $text ) {
		return '';
	}
	if ( preg_match( '/^-?\d+(\.\d+)?$/', $text ) ) {
		if ( '0' === $text ) {
			return '0';
		}
		if ( in_array( $property, OPENSTATION_LENGTH_CSS_PROPERTIES, true ) ) {
			return $text . 'px';
		}
	}
	return $text;
}

function openstation_enqueue_script( $handle, $src, $extra_deps = array(), $version = null, $in_footer = true ) {
	$deps = array_merge(
		array( 'openstation', 'wp-hooks' ),
		is_array( $extra_deps ) ? $extra_deps : array()
	);

	wp_enqueue_script(
		$handle,
		$src,
		$deps,
		null === $version ? OPENSTATION_VERSION : $version,
		$in_footer
	);
}
