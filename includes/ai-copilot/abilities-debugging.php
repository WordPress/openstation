<?php
/**
 * OpenStation — the error-investigation skill.
 *
 * Four read-only WordPress Abilities that together give an assistant or
 * an agent enough to do what a developer does with a stack trace: find
 * out what is failing, read the code at the line that failed, learn
 * whose code it is and what version of everything it is running on —
 * and then say what it thinks the fix is.
 *
 *   list_log_issues      what is failing, grouped and counted
 *   get_log_issue        one issue in full, with its stack trace
 *   read_source_excerpt  the code around a line the log named
 *   get_site_context     versions, debug flags, active plugins + theme
 *
 * **The skill proposes; it never repairs.** That is structural, not a
 * matter of prompting: every ability here is `readonly`, and no writing
 * counterpart exists, so a model handed this whole set can read the
 * evidence and describe a patch and has no route to apply one. The
 * prompt appendix below says the same thing in words, because a model
 * that does not know it cannot edit files tends to answer as though it
 * already had.
 *
 * All four read through Code Blue's own model (`log-reader.php`), so
 * the assistant and the window can never disagree about what the log
 * says or whose plugin a file belongs to.
 *
 * Read `docs/agents-security.md` before adding to this file. The
 * dangerous one is `read_source_excerpt` — see the guards on
 * {@see openstation_ai_debug_resolve_source_path()}.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

use function OpenStation\Apps\CodeBlue\can_use;
use function OpenStation\Apps\CodeBlue\read as read_log;
use function OpenStation\Apps\CodeBlue\sources as log_sources;
use function OpenStation\Apps\CodeBlue\usable as log_usable;

/** Longest excerpt `read_source_excerpt` will return, in lines. */
const OPENSTATION_AI_DEBUG_MAX_EXCERPT = 200;

/**
 * Who may use the debugging skill: whoever may open Code Blue.
 *
 * Deliberately the same gate rather than a new one. These abilities are
 * the window's contents addressed by an assistant instead of a pointer,
 * and a site where the log window is off is a site that has said it
 * does not want its error log read — through the UI or otherwise.
 * `openstation_code_blue_user_can_use` moves both at once.
 *
 * @return bool
 */
function openstation_ai_debug_can_use() {
	if ( ! function_exists( 'openstation_apps_os' ) ) {
		return false;
	}
	return can_use( openstation_apps_os() );
}

/**
 * Every parsed entry from a log source, newest first.
 *
 * @param string $source_id Source id, or '' for the first usable one.
 * @return array{source:array<string,mixed>|null,entries:array[],error:string}
 */
function openstation_ai_debug_entries( $source_id = '' ) {
	$os      = openstation_apps_os();
	$sources = log_sources( $os );
	$source  = null;
	foreach ( $sources as $candidate ) {
		if ( ! log_usable( $candidate ) ) {
			continue;
		}
		if ( '' === $source_id || $candidate['id'] === $source_id ) {
			$source = $candidate;
			break;
		}
	}
	if ( null === $source ) {
		return array(
			'source'  => null,
			'entries' => array(),
			'error'   => '' === $source_id
				? __( 'No readable log file was found on this install.', 'desktop-mode' )
				: __( 'No readable log file matches that source id.', 'desktop-mode' ),
		);
	}

	$read = read_log( $os, $source );
	return array(
		'source'  => $source,
		'entries' => array_reverse( $read['entries'] ),
		'error'   => (string) $read['error'],
	);
}

/**
 * Fold entries into issues by signature — same key the window groups
 * on, computed once in `log-reader.php`, so an issue the assistant
 * names is the issue the user is looking at.
 *
 * This is not the window's `groupEntries()`: that one folds what
 * survived the user's range and search filters, in the browser, and
 * exists so those filters cost nothing. This one folds the whole read.
 *
 * @param array[] $entries Parsed entries.
 * @param int     $since   Unix seconds floor, or 0 for no floor.
 * @return array[] Issues, most recent first.
 */
function openstation_ai_debug_group( array $entries, $since = 0 ) {
	$issues = array();
	foreach ( $entries as $entry ) {
		$stamp = isset( $entry['timestamp'] ) ? $entry['timestamp'] : null;
		if ( $since > 0 && ( null === $stamp || $stamp < $since ) ) {
			continue;
		}
		$key = (string) $entry['signature'];
		if ( ! isset( $issues[ $key ] ) ) {
			$issues[ $key ] = array(
				'signature'  => $key,
				'level'      => (string) $entry['level'],
				'label'      => (string) $entry['label'],
				'message'    => (string) $entry['message'],
				'file'       => (string) $entry['file'],
				'line'       => (int) $entry['line'],
				'origin'     => isset( $entry['origin'] ) ? $entry['origin'] : array(
					'kind' => 'unknown',
					'slug' => '',
				),
				'count'      => 0,
				'first_seen' => $stamp,
				'last_seen'  => $stamp,
				'trace'      => (string) $entry['trace'],
			);
		}
		$issue = &$issues[ $key ];
		++$issue['count'];
		// The longest trace wins: a fatal is logged repeatedly and only
		// some occurrences carry the full frame list.
		if ( strlen( (string) $entry['trace'] ) > strlen( $issue['trace'] ) ) {
			$issue['trace'] = (string) $entry['trace'];
		}
		if ( null !== $stamp ) {
			$issue['first_seen'] = null === $issue['first_seen'] ? $stamp : min( $issue['first_seen'], $stamp );
			$issue['last_seen']  = null === $issue['last_seen'] ? $stamp : max( $issue['last_seen'], $stamp );
		}
		unset( $issue );
	}
	return array_values( $issues );
}

/**
 * Attach the human name behind an origin slug — "woocommerce" is what
 * the path says, "WooCommerce 9.4.2" is what the developer knows it
 * as, and the version is half of every compatibility answer.
 *
 * Lives here rather than in the app because resolving it needs
 * WordPress; `log-reader.php` runs on hosts that have no `get_plugins()`.
 *
 * @param array<string,string> $origin `kind` + `slug` from the log model.
 * @return array<string,string> The same, plus `name` and `version` when known.
 */
function openstation_ai_debug_name_origin( array $origin ) {
	$origin += array(
		'kind' => 'unknown',
		'slug' => '',
	);
	$origin['name']    = '';
	$origin['version'] = '';

	if ( 'core' === $origin['kind'] ) {
		$origin['name']    = 'WordPress';
		$origin['version'] = (string) get_bloginfo( 'version' );
		return $origin;
	}
	if ( '' === $origin['slug'] ) {
		return $origin;
	}

	if ( 'theme' === $origin['kind'] ) {
		$theme = wp_get_theme( $origin['slug'] );
		if ( $theme->exists() ) {
			$origin['name']    = (string) $theme->get( 'Name' );
			$origin['version'] = (string) $theme->get( 'Version' );
		}
		return $origin;
	}

	if ( ! function_exists( 'get_plugins' ) ) {
		require_once ABSPATH . 'wp-admin/includes/plugin.php';
	}
	$plugins = 'mu-plugin' === $origin['kind'] ? get_mu_plugins() : get_plugins();
	foreach ( $plugins as $file => $data ) {
		$slug = false === strpos( $file, '/' ) ? preg_replace( '/\.php$/', '', $file ) : dirname( $file );
		if ( $slug === $origin['slug'] ) {
			$origin['name']    = (string) $data['Name'];
			$origin['version'] = (string) $data['Version'];
			break;
		}
	}
	return $origin;
}

/**
 * Every file path the current log names — in an entry's `file` field or
 * anywhere inside a stack trace.
 *
 * This set is the allowlist `read_source_excerpt` resolves against, and
 * it is the guard that matters. Bounding source reads to "files this
 * install has already written into its own error log" means the
 * ability can never widen what the caller can see: a path only enters
 * the set because something already failed there, and the log itself
 * is readable to exactly the same people. An ability that took any
 * path under ABSPATH would instead be a general file-read tool wearing
 * a debugging label — reachable, through the assistant, by whatever
 * text the model happens to be reading.
 *
 * @param array[] $entries Parsed entries.
 * @return array<string,true> Paths as keys.
 */
function openstation_ai_debug_known_paths( array $entries ) {
	$paths = array();
	foreach ( $entries as $entry ) {
		if ( ! empty( $entry['file'] ) ) {
			$paths[ str_replace( '\\', '/', (string) $entry['file'] ) ] = true;
		}
		if ( empty( $entry['trace'] ) ) {
			continue;
		}
		// Stack-trace frames: `#0 /abs/path/file.php(123): fn()`, and
		// the `thrown in /abs/path` tail.
		if ( preg_match_all( '#(/[^\s:()\'"]+\.(?:php|inc))#', (string) $entry['trace'], $found ) ) {
			foreach ( $found[1] as $path ) {
				$paths[ $path ] = true;
			}
		}
	}
	return $paths;
}

/**
 * Resolve a requested source path, or explain why not.
 *
 * Four gates, in order of what each one closes:
 *
 *   1. The path must be one the current log names — see
 *      {@see openstation_ai_debug_known_paths()}. This is the real
 *      boundary; the rest are belt and braces for the day someone
 *      relaxes it.
 *   2. It must resolve (symlinks included) inside the WordPress root
 *      or the content directory. `realpath()` before the prefix test,
 *      so `../` cannot walk out.
 *   3. It must be a source file by extension. A log can name a `.log`
 *      or a `.sql`; those are data, and data is where secrets live.
 *   4. Configuration is refused outright even when the log names it —
 *      and a fatal inside `wp-config.php` does name it. That file is
 *      the database password, the salts and the keys; nobody debugging
 *      a stack trace needs it echoed back through a language model.
 *
 * @param string             $file    Requested absolute path.
 * @param array<string,true> $allowed Paths the log names.
 * @return string|WP_Error Real path, or the reason it was refused.
 */
function openstation_ai_debug_resolve_source_path( $file, array $allowed ) {
	$requested = str_replace( '\\', '/', (string) $file );
	if ( ! isset( $allowed[ $requested ] ) ) {
		return new WP_Error(
			'openstation_ai_debug_unknown_file',
			__( 'That file is not named anywhere in the current log. Only files an entry or a stack trace mentions can be read.', 'desktop-mode' )
		);
	}

	$real = realpath( $requested );
	if ( false === $real || ! is_file( $real ) || ! is_readable( $real ) ) {
		return new WP_Error( 'openstation_ai_debug_unreadable', __( 'That file does not exist on disk or cannot be read.', 'desktop-mode' ) );
	}
	$real = str_replace( '\\', '/', $real );

	$roots = array( realpath( ABSPATH ), realpath( WP_CONTENT_DIR ) );
	$in    = false;
	foreach ( $roots as $root ) {
		if ( false !== $root && 0 === strpos( $real, rtrim( str_replace( '\\', '/', $root ), '/' ) . '/' ) ) {
			$in = true;
			break;
		}
	}
	if ( ! $in ) {
		return new WP_Error( 'openstation_ai_debug_outside_root', __( 'That file lives outside the WordPress installation.', 'desktop-mode' ) );
	}

	if ( ! preg_match( '/\.(php|inc|js|jsx|ts|tsx|css|scss)$/i', $real ) ) {
		return new WP_Error( 'openstation_ai_debug_not_source', __( 'Only source files can be read — not logs, dumps, or data files.', 'desktop-mode' ) );
	}

	$base = strtolower( basename( $real ) );
	if ( in_array( $base, array( 'wp-config.php', 'wp-config-sample.php' ), true ) || preg_match( '/^\.env/', $base ) ) {
		return new WP_Error(
			'openstation_ai_debug_secret_file',
			__( 'Configuration files are never readable through this tool — they hold database credentials and salts. Describe what you need from it instead.', 'desktop-mode' )
		);
	}

	return $real;
}

/**
 * Read `$context` lines either side of `$line`.
 *
 * @param string $path    Resolved real path.
 * @param int    $line    Centre line, 1-based; 0 reads from the top.
 * @param int    $context Lines either side.
 * @return array<string,mixed>
 */
function openstation_ai_debug_excerpt( $path, $line, $context ) {
	// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file -- Reading a source file already resolved and allowlisted above; WP_Filesystem adds nothing here and is not available this early on every host.
	$all = file( $path, FILE_IGNORE_NEW_LINES );
	if ( false === $all ) {
		return array(
			'file'  => $path,
			'lines' => array(),
			'error' => __( 'The file could not be read.', 'desktop-mode' ),
		);
	}

	$total = count( $all );
	$line  = max( 0, min( (int) $line, $total ) );
	$start = $line > 0 ? max( 1, $line - $context ) : 1;
	$end   = $line > 0 ? min( $total, $line + $context ) : min( $total, OPENSTATION_AI_DEBUG_MAX_EXCERPT );

	$lines = array();
	for ( $n = $start; $n <= $end; $n++ ) {
		$lines[] = array(
			'number' => $n,
			'text'   => $all[ $n - 1 ],
		);
	}

	return array(
		'file'        => $path,
		'total_lines' => $total,
		'start_line'  => $start,
		'end_line'    => $end,
		'lines'       => $lines,
		'error'       => '',
	);
}

/**
 * Registers the debugging abilities.
 *
 * @return void
 */
function openstation_ai_register_debug_abilities() {
	if ( ! function_exists( 'wp_register_ability' ) ) {
		return;
	}

	// Never `mcp.public`: the log and the source behind it are this
	// site's internals, and an external agent has no business in them
	// however read-only the tools are.
	$meta = array(
		'annotations'  => array(
			'readonly'   => true,
			'idempotent' => true,
		),
		'show_in_rest' => true,
	);

	wp_register_ability(
		'desktop-mode/list-log-issues',
		array(
			'label'               => __( 'List error-log issues', 'desktop-mode' ),
			'description'         => 'Lists what is currently failing on this site: the PHP error log parsed into DISTINCT issues rather than raw lines, so a fatal that fired 400 times is one entry with count 400. Start every debugging investigation here. Each issue carries { signature, level, label, message, file, line, count, first_seen, last_seen, origin } where `origin` says whose code it is ({ kind: plugin|mu-plugin|theme|core|unknown, slug, name, version }) and `signature` is the id you pass to get_log_issue and quote back to the user. Stack traces are NOT included — call get_log_issue for the one you are working on. Administrators with Developer mode on only.',
			'category'            => OPENSTATION_AI_ABILITY_CATEGORY,
			'input_schema'        => array(
				'type'                 => 'object',
				'additionalProperties' => false,
				'required'             => array( 'limit' ),
				'properties'           => array(
					'limit'  => array(
						'type'        => 'integer',
						'description' => 'How many issues to return, most recently seen first (1-50). Use 10 unless the user asked for a survey.',
					),
					'range'  => array(
						'type'        => 'string',
						'enum'        => array( '1h', '24h', '7d', '30d', 'all' ),
						'description' => 'How far back to look. Defaults to `all`. Narrow it when the user says "since I updated" or "today".',
					),
					'source' => array(
						'type'        => 'string',
						'description' => 'Log source id. Omit for the first readable one, which is what the user sees by default.',
					),
					'level'  => array(
						'type'        => 'string',
						'enum'        => array( 'fatal', 'error', 'warning', 'deprecated', 'notice', 'info' ),
						'description' => 'Only issues at this severity. Omit for all. `fatal` is what breaks a site; `deprecated` is usually noise.',
					),
				),
			),
			'output_schema'       => openstation_ai_ability_output_schema(
				array(
					'issues'  => array(
						'type'        => 'array',
						'description' => 'Grouped issues, most recently seen first.',
					),
					'count'   => array( 'type' => 'integer' ),
					'source'  => array(
						'type'        => 'object',
						'description' => 'The log that was read: { id, label, path, size }.',
					),
					'message' => array(
						'type'        => 'string',
						'description' => 'Set when no log could be read — explain it to the user rather than guessing.',
					),
				)
			),
			'execute_callback'    => 'openstation_ai_debug_list_issues',
			'permission_callback' => 'openstation_ai_debug_can_use',
			'meta'                => $meta,
		)
	);

	wp_register_ability(
		'desktop-mode/get-log-issue',
		array(
			'label'               => __( 'Get one error-log issue', 'desktop-mode' ),
			'description'         => 'Returns ONE issue from the error log in full, including its stack trace, by the `signature` you got from list_log_issues. Call this on the issue you are actually investigating — the trace names the file and line where the failure started and the chain of calls that reached it, which is what you read the source at. The trace is verbatim server output: paths in it are real paths you may pass to read_source_excerpt.',
			'category'            => OPENSTATION_AI_ABILITY_CATEGORY,
			'input_schema'        => array(
				'type'                 => 'object',
				'additionalProperties' => false,
				'required'             => array( 'signature' ),
				'properties'           => array(
					'signature' => array(
						'type'        => 'string',
						'description' => 'The issue id from a prior list_log_issues call. Pass it exactly as given.',
					),
					'source'    => array(
						'type'        => 'string',
						'description' => 'Log source id, if you passed one to list_log_issues.',
					),
				),
			),
			'output_schema'       => openstation_ai_ability_output_schema(
				array(
					'issue'   => array(
						'type'        => 'object',
						'description' => 'The issue with its `trace`, or absent when the signature is unknown.',
					),
					'message' => array( 'type' => 'string' ),
				)
			),
			'execute_callback'    => 'openstation_ai_debug_get_issue',
			'permission_callback' => 'openstation_ai_debug_can_use',
			'meta'                => $meta,
		)
	);

	wp_register_ability(
		'desktop-mode/read-source-excerpt',
		array(
			'label'               => __( 'Read source around a logged line', 'desktop-mode' ),
			'description'         => 'Reads the PHP (or JS/CSS) source around a line the error log named, so you can see the code that failed instead of guessing at it. Pass a `file` path and `line` taken from an issue or from its stack trace. Returns numbered lines so you can quote them precisely. IMPORTANT LIMITS, and they are refusals rather than empty results: only files the CURRENT log actually mentions can be read, only inside this WordPress install, only source extensions, and never wp-config.php or a .env — if you need a value from configuration, ask the user for it. You are reading this file to EXPLAIN and to PROPOSE a change; you have no ability to write it, so give the user the edit to make.',
			'category'            => OPENSTATION_AI_ABILITY_CATEGORY,
			'input_schema'        => array(
				'type'                 => 'object',
				'additionalProperties' => false,
				'required'             => array( 'file', 'line' ),
				'properties'           => array(
					'file'    => array(
						'type'        => 'string',
						'description' => 'Absolute path exactly as the log wrote it — from an issue\'s `file` or a path inside its stack trace.',
					),
					'line'    => array(
						'type'        => 'integer',
						'description' => 'The line to centre on. Use 0 to read from the top of the file (a class or function you need the shape of).',
					),
					'context' => array(
						'type'        => 'integer',
						'description' => 'Lines either side of `line` (1-100). Defaults to 25 — enough for the enclosing function. Widen once if the cause is clearly further up.',
					),
				),
			),
			'output_schema'       => openstation_ai_ability_output_schema(
				array(
					'file'        => array( 'type' => 'string' ),
					'total_lines' => array( 'type' => 'integer' ),
					'start_line'  => array( 'type' => 'integer' ),
					'end_line'    => array( 'type' => 'integer' ),
					'lines'       => array(
						'type'        => 'array',
						'description' => 'Numbered source lines: { number, text }.',
					),
				)
			),
			'execute_callback'    => 'openstation_ai_debug_read_source',
			'permission_callback' => 'openstation_ai_debug_can_use',
			'meta'                => $meta,
		)
	);

	wp_register_ability(
		'desktop-mode/get-site-context',
		array(
			'label'               => __( 'Get site debugging context', 'desktop-mode' ),
			'description'         => 'Returns what this site is actually running: WordPress and PHP versions, the debug constants, the environment type, the active theme, and every active plugin with its version. Call this before proposing a fix — most WordPress errors are a version story ("that function was removed in PHP 8.1", "that plugin has not been updated since 2021"), and the answer is not in the log. Contains no credentials.',
			'category'            => OPENSTATION_AI_ABILITY_CATEGORY,
			'input_schema'        => array(
				'type'                 => 'object',
				'additionalProperties' => false,
				'required'             => array(),
				'properties'           => (object) array(),
			),
			'output_schema'       => openstation_ai_ability_output_schema(
				array(
					'wordpress'   => array( 'type' => 'object' ),
					'php'         => array( 'type' => 'object' ),
					'debug'       => array( 'type' => 'object' ),
					'theme'       => array( 'type' => 'object' ),
					'plugins'     => array(
						'type'        => 'array',
						'description' => 'Active plugins: { name, slug, version }.',
					),
					'mu_plugins'  => array( 'type' => 'array' ),
				)
			),
			'execute_callback'    => 'openstation_ai_debug_site_context',
			'permission_callback' => 'openstation_ai_debug_can_use',
			'meta'                => $meta,
		)
	);
}
add_action( 'wp_abilities_api_init', 'openstation_ai_register_debug_abilities', 11 );

/**
 * `list_log_issues` — grouped issues from a log source.
 *
 * @param array<string,mixed> $input Validated input.
 * @return array<string,mixed>
 */
function openstation_ai_debug_list_issues( $input ) {
	$input += array(
		'limit'  => 10,
		'range'  => 'all',
		'source' => '',
		'level'  => '',
	);

	$read = openstation_ai_debug_entries( (string) $input['source'] );
	if ( null === $read['source'] ) {
		return array(
			'issues'  => array(),
			'count'   => 0,
			'message' => $read['error'],
		);
	}

	$spans  = array(
		'1h'  => HOUR_IN_SECONDS,
		'24h' => DAY_IN_SECONDS,
		'7d'  => WEEK_IN_SECONDS,
		'30d' => MONTH_IN_SECONDS,
		'all' => 0,
	);
	$span   = isset( $spans[ $input['range'] ] ) ? $spans[ $input['range'] ] : 0;
	$issues = openstation_ai_debug_group( $read['entries'], $span > 0 ? time() - $span : 0 );

	$level = (string) $input['level'];
	if ( '' !== $level ) {
		$issues = array_values(
			array_filter(
				$issues,
				static function ( $issue ) use ( $level ) {
					return $issue['level'] === $level;
				}
			)
		);
	}

	$limit  = max( 1, min( 50, (int) $input['limit'] ) );
	$issues = array_slice( $issues, 0, $limit );
	foreach ( $issues as $index => $issue ) {
		// The list is a triage view: the trace is the expensive half and
		// only the issue being worked on needs it.
		unset( $issues[ $index ]['trace'] );
		$issues[ $index ]['origin'] = openstation_ai_debug_name_origin( (array) $issue['origin'] );
	}

	return array(
		'issues'  => $issues,
		'count'   => count( $issues ),
		'source'  => array(
			'id'    => $read['source']['id'],
			'label' => $read['source']['label'],
			'path'  => $read['source']['path'],
			'size'  => $read['source']['size'],
		),
		'message' => $read['error'],
	);
}

/**
 * `get_log_issue` — one issue, trace included.
 *
 * @param array<string,mixed> $input Validated input.
 * @return array<string,mixed>
 */
function openstation_ai_debug_get_issue( $input ) {
	$signature = isset( $input['signature'] ) ? (string) $input['signature'] : '';
	$read      = openstation_ai_debug_entries( isset( $input['source'] ) ? (string) $input['source'] : '' );
	if ( null === $read['source'] ) {
		return array( 'message' => $read['error'] );
	}

	foreach ( openstation_ai_debug_group( $read['entries'] ) as $issue ) {
		if ( $issue['signature'] === $signature ) {
			$issue['origin'] = openstation_ai_debug_name_origin( (array) $issue['origin'] );
			return array(
				'issue'   => $issue,
				'message' => '',
			);
		}
	}

	return array(
		'message' => __( 'No issue in the current log has that signature — it may have been cleared or aged out. Call list_log_issues again.', 'desktop-mode' ),
	);
}

/**
 * `read_source_excerpt` — code around a logged line.
 *
 * @param array<string,mixed> $input Validated input.
 * @return array<string,mixed>|WP_Error
 */
function openstation_ai_debug_read_source( $input ) {
	$read = openstation_ai_debug_entries();
	if ( null === $read['source'] ) {
		return new WP_Error( 'openstation_ai_debug_no_log', $read['error'] );
	}

	$path = openstation_ai_debug_resolve_source_path(
		isset( $input['file'] ) ? (string) $input['file'] : '',
		openstation_ai_debug_known_paths( $read['entries'] )
	);
	if ( is_wp_error( $path ) ) {
		return $path;
	}

	$context = isset( $input['context'] ) ? (int) $input['context'] : 25;
	return openstation_ai_debug_excerpt( $path, isset( $input['line'] ) ? (int) $input['line'] : 0, max( 1, min( 100, $context ) ) );
}

/**
 * `get_site_context` — versions, flags, active code.
 *
 * @return array<string,mixed>
 */
function openstation_ai_debug_site_context() {
	if ( ! function_exists( 'get_plugins' ) ) {
		require_once ABSPATH . 'wp-admin/includes/plugin.php';
	}

	$active  = array();
	$plugins = get_plugins();
	foreach ( $plugins as $file => $data ) {
		if ( ! is_plugin_active( $file ) && ! ( is_multisite() && is_plugin_active_for_network( $file ) ) ) {
			continue;
		}
		$active[] = array(
			'name'    => (string) $data['Name'],
			'slug'    => false === strpos( $file, '/' ) ? preg_replace( '/\.php$/', '', $file ) : dirname( $file ),
			'version' => (string) $data['Version'],
		);
	}

	$mu = array();
	foreach ( get_mu_plugins() as $file => $data ) {
		$mu[] = array(
			'name'    => (string) $data['Name'],
			'slug'    => preg_replace( '/\.php$/', '', $file ),
			'version' => (string) $data['Version'],
		);
	}

	$theme = wp_get_theme();
	$debug = array();
	foreach ( array( 'WP_DEBUG', 'WP_DEBUG_LOG', 'WP_DEBUG_DISPLAY', 'SCRIPT_DEBUG', 'SAVEQUERIES', 'WP_DISABLE_FATAL_ERROR_HANDLER' ) as $constant ) {
		$debug[ $constant ] = defined( $constant ) ? (bool) constant( $constant ) : false;
	}

	return array(
		'wordpress'  => array(
			'version'          => (string) get_bloginfo( 'version' ),
			'multisite'        => is_multisite(),
			'environment_type' => function_exists( 'wp_get_environment_type' ) ? wp_get_environment_type() : 'production',
			'locale'           => (string) get_locale(),
		),
		'php'        => array(
			'version'       => PHP_VERSION,
			'memory_limit'  => (string) ini_get( 'memory_limit' ),
			'max_execution' => (string) ini_get( 'max_execution_time' ),
			'extensions'    => array_values( array_intersect( get_loaded_extensions(), array( 'curl', 'gd', 'imagick', 'intl', 'mbstring', 'mysqli', 'openssl', 'zip' ) ) ),
		),
		'debug'      => $debug,
		'theme'      => array(
			'name'     => (string) $theme->get( 'Name' ),
			'slug'     => (string) $theme->get_stylesheet(),
			'version'  => (string) $theme->get( 'Version' ),
			'template' => (string) $theme->get_template(),
		),
		'plugins'    => $active,
		'mu_plugins' => $mu,
	);
}

/**
 * The behavioural half of the skill.
 *
 * The abilities make investigation possible; this makes it a method,
 * and it states the one rule the tools cannot state for themselves. A
 * model that does not know it is unable to edit files will happily
 * answer "I've fixed that for you" — the ceiling is real either way,
 * but the sentence is a lie the user then has to discover.
 *
 * Only added for callers who can actually use the tools: a subscriber
 * asking about a post has no use for a debugging protocol, and every
 * unused line in a system prompt is paid for on every turn.
 *
 * @param string              $appendix Appendix so far.
 * @param array<string,mixed> $ctx      Request context.
 * @return string
 */
function openstation_ai_debug_prompt_appendix( $appendix, $ctx = array() ) {
	unset( $ctx );
	if ( ! openstation_ai_debug_can_use() ) {
		return $appendix;
	}

	$skill = <<<'PROMPT'
## Investigating an error

When the user reports something broken, asks about errors, or shows you
a log message, work the evidence rather than guessing from the message
alone:

1. `list_log_issues` — what is failing, and how often. A fatal error
   with a high count is the story; deprecation notices usually are not.
2. `get_log_issue` — the stack trace for the one you are working on.
   Read it from the bottom up: the last frame is where it broke, the
   frames above it are who asked.
3. `read_source_excerpt` — the actual code at that line, and at the
   caller if the line alone does not explain it. Never describe code you
   have not read.
4. `get_site_context` — versions and debug flags. A large share of
   WordPress fatals are a PHP-version or plugin-version story.

Then answer with: what is failing, in one sentence; whose code it is
(name the plugin or theme, with its version); why it happens, citing the
lines you read; and the change you would make, as a short diff or a
precise "in FILE, line N, replace X with Y".

**You can read this site but you cannot change it.** Every tool here is
read-only — there is no ability that edits a file, deactivates a plugin,
or runs an update. So propose the fix and let the user apply it. Never
say you have fixed, changed, patched or disabled anything; if the safest
next step is deactivating a plugin or rolling back a version, say so as
a recommendation and let them decide. Where a fix carries risk — a
change inside a plugin that an update will overwrite, an edit to a theme
without a child theme — say that too.
PROMPT;

	return '' === $appendix ? $skill : $appendix . "\n\n" . $skill;
}
add_filter( 'openstation_ai_system_prompt_appendix', 'openstation_ai_debug_prompt_appendix', 10, 2 );
