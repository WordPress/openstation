<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_SESSION_META_KEY = 'desktop_mode_session';

function openstation_session_meta_key( $network = null ) {
	if ( null === $network ) {
		$network = is_multisite() && is_network_admin();
	}
	if ( $network ) {
		return OPENSTATION_SESSION_META_KEY . '_network';
	}
	return ! is_multisite() || get_current_blog_id() === get_main_site_id()
		? OPENSTATION_SESSION_META_KEY
		: OPENSTATION_SESSION_META_KEY . '_' . get_current_blog_id();
}

function openstation_session_url_in_scope( $url, $network ) {
	$path       = wp_parse_url( $url, PHP_URL_PATH );
	$in_network = is_string( $path ) && false !== strpos( $path, '/wp-admin/network/' );
	return $in_network === (bool) $network;
}

function openstation_session_window_url_ok( $url, $network ) {
	return openstation_url_is_same_admin( $url ) && openstation_session_url_in_scope( $url, $network );
}

const OPENSTATION_SESSION_MAX_WINDOWS = 32;

const OPENSTATION_SESSION_MAX_PARAMS = 12;

const OPENSTATION_SESSION_MAX_DESKTOPS = 16;

const OPENSTATION_SESSION_STATES = array( 'normal', 'minimized', 'maximized', 'fullscreen' );

function openstation_session_now_ms() {
	return (int) round( microtime( true ) * 1000 );
}

function openstation_default_desktop() {
	return array(
		'id'    => 'desktop-1',
		'label' => 'Workspace 1',
	);
}

function openstation_empty_session() {
	return array(
		'windows'       => array(),
		'desktops'      => array( openstation_default_desktop() ),
		'activeDesktop' => 'desktop-1',
		'focused'       => '',
		'updated'       => 0,
	);
}

function openstation_get_session( $user_id, $network = null ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return openstation_empty_session();
	}
	if ( null === $network ) {
		$network = is_multisite() && is_network_admin();
	}

	$raw = get_user_meta( $user_id, openstation_session_meta_key( $network ), true );
	if ( ! is_array( $raw ) ) {
		return openstation_empty_session();
	}

	$desktops       = isset( $raw['desktops'] ) && is_array( $raw['desktops'] )
		? array_values( $raw['desktops'] )
		: array( openstation_default_desktop() );
	$active_desktop = isset( $raw['activeDesktop'] ) ? (string) $raw['activeDesktop'] : 'desktop-1';

	$desktops = array_values(
		array_filter(
			$desktops,
			static function ( $d ) {
				return ! ( is_array( $d ) && isset( $d['scope'] ) );
			}
		)
	);
	if ( empty( $desktops ) ) {
		$desktops = array( openstation_default_desktop() );
	}
	$desktop_ids = array();
	foreach ( $desktops as $d ) {
		if ( is_array( $d ) && isset( $d['id'] ) ) {
			$desktop_ids[] = (string) $d['id'];
		}
	}
	if ( ! in_array( $active_desktop, $desktop_ids, true ) && ! empty( $desktop_ids ) ) {
		$active_desktop = $desktop_ids[0];
	}

	$windows = isset( $raw['windows'] ) && is_array( $raw['windows'] ) ? array_values( $raw['windows'] ) : array();
	$windows = array_values(
		array_filter(
			$windows,
			static function ( $win ) use ( $network ) {
				if ( ! is_array( $win ) || ! empty( $win['native'] ) ) {
					return true;
				}
				$url = isset( $win['url'] ) ? (string) $win['url'] : '';
				return openstation_session_window_url_ok( $url, $network );
			}
		)
	);

	return array(
		'windows'       => $windows,
		'desktops'      => $desktops,
		'activeDesktop' => $active_desktop,
		'focused'       => isset( $raw['focused'] ) ? (string) $raw['focused'] : '',
		'updated'       => isset( $raw['updated'] ) ? (int) $raw['updated'] : 0,
	);
}

function openstation_save_session( $user_id, $session, $network = null ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return false;
	}
	if ( null === $network ) {
		$network = is_multisite() && is_network_admin();
	}

	if ( is_array( $session ) && isset( $session['updated'] ) ) {
		$incoming = (int) $session['updated'];
		if ( $incoming > 0 ) {
			$existing = openstation_get_session( $user_id, $network );
			$stored   = isset( $existing['updated'] ) ? (int) $existing['updated'] : 0;
			if ( $incoming < $stored ) {

				return false;
			}
		}
	}

	$clean = openstation_sanitize_session( $session, $network );

	return false !== update_user_meta( $user_id, openstation_session_meta_key( $network ), $clean );
}

function openstation_clear_session( $user_id, $network = null ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return false;
	}
	return (bool) delete_user_meta( $user_id, openstation_session_meta_key( $network ) );
}

function openstation_sanitize_session( $session, $network = null ) {
	if ( null === $network ) {
		$network = is_multisite() && is_network_admin();
	}
	$clean = openstation_empty_session();

	if ( ! is_array( $session ) ) {
		$clean['updated'] = openstation_session_now_ms();
		return $clean;
	}

	$incoming_updated = isset( $session['updated'] ) ? (int) $session['updated'] : 0;
	$clean['updated'] = $incoming_updated > 0 ? $incoming_updated : openstation_session_now_ms();

	if ( isset( $session['focused'] ) && is_string( $session['focused'] ) ) {
		$clean['focused'] = sanitize_key( $session['focused'] );
	}

	$desktop_ids = array();
	if ( isset( $session['desktops'] ) && is_array( $session['desktops'] ) ) {
		$clean_desktops = array();
		foreach ( $session['desktops'] as $d ) {
			if ( ! is_array( $d ) ) {
				continue;
			}
			$d_id = isset( $d['id'] ) ? sanitize_key( (string) $d['id'] ) : '';
			if ( '' === $d_id ) {
				continue;
			}
			$d_label = isset( $d['label'] ) ? wp_strip_all_tags( (string) $d['label'] ) : '';
			if ( '' === $d_label ) {
				$d_label = $d_id;
			}

			if ( strlen( $d_label ) > 64 ) {
				$d_label = substr( $d_label, 0, 64 );
			}
			$entry = array(
				'id'    => $d_id,
				'label' => $d_label,
			);

			$profile = openstation_sanitize_workspace_profile( isset( $d['profile'] ) ? $d['profile'] : null );
			if ( null !== $profile ) {
				$entry['profile'] = $profile;
			}
			$clean_desktops[] = $entry;
			$desktop_ids[]    = $d_id;
			if ( count( $clean_desktops ) >= OPENSTATION_SESSION_MAX_DESKTOPS ) {
				break;
			}
		}
		if ( ! empty( $clean_desktops ) ) {
			$clean['desktops'] = $clean_desktops;
		}
	}

	if ( empty( $clean['desktops'] ) ) {
		$clean['desktops'] = array( openstation_default_desktop() );
	}
	if ( empty( $desktop_ids ) ) {

		$desktop_ids = array_map(
			static function ( $d ) {
				return isset( $d['id'] ) ? (string) $d['id'] : '';
			},
			$clean['desktops']
		);
		$desktop_ids = array_values( array_filter( $desktop_ids ) );
		if ( empty( $desktop_ids ) ) {
			$desktop_ids = array( 'desktop-1' );
		}
	}

	if ( isset( $session['activeDesktop'] ) && is_string( $session['activeDesktop'] ) ) {
		$candidate = sanitize_key( $session['activeDesktop'] );
		if ( in_array( $candidate, $desktop_ids, true ) ) {
			$clean['activeDesktop'] = $candidate;
		}
	}

	if ( ! in_array( $clean['activeDesktop'], $desktop_ids, true ) ) {
		$clean['activeDesktop'] = $desktop_ids[0];
	}

	if ( isset( $session['windows'] ) && is_array( $session['windows'] ) ) {
		foreach ( $session['windows'] as $win ) {
			if ( ! is_array( $win ) ) {
				continue;
			}

			$id = isset( $win['id'] ) ? sanitize_key( (string) $win['id'] ) : '';
			if ( '' === $id ) {
				continue;
			}

			$base_id = isset( $win['baseId'] ) ? sanitize_key( (string) $win['baseId'] ) : '';
			if ( '' === $base_id ) {
				$base_id = $id;
			}

			$win_desktop = isset( $win['desktopId'] ) ? sanitize_key( (string) $win['desktopId'] ) : '';
			if ( '' === $win_desktop || ! in_array( $win_desktop, $desktop_ids, true ) ) {
				$win_desktop = $clean['activeDesktop'];
			}

			$is_native = ! empty( $win['native'] );

			if ( $is_native ) {
				$url = '#' . $id;
			} else {
				$url = isset( $win['url'] ) ? esc_url_raw( (string) $win['url'] ) : '';

				if ( '' === $url || ! openstation_session_window_url_ok( $url, $network ) ) {
					continue;
				}

				$url = remove_query_arg(
					array( 'openstation_chromeless', OPENSTATION_PORTAL_FLAG, OPENSTATION_CLASSIC_FLAG ),
					$url
				);
			}

			$state = isset( $win['state'] ) ? (string) $win['state'] : 'normal';
			if ( ! in_array( $state, OPENSTATION_SESSION_STATES, true ) ) {
				$state = 'normal';
			}

			$entry = array(
				'id'        => $id,
				'baseId'    => $base_id,
				'desktopId' => $win_desktop,
				'url'       => $url,
				'title'     => isset( $win['title'] ) ? wp_strip_all_tags( (string) $win['title'] ) : '',
				'icon'      => isset( $win['icon'] ) ? sanitize_html_class( (string) $win['icon'] ) : 'dashicons-admin-generic',
				'state'     => $state,
				'x'         => openstation_sanitize_session_dimension( $win['x'] ?? 0, -10000, 10000 ),
				'y'         => openstation_sanitize_session_dimension( $win['y'] ?? 0, -10000, 10000 ),
				'width'     => openstation_sanitize_session_dimension( $win['width'] ?? 800, 0, 20000 ),
				'height'    => openstation_sanitize_session_dimension( $win['height'] ?? 600, 0, 20000 ),
			);

			$grid_span = openstation_sanitize_session_grid_span( $win['gridSpan'] ?? null );
			if ( null !== $grid_span ) {
				$entry['gridSpan'] = $grid_span;
			}

			if ( ! empty( $win['unplaced'] ) ) {
				$entry['unplaced'] = true;
			}

			if ( $is_native ) {
				$entry['native'] = true;

				$params = openstation_sanitize_session_params( $win['params'] ?? null );
				if ( ! empty( $params ) ) {
					$entry['params'] = $params;
				}
			}

			if ( isset( $win['externalTabs'] ) && is_array( $win['externalTabs'] ) ) {
				$tabs = array();
				foreach ( $win['externalTabs'] as $tab ) {
					if ( ! is_array( $tab ) ) {
						continue;
					}
					$tab_url = isset( $tab['url'] ) ? esc_url_raw( (string) $tab['url'], array( 'http', 'https' ) ) : '';
					if ( '' === $tab_url ) {
						continue;
					}

					if ( strlen( $tab_url ) > 2048 ) {
						continue;
					}
					$label = isset( $tab['label'] ) ? wp_strip_all_tags( (string) $tab['label'] ) : '';

					if ( strlen( $label ) > 80 ) {
						$label = substr( $label, 0, 80 );
					}
					$tabs[] = array(
						'url'   => $tab_url,
						'label' => $label,
					);
					if ( count( $tabs ) >= 16 ) {
						break;
					}
				}
				if ( ! empty( $tabs ) ) {
					$entry['externalTabs'] = $tabs;
				}
			}

			$clean['windows'][] = $entry;

			if ( count( $clean['windows'] ) >= OPENSTATION_SESSION_MAX_WINDOWS ) {
				break;
			}
		}
	}

	return $clean;
}

function openstation_sanitize_session_dimension( $value, $min, $max ) {
	if ( is_string( $value ) ) {
		$value = trim( $value );
	}
	if ( ! is_numeric( $value ) ) {
		return (int) $min;
	}
	$value = (int) $value;
	if ( $value < $min ) {
		return (int) $min;
	}
	if ( $value > $max ) {
		return (int) $max;
	}
	return $value;
}

function openstation_sanitize_session_grid_span( $raw ) {
	if ( ! is_array( $raw ) || ! isset( $raw['anchor'], $raw['cursor'], $raw['cols'], $raw['rows'] ) ) {
		return null;
	}
	$int = static function ( $value ) {
		return is_int( $value ) || ( is_numeric( $value ) && (string) (int) $value === (string) $value ) ? (int) $value : null;
	};
	$cols = $int( $raw['cols'] );
	$rows = $int( $raw['rows'] );
	if ( null === $cols || null === $rows || $cols < 1 || $rows < 1 || $cols > 24 || $rows > 24 ) {
		return null;
	}
	$cell = static function ( $c ) use ( $int, $cols, $rows ) {
		if ( ! is_array( $c ) || ! isset( $c['col'], $c['row'] ) ) {
			return null;
		}
		$col = $int( $c['col'] );
		$row = $int( $c['row'] );
		if ( null === $col || null === $row || $col < 0 || $row < 0 || $col >= $cols || $row >= $rows ) {
			return null;
		}
		return array(
			'col' => $col,
			'row' => $row,
		);
	};
	$anchor = $cell( $raw['anchor'] );
	$cursor = $cell( $raw['cursor'] );
	if ( null === $anchor || null === $cursor ) {
		return null;
	}
	return array(
		'anchor' => $anchor,
		'cursor' => $cursor,
		'cols'   => $cols,
		'rows'   => $rows,
	);
}

function openstation_sanitize_session_params( $params ) {
	if ( ! is_array( $params ) ) {
		return array();
	}

	$clean = array();
	foreach ( $params as $key => $value ) {
		if ( count( $clean ) >= OPENSTATION_SESSION_MAX_PARAMS ) {
			break;
		}
		$key = substr( preg_replace( '/[^A-Za-z0-9_-]/', '', (string) $key ), 0, 64 );
		if ( '' === $key ) {
			continue;
		}
		if ( is_bool( $value ) ) {
			$clean[ $key ] = $value;
			continue;
		}
		if ( is_int( $value ) || is_float( $value ) ) {
			if ( is_finite( (float) $value ) ) {
				$clean[ $key ] = $value + 0;
			}
			continue;
		}
		if ( is_string( $value ) ) {

			$clean[ $key ] = substr( sanitize_text_field( $value ), 0, 256 );
		}
	}

	return $clean;
}

function openstation_register_session_rest_routes() {

	$network_arg = array(
		'network' => array(
			'type'    => 'boolean',
			'default' => false,
		),
	);
	register_rest_route(
		'desktop-mode/v1',
		'/session',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => 'openstation_rest_get_session',
				'permission_callback' => 'openstation_rest_session_permission',
				'args'                => $network_arg,
			),
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => 'openstation_rest_save_session',
				'permission_callback' => 'openstation_rest_session_permission',
				'args'                => array_merge(
					array(
						'session' => array(
							'required' => true,
							'type'     => 'object',
						),
					),
					$network_arg
				),
			),
			array(
				'methods'             => WP_REST_Server::DELETABLE,
				'callback'            => 'openstation_rest_clear_session',
				'permission_callback' => 'openstation_rest_session_permission',
				'args'                => $network_arg,
			),
		)
	);
}
add_action( 'rest_api_init', 'openstation_register_session_rest_routes' );

function openstation_rest_session_permission() {
	return openstation_rest_require_enabled();
}

function openstation_rest_session_network( WP_REST_Request $request ) {
	return is_multisite()
		&& rest_sanitize_boolean( $request->get_param( 'network' ) )
		&& current_user_can( 'manage_network' );
}

function openstation_rest_get_session( WP_REST_Request $request ) {
	return rest_ensure_response(
		openstation_get_session( get_current_user_id(), openstation_rest_session_network( $request ) )
	);
}

function openstation_rest_save_session( WP_REST_Request $request ) {
	$user_id = get_current_user_id();
	$payload = $request->get_param( 'session' );
	$network = openstation_rest_session_network( $request );
	openstation_save_session( $user_id, $payload, $network );
	return rest_ensure_response( openstation_get_session( $user_id, $network ) );
}

function openstation_rest_clear_session( WP_REST_Request $request ) {
	openstation_clear_session( get_current_user_id(), openstation_rest_session_network( $request ) );
	return rest_ensure_response( openstation_empty_session() );
}
