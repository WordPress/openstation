<?php
/**
 * Filesystem helpers for the Code Editor extension.
 *
 * Single-source path safety for every REST route the editor exposes.
 *
 *   - {@see openstation_code_editor_workspace_root()}      — canonical
 *                                                              absolute
 *                                                              workspace
 *                                                              root.
 *   - {@see openstation_code_editor_resolve_path()}        — turns an
 *                                                              untrusted
 *                                                              relative
 *                                                              path into
 *                                                              a canonical
 *                                                              absolute
 *                                                              one.
 *   - {@see openstation_code_editor_extension_allowlist()} — the file-
 *                                                              extension
 *                                                              allowlist.
 *
 * **All filesystem entry points MUST go through
 * {@see openstation_code_editor_resolve_path()}.** Concatenating user
 * input directly with the workspace root invites traversal bugs; the
 * resolver does `realpath()` + prefix check + symlink-escape detection
 * in one place so the rest of the editor doesn't have to think about it.
 *
 * @package OpenStationCodeEditor
 */

defined( 'ABSPATH' ) || exit;

/**
 * Default file-extension allowlist (lowercased, no leading dot).
 */
const OPENSTATION_CODE_EDITOR_DEFAULT_EXTENSIONS = array(
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
 * Whether the current site allows in-admin file editing.
 *
 * Mirrors the same gate WordPress core applies to the Theme/Plugin
 * editor: when `DISALLOW_FILE_EDIT` is true, the editor MUST NOT
 * expose any UI — it would mislead users into thinking saves work.
 *
 * @return bool
 */
function openstation_code_editor_file_edit_allowed() {
	return ! ( defined( 'DISALLOW_FILE_EDIT' ) && DISALLOW_FILE_EDIT );
}

/**
 * Whether the current user can use the code editor at all.
 *
 * @return bool
 */
function openstation_code_editor_user_can_use() {
	$can = openstation_code_editor_file_edit_allowed() && current_user_can( 'edit_plugins' );

	/**
	 * Filter whether the current user can see/use the Code Editor.
	 *
	 * @param bool $can Default: edit_plugins capability + DISALLOW_FILE_EDIT respected.
	 */
	return (bool) apply_filters( 'openstation_code_editor_user_can_use', $can );
}

/**
 * Returns the workspace root (canonical absolute path, no trailing slash).
 *
 * @return string Canonical absolute path, or '' if the root can't resolve.
 */
function openstation_code_editor_workspace_root() {
	$default = defined( 'WP_CONTENT_DIR' ) ? WP_CONTENT_DIR : '';

	/**
	 * Filter the workspace root the code editor is allowed to roam in.
	 *
	 * @param string $root Default workspace root (absolute path).
	 */
	$root = (string) apply_filters( 'openstation_code_editor_workspace_root', $default );

	$resolved = realpath( $root );
	return is_string( $resolved ) ? rtrim( $resolved, DIRECTORY_SEPARATOR ) : '';
}

/**
 * Returns the file-extension allowlist (lowercased, no dots).
 *
 * @return string[]
 */
function openstation_code_editor_extension_allowlist() {
	/**
	 * Filter the extensions the code editor is allowed to read/write.
	 *
	 * @param string[] $exts Default allowlist.
	 */
	$exts = (array) apply_filters(
		'openstation_code_editor_extension_allowlist',
		OPENSTATION_CODE_EDITOR_DEFAULT_EXTENSIONS
	);

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
 * @param string $absolute_path Canonical absolute path.
 * @return bool
 */
function openstation_code_editor_extension_allowed( $absolute_path ) {
	if ( is_dir( $absolute_path ) ) {
		return true;
	}
	$ext = strtolower( pathinfo( $absolute_path, PATHINFO_EXTENSION ) );
	if ( '' === $ext ) {
		$base = strtolower( pathinfo( $absolute_path, PATHINFO_BASENAME ) );
		return in_array( ltrim( $base, '.' ), openstation_code_editor_extension_allowlist(), true );
	}
	return in_array( $ext, openstation_code_editor_extension_allowlist(), true );
}

/**
 * Resolve an untrusted relative path against the workspace root.
 *
 * @param string $rel_path Untrusted relative path.
 * @return string|WP_Error Canonical absolute path, or WP_Error.
 */
function openstation_code_editor_resolve_path( $rel_path ) {
	$root = openstation_code_editor_workspace_root();
	if ( '' === $root ) {
		return new WP_Error(
			'openstation_code_editor_no_workspace',
			__( 'Code editor workspace root is not configured or could not be resolved.', 'desktop-mode-code-editor' ),
			array( 'status' => 500 )
		);
	}

	$rel_path = (string) $rel_path;
	$rel_path = str_replace( array( '\\', '//' ), '/', $rel_path );
	$rel_path = trim( $rel_path, '/' );

	if ( '' === $rel_path ) {
		return $root;
	}

	if ( preg_match( '/[\\x00-\\x1f]/', $rel_path ) ) {
		return new WP_Error(
			'openstation_code_editor_path_invalid',
			__( 'Path contains control characters.', 'desktop-mode-code-editor' ),
			array( 'status' => 400 )
		);
	}

	$candidate = $root . DIRECTORY_SEPARATOR . str_replace( '/', DIRECTORY_SEPARATOR, $rel_path );
	$resolved  = realpath( $candidate );
	if ( false === $resolved ) {
		return new WP_Error(
			'openstation_code_editor_path_not_found',
			__( 'Path does not exist or is not accessible.', 'desktop-mode-code-editor' ),
			array( 'status' => 404 )
		);
	}

	$resolved_norm = rtrim( $resolved, DIRECTORY_SEPARATOR );
	$root_norm     = rtrim( $root, DIRECTORY_SEPARATOR );
	if (
		$resolved_norm !== $root_norm &&
		strpos( $resolved_norm . DIRECTORY_SEPARATOR, $root_norm . DIRECTORY_SEPARATOR ) !== 0
	) {
		return new WP_Error(
			'openstation_code_editor_path_outside_workspace',
			__( 'Path resolves outside the workspace root.', 'desktop-mode-code-editor' ),
			array( 'status' => 403 )
		);
	}

	if ( ! openstation_code_editor_extension_allowed( $resolved_norm ) ) {
		return new WP_Error(
			'openstation_code_editor_extension_denied',
			__( 'File extension is not allowed by the editor.', 'desktop-mode-code-editor' ),
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
 * Returns:
 *
 *   array  { path, mtime, size }                                     — happy path.
 *   WP_Error 'openstation_code_editor_write_invalid_path'           — empty or
 *           non-string path supplied (500).
 *   WP_Error 'openstation_code_editor_write_target_missing'         — target file
 *           does not exist (404); the editor cannot create new files.
 *   WP_Error 'openstation_code_editor_conflict'                     — caller's
 *           expected mtime doesn't match current. Error data carries
 *           `{ server_mtime, server_content, server_size }` so the
 *           UI can offer "diff & overwrite" / "reload from disk".
 *   WP_Error 'openstation_code_editor_filesystem_unavailable'       — host needs
 *           FTP/SSH credentials we don't yet collect.
 *   WP_Error 'openstation_code_editor_write_failed'                 — generic.
 *
 * @param string $absolute_path  Result of {@see openstation_code_editor_resolve_path()}.
 * @param string $content        UTF-8 bytes to write.
 * @param int    $expected_mtime The mtime the caller read this file at; pass `0` to skip
 *                               the conflict check. (New-file creation is not supported —
 *                               the target must already exist.)
 * @return array|WP_Error
 */
function openstation_code_editor_write_file( $absolute_path, $content, $expected_mtime = 0 ) {
	if ( ! is_string( $absolute_path ) || '' === $absolute_path ) {
		return new WP_Error(
			'openstation_code_editor_write_invalid_path',
			__( 'Invalid path supplied to the writer.', 'desktop-mode-code-editor' ),
			array( 'status' => 500 )
		);
	}

	if ( ! is_file( $absolute_path ) ) {
		return new WP_Error(
			'openstation_code_editor_write_target_missing',
			__( 'File does not exist; the editor cannot create new files yet.', 'desktop-mode-code-editor' ),
			array( 'status' => 404 )
		);
	}

	$expected_mtime = (int) $expected_mtime;
	$current_mtime  = (int) filemtime( $absolute_path );
	if ( $expected_mtime > 0 && $current_mtime !== $expected_mtime ) {
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
		$current = file_get_contents( $absolute_path );
		return new WP_Error(
			'openstation_code_editor_conflict',
			__( 'File changed on disk since you opened it. Reload or overwrite.', 'desktop-mode-code-editor' ),
			array(
				'status'         => 409,
				'server_mtime'   => $current_mtime,
				'server_content' => false === $current ? '' : $current,
				'server_size'    => (int) filesize( $absolute_path ),
			)
		);
	}

	$context = array(
		'path'  => openstation_code_editor_path_to_relative( $absolute_path ),
		'mtime' => $current_mtime,
		'bytes' => strlen( $content ),
	);

	/**
	 * Filter the bytes about to be written.
	 *
	 * @param string $content       Bytes the editor wants to write.
	 * @param string $absolute_path Resolved absolute path.
	 * @param array  $context       { path (rel), mtime, bytes }.
	 */
	$filtered = apply_filters( 'openstation_code_editor_save_content', $content, $absolute_path, $context );
	if ( is_wp_error( $filtered ) ) {
		return $filtered;
	}
	if ( is_string( $filtered ) ) {
		$content = $filtered;
	}

	/**
	 * Fires before a file is written.
	 *
	 * @param string $absolute_path
	 * @param string $content
	 * @param array  $context
	 */
	do_action( 'openstation_code_editor_before_save', $absolute_path, $content, $context );

	$fs = openstation_code_editor_get_filesystem();
	if ( is_wp_error( $fs ) ) {
		return $fs;
	}

	if ( ! $fs->put_contents( $absolute_path, $content, FS_CHMOD_FILE ) ) {
		return new WP_Error(
			'openstation_code_editor_write_failed',
			__( 'WP_Filesystem refused the write. The file may be read-only or owned by a different user.', 'desktop-mode-code-editor' ),
			array( 'status' => 500 )
		);
	}

	if ( function_exists( 'opcache_invalidate' ) && '.php' === substr( strtolower( $absolute_path ), -4 ) ) {
		// phpcs:ignore WordPress.PHP.NoSilencedErrors
		@opcache_invalidate( $absolute_path, true );
	}

	clearstatcache( true, $absolute_path );
	$new_mtime = (int) filemtime( $absolute_path );
	$new_size  = (int) filesize( $absolute_path );

	$context['mtime'] = $new_mtime;
	$context['bytes'] = $new_size;

	/**
	 * Fires after a successful write.
	 *
	 * @param string $absolute_path
	 * @param string $content
	 * @param array  $context
	 */
	do_action( 'openstation_code_editor_after_save', $absolute_path, $content, $context );

	return array(
		'path'  => openstation_code_editor_path_to_relative( $absolute_path ),
		'mtime' => $new_mtime,
		'size'  => $new_size,
	);
}

/**
 * Returns an initialized WP_Filesystem global, or WP_Error.
 *
 * @return WP_Filesystem_Base|WP_Error
 */
function openstation_code_editor_get_filesystem() {
	global $wp_filesystem;

	if ( $wp_filesystem instanceof WP_Filesystem_Base ) {
		return $wp_filesystem;
	}

	if ( ! function_exists( 'WP_Filesystem' ) ) {
		require_once ABSPATH . 'wp-admin/includes/file.php';
	}

	add_filter( 'filesystem_method', 'openstation_code_editor_force_direct_filesystem', 999 );
	$ok = WP_Filesystem();
	remove_filter( 'filesystem_method', 'openstation_code_editor_force_direct_filesystem', 999 );

	if ( ! $ok || ! ( $wp_filesystem instanceof WP_Filesystem_Base ) ) {
		return new WP_Error(
			'openstation_code_editor_filesystem_unavailable',
			__( "This host doesn't allow direct file writes from the WordPress process. The code editor's save flow needs FTP/SSH credentials, which aren't supported yet.", 'desktop-mode-code-editor' ),
			array( 'status' => 503 )
		);
	}

	return $wp_filesystem;
}

/**
 * @internal Filter callback for {@see openstation_code_editor_get_filesystem()} — pin to direct.
 */
function openstation_code_editor_force_direct_filesystem() {
	return 'direct';
}

// ---------------------------------------------------------------------------
// Path translation
// ---------------------------------------------------------------------------

/**
 * Strip the workspace prefix from an absolute path.
 *
 * @param string $absolute_path
 * @return string
 */
function openstation_code_editor_path_to_relative( $absolute_path ) {
	$root = openstation_code_editor_workspace_root();
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
