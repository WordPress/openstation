<?php

defined( 'ABSPATH' ) || exit;

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

function openstation_code_editor_file_edit_allowed() {
	return ! ( defined( 'DISALLOW_FILE_EDIT' ) && DISALLOW_FILE_EDIT );
}

function openstation_code_editor_user_can_use() {
	$can = openstation_code_editor_file_edit_allowed() && current_user_can( 'edit_plugins' );

	return (bool) apply_filters( 'openstation_code_editor_user_can_use', $can );
}

function openstation_code_editor_workspace_root() {
	$default = defined( 'WP_CONTENT_DIR' ) ? WP_CONTENT_DIR : '';

	$root = (string) apply_filters( 'openstation_code_editor_workspace_root', $default );

	$resolved = realpath( $root );
	return is_string( $resolved ) ? rtrim( $resolved, DIRECTORY_SEPARATOR ) : '';
}

function openstation_code_editor_extension_allowlist() {

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

	$filtered = apply_filters( 'openstation_code_editor_save_content', $content, $absolute_path, $context );
	if ( is_wp_error( $filtered ) ) {
		return $filtered;
	}
	if ( is_string( $filtered ) ) {
		$content = $filtered;
	}

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

		@opcache_invalidate( $absolute_path, true );
	}

	clearstatcache( true, $absolute_path );
	$new_mtime = (int) filemtime( $absolute_path );
	$new_size  = (int) filesize( $absolute_path );

	$context['mtime'] = $new_mtime;
	$context['bytes'] = $new_size;

	do_action( 'openstation_code_editor_after_save', $absolute_path, $content, $context );

	return array(
		'path'  => openstation_code_editor_path_to_relative( $absolute_path ),
		'mtime' => $new_mtime,
		'size'  => $new_size,
	);
}

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

function openstation_code_editor_force_direct_filesystem() {
	return 'direct';
}

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
