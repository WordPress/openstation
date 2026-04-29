<?php
/**
 * Desktop Mode - Cron Manager store helpers.
 *
 * Thin wrappers around WordPress' cron array and scheduling APIs. The
 * client never mutates `_get_cron_array()` directly; every change goes
 * through these helpers so identity matching, custom schedules, and
 * REST responses stay consistent.
 *
 * @package WPDesktopMode
 * @since   0.22.0
 */

defined( 'ABSPATH' ) || exit;

const WPDM_CRON_MANAGER_CUSTOM_SCHEDULES_OPTION = 'desktop_mode_cron_custom_schedules';

/**
 * Whether the current user may use the Cron Manager.
 *
 * @since 0.22.0
 *
 * @return bool
 */
function wpdm_cron_manager_user_can_use() {
	$can = current_user_can( 'manage_options' );

	/**
	 * Filter whether the current user can see/use the Cron Manager.
	 *
	 * @since 0.22.0
	 *
	 * @param bool $can Default: manage_options capability.
	 */
	return (bool) apply_filters( 'wp_desktop_cron_manager_user_can_use', $can );
}

/**
 * Return sanitized custom schedule definitions stored by this module.
 *
 * @since 0.22.0
 *
 * @return array<string, array{interval:int, display:string}>
 */
function wpdm_cron_manager_get_custom_schedules() {
	$raw = get_option( WPDM_CRON_MANAGER_CUSTOM_SCHEDULES_OPTION, array() );
	if ( ! is_array( $raw ) ) {
		return array();
	}

	$out = array();
	foreach ( $raw as $slug => $entry ) {
		$slug = sanitize_key( (string) $slug );
		if ( '' === $slug || ! is_array( $entry ) ) {
			continue;
		}
		$interval = isset( $entry['interval'] ) ? absint( $entry['interval'] ) : 0;
		if ( $interval <= 0 ) {
			continue;
		}
		$display = isset( $entry['display'] ) && '' !== (string) $entry['display']
			? sanitize_text_field( (string) $entry['display'] )
			: sprintf(
				/* translators: %d: interval in seconds. */
				__( 'Every %d seconds', 'desktop-mode' ),
				$interval
			);
		$out[ $slug ] = array(
			'interval' => $interval,
			'display'  => $display,
		);
	}

	return $out;
}

/**
 * Save or update a custom cron interval.
 *
 * @since 0.22.0
 *
 * @param string $slug     Schedule slug.
 * @param int    $interval Interval in seconds.
 * @param string $display  Display label.
 * @return string|WP_Error Sanitized slug on success.
 */
function wpdm_cron_manager_save_custom_schedule( $slug, $interval, $display = '' ) {
	$slug     = sanitize_key( (string) $slug );
	$interval = absint( $interval );
	$display  = sanitize_text_field( (string) $display );

	if ( '' === $slug ) {
		return new WP_Error(
			'wpdm_cron_invalid_schedule_slug',
			__( 'Custom schedule slug is required.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	if ( $interval <= 0 ) {
		return new WP_Error(
			'wpdm_cron_invalid_interval',
			__( 'Custom schedule interval must be greater than zero seconds.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$existing = wp_get_schedules();
	$custom   = wpdm_cron_manager_get_custom_schedules();
	if ( isset( $existing[ $slug ] ) && ! isset( $custom[ $slug ] ) ) {
		return new WP_Error(
			'wpdm_cron_schedule_exists',
			__( 'That schedule slug is already registered by WordPress or another plugin.', 'desktop-mode' ),
			array( 'status' => 409 )
		);
	}

	if ( '' === $display ) {
		$display = sprintf(
			/* translators: %d: interval in seconds. */
			__( 'Every %d seconds', 'desktop-mode' ),
			$interval
		);
	}

	$custom[ $slug ] = array(
		'interval' => $interval,
		'display'  => $display,
	);
	update_option( WPDM_CRON_MANAGER_CUSTOM_SCHEDULES_OPTION, $custom, false );

	return $slug;
}

/**
 * Add this module's persisted custom intervals to WordPress' schedule map.
 *
 * @since 0.22.0
 *
 * @param array $schedules Cron schedules.
 * @return array
 */
function wpdm_cron_manager_register_custom_schedules( $schedules ) {
	if ( ! is_array( $schedules ) ) {
		$schedules = array();
	}

	foreach ( wpdm_cron_manager_get_custom_schedules() as $slug => $entry ) {
		$schedules[ $slug ] = array(
			'interval' => (int) $entry['interval'],
			'display'  => (string) $entry['display'],
		);
	}

	return $schedules;
}
add_filter( 'cron_schedules', 'wpdm_cron_manager_register_custom_schedules' );

/**
 * Return the cron schedule list in a client-friendly shape.
 *
 * @since 0.22.0
 *
 * @return array<int, array{slug:string, interval:int, display:string, custom:bool}>
 */
function wpdm_cron_manager_get_schedules_payload() {
	$schedules = wp_get_schedules();
	$custom    = wpdm_cron_manager_get_custom_schedules();
	$out       = array();

	foreach ( $schedules as $slug => $entry ) {
		if ( ! is_array( $entry ) || empty( $entry['interval'] ) ) {
			continue;
		}
		$out[] = array(
			'slug'     => (string) $slug,
			'interval' => (int) $entry['interval'],
			'display'  => isset( $entry['display'] ) ? (string) $entry['display'] : (string) $slug,
			'custom'   => isset( $custom[ $slug ] ),
		);
	}

	usort(
		$out,
		static function ( $a, $b ) {
			if ( $a['interval'] === $b['interval'] ) {
				return strcmp( $a['slug'], $b['slug'] );
			}
			return $a['interval'] < $b['interval'] ? -1 : 1;
		}
	);

	return $out;
}

/**
 * Validate a cron hook name without over-sanitizing existing hooks.
 *
 * @since 0.22.0
 *
 * @param mixed $hook Raw hook.
 * @return string|WP_Error
 */
function wpdm_cron_manager_normalize_hook( $hook ) {
	$hook = trim( (string) $hook );
	if ( '' === $hook ) {
		return new WP_Error(
			'wpdm_cron_missing_hook',
			__( 'Cron hook is required.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	if ( strlen( $hook ) > 191 ) {
		return new WP_Error(
			'wpdm_cron_hook_too_long',
			__( 'Cron hook is too long.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	if ( ! preg_match( '/^[A-Za-z0-9_\-\.\/:]+$/', $hook ) ) {
		return new WP_Error(
			'wpdm_cron_invalid_hook',
			__( 'Cron hook may only contain letters, numbers, underscores, dashes, dots, slashes, and colons.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	return $hook;
}

/**
 * Whether a value can safely round-trip through JSON for editing.
 *
 * @since 0.22.0
 *
 * @param mixed $value Value to test.
 * @return bool
 */
function wpdm_cron_manager_is_json_safe( $value ) {
	if ( null === $value || is_scalar( $value ) ) {
		return true;
	}
	if ( ! is_array( $value ) ) {
		return false;
	}
	foreach ( $value as $k => $v ) {
		if ( ! is_int( $k ) && ! is_string( $k ) ) {
			return false;
		}
		if ( ! wpdm_cron_manager_is_json_safe( $v ) ) {
			return false;
		}
	}
	return true;
}

/**
 * Normalize incoming cron args. WordPress expects an array.
 *
 * @since 0.22.0
 *
 * @param mixed $args Raw decoded JSON args.
 * @return array|WP_Error
 */
function wpdm_cron_manager_normalize_args( $args ) {
	if ( null === $args ) {
		return array();
	}
	if ( ! is_array( $args ) ) {
		return new WP_Error(
			'wpdm_cron_invalid_args',
			__( 'Cron args must be a JSON array or object.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	if ( ! wpdm_cron_manager_is_json_safe( $args ) ) {
		return new WP_Error(
			'wpdm_cron_unsupported_args',
			__( 'Cron args contain unsupported values.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	return $args;
}

/**
 * Return WordPress' internal args hash.
 *
 * @since 0.22.0
 *
 * @param array $args Cron args.
 * @return string
 */
function wpdm_cron_manager_args_hash( $args ) {
	return md5( serialize( is_array( $args ) ? $args : array() ) );
}

/**
 * Build a stable client id for an event row.
 *
 * @since 0.22.0
 *
 * @param int    $timestamp Unix timestamp.
 * @param string $hook      Cron hook.
 * @param string $args_hash Internal args hash.
 * @return string
 */
function wpdm_cron_manager_event_id( $timestamp, $hook, $args_hash ) {
	return (int) $timestamp . ':' . rawurlencode( (string) $hook ) . ':' . (string) $args_hash;
}

/**
 * Convert a raw cron event into the REST row shape.
 *
 * @since 0.22.0
 *
 * @param int    $timestamp Unix timestamp.
 * @param string $hook      Cron hook.
 * @param string $args_hash Internal args hash.
 * @param array  $event     Raw cron event.
 * @return array
 */
function wpdm_cron_manager_format_event( $timestamp, $hook, $args_hash, $event ) {
	$args      = isset( $event['args'] ) && is_array( $event['args'] ) ? $event['args'] : array();
	$schedule  = isset( $event['schedule'] ) && is_string( $event['schedule'] ) ? $event['schedule'] : '';
	$schedules = wp_get_schedules();
	$interval  = isset( $event['interval'] ) ? (int) $event['interval'] : 0;
	if ( $interval <= 0 && '' !== $schedule && isset( $schedules[ $schedule ]['interval'] ) ) {
		$interval = (int) $schedules[ $schedule ]['interval'];
	}
	$args_editable = wpdm_cron_manager_is_json_safe( $args );
	$args_json     = $args_editable ? wp_json_encode( $args, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) : '';
	if ( false === $args_json ) {
		$args_json     = '';
		$args_editable = false;
	}
	$now = time();

	return array(
		'id'              => wpdm_cron_manager_event_id( $timestamp, $hook, $args_hash ),
		'identity'        => array(
			'timestamp' => (int) $timestamp,
			'hook'      => (string) $hook,
			'argsHash'  => (string) $args_hash,
		),
		'timestamp'       => (int) $timestamp,
		'nextRunGmt'      => gmdate( 'c', (int) $timestamp ),
		'nextRunLocal'    => wp_date( 'Y-m-d H:i:s', (int) $timestamp ),
		'hook'            => (string) $hook,
		'schedule'        => $schedule,
		'scheduleDisplay' => '' !== $schedule && isset( $schedules[ $schedule ]['display'] )
			? (string) $schedules[ $schedule ]['display']
			: __( 'One time', 'desktop-mode' ),
		'interval'        => $interval,
		'recurring'       => '' !== $schedule,
		'due'             => (int) $timestamp <= $now,
		'overdue'         => (int) $timestamp < ( $now - 300 ),
		'callbackCount'   => wpdm_cron_manager_count_hook_callbacks( $hook ),
		'args'            => $args,
		'argsJson'        => $args_json,
		'argsEditable'    => $args_editable,
		'argsSummary'     => wpdm_cron_manager_args_summary( $args, $args_editable ),
	);
}

/**
 * Count callbacks registered for a hook.
 *
 * @since 0.22.0
 *
 * @param string $hook Hook name.
 * @return int
 */
function wpdm_cron_manager_count_hook_callbacks( $hook ) {
	global $wp_filter;

	if ( empty( $wp_filter[ $hook ] ) ) {
		return 0;
	}

	$filter = $wp_filter[ $hook ];
	if ( $filter instanceof WP_Hook ) {
		$count = 0;
		foreach ( $filter->callbacks as $callbacks ) {
			if ( is_array( $callbacks ) ) {
				$count += count( $callbacks );
			}
		}
		return $count;
	}

	if ( is_array( $filter ) ) {
		$count = 0;
		foreach ( $filter as $callbacks ) {
			if ( is_array( $callbacks ) ) {
				$count += count( $callbacks );
			}
		}
		return $count;
	}

	return has_action( $hook ) ? 1 : 0;
}

/**
 * Build a compact args summary for table display.
 *
 * @since 0.22.0
 *
 * @param array $args          Event args.
 * @param bool  $args_editable Whether args are JSON-safe.
 * @return string
 */
function wpdm_cron_manager_args_summary( $args, $args_editable ) {
	if ( empty( $args ) ) {
		return '[]';
	}
	if ( ! $args_editable ) {
		return __( 'Unsupported args', 'desktop-mode' );
	}
	$json = wp_json_encode( $args, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
	if ( ! is_string( $json ) || '' === $json ) {
		return __( 'Unsupported args', 'desktop-mode' );
	}
	return strlen( $json ) > 140 ? substr( $json, 0, 137 ) . '...' : $json;
}

/**
 * List every scheduled cron event.
 *
 * @since 0.22.0
 *
 * @return array<int, array>
 */
function wpdm_cron_manager_list_events() {
	$crons = _get_cron_array();
	if ( ! is_array( $crons ) || empty( $crons ) ) {
		return array();
	}

	$out = array();
	foreach ( $crons as $timestamp => $hooks ) {
		if ( ! is_numeric( $timestamp ) || ! is_array( $hooks ) ) {
			continue;
		}
		foreach ( $hooks as $hook => $events ) {
			if ( ! is_array( $events ) ) {
				continue;
			}
			foreach ( $events as $args_hash => $event ) {
				if ( ! is_array( $event ) ) {
					continue;
				}
				$out[] = wpdm_cron_manager_format_event(
					(int) $timestamp,
					(string) $hook,
					(string) $args_hash,
					$event
				);
			}
		}
	}

	usort(
		$out,
		static function ( $a, $b ) {
			if ( $a['timestamp'] === $b['timestamp'] ) {
				return strcmp( $a['hook'], $b['hook'] );
			}
			return $a['timestamp'] < $b['timestamp'] ? -1 : 1;
		}
	);

	return $out;
}

/**
 * Find a cron event by timestamp, hook, and args hash.
 *
 * @since 0.22.0
 *
 * @param array $identity Event identity.
 * @return array|WP_Error
 */
function wpdm_cron_manager_find_event( $identity ) {
	if ( ! is_array( $identity ) ) {
		return new WP_Error(
			'wpdm_cron_missing_identity',
			__( 'Cron event identity is required.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$timestamp = isset( $identity['timestamp'] ) ? (int) $identity['timestamp'] : 0;
	$hook      = isset( $identity['hook'] ) ? (string) $identity['hook'] : '';
	$args_hash = isset( $identity['argsHash'] ) ? (string) $identity['argsHash'] : '';
	if ( $timestamp <= 0 || '' === $hook || '' === $args_hash ) {
		return new WP_Error(
			'wpdm_cron_invalid_identity',
			__( 'Cron event identity is invalid.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$crons = _get_cron_array();
	if (
		! is_array( $crons )
		|| empty( $crons[ $timestamp ] )
		|| empty( $crons[ $timestamp ][ $hook ] )
		|| empty( $crons[ $timestamp ][ $hook ][ $args_hash ] )
	) {
		return new WP_Error(
			'wpdm_cron_event_not_found',
			__( 'Cron event was not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}

	$event = $crons[ $timestamp ][ $hook ][ $args_hash ];
	$args  = isset( $event['args'] ) && is_array( $event['args'] ) ? $event['args'] : array();

	return array(
		'timestamp' => $timestamp,
		'hook'      => $hook,
		'argsHash'  => $args_hash,
		'event'     => $event,
		'args'      => $args,
	);
}

/**
 * Normalize an incoming event payload.
 *
 * @since 0.22.0
 *
 * @param array      $payload      Raw event payload.
 * @param array|null $fallback_args Args to use when omitted.
 * @return array|WP_Error
 */
function wpdm_cron_manager_normalize_event_payload( $payload, $fallback_args = null ) {
	if ( ! is_array( $payload ) ) {
		return new WP_Error(
			'wpdm_cron_invalid_payload',
			__( 'Cron event payload must be an object.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$hook = wpdm_cron_manager_normalize_hook( isset( $payload['hook'] ) ? $payload['hook'] : '' );
	if ( is_wp_error( $hook ) ) {
		return $hook;
	}

	$timestamp = isset( $payload['timestamp'] ) ? (int) $payload['timestamp'] : 0;
	if ( $timestamp <= 0 ) {
		return new WP_Error(
			'wpdm_cron_invalid_timestamp',
			__( 'Cron event timestamp must be a positive Unix timestamp.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	if ( array_key_exists( 'args', $payload ) ) {
		$args = wpdm_cron_manager_normalize_args( $payload['args'] );
	} elseif ( null !== $fallback_args ) {
		$args = $fallback_args;
	} else {
		$args = array();
	}
	if ( is_wp_error( $args ) ) {
		return $args;
	}

	$custom = isset( $payload['customSchedule'] ) && is_array( $payload['customSchedule'] )
		? $payload['customSchedule']
		: null;
	if ( $custom ) {
		$saved = wpdm_cron_manager_save_custom_schedule(
			isset( $custom['slug'] ) ? $custom['slug'] : '',
			isset( $custom['interval'] ) ? $custom['interval'] : 0,
			isset( $custom['display'] ) ? $custom['display'] : ''
		);
		if ( is_wp_error( $saved ) ) {
			return $saved;
		}
		$payload['schedule'] = $saved;
	}

	$schedule = isset( $payload['schedule'] ) ? sanitize_key( (string) $payload['schedule'] ) : '';
	if ( 'single' === $schedule ) {
		$schedule = '';
	}

	if ( '' !== $schedule ) {
		$schedules = wp_get_schedules();
		if ( ! isset( $schedules[ $schedule ] ) ) {
			return new WP_Error(
				'wpdm_cron_invalid_schedule',
				__( 'Cron schedule does not exist.', 'desktop-mode' ),
				array( 'status' => 400 )
			);
		}
	}

	return array(
		'hook'      => $hook,
		'timestamp' => $timestamp,
		'args'      => $args,
		'schedule'  => $schedule,
	);
}

/**
 * Schedule a normalized event.
 *
 * @since 0.22.0
 *
 * @param array $event Normalized event.
 * @return true|WP_Error
 */
function wpdm_cron_manager_schedule_normalized_event( $event ) {
	if ( '' === $event['schedule'] ) {
		$result = wp_schedule_single_event(
			(int) $event['timestamp'],
			(string) $event['hook'],
			(array) $event['args'],
			true
		);
	} else {
		$result = wp_schedule_event(
			(int) $event['timestamp'],
			(string) $event['schedule'],
			(string) $event['hook'],
			(array) $event['args'],
			true
		);
	}

	if ( is_wp_error( $result ) ) {
		return $result;
	}
	if ( ! $result ) {
		return new WP_Error(
			'wpdm_cron_schedule_failed',
			__( 'Cron event could not be scheduled.', 'desktop-mode' ),
			array( 'status' => 500 )
		);
	}

	return true;
}

/**
 * Create a cron event from a REST payload.
 *
 * @since 0.22.0
 *
 * @param array $payload Raw event payload.
 * @return array|WP_Error
 */
function wpdm_cron_manager_create_event( $payload ) {
	$event = wpdm_cron_manager_normalize_event_payload( $payload );
	if ( is_wp_error( $event ) ) {
		return $event;
	}

	$scheduled = wpdm_cron_manager_schedule_normalized_event( $event );
	if ( is_wp_error( $scheduled ) ) {
		return $scheduled;
	}

	return array(
		'ok'     => true,
		'events' => wpdm_cron_manager_list_events(),
	);
}

/**
 * Delete a single exact cron event.
 *
 * @since 0.22.0
 *
 * @param array $identity Event identity.
 * @return array|WP_Error
 */
function wpdm_cron_manager_delete_event( $identity ) {
	$found = wpdm_cron_manager_find_event( $identity );
	if ( is_wp_error( $found ) ) {
		return $found;
	}

	$result = wp_unschedule_event(
		(int) $found['timestamp'],
		(string) $found['hook'],
		(array) $found['args'],
		true
	);
	if ( is_wp_error( $result ) ) {
		return $result;
	}
	if ( ! $result ) {
		return new WP_Error(
			'wpdm_cron_unschedule_failed',
			__( 'Cron event could not be deleted.', 'desktop-mode' ),
			array( 'status' => 500 )
		);
	}

	return array(
		'ok'     => true,
		'events' => wpdm_cron_manager_list_events(),
	);
}

/**
 * Update an event by deleting the old identity and scheduling the new one.
 *
 * @since 0.22.0
 *
 * @param array $identity Event identity.
 * @param array $payload  New event payload.
 * @return array|WP_Error
 */
function wpdm_cron_manager_update_event( $identity, $payload ) {
	$found = wpdm_cron_manager_find_event( $identity );
	if ( is_wp_error( $found ) ) {
		return $found;
	}

	$next = wpdm_cron_manager_normalize_event_payload( $payload, (array) $found['args'] );
	if ( is_wp_error( $next ) ) {
		return $next;
	}

	$old = array(
		'hook'      => $found['hook'],
		'timestamp' => $found['timestamp'],
		'args'      => $found['args'],
		'schedule'  => isset( $found['event']['schedule'] ) && is_string( $found['event']['schedule'] )
			? $found['event']['schedule']
			: '',
	);

	$deleted = wp_unschedule_event(
		(int) $found['timestamp'],
		(string) $found['hook'],
		(array) $found['args'],
		true
	);
	if ( is_wp_error( $deleted ) ) {
		return $deleted;
	}
	if ( ! $deleted ) {
		return new WP_Error(
			'wpdm_cron_unschedule_failed',
			__( 'Original cron event could not be deleted.', 'desktop-mode' ),
			array( 'status' => 500 )
		);
	}

	$scheduled = wpdm_cron_manager_schedule_normalized_event( $next );
	if ( is_wp_error( $scheduled ) ) {
		wpdm_cron_manager_schedule_normalized_event( $old );
		return $scheduled;
	}

	return array(
		'ok'     => true,
		'events' => wpdm_cron_manager_list_events(),
	);
}

/**
 * Execute an existing event immediately without modifying its schedule.
 *
 * @since 0.22.0
 *
 * @param array $identity Event identity.
 * @return array|WP_Error
 */
function wpdm_cron_manager_run_event_now( $identity ) {
	$found = wpdm_cron_manager_find_event( $identity );
	if ( is_wp_error( $found ) ) {
		return $found;
	}

	do_action_ref_array( (string) $found['hook'], (array) $found['args'] );

	return array(
		'ok'     => true,
		'events' => wpdm_cron_manager_list_events(),
	);
}
