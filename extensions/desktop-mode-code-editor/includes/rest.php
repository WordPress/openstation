<?php
/**
 * REST routes for the Code Editor extension.
 *
 * Routes registered under the `desktop-mode-code-editor/v1` namespace:
 *
 *   - GET  /tree?path=<rel>            → list a directory.
 *   - GET  /file?path=<rel>            → read a file's content.
 *   - PUT  /file                       → write file content.
 *   - GET  /php-symbols?prefix=…       → prefix search.
 *   - POST /php-symbols/rescan         → flush + rebuild workspace index.
 *   - GET  /php-symbols/<name>         → single symbol detail.
 *
 * Every route bottlenecks through {@see desktop_mode_code_editor_resolve_path()}
 * for path safety and the same `permission_callback` (logged-in admin
 * holding `edit_plugins`, with `DISALLOW_FILE_EDIT` honoured).
 *
 * @package DesktopModeCodeEditor
 */

defined( 'ABSPATH' ) || exit;

/**
 * Permission gate for every editor REST route.
 *
 * @return true|WP_Error
 */
function desktop_mode_code_editor_rest_permission() {
	if ( ! is_user_logged_in() ) {
		return new WP_Error(
			'desktop_mode_code_editor_unauthenticated',
			__( 'You must be logged in to use the code editor.', 'desktop-mode-code-editor' ),
			array( 'status' => 401 )
		);
	}

	if ( ! desktop_mode_code_editor_file_edit_allowed() ) {
		return new WP_Error(
			'desktop_mode_code_editor_file_edit_disabled',
			__( 'In-admin file editing is disabled on this site (DISALLOW_FILE_EDIT).', 'desktop-mode-code-editor' ),
			array( 'status' => 403 )
		);
	}

	/**
	 * Filter the capability required to use the code editor.
	 *
	 * @param string $capability Default `edit_plugins`.
	 */
	$cap = (string) apply_filters( 'desktop_mode_code_editor_required_capability', 'edit_plugins' );
	if ( ! current_user_can( $cap ) ) {
		return new WP_Error(
			'desktop_mode_code_editor_forbidden',
			__( 'You do not have permission to use the code editor.', 'desktop-mode-code-editor' ),
			array( 'status' => 403 )
		);
	}

	return true;
}

/**
 * Wrap a REST handler so PHP notices / warnings printed under
 * WP_DEBUG don't leak into the response body.
 *
 * @param callable $handler `function( WP_REST_Request ): array|WP_REST_Response|WP_Error`.
 * @return callable
 */
function desktop_mode_code_editor_rest_handler( $handler ) {
	return static function ( WP_REST_Request $request ) use ( $handler ) {
		ob_start();
		try {
			$result = call_user_func( $handler, $request );
		} finally {
			ob_end_clean();
		}
		return $result;
	};
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

/**
 * Register the editor's REST routes.
 */
function desktop_mode_code_editor_register_rest_routes() {
	register_rest_route(
		DESKTOP_MODE_CODE_EDITOR_REST_NAMESPACE,
		'/tree',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => desktop_mode_code_editor_rest_handler( 'desktop_mode_code_editor_rest_tree' ),
			'permission_callback' => 'desktop_mode_code_editor_rest_permission',
			'args'                => array(
				'path' => array(
					'required' => false,
					'type'     => 'string',
					'default'  => '',
				),
			),
		)
	);

	register_rest_route(
		DESKTOP_MODE_CODE_EDITOR_REST_NAMESPACE,
		'/php-symbols',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => desktop_mode_code_editor_rest_handler( 'desktop_mode_code_editor_rest_php_symbols' ),
			'permission_callback' => 'desktop_mode_code_editor_rest_permission',
			'args'                => array(
				'prefix' => array(
					'required' => false,
					'type'     => 'string',
					'default'  => '',
				),
				'kinds'  => array(
					'required'    => false,
					'type'        => 'string',
					'default'     => '',
					'description' => 'Comma-separated subset of {function,action,filter}. Empty = all.',
				),
				'limit'  => array(
					'required' => false,
					'type'     => 'integer',
					'default'  => 50,
				),
			),
		)
	);

	register_rest_route(
		DESKTOP_MODE_CODE_EDITOR_REST_NAMESPACE,
		'/php-symbols/rescan',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => desktop_mode_code_editor_rest_handler( 'desktop_mode_code_editor_rest_php_symbols_rescan' ),
			'permission_callback' => 'desktop_mode_code_editor_rest_permission',
		)
	);

	register_rest_route(
		DESKTOP_MODE_CODE_EDITOR_REST_NAMESPACE,
		// `[A-Za-z0-9_\\/.-]` — alphanum, underscore, namespace
		// separator (`\`), slash, period, hyphen. PHP single-quoted
		// strings preserve `\\` as two chars; the regex sees `\\`,
		// matching one literal backslash.
		'/php-symbols/(?P<name>[A-Za-z0-9_\\\\/.-]+)',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => desktop_mode_code_editor_rest_handler( 'desktop_mode_code_editor_rest_php_symbol_detail' ),
			'permission_callback' => 'desktop_mode_code_editor_rest_permission',
			'args'                => array(
				'name' => array(
					'required' => true,
					'type'     => 'string',
				),
			),
		)
	);

	register_rest_route(
		DESKTOP_MODE_CODE_EDITOR_REST_NAMESPACE,
		'/file',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => desktop_mode_code_editor_rest_handler( 'desktop_mode_code_editor_rest_read_file' ),
				'permission_callback' => 'desktop_mode_code_editor_rest_permission',
				'args'                => array(
					'path' => array(
						'required' => true,
						'type'     => 'string',
					),
				),
			),
			array(
				// Both PUT and POST — some hosts' WAFs (mod_security
				// rule sets in particular) block PUT requests
				// containing `<?php` strings outright. Accepting POST
				// as well lets the client fall through.
				'methods'             => 'PUT, POST',
				'callback'            => desktop_mode_code_editor_rest_handler( 'desktop_mode_code_editor_rest_write_file' ),
				'permission_callback' => 'desktop_mode_code_editor_rest_permission',
				'args'                => array(
					'path'        => array(
						'required' => true,
						'type'     => 'string',
					),
					'content_b64' => array(
						'required'    => true,
						'type'        => 'string',
						'description' => 'Base64-encoded UTF-8 file contents.',
					),
					'mtime'       => array(
						'required'    => true,
						'type'        => 'integer',
						'description' => 'The mtime the editor read this file at.',
					),
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'desktop_mode_code_editor_register_rest_routes' );

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * GET /tree?path=<rel>
 *
 * @param WP_REST_Request $request
 * @return array|WP_Error
 */
function desktop_mode_code_editor_rest_tree( WP_REST_Request $request ) {
	$rel = (string) $request->get_param( 'path' );
	$abs = desktop_mode_code_editor_resolve_path( $rel );
	if ( is_wp_error( $abs ) ) {
		return $abs;
	}
	if ( ! is_dir( $abs ) ) {
		return new WP_Error(
			'desktop_mode_code_editor_not_a_directory',
			__( 'Path is not a directory.', 'desktop-mode-code-editor' ),
			array( 'status' => 400 )
		);
	}

	$entries = array();
	// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
	$dh = @opendir( $abs );
	if ( false === $dh ) {
		return new WP_Error(
			'desktop_mode_code_editor_directory_unreadable',
			__( 'Directory is not readable.', 'desktop-mode-code-editor' ),
			array( 'status' => 500 )
		);
	}

	$exts = desktop_mode_code_editor_extension_allowlist();

	/**
	 * Filter whether dotfiles appear in the tree.
	 *
	 * @param bool $include_dotfiles
	 */
	$include_dotfiles = (bool) apply_filters( 'desktop_mode_code_editor_tree_include_dotfiles', false );

	while ( false !== ( $name = readdir( $dh ) ) ) {
		if ( '.' === $name || '..' === $name ) {
			continue;
		}
		if ( ! $include_dotfiles && '.' === $name[0] ) {
			continue;
		}

		$child_abs = $abs . DIRECTORY_SEPARATOR . $name;
		$is_dir    = is_dir( $child_abs );
		$is_link   = is_link( $child_abs );

		if ( $is_link ) {
			$resolved = realpath( $child_abs );
			$root     = desktop_mode_code_editor_workspace_root();
			if (
				false === $resolved ||
				(
					rtrim( $resolved, DIRECTORY_SEPARATOR ) !== rtrim( $root, DIRECTORY_SEPARATOR ) &&
					strpos(
						rtrim( $resolved, DIRECTORY_SEPARATOR ) . DIRECTORY_SEPARATOR,
						rtrim( $root, DIRECTORY_SEPARATOR ) . DIRECTORY_SEPARATOR
					) !== 0
				)
			) {
				continue;
			}
		}

		$ext     = $is_dir ? '' : strtolower( pathinfo( $name, PATHINFO_EXTENSION ) );
		$allowed = $is_dir ? true : in_array( $ext, $exts, true );

		$entry = array(
			'name'    => (string) $name,
			'path'    => desktop_mode_code_editor_path_to_relative( $child_abs ),
			'type'    => $is_dir ? 'dir' : 'file',
			// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
			'size'    => $is_dir ? 0 : (int) @filesize( $child_abs ),
			// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
			'mtime'   => (int) @filemtime( $child_abs ),
			'allowed' => $allowed,
		);

		$entries[] = $entry;
	}
	closedir( $dh );

	usort(
		$entries,
		static function ( $a, $b ) {
			if ( $a['type'] !== $b['type'] ) {
				return 'dir' === $a['type'] ? -1 : 1;
			}
			return strcasecmp( $a['name'], $b['name'] );
		}
	);

	/**
	 * Filter the directory entries before returning them.
	 *
	 * @param array  $entries List of entry arrays.
	 * @param string $rel     Relative directory path being listed.
	 * @param string $abs     Absolute directory path.
	 */
	$entries = (array) apply_filters( 'desktop_mode_code_editor_tree_entries', $entries, $rel, $abs );

	return array(
		'path'    => desktop_mode_code_editor_path_to_relative( $abs ),
		'entries' => $entries,
	);
}

/**
 * GET /file?path=<rel>
 *
 * @param WP_REST_Request $request
 * @return array|WP_Error
 */
function desktop_mode_code_editor_rest_read_file( WP_REST_Request $request ) {
	$rel = (string) $request->get_param( 'path' );
	$abs = desktop_mode_code_editor_resolve_path( $rel );
	if ( is_wp_error( $abs ) ) {
		return $abs;
	}
	if ( ! is_file( $abs ) ) {
		return new WP_Error(
			'desktop_mode_code_editor_not_a_file',
			__( 'Path is not a file.', 'desktop-mode-code-editor' ),
			array( 'status' => 400 )
		);
	}

	/**
	 * Maximum file size (bytes) the editor will read. Default 5 MB.
	 *
	 * @param int $bytes
	 */
	$max_bytes = (int) apply_filters( 'desktop_mode_code_editor_max_file_bytes', 5 * 1024 * 1024 );
	$size      = (int) filesize( $abs );
	if ( $size > $max_bytes ) {
		return new WP_Error(
			'desktop_mode_code_editor_file_too_large',
			sprintf(
				/* translators: 1: file size, 2: limit. */
				__( 'File is too large to open in the editor (%1$s bytes; limit %2$s).', 'desktop-mode-code-editor' ),
				number_format_i18n( $size ),
				number_format_i18n( $max_bytes )
			),
			array(
				'status' => 413,
				'size'   => $size,
				'limit'  => $max_bytes,
			)
		);
	}

	// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
	$content = file_get_contents( $abs );
	if ( false === $content ) {
		return new WP_Error(
			'desktop_mode_code_editor_file_unreadable',
			__( 'File is not readable.', 'desktop-mode-code-editor' ),
			array( 'status' => 500 )
		);
	}

	if ( ! mb_check_encoding( $content, 'UTF-8' ) ) {
		return new WP_Error(
			'desktop_mode_code_editor_binary_file',
			__( 'File contents are not valid UTF-8 — the editor only opens text files.', 'desktop-mode-code-editor' ),
			array( 'status' => 415 )
		);
	}

	return array(
		'path'     => desktop_mode_code_editor_path_to_relative( $abs ),
		'content'  => $content,
		'mtime'    => (int) filemtime( $abs ),
		'size'     => $size,
		'encoding' => 'utf-8',
	);
}

/**
 * POST/PUT /file
 *
 * @param WP_REST_Request $request
 * @return array|WP_Error
 */
function desktop_mode_code_editor_rest_write_file( WP_REST_Request $request ) {
	$rel = (string) $request->get_param( 'path' );
	$abs = desktop_mode_code_editor_resolve_path( $rel );
	if ( is_wp_error( $abs ) ) {
		return $abs;
	}

	$content_b64 = (string) $request->get_param( 'content_b64' );
	if ( '' === $content_b64 ) {
		return new WP_Error(
			'desktop_mode_code_editor_invalid_payload',
			__( 'Missing content_b64 in request body.', 'desktop-mode-code-editor' ),
			array( 'status' => 400 )
		);
	}

	$content = base64_decode( $content_b64, true );
	if ( false === $content ) {
		return new WP_Error(
			'desktop_mode_code_editor_invalid_payload',
			__( 'content_b64 is not valid base64.', 'desktop-mode-code-editor' ),
			array( 'status' => 400 )
		);
	}

	if ( ! mb_check_encoding( $content, 'UTF-8' ) ) {
		return new WP_Error(
			'desktop_mode_code_editor_invalid_payload',
			__( 'Decoded content is not valid UTF-8 — only text files can be saved.', 'desktop-mode-code-editor' ),
			array( 'status' => 400 )
		);
	}

	/**
	 * Cap on the bytes a single save can write. Default 5 MB.
	 *
	 * @param int $bytes
	 */
	$max_bytes = (int) apply_filters( 'desktop_mode_code_editor_max_save_bytes', 5 * 1024 * 1024 );
	if ( strlen( $content ) > $max_bytes ) {
		return new WP_Error(
			'desktop_mode_code_editor_payload_too_large',
			sprintf(
				/* translators: 1: payload size, 2: limit. */
				__( 'Save payload too large (%1$s bytes; limit %2$s).', 'desktop-mode-code-editor' ),
				number_format_i18n( strlen( $content ) ),
				number_format_i18n( $max_bytes )
			),
			array( 'status' => 413 )
		);
	}

	$expected_mtime = (int) $request->get_param( 'mtime' );

	return desktop_mode_code_editor_write_file( $abs, $content, $expected_mtime );
}

/**
 * GET /php-symbols?prefix=&kinds=&limit=
 *
 * @param WP_REST_Request $request
 * @return array
 */
function desktop_mode_code_editor_rest_php_symbols( WP_REST_Request $request ) {
	$prefix    = (string) $request->get_param( 'prefix' );
	$kinds_raw = (string) $request->get_param( 'kinds' );
	$limit     = (int) $request->get_param( 'limit' );

	$kinds = array();
	if ( '' !== $kinds_raw ) {
		foreach ( explode( ',', $kinds_raw ) as $k ) {
			$k = strtolower( trim( $k ) );
			if ( in_array( $k, array( 'function', 'action', 'filter' ), true ) ) {
				$kinds[] = $k;
			}
		}
	}

	/**
	 * Filterable max result count.
	 *
	 * @param int $limit
	 */
	$limit = (int) apply_filters( 'desktop_mode_code_editor_php_completion_max_results', $limit > 0 ? $limit : 50 );

	$matches = desktop_mode_code_editor_query_php_symbols( $prefix, $kinds, $limit );

	$out = array();
	foreach ( $matches as $entry ) {
		$out[] = array(
			'name'      => $entry['name'],
			'kind'      => $entry['kind'],
			'signature' => $entry['signature'] ?? $entry['name'],
			'since'     => $entry['since'] ?? '',
			'source'    => $entry['source'] ?? '',
		);
	}

	return array(
		'prefix'  => $prefix,
		'kinds'   => $kinds,
		'count'   => count( $out ),
		'matches' => $out,
	);
}

/**
 * POST /php-symbols/rescan
 *
 * Drop the workspace index and rebuild from scratch.
 *
 * @return array
 */
function desktop_mode_code_editor_rest_php_symbols_rescan() {
	desktop_mode_code_editor_flush_workspace_index();
	$index = desktop_mode_code_editor_refresh_workspace_index( 5000 );
	return array(
		'files'   => count( $index['files'] ),
		'rebuilt' => true,
	);
}

/**
 * GET /php-symbols/<name>
 *
 * @param WP_REST_Request $request
 * @return array|WP_Error
 */
function desktop_mode_code_editor_rest_php_symbol_detail( WP_REST_Request $request ) {
	$name = (string) $request->get_param( 'name' );

	if ( function_exists( 'desktop_mode_code_editor_get_workspace_symbol' ) ) {
		$ws = desktop_mode_code_editor_get_workspace_symbol( $name );
		if ( null !== $ws ) {
			return $ws;
		}
	}

	$entry = desktop_mode_code_editor_get_php_symbol( $name );
	if ( null === $entry ) {
		return new WP_Error(
			'desktop_mode_code_editor_symbol_not_found',
			sprintf(
				/* translators: %s: symbol name. */
				__( 'No PHP symbol matches "%s".', 'desktop-mode-code-editor' ),
				$name
			),
			array( 'status' => 404 )
		);
	}
	return $entry;
}
