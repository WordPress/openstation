<?php
/**
 * Desktop Mode — Workspace PHP symbol indexer.
 *
 * Phase 5a indexed WP core. This module covers the user's own
 * plugins / themes — functions, classes, interfaces, traits, and
 * locally-declared hooks. The two indexes merge through Phase 5a's
 * `wpdc_php_index_extra_symbols` filter seam, so Monaco's existing
 * completion + hover providers light up workspace symbols with
 * zero changes to the JS layer.
 *
 * Storage shape (single transient):
 *
 *   array(
 *       'version' => 2,
 *       'files'   => array(
 *           'plugins/my-plugin/main.php' => array(
 *               'mtime'   => 1729012345,
 *               'symbols' => array(
 *                   array( 'name' => 'my_function', 'kind' => 'function',
 *                          'signature' => '…', 'line' => 12 ),
 *                   …
 *               ),
 *           ),
 *           …
 *       ),
 *   )
 *
 * Symbols carry a `file` (relative to workspace root) + `line`,
 * which the JS-side `Go to Definition` provider uses to open the
 * source tab and jump.
 *
 * Cache invalidation:
 *   - Per-file refresh on `wpdc_after_save`.
 *   - Stale-mtime files refreshed on demand from the read path.
 *   - `wpdc_flush_workspace_index()` for manual rebuilds.
 *
 * Tokenizer-only, no composer dependency. Dependency-free is worth
 * a few hundred lines of token-walk code — WP plugin space has
 * enough composer-conflict pain already.
 *
 * @package WPDesktopMode
 * @since 0.18.0
 */

defined( 'ABSPATH' ) || exit;

/** Storage version — bump to force a full rebuild after schema changes. */
const WPDC_WORKSPACE_INDEX_VERSION = 2;

/** Transient key for the workspace index. */
const WPDC_WORKSPACE_INDEX_KEY = 'wpdc_workspace_index';

/** TTL — long, but not forever. Stale entries get refreshed on demand. */
const WPDC_WORKSPACE_INDEX_TTL = 30 * DAY_IN_SECONDS;

/**
 * Directory + file-name patterns the workspace walker skips.
 *
 * Filterable via `wpdc_workspace_index_skip_dirs` and
 * `wpdc_workspace_index_skip_filename_re` so plugin authors can
 * tighten or relax (e.g. include `vendor/` for a locally-developed
 * library).
 */
const WPDC_WORKSPACE_DEFAULT_SKIP_DIRS = array(
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
 * Read the cached index. Coerces shape on version-mismatch (forces
 * a fresh build via {@see wpdc_flush_workspace_index()}).
 *
 * @since 0.18.0
 *
 * @return array{ version: int, files: array<string, array> }
 */
function wpdc_get_workspace_index() {
	$cached = get_transient( WPDC_WORKSPACE_INDEX_KEY );
	if (
		is_array( $cached ) &&
		isset( $cached['version'], $cached['files'] ) &&
		(int) $cached['version'] === WPDC_WORKSPACE_INDEX_VERSION
	) {
		return $cached;
	}
	return array(
		'version' => WPDC_WORKSPACE_INDEX_VERSION,
		'files'   => array(),
	);
}

/** Persist the index back to its transient. */
function wpdc_save_workspace_index( array $index ) {
	$index['version'] = WPDC_WORKSPACE_INDEX_VERSION;
	set_transient( WPDC_WORKSPACE_INDEX_KEY, $index, WPDC_WORKSPACE_INDEX_TTL );
}

/** Drop the cache; next read rebuilds. */
function wpdc_flush_workspace_index() {
	delete_transient( WPDC_WORKSPACE_INDEX_KEY );
}

// ---------------------------------------------------------------------------
// Walker — discovers files to index.
// ---------------------------------------------------------------------------

/**
 * Yield every PHP file under the workspace root that's eligible
 * for indexing (passes the skip-dirs filter, has a `.php`
 * extension, isn't a dotfile).
 *
 * @since 0.18.0
 * @internal
 *
 * @return Generator<string> Absolute paths.
 */
function wpdc_iter_workspace_php_files() {
	$root = wpdc_workspace_root();
	if ( '' === $root ) {
		return;
	}

	/**
	 * Filter the list of subdirectory names that the workspace
	 * walker skips. Comparison is by exact basename, anywhere in
	 * the tree.
	 *
	 * @since 0.18.0
	 *
	 * @param string[] $dirs
	 */
	$skip_dirs = (array) apply_filters(
		'wpdc_workspace_index_skip_dirs',
		WPDC_WORKSPACE_DEFAULT_SKIP_DIRS
	);
	$skip_dirs = array_map( 'strval', $skip_dirs );

	/**
	 * Optional regex run against each filename — return non-empty
	 * to provide a custom skip pattern. Default empty means no
	 * filename-level skipping beyond extension/dotfile checks.
	 *
	 * @since 0.18.0
	 *
	 * @param string $regex
	 */
	$skip_re = (string) apply_filters( 'wpdc_workspace_index_skip_filename_re', '' );

	$dir_iter = new RecursiveDirectoryIterator( $root, FilesystemIterator::SKIP_DOTS );
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
		if ( '' !== $skip_re && @preg_match( $skip_re, $file->getFilename() ) ) { // phpcs:ignore WordPress.PHP.NoSilencedErrors
			continue;
		}
		yield $path;
	}
}

// ---------------------------------------------------------------------------
// Tokenizer-driven file scan
// ---------------------------------------------------------------------------

/**
 * Scan a single PHP file, return its symbols. Handles function /
 * class / interface / trait declarations, namespaced classes via
 * a running `$current_namespace` cursor, and `do_action` /
 * `apply_filters` literal-string hook declarations.
 *
 * Methods inside classes are NOT individually indexed in this
 * pass — Phase 6 can layer that on if / when it becomes useful.
 * Classes themselves are; their members surface through Monaco's
 * existing `$instance->|` flow only once Phase 6 ships type
 * inference (which we explicitly chose not to attempt without a
 * full LSP).
 *
 * @since 0.18.0
 *
 * @param string $absolute_path File to scan.
 * @return array[] List of symbol entries.
 */
function wpdc_scan_workspace_file( $absolute_path ) {
	// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
	$source = @file_get_contents( $absolute_path );
	if ( false === $source ) {
		return array();
	}
	$tokens = @token_get_all( $source ); // phpcs:ignore WordPress.PHP.NoSilencedErrors
	if ( ! is_array( $tokens ) ) {
		return array();
	}

	$rel_path = wpdc_path_to_relative( $absolute_path );
	$symbols  = array();
	$count    = count( $tokens );

	$ns               = '';
	$last_doc_comment = '';
	// Class-depth tracker: when we're inside a class body we don't
	// want to record a `function` declaration as a top-level entry
	// (that'd shadow the WP-core / global namespace results).
	// Bracket counter is light-touch — increments on `{`, decrements
	// on `}`. Function-body braces and class-body braces look the
	// same; the heuristic is "if we're past the top level when we
	// see a function declaration, skip it."
	$brace_depth = 0;
	$class_open_at_depth = -1;

	for ( $i = 0; $i < $count; $i++ ) {
		$tok = $tokens[ $i ];

		// Doc-comment tracking.
		if ( is_array( $tok ) && T_DOC_COMMENT === $tok[0] ) {
			$last_doc_comment = $tok[1];
			continue;
		}
		if ( is_array( $tok ) && in_array( $tok[0], array( T_WHITESPACE, T_COMMENT ), true ) ) {
			continue;
		}

		// Brace tracking — only single-character `{` / `}` tokens.
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

		// Namespace declarations.
		if ( is_array( $tok ) && T_NAMESPACE === $tok[0] ) {
			$ns = wpdc_collect_namespace_name( $tokens, $i + 1 );
			$last_doc_comment = '';
			continue;
		}

		// Class / interface / trait declarations.
		if ( is_array( $tok ) && in_array( $tok[0], array( T_CLASS, T_INTERFACE, T_TRAIT ), true ) ) {
			$next = wpdc_next_significant_token( $tokens, $i + 1 );
			if ( null === $next || ! is_array( $tokens[ $next ] ) || T_STRING !== $tokens[ $next ][0] ) {
				continue;
			}
			$short_name = $tokens[ $next ][1];
			$kind = T_INTERFACE === $tok[0] ? 'interface' : ( T_TRAIT === $tok[0] ? 'trait' : 'class' );
			$fqn = '' !== $ns ? $ns . '\\' . $short_name : $short_name;
			$symbols[] = array(
				'name'      => $fqn,
				'kind'      => $kind,
				'signature' => $kind . ' ' . $fqn,
				'doc'       => wpdc_phpdoc_summary( $last_doc_comment ),
				'since'     => wpdc_phpdoc_tag( $last_doc_comment, 'since' ),
				'file'      => $rel_path,
				'line'      => is_array( $tok ) ? (int) $tok[2] : 0,
				'source'    => $rel_path . ':' . ( is_array( $tok ) ? (int) $tok[2] : 0 ),
			);
			// Track that we're now inside a class so nested function
			// keywords don't pollute the function index.
			if ( 'class' === $kind || 'trait' === $kind ) {
				$class_open_at_depth = $brace_depth + 1;
			}
			$last_doc_comment = '';
			continue;
		}

		// Function declarations — skip closures (T_FUNCTION not
		// followed by a name) and methods (inside class body).
		if ( is_array( $tok ) && T_FUNCTION === $tok[0] ) {
			if ( $class_open_at_depth >= 0 && $brace_depth >= $class_open_at_depth ) {
				$last_doc_comment = '';
				continue;
			}
			$next = wpdc_next_significant_token( $tokens, $i + 1 );
			if ( null === $next ) {
				continue;
			}
			$next_tok = $tokens[ $next ];
			// Closure: `function (` or `function &(`.
			if ( ! is_array( $next_tok ) ) {
				$last_doc_comment = '';
				continue;
			}
			if ( T_STRING !== $next_tok[0] ) {
				$last_doc_comment = '';
				continue;
			}
			$short_name = $next_tok[1];
			$fqn = '' !== $ns ? $ns . '\\' . $short_name : $short_name;
			$symbols[] = array(
				'name'      => $fqn,
				'kind'      => 'function',
				'signature' => $fqn . '()',
				'doc'       => wpdc_phpdoc_summary( $last_doc_comment ),
				'since'     => wpdc_phpdoc_tag( $last_doc_comment, 'since' ),
				'file'      => $rel_path,
				'line'      => is_array( $tok ) ? (int) $tok[2] : 0,
				'source'    => $rel_path . ':' . ( is_array( $tok ) ? (int) $tok[2] : 0 ),
			);
			$last_doc_comment = '';
			continue;
		}

		// Hook declarations (do_action / apply_filters with literal
		// string first arg). Reuses Phase 5a's helper map.
		if ( is_array( $tok ) && T_STRING === $tok[0] ) {
			$kind = wpdc_hook_kind_for_function_name( $tok[1] );
			if ( null !== $kind ) {
				$paren = wpdc_next_significant_token( $tokens, $i + 1 );
				if ( null !== $paren && '(' === $tokens[ $paren ] ) {
					$arg = wpdc_next_significant_token( $tokens, $paren + 1 );
					if (
						null !== $arg &&
						is_array( $tokens[ $arg ] ) &&
						T_CONSTANT_ENCAPSED_STRING === $tokens[ $arg ][0]
					) {
						$hook = wpdc_unquote_string( $tokens[ $arg ][1] );
						if ( '' !== $hook ) {
							$symbols[] = array(
								'name'      => $hook,
								'kind'      => $kind,
								'signature' => $tok[1] . "( '" . $hook . "', … )",
								'doc'       => wpdc_phpdoc_summary( $last_doc_comment ),
								'since'     => wpdc_phpdoc_tag( $last_doc_comment, 'since' ),
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

		// Anything else clears the doc-comment tracking — only
		// docblocks IMMEDIATELY before a declaration count.
		if ( is_array( $tok ) || in_array( $tok, array( ';', ',', '(' ), true ) ) {
			$last_doc_comment = '';
		}
	}

	return $symbols;
}

/**
 * Walk forward from `$start` accumulating namespace name parts
 * (`Foo\Bar\Baz`). Stops at the first `;` or `{` (block namespace).
 *
 * @internal
 */
function wpdc_collect_namespace_name( array $tokens, $start ) {
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
			// PHP 8+ tokens for namespaced names.
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
 * Walk the workspace and refresh the index — adds new files,
 * updates stale entries (mtime mismatch), drops entries for files
 * that no longer exist.
 *
 * Bounded by `$file_budget` so a long-tailed walk doesn't time out
 * a REST request. The default (200 files per call) is enough to
 * cover a typical multi-plugin workspace in one pass; very large
 * workspaces refresh incrementally over a few requests.
 *
 * @since 0.18.0
 *
 * @param int $file_budget Max files to fully scan in this call.
 * @return array Updated index (also persisted).
 */
function wpdc_refresh_workspace_index( $file_budget = 200 ) {
	$index = wpdc_get_workspace_index();
	$files = is_array( $index['files'] ) ? $index['files'] : array();

	$seen = array();
	$scanned = 0;

	foreach ( wpdc_iter_workspace_php_files() as $abs ) {
		$rel = wpdc_path_to_relative( $abs );
		$seen[ $rel ] = true;

		$mtime = (int) @filemtime( $abs ); // phpcs:ignore WordPress.PHP.NoSilencedErrors
		$cached_mtime = isset( $files[ $rel ]['mtime'] ) ? (int) $files[ $rel ]['mtime'] : 0;

		if ( $mtime > 0 && $mtime === $cached_mtime ) {
			// Cache hit — nothing to do.
			continue;
		}
		if ( $scanned >= $file_budget ) {
			// Out of budget; the next call picks up where we left
			// off (since stale entries stay flagged).
			break;
		}
		$scanned++;

		$symbols = wpdc_scan_workspace_file( $abs );
		$files[ $rel ] = array(
			'mtime'   => $mtime,
			'symbols' => $symbols,
		);
	}

	// Remove entries whose file vanished.
	foreach ( array_keys( $files ) as $rel ) {
		if ( ! isset( $seen[ $rel ] ) ) {
			unset( $files[ $rel ] );
		}
	}

	$index['files'] = $files;
	wpdc_save_workspace_index( $index );
	return $index;
}

/**
 * Refresh a single file's entry in the workspace index. Called
 * from the post-save hook so freshly-edited files reflect their
 * new symbols within microseconds of the save round-trip.
 *
 * @since 0.18.0
 *
 * @param string $absolute_path
 */
function wpdc_refresh_workspace_file( $absolute_path ) {
	$rel = wpdc_path_to_relative( $absolute_path );
	if ( '' === $rel ) {
		return;
	}
	$index = wpdc_get_workspace_index();
	$files = is_array( $index['files'] ) ? $index['files'] : array();

	if ( ! is_file( $absolute_path ) ) {
		unset( $files[ $rel ] );
	} else {
		$files[ $rel ] = array(
			'mtime'   => (int) @filemtime( $absolute_path ), // phpcs:ignore WordPress.PHP.NoSilencedErrors
			'symbols' => wpdc_scan_workspace_file( $absolute_path ),
		);
	}

	$index['files'] = $files;
	wpdc_save_workspace_index( $index );
}

/**
 * Hook into Phase 3's save flow so the workspace index stays
 * fresh on every successful write. Re-runs only the touched file
 * — full-workspace rebuilds are reserved for explicit rescan.
 *
 * @since 0.18.0
 *
 * @param string $abs Absolute path the user just saved.
 */
function wpdc_workspace_index_on_save( $abs ) {
	wpdc_refresh_workspace_file( $abs );
}
add_action( 'wpdc_after_save', 'wpdc_workspace_index_on_save', 10, 1 );

// ---------------------------------------------------------------------------
// Read-side: feed workspace symbols into the merged php-symbols pool.
// ---------------------------------------------------------------------------

/**
 * Merge workspace symbols into the WP-core symbol pool. Hooks the
 * `wpdc_php_index_extra_symbols` filter Phase 5a left as the seam.
 *
 * Workspace symbols win on collisions (your local helper named the
 * same as a core function shows you the local one — usually what
 * you're actually trying to navigate to). The other entry stays in
 * the pool so completion still lists both.
 *
 * @since 0.18.0
 *
 * @param array $pool Existing pool (from WP core).
 * @return array
 */
function wpdc_workspace_extend_symbols( $pool ) {
	$index = wpdc_get_workspace_index();

	// Ensure we've at least seeded the index. First call can be
	// slow (~1-3s for a typical site); subsequent calls hit the
	// cache. We do this lazily inside the filter so cold sites
	// don't pay the cost on every page load — only once a PHP
	// completion fires.
	if ( empty( $index['files'] ) ) {
		$index = wpdc_refresh_workspace_index();
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
add_filter( 'wpdc_php_index_extra_symbols', 'wpdc_workspace_extend_symbols', 10 );

/**
 * Look up a workspace symbol by exact name. Used by the hover /
 * definition routes so they can return file+line.
 *
 * @since 0.18.0
 *
 * @param string $name
 * @return array|null
 */
function wpdc_get_workspace_symbol( $name ) {
	$index = wpdc_get_workspace_index();
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
