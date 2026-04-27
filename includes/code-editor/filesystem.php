<?php
/**
 * Desktop Mode — Code Editor filesystem helpers.
 *
 * Single-source path safety for every REST route the editor exposes.
 * The shape every caller relies on:
 *
 *   - {@see wpdc_workspace_root()}       — canonical absolute path the
 *                                          editor is allowed to roam in
 *                                          (default `WP_CONTENT_DIR`,
 *                                          filterable).
 *   - {@see wpdc_resolve_path()}         — turns an untrusted relative
 *                                          path into a canonical
 *                                          absolute one. Returns
 *                                          `WP_Error` on any escape
 *                                          attempt; never silently
 *                                          coerces.
 *   - {@see wpdc_extension_allowlist()}  — file extensions Monaco may
 *                                          read/write. Filterable so
 *                                          plugin authors can extend
 *                                          (e.g. add `.vue`) or
 *                                          tighten (e.g. drop `.php`).
 *
 * **All filesystem entry points MUST go through `wpdc_resolve_path`.**
 * Concatenating user input directly with the workspace root invites
 * traversal bugs; the resolver does `realpath()` + prefix check +
 * symlink-escape detection in one place so the rest of the editor
 * doesn't have to think about it.
 *
 * @package WPDesktopMode
 * @since 0.18.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Default file-extension allowlist (lowercased, no leading dot).
 *
 * Filtered through `wpdc_extension_allowlist`. The default is the
 * intersection of "what plugin/theme work touches" and "what Monaco
 * can usefully edit" — binary formats and uploads stay out.
 *
 * @since 0.18.0
 */
const WPDC_DEFAULT_EXTENSIONS = array(
	'php',
	'js',
	'jsx',
	'ts',
	'tsx',
	'mjs',
	'cjs',
	'css',
	'scss',
	'sass',
	'less',
	'html',
	'htm',
	'json',
	'md',
	'mdx',
	'txt',
	'svg',
	'xml',
	'yml',
	'yaml',
);

/**
 * Returns the workspace root (canonical absolute path, no trailing slash).
 *
 * Filterable via `wpdc_workspace_root` for plugins that legitimately
 * need a wider or narrower scope (e.g. `WP_CONTENT_DIR . '/plugins'`
 * to lock the editor to the plugins tree only). Whatever the filter
 * returns is `realpath()`'d before we hand it back, so a non-existent
 * path or a symlink chain that breaks resolves to an empty string —
 * callers should treat empty as "editor disabled."
 *
 * @since 0.18.0
 *
 * @return string Canonical absolute path, or '' if the root can't resolve.
 */
function wpdc_workspace_root() {
	$default = defined( 'WP_CONTENT_DIR' ) ? WP_CONTENT_DIR : '';

	/**
	 * Filter the workspace root the code editor is allowed to roam in.
	 *
	 * @since 0.18.0
	 *
	 * @param string $root Default workspace root (absolute path).
	 */
	$root = (string) apply_filters( 'wpdc_workspace_root', $default );

	$resolved = realpath( $root );
	return is_string( $resolved ) ? rtrim( $resolved, DIRECTORY_SEPARATOR ) : '';
}

/**
 * Returns the file-extension allowlist (lowercased, no dots).
 *
 * @since 0.18.0
 *
 * @return string[]
 */
function wpdc_extension_allowlist() {
	/**
	 * Filter the extensions the code editor is allowed to read/write.
	 *
	 * @since 0.18.0
	 *
	 * @param string[] $exts Default allowlist.
	 */
	$exts = (array) apply_filters( 'wpdc_extension_allowlist', WPDC_DEFAULT_EXTENSIONS );

	$out = array();
	foreach ( $exts as $ext ) {
		$ext = strtolower( ltrim( (string) $ext, '.' ) );
		if ( '' !== $ext ) {
			$out[] = $ext;
		}
	}
	return array_values( array_unique( $out ) );
}

/**
 * Whether a path's extension is permitted. Always true for directories.
 *
 * @since 0.18.0
 *
 * @param string $absolute_path Canonical absolute path.
 * @return bool
 */
function wpdc_extension_allowed( $absolute_path ) {
	if ( is_dir( $absolute_path ) ) {
		return true;
	}
	$ext = strtolower( pathinfo( $absolute_path, PATHINFO_EXTENSION ) );
	if ( '' === $ext ) {
		// Unextensioned files (.htaccess, README) — allow only when
		// the basename itself is in the allowlist (rare but the
		// filter can opt in by adding `'htaccess'`).
		$base = strtolower( pathinfo( $absolute_path, PATHINFO_BASENAME ) );
		return in_array( ltrim( $base, '.' ), wpdc_extension_allowlist(), true );
	}
	return in_array( $ext, wpdc_extension_allowlist(), true );
}

/**
 * Resolve an untrusted relative path against the workspace root.
 *
 * Returns the canonical absolute path on success, or `WP_Error` with
 * a clear `code` on any failure. The resolution is strict — symlinks
 * pointing outside the workspace, `..` escapes, missing files, and
 * disallowed extensions all fail closed.
 *
 * **Use this for every filesystem operation.** Tree listing, file
 * read, file write, file rename — all bottleneck through the same
 * resolver so there is one place path safety lives.
 *
 * @since 0.18.0
 *
 * @param string $rel_path Untrusted relative path. Empty string ('')
 *                         resolves to the workspace root itself.
 * @return string|WP_Error Canonical absolute path, or WP_Error.
 */
function wpdc_resolve_path( $rel_path ) {
	$root = wpdc_workspace_root();
	if ( '' === $root ) {
		return new WP_Error(
			'wpdc_no_workspace',
			__( 'Code editor workspace root is not configured or could not be resolved.', 'desktop-mode' ),
			array( 'status' => 500 )
		);
	}

	$rel_path = (string) $rel_path;
	// Normalize separators + collapse leading/trailing slashes. We do
	// NOT decode the path — REST already URL-decoded it. Decoding twice
	// would let `%2e%2e` slip through as `..`.
	$rel_path = str_replace( array( '\\', '//' ), '/', $rel_path );
	$rel_path = trim( $rel_path, '/' );

	if ( '' === $rel_path ) {
		// Root listing path — explicitly allowed; return the root
		// directly without going through the candidate-build dance
		// (saves a `realpath` and avoids accidental `/` mangling).
		return $root;
	}

	// Reject control characters and NUL bytes outright. realpath() in
	// some PHP/OS combos truncates at NUL; safer to refuse here.
	if ( preg_match( '/[\\x00-\\x1f]/', $rel_path ) ) {
		return new WP_Error(
			'wpdc_path_invalid',
			__( 'Path contains control characters.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$candidate = $root . DIRECTORY_SEPARATOR . str_replace( '/', DIRECTORY_SEPARATOR, $rel_path );
	$resolved  = realpath( $candidate );
	if ( false === $resolved ) {
		return new WP_Error(
			'wpdc_path_not_found',
			__( 'Path does not exist or is not accessible.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}

	// Strict prefix check. `realpath()` follows symlinks, so a symlink
	// inside the workspace pointing at /etc resolves to /etc and gets
	// rejected here even though the symlink itself was inside the root.
	$resolved_norm = rtrim( $resolved, DIRECTORY_SEPARATOR );
	$root_norm     = rtrim( $root, DIRECTORY_SEPARATOR );
	if (
		$resolved_norm !== $root_norm &&
		strpos( $resolved_norm . DIRECTORY_SEPARATOR, $root_norm . DIRECTORY_SEPARATOR ) !== 0
	) {
		return new WP_Error(
			'wpdc_path_outside_workspace',
			__( 'Path resolves outside the workspace root.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}

	if ( ! wpdc_extension_allowed( $resolved_norm ) ) {
		return new WP_Error(
			'wpdc_extension_denied',
			__( 'File extension is not allowed by the editor.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}

	return $resolved_norm;
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Write `$content` to a file inside the workspace.
 *
 * The whole save flow goes through here. Path safety has already
 * been checked by the REST layer's `wpdc_resolve_path()` call;
 * this function focuses on the actual write — `WP_Filesystem`
 * dispatch, optimistic-concurrency check via mtime, OPcache
 * invalidation, the before/after action hooks plugins use to
 * audit or transform.
 *
 * Returns:
 *
 *   array  { path, mtime, size }                        — happy path.
 *   WP_Error 'wpdc_conflict'                            — caller's
 *           expected mtime doesn't match current. Error data carries
 *           `{ server_mtime, server_content, server_size }` so the
 *           UI can offer "diff & overwrite" / "reload from disk".
 *   WP_Error 'wpdc_filesystem_unavailable'              — host needs
 *           FTP/SSH credentials we don't yet collect. Phase 4 work.
 *   WP_Error 'wpdc_write_failed'                        — generic.
 *
 * @since 0.18.0
 *
 * @param string $absolute_path     Result of {@see wpdc_resolve_path()}.
 * @param string $content           UTF-8 bytes to write.
 * @param int    $expected_mtime    The mtime the caller read this
 *                                  file at; pass `0` for new files.
 * @return array|WP_Error
 */
function wpdc_write_file( $absolute_path, $content, $expected_mtime = 0 ) {
	if ( ! is_string( $absolute_path ) || '' === $absolute_path ) {
		return new WP_Error(
			'wpdc_write_invalid_path',
			__( 'Invalid path supplied to wpdc_write_file().', 'desktop-mode' ),
			array( 'status' => 500 )
		);
	}

	// Phase 3 ships overwrites of existing files only. New-file
	// creation goes through a future `/code/file/create` route so
	// the UX (filename picker, parent directory cap-check) doesn't
	// accidentally piggyback on the save shortcut.
	if ( ! is_file( $absolute_path ) ) {
		return new WP_Error(
			'wpdc_write_target_missing',
			__( 'File does not exist; the editor cannot create new files yet.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}

	// Optimistic-concurrency check. `0` opts out (caller knows the
	// file is fresh — e.g. a programmatic save right after a read
	// inside the same request).
	$expected_mtime = (int) $expected_mtime;
	$current_mtime  = (int) filemtime( $absolute_path );
	if ( $expected_mtime > 0 && $current_mtime !== $expected_mtime ) {
		$current = file_get_contents( $absolute_path ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
		return new WP_Error(
			'wpdc_conflict',
			__( 'File changed on disk since you opened it. Reload or overwrite.', 'desktop-mode' ),
			array(
				'status'         => 409,
				'server_mtime'   => $current_mtime,
				'server_content' => false === $current ? '' : $current,
				'server_size'    => (int) filesize( $absolute_path ),
			)
		);
	}

	$context = array(
		'path'   => wpdc_path_to_relative( $absolute_path ),
		'mtime'  => $current_mtime,
		'bytes'  => strlen( $content ),
	);

	/**
	 * Filter the bytes about to be written.
	 *
	 * Plugins use this to auto-format, normalize line endings, run
	 * a linter pre-write, etc. Returning a string replaces the
	 * payload; returning a WP_Error aborts the save and surfaces
	 * the error to the caller.
	 *
	 * @since 0.18.0
	 *
	 * @param string $content       Bytes the editor wants to write.
	 * @param string $absolute_path Resolved absolute path.
	 * @param array  $context       { path (rel), mtime, bytes }.
	 */
	$filtered = apply_filters( 'wpdc_save_content', $content, $absolute_path, $context );
	if ( is_wp_error( $filtered ) ) {
		return $filtered;
	}
	if ( is_string( $filtered ) ) {
		$content = $filtered;
	}

	/**
	 * Fires before a file is written. Plugins use this for audit
	 * logging or to short-circuit by returning early elsewhere.
	 *
	 * @since 0.18.0
	 *
	 * @param string $absolute_path
	 * @param string $content
	 * @param array  $context
	 */
	do_action( 'wpdc_before_save', $absolute_path, $content, $context );

	$fs = wpdc_get_filesystem();
	if ( is_wp_error( $fs ) ) {
		return $fs;
	}

	if ( ! $fs->put_contents( $absolute_path, $content, FS_CHMOD_FILE ) ) {
		return new WP_Error(
			'wpdc_write_failed',
			__( 'WP_Filesystem refused the write. The file may be read-only or owned by a different user.', 'desktop-mode' ),
			array( 'status' => 500 )
		);
	}

	// Bust OPcache for `.php` writes so the next request picks up
	// the new bytecode. Easy to forget — the bug appears as "I
	// edited the file but the site still runs the old code."
	if ( function_exists( 'opcache_invalidate' ) && '.php' === substr( strtolower( $absolute_path ), -4 ) ) {
		@opcache_invalidate( $absolute_path, true ); // phpcs:ignore WordPress.PHP.NoSilencedErrors
	}

	// Re-stat after write — `clearstatcache` so the new mtime is
	// fresh, not the stale one PHP cached during the read above.
	clearstatcache( true, $absolute_path );
	$new_mtime = (int) filemtime( $absolute_path );
	$new_size  = (int) filesize( $absolute_path );

	$context['mtime'] = $new_mtime;
	$context['bytes'] = $new_size;

	/**
	 * Fires after a successful write. Carries the new mtime + size
	 * so audit-log subscribers don't have to re-stat.
	 *
	 * @since 0.18.0
	 *
	 * @param string $absolute_path
	 * @param string $content
	 * @param array  $context
	 */
	do_action( 'wpdc_after_save', $absolute_path, $content, $context );

	return array(
		'path'  => wpdc_path_to_relative( $absolute_path ),
		'mtime' => $new_mtime,
		'size'  => $new_size,
	);
}

/**
 * Returns an initialized WP_Filesystem global, or WP_Error.
 *
 * Bottlenecks every editor write through one place so:
 *   - We can swap `WP_Filesystem_Direct` for FTP/SSH later
 *     without touching the writer.
 *   - Hosts that genuinely require credentials surface a single
 *     stable error code (`wpdc_filesystem_unavailable`) the JS
 *     can branch on (Phase 4 will turn that into a credential
 *     prompt UI).
 *
 * Phase 3 only supports the direct method — sufficient for
 * Docker dev + most managed/single-tenant hosts. Shared-FTP-only
 * hosts are documented as a follow-up.
 *
 * @since 0.18.0
 *
 * @return WP_Filesystem_Base|WP_Error
 */
function wpdc_get_filesystem() {
	global $wp_filesystem;

	if ( $wp_filesystem instanceof WP_Filesystem_Base ) {
		return $wp_filesystem;
	}

	if ( ! function_exists( 'WP_Filesystem' ) ) {
		require_once ABSPATH . 'wp-admin/includes/file.php';
	}

	// Force Direct for now. The non-direct branch outputs an HTML
	// credentials form (which would corrupt JSON); we'd rather
	// fail loud with a JSON error.
	add_filter( 'filesystem_method', 'wpdc_force_direct_filesystem', 999 );
	$ok = WP_Filesystem();
	remove_filter( 'filesystem_method', 'wpdc_force_direct_filesystem', 999 );

	if ( ! $ok || ! ( $wp_filesystem instanceof WP_Filesystem_Base ) ) {
		return new WP_Error(
			'wpdc_filesystem_unavailable',
			__( "This host doesn't allow direct file writes from the WordPress process. The code editor's save flow needs FTP/SSH credentials, which aren't supported yet.", 'desktop-mode' ),
			array( 'status' => 503 )
		);
	}

	return $wp_filesystem;
}

/**
 * @internal Filter callback for `wpdc_get_filesystem()` — pin to direct.
 */
function wpdc_force_direct_filesystem() {
	return 'direct';
}

// ---------------------------------------------------------------------------
// Path translation
// ---------------------------------------------------------------------------

/**
 * Strip the workspace prefix from an absolute path; returns the
 * forward-slash-normalized relative path used in REST responses.
 *
 * @since 0.18.0
 *
 * @param string $absolute_path
 * @return string
 */
function wpdc_path_to_relative( $absolute_path ) {
	$root = wpdc_workspace_root();
	if ( '' === $root ) {
		return '';
	}
	$abs = rtrim( (string) $absolute_path, DIRECTORY_SEPARATOR );
	if ( $abs === $root ) {
		return '';
	}
	if ( strpos( $abs . DIRECTORY_SEPARATOR, $root . DIRECTORY_SEPARATOR ) !== 0 ) {
		return '';
	}
	$rel = substr( $abs, strlen( $root ) + 1 );
	return str_replace( DIRECTORY_SEPARATOR, '/', (string) $rel );
}
