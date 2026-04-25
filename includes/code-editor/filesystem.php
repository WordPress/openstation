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
			__( 'Code editor workspace root is not configured or could not be resolved.', 'wp-desktop-mode' ),
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
			__( 'Path contains control characters.', 'wp-desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$candidate = $root . DIRECTORY_SEPARATOR . str_replace( '/', DIRECTORY_SEPARATOR, $rel_path );
	$resolved  = realpath( $candidate );
	if ( false === $resolved ) {
		return new WP_Error(
			'wpdc_path_not_found',
			__( 'Path does not exist or is not accessible.', 'wp-desktop-mode' ),
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
			__( 'Path resolves outside the workspace root.', 'wp-desktop-mode' ),
			array( 'status' => 403 )
		);
	}

	if ( ! wpdc_extension_allowed( $resolved_norm ) ) {
		return new WP_Error(
			'wpdc_extension_denied',
			__( 'File extension is not allowed by the editor.', 'wp-desktop-mode' ),
			array( 'status' => 403 )
		);
	}

	return $resolved_norm;
}

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
