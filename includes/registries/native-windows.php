<?php
/**
 * OpenStation — Native windows registry.
 *
 * The largest of the five components.php registries — owns:
 *
 *   - `openstation_register_window()` — plugin-author API
 *   - `openstation_native_window_registry()` — internal store
 *   - `openstation_native_window_allowed_html()` — wp_kses
 *     allowlist for `<template>` payloads
 *   - `openstation_build_native_window_template_html()` —
 *     wraps the registered template callback in tabs markup
 *     when the window has multiple registered tabs
 *   - `openstation_enqueue_native_window_scripts()` — enqueue
 *     hook that ships every registered window's script handle
 *   - `openstation_render_native_window_templates()` — renders
 *     the `<template>` elements the shell clones
 *
 * Extracted from `components.php` during the architecture-0.8.1
 * PHP slicing (phase 6). The window-tabs registry that builds on
 * top of this lives in `includes/registries/window-tabs.php`.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register a PHP-owned native desktop window with one call.
 *
 * Under the hood this:
 *
 *   1. Captures the $args and stores them on a module-level
 *      registry so the relevant admin_footer + enqueue hooks fire
 *      only for the current user's openstation shell.
 *   2. On `admin_footer` (shell-side only), emits
 *      `<template id="os-native-window-<id>">` wrapping the
 *      output of the `template` callback. Each registered window
 *      gets its own template element.
 *   3. On `admin_enqueue_scripts` (shell-side), enqueues the
 *      caller's `script` handle if one was provided. The script
 *      registers a render callback at
 *      `window.openStationNativeWindows[<id>]`. On every window open
 *      the shell clones the registered template into the body and
 *      then invokes the callback — render is enhancement: query
 *      the body for mount points your template declared, light
 *      them up. Without a `script` the cloned template IS the
 *      window; declarative-only plugins need zero JS.
 *   4. Passes a localized config blob to the script
 *      (`openStationNativeWindow_<id>`) carrying the window's
 *      `id`, `title`, `icon`, dimensions, and `placement`. The
 *      script then calls `wp.os.registerSystemTile()` +
 *      `wp.os.registerWindow()` to wire up the dock tile
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
 * `wp.os.windowManager.open()` programmatically) to surface
 * the window.
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
 *                                  `<template id="os-native-window-
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
 *                                  `WP_Error openstation_capability_denied`.
 *     @type bool|string $autofocus Passed verbatim to
 *                                  `NativeWindowDef.autofocus`.
 *     @type string   $main_tab_label Label for the "main" tab that
 *                                  displays the window's own
 *                                  `template` output. Only rendered
 *                                  when at least one additional
 *                                  tab is registered via
 *                                  {@see openstation_register_window_tab()}.
 *                                  Defaults to the window's `title`.
 *     @type int      $main_tab_padding Padding (in px) applied to the
 *                                  auto-generated tab-wrap around
 *                                  the window body. Only applies
 *                                  when additional tabs are
 *                                  registered. Default 16. Pass 0
 *                                  for edge-to-edge content.
 *                                  Filterable at runtime via
 *                                  `openstation_native_window_tab_wrap_padding`.
 *     @type array    $config       Arbitrary serializable data to ship
 *                                  to the bundle alongside the script
 *                                  tag. Read in JS via
 *                                  `wp.os.getWindowConfig( $id )`
 *                                  (or directly at
 *                                  `window.openStationWindowConfig[ $id ]`).
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
function openstation_register_window( $id, $args = array() ) {
	$id = sanitize_key( (string) $id );
	if ( '' === $id ) {
		return openstation_registration_error(
			'openstation_missing_id',
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
		// until F5.
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
	$args     = wp_parse_args( $args, $defaults );

	// Capability gate — ALL listed caps must match. Fail closed.
	foreach ( (array) $args['capabilities'] as $cap ) {
		if ( ! current_user_can( (string) $cap ) ) {
			return openstation_registration_error(
				'openstation_capability_denied',
				sprintf(
					/* translators: %s: capability slug. */
					__( 'Current user lacks the %s capability required to register this native window.', 'desktop-mode' ),
					(string) $cap
				),
				array(
					'capability' => (string) $cap,
					'id'         => $id,
				)
			);
		}
	}

	// Required fields.
	if ( '' === (string) $args['title'] ) {
		return openstation_registration_error(
			'openstation_missing_title',
			__( 'Native window registration requires a non-empty `title`.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}
	if ( ! is_callable( $args['template'] ) ) {
		return openstation_registration_error(
			'openstation_invalid_template',
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
		// Stored as-is (string or int). `openstation_build_native_window_template_html`
		// coerces to int and falls back to 16 when absent.
		'main_tab_padding' => $args['main_tab_padding'],
		// Bundle-bound config delivered through the same path as
		// `wp_localize_script` `extra['data']` — see the `config` doc
		// in this function's `$args` block and `openstation_resolve_script_payload()`
		// for how it lands on the wire.
		'config'           => is_array( $args['config'] ) ? $args['config'] : array(),
	);
	openstation_native_window_registry( $id, $entry );

	/**
	 * Fires after a native desktop window is successfully registered.
	 *
	 * Lets plugins react to registrations made by other plugins —
	 * e.g. a widget that auto-opens when a given window registers,
	 * or analytics tracking of which windows the current install
	 * exposes. Does NOT fire when `openstation_register_window()`
	 * returns a `WP_Error`.
	 *
	 * @param string $id    The window id.
	 * @param array  $entry The stored registry entry (id, title,
	 *                      icon, template callback, script handle,
	 *                      size defaults, placement, autofocus).
	 */
	do_action( 'openstation_native_window_registered', $id, $entry );

	return true;
}

/**
 * Internal module-level registry for native windows registered
 * via {@see openstation_register_window()}. Passing a second
 * argument stores the entry; passing only the id returns the
 * stored value (or null). Kept small and side-effect-free so
 * tests can introspect.
 *
 * @internal
 *
 * @param string     $id    Window id.
 * @param array|null $entry Entry to store, or null to just read.
 * @return array|null Either the stored entry or the full registry
 *                    (when id is empty).
 */
function openstation_native_window_registry( $id = '', $entry = null ) {
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
 * Returns the `wp_kses`-shaped allowlist used to escape native-window
 * `<template>` payloads (and the recycle-bin template) before they're
 * emitted into the page.
 *
 * Templates are inert until JS clones them out of the `<template>`
 * tag — but Plugin Check still requires escape-on-output. The list
 * extends `wp_kses_allowed_html( 'post' )` with form controls,
 * `<os-*>` web components, and dashicon spans, plus permissive
 * `data-*`, `aria-*`, and component-specific attributes. Plugins
 * registering their own native windows can extend the list via the
 * `openstation_native_window_allowed_html` filter below.
 *
 * @return array<string,array<string,bool>>
 */
function openstation_native_window_allowed_html() {
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
		// `full-width` is a layout-level flag honoured by
		// `<os-form>` (and any future os-* container that opts in
		// to row-spanning slotted children). Lives in the global
		// allowlist so a plain `<div full-width>` wrapper isn't
		// stripped by kses on its way through the template.
		'full-width'      => true,
	);

	$form_attrs = array_merge(
		$global_attrs,
		array(
			'name'         => true,
			'value'        => true,
			'placeholder'  => true,
			'required'     => true,
			'disabled'     => true,
			'readonly'     => true,
			'checked'      => true,
			'selected'     => true,
			'min'          => true,
			'max'          => true,
			'step'         => true,
			'minlength'    => true,
			'maxlength'    => true,
			'pattern'      => true,
			'autocomplete' => true,
			'autofocus'    => true,
			'multiple'     => true,
			'rows'         => true,
			'cols'         => true,
			'wrap'         => true,
			'size'         => true,
			'for'          => true,
			'form'         => true,
			'type'         => true,
			'accept'       => true,
			'list'         => true,
			'src'          => true,
			'href'         => true,
			'target'       => true,
			'rel'          => true,
			'open'         => true,
			'variant'      => true,
		)
	);

	$wpd_attrs = array_merge(
		$form_attrs,
		array(
			'gap'            => true,
			'padding'        => true,
			'align'          => true,
			'justify'        => true,
			'direction'      => true,
			'wrap'           => true,
			'inset'          => true,
			'icon'           => true,
			'tone'           => true,
			'size'           => true,
			'shape'          => true,
			'badge'          => true,
			'selectable'     => true,
			'sticky-header'  => true,
			'sticky-columns' => true,
			'hover'          => true,
			'striped'        => true,
			'bordered'       => true,
			'compact'        => true,
			'loading'        => true,
			'loading-rows'   => true,
			'columns'        => true,
			'rows'           => true,
			'sortable'       => true,
			'expandable'     => true,
			'preset'         => true,
			'label'          => true,
			'description'    => true,
			'orientation'    => true,
			'level'          => true,
			'collapsed'      => true,
			// `<os-form>` props + the `full-width` row span flag
			// honoured by the form's slotted-child layout rule.
			'submit-label'   => true,
			'reset-label'    => true,
			'busy'           => true,
			'error'          => true,
			'min-column'     => true,
			'show-reset'     => true,
			'reveal'         => true,
			'full-width'     => true,
		)
	);

	// Built-in HTML elements the templates rely on.
	$extra = array(
		'form'       => $form_attrs,
		'fieldset'   => $form_attrs,
		'legend'     => $global_attrs,
		'label'      => $form_attrs,
		'input'      => $form_attrs,
		'select'     => $form_attrs,
		'option'     => $form_attrs,
		'optgroup'   => $form_attrs,
		'textarea'   => $form_attrs,
		'button'     => $form_attrs,
		'output'     => $form_attrs,
		'datalist'   => $global_attrs,
		'progress'   => $form_attrs,
		'meter'      => $form_attrs,
		'details'    => $global_attrs,
		'summary'    => $global_attrs,
		'dialog'     => $global_attrs,
		'header'     => $global_attrs,
		'footer'     => $global_attrs,
		'main'       => $global_attrs,
		'nav'        => $global_attrs,
		'section'    => $global_attrs,
		'article'    => $global_attrs,
		'aside'      => $global_attrs,
		'figure'     => $global_attrs,
		'figcaption' => $global_attrs,
		'time'       => array_merge( $global_attrs, array( 'datetime' => true ) ),
		'mark'       => $global_attrs,
		'small'      => $global_attrs,
		'svg'        => array_merge(
			$global_attrs,
			array(
				'viewbox' => true,
				'width'   => true,
				'height'  => true,
				'fill'    => true,
				'stroke'  => true,
				'xmlns'   => true,
			)
		),
		'path'       => array(
			'd'               => true,
			'fill'            => true,
			'stroke'          => true,
			'stroke-width'    => true,
			'stroke-linecap'  => true,
			'stroke-linejoin' => true,
			'class'           => true,
		),
		'g'          => array(
			'class'     => true,
			'transform' => true,
			'fill'      => true,
		),
		'circle'     => array(
			'cx'     => true,
			'cy'     => true,
			'r'      => true,
			'fill'   => true,
			'stroke' => true,
			'class'  => true,
		),
		'rect'       => array(
			'x'      => true,
			'y'      => true,
			'width'  => true,
			'height' => true,
			'rx'     => true,
			'ry'     => true,
			'fill'   => true,
			'stroke' => true,
			'class'  => true,
		),
		'line'       => array(
			'x1'           => true,
			'y1'           => true,
			'x2'           => true,
			'y2'           => true,
			'stroke'       => true,
			'stroke-width' => true,
			'class'        => true,
		),
		'polyline'   => array(
			'points' => true,
			'fill'   => true,
			'stroke' => true,
			'class'  => true,
		),
		'polygon'    => array(
			'points' => true,
			'fill'   => true,
			'stroke' => true,
			'class'  => true,
		),
		'use'        => array(
			'href'  => true,
			'class' => true,
		),
	);

	// `<os-*>` web components — every shipped tag plus a permissive
	// open door for new ones added by plugin templates.
	$wpd_tags = array(
		'os-stack',
		'os-cluster',
		'os-grid',
		'os-spacer',
		'os-divider',
		'os-tabs',
		'os-tab',
		'os-tabpanel',
		'os-segmented',
		'os-segment',
		'os-button',
		'os-icon-button',
		'os-button-group',
		'os-text-field',
		'os-textarea',
		'os-search-field',
		'os-select',
		'os-option',
		'os-checkbox',
		'os-checkbox-label',
		'os-radio',
		'os-radio-group',
		'os-form',
		'os-switch',
		'os-slider',
		'os-table',
		'os-table-column',
		'os-table-row',
		'os-table-cell',
		'os-card',
		'os-list',
		'os-list-item',
		'os-badge',
		'os-pill',
		'os-tag',
		'os-chip',
		'os-spinner',
		'os-skeleton',
		'os-empty-state',
		'os-tooltip',
		'os-popover',
		'os-menu',
		'os-menu-item',
		'os-modal',
		'os-drawer',
		'os-toast',
		'os-icon',
		'os-avatar',
		'os-heading',
		'os-text',
		'os-link',
		'os-banner',
		'os-alert',
		'os-callout',
		'os-form-row',
		'os-form-section',
		'os-help-text',
		'os-toolbar',
		'os-toolbar-group',
	);
	foreach ( $wpd_tags as $tag ) {
		$extra[ $tag ] = $wpd_attrs;
	}

	$allowed = array_merge( $base, $extra );

	// Promote the framework's global attrs (`slot`, `part`,
	// `full-width`, `data-*`, `aria-*`, …) to EVERY allowed tag —
	// otherwise plain wrappers like `<div slot="header">` lose
	// their `slot` attribute on the way through kses and get
	// projected into the default slot instead of the named one.
	// Caught by inspection when the Add User form's header
	// rendered as a fields-grid cell instead of a banner above
	// the fields. `array_merge( + )` with a kses-true value
	// (boolean `true`) is harmless for tags whose entries are
	// just `true` rather than an attrs map — array_merge skips
	// non-array values.
	foreach ( $allowed as $tag => $attrs ) {
		if ( is_array( $attrs ) ) {
			$allowed[ $tag ] = array_merge( $attrs, $global_attrs );
		}
	}

	/**
	 * Filters the kses allowlist used when escaping native-window
	 * `<template>` payloads.
	 *
	 * Plugins registering their own native windows can extend the
	 * list with custom tags or attributes if their templates need
	 * markup not covered here.
	 *
	 * @param array $allowed wp_kses-shaped allowlist.
	 */
	return (array) apply_filters( 'openstation_native_window_allowed_html', $allowed );
}

/**
 * Run `wp_kses` on a native-window template body with the framework
 * allowlist, **auto-extending the allowlist with every `<os-*>` tag
 * the template actually uses.**
 *
 * The pain this fixes: each shipped `<os-*>` component had to be
 * manually added to the `$wpd_tags` list above, and the failure mode
 * of forgetting it was silent — kses would strip the tag, the
 * template would render as a sea of unparented children, and you'd
 * spend an afternoon working out why "the form has no buttons."
 *
 * Plugin authors registering a new component now only need to
 * `defineComponent('os-foo', OsFoo)` on the JS side and use
 * `<os-foo>` in their template — this helper finds the tag at
 * render time, tags it onto the allowlist with the standard
 * permissive attrs, and runs kses with the extended list.
 *
 * Every callsite in the framework that previously did the
 * `wp_kses( $html, openstation_native_window_allowed_html() )`
 * dance can call this instead and get tag-discovery for free.
 *
 * @param string $html Template HTML to sanitize.
 * @return string Sanitized HTML.
 */
function openstation_kses_native_window_template( $html ) {
	$allowed = openstation_native_window_allowed_html();

	if ( preg_match_all( '/<(os-[a-z][a-z0-9-]*)\b/i', (string) $html, $matches ) ) {
		$unique    = array_unique( array_map( 'strtolower', $matches[1] ) );
		$wpd_attrs = isset( $allowed['os-button'] )
			? $allowed['os-button']
			: array();
		foreach ( $unique as $tag ) {
			if ( ! isset( $allowed[ $tag ] ) ) {
				$allowed[ $tag ] = $wpd_attrs;
			}
		}
	}

	return wp_kses( (string) $html, $allowed );
}

/**
 * Render a native window's template HTML to a string, wrapping
 * with tabs when the window has at least one additional tab
 * registered. Shared by `openstation_render_native_window_templates()`
 * (which emits the live `<template>` element) and
 * `openstation_build_native_windows_payload()` (which captures the same
 * string for the shell config so mid-session activation can inject
 * the template without a reload).
 *
 * Single-tab windows (no additional tabs registered) render the
 * same flat body they always did — backwards-compatible with
 * every existing caller.
 *
 * @param array $entry Window registry entry.
 * @return string Template body HTML (no outer `<template>` tag).
 */
function openstation_build_native_window_template_html( $entry ) {
	if ( ! is_array( $entry ) || ! is_callable( $entry['template'] ) ) {
		return '';
	}

	$tabs       = openstation_get_native_window_tabs( $entry['id'] );
	$has_extras = count( $tabs ) > 1;

	// Fast path — single-pane window, no wrapping.
	if ( ! $has_extras ) {
		ob_start();
		call_user_func( $entry['template'] );
		return (string) ob_get_clean();
	}

	// Multi-tab window — wrap in <os-stack> + <os-tabs> + one
	// <os-tabpanel> per tab. The default active tab is the main
	// one (the window's own template). Plugin authors still get to
	// declare their own tab-change side effects via the
	// `os-tab-change` event bubbled by <os-tabs>.
	//
	// The wrap's padding is plugin-controllable two ways:
	// 1. `main_tab_padding` arg on `openstation_register_window` —
	// a per-window override. `0` opts into edge-to-edge
	// content.
	// 2. `openstation_native_window_tab_wrap_padding` filter for
	// late-bound overrides (e.g. a theme that wants every
	// tabbed window to adopt a narrower inset).
	// Default stays 16px so existing plugins don't shift.
	$default_padding = isset( $entry['main_tab_padding'] )
		&& '' !== (string) $entry['main_tab_padding']
		? (int) $entry['main_tab_padding']
		: 16;
	/**
	 * Filters the padding (in px) applied to the auto-generated
	 * tab wrap around a native window's template body. The shell
	 * emits the wrap as `<os-stack padding="N">`; the CSS-as-
	 * attribute pipeline at the client translates that to
	 * `style.padding`.
	 *
	 * Return `0` for edge-to-edge content. Negative values are
	 * clamped to 0.
	 *
	 * @param int    $padding   Default padding in px.
	 * @param string $window_id The native window id.
	 */
	$padding = (int) apply_filters(
		'openstation_native_window_tab_wrap_padding',
		$default_padding,
		(string) $entry['id']
	);
	if ( $padding < 0 ) {
		$padding = 0;
	}

	$buffer  = sprintf(
		'<os-stack gap="12" padding="%d">',
		$padding
	);
	$buffer .= '<os-tabs value="' . esc_attr( OPENSTATION_NATIVE_WINDOW_MAIN_TAB ) . '">';
	foreach ( $tabs as $tab ) {
		$buffer .= sprintf(
			'<os-tab value="%s">%s</os-tab>',
			esc_attr( $tab['value'] ),
			esc_html( $tab['label'] )
		);
	}
	$buffer .= '</os-tabs>';

	// Stamp `hidden` on every non-active panel directly in the
	// emitted HTML. The client-side `<os-tabs>` syncs panel
	// visibility on `value` changes, but its initial sync runs
	// inside a microtask — and panel siblings may not have upgraded
	// in time on first paint. Setting the attribute server-side
	// makes first paint correct regardless of upgrade order; the JS
	// keeps owning subsequent transitions.
	foreach ( $tabs as $tab ) {
		if ( ! is_callable( $tab['template'] ) ) {
			continue;
		}
		$is_active = OPENSTATION_NATIVE_WINDOW_MAIN_TAB === $tab['value'];
		$buffer   .= sprintf(
			'<os-tabpanel for="%s"%s>',
			esc_attr( $tab['value'] ),
			$is_active ? '' : ' hidden'
		);
		ob_start();
		call_user_func( $tab['template'] );
		$buffer .= (string) ob_get_clean();
		$buffer .= '</os-tabpanel>';
	}

	$buffer .= '</os-stack>';
	return $buffer;
}

/**
 * Enqueue every registered native window's script when the shell
 * is active. Runs on `admin_enqueue_scripts` alongside the main
 * shell enqueue so ordering (shell → plugin scripts) is
 * deterministic.
 */
function openstation_enqueue_native_window_scripts() {
	if ( ! openstation_is_enabled() || openstation_is_chromeless_request() || openstation_is_classic_request() ) {
		return;
	}
	$registry = openstation_native_window_registry();
	if ( ! is_array( $registry ) ) {
		return;
	}
	foreach ( $registry as $entry ) {
		// Enqueue per-tab scripts — each tab registration can carry
		// its own script handle so a tab's JS module stays scoped to
		// that tab. Main tab uses the window's own `script`; it's
		// enqueued below alongside the localize call.
		$tabs = openstation_get_native_window_tabs( $entry['id'] );
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
			'openStationNativeWindow_' . str_replace( '-', '_', $entry['id'] ),
			array(
				'id'         => $entry['id'],
				'title'      => $entry['title'],
				'icon'       => $entry['icon'],
				'width'      => $entry['width'],
				'height'     => $entry['height'],
				'minWidth'   => $entry['min_width'],
				'minHeight'  => $entry['min_height'],
				'placement'  => $entry['placement'],
				'autofocus'  => $entry['autofocus'],
				'templateId' => 'os-native-window-' . $entry['id'],
				'tabs'       => array_map(
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

		// Bundle-bound `config`. Ships through
		// `wp_add_inline_script` `'before'` so it lands on the eager
		// path the same way `wp_localize_script` does, AND through
		// the lazy-load payload (see `openstation_resolve_script_payload`)
		// so the same data is available even when the script is
		// dynamically injected mid-session. The bundle reads it via
		// `wp.os.getWindowConfig( id )` or directly at
		// `window.openStationWindowConfig[ id ]`.
		if ( ! empty( $entry['config'] ) && is_array( $entry['config'] ) ) {
			wp_add_inline_script(
				$entry['script'],
				sprintf(
					'window.openStationWindowConfig=window.openStationWindowConfig||{};window.openStationWindowConfig[%s]=%s;',
					wp_json_encode( $entry['id'] ),
					wp_json_encode( $entry['config'] )
				),
				'before'
			);
		}
	}
}
add_action( 'admin_enqueue_scripts', 'openstation_enqueue_native_window_scripts', 20 );

/**
 * Emit a `<template>` tag for every registered native window on
 * `admin_footer` when the shell is active. The JS side resolves
 * these via `document.getElementById( `os-native-window-${id}` )`
 * and clones them into each opened window's body.
 */
function openstation_render_native_window_templates() {
	if ( ! openstation_is_enabled() || openstation_is_chromeless_request() || openstation_is_classic_request() ) {
		return;
	}
	$registry = openstation_native_window_registry();
	if ( ! is_array( $registry ) ) {
		return;
	}
	foreach ( $registry as $entry ) {
		if ( ! is_callable( $entry['template'] ) ) {
			continue;
		}
		$html = openstation_build_native_window_template_html( $entry );
		if ( '' === $html ) {
			continue;
		}
		printf(
			'<template id="os-native-window-%s">',
			esc_attr( $entry['id'] )
		);
		// `openstation_kses_native_window_template()` auto-extends
		// the allowlist with any `<os-*>` tag the template carries
		// — so plugin authors never have to remember to register
		// their custom component tags in the kses list.
		echo openstation_kses_native_window_template( $html ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- helper kses-escapes.
		echo '</template>';
	}
}
add_action( 'admin_footer', 'openstation_render_native_window_templates', 20 );
