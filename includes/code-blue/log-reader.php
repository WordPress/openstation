<?php
/**
 * OpenStation — Code Blue: log discovery, tailing, and parsing.
 *
 * Pure functions, no hooks registered here beyond the filters they
 * expose. The REST layer (rest.php) is the only caller, so nothing
 * in this file runs on a normal request.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Whether the current user may use the Code Blue window.
 *
 * Two gates, both required:
 *
 * 1. Capability. Error logs leak absolute paths, SQL fragments, and
 *    plugin internals, so the gate is deliberately the
 *    site-management capability rather than anything content-level.
 *    On multisite the bar is higher still: the debug log and the
 *    PHP error log are NETWORK-wide files, so a subsite
 *    administrator must not read (or truncate) every other site's
 *    errors — the gate becomes `manage_network_options`.
 * 2. Developer mode (`developerModeEnabled` in OpenStation
 *    Preferences, off by default). Code Blue is a developer-facing
 *    surface; until the user flips the switch, nothing registers —
 *    no icon, no window, no nav entry, no REST routes.
 *
 * @return bool
 */
function openstation_code_blue_user_can_use() {
	$capability = is_multisite() ? 'manage_network_options' : 'manage_options';
	$can        = current_user_can( $capability );

	if ( $can && function_exists( 'openstation_get_os_settings' ) ) {
		$settings = openstation_get_os_settings( get_current_user_id() );
		$can      = ! empty( $settings['developerModeEnabled'] );
	}

	/**
	 * Filter whether the current user can see the Code Blue desktop
	 * icon, window, and REST routes.
	 *
	 * @param bool $can Default: Developer mode enabled in
	 *                  OpenStation Preferences AND `manage_options`
	 *                  (`manage_network_options` on multisite).
	 */
	return (bool) apply_filters( 'openstation_code_blue_user_can_use', $can );
}

/**
 * How many trailing bytes of a log file to scan per request.
 *
 * @return int
 */
function openstation_code_blue_max_bytes() {
	/**
	 * Filter the number of trailing bytes read from a log file per
	 * request. Larger values reach further back in time at the cost
	 * of parse time and response size.
	 *
	 * @param int $max_bytes Default: 1 MiB.
	 */
	$max = (int) apply_filters( 'openstation_code_blue_max_bytes', MB_IN_BYTES );
	return max( 4 * KB_IN_BYTES, $max );
}

/**
 * How many parsed entries a response may carry (newest kept).
 *
 * @return int
 */
function openstation_code_blue_max_entries() {
	/**
	 * Filter the maximum number of parsed log entries returned per
	 * request. When the scanned window holds more, the OLDEST
	 * entries are dropped.
	 *
	 * @param int $max_entries Default: 3000.
	 */
	$max = (int) apply_filters( 'openstation_code_blue_max_entries', 3000 );
	return max( 100, $max );
}

/**
 * Discover the log files this install can offer, normalized.
 *
 * Built-in candidates:
 *
 *   - `debug-log` — WP_DEBUG_LOG (string form respected; bool form
 *     resolves to wp-content/debug.log). Offered even when the
 *     constant is off if a leftover debug.log exists on disk.
 *   - `php-error-log` — the `error_log` ini directive, unless it
 *     points at syslog/stderr or at the same file as `debug-log`.
 *
 * Plugins append their own files via the
 * `openstation_code_blue_log_sources` filter.
 *
 * @return array[] Each: `id`, `label`, `path`, `exists`,
 *                 `readable`, `writable`, `size`, `mtime`.
 */
function openstation_code_blue_log_sources() {
	$sources = array();

	$debug_path = '';
	if ( defined( 'WP_DEBUG_LOG' ) ) {
		if ( is_string( WP_DEBUG_LOG ) && '' !== WP_DEBUG_LOG ) {
			$debug_path = WP_DEBUG_LOG;
		} elseif ( WP_DEBUG_LOG ) {
			$debug_path = WP_CONTENT_DIR . '/debug.log';
		}
	}
	if ( '' === $debug_path && file_exists( WP_CONTENT_DIR . '/debug.log' ) ) {
		$debug_path = WP_CONTENT_DIR . '/debug.log';
	}
	if ( '' !== $debug_path ) {
		$sources[] = array(
			'id'    => 'debug-log',
			'label' => __( 'WordPress debug log', 'desktop-mode' ),
			'path'  => $debug_path,
		);
	}

	$ini_log = (string) ini_get( 'error_log' );
	if ( '' !== $ini_log && ! in_array( $ini_log, array( 'syslog', '/dev/stderr', '/dev/stdout' ), true ) ) {
		$same = '' !== $debug_path
			&& ( $ini_log === $debug_path
				|| ( file_exists( $ini_log ) && file_exists( $debug_path )
					&& realpath( $ini_log ) === realpath( $debug_path ) ) );
		if ( ! $same ) {
			$sources[] = array(
				'id'    => 'php-error-log',
				'label' => __( 'PHP error log', 'desktop-mode' ),
				'path'  => $ini_log,
			);
		}
	}

	/**
	 * Filter the log sources offered by the Code Blue window.
	 *
	 * Each entry declares `id` (slug), `label`, and `path` (absolute
	 * file path). File metadata (`exists`, `readable`, `writable`,
	 * `size`, `mtime`) is derived after filtering — callers only
	 * supply the three descriptor keys.
	 *
	 * @param array[] $sources Default: WP debug log + PHP error log.
	 */
	$sources = apply_filters( 'openstation_code_blue_log_sources', $sources );

	$out  = array();
	$seen = array();
	foreach ( (array) $sources as $source ) {
		$id   = isset( $source['id'] ) ? sanitize_key( (string) $source['id'] ) : '';
		$path = isset( $source['path'] ) ? (string) $source['path'] : '';
		if ( '' === $id || '' === $path || isset( $seen[ $id ] ) ) {
			continue;
		}
		$seen[ $id ] = true;

		$exists = is_file( $path );
		$out[]  = array(
			'id'       => $id,
			'label'    => isset( $source['label'] ) ? (string) $source['label'] : $id,
			'path'     => $path,
			'exists'   => $exists,
			'readable' => $exists && is_readable( $path ),
			'writable' => $exists && wp_is_writable( $path ),
			'size'     => $exists ? (int) filesize( $path ) : 0,
			'mtime'    => $exists ? (int) filemtime( $path ) : 0,
		);
	}

	return $out;
}

/**
 * Look up one normalized source descriptor by id.
 *
 * @param string $id Source id.
 * @return array|null
 */
function openstation_code_blue_get_source( $id ) {
	foreach ( openstation_code_blue_log_sources() as $source ) {
		if ( $source['id'] === $id ) {
			return $source;
		}
	}
	return null;
}

/**
 * Read the trailing window of a file.
 *
 * When the file is larger than `$max_bytes`, seeks to the tail and
 * drops the first (almost certainly partial) line so parsing starts
 * on a clean record boundary.
 *
 * @param string $path      Absolute file path.
 * @param int    $max_bytes Trailing window size.
 * @return array `raw` (string), `truncated` (bool), `scanned_bytes` (int).
 */
function openstation_code_blue_tail( $path, $max_bytes ) {
	$result = array(
		'raw'           => '',
		'truncated'     => false,
		'scanned_bytes' => 0,
	);
	if ( ! is_file( $path ) || ! is_readable( $path ) ) {
		return $result;
	}

	$size = (int) filesize( $path );
	if ( 0 === $size ) {
		return $result;
	}

	// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fopen -- Streaming the tail of a multi-megabyte log; WP_Filesystem has no seek-and-read.
	$handle = fopen( $path, 'rb' );
	if ( ! $handle ) {
		return $result;
	}

	$offset = max( 0, $size - $max_bytes );
	if ( $offset > 0 ) {
		fseek( $handle, $offset );
		$result['truncated'] = true;
	}
	$raw = stream_get_contents( $handle );
	// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fclose -- Pairs with the fopen above.
	fclose( $handle );

	if ( false === $raw ) {
		return $result;
	}
	if ( $offset > 0 ) {
		$newline = strpos( $raw, "\n" );
		$raw     = false === $newline ? '' : substr( $raw, $newline + 1 );
	}

	$result['raw']           = $raw;
	$result['scanned_bytes'] = strlen( $raw );
	return $result;
}

/**
 * The PHP error-label → severity map, the single source of truth
 * for both the parse regex (built from these keys) and the label
 * lookup — so a label added here is automatically matched.
 *
 * @return array<string,string> Lowercased label => severity slug.
 */
function openstation_code_blue_level_map() {
	return array(
		'fatal error'             => 'fatal',
		'parse error'             => 'fatal',
		'core error'              => 'fatal',
		'compile error'           => 'fatal',
		'recoverable fatal error' => 'fatal',
		'user error'              => 'error',
		'warning'                 => 'warning',
		'core warning'            => 'warning',
		'compile warning'         => 'warning',
		'user warning'            => 'warning',
		'deprecated'              => 'deprecated',
		'user deprecated'         => 'deprecated',
		'notice'                  => 'notice',
		'user notice'             => 'notice',
	);
}

/**
 * Map a PHP error label (the text between `PHP ` and `:`) to one of
 * the six Code Blue severities.
 *
 * @param string $label Error label, e.g. `Fatal error`.
 * @return string `fatal` | `error` | `warning` | `deprecated` | `notice` | `info`.
 */
function openstation_code_blue_level_for_label( $label ) {
	$map   = openstation_code_blue_level_map();
	$label = strtolower( trim( $label ) );
	return isset( $map[ $label ] ) ? $map[ $label ] : 'info';
}

/**
 * Build the grouping signature for an entry.
 *
 * Two occurrences of "the same problem" must land on the same
 * signature even when the details differ, so numbers (line numbers,
 * ids, byte counts) and hex addresses are collapsed before hashing
 * the message together with its level and file.
 *
 * @param string $level   Severity slug.
 * @param string $message Message with the location suffix removed.
 * @param string $file    Source file path, may be empty.
 * @return string
 */
function openstation_code_blue_signature( $level, $message, $file = '' ) {
	$norm = preg_replace( '/0x[0-9a-f]+/i', 'N', $message );
	$norm = preg_replace( '/\d+/', 'N', (string) $norm );
	$norm = preg_replace( '/\s+/', ' ', trim( (string) $norm ) );
	$norm = substr( (string) $norm, 0, 240 );
	return $level . '|' . $norm . '|' . $file;
}

/**
 * Parse raw log text into structured entries.
 *
 * Understands the formats a WordPress install actually produces:
 *
 *   - `[d-M-Y H:i:s TZ] PHP <label>:  message in /file on line N`
 *   - `[d-M-Y H:i:s TZ] PHP <label>:  message in /file:N`
 *   - `[d-M-Y H:i:s TZ] WordPress database error <err> for query …`
 *   - Untimestamped trace-shaped lines (`Stack trace:`, `#0 …`,
 *     `thrown in …`, indented text) attach to the preceding
 *     entry's trace.
 *   - Timestamped Xdebug frames (`PHP Stack trace:`, `PHP   1. …`)
 *     attach to the preceding entry's trace.
 *   - Anything else — timestamped or not — becomes an `info`
 *     entry, so custom `error_log()` calls from plugins (including
 *     type-3 writes to a plugin's own file, which carry no
 *     timestamp prefix) stay visible as individual entries.
 *
 * @param string $raw Raw log text.
 * @return array[] Entries: `timestamp` (int|null UTC), `level`,
 *                 `label`, `message`, `file`, `line`, `trace`,
 *                 `signature` — in file order (oldest first).
 */
function openstation_code_blue_parse( $raw ) {
	$entries = array();
	$current = null;

	$lines = preg_split( '/\r\n|\n|\r/', (string) $raw );
	foreach ( $lines as $line ) {
		if ( '' === trim( $line ) ) {
			continue;
		}

		// The timezone class includes ':' for offset-form values
		// (`+02:00`), which PHP's `T` emits for offset-only
		// `date.timezone` settings.
		if ( ! preg_match( '/^\[(\d{1,2}-[A-Za-z]{3}-\d{4} \d{2}:\d{2}:\d{2}(?:\s+[A-Za-z0-9_\/+:\-]+)?)\]\s?(.*)$/', $line, $m ) ) {
			// Untimestamped line. Only trace-shaped lines (stack
			// frames, `thrown in`, indented continuations) attach to
			// the previous entry — anything else is its own record,
			// so a plugin log written with `error_log( $msg, 3, … )`
			// (no timestamp prefix) stays one entry per line instead
			// of collapsing into the first line's trace.
			$is_trace_shape = (bool) preg_match( '/^(Stack trace:|#\d+|thrown in\b|\s)/', $line );
			if ( null !== $current && $is_trace_shape ) {
				$current['trace'] .= ( '' === $current['trace'] ? '' : "\n" ) . rtrim( $line );
				continue;
			}
			if ( null !== $current ) {
				$entries[] = $current;
			}
			$current = openstation_code_blue_make_entry( null, 'info', __( 'Log', 'desktop-mode' ), trim( $line ) );
			continue;
		}

		$timestamp = openstation_code_blue_parse_timestamp( $m[1] );
		$rest      = $m[2];

		// Xdebug trace lines are timestamped but belong to the
		// preceding error, not to a record of their own.
		if ( null !== $current && preg_match( '/^PHP (Stack trace:|\s*\d+\.\s)/', $rest ) ) {
			$current['trace'] .= ( '' === $current['trace'] ? '' : "\n" ) . rtrim( $rest );
			continue;
		}

		if ( null !== $current ) {
			$entries[] = $current;
			$current   = null;
		}

		$labels_re = implode( '|', array_map( 'preg_quote', array_keys( openstation_code_blue_level_map() ) ) );
		if ( preg_match( '/^PHP (' . $labels_re . ')\s*:\s*(.*)$/i', $rest, $em ) ) {
			$current = openstation_code_blue_make_entry(
				$timestamp,
				openstation_code_blue_level_for_label( $em[1] ),
				'PHP ' . $em[1],
				$em[2]
			);
			continue;
		}

		if ( preg_match( '/^WordPress database error\s+(.*)$/', $rest, $dm ) ) {
			$message = $dm[1];
			$trace   = '';
			$split   = strpos( $message, ' for query ' );
			if ( false !== $split ) {
				$trace   = 'Query: ' . substr( $message, $split + strlen( ' for query ' ) );
				$message = substr( $message, 0, $split );
				$made_by = strpos( $trace, ' made by ' );
				if ( false !== $made_by ) {
					$trace = substr( $trace, 0, $made_by ) . "\nMade by: " . substr( $trace, $made_by + strlen( ' made by ' ) );
				}
			}
			$current          = openstation_code_blue_make_entry( $timestamp, 'error', __( 'Database error', 'desktop-mode' ), $message );
			$current['trace'] = $trace;
			continue;
		}

		$current = openstation_code_blue_make_entry( $timestamp, 'info', __( 'Log', 'desktop-mode' ), $rest );
	}

	if ( null !== $current ) {
		$entries[] = $current;
	}

	return $entries;
}

/**
 * Build one entry: extract the `in /file on line N` suffix, then
 * derive the grouping signature.
 *
 * @param int|null $timestamp Unix timestamp (UTC) or null.
 * @param string   $level     Severity slug.
 * @param string   $label     Human label, e.g. `PHP Fatal error`.
 * @param string   $message   Message text (location suffix still attached).
 * @return array
 */
function openstation_code_blue_make_entry( $timestamp, $level, $label, $message ) {
	// `_doing_it_wrong()` and friends log HTML (`<strong>`, `<code>`)
	// — strip it so the UI shows prose, not markup. Deliberately NOT
	// `wp_strip_all_tags()`: that treats a bare `<` (as in a parse
	// error's `unexpected '<'`) as an unterminated tag and deletes
	// the rest of the message, location suffix included. This only
	// removes well-formed tags.
	$message = trim( (string) preg_replace( '/<\/?[a-zA-Z][^<>]*>/', '', $message ) );
	$file    = '';
	$line    = 0;

	if ( preg_match( '/^(.*?)\s+in\s+(\S+?)(?::(\d+)|\s+on\s+line\s+(\d+))$/s', $message, $m ) ) {
		$message = trim( $m[1] );
		$file    = $m[2];
		$line    = (int) ( '' !== $m[3] ? $m[3] : $m[4] );
	}

	return array(
		'timestamp' => $timestamp,
		'level'     => $level,
		'label'     => $label,
		'message'   => $message,
		'file'      => $file,
		'line'      => $line,
		'trace'     => '',
		'signature' => openstation_code_blue_signature( $level, $message, $file ),
	);
}

/**
 * Parse a log timestamp like `22-Aug-2026 09:14:02 UTC`.
 *
 * @param string $raw Timestamp text between the brackets.
 * @return int|null Unix timestamp, or null when unparseable.
 */
function openstation_code_blue_parse_timestamp( $raw ) {
	$raw = trim( $raw );

	$date = DateTime::createFromFormat( 'd-M-Y H:i:s T', $raw );
	if ( false === $date ) {
		$date = DateTime::createFromFormat( 'd-M-Y H:i:s', $raw, new DateTimeZone( 'UTC' ) );
	}
	if ( false === $date ) {
		$fallback = strtotime( $raw );
		return false === $fallback ? null : $fallback;
	}
	return $date->getTimestamp();
}

/**
 * Read + parse one source, applying the byte and entry caps.
 *
 * @param array $source Normalized descriptor from
 *                      {@see openstation_code_blue_log_sources()}.
 * @return array `entries`, `truncated`, `scanned_bytes`, `dropped_entries`.
 */
function openstation_code_blue_read_source( $source ) {
	$tail    = openstation_code_blue_tail( $source['path'], openstation_code_blue_max_bytes() );
	$entries = openstation_code_blue_parse( $tail['raw'] );

	/**
	 * Filter the parsed entries for one log source.
	 *
	 * The escape hatch for logs the built-in parser doesn't
	 * understand (Monolog, ISO-timestamped formats, …): a plugin
	 * that registered a source via `openstation_code_blue_log_sources`
	 * can re-parse `$raw` itself here and return its own entry
	 * array. Each entry: `timestamp` (int|null), `level`, `label`,
	 * `message`, `file`, `line`, `trace`, `signature`.
	 *
	 * @param array[] $entries Parsed entries, oldest first.
	 * @param array   $source  Normalized source descriptor.
	 * @param string  $raw     The raw scanned tail the entries came from.
	 */
	$entries = (array) apply_filters( 'openstation_code_blue_entries', $entries, $source, $tail['raw'] );

	$max     = openstation_code_blue_max_entries();
	$dropped = 0;
	if ( count( $entries ) > $max ) {
		$dropped = count( $entries ) - $max;
		$entries = array_slice( $entries, -$max );
	}

	return array(
		'entries'         => $entries,
		'truncated'       => $tail['truncated'] || $dropped > 0,
		'scanned_bytes'   => $tail['scanned_bytes'],
		'dropped_entries' => $dropped,
	);
}
