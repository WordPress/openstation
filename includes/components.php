<?php
/**
 * Desktop Mode — PHP helpers for plugin authors.
 *
 * Two companion helpers live here:
 *
 *   - {@see desktop_mode_component()} prints a `<wpd-*>` tag with
 *     safely-escaped attributes. The intent is explicit (we're
 *     rendering a kit component, not arbitrary HTML) and the
 *     escape discipline is automatic.
 *
 *   - {@see desktop_mode_register_window()} collapses the
 *     boilerplate for declaring a PHP-owned native window: one
 *     call emits the `<template>` the shell clones, enqueues
 *     the plugin's JS render bundle, and wires a dock tile on
 *     window-ready. Plugins write the template callback
 *     + the render callback on the JS side — the plumbing is ours.
 *
 * @package WPDesktopMode
 * @since   0.10.0
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
 * @since 0.10.0
 * @since 0.13.0 `style` accepts an array of CSS declarations.
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
				'0.10.0'
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
				'0.18.0'
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
 * @since 0.13.0
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
 * @since 0.13.0
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
 * @since 0.13.0
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

/**
 * Register a PHP-owned native desktop window with one call.
 *
 * Under the hood this:
 *
 *   1. Captures the $args and stores them on a module-level
 *      registry so the relevant admin_footer + enqueue hooks fire
 *      only for the current user's desktop-mode shell.
 *   2. On `admin_footer` (shell-side only), emits
 *      `<template id="wpdm-native-window-<id>">` wrapping the
 *      output of the `template` callback. Each registered window
 *      gets its own template element.
 *   3. On `admin_enqueue_scripts` (shell-side), enqueues the
 *      caller's `script` handle if one was provided. The script
 *      registers a render callback at
 *      `window.wpDesktopNativeWindows[<id>]`. On every window open
 *      the shell clones the registered template into the body and
 *      then invokes the callback — render is enhancement: query
 *      the body for mount points your template declared, light
 *      them up. Without a `script` the cloned template IS the
 *      window; declarative-only plugins need zero JS.
 *   4. Passes a localized config blob to the script
 *      (`wpDesktopNativeWindow_<id>`) carrying the window's
 *      `id`, `title`, `icon`, dimensions, and `placement`. The
 *      script then calls `wp.desktop.registerSystemTile()` +
 *      `wp.desktop.registerWindow()` to wire up the dock tile
 *      and the open-on-click behaviour.
 *
 * Plugins write the template callback + the render callback on
 * the JS side; everything else is shell plumbing. Capability gate
 * honours WP admin conventions: any `capabilities` entries must
 * ALL match for the window to register.
 *
 * Note on scope: the shell doesn't auto-open windows server-side
 * — `registerWindow` declares availability, not presence. Users
 * click the registered tile (or your plugin calls
 * `wp.desktop.windowManager.open()` programmatically) to surface
 * the window.
 *
 * @since 0.10.0
 * @since 0.11.0 Returns `WP_Error` on validation failure instead of
 *               silent `false`. Legacy `if ( $result )` callers remain
 *               correct because `WP_Error` is truthy; new code should
 *               prefer `is_wp_error( $result )` for diagnostics.
 *
 * @param string $id   Doubles as window id + dock-tile id. Must
 *                     be a kebab-case-ish slug.
 * @param array  $args {
 *     Window registration options.
 *
 *     @type string   $title        Window + tooltip title. Required.
 *     @type string   $icon         Dashicons class or URL. Required.
 *     @type callable $template     Echoes the window body markup.
 *                                  Wrapped on `admin_footer` in a
 *                                  `<template id="wpdm-native-window-
 *                                  <id>">`; cloned into the window
 *                                  body on every open. The render
 *                                  callback runs against the cloned
 *                                  body, so mount points declared in
 *                                  the template are guaranteed to be
 *                                  present.
 *     @type string   $script       Registered script handle that
 *                                  owns the JS render callback.
 *                                  Optional — omit for a purely
 *                                  declarative window whose body is
 *                                  exactly the cloned template.
 *     @type int      $width        Initial width (px). Default 520.
 *     @type int      $height       Initial height (px). Default 400.
 *     @type int      $min_width    Minimum width (px). Default 280.
 *     @type int      $min_height   Minimum height (px). Default 220.
 *     @type string   $placement    'dock' | 'none'. Default 'dock'.
 *                                  'none' skips the tile (plugin
 *                                  opens the window programmatically).
 *     @type string[] $capabilities User capabilities that gate the
 *                                  registration. ANY miss returns
 *                                  `WP_Error desktop_mode_capability_denied`.
 *     @type bool|string $autofocus Passed verbatim to
 *                                  `NativeWindowDef.autofocus`.
 *     @type string   $main_tab_label Label for the "main" tab that
 *                                  displays the window's own
 *                                  `template` output. Only rendered
 *                                  when at least one additional
 *                                  tab is registered via
 *                                  {@see desktop_mode_register_window_tab()}.
 *                                  Defaults to the window's `title`.
 *     @type int      $main_tab_padding Padding (in px) applied to the
 *                                  auto-generated tab-wrap around
 *                                  the window body. Only applies
 *                                  when additional tabs are
 *                                  registered. Default 16. Pass 0
 *                                  for edge-to-edge content.
 *                                  Filterable at runtime via
 *                                  `desktop_mode_native_window_tab_wrap_padding`.
 *     @type array    $config       Arbitrary serializable data to ship
 *                                  to the bundle alongside the script
 *                                  tag. Read in JS via
 *                                  `wp.desktop.getWindowConfig( $id )`
 *                                  (or directly at
 *                                  `window.wpDesktopWindowConfig[ $id ]`).
 *                                  Recommended over `wp_localize_script`
 *                                  for native-window scripts because
 *                                  the lazy-load path bypasses
 *                                  `wp_print_scripts` — passing config
 *                                  through this arg guarantees delivery
 *                                  on both eager AND lazy paths
 *                                  (mid-session activation). Use this
 *                                  for REST URLs, nonces, capability
 *                                  flags, anything session-bound. Empty
 *                                  array (default) ships nothing.
 * }
 * @return true|WP_Error `true` on success; `WP_Error` when any
 *                       required arg is missing/invalid or a
 *                       declared capability is unmet.
 */
function desktop_mode_register_window( $id, $args = array() ) {
	$id = sanitize_key( (string) $id );
	if ( '' === $id ) {
		return desktop_mode_registration_error(
			'desktop_mode_missing_id',
			__( 'Native window id is required and must be a valid slug.', 'desktop-mode' )
		);
	}

	$defaults = array(
		'title'            => '',
		'icon'             => 'dashicons-admin-generic',
		'template'         => null,
		'script'           => '',
		// Optional WP style handle (registered with `wp_register_style()`).
		// Resolved at payload-build time so the shell can lazy-inject a
		// `<link rel="stylesheet">` when a peer plugin is activated
		// mid-session — without this, the parent shell page already
		// finished `wp_print_styles` and the plugin's CSS is missing
		// until F5. @since 0.18.1
		'style'            => '',
		'width'            => 520,
		'height'           => 400,
		'min_width'        => 280,
		'min_height'       => 220,
		'placement'        => 'dock',
		'capabilities'     => array(),
		'autofocus'        => false,
		'main_tab_label'   => '',
		'main_tab_padding' => '',
		'config'           => array(),
	);
	$args = wp_parse_args( $args, $defaults );

	// Capability gate — ALL listed caps must match. Fail closed.
	foreach ( (array) $args['capabilities'] as $cap ) {
		if ( ! current_user_can( (string) $cap ) ) {
			return desktop_mode_registration_error(
				'desktop_mode_capability_denied',
				sprintf(
					/* translators: %s: capability slug. */
					__( 'Current user lacks the %s capability required to register this native window.', 'desktop-mode' ),
					(string) $cap
				),
				array( 'capability' => (string) $cap, 'id' => $id )
			);
		}
	}

	// Required fields.
	if ( '' === (string) $args['title'] ) {
		return desktop_mode_registration_error(
			'desktop_mode_missing_title',
			__( 'Native window registration requires a non-empty `title`.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}
	if ( ! is_callable( $args['template'] ) ) {
		return desktop_mode_registration_error(
			'desktop_mode_invalid_template',
			__( 'Native window registration requires a callable `template` that echoes the template body.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}

	$placement = in_array( $args['placement'], array( 'dock', 'none' ), true )
		? $args['placement']
		: 'dock';

	$entry = array(
		'id'               => $id,
		'title'            => (string) $args['title'],
		'icon'             => (string) $args['icon'],
		'template'         => $args['template'],
		'script'           => (string) $args['script'],
		'style'            => (string) $args['style'],
		'width'            => (int) $args['width'],
		'height'           => (int) $args['height'],
		'min_width'        => (int) $args['min_width'],
		'min_height'       => (int) $args['min_height'],
		'placement'        => $placement,
		'autofocus'        => $args['autofocus'],
		'main_tab_label'   => (string) $args['main_tab_label'],
		// Stored as-is (string or int). `desktop_mode_build_native_window_template_html`
		// coerces to int and falls back to 16 when absent.
		'main_tab_padding' => $args['main_tab_padding'],
		// Bundle-bound config delivered through the same path as
		// `wp_localize_script` `extra['data']` — see the `config` doc
		// in this function's `$args` block and `desktop_mode_resolve_script_payload()`
		// for how it lands on the wire.
		'config'           => is_array( $args['config'] ) ? $args['config'] : array(),
	);
	desktop_mode_native_window_registry( $id, $entry );

	/**
	 * Fires after a native desktop window is successfully registered.
	 *
	 * Lets plugins react to registrations made by other plugins —
	 * e.g. a widget that auto-opens when a given window registers,
	 * or analytics tracking of which windows the current install
	 * exposes. Does NOT fire when `desktop_mode_register_window()`
	 * returns a `WP_Error`.
	 *
	 * @since 0.11.0
	 *
	 * @param string $id    The window id.
	 * @param array  $entry The stored registry entry (id, title,
	 *                      icon, template callback, script handle,
	 *                      size defaults, placement, autofocus).
	 */
	do_action( 'desktop_mode_native_window_registered', $id, $entry );

	return true;
}

/**
 * Internal module-level registry for native windows registered
 * via {@see desktop_mode_register_window()}. Passing a second
 * argument stores the entry; passing only the id returns the
 * stored value (or null). Kept small and side-effect-free so
 * tests can introspect.
 *
 * @since 0.10.0
 * @internal
 *
 * @param string     $id    Window id.
 * @param array|null $entry Entry to store, or null to just read.
 * @return array|null Either the stored entry or the full registry
 *                    (when id is empty).
 */
function desktop_mode_native_window_registry( $id = '', $entry = null ) {
	static $store = array();

	if ( '' === (string) $id ) {
		return $store;
	}
	if ( null !== $entry ) {
		$store[ $id ] = $entry;
	}
	return isset( $store[ $id ] ) ? $store[ $id ] : null;
}

/**
 * Register a server-side desktop widget. Symmetric to
 * {@see desktop_mode_register_window()} for the right-column widget
 * layer: plugin declares the widget's metadata + script handle in
 * PHP; shell syncs its registry from the live payload so
 * activation / deactivation map to picker add / remove without a
 * browser reload.
 *
 * The mount callback still lives in JS — not serializable across
 * the wire. Plugins register it on
 * `window.wpDesktopWidgets[ <id> ]` as a `(container, ctx) =>
 * teardown` function. The shell reads that global once the
 * declared script loads and wraps it into a WidgetDef.
 *
 * Example:
 *
 * ```php
 * desktop_mode_register_widget( 'myplugin/stats', array(
 *     'label'          => __( 'Stats', 'my-plugin' ),
 *     'description'    => __( 'Live analytics rollup', 'my-plugin' ),
 *     'icon'           => 'dashicons-chart-bar',
 *     'script'         => 'my-plugin-desktop-widgets',
 *     'movable'        => true,
 *     'resizable'      => true,
 *     'default_width'  => 280,
 *     'default_height' => 180,
 * ) );
 * ```
 *
 * ```js
 * // Inside my-plugin-desktop-widgets.js:
 * window.wpDesktopWidgets = window.wpDesktopWidgets || {};
 * window.wpDesktopWidgets[ 'myplugin/stats' ] = function ( container, ctx ) {
 *     container.append( buildDOM() );
 *     return function teardown() { };
 * };
 * ```
 *
 * @since 0.10.0
 * @since 0.11.0 Returns `WP_Error` on validation failure instead of
 *               silent `false`. Legacy `if ( $result )` callers remain
 *               correct because `WP_Error` is truthy.
 *
 * @param string $id   Widget id. Must match the key the JS side
 *                     uses on `window.wpDesktopWidgets[ … ]`.
 * @param array  $args {
 *     @type string   $label          Human-readable picker label. Required.
 *     @type string   $description    Picker subtitle. Default empty.
 *     @type string   $icon           Dashicons class for the picker. Required.
 *     @type string   $script         Enqueued script handle that owns
 *                                    the mount callback. Required.
 *     @type bool     $movable        Allow drag out of the right column.
 *     @type bool     $resizable      Allow user resize.
 *     @type int      $min_width
 *     @type int      $min_height
 *     @type int      $max_width
 *     @type int      $max_height
 *     @type int      $default_width  First-mount floating width.
 *     @type int      $default_height First-mount floating height.
 *     @type string[] $capabilities   Gate: ALL caps must match. Any
 *                                    missed cap returns
 *                                    `WP_Error desktop_mode_capability_denied`.
 * }
 * @return true|WP_Error `true` on success; `WP_Error` otherwise.
 */
function desktop_mode_register_widget( $id, $args = array() ) {
	$id = (string) $id;
	if ( '' === $id ) {
		return desktop_mode_registration_error(
			'desktop_mode_missing_id',
			__( 'Widget id is required.', 'desktop-mode' )
		);
	}

	$defaults = array(
		'label'          => '',
		'description'    => '',
		'icon'           => 'dashicons-admin-generic',
		'script'         => '',
		'movable'        => false,
		'resizable'      => false,
		'min_width'      => 0,
		'min_height'     => 0,
		'max_width'      => 0,
		'max_height'     => 0,
		'default_width'  => 0,
		'default_height' => 0,
		'capabilities'   => array(),
	);
	$args = wp_parse_args( $args, $defaults );

	foreach ( (array) $args['capabilities'] as $cap ) {
		if ( ! current_user_can( (string) $cap ) ) {
			return desktop_mode_registration_error(
				'desktop_mode_capability_denied',
				sprintf(
					/* translators: %s: capability slug. */
					__( 'Current user lacks the %s capability required to register this widget.', 'desktop-mode' ),
					(string) $cap
				),
				array( 'capability' => (string) $cap, 'id' => $id )
			);
		}
	}

	// Required fields. The script handle isn't strictly required —
	// a plugin could register a widget whose mount callback is
	// declared on the shell page's own JS (edge case; still valid).
	if ( '' === (string) $args['label'] ) {
		return desktop_mode_registration_error(
			'desktop_mode_missing_label',
			__( 'Widget registration requires a non-empty `label`.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}

	$entry = array(
		'id'             => $id,
		'label'          => (string) $args['label'],
		'description'    => (string) $args['description'],
		'icon'           => (string) $args['icon'],
		'script'         => (string) $args['script'],
		'movable'        => (bool) $args['movable'],
		'resizable'      => (bool) $args['resizable'],
		'min_width'      => (int) $args['min_width'],
		'min_height'     => (int) $args['min_height'],
		'max_width'      => (int) $args['max_width'],
		'max_height'     => (int) $args['max_height'],
		'default_width'  => (int) $args['default_width'],
		'default_height' => (int) $args['default_height'],
	);
	desktop_mode_desktop_widget_registry( $id, $entry );

	/**
	 * Fires after a desktop widget is successfully registered.
	 *
	 * Does NOT fire when `desktop_mode_register_widget()` returns a
	 * `WP_Error`.
	 *
	 * @since 0.11.0
	 *
	 * @param string $id    The widget id.
	 * @param array  $entry The stored registry entry.
	 */
	do_action( 'desktop_mode_widget_registered', $id, $entry );

	return true;
}

/**
 * Internal module-level registry for widgets registered via
 * {@see desktop_mode_register_widget()}. Same pattern as
 * {@see desktop_mode_native_window_registry()}.
 *
 * @since 0.10.0
 * @internal
 */
function desktop_mode_desktop_widget_registry( $id = '', $entry = null ) {
	static $store = array();

	if ( '' === (string) $id ) {
		return $store;
	}
	if ( null !== $entry ) {
		$store[ $id ] = $entry;
	}
	return isset( $store[ $id ] ) ? $store[ $id ] : null;
}

/**
 * Build the widget list for the shell payload. Runs through
 * every entry registered via `desktop_mode_register_widget()` and
 * attaches the resolved script URL (`wp_scripts()` lookup) so
 * the shell can dynamically inject the script on mid-session
 * plugin activation.
 *
 * @since 0.10.0
 *
 * @return array[]
 */
function desktop_mode_build_desktop_widgets_payload() {
	$registry = desktop_mode_desktop_widget_registry();
	if ( ! is_array( $registry ) || empty( $registry ) ) {
		return array();
	}

	$out = array();
	foreach ( $registry as $entry ) {
		$script_payload = desktop_mode_resolve_script_payload( $entry['script'] );

		$out[] = array(
			'id'                => $entry['id'],
			'label'             => $entry['label'],
			'description'       => $entry['description'],
			'icon'              => $entry['icon'],
			'movable'           => $entry['movable'],
			'resizable'         => $entry['resizable'],
			'minWidth'          => $entry['min_width'],
			'minHeight'         => $entry['min_height'],
			'maxWidth'          => $entry['max_width'],
			'maxHeight'         => $entry['max_height'],
			'defaultWidth'      => $entry['default_width'],
			'defaultHeight'     => $entry['default_height'],
			'scriptUrl'         => $script_payload['url'],
			'scriptHandle'      => $entry['script'],
			'scriptBefore'      => $script_payload['before'],
			'scriptAfter'       => $script_payload['after'],
			'scriptL10n'        => $script_payload['l10n'],
			'scriptTranslations' => $script_payload['translations'],
		);
	}
	return $out;
}

/**
 * Register a server-side desktop wallpaper. Symmetrical to
 * {@see desktop_mode_register_widget()}. The plugin's JS side
 * publishes the full `WallpaperDef` (with mount / resolveValue /
 * renderEditor callbacks as appropriate) on
 * `window.wpDesktopWallpapers[ <id> ]`; the shell loads the
 * declared script, reads that global, and registers the def via
 * the normal wallpaper registry. Deactivation unregisters the
 * def and re-applies the current selection (which falls back to
 * a built-in if the user's active wallpaper was the one leaving).
 *
 * Example:
 *
 * ```php
 * desktop_mode_register_wallpaper( 'myplugin/snow', array(
 *     'label'   => __( 'Snow', 'my-plugin' ),
 *     'preview' => 'linear-gradient(#fff, #ddd)',
 *     'type'    => 'canvas',
 *     'script'  => 'my-plugin-snow-wallpaper',
 * ) );
 * ```
 *
 * ```js
 * // Inside my-plugin-snow-wallpaper.js
 * window.wpDesktopWallpapers = window.wpDesktopWallpapers || {};
 * window.wpDesktopWallpapers[ 'myplugin/snow' ] = {
 *     id: 'myplugin/snow',
 *     label: 'Snow',
 *     type: 'canvas',
 *     preview: 'linear-gradient(#fff, #ddd)',
 *     needs: [ 'pixijs' ],
 *     mount: function ( container, ctx ) { return function () {}; },
 * };
 * ```
 *
 * @since 0.10.0
 * @since 0.11.0 Returns `WP_Error` on validation failure instead of
 *               silent `false`. Legacy `if ( $result )` callers remain
 *               correct because `WP_Error` is truthy.
 *
 * @param string $id   Wallpaper id. For canvas wallpapers this must
 *                     match the `window.wpDesktopWallpapers[<id>]`
 *                     key the plugin's JS publishes.
 * @param array  $args {
 *     @type string   $label        Picker label. Required.
 *     @type string   $preview      CSS value rendered in the picker
 *                                  swatch (gradient, color,
 *                                  `url(...)`, etc.). Required.
 *     @type string   $type         'css' | 'canvas'. Default 'canvas'.
 *     @type string   $value        CSS value applied to the wallpaper
 *                                  surface (only relevant for `css`
 *                                  type — canvas wallpapers paint in
 *                                  JS). Defaults to `preview` so a
 *                                  single string covers the common
 *                                  case where swatch and surface are
 *                                  identical.
 *     @type string   $script       Enqueued script handle that
 *                                  publishes the def on the global.
 *                                  Required for `canvas` type;
 *                                  optional for `css`.
 *     @type string[] $capabilities Gate: ALL caps must match. Any
 *                                  missed cap returns
 *                                  `WP_Error desktop_mode_capability_denied`.
 * }
 * @return true|WP_Error `true` on success; `WP_Error` otherwise.
 */
function desktop_mode_register_wallpaper( $id, $args = array() ) {
	$id = (string) $id;
	if ( '' === $id ) {
		return desktop_mode_registration_error(
			'desktop_mode_missing_id',
			__( 'Wallpaper id is required.', 'desktop-mode' )
		);
	}

	$defaults = array(
		'label'        => '',
		'preview'      => '',
		'type'         => 'canvas',
		'value'        => '',
		'script'       => '',
		'capabilities' => array(),
	);
	$args = wp_parse_args( $args, $defaults );

	foreach ( (array) $args['capabilities'] as $cap ) {
		if ( ! current_user_can( (string) $cap ) ) {
			return desktop_mode_registration_error(
				'desktop_mode_capability_denied',
				sprintf(
					/* translators: %s: capability slug. */
					__( 'Current user lacks the %s capability required to register this wallpaper.', 'desktop-mode' ),
					(string) $cap
				),
				array( 'capability' => (string) $cap, 'id' => $id )
			);
		}
	}
	if ( '' === (string) $args['label'] ) {
		return desktop_mode_registration_error(
			'desktop_mode_missing_label',
			__( 'Wallpaper registration requires a non-empty `label`.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}
	$type = in_array( $args['type'], array( 'css', 'canvas' ), true )
		? $args['type']
		: 'canvas';
	// Canvas wallpapers always need a script (the def with its
	// `mount` callback is published on the JS global by that
	// script). CSS wallpapers can skip the script — the shell can
	// render from the `value` / `preview` string alone.
	if ( 'canvas' === $type && '' === (string) $args['script'] ) {
		return desktop_mode_registration_error(
			'desktop_mode_missing_script',
			__( 'Canvas wallpaper registration requires a `script` handle that publishes the def.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}

	// `value` defaults to `preview` when omitted — the common case
	// for a plain gradient/solid where the swatch and the surface
	// render the same CSS. Authors can split them (e.g. static
	// swatch preview + animated value) by passing both.
	$value = (string) $args['value'];
	if ( '' === $value ) {
		$value = (string) $args['preview'];
	}

	$entry = array(
		'id'      => $id,
		'label'   => (string) $args['label'],
		'preview' => (string) $args['preview'],
		'type'    => $type,
		'value'   => $value,
		'script'  => (string) $args['script'],
	);
	desktop_mode_desktop_wallpaper_registry( $id, $entry );

	/**
	 * Fires after a desktop wallpaper is successfully registered.
	 *
	 * Does NOT fire when `desktop_mode_register_wallpaper()` returns a
	 * `WP_Error`.
	 *
	 * @since 0.11.0
	 *
	 * @param string $id    The wallpaper id.
	 * @param array  $entry The stored registry entry.
	 */
	do_action( 'desktop_mode_wallpaper_registered', $id, $entry );

	return true;
}

/**
 * Internal module-level registry for wallpapers registered via
 * {@see desktop_mode_register_wallpaper()}. Same static-store
 * pattern as the widget + native-window registries.
 *
 * @since 0.10.0
 * @internal
 */
function desktop_mode_desktop_wallpaper_registry( $id = '', $entry = null ) {
	static $store = array();

	if ( '' === (string) $id ) {
		return $store;
	}
	if ( null !== $entry ) {
		$store[ $id ] = $entry;
	}
	return isset( $store[ $id ] ) ? $store[ $id ] : null;
}

/**
 * Build the wallpaper list for the shell payload. Only metadata +
 * the resolved script URL cross the wire; the plugin's mount
 * callback is announced via the JS global the script sets up.
 *
 * @since 0.10.0
 *
 * @return array[]
 */
function desktop_mode_build_desktop_wallpapers_payload() {
	$registry = desktop_mode_desktop_wallpaper_registry();
	if ( ! is_array( $registry ) || empty( $registry ) ) {
		return array();
	}
	/**
	 * Filters the server-declared wallpaper list before it ships to
	 * the shell. Mirrors the JS-side `wp-desktop.wallpapers` filter
	 * so plugins can rearrange, hide, or override entries at boot
	 * without round-tripping through the JS registry.
	 *
	 * @since 0.11.0
	 *
	 * @param array[] $registry The registered wallpaper entries.
	 */
	$registry = apply_filters( 'desktop_mode_wallpapers', $registry );
	if ( ! is_array( $registry ) ) {
		return array();
	}
	$out = array();
	foreach ( $registry as $entry ) {
		if ( ! is_array( $entry ) || empty( $entry['id'] ) ) {
			continue;
		}
		$handle  = isset( $entry['script'] ) ? (string) $entry['script'] : '';
		$payload = desktop_mode_resolve_script_payload( $handle );
		$out[] = array(
			'id'                => (string) $entry['id'],
			'label'             => isset( $entry['label'] ) ? (string) $entry['label'] : '',
			'preview'           => isset( $entry['preview'] ) ? (string) $entry['preview'] : '',
			'type'              => isset( $entry['type'] ) ? (string) $entry['type'] : 'canvas',
			'value'             => isset( $entry['value'] ) ? (string) $entry['value'] : '',
			'scriptUrl'         => $payload['url'],
			'scriptHandle'      => $handle,
			'scriptBefore'      => $payload['before'],
			'scriptAfter'       => $payload['after'],
			'scriptL10n'        => $payload['l10n'],
			'scriptTranslations' => $payload['translations'],
		);
	}
	return $out;
}

/**
 * Register a desktop icon — a clickable shortcut tile that sits on
 * the wallpaper (think macOS desktop icons / phone home screen apps)
 * and opens a native window or a URL on click.
 *
 * Icons are distinct from dock tiles: the dock rail is for
 * top-level admin pages, the desktop surface is for quick shortcuts
 * a user or theme wants front-and-centre. A single plugin can
 * register a window AND an icon that opens it — the two surfaces
 * are orthogonal.
 *
 * Example — the classic Jorvy recipe:
 *
 * ```php
 * desktop_mode_register_window( 'jorvy', array( …window args… ) );
 * desktop_mode_register_icon( 'jorvy', array(
 *     'title'    => __( 'Jorvy', 'jorvy' ),
 *     'icon'     => 'dashicons-star-filled',
 *     'window'   => 'jorvy',
 *     'position' => 10,
 * ) );
 * ```
 *
 * @since 0.11.0
 *
 * @param string $id   Icon id. Must be a kebab-case-ish slug.
 * @param array  $args {
 *     Icon registration options.
 *
 *     @type string   $title        Display label shown under the icon. Required.
 *     @type string   $icon         Dashicons class or http(s) URL to an
 *                                  image asset. Runs through the same
 *                                  sanitizer as dock icons (rejects
 *                                  `data:` / `javascript:` URIs). Required.
 *     @type string   $window       Id of a registered native window to
 *                                  open on click. Mutually exclusive
 *                                  with `url`.
 *     @type string   $url          URL to open on click (admin URLs
 *                                  open as a new window in the shell;
 *                                  off-site URLs open in a new tab).
 *                                  Mutually exclusive with `window`.
 *     @type int      $position     Sort order; lower renders earlier
 *                                  (top-left on the grid). Default 100.
 *     @type string[] $capabilities Gate: ALL caps must match. Any
 *                                  missed cap returns
 *                                  `WP_Error desktop_mode_capability_denied`.
 * }
 * @return true|WP_Error `true` on success; `WP_Error` otherwise.
 */
function desktop_mode_register_icon( $id, $args = array() ) {
	$id = sanitize_key( (string) $id );
	if ( '' === $id ) {
		return desktop_mode_registration_error(
			'desktop_mode_missing_id',
			__( 'Desktop icon id is required and must be a valid slug.', 'desktop-mode' )
		);
	}

	$defaults = array(
		'title'        => '',
		'icon'         => 'dashicons-admin-generic',
		'window'       => '',
		'url'          => '',
		'position'     => 100,
		'capabilities' => array(),
	);
	$args = wp_parse_args( $args, $defaults );

	foreach ( (array) $args['capabilities'] as $cap ) {
		if ( ! current_user_can( (string) $cap ) ) {
			return desktop_mode_registration_error(
				'desktop_mode_capability_denied',
				sprintf(
					/* translators: %s: capability slug. */
					__( 'Current user lacks the %s capability required to register this desktop icon.', 'desktop-mode' ),
					(string) $cap
				),
				array( 'capability' => (string) $cap, 'id' => $id )
			);
		}
	}

	if ( '' === (string) $args['title'] ) {
		return desktop_mode_registration_error(
			'desktop_mode_missing_title',
			__( 'Desktop icon registration requires a non-empty `title`.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}

	$window = sanitize_key( (string) $args['window'] );
	$url    = (string) $args['url'];
	if ( '' !== $window && '' !== $url ) {
		return desktop_mode_registration_error(
			'desktop_mode_conflicting_target',
			__( 'Desktop icon cannot declare both `window` and `url`; pick one target.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}
	if ( '' === $window && '' === $url ) {
		return desktop_mode_registration_error(
			'desktop_mode_missing_target',
			__( 'Desktop icon must declare a `window` id or a `url` target.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}
	if ( '' !== $url ) {
		// Accept any http(s) URL. Same-origin admin URLs open in a
		// desktop window; off-site URLs open in a new browser tab at
		// click time (shell decides).
		$url = esc_url_raw( $url, array( 'http', 'https' ) );
		if ( '' === $url ) {
			return desktop_mode_registration_error(
				'desktop_mode_invalid_url',
				__( 'Desktop icon `url` must be a valid http(s) URL.', 'desktop-mode' ),
				array( 'id' => $id )
			);
		}
	}

	$entry = array(
		'id'       => $id,
		'title'    => (string) $args['title'],
		'icon'     => desktop_mode_sanitize_dock_icon( (string) $args['icon'] ),
		'window'   => $window,
		'url'      => $url,
		'position' => (int) $args['position'],
	);
	desktop_mode_desktop_icon_registry( $id, $entry );

	/**
	 * Fires after a desktop icon is successfully registered.
	 *
	 * Does NOT fire when `desktop_mode_register_icon()` returns a
	 * `WP_Error`.
	 *
	 * @since 0.11.0
	 *
	 * @param string $id    The icon id.
	 * @param array  $entry The stored registry entry (id, title,
	 *                      icon, window, url, position).
	 */
	do_action( 'desktop_mode_icon_registered', $id, $entry );

	return true;
}

/**
 * Internal module-level registry for desktop icons registered via
 * {@see desktop_mode_register_icon()}. Same static-store pattern as
 * the widget + native-window + wallpaper registries.
 *
 * @since 0.11.0
 * @internal
 */
function desktop_mode_desktop_icon_registry( $id = '', $entry = null ) {
	static $store = array();

	if ( '' === (string) $id ) {
		return $store;
	}
	if ( null !== $entry ) {
		$store[ $id ] = $entry;
	}
	return isset( $store[ $id ] ) ? $store[ $id ] : null;
}

/**
 * Build the desktop-icon list for the shell payload. Applies a
 * `desktop_mode_icons` filter so plugins can hide / reorder / rename
 * entries registered by others — mirrors the wallpaper payload
 * builder's filter discipline.
 *
 * @since 0.11.0
 *
 * @return array[]
 */
function desktop_mode_build_desktop_icons_payload() {
	$registry = desktop_mode_desktop_icon_registry();
	if ( ! is_array( $registry ) || empty( $registry ) ) {
		return array();
	}

	/**
	 * Filters the full desktop-icon registry before it ships to the
	 * shell. Each entry is the shape stored by
	 * `desktop_mode_register_icon()` (`id`, `title`, `icon`, `window`,
	 * `url`, `position`). Return a reordered / filtered array.
	 *
	 * @since 0.11.0
	 *
	 * @param array[] $registry The registered icon entries.
	 */
	$registry = apply_filters( 'desktop_mode_icons', $registry );
	if ( ! is_array( $registry ) ) {
		return array();
	}

	$out = array();
	foreach ( $registry as $entry ) {
		if ( ! is_array( $entry ) || empty( $entry['id'] ) ) {
			continue;
		}
		$out[] = array(
			'id'       => (string) $entry['id'],
			'title'    => isset( $entry['title'] ) ? (string) $entry['title'] : '',
			'icon'     => isset( $entry['icon'] ) ? (string) $entry['icon'] : 'dashicons-admin-generic',
			'window'   => isset( $entry['window'] ) ? (string) $entry['window'] : '',
			'url'      => isset( $entry['url'] ) ? (string) $entry['url'] : '',
			'position' => isset( $entry['position'] ) ? (int) $entry['position'] : 100,
		);
	}

	// Stable sort by position; ties break on insertion order.
	usort( $out, static function ( $a, $b ) {
		if ( $a['position'] === $b['position'] ) {
			return 0;
		}
		return $a['position'] < $b['position'] ? -1 : 1;
	} );

	return $out;
}

/**
 * Reserved tab value for the window's own `template` output. The
 * main tab always renders first, its markup comes from the window
 * registration's `template` callback, and its label is the
 * window's `main_tab_label` (falling back to the window `title`).
 *
 * Plugins cannot register an additional tab with this value —
 * {@see desktop_mode_register_window_tab()} returns
 * `desktop_mode_reserved_tab_value` when they try.
 *
 * @since 0.11.0
 */
const DESKTOP_MODE_NATIVE_WINDOW_MAIN_TAB = 'main';

/**
 * Register an additional tab on an existing native window.
 *
 * Mirrors the legacy iframe-window ergonomics where submenus
 * auto-become tabs below the title bar: the window's own
 * `template` renders as the first tab (labelled by `main_tab_label`
 * / `title`), and every call to this function adds another tab
 * alongside it. Cross-plugin extension is supported — a companion
 * plugin can attach a tab to someone else's window.
 *
 * Registering even a single tab turns on the auto-wrap path in
 * `desktop_mode_build_native_window_template_html()`: the shell wraps the
 * window body in `<wpd-stack>` + `<wpd-tabs>` + `<wpd-tabpanel>`
 * elements automatically. Plugin authors no longer hand-write that
 * markup — the shell provides it and `<wpd-tabpanel>` auto-swap
 * (from 0.11) handles visibility.
 *
 * ```php
 * // Plugin that owns the window declares its own tabs:
 * desktop_mode_register_window( 'jorvy', array(
 *     'title'          => 'Jorvy',
 *     'main_tab_label' => 'Quotes',
 *     'template'       => function () { echo '<p class="quote"></p>'; },
 *     'script'         => 'jorvy-main',
 * ) );
 * desktop_mode_register_window_tab( 'jorvy', array(
 *     'value'    => 'about',
 *     'label'    => 'About',
 *     'template' => function () { echo '<p>Marvel quotes, rotated every 10s.</p>'; },
 * ) );
 *
 * // A companion plugin attaches a tab to someone else's window:
 * desktop_mode_register_window_tab( 'jorvy', array(
 *     'value'    => 'stats',
 *     'label'    => 'Stats',
 *     'template' => 'jorvy_stats_pane',
 *     'script'   => 'jorvy-stats',
 * ) );
 * ```
 *
 * @since 0.11.0
 *
 * @param string $window_id Id of the native window this tab belongs to.
 * @param array  $args {
 *     @type string   $value        Tab id (unique within the window).
 *                                  Required. Cannot equal the reserved
 *                                  value `main` — that's the window's
 *                                  own template tab.
 *     @type string   $label        Display label on the tab strip. Required.
 *     @type callable $template     Callback that echoes the tab's
 *                                  pane HTML. Wrapped in
 *                                  `<wpd-tabpanel for="<value>">` by
 *                                  the shell. Required.
 *     @type string   $script       Optional script handle enqueued
 *                                  when the window is active — useful
 *                                  when a tab needs its own JS module
 *                                  without bloating the main window
 *                                  script. Default empty.
 *     @type int      $position     Sort order among tabs on this
 *                                  window; lower renders earlier.
 *                                  Default 100.
 *     @type string[] $capabilities Gate: ALL caps must match. Any
 *                                  missed cap returns
 *                                  `WP_Error desktop_mode_capability_denied`.
 * }
 * @return true|WP_Error `true` on success; `WP_Error` otherwise.
 */
function desktop_mode_register_window_tab( $window_id, $args = array() ) {
	$window_id = sanitize_key( (string) $window_id );
	if ( '' === $window_id ) {
		return desktop_mode_registration_error(
			'desktop_mode_missing_window_id',
			__( 'Window id is required when registering a tab.', 'desktop-mode' )
		);
	}

	$defaults = array(
		'value'        => '',
		'label'        => '',
		'template'     => null,
		'script'       => '',
		'position'     => 100,
		'capabilities' => array(),
	);
	$args = wp_parse_args( $args, $defaults );

	foreach ( (array) $args['capabilities'] as $cap ) {
		if ( ! current_user_can( (string) $cap ) ) {
			return desktop_mode_registration_error(
				'desktop_mode_capability_denied',
				sprintf(
					/* translators: %s: capability slug. */
					__( 'Current user lacks the %s capability required to register this window tab.', 'desktop-mode' ),
					(string) $cap
				),
				array( 'capability' => (string) $cap, 'window_id' => $window_id )
			);
		}
	}

	// Tab values accept both flat slugs ('convert') and a single
	// `vendor/sub-id` namespace ('plugin/convert') so two plugins
	// targeting the same window can ship same-named tabs without
	// stomping each other in the registry. The downstream uses
	// (`wpd-tabpanel[for="…"]`, `<wpd-tab value="…">`) all pass the
	// value through esc_attr and use it as an attribute selector,
	// which tolerates the slash.
	$value_raw = strtolower( trim( (string) $args['value'] ) );
	if ( '' === $value_raw ) {
		return desktop_mode_registration_error(
			'desktop_mode_missing_tab_value',
			__( 'Window tab registration requires a non-empty `value`.', 'desktop-mode' ),
			array( 'window_id' => $window_id )
		);
	}
	if ( ! preg_match( '/^[a-z0-9_-]+(\/[a-z0-9_-]+)?$/', $value_raw ) ) {
		return desktop_mode_registration_error(
			'desktop_mode_invalid_tab_value',
			sprintf(
				/* translators: %s: the invalid value. */
				__( 'Window tab `value` "%s" must match /^[a-z0-9_-]+(\/[a-z0-9_-]+)?$/ — lowercase alphanum + hyphen/underscore, with at most one `vendor/sub-id` slash.', 'desktop-mode' ),
				$value_raw
			),
			array( 'window_id' => $window_id, 'value' => $value_raw )
		);
	}
	$value = $value_raw;
	if ( DESKTOP_MODE_NATIVE_WINDOW_MAIN_TAB === $value ) {
		return desktop_mode_registration_error(
			'desktop_mode_reserved_tab_value',
			sprintf(
				/* translators: %s: the reserved value. */
				__( 'The tab value "%s" is reserved for the window\'s own template tab.', 'desktop-mode' ),
				DESKTOP_MODE_NATIVE_WINDOW_MAIN_TAB
			),
			array( 'window_id' => $window_id, 'value' => $value )
		);
	}
	if ( '' === (string) $args['label'] ) {
		return desktop_mode_registration_error(
			'desktop_mode_missing_label',
			__( 'Window tab registration requires a non-empty `label`.', 'desktop-mode' ),
			array( 'window_id' => $window_id )
		);
	}
	if ( ! is_callable( $args['template'] ) ) {
		return desktop_mode_registration_error(
			'desktop_mode_invalid_template',
			__( 'Window tab registration requires a callable `template` that echoes the pane body.', 'desktop-mode' ),
			array( 'window_id' => $window_id )
		);
	}

	$entry = array(
		'value'    => $value,
		'label'    => (string) $args['label'],
		'template' => $args['template'],
		'script'   => (string) $args['script'],
		'position' => (int) $args['position'],
	);
	desktop_mode_desktop_window_tab_registry( $window_id, $value, $entry );

	/**
	 * Fires after a native window tab is successfully registered.
	 *
	 * Does NOT fire when `desktop_mode_register_window_tab()` returns
	 * a `WP_Error`.
	 *
	 * @since 0.11.0
	 *
	 * @param string $window_id The window this tab belongs to.
	 * @param string $value     The tab value.
	 * @param array  $entry     The stored registry entry.
	 */
	do_action( 'desktop_mode_window_tab_registered', $window_id, $value, $entry );

	return true;
}

/**
 * Internal nested registry for native-window tabs keyed by
 * `[window_id][value]`. Pass `$entry = null` and any non-empty
 * `$value` to read a single entry; pass both `$window_id` and
 * `$value` empty to get the full registry.
 *
 * @since 0.11.0
 * @internal
 *
 * @param string     $window_id Window id (or '' to read everything).
 * @param string     $value     Tab value (or '' to read every tab
 *                              on the given window).
 * @param array|null $entry     Entry to store, or null to just read.
 * @return array|null
 */
function desktop_mode_desktop_window_tab_registry( $window_id = '', $value = '', $entry = null ) {
	static $store = array();

	if ( '' === (string) $window_id ) {
		return $store;
	}
	if ( ! isset( $store[ $window_id ] ) ) {
		$store[ $window_id ] = array();
	}
	if ( '' === (string) $value ) {
		return $store[ $window_id ];
	}
	if ( null !== $entry ) {
		$store[ $window_id ][ $value ] = $entry;
	}
	return isset( $store[ $window_id ][ $value ] )
		? $store[ $window_id ][ $value ]
		: null;
}

/**
 * Return the ordered list of tab descriptors for a window. The
 * main tab (reserved value `main`) is always first; additional
 * tabs follow in `position` order (ties broken by registration
 * order).
 *
 * Shape per entry: `{ value, label, template, script, is_main, position }`.
 *
 * Filterable via `desktop_mode_window_tabs` so a late-loading plugin
 * can reorder, hide, or relabel tabs another plugin registered —
 * mirrors the `desktop_mode_wallpapers` filter discipline.
 *
 * @since 0.11.0
 *
 * @param string $window_id Window id.
 * @return array[]
 */
function desktop_mode_get_native_window_tabs( $window_id ) {
	$window = desktop_mode_native_window_registry( (string) $window_id );
	if ( ! is_array( $window ) ) {
		return array();
	}

	$extras = desktop_mode_desktop_window_tab_registry( $window_id );
	if ( ! is_array( $extras ) ) {
		$extras = array();
	}

	// Main tab first — label falls back to the window title when no
	// `main_tab_label` was set during registration.
	$main_label = '' !== (string) $window['main_tab_label']
		? (string) $window['main_tab_label']
		: (string) $window['title'];
	$tabs = array(
		array(
			'value'    => DESKTOP_MODE_NATIVE_WINDOW_MAIN_TAB,
			'label'    => $main_label,
			'template' => $window['template'],
			'script'   => '',
			'is_main'  => true,
			'position' => 0,
		),
	);

	// Additional tabs sorted by position. Values are trusted — they
	// come from sanitize_key() at registration time.
	$sorted = array_values( $extras );
	usort( $sorted, static function ( $a, $b ) {
		if ( $a['position'] === $b['position'] ) {
			return 0;
		}
		return $a['position'] < $b['position'] ? -1 : 1;
	} );
	foreach ( $sorted as $tab ) {
		$tabs[] = array(
			'value'    => $tab['value'],
			'label'    => $tab['label'],
			'template' => $tab['template'],
			'script'   => $tab['script'],
			'is_main'  => false,
			'position' => $tab['position'],
		);
	}

	/**
	 * Filters the full ordered tab list for a native window right
	 * before the shell renders it. Return a reshaped array to
	 * reorder, hide, or rename tabs — same shape as the input.
	 *
	 * The main tab's `template` is the window's own template
	 * callback; replacing it at filter time is supported but
	 * unusual — prefer updating the window registration itself.
	 *
	 * @since 0.11.0
	 *
	 * @param array[] $tabs      Ordered tab descriptors.
	 * @param string  $window_id Window id.
	 */
	$filtered = apply_filters( 'desktop_mode_window_tabs', $tabs, $window_id );
	return is_array( $filtered ) ? $filtered : $tabs;
}

/**
 * Render a native window's template HTML to a string, wrapping
 * with tabs when the window has at least one additional tab
 * registered. Shared by `desktop_mode_render_native_window_templates()`
 * (which emits the live `<template>` element) and
 * `desktop_mode_build_native_windows_payload()` (which captures the same
 * string for the shell config so mid-session activation can inject
 * the template without a reload).
 *
 * Single-tab windows (no additional tabs registered) render the
 * same flat body they always did — backwards-compatible with
 * every existing caller.
 *
 * @since 0.11.0
 *
 * @param array $entry Window registry entry.
 * @return string Template body HTML (no outer `<template>` tag).
 */
/**
 * Returns the `wp_kses`-shaped allowlist used to escape native-window
 * `<template>` payloads (and the recycle-bin template) before they're
 * emitted into the page.
 *
 * Templates are inert until JS clones them out of the `<template>`
 * tag — but Plugin Check still requires escape-on-output. The list
 * extends `wp_kses_allowed_html( 'post' )` with form controls,
 * `<wpd-*>` web components, and dashicon spans, plus permissive
 * `data-*`, `aria-*`, and component-specific attributes. Plugins
 * registering their own native windows can extend the list via the
 * `desktop_mode_native_window_allowed_html` filter below.
 *
 * @since 0.6.2
 *
 * @return array<string,array<string,bool>>
 */
function desktop_mode_native_window_allowed_html() {
	$base = wp_kses_allowed_html( 'post' );

	$global_attrs = array(
		'id'              => true,
		'class'           => true,
		'style'           => true,
		'title'           => true,
		'role'            => true,
		'tabindex'        => true,
		'hidden'          => true,
		'slot'            => true,
		'part'            => true,
		'lang'            => true,
		'dir'             => true,
		'draggable'       => true,
		'contenteditable' => true,
		'data-*'          => true,
		'aria-*'          => true,
	);

	$form_attrs = array_merge(
		$global_attrs,
		array(
			'name'         => true,
			'value'        => true,
			'placeholder' => true,
			'required'    => true,
			'disabled'    => true,
			'readonly'    => true,
			'checked'     => true,
			'selected'    => true,
			'min'         => true,
			'max'         => true,
			'step'        => true,
			'minlength'   => true,
			'maxlength'   => true,
			'pattern'     => true,
			'autocomplete' => true,
			'autofocus'   => true,
			'multiple'    => true,
			'rows'        => true,
			'cols'        => true,
			'wrap'        => true,
			'size'        => true,
			'for'         => true,
			'form'        => true,
			'type'        => true,
			'accept'      => true,
			'list'        => true,
			'src'         => true,
			'href'        => true,
			'target'      => true,
			'rel'         => true,
			'open'        => true,
			'variant'     => true,
		)
	);

	$wpd_attrs = array_merge(
		$form_attrs,
		array(
			'gap'           => true,
			'padding'       => true,
			'align'         => true,
			'justify'       => true,
			'direction'     => true,
			'wrap'          => true,
			'inset'         => true,
			'icon'          => true,
			'tone'          => true,
			'size'          => true,
			'shape'         => true,
			'badge'         => true,
			'selectable'    => true,
			'sticky-header' => true,
			'hover'         => true,
			'striped'       => true,
			'loading'       => true,
			'columns'       => true,
			'rows'          => true,
			'sortable'      => true,
			'expandable'    => true,
			'preset'        => true,
			'label'         => true,
			'description'   => true,
			'orientation'   => true,
			'level'         => true,
			'collapsed'     => true,
		)
	);

	// Built-in HTML elements the templates rely on.
	$extra = array(
		'form'     => $form_attrs,
		'fieldset' => $form_attrs,
		'legend'   => $global_attrs,
		'label'    => $form_attrs,
		'input'    => $form_attrs,
		'select'   => $form_attrs,
		'option'   => $form_attrs,
		'optgroup' => $form_attrs,
		'textarea' => $form_attrs,
		'button'   => $form_attrs,
		'output'   => $form_attrs,
		'datalist' => $global_attrs,
		'progress' => $form_attrs,
		'meter'    => $form_attrs,
		'details'  => $global_attrs,
		'summary'  => $global_attrs,
		'dialog'   => $global_attrs,
		'header'   => $global_attrs,
		'footer'   => $global_attrs,
		'main'     => $global_attrs,
		'nav'      => $global_attrs,
		'section'  => $global_attrs,
		'article'  => $global_attrs,
		'aside'    => $global_attrs,
		'figure'   => $global_attrs,
		'figcaption' => $global_attrs,
		'time'     => array_merge( $global_attrs, array( 'datetime' => true ) ),
		'mark'     => $global_attrs,
		'small'    => $global_attrs,
		'svg'      => array_merge( $global_attrs, array( 'viewbox' => true, 'width' => true, 'height' => true, 'fill' => true, 'stroke' => true, 'xmlns' => true ) ),
		'path'     => array( 'd' => true, 'fill' => true, 'stroke' => true, 'stroke-width' => true, 'stroke-linecap' => true, 'stroke-linejoin' => true, 'class' => true ),
		'g'        => array( 'class' => true, 'transform' => true, 'fill' => true ),
		'circle'   => array( 'cx' => true, 'cy' => true, 'r' => true, 'fill' => true, 'stroke' => true, 'class' => true ),
		'rect'     => array( 'x' => true, 'y' => true, 'width' => true, 'height' => true, 'rx' => true, 'ry' => true, 'fill' => true, 'stroke' => true, 'class' => true ),
		'line'     => array( 'x1' => true, 'y1' => true, 'x2' => true, 'y2' => true, 'stroke' => true, 'stroke-width' => true, 'class' => true ),
		'polyline' => array( 'points' => true, 'fill' => true, 'stroke' => true, 'class' => true ),
		'polygon'  => array( 'points' => true, 'fill' => true, 'stroke' => true, 'class' => true ),
		'use'      => array( 'href' => true, 'class' => true ),
	);

	// `<wpd-*>` web components — every shipped tag plus a permissive
	// open door for new ones added by plugin templates.
	$wpd_tags = array(
		'wpd-stack', 'wpd-cluster', 'wpd-grid', 'wpd-spacer', 'wpd-divider',
		'wpd-tabs', 'wpd-tab', 'wpd-tabpanel',
		'wpd-segmented', 'wpd-segment',
		'wpd-button', 'wpd-icon-button', 'wpd-button-group',
		'wpd-text-field', 'wpd-textarea', 'wpd-search-field',
		'wpd-select', 'wpd-checkbox', 'wpd-radio', 'wpd-radio-group',
		'wpd-switch', 'wpd-slider',
		'wpd-table', 'wpd-table-column', 'wpd-table-row', 'wpd-table-cell',
		'wpd-card', 'wpd-list', 'wpd-list-item',
		'wpd-badge', 'wpd-pill', 'wpd-tag', 'wpd-chip',
		'wpd-spinner', 'wpd-skeleton', 'wpd-empty-state',
		'wpd-tooltip', 'wpd-popover', 'wpd-menu', 'wpd-menu-item',
		'wpd-modal', 'wpd-drawer', 'wpd-toast',
		'wpd-icon', 'wpd-avatar', 'wpd-heading', 'wpd-text', 'wpd-link',
		'wpd-banner', 'wpd-alert', 'wpd-callout',
		'wpd-form-row', 'wpd-form-section', 'wpd-help-text',
		'wpd-toolbar', 'wpd-toolbar-group',
	);
	foreach ( $wpd_tags as $tag ) {
		$extra[ $tag ] = $wpd_attrs;
	}

	$allowed = array_merge( $base, $extra );

	/**
	 * Filters the kses allowlist used when escaping native-window
	 * `<template>` payloads.
	 *
	 * Plugins registering their own native windows can extend the
	 * list with custom tags or attributes if their templates need
	 * markup not covered here.
	 *
	 * @since 0.6.2
	 *
	 * @param array $allowed wp_kses-shaped allowlist.
	 */
	return (array) apply_filters( 'desktop_mode_native_window_allowed_html', $allowed );
}

function desktop_mode_build_native_window_template_html( $entry ) {
	if ( ! is_array( $entry ) || ! is_callable( $entry['template'] ) ) {
		return '';
	}

	$tabs = desktop_mode_get_native_window_tabs( $entry['id'] );
	$has_extras = count( $tabs ) > 1;

	// Fast path — single-pane window, no wrapping.
	if ( ! $has_extras ) {
		ob_start();
		call_user_func( $entry['template'] );
		return (string) ob_get_clean();
	}

	// Multi-tab window — wrap in <wpd-stack> + <wpd-tabs> + one
	// <wpd-tabpanel> per tab. The default active tab is the main
	// one (the window's own template). Plugin authors still get to
	// declare their own tab-change side effects via the
	// `wpd-tab-change` event bubbled by <wpd-tabs>.
	//
	// The wrap's padding is plugin-controllable two ways:
	//   1. `main_tab_padding` arg on `desktop_mode_register_window` —
	//      a per-window override. `0` opts into edge-to-edge
	//      content.
	//   2. `desktop_mode_native_window_tab_wrap_padding` filter for
	//      late-bound overrides (e.g. a theme that wants every
	//      tabbed window to adopt a narrower inset).
	// Default stays 16px so existing plugins don't shift.
	$default_padding = isset( $entry['main_tab_padding'] )
		&& '' !== (string) $entry['main_tab_padding']
		? (int) $entry['main_tab_padding']
		: 16;
	/**
	 * Filters the padding (in px) applied to the auto-generated
	 * tab wrap around a native window's template body. The shell
	 * emits the wrap as `<wpd-stack padding="N">`; the CSS-as-
	 * attribute pipeline at the client translates that to
	 * `style.padding`.
	 *
	 * Return `0` for edge-to-edge content. Negative values are
	 * clamped to 0.
	 *
	 * @since 0.13.0
	 *
	 * @param int    $padding   Default padding in px.
	 * @param string $window_id The native window id.
	 */
	$padding = (int) apply_filters(
		'desktop_mode_native_window_tab_wrap_padding',
		$default_padding,
		(string) $entry['id']
	);
	if ( $padding < 0 ) {
		$padding = 0;
	}

	$buffer  = sprintf(
		'<wpd-stack gap="12" padding="%d">',
		$padding
	);
	$buffer .= '<wpd-tabs value="' . esc_attr( DESKTOP_MODE_NATIVE_WINDOW_MAIN_TAB ) . '">';
	foreach ( $tabs as $tab ) {
		$buffer .= sprintf(
			'<wpd-tab value="%s">%s</wpd-tab>',
			esc_attr( $tab['value'] ),
			esc_html( $tab['label'] )
		);
	}
	$buffer .= '</wpd-tabs>';

	// Stamp `hidden` on every non-active panel directly in the
	// emitted HTML. The client-side `<wpd-tabs>` syncs panel
	// visibility on `value` changes, but its initial sync runs
	// inside a microtask — and panel siblings may not have upgraded
	// in time on first paint. Setting the attribute server-side
	// makes first paint correct regardless of upgrade order; the JS
	// keeps owning subsequent transitions.
	foreach ( $tabs as $tab ) {
		if ( ! is_callable( $tab['template'] ) ) {
			continue;
		}
		$is_active = DESKTOP_MODE_NATIVE_WINDOW_MAIN_TAB === $tab['value'];
		$buffer   .= sprintf(
			'<wpd-tabpanel for="%s"%s>',
			esc_attr( $tab['value'] ),
			$is_active ? '' : ' hidden'
		);
		ob_start();
		call_user_func( $tab['template'] );
		$buffer .= (string) ob_get_clean();
		$buffer .= '</wpd-tabpanel>';
	}

	$buffer .= '</wpd-stack>';
	return $buffer;
}

/**
 * Enqueue plugin-registered wallpaper scripts on the shell page
 * so wallpapers active at boot time have their defs available
 * without any dynamic-load roundtrip.
 *
 * @since 0.10.0
 */
function desktop_mode_enqueue_desktop_wallpaper_scripts() {
	if ( ! desktop_mode_is_enabled() || desktop_mode_is_chromeless_request() || desktop_mode_is_classic_request() ) {
		return;
	}
	$registry = desktop_mode_desktop_wallpaper_registry();
	if ( ! is_array( $registry ) ) {
		return;
	}
	foreach ( $registry as $entry ) {
		if ( ! empty( $entry['script'] ) ) {
			wp_enqueue_script( $entry['script'] );
		}
	}
}
add_action( 'admin_enqueue_scripts', 'desktop_mode_enqueue_desktop_wallpaper_scripts', 20 );

/**
 * Enqueue plugin-registered widget scripts on the shell page so
 * widgets active at boot time have their mount callbacks
 * available without any dynamic-load roundtrip.
 *
 * @since 0.10.0
 */
function desktop_mode_enqueue_desktop_widget_scripts() {
	if ( ! desktop_mode_is_enabled() || desktop_mode_is_chromeless_request() || desktop_mode_is_classic_request() ) {
		return;
	}
	$registry = desktop_mode_desktop_widget_registry();
	if ( ! is_array( $registry ) ) {
		return;
	}
	foreach ( $registry as $entry ) {
		if ( ! empty( $entry['script'] ) ) {
			wp_enqueue_script( $entry['script'] );
		}
	}
}
add_action( 'admin_enqueue_scripts', 'desktop_mode_enqueue_desktop_widget_scripts', 20 );

/**
 * Enqueue every registered native window's script when the shell
 * is active. Runs on `admin_enqueue_scripts` alongside the main
 * shell enqueue so ordering (shell → plugin scripts) is
 * deterministic.
 *
 * @since 0.10.0
 */
function desktop_mode_enqueue_native_window_scripts() {
	if ( ! desktop_mode_is_enabled() || desktop_mode_is_chromeless_request() || desktop_mode_is_classic_request() ) {
		return;
	}
	$registry = desktop_mode_native_window_registry();
	if ( ! is_array( $registry ) ) {
		return;
	}
	foreach ( $registry as $entry ) {
		// Enqueue per-tab scripts — each tab registration can carry
		// its own script handle so a tab's JS module stays scoped to
		// that tab. Main tab uses the window's own `script`; it's
		// enqueued below alongside the localize call.
		$tabs = desktop_mode_get_native_window_tabs( $entry['id'] );
		foreach ( $tabs as $tab ) {
			if ( $tab['is_main'] || empty( $tab['script'] ) ) {
				continue;
			}
			wp_enqueue_script( $tab['script'] );
		}

		if ( empty( $entry['script'] ) ) {
			continue;
		}
		wp_enqueue_script( $entry['script'] );
		// Localize the config the JS side reads to register itself.
		wp_localize_script(
			$entry['script'],
			'wpDesktopNativeWindow_' . str_replace( '-', '_', $entry['id'] ),
			array(
				'id'        => $entry['id'],
				'title'     => $entry['title'],
				'icon'      => $entry['icon'],
				'width'     => $entry['width'],
				'height'    => $entry['height'],
				'minWidth'  => $entry['min_width'],
				'minHeight' => $entry['min_height'],
				'placement' => $entry['placement'],
				'autofocus' => $entry['autofocus'],
				'templateId' => 'wpdm-native-window-' . $entry['id'],
				'tabs'      => array_map(
					static function ( $tab ) {
						return array(
							'value'  => $tab['value'],
							'label'  => $tab['label'],
							'isMain' => $tab['is_main'],
						);
					},
					$tabs
				),
			)
		);

		// Bundle-bound `config` (since 0.6.0). Ships through
		// `wp_add_inline_script` `'before'` so it lands on the eager
		// path the same way `wp_localize_script` does, AND through
		// the lazy-load payload (see `desktop_mode_resolve_script_payload`)
		// so the same data is available even when the script is
		// dynamically injected mid-session. The bundle reads it via
		// `wp.desktop.getWindowConfig( id )` or directly at
		// `window.wpDesktopWindowConfig[ id ]`.
		if ( ! empty( $entry['config'] ) && is_array( $entry['config'] ) ) {
			wp_add_inline_script(
				$entry['script'],
				sprintf(
					'window.wpDesktopWindowConfig=window.wpDesktopWindowConfig||{};window.wpDesktopWindowConfig[%s]=%s;',
					wp_json_encode( $entry['id'] ),
					wp_json_encode( $entry['config'] )
				),
				'before'
			);
		}
	}
}
add_action( 'admin_enqueue_scripts', 'desktop_mode_enqueue_native_window_scripts', 20 );

/**
 * Emit a `<template>` tag for every registered native window on
 * `admin_footer` when the shell is active. The JS side resolves
 * these via `document.getElementById( `wpdm-native-window-${id}` )`
 * and clones them into each opened window's body.
 *
 * @since 0.10.0
 */
function desktop_mode_render_native_window_templates() {
	if ( ! desktop_mode_is_enabled() || desktop_mode_is_chromeless_request() || desktop_mode_is_classic_request() ) {
		return;
	}
	$registry = desktop_mode_native_window_registry();
	if ( ! is_array( $registry ) ) {
		return;
	}
	foreach ( $registry as $entry ) {
		if ( ! is_callable( $entry['template'] ) ) {
			continue;
		}
		$html = desktop_mode_build_native_window_template_html( $entry );
		if ( '' === $html ) {
			continue;
		}
		printf(
			'<template id="wpdm-native-window-%s">',
			esc_attr( $entry['id'] )
		);
		echo wp_kses( $html, desktop_mode_native_window_allowed_html() );
		echo '</template>';
	}
}
add_action( 'admin_footer', 'desktop_mode_render_native_window_templates', 20 );

/**
 * Enqueue a plugin script that extends the desktop shell.
 *
 * Thin wrapper around `wp_enqueue_script` that pre-wires the correct
 * dependencies so the script:
 *
 *   - Runs AFTER `wp-desktop` (the shell bundle) so `wp.desktop.*` is
 *     guaranteed available.
 *   - Runs AFTER `wp-hooks` so `wp.hooks.addAction( 'wp-desktop.init', ... )`
 *     works without the plugin author having to remember that dep.
 *   - Is only enqueued in the admin (shell only boots there).
 *
 * Drop-in replacement for the boilerplate:
 *
 * ```php
 * add_action( 'admin_enqueue_scripts', function () {
 *     wp_enqueue_script(
 *         'my-plugin',
 *         plugins_url( 'my-plugin.js', __FILE__ ),
 *         array( 'wp-desktop', 'wp-hooks' ),
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
 * @since 0.14.0
 *
 * @param string          $handle    Script handle.
 * @param string          $src       Full URL of the script, or path relative
 *                                   to the WordPress root directory.
 * @param string[]        $extra_deps Additional dependency handles. `wp-desktop`
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
		array( 'wp-desktop', 'wp-hooks' ),
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
