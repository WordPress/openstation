<?php

namespace OpenStation\Apps\CodeBlue;

use OpenStation\App\Os;

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

const MAX_BYTES   = 1048576;
const MAX_ENTRIES = 3000;

function can_use( Os $os ) {
	$can = $os->can( $os->env->is_network() ? 'manage_network_options' : 'manage_options' )
		&& ! empty( $os->preference( 'developerModeEnabled' ) );

	return (bool) $os->filter( 'openstation_code_blue_user_can_use', $can );
}

function level_map() {
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

function signature( $level, $message, $file = '' ) {
	$norm = preg_replace( '/0x[0-9a-f]+/i', 'N', (string) $message );
	$norm = preg_replace( '/\d+/', 'N', (string) $norm );
	$norm = preg_replace( '/\s+/', ' ', trim( (string) $norm ) );
	return $level . '|' . substr( (string) $norm, 0, 240 ) . '|' . $file;
}

function make_entry( $timestamp, $level, $label, $message ) {
	$message = trim( (string) preg_replace( '/<\/?[a-zA-Z][^<>]*>/', '', (string) $message ) );
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
		'signature' => signature( $level, $message, $file ),
	);
}

function origin( $file, $content_dir ) {
	$path    = str_replace( '\\', '/', (string) $file );
	$content = rtrim( str_replace( '\\', '/', (string) $content_dir ), '/' );
	if ( '' !== $content && 0 === strpos( $path, $content . '/' ) ) {
		$rest = substr( $path, strlen( $content ) + 1 );
		if ( preg_match( '#^(plugins|mu-plugins|themes)/([^/]+)#', $rest, $m ) ) {
			$kinds = array(
				'plugins'    => 'plugin',
				'mu-plugins' => 'mu-plugin',
				'themes'     => 'theme',
			);
			return array(
				'kind' => $kinds[ $m[1] ],
				'slug' => preg_replace( '/\.php$/', '', $m[2] ),
			);
		}
	}
	if ( preg_match( '#/wp-(admin|includes)/#', $path ) ) {
		return array(
			'kind' => 'core',
			'slug' => '',
		);
	}
	return array(
		'kind' => 'unknown',
		'slug' => '',
	);
}

function parse_timestamp( $raw ) {
	$raw  = trim( (string) $raw );
	$date = \DateTime::createFromFormat( 'd-M-Y H:i:s T', $raw );
	if ( false === $date ) {
		$date = \DateTime::createFromFormat( 'd-M-Y H:i:s', $raw, new \DateTimeZone( 'UTC' ) );
	}
	if ( false === $date ) {
		$fallback = strtotime( $raw );
		return false === $fallback ? null : $fallback;
	}
	return $date->getTimestamp();
}

function parse( $raw ) {
	$entries   = array();
	$current   = null;
	$labels_re = implode( '|', array_map( 'preg_quote', array_keys( level_map() ) ) );
	$log_label = __( 'Log', 'desktop-mode' );

	foreach ( preg_split( '/\r\n|\n|\r/', (string) $raw ) as $line ) {
		if ( '' === trim( $line ) ) {
			continue;
		}
		if ( ! preg_match( '/^\[(\d{1,2}-[A-Za-z]{3}-\d{4} \d{2}:\d{2}:\d{2}(?:\s+[A-Za-z0-9_\/+:\-]+)?)\]\s?(.*)$/', $line, $m ) ) {
			if ( null !== $current && preg_match( '/^(Stack trace:|#\d+|thrown in\b|\s)/', $line ) ) {
				$current['trace'] .= ( '' === $current['trace'] ? '' : "\n" ) . rtrim( $line );
				continue;
			}
			if ( null !== $current ) {
				$entries[] = $current;
			}
			$current = make_entry( null, 'info', $log_label, trim( $line ) );
			continue;
		}

		$timestamp = parse_timestamp( $m[1] );
		$rest      = $m[2];
		if ( null !== $current && preg_match( '/^PHP (Stack trace:|\s*\d+\.\s)/', $rest ) ) {
			$current['trace'] .= ( '' === $current['trace'] ? '' : "\n" ) . rtrim( $rest );
			continue;
		}
		if ( null !== $current ) {
			$entries[] = $current;
		}

		if ( preg_match( '/^PHP (' . $labels_re . ')\s*:\s*(.*)$/i', $rest, $em ) ) {
			$map     = level_map();
			$current = make_entry( $timestamp, $map[ strtolower( trim( $em[1] ) ) ], 'PHP ' . $em[1], $em[2] );
			continue;
		}
		if ( preg_match( '/^WordPress database error\s+(.*)$/', $rest, $dm ) ) {
			$message = $dm[1];
			$trace   = '';
			$split   = strpos( $message, ' for query ' );
			if ( false !== $split ) {
				$trace   = 'Query: ' . substr( $message, $split + 11 );
				$message = substr( $message, 0, $split );
				$made_by = strpos( $trace, ' made by ' );
				if ( false !== $made_by ) {
					$trace = substr( $trace, 0, $made_by ) . "\nMade by: " . substr( $trace, $made_by + 9 );
				}
			}
			$current          = make_entry( $timestamp, 'error', __( 'Database error', 'desktop-mode' ), $message );
			$current['trace'] = $trace;
			continue;
		}
		$current = make_entry( $timestamp, 'info', $log_label, $rest );
	}
	if ( null !== $current ) {
		$entries[] = $current;
	}
	return $entries;
}

function tail( $path, $max_bytes ) {
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

function sources( Os $os ) {
	$sources    = array();
	$debug_log  = $os->env->constant( 'WP_DEBUG_LOG', false );
	$debug_path = '';
	if ( is_string( $debug_log ) && '' !== $debug_log ) {
		$debug_path = $debug_log;
	} elseif ( $debug_log || file_exists( $os->env->content_dir() . '/debug.log' ) ) {
		$debug_path = $os->env->content_dir() . '/debug.log';
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
		$same = '' !== $debug_path && ( $ini_log === $debug_path
			|| ( file_exists( $ini_log ) && file_exists( $debug_path ) && realpath( $ini_log ) === realpath( $debug_path ) ) );
		if ( ! $same ) {
			$sources[] = array(
				'id'    => 'php-error-log',
				'label' => __( 'PHP error log', 'desktop-mode' ),
				'path'  => $ini_log,
			);
		}
	}

	$sources = $os->filter( 'openstation_code_blue_log_sources', $sources );

	$out  = array();
	$seen = array();
	foreach ( (array) $sources as $source ) {
		$id   = isset( $source['id'] ) ? strtolower( (string) preg_replace( '/[^a-zA-Z0-9_-]/', '', (string) $source['id'] ) ) : '';
		$path = isset( $source['path'] ) ? (string) $source['path'] : '';
		if ( '' === $id || '' === $path || isset( $seen[ $id ] ) ) {
			continue;
		}
		$seen[ $id ] = true;
		$exists      = is_file( $path );
		$out[]       = array(
			'id'       => $id,
			'label'    => isset( $source['label'] ) ? (string) $source['label'] : $id,
			'path'     => $path,
			'exists'   => $exists,
			'readable' => $exists && is_readable( $path ),

			'writable' => $exists && is_writable( $path ),
			'size'     => $exists ? (int) filesize( $path ) : 0,
			'mtime'    => $exists ? (int) filemtime( $path ) : 0,
		);
	}
	return $out;
}

function usable( array $source ) {
	return $source['readable'] || ! $source['exists'];
}

function read( Os $os, array $source ) {
	$empty = array(
		'entries'       => array(),
		'truncated'     => false,
		'scanned_bytes' => 0,
		'dropped'       => 0,
		'error'         => '',
	);
	if ( ! $source['exists'] ) {
		return $empty;
	}
	if ( ! $source['readable'] ) {
		$empty['error'] = __( 'The log file exists but PHP cannot read it.', 'desktop-mode' );
		return $empty;
	}

	$max_bytes   = max( 4096, (int) $os->filter( 'openstation_code_blue_max_bytes', MAX_BYTES ) );
	$max_entries = max( 100, (int) $os->filter( 'openstation_code_blue_max_entries', MAX_ENTRIES ) );
	$tail        = tail( $source['path'], $max_bytes );

	$entries = (array) $os->filter( 'openstation_code_blue_entries', parse( $tail['raw'] ), $source, $tail['raw'] );

	$content_dir = $os->env->content_dir();
	foreach ( $entries as $index => $entry ) {
		$entries[ $index ]['origin'] = origin( isset( $entry['file'] ) ? $entry['file'] : '', $content_dir );
	}

	$dropped = max( 0, count( $entries ) - $max_entries );
	if ( $dropped > 0 ) {
		$entries = array_slice( $entries, -$max_entries );
	}
	return array_merge(
		$empty,
		array(
			'entries'       => $entries,
			'truncated'     => $tail['truncated'] || $dropped > 0,
			'scanned_bytes' => $tail['scanned_bytes'],
			'dropped'       => $dropped,
		)
	);
}

function clear( Os $os, array $source ) {
	if ( ! $source['exists'] ) {
		return true;
	}
	if ( ! $source['writable'] ) {
		return __( 'The log file is not writable, so it cannot be cleared.', 'desktop-mode' );
	}

	if ( false === file_put_contents( $source['path'], '' ) ) {
		return __( 'Clearing the log file failed.', 'desktop-mode' );
	}

	$os->action( 'openstation_code_blue_log_cleared', $source['id'], $source['path'] );
	return true;
}

function search_url( Os $os ) {

	return (string) $os->filter( 'openstation_code_blue_search_url', 'https://duckduckgo.com/?q=%s' );
}

function environment( Os $os ) {
	$rows = array();
	foreach ( array( 'WP_DEBUG', 'WP_DEBUG_LOG', 'WP_DEBUG_DISPLAY', 'SCRIPT_DEBUG', 'SAVEQUERIES' ) as $constant ) {
		$on     = (bool) $os->env->constant( $constant, false );
		$rows[] = array(
			'label' => $constant,
			'value' => $on ? 'on' : 'off',
			'on'    => $on,
		);
	}
	$platform = $os->env->platform();
	$rows[]   = array(
		'label' => __( 'Environment', 'desktop-mode' ),
		'value' => $os->env->environment_type(),
		'on'    => null,
	);
	$rows[]   = array(
		'label' => 'PHP',
		'value' => PHP_VERSION,
		'on'    => null,
	);
	$rows[]   = array(
		'label' => $platform['name'],
		'value' => $platform['version'],
		'on'    => null,
	);

	return (array) $os->filter( 'openstation_code_blue_environment', $rows );
}
