<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_WORKSPACE_MAX_APPS = 128;

const OPENSTATION_WORKSPACE_MAX_WIDGETS = 32;

const OPENSTATION_WORKSPACE_APPEARANCE_MAX_DEPTH = 2;

const OPENSTATION_WORKSPACE_MAX_WINDOWS = 12;

const OPENSTATION_WORKSPACE_LAYOUTS = array( 'free', 'cascade', 'tile', 'columns', 'focus' );

const OPENSTATION_WORKSPACE_APPEARANCE_KEYS = array(
	'wallpaper',
	'wallpaperSettings',
	'customGradient',
	'customImage',
	'accent',
	'customAccent',
	'desktopTheme',
	'desktopLayout',
	'dockPlacement',
	'dockSize',
	'dockBehavior',
	'sideDockBehavior',
	'windowRadius',
	'windowReveal',
	'unfocusEffect',
	'adminBarMode',
);

function openstation_workspace_presets() {
	$presets = array(
		array(
			'id'          => 'commerce',
			'label'       => __( 'Commerce', 'desktop-mode' ),
			'description' => __( 'A shop floor. WooCommerce orders, products and analytics side by side; everything that is not commerce leaves the rails.', 'desktop-mode' ),
			'icon'        => 'dashicons-cart',
			'color'       => '#7f54b3',
			'layout'      => 'columns',
			'order'       => 10,
			'requires'    => array( 'woocommerce/woocommerce.php' ),
		),
		array(
			'id'          => 'learning',
			'label'       => __( 'Learning', 'desktop-mode' ),
			'description' => __( 'A course studio. Sensei courses, lessons and learners tiled together, so moving between them is a glance rather than a navigation.', 'desktop-mode' ),
			'icon'        => 'dashicons-welcome-learn-more',
			'color'       => '#43a047',
			'layout'      => 'tile',
			'order'       => 20,
			'requires'    => array( 'sensei-lms/sensei-lms.php' ),
		),
		array(
			'id'          => 'publishing',
			'label'       => __( 'Publishing', 'desktop-mode' ),
			'description' => __( 'A writing desk. A blank page takes two thirds of the screen, the library sits in the margin, and the rest of the admin is somewhere else.', 'desktop-mode' ),
			'icon'        => 'dashicons-edit-page',
			'color'       => '#c8102e',
			'layout'      => 'focus',
			'order'       => 30,
		),
	);

	$presets = apply_filters( 'openstation_workspace_presets', $presets );

	if ( ! is_array( $presets ) ) {
		return array();
	}

	$clean = array();
	foreach ( $presets as $preset ) {
		if ( ! openstation_workspace_preset_requirements_met( $preset ) ) {
			continue;
		}
		$entry = openstation_sanitize_workspace_preset( $preset );
		if ( null !== $entry ) {
			$clean[] = $entry;
		}
	}
	return $clean;
}

function openstation_workspace_preset_requirements_met( $preset ) {
	if ( ! is_array( $preset ) || empty( $preset['requires'] ) || ! is_array( $preset['requires'] ) ) {
		return true;
	}
	if ( ! function_exists( 'is_plugin_active' ) ) {
		require_once ABSPATH . 'wp-admin/includes/plugin.php';
	}
	foreach ( $preset['requires'] as $plugin ) {
		if ( ! is_string( $plugin ) ) {
			continue;
		}

		$plugin = str_replace( '..', '', substr( preg_replace( '#[^A-Za-z0-9_./-]#', '', $plugin ), 0, 256 ) );
		if ( '' === $plugin || ! is_plugin_active( $plugin ) ) {
			return false;
		}
	}
	return true;
}

function openstation_sanitize_workspace_place( $raw ) {
	if ( ! is_array( $raw ) ) {
		return null;
	}
	$out = array();
	foreach ( array( 'x', 'y', 'width', 'height' ) as $key ) {
		if ( ! isset( $raw[ $key ] ) || ! is_numeric( $raw[ $key ] ) ) {
			return null;
		}
		$v = (float) $raw[ $key ];
		if ( ! is_finite( $v ) ) {
			return null;
		}
		$out[ $key ] = round( max( 0.0, min( 1.0, $v ) ), 4 );
	}
	if ( $out['width'] < 0.05 || $out['height'] < 0.05 ) {
		return null;
	}
	return $out;
}

function openstation_sanitize_workspace_appearance( $raw ) {
	if ( ! is_array( $raw ) ) {
		return array();
	}
	$clean = array();
	foreach ( OPENSTATION_WORKSPACE_APPEARANCE_KEYS as $key ) {
		if ( ! array_key_exists( $key, $raw ) ) {
			continue;
		}
		$value = $raw[ $key ];
		if ( is_scalar( $value ) || null === $value ) {
			$clean[ $key ] = is_string( $value ) ? substr( wp_strip_all_tags( $value ), 0, 512 ) : $value;
			continue;
		}
		if ( is_array( $value ) ) {
			$clean[ $key ] = openstation_sanitize_workspace_appearance_branch(
				$value,
				OPENSTATION_WORKSPACE_APPEARANCE_MAX_DEPTH
			);
		}
	}
	return $clean;
}

function openstation_sanitize_workspace_appearance_branch( $value, $depth ) {
	$out = array();
	foreach ( $value as $key => $item ) {
		$key = substr( preg_replace( '#[^A-Za-z0-9_/.-]#', '', (string) $key ), 0, 128 );
		if ( '' === $key ) {
			continue;
		}
		if ( is_scalar( $item ) || null === $item ) {
			$out[ $key ] = is_string( $item ) ? substr( wp_strip_all_tags( $item ), 0, 512 ) : $item;
			continue;
		}
		if ( is_array( $item ) && $depth > 1 ) {
			$out[ $key ] = openstation_sanitize_workspace_appearance_branch( $item, $depth - 1 );
		}
	}
	return $out;
}

function openstation_sanitize_workspace_preset( $raw ) {
	if ( ! is_array( $raw ) ) {
		return null;
	}
	$id = isset( $raw['id'] ) ? sanitize_key( (string) $raw['id'] ) : '';
	if ( '' === $id ) {
		return null;
	}

	$layout = isset( $raw['layout'] ) ? (string) $raw['layout'] : 'free';
	if ( ! in_array( $layout, OPENSTATION_WORKSPACE_LAYOUTS, true ) ) {
		$layout = 'free';
	}

	$label = isset( $raw['label'] ) ? wp_strip_all_tags( (string) $raw['label'] ) : '';
	$color = isset( $raw['color'] ) ? sanitize_hex_color( (string) $raw['color'] ) : '';

	$apps = array();
	if ( isset( $raw['apps'] ) && is_array( $raw['apps'] ) ) {
		foreach ( $raw['apps'] as $token ) {
			if ( ! is_string( $token ) ) {
				continue;
			}
			$token = substr( sanitize_text_field( $token ), 0, 128 );
			if ( '' !== $token ) {
				$apps[] = $token;
			}
			if ( count( $apps ) >= OPENSTATION_WORKSPACE_MAX_APPS ) {
				break;
			}
		}
	}

	$widgets = array();
	if ( isset( $raw['widgets'] ) && is_array( $raw['widgets'] ) ) {
		foreach ( $raw['widgets'] as $id ) {
			if ( ! is_string( $id ) ) {
				continue;
			}

			$id = substr( preg_replace( '#[^A-Za-z0-9_/-]#', '', $id ), 0, 128 );
			if ( '' !== $id ) {
				$widgets[] = $id;
			}
			if ( count( $widgets ) >= OPENSTATION_WORKSPACE_MAX_WIDGETS ) {
				break;
			}
		}
	}

	$windows = array();
	if ( isset( $raw['windows'] ) && is_array( $raw['windows'] ) ) {
		foreach ( $raw['windows'] as $win ) {
			if ( ! is_array( $win ) ) {
				continue;
			}
			$match = isset( $win['match'] ) ? substr( sanitize_text_field( (string) $win['match'] ), 0, 128 ) : '';
			if ( '' === $match ) {
				continue;
			}
			$entry = array( 'match' => $match );
			if ( isset( $win['url'] ) && is_string( $win['url'] ) ) {
				$url = substr( wp_strip_all_tags( $win['url'] ), 0, 512 );
				if ( '' !== $url ) {
					$entry['url'] = $url;
				}
			}
			if ( isset( $win['title'] ) && is_string( $win['title'] ) ) {
				$title = substr( wp_strip_all_tags( $win['title'] ), 0, 128 );
				if ( '' !== $title ) {
					$entry['title'] = $title;
				}
			}
			$windows[] = $entry;
			if ( count( $windows ) >= OPENSTATION_WORKSPACE_MAX_WINDOWS ) {
				break;
			}
		}
	}

	return array(
		'appearance'  => openstation_sanitize_workspace_appearance( isset( $raw['appearance'] ) ? $raw['appearance'] : null ),
		'id'          => $id,
		'label'       => '' !== $label ? $label : $id,
		'description' => isset( $raw['description'] ) ? wp_strip_all_tags( (string) $raw['description'] ) : '',
		'icon'        => isset( $raw['icon'] ) ? sanitize_html_class( (string) $raw['icon'] ) : 'dashicons-desktop',
		'color'       => $color ? $color : '',
		'apps'        => $apps,
		'widgets'     => $widgets,
		'windows'     => $windows,
		'layout'      => $layout,
		'order'       => isset( $raw['order'] ) ? (int) $raw['order'] : 0,
	);
}

function openstation_sanitize_workspace_profile( $raw ) {
	if ( ! is_array( $raw ) ) {
		return null;
	}

	$layout = isset( $raw['layout'] ) ? (string) $raw['layout'] : 'free';
	if ( ! in_array( $layout, OPENSTATION_WORKSPACE_LAYOUTS, true ) ) {
		$layout = 'free';
	}

	$color = isset( $raw['color'] ) ? sanitize_hex_color( (string) $raw['color'] ) : '';

	$mode = 'all';
	$ids  = array();
	if ( isset( $raw['apps'] ) && is_array( $raw['apps'] ) ) {
		if ( isset( $raw['apps']['mode'] ) && 'only' === $raw['apps']['mode'] ) {
			$mode = 'only';
		}
		if ( isset( $raw['apps']['ids'] ) && is_array( $raw['apps']['ids'] ) ) {
			foreach ( $raw['apps']['ids'] as $id ) {
				if ( ! is_string( $id ) && ! is_numeric( $id ) ) {
					continue;
				}

				$id = substr( preg_replace( '/[^A-Za-z0-9_\-]/', '', (string) $id ), 0, 128 );
				if ( '' === $id ) {
					continue;
				}
				$ids[] = $id;
				if ( count( $ids ) >= OPENSTATION_WORKSPACE_MAX_APPS ) {
					break;
				}
			}
		}
	}

	$widget_mode = 'all';
	$widget_ids  = array();
	if ( isset( $raw['widgets'] ) && is_array( $raw['widgets'] ) ) {
		if ( isset( $raw['widgets']['mode'] ) && 'only' === $raw['widgets']['mode'] ) {
			$widget_mode = 'only';
		}
		if ( isset( $raw['widgets']['ids'] ) && is_array( $raw['widgets']['ids'] ) ) {
			foreach ( $raw['widgets']['ids'] as $id ) {
				if ( ! is_string( $id ) ) {
					continue;
				}

				$id = substr( preg_replace( '#[^A-Za-z0-9_/-]#', '', $id ), 0, 128 );
				if ( '' === $id ) {
					continue;
				}
				$widget_ids[] = $id;
				if ( count( $widget_ids ) >= OPENSTATION_WORKSPACE_MAX_WIDGETS ) {
					break;
				}
			}
		}
	}

	$windows = array();
	if ( isset( $raw['windows'] ) && is_array( $raw['windows'] ) ) {
		foreach ( $raw['windows'] as $win ) {
			if ( ! is_array( $win ) ) {
				continue;
			}
			$match = isset( $win['match'] ) ? sanitize_text_field( (string) $win['match'] ) : '';
			if ( '' === $match ) {
				continue;
			}
			$entry = array( 'match' => substr( $match, 0, 128 ) );
			if ( isset( $win['url'] ) && is_string( $win['url'] ) ) {

				$url = substr( wp_strip_all_tags( $win['url'] ), 0, 512 );
				if ( '' !== $url ) {
					$entry['url'] = $url;
				}
			}
			if ( isset( $win['title'] ) && is_string( $win['title'] ) ) {
				$title = substr( wp_strip_all_tags( $win['title'] ), 0, 128 );
				if ( '' !== $title ) {
					$entry['title'] = $title;
				}
			}

			$grid_span = openstation_sanitize_session_grid_span( $win['gridSpan'] ?? null );
			if ( null !== $grid_span ) {
				$entry['gridSpan'] = $grid_span;
			}
			$place = openstation_sanitize_workspace_place( $win['place'] ?? null );
			if ( null !== $place ) {
				$entry['place'] = $place;
			}
			$windows[] = $entry;
			if ( count( $windows ) >= OPENSTATION_WORKSPACE_MAX_WINDOWS ) {
				break;
			}
		}
	}

	return array(
		'appearance'  => openstation_sanitize_workspace_appearance( isset( $raw['appearance'] ) ? $raw['appearance'] : null ),
		'preset'      => isset( $raw['preset'] ) ? substr( sanitize_key( (string) $raw['preset'] ), 0, 64 ) : '',
		'icon'        => isset( $raw['icon'] ) ? sanitize_html_class( (string) $raw['icon'] ) : 'dashicons-desktop',
		'color'       => $color ? $color : '',
		'apps'        => array(
			'mode' => $mode,
			'ids'  => $ids,
		),
		'widgets'     => array(
			'mode' => $widget_mode,
			'ids'  => $widget_ids,
		),
		'windows'     => $windows,
		'layout'      => $layout,

		'provisioned' => ! empty( $raw['provisioned'] ),
	);
}
