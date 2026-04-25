<?php
/**
 * Desktop Mode — Code Editor REST routes.
 *
 * Phase 2 surface (read-only):
 *   - GET /wp-desktop/v1/code/tree?path=<rel>  → list a directory.
 *   - GET /wp-desktop/v1/code/file?path=<rel>  → read a file's content.
 *
 * Phase 3 will add PUT /code/file (write) + DELETE /code/file + a
 * /code/file/rename route.
 *
 * Every route bottlenecks through {@see wpdc_resolve_path()} for path
 * safety + the same `permission_callback` (logged-in admin holding
 * `edit_plugins`, with `DISALLOW_FILE_EDIT` honoured). Handlers wrap
 * their body in `ob_start()` / `ob_get_clean()` because PHP notices
 * (with `WP_DEBUG=true` + `display_errors=on`) get printed before the
 * REST headers, which corrupts the JSON response — a sneaky bug
 * that's easy to ship and impossible to debug from the user side.
 *
 * @package WPDesktopMode
 * @since 0.18.0
 */

defined( 'ABSPATH' ) || exit;

const WPDC_REST_NAMESPACE = 'wp-desktop/v1';

/**
 * Permission gate for every editor REST route.
 *
 * Filterable via `wpdc_required_capability` so a site can swap
 * `edit_plugins` for a custom cap without forking. Returns `true` /
 * `WP_Error` so REST builds a proper 401/403 response.
 *
 * @since 0.18.0
 *
 * @return true|WP_Error
 */
function wpdc_rest_permission() {
	if ( ! is_user_logged_in() ) {
		return new WP_Error(
			'wpdc_unauthenticated',
			__( 'You must be logged in to use the code editor.', 'wp-desktop-mode' ),
			array( 'status' => 401 )
		);
	}

	if ( ! wpdc_file_edit_allowed() ) {
		return new WP_Error(
			'wpdc_file_edit_disabled',
			__( 'In-admin file editing is disabled on this site (DISALLOW_FILE_EDIT).', 'wp-desktop-mode' ),
			array( 'status' => 403 )
		);
	}

	/**
	 * Filter the capability required to use the code editor.
	 *
	 * @since 0.18.0
	 *
	 * @param string $capability Default `edit_plugins`.
	 */
	$cap = (string) apply_filters( 'wpdc_required_capability', 'edit_plugins' );
	if ( ! current_user_can( $cap ) ) {
		return new WP_Error(
			'wpdc_forbidden',
			__( 'You do not have permission to use the code editor.', 'wp-desktop-mode' ),
			array( 'status' => 403 )
		);
	}

	return true;
}

/**
 * Wrap a REST handler so PHP notices / warnings printed under
 * WP_DEBUG don't leak into the response body and corrupt the JSON.
 *
 * @since 0.18.0
 *
 * @param callable $handler `function( WP_REST_Request ): array|WP_REST_Response|WP_Error`.
 * @return callable
 */
function wpdc_rest_handler( $handler ) {
	return static function ( WP_REST_Request $request ) use ( $handler ) {
		ob_start();
		try {
			$result = call_user_func( $handler, $request );
		} finally {
			// Discard whatever PHP notices/warnings buffered up.
			// Logged still goes to error_log; the REST response
			// stays clean JSON.
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
 *
 * @since 0.18.0
 */
function wpdc_register_editor_rest_routes() {
	register_rest_route(
		WPDC_REST_NAMESPACE,
		'/code/tree',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => wpdc_rest_handler( 'wpdc_rest_tree' ),
			'permission_callback' => 'wpdc_rest_permission',
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
		WPDC_REST_NAMESPACE,
		'/code/php-symbols',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => wpdc_rest_handler( 'wpdc_rest_php_symbols' ),
			'permission_callback' => 'wpdc_rest_permission',
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
		WPDC_REST_NAMESPACE,
		'/code/php-symbols/rescan',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => wpdc_rest_handler( 'wpdc_rest_php_symbols_rescan' ),
			'permission_callback' => 'wpdc_rest_permission',
		)
	);

	register_rest_route(
		WPDC_REST_NAMESPACE,
		// `[A-Za-z0-9_\\/.-]` — alphanum, underscore, namespace
		// separator (`\`), slash, period, hyphen. PHP single-quoted
		// strings preserve `\\` as two chars; the regex sees `\\`,
		// matching one literal backslash. Hyphen at the end of the
		// class is literal without escaping.
		'/code/php-symbols/(?P<name>[A-Za-z0-9_\\\\/.-]+)',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => wpdc_rest_handler( 'wpdc_rest_php_symbol_detail' ),
			'permission_callback' => 'wpdc_rest_permission',
			'args'                => array(
				'name' => array(
					'required' => true,
					'type'     => 'string',
				),
			),
		)
	);

	register_rest_route(
		WPDC_REST_NAMESPACE,
		'/code/file',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => wpdc_rest_handler( 'wpdc_rest_read_file' ),
				'permission_callback' => 'wpdc_rest_permission',
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
				// containing `<?php` strings outright. Accepting
				// POST as well lets the client fall through.
				'methods'             => 'PUT, POST',
				'callback'            => wpdc_rest_handler( 'wpdc_rest_write_file' ),
				'permission_callback' => 'wpdc_rest_permission',
				'args'                => array(
					'path'        => array(
						'required' => true,
						'type'     => 'string',
					),
					'content_b64' => array(
						'required'    => true,
						'type'        => 'string',
						'description' => 'Base64-encoded UTF-8 file contents. Encoded on the wire to bypass WAFs that scan POST bodies for `<?php` strings.',
					),
					'mtime'       => array(
						'required'    => true,
						'type'        => 'integer',
						'description' => 'The mtime the editor read this file at. Server compares against current mtime; mismatch returns 409 with the disk version.',
					),
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'wpdc_register_editor_rest_routes' );

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * GET /wp-desktop/v1/code/tree?path=<rel>
 *
 * Lists a single directory level. Returns folders first, then files,
 * each alphabetised. Skips dotfiles by default (filterable). Files
 * outside the extension allowlist are listed but flagged so the JS
 * tree can grey them out — a flat refusal to list them would hide
 * legitimate context (the user knows which file they're trying to
 * open; we just can't open it ourselves).
 *
 * @since 0.18.0
 *
 * @param WP_REST_Request $request
 * @return array|WP_Error
 */
function wpdc_rest_tree( WP_REST_Request $request ) {
	$rel  = (string) $request->get_param( 'path' );
	$abs  = wpdc_resolve_path( $rel );
	if ( is_wp_error( $abs ) ) {
		return $abs;
	}
	if ( ! is_dir( $abs ) ) {
		return new WP_Error(
			'wpdc_not_a_directory',
			__( 'Path is not a directory.', 'wp-desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$entries = array();
	$dh      = @opendir( $abs ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
	if ( false === $dh ) {
		return new WP_Error(
			'wpdc_directory_unreadable',
			__( 'Directory is not readable.', 'wp-desktop-mode' ),
			array( 'status' => 500 )
		);
	}

	$exts = wpdc_extension_allowlist();

	/**
	 * Filter whether dotfiles (names starting with `.`) appear in
	 * the tree. Default `false` — most plugin/theme work doesn't
	 * involve dotfiles and they're noisy in the picker.
	 *
	 * @since 0.18.0
	 *
	 * @param bool $include_dotfiles
	 */
	$include_dotfiles = (bool) apply_filters( 'wpdc_tree_include_dotfiles', false );

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
			// realpath the symlink. If it leaves the workspace, hide
			// it entirely (don't list a row that can't be opened) —
			// keeps the tree honest.
			$resolved = realpath( $child_abs );
			$root     = wpdc_workspace_root();
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
			'path'    => wpdc_path_to_relative( $child_abs ),
			'type'    => $is_dir ? 'dir' : 'file',
			'size'    => $is_dir ? 0 : (int) @filesize( $child_abs ), // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
			'mtime'   => (int) @filemtime( $child_abs ), // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
			'allowed' => $allowed,
		);

		$entries[] = $entry;
	}
	closedir( $dh );

	// Folders first, then files, each alphabetical (case-insensitive).
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
	 * Plugins can hide rows (e.g. a security plugin censoring its
	 * own config), prepend virtual entries, or rewrite the
	 * `allowed` flag to lock down a path.
	 *
	 * @since 0.18.0
	 *
	 * @param array  $entries List of entry arrays.
	 * @param string $rel     Relative directory path being listed.
	 * @param string $abs     Absolute directory path.
	 */
	$entries = (array) apply_filters( 'wpdc_tree_entries', $entries, $rel, $abs );

	return array(
		'path'    => wpdc_path_to_relative( $abs ),
		'entries' => $entries,
	);
}

/**
 * GET /wp-desktop/v1/code/file?path=<rel>
 *
 * Returns the file's UTF-8 content + mtime + size. Phase 3 adds a
 * PUT counterpart that takes `if_unmodified_since: <mtime>` so two
 * tabs editing the same file can't silently clobber each other.
 *
 * Files larger than the threshold are refused — Monaco starts to
 * struggle past ~5MB and a 50MB file is almost certainly a binary
 * masquerading as a known extension. Threshold is filterable.
 *
 * @since 0.18.0
 *
 * @param WP_REST_Request $request
 * @return array|WP_Error
 */
function wpdc_rest_read_file( WP_REST_Request $request ) {
	$rel = (string) $request->get_param( 'path' );
	$abs = wpdc_resolve_path( $rel );
	if ( is_wp_error( $abs ) ) {
		return $abs;
	}
	if ( ! is_file( $abs ) ) {
		return new WP_Error(
			'wpdc_not_a_file',
			__( 'Path is not a file.', 'wp-desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	/**
	 * Maximum file size (bytes) the editor will read. Default 5 MB.
	 *
	 * @since 0.18.0
	 *
	 * @param int $bytes
	 */
	$max_bytes = (int) apply_filters( 'wpdc_max_file_bytes', 5 * 1024 * 1024 );
	$size      = (int) filesize( $abs );
	if ( $size > $max_bytes ) {
		return new WP_Error(
			'wpdc_file_too_large',
			sprintf(
				/* translators: 1: file size, 2: limit. */
				__( 'File is too large to open in the editor (%1$s bytes; limit %2$s).', 'wp-desktop-mode' ),
				number_format_i18n( $size ),
				number_format_i18n( $max_bytes )
			),
			array( 'status' => 413, 'size' => $size, 'limit' => $max_bytes )
		);
	}

	$content = file_get_contents( $abs ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
	if ( false === $content ) {
		return new WP_Error(
			'wpdc_file_unreadable',
			__( 'File is not readable.', 'wp-desktop-mode' ),
			array( 'status' => 500 )
		);
	}

	// Reject files that aren't valid UTF-8. Binaries (images, fonts)
	// trip this — the allowlist's mostly-text shape catches them on
	// extension already, but `*.svg` is the easy escape hatch.
	if ( ! mb_check_encoding( $content, 'UTF-8' ) ) {
		return new WP_Error(
			'wpdc_binary_file',
			__( 'File contents are not valid UTF-8 — the editor only opens text files.', 'wp-desktop-mode' ),
			array( 'status' => 415 )
		);
	}

	return array(
		'path'     => wpdc_path_to_relative( $abs ),
		'content'  => $content,
		'mtime'    => (int) filemtime( $abs ),
		'size'     => $size,
		'encoding' => 'utf-8',
	);
}

/**
 * POST/PUT /wp-desktop/v1/code/file
 *
 * Body:
 *   path        (string)  relative path inside the workspace.
 *   content_b64 (string)  base64-encoded UTF-8 file contents.
 *   mtime       (integer) the mtime the client opened the file at.
 *
 * Returns `{ path, mtime, size }` on success, or `WP_Error` with a
 * stable code on failure (`wpdc_conflict`, `wpdc_path_outside_workspace`,
 * `wpdc_extension_denied`, `wpdc_filesystem_unavailable`,
 * `wpdc_write_failed`, `wpdc_invalid_payload`).
 *
 * The path resolution + capability check are identical to the read
 * route — `wpdc_resolve_path` rejects symlink escapes / traversal /
 * disallowed extensions before the writer ever runs.
 *
 * @since 0.18.0
 *
 * @param WP_REST_Request $request
 * @return array|WP_Error
 */
function wpdc_rest_write_file( WP_REST_Request $request ) {
	$rel = (string) $request->get_param( 'path' );
	$abs = wpdc_resolve_path( $rel );
	if ( is_wp_error( $abs ) ) {
		return $abs;
	}

	$content_b64 = (string) $request->get_param( 'content_b64' );
	if ( '' === $content_b64 ) {
		return new WP_Error(
			'wpdc_invalid_payload',
			__( 'Missing content_b64 in request body.', 'wp-desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$content = base64_decode( $content_b64, true );
	if ( false === $content ) {
		return new WP_Error(
			'wpdc_invalid_payload',
			__( 'content_b64 is not valid base64.', 'wp-desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	if ( ! mb_check_encoding( $content, 'UTF-8' ) ) {
		return new WP_Error(
			'wpdc_invalid_payload',
			__( 'Decoded content is not valid UTF-8 — only text files can be saved.', 'wp-desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	/**
	 * Cap on the bytes a single save can write. Default 5 MB —
	 * matches the read-side `wpdc_max_file_bytes` so a file you
	 * could open you can also save back. Filterable independently
	 * for plugins that want a tighter write quota.
	 *
	 * @since 0.18.0
	 *
	 * @param int $bytes
	 */
	$max_bytes = (int) apply_filters( 'wpdc_max_save_bytes', 5 * 1024 * 1024 );
	if ( strlen( $content ) > $max_bytes ) {
		return new WP_Error(
			'wpdc_payload_too_large',
			sprintf(
				/* translators: 1: payload size, 2: limit. */
				__( 'Save payload too large (%1$s bytes; limit %2$s).', 'wp-desktop-mode' ),
				number_format_i18n( strlen( $content ) ),
				number_format_i18n( $max_bytes )
			),
			array( 'status' => 413 )
		);
	}

	$expected_mtime = (int) $request->get_param( 'mtime' );

	return wpdc_write_file( $abs, $content, $expected_mtime );
}

/**
 * GET /wp-desktop/v1/code/php-symbols?prefix=&kinds=&limit=
 *
 * Prefix-matches the WP core symbol index (functions + hooks). Used
 * by Monaco's PHP completion provider; cap-bounded at 50 matches by
 * default so the dropdown never gets unwieldy.
 *
 * `kinds` is comma-separated — `function`, `action`, `filter`.
 * Empty (default) returns all kinds. Pass e.g. `kinds=action,filter`
 * inside an `add_action( '|` context for hook-only completion.
 *
 * @since 0.18.0
 *
 * @param WP_REST_Request $request
 * @return array
 */
function wpdc_rest_php_symbols( WP_REST_Request $request ) {
	$prefix = (string) $request->get_param( 'prefix' );
	$kinds_raw = (string) $request->get_param( 'kinds' );
	$limit  = (int) $request->get_param( 'limit' );

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
	 * Filterable max result count — completion dropdowns past 50
	 * become hard to scan.
	 *
	 * @since 0.18.0
	 *
	 * @param int $limit
	 */
	$limit = (int) apply_filters( 'wpdc_php_completion_max_results', $limit > 0 ? $limit : 50 );

	$matches = wpdc_query_php_symbols( $prefix, $kinds, $limit );

	// Trim heavy fields for the list response — Monaco doesn't need
	// the full PHPDoc until the user hovers, and doc strings dominate
	// the JSON size. Hover route returns the fat shape.
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
 * GET /wp-desktop/v1/code/php-symbols/<name>
 *
 * Returns the full record for a single symbol — including the PHPDoc
 * summary, parameters, and source location. Used by Monaco's hover
 * provider lazily (on user hover, not on every keystroke).
 *
 * @since 0.18.0
 *
 * @param WP_REST_Request $request
 * @return array|WP_Error
 */
/**
 * POST /wp-desktop/v1/code/php-symbols/rescan
 *
 * Drop the workspace index and rebuild from scratch. Useful after
 * activating a plugin / installing a theme so the editor doesn't
 * stay blind to the new symbols until WP-Cron picks up the slack.
 *
 * Returns the count of files indexed.
 *
 * @since 0.18.0
 */
function wpdc_rest_php_symbols_rescan() {
	wpdc_flush_workspace_index();
	$index = wpdc_refresh_workspace_index( 5000 );
	return array(
		'files'   => count( $index['files'] ),
		'rebuilt' => true,
	);
}

function wpdc_rest_php_symbol_detail( WP_REST_Request $request ) {
	$name = (string) $request->get_param( 'name' );

	// Workspace first — when a project ships a helper with the same
	// name as a WP core fn, the local definition is almost always
	// what the user actually wants to navigate to.
	if ( function_exists( 'wpdc_get_workspace_symbol' ) ) {
		$ws = wpdc_get_workspace_symbol( $name );
		if ( null !== $ws ) {
			return $ws;
		}
	}

	$entry = wpdc_get_php_symbol( $name );
	if ( null === $entry ) {
		return new WP_Error(
			'wpdc_symbol_not_found',
			sprintf(
				/* translators: %s: symbol name. */
				__( 'No PHP symbol matches "%s".', 'wp-desktop-mode' ),
				$name
			),
			array( 'status' => 404 )
		);
	}
	return $entry;
}
