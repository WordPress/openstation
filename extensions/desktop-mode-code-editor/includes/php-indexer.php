<?php
/**
 * WordPress core symbol indexer for the Code Editor extension.
 *
 * Builds the catalogue Monaco's PHP completion + hover providers query
 * against. Three layers:
 *
 *   - {@see desktop_mode_code_editor_get_wp_core_index()}
 *   - {@see desktop_mode_code_editor_build_wp_core_index()}
 *   - {@see desktop_mode_code_editor_query_php_symbols()}
 *
 * Plugin authors can extend the index without forking via the
 * `desktop_mode_code_editor_php_index_extra_symbols` filter — return
 * an array shaped like the canonical entries below and they're merged
 * in. The workspace indexer feeds this same filter.
 *
 * @package DesktopModeCodeEditor
 * @since   0.22.0
 */

defined( 'ABSPATH' ) || exit;

/** Transient TTL — index lives until WP updates. 30 days is generous. */
const DESKTOP_MODE_CODE_EDITOR_INDEX_TTL = 30 * DAY_IN_SECONDS;

// ---------------------------------------------------------------------------
// Public reader
// ---------------------------------------------------------------------------

/**
 * Returns the WP core symbol index. Cached as a transient keyed on
 * the WP version.
 *
 * @since 0.22.0
 *
 * @return array{ functions: array<string, array>, hooks: array<string, array> }
 */
function desktop_mode_code_editor_get_wp_core_index() {
	$cache_key = 'desktop_mode_code_editor_php_index_' . get_bloginfo( 'version' );
	$cached    = get_transient( $cache_key );
	if ( is_array( $cached ) && isset( $cached['functions'], $cached['hooks'] ) ) {
		return $cached;
	}

	$index = desktop_mode_code_editor_build_wp_core_index();
	set_transient( $cache_key, $index, DESKTOP_MODE_CODE_EDITOR_INDEX_TTL );
	return $index;
}

/**
 * Drop the cached index.
 *
 * @since 0.22.0
 */
function desktop_mode_code_editor_flush_wp_core_index() {
	delete_transient( 'desktop_mode_code_editor_php_index_' . get_bloginfo( 'version' ) );
}

// ---------------------------------------------------------------------------
// Build (cold path)
// ---------------------------------------------------------------------------

/**
 * Build the index from scratch. Slow — call only via the cached reader.
 *
 * @since 0.22.0
 *
 * @return array
 */
function desktop_mode_code_editor_build_wp_core_index() {
	$functions = desktop_mode_code_editor_index_wp_core_functions();
	$hooks     = desktop_mode_code_editor_index_wp_core_hooks();

	return array(
		'functions' => $functions,
		'hooks'     => $hooks,
	);
}

/**
 * Index every defined function whose source file lives under
 * `ABSPATH` but outside `WP_CONTENT_DIR`.
 *
 * @since 0.22.0
 *
 * @return array<string, array>
 */
function desktop_mode_code_editor_index_wp_core_functions() {
	$out = array();

	$content_dir = defined( 'WP_CONTENT_DIR' )
		? rtrim( wp_normalize_path( WP_CONTENT_DIR ), '/' )
		: '';
	$abspath = rtrim( wp_normalize_path( ABSPATH ), '/' );

	$defined = get_defined_functions();
	foreach ( $defined['user'] as $name ) {
		try {
			$ref = new ReflectionFunction( $name );
		} catch ( ReflectionException $e ) {
			continue;
		}

		$file = $ref->getFileName();
		if ( false === $file ) {
			continue;
		}
		$file_norm = wp_normalize_path( $file );

		if ( '' === $abspath || strpos( $file_norm, $abspath . '/' ) !== 0 ) {
			continue;
		}
		if ( '' !== $content_dir && strpos( $file_norm, $content_dir . '/' ) === 0 ) {
			continue;
		}

		$params = array();
		foreach ( $ref->getParameters() as $p ) {
			$params[] = array(
				'name'     => $p->getName(),
				'optional' => $p->isOptional(),
				'default'  => $p->isDefaultValueAvailable()
					? desktop_mode_code_editor_format_default( $p->getDefaultValue() )
					: null,
				'variadic' => $p->isVariadic(),
				'by_ref'   => $p->isPassedByReference(),
				'type'     => $p->hasType() ? (string) $p->getType() : null,
			);
		}

		$doc     = $ref->getDocComment() ?: '';
		$summary = desktop_mode_code_editor_phpdoc_summary( $doc );
		$since   = desktop_mode_code_editor_phpdoc_tag( $doc, 'since' );
		$return  = desktop_mode_code_editor_phpdoc_tag( $doc, 'return' );

		$out[ $name ] = array(
			'name'      => $name,
			'kind'      => 'function',
			'signature' => desktop_mode_code_editor_format_signature( $name, $params, $return ),
			'params'    => $params,
			'doc'       => $summary,
			'since'     => $since,
			'source'    => '' !== $abspath ? ltrim( substr( $file_norm, strlen( $abspath ) ), '/' ) : $file_norm,
		);
	}

	return $out;
}

/**
 * Walk wp-includes / wp-admin and pull out every literal-string
 * `do_action` / `apply_filters` call.
 *
 * @since 0.22.0
 *
 * @return array<string, array>
 */
function desktop_mode_code_editor_index_wp_core_hooks() {
	$out = array();

	$dirs       = array();
	$root_files = array();
	if ( defined( 'ABSPATH' ) ) {
		$abs = rtrim( wp_normalize_path( ABSPATH ), '/' );
		foreach ( array( 'wp-includes', 'wp-admin' ) as $sub ) {
			$candidate = $abs . '/' . $sub;
			if ( is_dir( $candidate ) ) {
				$dirs[] = $candidate;
			}
		}
		foreach (
			array(
				'wp-settings.php',
				'wp-load.php',
				'wp-blog-header.php',
				'wp-config.php',
			) as $file
		) {
			$candidate = $abs . '/' . $file;
			if ( is_file( $candidate ) ) {
				$root_files[] = $candidate;
			}
		}
	}

	foreach ( $dirs as $dir ) {
		$it = new RecursiveIteratorIterator(
			new RecursiveDirectoryIterator( $dir, FilesystemIterator::SKIP_DOTS ),
			RecursiveIteratorIterator::CHILD_FIRST
		);
		foreach ( $it as $file ) {
			if ( ! $file->isFile() ) {
				continue;
			}
			if ( 'php' !== strtolower( $file->getExtension() ) ) {
				continue;
			}
			desktop_mode_code_editor_scan_hooks_in_file( $file->getPathname(), $out );
		}
	}

	foreach ( $root_files as $file ) {
		desktop_mode_code_editor_scan_hooks_in_file( $file, $out );
	}

	return $out;
}

/**
 * Tokenize a single PHP file and append every literal-string
 * `do_action` / `apply_filters` (and `_ref_array` variants) into `$out`.
 *
 * @since 0.22.0
 * @internal
 *
 * @param string $path Absolute path to a PHP file.
 * @param array  $out  Accumulator.
 */
function desktop_mode_code_editor_scan_hooks_in_file( $path, array &$out ) {
	// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
	$source = @file_get_contents( $path );
	if ( false === $source ) {
		return;
	}

	$tokens = @token_get_all( $source ); // phpcs:ignore WordPress.PHP.NoSilencedErrors
	if ( ! is_array( $tokens ) ) {
		return;
	}

	$rel = desktop_mode_code_editor_path_relative_to_abspath( $path );

	$count            = count( $tokens );
	$last_doc_comment = '';

	for ( $i = 0; $i < $count; $i++ ) {
		$tok = $tokens[ $i ];
		if ( is_array( $tok ) && T_DOC_COMMENT === $tok[0] ) {
			$last_doc_comment = $tok[1];
			continue;
		}
		if ( is_array( $tok ) && in_array( $tok[0], array( T_WHITESPACE, T_COMMENT ), true ) ) {
			continue;
		}

		if ( ! is_array( $tok ) || T_STRING !== $tok[0] ) {
			$last_doc_comment = '';
			continue;
		}

		$name          = $tok[1];
		$kind_for_name = desktop_mode_code_editor_hook_kind_for_function_name( $name );
		if ( null === $kind_for_name ) {
			$last_doc_comment = '';
			continue;
		}

		$next = desktop_mode_code_editor_next_significant_token( $tokens, $i + 1 );
		if ( null === $next || '(' !== $tokens[ $next ] ) {
			$last_doc_comment = '';
			continue;
		}
		$arg = desktop_mode_code_editor_next_significant_token( $tokens, $next + 1 );
		if ( null === $arg || ! is_array( $tokens[ $arg ] ) || T_CONSTANT_ENCAPSED_STRING !== $tokens[ $arg ][0] ) {
			$last_doc_comment = '';
			continue;
		}

		$hook = desktop_mode_code_editor_unquote_string( $tokens[ $arg ][1] );
		if ( '' === $hook || isset( $out[ $hook ] ) ) {
			$last_doc_comment = '';
			continue;
		}

		$out[ $hook ] = array(
			'name'      => $hook,
			'kind'      => $kind_for_name,
			'signature' => $name . "( '" . $hook . "', … )",
			'doc'       => desktop_mode_code_editor_phpdoc_summary( $last_doc_comment ),
			'since'     => desktop_mode_code_editor_phpdoc_tag( $last_doc_comment, 'since' ),
			'source'    => $rel . ':' . ( is_array( $tok ) ? (int) $tok[2] : 0 ),
		);

		$last_doc_comment = '';
	}
}

/** Map a function name to its hook kind, or null if it isn't a hook call. */
function desktop_mode_code_editor_hook_kind_for_function_name( $name ) {
	switch ( $name ) {
		case 'do_action':
		case 'do_action_ref_array':
		case 'do_action_deprecated':
			return 'action';
		case 'apply_filters':
		case 'apply_filters_ref_array':
		case 'apply_filters_deprecated':
			return 'filter';
		default:
			return null;
	}
}

/**
 * Walk forward from `$start` skipping whitespace + comments; return
 * the index of the next significant token, or null if EOF.
 *
 * @internal
 */
function desktop_mode_code_editor_next_significant_token( array $tokens, $start ) {
	$count = count( $tokens );
	for ( $i = $start; $i < $count; $i++ ) {
		$tok = $tokens[ $i ];
		if ( is_array( $tok ) ) {
			if ( in_array( $tok[0], array( T_WHITESPACE, T_COMMENT, T_DOC_COMMENT ), true ) ) {
				continue;
			}
		}
		return $i;
	}
	return null;
}

/** Strip the surrounding quotes from a `T_CONSTANT_ENCAPSED_STRING` token's lexeme. */
function desktop_mode_code_editor_unquote_string( $lexeme ) {
	$lexeme = (string) $lexeme;
	if ( strlen( $lexeme ) < 2 ) {
		return '';
	}
	$first = $lexeme[0];
	if ( "'" === $first || '"' === $first ) {
		return substr( $lexeme, 1, -1 );
	}
	return $lexeme;
}

/** Format a value for display as a default in a parameter list. */
function desktop_mode_code_editor_format_default( $value ) {
	if ( is_string( $value ) ) {
		return "'" . $value . "'";
	}
	if ( is_bool( $value ) ) {
		return $value ? 'true' : 'false';
	}
	if ( null === $value ) {
		return 'null';
	}
	if ( is_array( $value ) ) {
		return '[]';
	}
	return (string) $value;
}

/** Compose a human-readable signature line. */
function desktop_mode_code_editor_format_signature( $name, array $params, $return = null ) {
	$parts = array();
	foreach ( $params as $p ) {
		$part = '';
		if ( ! empty( $p['type'] ) ) {
			$part .= $p['type'] . ' ';
		}
		if ( ! empty( $p['by_ref'] ) ) {
			$part .= '&';
		}
		if ( ! empty( $p['variadic'] ) ) {
			$part .= '...';
		}
		$part .= '$' . $p['name'];
		if ( ! empty( $p['optional'] ) && isset( $p['default'] ) ) {
			$part .= ' = ' . $p['default'];
		}
		$parts[] = $part;
	}
	$sig = $name . '(' . ( $parts ? ' ' . implode( ', ', $parts ) . ' ' : '' ) . ')';
	if ( is_string( $return ) && '' !== $return ) {
		$first = preg_split( '/\s+/', trim( $return ) );
		if ( $first && '' !== $first[0] ) {
			$sig .= ': ' . $first[0];
		}
	}
	return $sig;
}

// ---------------------------------------------------------------------------
// PHPDoc parsing
// ---------------------------------------------------------------------------

/**
 * Pull the human-readable summary out of a PHPDoc block.
 *
 * @since 0.22.0
 *
 * @param string $doc Full docblock text including delimiters.
 * @return string
 */
function desktop_mode_code_editor_phpdoc_summary( $doc ) {
	$doc = (string) $doc;
	if ( '' === $doc ) {
		return '';
	}

	$doc   = preg_replace( '/^\s*\/\*\*/', '', $doc );
	$doc   = preg_replace( '/\*\/\s*$/', '', $doc );
	$lines = preg_split( '/\r?\n/', $doc );
	if ( ! is_array( $lines ) ) {
		return '';
	}
	$out = array();
	foreach ( $lines as $line ) {
		$line  = preg_replace( '/^\s*\*\s?/', '', $line );
		$out[] = $line;
	}
	$body = trim( implode( "\n", $out ) );

	$summary = preg_split( '/(\r?\n\s*\r?\n)|(\r?\n\s*@[a-z]+)/i', $body, 2 );
	$summary = is_array( $summary ) && ! empty( $summary[0] ) ? $summary[0] : $body;
	$summary = preg_replace( '/\s+/', ' ', $summary );
	return trim( (string) $summary );
}

/**
 * Pull a single `@tag` value out of a PHPDoc block.
 *
 * @since 0.22.0
 *
 * @param string $doc PHPDoc block.
 * @param string $tag Tag name without `@`.
 * @return string
 */
function desktop_mode_code_editor_phpdoc_tag( $doc, $tag ) {
	$doc = (string) $doc;
	$tag = preg_quote( (string) $tag, '/' );
	if ( '' === $doc ) {
		return '';
	}
	if ( preg_match( '/@' . $tag . '\s+([^\r\n]+)/', $doc, $m ) ) {
		return trim( $m[1] );
	}
	return '';
}

/** Strip ABSPATH from a path; emit forward-slashed relative form. */
function desktop_mode_code_editor_path_relative_to_abspath( $path ) {
	if ( ! defined( 'ABSPATH' ) ) {
		return wp_normalize_path( $path );
	}
	$abs  = rtrim( wp_normalize_path( ABSPATH ), '/' );
	$norm = wp_normalize_path( $path );
	if ( '' !== $abs && strpos( $norm, $abs . '/' ) === 0 ) {
		return ltrim( substr( $norm, strlen( $abs ) ), '/' );
	}
	return $norm;
}

// ---------------------------------------------------------------------------
// Read-side query
// ---------------------------------------------------------------------------

/**
 * Query the index — prefix-match across functions + hooks, optionally
 * filtered by `$kinds`.
 *
 * @since 0.22.0
 *
 * @param string   $prefix Lower-cased identifier prefix.
 * @param string[] $kinds  Subset of {`function`, `action`, `filter`}.
 * @param int      $limit  Hard cap on returned matches.
 * @return array[] List of symbol entries.
 */
function desktop_mode_code_editor_query_php_symbols( $prefix, array $kinds = array(), $limit = 50 ) {
	$prefix = strtolower( (string) $prefix );
	$limit  = max( 1, (int) $limit );

	$index = desktop_mode_code_editor_get_wp_core_index();
	$pool  = array();

	if ( empty( $kinds ) || in_array( 'function', $kinds, true ) ) {
		foreach ( $index['functions'] as $entry ) {
			$pool[] = $entry;
		}
	}

	$want_actions = empty( $kinds ) || in_array( 'action', $kinds, true );
	$want_filters = empty( $kinds ) || in_array( 'filter', $kinds, true );
	if ( $want_actions || $want_filters ) {
		foreach ( $index['hooks'] as $entry ) {
			if ( 'action' === $entry['kind'] && ! $want_actions ) {
				continue;
			}
			if ( 'filter' === $entry['kind'] && ! $want_filters ) {
				continue;
			}
			$pool[] = $entry;
		}
	}

	/**
	 * Inject extra symbols (workspace functions, framework
	 * dictionaries, etc.).
	 *
	 * @since 0.22.0
	 *
	 * @param array  $pool   Symbols collected from WP core.
	 * @param string $prefix The prefix being queried.
	 * @param array  $kinds  Kind filter.
	 */
	$pool = (array) apply_filters( 'desktop_mode_code_editor_php_index_extra_symbols', $pool, $prefix, $kinds );

	$matches = array();
	foreach ( $pool as $entry ) {
		if ( ! is_array( $entry ) || empty( $entry['name'] ) ) {
			continue;
		}
		$name = strtolower( (string) $entry['name'] );
		if ( '' !== $prefix && strpos( $name, $prefix ) !== 0 ) {
			continue;
		}
		$matches[] = $entry;
		if ( count( $matches ) >= $limit * 4 ) {
			break;
		}
	}

	usort(
		$matches,
		static function ( $a, $b ) {
			return strcmp( (string) $a['name'], (string) $b['name'] );
		}
	);

	return array_slice( $matches, 0, $limit );
}

/**
 * Look up a single symbol by exact name.
 *
 * @since 0.22.0
 *
 * @param string $name
 * @return array|null
 */
function desktop_mode_code_editor_get_php_symbol( $name ) {
	$index = desktop_mode_code_editor_get_wp_core_index();
	$name  = (string) $name;
	if ( isset( $index['functions'][ $name ] ) ) {
		return $index['functions'][ $name ];
	}
	if ( isset( $index['hooks'][ $name ] ) ) {
		return $index['hooks'][ $name ];
	}
	return null;
}
