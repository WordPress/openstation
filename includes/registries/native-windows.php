<?php

defined( 'ABSPATH' ) || exit;

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
		'scripts'          => array(),
		'styles'           => array(),
		'preload_script'   => false,

		'style'            => '',
		'width'            => 520,
		'height'           => 400,
		'min_width'        => 280,
		'min_height'       => 220,
		'placement'        => 'dock',
		'admin'            => 'site',
		'nav_kind'         => 'app',
		'dock_order'       => 0,
		'placeable'        => false,
		'capabilities'     => array(),
		'autofocus'        => false,
		'main_tab_label'   => '',
		'main_tab_padding' => '',

		'menu_pages'       => array(),
		'config'           => array(),
	);
	$args     = wp_parse_args( $args, $defaults );
	if ( ! in_array( $args['admin'], array( 'site', 'network', 'any' ), true ) ) {
		$args['admin'] = 'site';
	}

	foreach ( (array) $args['capabilities'] as $cap ) {
		if ( ! current_user_can( (string) $cap ) ) {
			return openstation_registration_error(
				'openstation_capability_denied',
				sprintf(

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

	$nav_kind = in_array( $args['nav_kind'], array( 'app', 'control' ), true )
		? $args['nav_kind']
		: 'app';

	$entry = array(
		'id'               => $id,
		'title'            => (string) $args['title'],
		'icon'             => (string) $args['icon'],
		'template'         => $args['template'],
		'script'           => (string) $args['script'],

		'scripts'          => array_values(
			array_unique(
				array_filter(
					array_map( 'strval', (array) $args['scripts'] ),
					static function ( $handle ) {
						return '' !== $handle;
					}
				)
			)
		),

		'styles'           => array_values(
			array_unique(
				array_filter(
					array_map( 'strval', (array) $args['styles'] ),
					static function ( $handle ) {
						return '' !== $handle;
					}
				)
			)
		),
		'preload_script'   => (bool) $args['preload_script'],
		'style'            => (string) $args['style'],
		'width'            => (int) $args['width'],
		'height'           => (int) $args['height'],
		'min_width'        => (int) $args['min_width'],
		'min_height'       => (int) $args['min_height'],
		'placement'        => $placement,
		'nav_kind'         => $nav_kind,

		'admin'            => $args['admin'],

		'dock_order'       => (int) $args['dock_order'],
		'placeable'        => (bool) $args['placeable'],
		'autofocus'        => $args['autofocus'],
		'main_tab_label'   => (string) $args['main_tab_label'],

		'main_tab_padding' => $args['main_tab_padding'],

		'menu_pages'       => is_array( $args['menu_pages'] ) ? array_values( $args['menu_pages'] ) : array(),
		'config'           => is_array( $args['config'] ) ? $args['config'] : array(),
	);
	openstation_native_window_registry( $id, $entry );

	do_action( 'openstation_native_window_registered', $id, $entry );

	return true;
}

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

		'aria-label'      => true,
		'aria-labelledby' => true,
		'aria-current'    => true,
		'aria-hidden'     => true,

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
			'empty'          => true,
			'columns'        => true,
			'rows'           => true,
			'sortable'       => true,
			'expandable'     => true,
			'preset'         => true,
			'label'          => true,
			'heading'        => true,
			'description'    => true,
			'orientation'    => true,
			'level'          => true,
			'collapsed'      => true,

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

	foreach ( $allowed as $tag => $attrs ) {
		if ( is_array( $attrs ) ) {
			$allowed[ $tag ] = array_merge( $attrs, $global_attrs );
		}
	}

	return (array) apply_filters( 'openstation_native_window_allowed_html', $allowed );
}

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

function openstation_build_native_window_template_html( $entry ) {
	if ( ! is_array( $entry ) || ! is_callable( $entry['template'] ) ) {
		return '';
	}

	$tabs       = openstation_get_native_window_tabs( $entry['id'] );
	$has_extras = count( $tabs ) > 1;

	if ( ! $has_extras ) {
		ob_start();
		call_user_func( $entry['template'] );
		return (string) ob_get_clean();
	}

	$default_padding = isset( $entry['main_tab_padding'] )
		&& '' !== (string) $entry['main_tab_padding']
		? (int) $entry['main_tab_padding']
		: 16;

	$padding = (int) apply_filters(
		'openstation_native_window_tab_wrap_padding',
		$default_padding,
		(string) $entry['id']
	);
	if ( $padding < 0 ) {
		$padding = 0;
	}

	$buffer = sprintf(
		'<os-stack gap="12" padding="%d">',
		$padding
	);

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

function openstation_filter_native_window_config( $entry ) {
	$config = isset( $entry['config'] ) && is_array( $entry['config'] )
		? $entry['config']
		: array();

	$config = apply_filters( 'openstation_native_window_config', $config, (string) $entry['id'] );

	return is_array( $config ) ? $config : array();
}

function openstation_enqueue_native_window_scripts() {
	if ( ! openstation_is_shell_request() ) {
		return;
	}
	$registry = openstation_native_window_registry();
	if ( ! is_array( $registry ) ) {
		return;
	}
	foreach ( $registry as $entry ) {
		$preload = ! empty( $entry['preload_script'] );

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
		if ( $preload ) {
			wp_enqueue_script( $entry['script'] );
			foreach ( (array) $entry['scripts'] as $companion ) {
				wp_enqueue_script( $companion );
			}

			if ( ! empty( $entry['styles'] ) ) {
				foreach ( (array) $entry['styles'] as $companion_style ) {
					wp_enqueue_style( $companion_style );
				}
			}
		}

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

		$config = openstation_filter_native_window_config( $entry );
		if ( $preload && ! empty( $config ) ) {
			wp_add_inline_script(
				$entry['script'],
				sprintf(
					'window.openStationWindowConfig=window.openStationWindowConfig||{};window.openStationWindowConfig[%s]=%s;',
					wp_json_encode( $entry['id'] ),
					wp_json_encode( $config )
				),
				'before'
			);
		}
	}
}
add_action( 'admin_enqueue_scripts', 'openstation_enqueue_native_window_scripts', 5 );

function openstation_render_native_window_templates() {
	if ( ! openstation_is_shell_request() ) {
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

		echo openstation_kses_native_window_template( $html );
		echo '</template>';
	}
}
add_action( 'admin_footer', 'openstation_render_native_window_templates', 20 );

function openstation_native_window_offered_here( $entry ) {
	$admin = isset( $entry['admin'] ) ? (string) $entry['admin'] : 'site';
	if ( 'any' === $admin ) {
		return true;
	}
	return is_network_admin() ? 'network' === $admin : 'site' === $admin;
}
