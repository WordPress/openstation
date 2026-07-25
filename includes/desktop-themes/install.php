<?php
/**
 * Desktop Mode — Desktop-theme ZIP installer.
 *
 * The pipeline, in order, with the staging directory cleaned up on
 * every exit path:
 *
 *   1. Walk the archive with `ZipArchive::statIndex()` and reject it
 *      wholesale on traversal, absolute paths, NUL bytes, forbidden
 *      extensions, or any cap breach. Nothing is written to disk
 *      until the whole archive has passed.
 *   2. Extract into `.staging-<uuid>/` inside the themes base dir.
 *   3. Sanitize the manifest (which resolves every asset reference
 *      against the staging dir — an entry pointing outside it, or at
 *      a file that isn't there, is dropped).
 *   4. Sanitize every referenced SVG in place.
 *   5. Delete + recreate the final theme dir. **Re-uploading a theme
 *      with the same id is an update**, not an error.
 *   6. Move ONLY the manifest-referenced assets across. Anything the
 *      manifest never mentions never reaches the live directory.
 *   7. Compile `theme.css`, write it, update the option index.
 *
 * @package WPDesktopMode
 * @since   0.9.7
 */

defined( 'ABSPATH' ) || exit;

/**
 * Recursively delete a directory tree.
 *
 * Guarded: refuses to act on anything that isn't inside the
 * desktop-themes base dir, so a bad caller can't turn this into an
 * arbitrary-delete primitive.
 *
 * @since 0.9.7
 * @internal
 *
 * @param string $dir Absolute path.
 * @return bool
 */
function desktop_mode_desktop_theme_rmdir( $dir ) {
	$dir  = (string) $dir;
	$base = realpath( desktop_mode_desktop_themes_dir() );
	$real = realpath( $dir );
	if ( false === $base || false === $real ) {
		return false;
	}
	if ( $real !== $base && 0 !== strpos( $real, $base . DIRECTORY_SEPARATOR ) ) {
		return false;
	}
	if ( $real === $base ) {
		// Never wipe the base itself.
		return false;
	}
	if ( ! is_dir( $real ) ) {
		return false;
	}

	$items = scandir( $real );
	if ( false === $items ) {
		return false;
	}
	foreach ( $items as $item ) {
		if ( '.' === $item || '..' === $item ) {
			continue;
		}
		$path = $real . '/' . $item;
		if ( is_dir( $path ) && ! is_link( $path ) ) {
			desktop_mode_desktop_theme_rmdir( $path );
		} else {
			wp_delete_file( $path );
		}
	}
	// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_rmdir
	return @rmdir( $real );
}

/**
 * Whether a ZIP entry name should be ignored rather than rejected.
 *
 * `__MACOSX/` resource forks and dotfiles ride along in almost every
 * archive a designer produces on a Mac. Failing the upload over them
 * would be hostile; we simply never extract them.
 *
 * @since 0.9.7
 * @internal
 *
 * @param string $name Entry name.
 * @return bool
 */
function desktop_mode_desktop_theme_zip_entry_ignored( $name ) {
	if ( 0 === strpos( $name, '__MACOSX/' ) ) {
		return true;
	}
	foreach ( explode( '/', $name ) as $segment ) {
		if ( '' === $segment ) {
			continue;
		}
		if ( '.' === $segment[0] ) {
			return true;
		}
	}
	return false;
}

/**
 * Validate an uploaded theme ZIP without writing anything.
 *
 * @since 0.9.7
 *
 * @param string $zip_path Absolute path of the uploaded archive.
 * @return string|WP_Error The manifest's entry name on success
 *                         (root-level or one directory deep),
 *                         `WP_Error` otherwise.
 */
function desktop_mode_desktop_theme_validate_zip( $zip_path ) {
	if ( ! class_exists( 'ZipArchive' ) ) {
		return new WP_Error(
			'desktop_mode_desktop_theme_no_zip_support',
			__( 'This server has no ZipArchive support, so theme uploads are unavailable.', 'desktop-mode' ),
			array( 'status' => 501 )
		);
	}

	$zip = new ZipArchive();
	if ( true !== $zip->open( (string) $zip_path ) ) {
		return new WP_Error(
			'desktop_mode_desktop_theme_bad_zip',
			__( 'That file could not be read as a ZIP archive.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$caps       = desktop_mode_desktop_theme_zip_caps();
	$extensions = array_flip( $caps['extensions'] );
	$total      = 0;
	$counted    = 0;
	$manifests  = array();

	for ( $i = 0; $i < $zip->numFiles; $i++ ) {
		$stat = $zip->statIndex( $i );
		if ( ! is_array( $stat ) || ! isset( $stat['name'] ) ) {
			$zip->close();
			return new WP_Error(
				'desktop_mode_desktop_theme_bad_zip',
				__( 'That archive contains an unreadable entry.', 'desktop-mode' ),
				array( 'status' => 400 )
			);
		}
		$name = (string) $stat['name'];

		// Hard rejects — these are attacks, not accidents.
		if ( false !== strpos( $name, "\0" ) || false !== strpos( $name, '\\' ) ) {
			$zip->close();
			return new WP_Error(
				'desktop_mode_desktop_theme_unsafe_entry',
				__( 'That archive contains an unsafe file path.', 'desktop-mode' ),
				array( 'status' => 400 )
			);
		}
		if ( '' !== $name && ( '/' === $name[0] || preg_match( '~^[a-zA-Z]:~', $name ) ) ) {
			$zip->close();
			return new WP_Error(
				'desktop_mode_desktop_theme_unsafe_entry',
				__( 'That archive contains an absolute file path.', 'desktop-mode' ),
				array( 'status' => 400 )
			);
		}
		foreach ( explode( '/', $name ) as $segment ) {
			if ( '..' === $segment ) {
				$zip->close();
				return new WP_Error(
					'desktop_mode_desktop_theme_unsafe_entry',
					__( 'That archive tries to write outside its own folder.', 'desktop-mode' ),
					array( 'status' => 400 )
				);
			}
		}

		if ( desktop_mode_desktop_theme_zip_entry_ignored( $name ) ) {
			continue;
		}
		// Directory entry.
		if ( '' === $name || '/' === substr( $name, -1 ) ) {
			continue;
		}

		++$counted;
		if ( $counted > $caps['max_entries'] ) {
			$zip->close();
			return new WP_Error(
				'desktop_mode_desktop_theme_too_many_entries',
				__( 'That theme archive contains too many files.', 'desktop-mode' ),
				array( 'status' => 400 )
			);
		}

		$size = isset( $stat['size'] ) ? (int) $stat['size'] : 0;
		if ( $size > $caps['max_file'] ) {
			$zip->close();
			return new WP_Error(
				'desktop_mode_desktop_theme_entry_too_large',
				sprintf(
					/* translators: %s: file name inside the archive. */
					__( '"%s" is larger than a theme asset is allowed to be.', 'desktop-mode' ),
					$name
				),
				array( 'status' => 400 )
			);
		}
		$total += $size;
		if ( $total > $caps['max_uncompressed'] ) {
			$zip->close();
			return new WP_Error(
				'desktop_mode_desktop_theme_archive_too_large',
				__( 'That theme archive unpacks to more data than is allowed.', 'desktop-mode' ),
				array( 'status' => 400 )
			);
		}

		$ext = strtolower( (string) pathinfo( $name, PATHINFO_EXTENSION ) );
		if ( ! isset( $extensions[ $ext ] ) ) {
			$zip->close();
			return new WP_Error(
				'desktop_mode_desktop_theme_bad_extension',
				sprintf(
					/* translators: %s: file name inside the archive. */
					__( '"%s" is not a file type a desktop theme may contain.', 'desktop-mode' ),
					$name
				),
				array( 'status' => 400 )
			);
		}

		// Manifest candidates: `theme.json` at the archive root, or
		// one directory deep (what "Compress this folder" produces).
		if ( 'theme.json' === basename( $name ) ) {
			$depth = substr_count( $name, '/' );
			if ( $depth <= 1 ) {
				$manifests[] = $name;
			}
		}
	}

	$zip->close();

	if ( 1 !== count( $manifests ) ) {
		return new WP_Error(
			'desktop_mode_desktop_theme_missing_manifest',
			__( 'A theme archive must contain exactly one theme.json, at its root or in a single top-level folder.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	return $manifests[0];
}

/**
 * Strip everything scriptable out of an SVG file, in place.
 *
 * Uses DOMDocument with the network disabled and DTD/entity
 * declarations rejected outright (billion-laughs / XXE). Removes
 * script-bearing and embedding elements, every `on*` handler, any
 * `href`/`xlink:href` that isn't a same-document fragment, and any
 * `style` attribute containing `url(` or `javascript:`.
 *
 * When DOMDocument isn't available we **reject** the file rather
 * than shipping unexamined SVG — the browser would happily run it.
 *
 * @since 0.9.7
 *
 * @param string $file Absolute path of the SVG.
 * @return true|WP_Error
 */
function desktop_mode_desktop_theme_sanitize_svg( $file ) {
	if ( ! class_exists( 'DOMDocument' ) ) {
		return new WP_Error(
			'desktop_mode_desktop_theme_no_dom',
			__( 'This server cannot sanitize SVG files, so SVG icons are not accepted here.', 'desktop-mode' ),
			array( 'status' => 501 )
		);
	}

	// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
	$markup = (string) file_get_contents( $file );
	if ( '' === trim( $markup ) ) {
		return new WP_Error(
			'desktop_mode_desktop_theme_bad_svg',
			__( 'An SVG in that theme is empty.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	// Refuse doctype / entity declarations before the parser ever
	// sees them — cheapest possible XXE and billion-laughs defence.
	if ( preg_match( '/<!DOCTYPE|<!ENTITY/i', $markup ) ) {
		return new WP_Error(
			'desktop_mode_desktop_theme_bad_svg',
			__( 'An SVG in that theme declares a DOCTYPE or entities, which is not allowed.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$previous = libxml_use_internal_errors( true );
	$doc      = new DOMDocument();
	$loaded   = $doc->loadXML( $markup, LIBXML_NONET | LIBXML_NOENT );
	libxml_clear_errors();
	libxml_use_internal_errors( $previous );

	if ( ! $loaded || ! $doc->documentElement || 'svg' !== strtolower( $doc->documentElement->localName ) ) {
		return new WP_Error(
			'desktop_mode_desktop_theme_bad_svg',
			__( 'An SVG in that theme could not be parsed.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$forbidden = array( 'script', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video', 'handler', 'set', 'animate' );

	$walk = static function ( DOMNode $node ) use ( &$walk, $forbidden ) {
		// Snapshot children first — we mutate while iterating.
		$children = array();
		foreach ( $node->childNodes as $child ) {
			$children[] = $child;
		}
		foreach ( $children as $child ) {
			if ( XML_PI_NODE === $child->nodeType ) {
				$node->removeChild( $child );
				continue;
			}
			if ( XML_ELEMENT_NODE !== $child->nodeType ) {
				continue;
			}
			/** @var DOMElement $child */
			$tag = strtolower( $child->localName );
			if ( in_array( $tag, $forbidden, true ) ) {
				$node->removeChild( $child );
				continue;
			}

			$attributes = array();
			foreach ( $child->attributes as $attribute ) {
				$attributes[] = $attribute;
			}
			foreach ( $attributes as $attribute ) {
				$name  = strtolower( $attribute->nodeName );
				$local = strtolower( $attribute->localName );
				$value = (string) $attribute->nodeValue;

				if ( 0 === strpos( $name, 'on' ) ) {
					$child->removeAttributeNode( $attribute );
					continue;
				}
				if ( 'href' === $local || 'xlink:href' === $name ) {
					// Only same-document fragment references survive:
					// no remote `<use>`, no `javascript:`, no data URI.
					if ( '' === $value || '#' !== $value[0] ) {
						$child->removeAttributeNode( $attribute );
					}
					continue;
				}
				if ( 'style' === $name && preg_match( '/url\s*\(|javascript\s*:|expression\s*\(/i', $value ) ) {
					$child->removeAttributeNode( $attribute );
					continue;
				}
				if ( preg_match( '/javascript\s*:/i', $value ) ) {
					$child->removeAttributeNode( $attribute );
				}
			}

			$walk( $child );
		}
	};
	$walk( $doc );

	$clean = $doc->saveXML();
	if ( ! is_string( $clean ) || '' === $clean ) {
		return new WP_Error(
			'desktop_mode_desktop_theme_bad_svg',
			__( 'An SVG in that theme could not be re-serialized after sanitization.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents
	file_put_contents( $file, $clean );

	return true;
}

/**
 * Install (or update) a desktop theme from an uploaded ZIP.
 *
 * @since 0.9.7
 *
 * @param string $zip_path Absolute path of the uploaded archive.
 * @return array|WP_Error The stored index entry on success.
 */
function desktop_mode_desktop_theme_install_from_zip( $zip_path ) {
	$manifest_entry = desktop_mode_desktop_theme_validate_zip( $zip_path );
	if ( is_wp_error( $manifest_entry ) ) {
		return $manifest_entry;
	}

	$base = desktop_mode_desktop_themes_ensure_dir();
	if ( is_wp_error( $base ) ) {
		return $base;
	}

	$staging = $base . '/.staging-' . wp_generate_uuid4();
	if ( ! wp_mkdir_p( $staging ) ) {
		return new WP_Error(
			'desktop_mode_desktop_theme_mkdir_failed',
			__( 'Could not create a staging directory for the upload.', 'desktop-mode' ),
			array( 'status' => 500 )
		);
	}

	require_once ABSPATH . 'wp-admin/includes/file.php';
	if ( ! WP_Filesystem() ) {
		desktop_mode_desktop_theme_rmdir( $staging );
		return new WP_Error(
			'desktop_mode_desktop_theme_filesystem_unavailable',
			__( 'WordPress could not access the filesystem to unpack the theme.', 'desktop-mode' ),
			array( 'status' => 500 )
		);
	}
	// Populated by `WP_Filesystem()` above. Used to move the manifest's
	// assets into the live directory — the same transport `unzip_file()`
	// just used to write them, so the two agree on non-direct setups.
	global $wp_filesystem;

	$unzipped = unzip_file( $zip_path, $staging );
	if ( is_wp_error( $unzipped ) ) {
		desktop_mode_desktop_theme_rmdir( $staging );
		// Surfaced verbatim: on FTP-credentialed filesystems this is
		// the only signal that says WHY, and the generic message we
		// could substitute would be strictly less useful.
		return $unzipped;
	}

	// Re-root when the archive wrapped everything in one folder.
	$root = $staging;
	if ( false !== strpos( $manifest_entry, '/' ) ) {
		$root = $staging . '/' . dirname( $manifest_entry );
	}
	$manifest_file = $root . '/theme.json';
	if ( ! is_file( $manifest_file ) ) {
		desktop_mode_desktop_theme_rmdir( $staging );
		return new WP_Error(
			'desktop_mode_desktop_theme_missing_manifest',
			__( 'The archive unpacked without a theme.json.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
	$decoded = json_decode( (string) file_get_contents( $manifest_file ), true );
	if ( null === $decoded ) {
		desktop_mode_desktop_theme_rmdir( $staging );
		return new WP_Error(
			'desktop_mode_desktop_theme_bad_json',
			__( 'theme.json is not valid JSON.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$manifest = desktop_mode_sanitize_desktop_theme_manifest(
		$decoded,
		desktop_mode_desktop_theme_staging_asset_resolver( $root )
	);
	if ( is_wp_error( $manifest ) ) {
		desktop_mode_desktop_theme_rmdir( $staging );
		return $manifest;
	}

	$slug = (string) $manifest['slug'];

	// Every asset the sanitized manifest actually references. Nothing
	// else crosses into the live directory.
	$assets = array();
	if ( '' !== $manifest['preview'] ) {
		$assets[ $manifest['preview'] ] = true;
	}
	foreach ( $manifest['icons'] as $icon ) {
		if ( 'image' === $icon['type'] ) {
			$assets[ $icon['path'] ] = true;
		}
	}
	foreach ( $manifest['textures'] as $texture ) {
		$assets[ $texture['path'] ] = true;
	}
	foreach ( $manifest['fonts'] as $face ) {
		foreach ( $face['src'] as $source ) {
			$assets[ $source['path'] ] = true;
		}
	}

	// Sanitize SVGs while they're still in staging. A failure here
	// aborts the whole install — a theme that ships an SVG we can't
	// make safe doesn't get to install with that icon quietly dropped.
	foreach ( array_keys( $assets ) as $relative ) {
		if ( 'svg' !== strtolower( (string) pathinfo( $relative, PATHINFO_EXTENSION ) ) ) {
			continue;
		}
		$sanitized = desktop_mode_desktop_theme_sanitize_svg( $root . '/' . $relative );
		if ( is_wp_error( $sanitized ) ) {
			desktop_mode_desktop_theme_rmdir( $staging );
			return $sanitized;
		}
	}

	// Re-upload of the same id is an UPDATE: drop the old directory
	// wholesale so removed assets don't linger.
	$target = desktop_mode_desktop_themes_dir( $slug );
	if ( is_dir( $target ) ) {
		desktop_mode_desktop_theme_rmdir( $target );
	}
	if ( ! wp_mkdir_p( $target ) ) {
		desktop_mode_desktop_theme_rmdir( $staging );
		return new WP_Error(
			'desktop_mode_desktop_theme_mkdir_failed',
			__( 'Could not create the theme directory.', 'desktop-mode' ),
			array( 'status' => 500 )
		);
	}

	foreach ( array_keys( $assets ) as $relative ) {
		$destination = $target . '/' . $relative;
		$dir         = dirname( $destination );
		if ( ! wp_mkdir_p( $dir ) ) {
			desktop_mode_desktop_theme_rmdir( $staging );
			desktop_mode_desktop_theme_rmdir( $target );
			return new WP_Error(
				'desktop_mode_desktop_theme_mkdir_failed',
				__( 'Could not create a theme asset directory.', 'desktop-mode' ),
				array( 'status' => 500 )
			);
		}
		// `WP_Filesystem::move()` rather than `rename()`: it is the
		// documented API, it works on the non-direct transports the
		// extract above already went through, and its Direct
		// implementation falls back to copy-then-delete when a plain
		// rename fails (staging and uploads landing on different
		// devices is the common case). `true` overwrites — the target
		// directory was just recreated, so nothing should be there,
		// and a stale file must not silently abort the install.
		if ( ! $wp_filesystem->move( $root . '/' . $relative, $destination, true ) ) {
			desktop_mode_desktop_theme_rmdir( $staging );
			desktop_mode_desktop_theme_rmdir( $target );
			return new WP_Error(
				'desktop_mode_desktop_theme_write_failed',
				__( 'Could not move a theme asset into place.', 'desktop-mode' ),
				array( 'status' => 500 )
			);
		}
	}

	// Keep the author's manifest next to the compiled CSS. It is
	// never read back at runtime — the sanitized copy in the option
	// is what the shell sees — but it makes the installed directory
	// self-describing for anyone debugging a theme.
	// Same reasoning as the move above — the documented API rather than
	// a raw `copy()`. Failure is deliberately not fatal: this file is
	// a debugging convenience, never read back at runtime.
	$wp_filesystem->copy( $manifest_file, $target . '/theme.json', true );

	// One timestamp for the compile AND the index entry: it is the
	// cache-buster stamped onto every asset URL the stylesheet
	// references, so the two must agree or a re-upload's textures go
	// stale while its CSS refreshes.
	$installed_at = time();

	$css = desktop_mode_desktop_theme_compile_css(
		$manifest,
		$slug,
		desktop_mode_desktop_themes_url( $slug ),
		(string) $installed_at
	);
	// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents
	if ( false === file_put_contents( $target . '/theme.css', $css ) ) {
		desktop_mode_desktop_theme_rmdir( $staging );
		desktop_mode_desktop_theme_rmdir( $target );
		return new WP_Error(
			'desktop_mode_desktop_theme_write_failed',
			__( 'Could not write the compiled theme stylesheet.', 'desktop-mode' ),
			array( 'status' => 500 )
		);
	}

	desktop_mode_desktop_theme_rmdir( $staging );

	$entry = array(
		'slug'        => $slug,
		'manifest'    => $manifest,
		'installedAt' => $installed_at,
		'installedBy' => get_current_user_id(),
	);

	$index          = desktop_mode_desktop_themes_index();
	$index[ $slug ] = $entry;
	desktop_mode_desktop_themes_put_index( $index );

	/**
	 * Fires after a desktop theme has been installed or updated.
	 *
	 * @since 0.9.7
	 *
	 * @param string $slug  Theme slug.
	 * @param array  $entry Stored index entry (`slug`, `manifest`,
	 *                      `installedAt`, `installedBy`).
	 */
	do_action( 'desktop_mode_desktop_theme_installed', $slug, $entry );

	return $entry;
}

/**
 * Delete an installed desktop theme (directory + index entry).
 *
 * Users whose selection pointed at the deleted theme degrade
 * silently to the system default — the enqueue path checks the
 * index on every request, so no user meta needs rewriting.
 *
 * @since 0.9.7
 *
 * @param string $slug Theme slug.
 * @return true|WP_Error
 */
function desktop_mode_desktop_theme_delete( $slug ) {
	$slug  = sanitize_key( (string) $slug );
	$index = desktop_mode_desktop_themes_index();
	if ( '' === $slug || ! isset( $index[ $slug ] ) ) {
		return new WP_Error(
			'desktop_mode_desktop_theme_not_found',
			__( 'That desktop theme is not installed.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}

	$entry = $index[ $slug ];
	$dir   = desktop_mode_desktop_themes_dir( $slug );
	if ( is_dir( $dir ) ) {
		desktop_mode_desktop_theme_rmdir( $dir );
	}
	unset( $index[ $slug ] );
	desktop_mode_desktop_themes_put_index( $index );

	/**
	 * Fires after a desktop theme has been deleted.
	 *
	 * @since 0.9.7
	 *
	 * @param string $slug  Theme slug.
	 * @param array  $entry The index entry as it was before removal.
	 */
	do_action( 'desktop_mode_desktop_theme_deleted', $slug, $entry );

	return true;
}
