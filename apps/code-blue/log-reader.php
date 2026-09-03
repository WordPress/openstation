<?php
/**
 * Code Blue — the log model.
 *
 * Discovery, tailing, parsing and clearing of the logs an install can
 * produce — the server half. Grouping, filtering and time buckets
 * run in the browser (`code-blue.os.ts`) so every filter is instant.
 * Everything here is a plain namespaced function that talks to the
 * host only through `$os`, so the same code runs on WordPress and on
 * a bare PHP host.
 *
 * @package OpenStation
 */

namespace OpenStation\Apps\CodeBlue;

use OpenStation\App\Os;

// Direct access, unless a standalone host is booting on bare PHP.
if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

const MAX_BYTES   = 1048576;
const MAX_ENTRIES = 3000;

/**
 * Whether the acting user may use Code Blue: site management (network
 * management on a network — the logs are shared files) AND Developer
 * mode in OpenStation Preferences.
 *
 * @param Os $os Host handle.
 * @return bool
 */
function can_use( Os $os ) {
	$can = $os->can( $os->env->is_network() ? 'manage_network_options' : 'manage_options' )
		&& ! empty( $os->preference( 'developerModeEnabled' ) );

	/**
	 * Filter whether the current user can see the Code Blue window.
	 *
	 * @param bool $can Default: Developer mode on AND `manage_options`
	 *                  (`manage_network_options` on a network).
	 */
	return (bool) $os->filter( 'openstation_code_blue_user_can_use', $can );
}

/**
 * The PHP error-label → severity map; the single source of truth for
 * both the parse regex and the label lookup.
 *
 * @return array<string,string>
 */
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

/**
 * Grouping key: numbers and hex addresses collapse so two occurrences
 * of the same problem land together.
 *
 * @param string $level   Severity slug.
 * @param string $message Message without the location suffix.
 * @param string $file    File path, may be ''.
 * @return string
 */
function signature( $level, $message, $file = '' ) {
	$norm = preg_replace( '/0x[0-9a-f]+/i', 'N', (string) $message );
	$norm = preg_replace( '/\d+/', 'N', (string) $norm );
	$norm = preg_replace( '/\s+/', ' ', trim( (string) $norm ) );
	return $level . '|' . substr( (string) $norm, 0, 240 ) . '|' . $file;
}

/**
 * Build one entry: strip well-formed HTML (`_doing_it_wrong()` logs
 * markup; a bare `<` from a parse error must survive), pull the
 * `in /file on line N` suffix out, derive the signature.
 *
 * @param int|null $timestamp Unix seconds or null.
 * @param string   $level     Severity slug.
 * @param string   $label     Human label, e.g. `PHP Fatal error`.
 * @param string   $message   Message text.
 * @return array<string,mixed>
 */
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

/**
 * Whose code is this? The first question anyone asks of a log line,
 * and the last one the log itself answers — the path is right there in
 * every entry, and reading `wp-content/plugins/<slug>/` off it turns
 * "some fatal error" into "WooCommerce's fatal error", which is the
 * difference between triage and archaeology.
 *
 * Deliberately conservative: a path that is not clearly under the
 * content directory or clearly inside core answers `unknown` rather
 * than guessing, because a wrong attribution sends someone into the
 * wrong codebase. Single-file plugins and mu-plugins keep their
 * basename as the slug; there is no directory to name them by.
 *
 * This is the ONLY implementation. The window renders what it returns
 * and the debugging abilities report it verbatim — a second copy of
 * this classification would let the two disagree about whose bug it is.
 *
 * @param string $file        Absolute path from a log entry, may be ''.
 * @param string $content_dir The install's `wp-content` equivalent.
 * @return array{kind:string,slug:string} `kind` is one of `plugin`,
 *                                        `mu-plugin`, `theme`, `core`, `unknown`.
 */
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

/**
 * Parse `22-Aug-2026 09:14:02 UTC` (or the same without a zone,
 * read as UTC).
 *
 * @param string $raw Text between the brackets.
 * @return int|null
 */
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

/**
 * Parse raw log text into entries, oldest first.
 *
 * Understands `[stamp] PHP <label>:  message in /file on line N` (and
 * the `:N` form), `[stamp] WordPress database error … for query …`,
 * Xdebug frames, untimestamped trace lines (attached to the previous
 * entry), and treats anything else as an `info` entry of its own.
 *
 * @param string $raw Raw log text.
 * @return array[]
 */
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

/**
 * Read the trailing window of a file, dropping the first (partial)
 * line when the file was longer than the window.
 *
 * @param string $path      Absolute path.
 * @param int    $max_bytes Window size.
 * @return array{raw:string,truncated:bool,scanned_bytes:int}
 */
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
 * The log files this install offers, normalised with file metadata.
 *
 * @param Os $os Host handle.
 * @return array[] Each: `id`, `label`, `path`, `exists`, `readable`, `writable`, `size`, `mtime`.
 */
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

	/**
	 * Filter the log sources Code Blue offers. Each: `id`, `label`,
	 * `path` — metadata is derived after filtering.
	 *
	 * @param array[] $sources Default: WP debug log + PHP error log.
	 */
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
			// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_is_writable -- Probing a server-side log path from the host-agnostic model; `wp_is_writable()` does not exist on a standalone host.
			'writable' => $exists && is_writable( $path ),
			'size'     => $exists ? (int) filesize( $path ) : 0,
			'mtime'    => $exists ? (int) filemtime( $path ) : 0,
		);
	}
	return $out;
}

/**
 * Whether a source can be read as a log: a missing file is an EMPTY
 * log; only exists-but-unreadable is dead.
 *
 * @param array<string,mixed> $source Normalised source.
 * @return bool
 */
function usable( array $source ) {
	return $source['readable'] || ! $source['exists'];
}

/**
 * Read + parse one source.
 *
 * Deliberately uncached. A log reader's product is freshness, and an
 * object cache would have to be keyed on more than the file: the
 * `entries` / `max_bytes` / `max_entries` filters all shape the result,
 * and `parse()` bakes localized level labels into it — on a Redis or
 * Memcached install a filter change would lag and two admins in
 * different locales would read each other's labels. A bounded tail
 * (1 MB by default) parsed on an explicit Refresh is cheap enough that
 * none of that is worth buying.
 *
 * @param Os                  $os     Host handle.
 * @param array<string,mixed> $source Normalised source.
 * @return array{entries:array[],truncated:bool,scanned_bytes:int,dropped:int,error:string}
 */
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
	/**
	 * Filter the parsed entries for one source — re-parse `$raw`
	 * yourself for a format the built-in parser doesn't know.
	 *
	 * @param array[] $entries Parsed entries, oldest first.
	 * @param array   $source  Normalised source.
	 * @param string  $raw     The scanned tail.
	 */
	$entries = (array) $os->filter( 'openstation_code_blue_entries', parse( $tail['raw'] ), $source, $tail['raw'] );

	// Attribution runs AFTER the filter so entries a plugin's own parser
	// contributed are attributed too — `parse()` never sees them.
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

/**
 * Truncate a source's file.
 *
 * @param Os                  $os     Host handle.
 * @param array<string,mixed> $source Normalised source.
 * @return true|string `true`, or an error message.
 */
function clear( Os $os, array $source ) {
	if ( ! $source['exists'] ) {
		return true;
	}
	if ( ! $source['writable'] ) {
		return __( 'The log file is not writable, so it cannot be cleared.', 'desktop-mode' );
	}
	// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents -- Truncating a server-side log the descriptor already validated.
	if ( false === file_put_contents( $source['path'], '' ) ) {
		return __( 'Clearing the log file failed.', 'desktop-mode' );
	}
	/**
	 * Fires after Code Blue truncates a log file.
	 *
	 * @param string $id   Source id.
	 * @param string $path Absolute path.
	 */
	$os->action( 'openstation_code_blue_log_cleared', $source['id'], $source['path'] );
	return true;
}

/**
 * The URL template the "Search the web" link on an issue resolves
 * against — `%s` is the URL-encoded message. Looking an unfamiliar
 * error up is the next thing anyone does after reading it, and where
 * they look is a house style: an agency may want its own wiki, a
 * hosting platform its own knowledge base.
 *
 * Return an empty string to drop the link entirely.
 *
 * @param Os $os Host handle.
 * @return string URL template containing `%s`, or '' for no link.
 */
function search_url( Os $os ) {
	/**
	 * Filter the search URL template for a log message.
	 *
	 * @param string $template `%s` is replaced with the URL-encoded
	 *                         message. Empty string hides the link.
	 */
	return (string) $os->filter( 'openstation_code_blue_search_url', 'https://duckduckgo.com/?q=%s' );
}

/**
 * The environment card: debug switches and versions.
 *
 * @param Os $os Host handle.
 * @return array[] Each: `label`, `value`, `on` (bool|null).
 */
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

	/**
	 * Filter the environment rows shown in the Code Blue window.
	 *
	 * @param array[] $rows Each: `label`, `value`, `on` (bool|null).
	 */
	return (array) $os->filter( 'openstation_code_blue_environment', $rows );
}
