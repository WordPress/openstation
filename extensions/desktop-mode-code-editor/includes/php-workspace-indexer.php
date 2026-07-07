<?php
/**
 * Workspace PHP symbol indexer for the Code Editor extension.
 *
 * Phase 5a indexed WP core. This module covers the user's own
 * plugins / themes — functions, classes, interfaces, traits, and
 * locally-declared hooks. The two indexes merge through the
 * `desktop_mode_code_editor_php_index_extra_symbols` filter seam, so
 * Monaco's existing completion + hover providers light up workspace
 * symbols with zero changes to the JS layer.
 *
 * @package DesktopModeCodeEditor
 * @since   0.7.0
 */

defined( 'ABSPATH' ) || exit;

/** Storage version — bump to force a full rebuild after schema changes. */
const DESKTOP_MODE_CODE_EDITOR_WORKSPACE_INDEX_VERSION = 2;

/** Transient key for the workspace index. */
const DESKTOP_MODE_CODE_EDITOR_WORKSPACE_INDEX_KEY = 'desktop_mode_code_editor_workspace_index';

/** TTL — long, but not forever. Stale entries get refreshed on demand. */
const DESKTOP_MODE_CODE_EDITOR_WORKSPACE_INDEX_TTL = 30 * DAY_IN_SECONDS;

/**
 * Directory + file-name patterns the workspace walker skips.
 */
const DESKTOP_MODE_CODE_EDITOR_WORKSPACE_DEFAULT_SKIP_DIRS = array(
	'uploads',
	'cache',
	'languages',
	'vendor',
	'node_modules',
	'.git',
	'.svn',
);

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

/**
 * Read the cached index.
 *
 * @since 0.7.0
 *
 * @return array{ version: int, files: array<string, array> }
 */
function desktop_mode_code_editor_get_workspace_index() {
	$cached = get_transient( DESKTOP_MODE_CODE_EDITOR_WORKSPACE_INDEX_KEY );
	if (
		is_array( $cached ) &&
		isset( $cached['version'], $cached['files'] ) &&
		(int) $cached['version'] === DESKTOP_MODE_CODE_EDITOR_WORKSPACE_INDEX_VERSION
	) {
		return $cached;
	}
	return array(
		'version' => DESKTOP_MODE_CODE_EDITOR_WORKSPACE_INDEX_VERSION,
		'files'   => array(),
	);
}

/** Persist the index back to its transient. */
function desktop_mode_code_editor_save_workspace_index( array $index ) {
	$index['version'] = DESKTOP_MODE_CODE_EDITOR_WORKSPACE_INDEX_VERSION;
	set_transient(
		DESKTOP_MODE_CODE_EDITOR_WORKSPACE_INDEX_KEY,
		$index,
		DESKTOP_MODE_CODE_EDITOR_WORKSPACE_INDEX_TTL
	);
}

/** Drop the cache; next read rebuilds. */
function desktop_mode_code_editor_flush_workspace_index() {
	delete_transient( DESKTOP_MODE_CODE_EDITOR_WORKSPACE_INDEX_KEY );
}

// ---------------------------------------------------------------------------
// Walker — discovers files to index.
// ---------------------------------------------------------------------------

/**
 * Yield every PHP file under the workspace root that's eligible
 * for indexing.
 *
 * @since 0.7.0
 * @internal
 *
 * @return Generator<string> Absolute paths.
 */
function desktop_mode_code_editor_iter_workspace_php_files() {
	$root = desktop_mode_code_editor_workspace_root();
	if ( '' === $root ) {
		return;
	}

	/**
	 * Filter the list of subdirectory names that the workspace
	 * walker skips. Comparison is by exact basename.
	 *
	 * @since 0.7.0
	 *
	 * @param string[] $dirs
	 */
	$skip_dirs = (array) apply_filters(
		'desktop_mode_code_editor_workspace_index_skip_dirs',
		DESKTOP_MODE_CODE_EDITOR_WORKSPACE_DEFAULT_SKIP_DIRS
	);
	$skip_dirs = array_map( 'strval', $skip_dirs );

	/**
	 * Optional regex run against each filename — return non-empty
	 * to provide a custom skip pattern.
	 *
	 * @since 0.7.0
	 *
	 * @param string $regex
	 */
	$skip_re = (string) apply_filters( 'desktop_mode_code_editor_workspace_index_skip_filename_re', '' );

	$dir_iter    = new RecursiveDirectoryIterator( $root, FilesystemIterator::SKIP_DOTS );
	$filter_iter = new RecursiveCallbackFilterIterator(
		$dir_iter,
		static function ( $entry ) use ( $skip_dirs ) {
			/** @var SplFileInfo $entry */
			$name = $entry->getFilename();
			if ( '' === $name || '.' === $name[0] ) {
				return false;
			}
			if ( $entry->isDir() && in_array( $name, $skip_dirs, true ) ) {
				return false;
			}
			return true;
		}
	);
	$it = new RecursiveIteratorIterator( $filter_iter );

	foreach ( $it as $file ) {
		/** @var SplFileInfo $file */
		if ( ! $file->isFile() ) {
			continue;
		}
		if ( 'php' !== strtolower( $file->getExtension() ) ) {
			continue;
		}
		$path = $file->getPathname();
		// phpcs:ignore WordPress.PHP.NoSilencedErrors
		if ( '' !== $skip_re && @preg_match( $skip_re, $file->getFilename() ) ) {
			continue;
		}
		yield $path;
	}
}

// ---------------------------------------------------------------------------
// Tokenizer-driven file scan
// ---------------------------------------------------------------------------

/**
 * Scan a single PHP file, return its symbols.
 *
 * @since 0.7.0
 *
 * @param string $absolute_path File to scan.
 * @return array[] List of symbol entries.
 */
function desktop_mode_code_editor_scan_workspace_file( $absolute_path ) {
	// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
	$source = @file_get_contents( $absolute_path );
	if ( false === $source ) {
		return array();
	}
	$tokens = @token_get_all( $source ); // phpcs:ignore WordPress.PHP.NoSilencedErrors
	if ( ! is_array( $tokens ) ) {
		return array();
	}

	$rel_path = desktop_mode_code_editor_path_to_relative( $absolute_path );
	$symbols  = array();
	$count    = count( $tokens );

	$ns                  = '';
	$last_doc_comment    = '';
	$brace_depth         = 0;
	$class_open_at_depth = -1;

	for ( $i = 0; $i < $count; $i++ ) {
		$tok = $tokens[ $i ];

		if ( is_array( $tok ) && T_DOC_COMMENT === $tok[0] ) {
			$last_doc_comment = $tok[1];
			continue;
		}
		if ( is_array( $tok ) && in_array( $tok[0], array( T_WHITESPACE, T_COMMENT ), true ) ) {
			continue;
		}

		if ( ! is_array( $tok ) ) {
			if ( '{' === $tok ) {
				$brace_depth++;
			} elseif ( '}' === $tok ) {
				$brace_depth--;
				if ( $class_open_at_depth >= 0 && $brace_depth < $class_open_at_depth ) {
					$class_open_at_depth = -1;
				}
			}
		}

		if ( is_array( $tok ) && T_NAMESPACE === $tok[0] ) {
			$ns               = desktop_mode_code_editor_collect_namespace_name( $tokens, $i + 1 );
			$last_doc_comment = '';
			continue;
		}

		if ( is_array( $tok ) && in_array( $tok[0], array( T_CLASS, T_INTERFACE, T_TRAIT ), true ) ) {
			$next = desktop_mode_code_editor_next_significant_token( $tokens, $i + 1 );
			if ( null === $next || ! is_array( $tokens[ $next ] ) || T_STRING !== $tokens[ $next ][0] ) {
				continue;
			}
			$short_name = $tokens[ $next ][1];
			$kind       = T_INTERFACE === $tok[0] ? 'interface' : ( T_TRAIT === $tok[0] ? 'trait' : 'class' );
			$fqn        = '' !== $ns ? $ns . '\\' . $short_name : $short_name;
			$symbols[]  = array(
				'name'      => $fqn,
				'kind'      => $kind,
				'signature' => $kind . ' ' . $fqn,
				'doc'       => desktop_mode_code_editor_phpdoc_summary( $last_doc_comment ),
				'since'     => desktop_mode_code_editor_phpdoc_tag( $last_doc_comment, 'since' ),
				'file'      => $rel_path,
				'line'      => is_array( $tok ) ? (int) $tok[2] : 0,
				'source'    => $rel_path . ':' . ( is_array( $tok ) ? (int) $tok[2] : 0 ),
			);
			if ( 'class' === $kind || 'trait' === $kind ) {
				$class_open_at_depth = $brace_depth + 1;
			}
			$last_doc_comment = '';
			continue;
		}

		if ( is_array( $tok ) && T_FUNCTION === $tok[0] ) {
			if ( $class_open_at_depth >= 0 && $brace_depth >= $class_open_at_depth ) {
				$last_doc_comment = '';
				continue;
			}
			$next = desktop_mode_code_editor_next_significant_token( $tokens, $i + 1 );
			if ( null === $next ) {
				continue;
			}
			$next_tok = $tokens[ $next ];
			if ( ! is_array( $next_tok ) ) {
				$last_doc_comment = '';
				continue;
			}
			if ( T_STRING !== $next_tok[0] ) {
				$last_doc_comment = '';
				continue;
			}
			$short_name = $next_tok[1];
			$fqn        = '' !== $ns ? $ns . '\\' . $short_name : $short_name;
			$symbols[]  = array(
				'name'      => $fqn,
				'kind'      => 'function',
				'signature' => $fqn . '()',
				'doc'       => desktop_mode_code_editor_phpdoc_summary( $last_doc_comment ),
				'since'     => desktop_mode_code_editor_phpdoc_tag( $last_doc_comment, 'since' ),
				'file'      => $rel_path,
				'line'      => is_array( $tok ) ? (int) $tok[2] : 0,
				'source'    => $rel_path . ':' . ( is_array( $tok ) ? (int) $tok[2] : 0 ),
			);
			$last_doc_comment = '';
			continue;
		}

		if ( is_array( $tok ) && T_STRING === $tok[0] ) {
			$kind = desktop_mode_code_editor_hook_kind_for_function_name( $tok[1] );
			if ( null !== $kind ) {
				$paren = desktop_mode_code_editor_next_significant_token( $tokens, $i + 1 );
				if ( null !== $paren && '(' === $tokens[ $paren ] ) {
					$arg = desktop_mode_code_editor_next_significant_token( $tokens, $paren + 1 );
					if (
						null !== $arg &&
						is_array( $tokens[ $arg ] ) &&
						T_CONSTANT_ENCAPSED_STRING === $tokens[ $arg ][0]
					) {
						$hook = desktop_mode_code_editor_unquote_string( $tokens[ $arg ][1] );
						if ( '' !== $hook ) {
							$symbols[] = array(
								'name'      => $hook,
								'kind'      => $kind,
								'signature' => $tok[1] . "( '" . $hook . "', … )",
								'doc'       => desktop_mode_code_editor_phpdoc_summary( $last_doc_comment ),
								'since'     => desktop_mode_code_editor_phpdoc_tag( $last_doc_comment, 'since' ),
								'file'      => $rel_path,
								'line'      => (int) $tok[2],
								'source'    => $rel_path . ':' . (int) $tok[2],
							);
						}
					}
				}
			}
			$last_doc_comment = '';
			continue;
		}

		if ( is_array( $tok ) || in_array( $tok, array( ';', ',', '(' ), true ) ) {
			$last_doc_comment = '';
		}
	}

	return $symbols;
}

/**
 * Walk forward from `$start` accumulating namespace name parts.
 *
 * @internal
 */
function desktop_mode_code_editor_collect_namespace_name( array $tokens, $start ) {
	$count = count( $tokens );
	$parts = array();
	for ( $i = $start; $i < $count; $i++ ) {
		$tok = $tokens[ $i ];
		if ( is_array( $tok ) ) {
			if ( in_array( $tok[0], array( T_WHITESPACE, T_COMMENT, T_DOC_COMMENT ), true ) ) {
				continue;
			}
			if ( T_STRING === $tok[0] ) {
				$parts[] = $tok[1];
				continue;
			}
			if ( defined( 'T_NAME_QUALIFIED' ) && T_NAME_QUALIFIED === $tok[0] ) {
				return (string) $tok[1];
			}
			if ( defined( 'T_NAME_FULLY_QUALIFIED' ) && T_NAME_FULLY_QUALIFIED === $tok[0] ) {
				return ltrim( (string) $tok[1], '\\' );
			}
			if ( defined( 'T_NS_SEPARATOR' ) && T_NS_SEPARATOR === $tok[0] ) {
				continue;
			}
		}
		if ( ';' === $tok || '{' === $tok ) {
			break;
		}
	}
	return implode( '\\', $parts );
}

// ---------------------------------------------------------------------------
// Build / refresh
// ---------------------------------------------------------------------------

/**
 * Walk the workspace and refresh the index.
 *
 * @since 0.7.0
 *
 * @param int $file_budget Max files to fully scan in this call.
 * @return array Updated index (also persisted).
 */
function desktop_mode_code_editor_refresh_workspace_index( $file_budget = 200 ) {
	$index = desktop_mode_code_editor_get_workspace_index();
	$files = is_array( $index['files'] ) ? $index['files'] : array();

	$seen    = array();
	$scanned = 0;

	foreach ( desktop_mode_code_editor_iter_workspace_php_files() as $abs ) {
		$rel          = desktop_mode_code_editor_path_to_relative( $abs );
		$seen[ $rel ] = true;

		// phpcs:ignore WordPress.PHP.NoSilencedErrors
		$mtime        = (int) @filemtime( $abs );
		$cached_mtime = isset( $files[ $rel ]['mtime'] ) ? (int) $files[ $rel ]['mtime'] : 0;

		if ( $mtime > 0 && $mtime === $cached_mtime ) {
			continue;
		}
		if ( $scanned >= $file_budget ) {
			break;
		}
		$scanned++;

		$symbols       = desktop_mode_code_editor_scan_workspace_file( $abs );
		$files[ $rel ] = array(
			'mtime'   => $mtime,
			'symbols' => $symbols,
		);
	}

	foreach ( array_keys( $files ) as $rel ) {
		if ( ! isset( $seen[ $rel ] ) ) {
			unset( $files[ $rel ] );
		}
	}

	$index['files'] = $files;
	desktop_mode_code_editor_save_workspace_index( $index );
	return $index;
}

/**
 * Refresh a single file's entry in the workspace index.
 *
 * @since 0.7.0
 *
 * @param string $absolute_path
 */
function desktop_mode_code_editor_refresh_workspace_file( $absolute_path ) {
	$rel = desktop_mode_code_editor_path_to_relative( $absolute_path );
	if ( '' === $rel ) {
		return;
	}
	$index = desktop_mode_code_editor_get_workspace_index();
	$files = is_array( $index['files'] ) ? $index['files'] : array();

	if ( ! is_file( $absolute_path ) ) {
		unset( $files[ $rel ] );
	} else {
		$files[ $rel ] = array(
			// phpcs:ignore WordPress.PHP.NoSilencedErrors
			'mtime'   => (int) @filemtime( $absolute_path ),
			'symbols' => desktop_mode_code_editor_scan_workspace_file( $absolute_path ),
		);
	}

	$index['files'] = $files;
	desktop_mode_code_editor_save_workspace_index( $index );
}

/**
 * Hook into the save flow so the workspace index stays fresh on
 * every successful write.
 *
 * @since 0.7.0
 *
 * @param string $abs Absolute path the user just saved.
 */
function desktop_mode_code_editor_workspace_index_on_save( $abs ) {
	desktop_mode_code_editor_refresh_workspace_file( $abs );
}
add_action( 'desktop_mode_code_editor_after_save', 'desktop_mode_code_editor_workspace_index_on_save', 10, 1 );

// ---------------------------------------------------------------------------
// Read-side: feed workspace symbols into the merged php-symbols pool.
// ---------------------------------------------------------------------------

/**
 * Merge workspace symbols into the WP-core symbol pool.
 *
 * @since 0.7.0
 *
 * @param array $pool Existing pool (from WP core).
 * @return array
 */
function desktop_mode_code_editor_workspace_extend_symbols( $pool ) {
	$index = desktop_mode_code_editor_get_workspace_index();

	if ( empty( $index['files'] ) ) {
		$index = desktop_mode_code_editor_refresh_workspace_index();
	}

	if ( ! is_array( $pool ) ) {
		$pool = array();
	}

	foreach ( $index['files'] as $entry ) {
		if ( ! isset( $entry['symbols'] ) || ! is_array( $entry['symbols'] ) ) {
			continue;
		}
		foreach ( $entry['symbols'] as $sym ) {
			$pool[] = $sym;
		}
	}

	return $pool;
}
add_filter( 'desktop_mode_code_editor_php_index_extra_symbols', 'desktop_mode_code_editor_workspace_extend_symbols', 10 );

/**
 * Look up a workspace symbol by exact name.
 *
 * @since 0.7.0
 *
 * @param string $name
 * @return array|null
 */
function desktop_mode_code_editor_get_workspace_symbol( $name ) {
	$index = desktop_mode_code_editor_get_workspace_index();
	$name  = (string) $name;
	foreach ( $index['files'] as $entry ) {
		if ( ! isset( $entry['symbols'] ) ) {
			continue;
		}
		foreach ( $entry['symbols'] as $sym ) {
			if ( ( $sym['name'] ?? '' ) === $name ) {
				return $sym;
			}
		}
	}
	return null;
}
