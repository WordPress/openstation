<?php
/**
 * Desktop Mode — PHP helpers for plugin authors.
 *
 * Two companion helpers live here:
 *
 *   - {@see desktop_mode_component()} prints a `<wpd-*>` tag with
 *     safely-escaped attributes (plus its style-array
 *     serializers). The intent is explicit (we're rendering a kit
 *     component, not arbitrary HTML) and the escape discipline is
 *     automatic.
 *
 *   - {@see desktop_mode_enqueue_script()} wraps
 *     `wp_enqueue_script()` with the `desktop-mode` + `wp-hooks`
 *     dependencies pre-wired, so shell-extending scripts always
 *     load after `wp.desktop.*` and `wp.hooks` are available.
 *
 * {@see desktop_mode_register_window()} moved to
 * `includes/registries/native-windows.php` in 0.8.1.
 *
 * @package WPDesktopMode
 * @since   0.5.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Output a `<wpd-*>` component with safely escaped attributes.
 *
 * ```php
 * desktop_mode_component( 'wpd-button', array(
 *     'variant'    => 'primary',
 *     'data-op'    => 'add',
 *     'aria-label' => __( 'Add', 'my-plugin' ),
 * ), '+' );
 * ```
 *
 * Attribute values flow through `esc_attr()` — no HTML injection
 * surface. Content is passed through verbatim; callers that want
 * to render user text should pre-escape with `esc_html()` /
 * `wp_kses()` themselves.
 *
 * Boolean-style attributes (present with a `true` value or an
 * empty string) render as bare attributes (`disabled`,
 * `fill-cell`) — matches the HTML5 boolean-attribute convention
 * every `<wpd-*>` follows.
 *
 * ## Inline styles
 *
 * The `style` key accepts either the usual string value or an
 * associative array of CSS-property → value pairs. The array form
 * auto-serializes to a CSS declaration list and auto-units bare
 * integers on length-shaped properties (padding, margin, width,
 * …) so `'padding' => 0` produces `padding: 0` and
 * `'padding' => 16` produces `padding: 16px`.
 *
 * ```php
 * desktop_mode_component( 'wpd-stack', array(
 *     'gap'   => 12,
 *     'style' => array(
 *         'padding'          => 0,
 *         'background'       => 'rgba(0,0,0,0.04)',
 *         'border-radius'    => 8,
 *     ),
 * ), $children );
 * // <wpd-stack gap="12" style="padding: 0; background: rgba(0,0,0,0.04); border-radius: 8px">
 * ```
 *
 * Plain string form (for one-line overrides) keeps working:
 *
 * ```php
 * desktop_mode_component( 'wpd-stack', array(
 *     'style' => 'padding: 0; margin-top: 16px',
 * ), $children );
 * ```
 *
 * @since 0.5.0
 * @since 0.5.0 `style` accepts an array of CSS declarations.
 *
 * @param string                $tag     Tag name, e.g. `wpd-button`.
 *                                       Whitelisted to the `wpd-*` prefix
 *                                       to prevent the helper being
 *                                       misused as a generic HTML emitter.
 * @param array<string,mixed>   $attrs   Attribute key/value pairs.
 *                                       `style` may be a string or an
 *                                       associative array (see above).
 * @param string                $content Inner HTML. Pass pre-escaped.
 */
function desktop_mode_component( $tag, $attrs = array(), $content = '' ) {
	$tag = strtolower( (string) $tag );
	if ( ! preg_match( '/^wpd-[a-z][a-z0-9-]*$/', $tag ) ) {
		// Fail loud in debug so a typo surfaces immediately; silently
		// drop the output in production so a plugin with a bad tag
		// doesn't blow up the page.
		if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
			_doing_it_wrong(
				__FUNCTION__,
				sprintf(
					/* translators: %s: the attempted tag name. */
					esc_html__( 'desktop_mode_component() only accepts tags with the wpd- prefix; got "%s".', 'desktop-mode' ),
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
			// Silently skip attribute names that don't match the HTML5
			// name grammar. Same debug-vs-production split as the tag.
			continue;
		}
		if ( false === $value || null === $value ) {
			continue;
		}
		// Style array — serialize to a CSS declaration list. Plain
		// string values fall through to the generic attribute path
		// below so `'style' => 'padding:0'` keeps working.
		if ( 'style' === strtolower( $key ) && is_array( $value ) ) {
			$serialized = desktop_mode_serialize_style_array( $value );
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
			// Boolean attribute — render bare.
			$attr_parts[] = esc_attr( $key );
			continue;
		}
		if ( is_array( $value ) || is_object( $value ) ) {
			// Wrong-shape value on a non-style key. Without this
			// guard PHP's string cast would emit `key="Array"` /
			// `key="Object"` — embarrassing in production, silent
			// in debug. Surface it loudly under WP_DEBUG and drop
			// the attribute everywhere else.
			_doing_it_wrong(
				__FUNCTION__,
				sprintf(
					/* translators: 1: attribute name, 2: tag name. */
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
		// `$tag` is validated above against the wpd- allowlist; safe.
		$tag, // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
		// `$attr_str` is pre-escaped via esc_attr() for each component.
		$attr_str, // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
		// `$content` is the caller's responsibility to pre-escape.
		$content // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
	);
}

/**
 * CSS properties that treat bare integers as pixels. Mirrors
 * the length-shaped property list used by plugin JS code when
 * interpreting raw numeric values — keeping the same list in
 * one place so PHP `'padding' => 16` and JS `padding: 16` make
 * the same visual decision.
 *
 * @since 0.5.0
 */
const DESKTOP_MODE_LENGTH_CSS_PROPERTIES = array(
	'width', 'height',
	'min-width', 'min-height', 'max-width', 'max-height',
	'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
	'padding-inline', 'padding-inline-start', 'padding-inline-end',
	'padding-block', 'padding-block-start', 'padding-block-end',
	'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
	'margin-inline', 'margin-inline-start', 'margin-inline-end',
	'margin-block', 'margin-block-start', 'margin-block-end',
	'gap', 'row-gap', 'column-gap',
	'border-width', 'border-top-width', 'border-right-width',
	'border-bottom-width', 'border-left-width',
	'border-radius',
	'border-top-left-radius', 'border-top-right-radius',
	'border-bottom-left-radius', 'border-bottom-right-radius',
	'top', 'right', 'bottom', 'left',
	'inset',
	'inset-inline-start', 'inset-inline-end',
	'inset-block-start', 'inset-block-end',
	'font-size', 'letter-spacing', 'word-spacing', 'text-indent',
	'outline-width', 'outline-offset',
);

/**
 * Serialize an associative array of CSS declarations into a
 * `prop: value; prop: value` string for the `style` attribute.
 *
 * Property names are validated as CSS-shaped (kebab-case letters,
 * digits, hyphens); malformed names are silently dropped. Bare
 * integer values on length-shaped properties auto-unit to `px`
 * so callers can write `'padding' => 16` without remembering the
 * unit. The literal `0` is left unit-less because CSS treats it
 * as dimensionally valid on any property.
 *
 * @since 0.5.0
 *
 * @param array<string,mixed> $styles
 * @return string CSS declaration list, or empty string when no
 *                valid declarations were produced.
 */
function desktop_mode_serialize_style_array( $styles ) {
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
		$serialized = desktop_mode_format_css_value( $prop, $value );
		if ( '' === $serialized ) {
			continue;
		}
		$parts[] = $prop . ': ' . $serialized;
	}
	return implode( '; ', $parts );
}

/**
 * Serialize a raw PHP value into a CSS declaration value.
 *
 * Handles the two conveniences callers want from an ergonomic
 * style array:
 *
 *   - Integer + length-shaped property → append `px`
 *     (`'padding' => 16` → `16px`).
 *   - Integer `0` → keep unit-less (`0` is valid everywhere).
 *
 * Everything else (strings, floats already unitted, calc(…)
 * expressions, color keywords) passes through verbatim.
 *
 * @since 0.5.0
 *
 * @param string $property CSS property name.
 * @param mixed  $value    Raw value (int, float, string).
 * @return string CSS value, or empty string when $value is
 *                not serializable.
 */
function desktop_mode_format_css_value( $property, $value ) {
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
		if ( in_array( $property, DESKTOP_MODE_LENGTH_CSS_PROPERTIES, true ) ) {
			return $text . 'px';
		}
	}
	return $text;
}


// Native-windows registry (register_window, allowed_html,
// template-html builder, enqueue + render hooks) was moved to
// `includes/registries/native-windows.php` in 0.8.1.



// Widgets registry was moved to
// `includes/registries/widgets.php` in 0.8.1.



// Wallpapers registry was moved to
// `includes/registries/wallpapers.php` in 0.8.1.


// Desktop-icons registry was moved to
// `includes/registries/icons.php` in 0.8.1.



// Native-window tabs registry was moved to
// `includes/registries/window-tabs.php` in 0.8.1.


/**
 * Enqueue a plugin script that extends the desktop shell.
 *
 * Thin wrapper around `wp_enqueue_script` that pre-wires the correct
 * dependencies so the script:
 *
 *   - Runs AFTER `desktop-mode` (the shell bundle) so `wp.desktop.*` is
 *     guaranteed available.
 *   - Runs AFTER `wp-hooks` so `wp.hooks.addAction( 'desktop-mode.init', ... )`
 *     works without the plugin author having to remember that dep.
 *
 * Intended to be called from `admin_enqueue_scripts` — the wrapper
 * itself does not add an `is_admin()` guard.
 *
 * Drop-in replacement for the boilerplate:
 *
 * ```php
 * add_action( 'admin_enqueue_scripts', function () {
 *     wp_enqueue_script(
 *         'my-plugin',
 *         plugins_url( 'my-plugin.js', __FILE__ ),
 *         array( 'desktop-mode', 'wp-hooks' ),
 *         '1.0.0',
 *         true
 *     );
 * } );
 * ```
 *
 * which becomes:
 *
 * ```php
 * add_action( 'admin_enqueue_scripts', function () {
 *     desktop_mode_enqueue_script(
 *         'my-plugin',
 *         plugins_url( 'my-plugin.js', __FILE__ ),
 *         array(),           // extra deps on top of the desktop defaults
 *         '1.0.0'
 *     );
 * } );
 * ```
 *
 * @since 0.5.0
 *
 * @param string          $handle    Script handle.
 * @param string          $src       Full URL of the script, or path relative
 *                                   to the WordPress root directory.
 * @param string[]        $extra_deps Additional dependency handles. `desktop-mode`
 *                                   and `wp-hooks` are always prepended.
 * @param string|bool|null $version  Version string, or `false` for none.
 *                                   Defaults to `DESKTOP_MODE_VERSION` so plugin authors
 *                                   don't have to busy-track cache busting.
 * @param bool            $in_footer Whether to enqueue in the footer. Defaults
 *                                   to `true` — the shell is always in head.
 * @return void
 */
function desktop_mode_enqueue_script( $handle, $src, $extra_deps = array(), $version = null, $in_footer = true ) {
	$deps = array_merge(
		array( 'desktop-mode', 'wp-hooks' ),
		is_array( $extra_deps ) ? $extra_deps : array()
	);

	wp_enqueue_script(
		$handle,
		$src,
		$deps,
		null === $version ? DESKTOP_MODE_VERSION : $version,
		$in_footer
	);
}
