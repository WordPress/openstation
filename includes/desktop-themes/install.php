<?php

defined( 'ABSPATH' ) || exit;

function openstation_desktop_theme_rmdir( $dir ) {
	$dir  = (string) $dir;
	$base = realpath( openstation_desktop_themes_dir() );
	$real = realpath( $dir );
	if ( false === $base || false === $real ) {
		return false;
	}
	if ( $real !== $base && 0 !== strpos( $real, $base . DIRECTORY_SEPARATOR ) ) {
		return false;
	}
	if ( $real === $base ) {

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
			openstation_desktop_theme_rmdir( $path );
		} else {
			wp_delete_file( $path );
		}
	}

	return @rmdir( $real );
}

function openstation_desktop_theme_zip_entry_ignored( $name ) {
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

function openstation_desktop_theme_validate_zip( $zip_path ) {
	if ( ! class_exists( 'ZipArchive' ) ) {
		return new WP_Error(
			'openstation_desktop_theme_no_zip_support',
			__( 'This server has no ZipArchive support, so theme uploads are unavailable.', 'desktop-mode' ),
			array( 'status' => 501 )
		);
	}

	$zip = new ZipArchive();
	if ( true !== $zip->open( (string) $zip_path ) ) {
		return new WP_Error(
			'openstation_desktop_theme_bad_zip',
			__( 'That file could not be read as a ZIP archive.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$caps       = openstation_desktop_theme_zip_caps();
	$extensions = array_flip( $caps['extensions'] );
	$total      = 0;
	$counted    = 0;
	$manifests  = array();

	for ( $i = 0; $i < $zip->numFiles; $i++ ) {
		$stat = $zip->statIndex( $i );
		if ( ! is_array( $stat ) || ! isset( $stat['name'] ) ) {
			$zip->close();
			return new WP_Error(
				'openstation_desktop_theme_bad_zip',
				__( 'That archive contains an unreadable entry.', 'desktop-mode' ),
				array( 'status' => 400 )
			);
		}
		$name = (string) $stat['name'];

		if ( false !== strpos( $name, "\0" ) || false !== strpos( $name, '\\' ) ) {
			$zip->close();
			return new WP_Error(
				'openstation_desktop_theme_unsafe_entry',
				__( 'That archive contains an unsafe file path.', 'desktop-mode' ),
				array( 'status' => 400 )
			);
		}
		if ( '' !== $name && ( '/' === $name[0] || preg_match( '~^[a-zA-Z]:~', $name ) ) ) {
			$zip->close();
			return new WP_Error(
				'openstation_desktop_theme_unsafe_entry',
				__( 'That archive contains an absolute file path.', 'desktop-mode' ),
				array( 'status' => 400 )
			);
		}
		foreach ( explode( '/', $name ) as $segment ) {
			if ( '..' === $segment ) {
				$zip->close();
				return new WP_Error(
					'openstation_desktop_theme_unsafe_entry',
					__( 'That archive tries to write outside its own folder.', 'desktop-mode' ),
					array( 'status' => 400 )
				);
			}
		}

		if ( openstation_desktop_theme_zip_entry_ignored( $name ) ) {
			continue;
		}

		if ( '' === $name || '/' === substr( $name, -1 ) ) {
			continue;
		}

		++$counted;
		if ( $counted > $caps['max_entries'] ) {
			$zip->close();
			return new WP_Error(
				'openstation_desktop_theme_too_many_entries',
				__( 'That theme archive contains too many files.', 'desktop-mode' ),
				array( 'status' => 400 )
			);
		}

		$size = isset( $stat['size'] ) ? (int) $stat['size'] : 0;
		if ( $size > $caps['max_file'] ) {
			$zip->close();
			return new WP_Error(
				'openstation_desktop_theme_entry_too_large',
				sprintf(

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
				'openstation_desktop_theme_archive_too_large',
				__( 'That theme archive unpacks to more data than is allowed.', 'desktop-mode' ),
				array( 'status' => 400 )
			);
		}

		$ext = strtolower( (string) pathinfo( $name, PATHINFO_EXTENSION ) );
		if ( ! isset( $extensions[ $ext ] ) ) {
			$zip->close();
			return new WP_Error(
				'openstation_desktop_theme_bad_extension',
				sprintf(

					__( '"%s" is not a file type a desktop theme may contain.', 'desktop-mode' ),
					$name
				),
				array( 'status' => 400 )
			);
		}

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
			'openstation_desktop_theme_missing_manifest',
			__( 'A theme archive must contain exactly one theme.json, at its root or in a single top-level folder.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	return $manifests[0];
}

function openstation_desktop_theme_sanitize_svg( $file ) {
	if ( ! class_exists( 'DOMDocument' ) ) {
		return new WP_Error(
			'openstation_desktop_theme_no_dom',
			__( 'This server cannot sanitize SVG files, so SVG icons are not accepted here.', 'desktop-mode' ),
			array( 'status' => 501 )
		);
	}

	$markup = (string) file_get_contents( $file );
	if ( '' === trim( $markup ) ) {
		return new WP_Error(
			'openstation_desktop_theme_bad_svg',
			__( 'An SVG in that theme is empty.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	if ( preg_match( '/<!DOCTYPE|<!ENTITY/i', $markup ) ) {
		return new WP_Error(
			'openstation_desktop_theme_bad_svg',
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
			'openstation_desktop_theme_bad_svg',
			__( 'An SVG in that theme could not be parsed.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$forbidden = array( 'script', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video', 'handler', 'set', 'animate' );

	$walk = static function ( DOMNode $node ) use ( &$walk, $forbidden ) {

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
			'openstation_desktop_theme_bad_svg',
			__( 'An SVG in that theme could not be re-serialized after sanitization.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	file_put_contents( $file, $clean );

	return true;
}

function openstation_desktop_theme_sweep_staging( $max_age = DAY_IN_SECONDS ) {
	$base = openstation_desktop_themes_dir();
	if ( ! is_dir( $base ) ) {
		return 0;
	}
	$max_age = max( 60, (int) $max_age );
	$now     = time();
	$removed = 0;

	foreach ( (array) glob( $base . '/.staging-*', GLOB_ONLYDIR ) as $dir ) {
		$mtime = @filemtime( $dir );
		if ( false === $mtime || ( $now - $mtime ) < $max_age ) {
			continue;
		}

		if ( openstation_desktop_theme_rmdir( $dir ) ) {
			++$removed;
		}
	}

	return $removed;
}

function openstation_desktop_theme_install_from_zip( $zip_path ) {

	openstation_desktop_theme_sweep_staging();

	$manifest_entry = openstation_desktop_theme_validate_zip( $zip_path );
	if ( is_wp_error( $manifest_entry ) ) {
		return $manifest_entry;
	}

	$base = openstation_desktop_themes_ensure_dir();
	if ( is_wp_error( $base ) ) {
		return $base;
	}

	$staging = $base . '/.staging-' . wp_generate_uuid4();
	if ( ! wp_mkdir_p( $staging ) ) {
		return new WP_Error(
			'openstation_desktop_theme_mkdir_failed',
			__( 'Could not create a staging directory for the upload.', 'desktop-mode' ),
			array( 'status' => 500 )
		);
	}

	require_once ABSPATH . 'wp-admin/includes/file.php';
	if ( ! WP_Filesystem() ) {
		openstation_desktop_theme_rmdir( $staging );
		return new WP_Error(
			'openstation_desktop_theme_filesystem_unavailable',
			__( 'WordPress could not access the filesystem to unpack the theme.', 'desktop-mode' ),
			array( 'status' => 500 )
		);
	}

	global $wp_filesystem;

	$unzipped = unzip_file( $zip_path, $staging );
	if ( is_wp_error( $unzipped ) ) {
		openstation_desktop_theme_rmdir( $staging );

		return $unzipped;
	}

	$root = $staging;
	if ( false !== strpos( $manifest_entry, '/' ) ) {
		$root = $staging . '/' . dirname( $manifest_entry );
	}
	$manifest_file = $root . '/theme.json';
	if ( ! is_file( $manifest_file ) ) {
		openstation_desktop_theme_rmdir( $staging );
		return new WP_Error(
			'openstation_desktop_theme_missing_manifest',
			__( 'The archive unpacked without a theme.json.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$decoded = json_decode( (string) file_get_contents( $manifest_file ), true );
	if ( null === $decoded ) {
		openstation_desktop_theme_rmdir( $staging );
		return new WP_Error(
			'openstation_desktop_theme_bad_json',
			__( 'theme.json is not valid JSON.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$manifest = openstation_sanitize_desktop_theme_manifest(
		$decoded,
		openstation_desktop_theme_staging_asset_resolver( $root )
	);
	if ( is_wp_error( $manifest ) ) {
		openstation_desktop_theme_rmdir( $staging );
		return $manifest;
	}

	$slug = (string) $manifest['slug'];

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
	foreach ( $manifest['wallpapers'] as $wallpaper ) {
		if ( ! empty( $wallpaper['path'] ) ) {
			$assets[ $wallpaper['path'] ] = true;
		}
	}

	foreach ( array_keys( $assets ) as $relative ) {
		if ( 'svg' !== strtolower( (string) pathinfo( $relative, PATHINFO_EXTENSION ) ) ) {
			continue;
		}
		$sanitized = openstation_desktop_theme_sanitize_svg( $root . '/' . $relative );
		if ( is_wp_error( $sanitized ) ) {
			openstation_desktop_theme_rmdir( $staging );
			return $sanitized;
		}
	}

	$target = openstation_desktop_themes_dir( $slug );
	if ( is_dir( $target ) ) {
		openstation_desktop_theme_rmdir( $target );
	}
	if ( ! wp_mkdir_p( $target ) ) {
		openstation_desktop_theme_rmdir( $staging );
		return new WP_Error(
			'openstation_desktop_theme_mkdir_failed',
			__( 'Could not create the theme directory.', 'desktop-mode' ),
			array( 'status' => 500 )
		);
	}

	foreach ( array_keys( $assets ) as $relative ) {
		$destination = $target . '/' . $relative;
		$dir         = dirname( $destination );
		if ( ! wp_mkdir_p( $dir ) ) {
			openstation_desktop_theme_rmdir( $staging );
			openstation_desktop_theme_rmdir( $target );
			return new WP_Error(
				'openstation_desktop_theme_mkdir_failed',
				__( 'Could not create a theme asset directory.', 'desktop-mode' ),
				array( 'status' => 500 )
			);
		}

		if ( ! $wp_filesystem->move( $root . '/' . $relative, $destination, true ) ) {
			openstation_desktop_theme_rmdir( $staging );
			openstation_desktop_theme_rmdir( $target );
			return new WP_Error(
				'openstation_desktop_theme_write_failed',
				__( 'Could not move a theme asset into place.', 'desktop-mode' ),
				array( 'status' => 500 )
			);
		}
	}

	$wp_filesystem->copy( $manifest_file, $target . '/theme.json', true );

	$installed_at = time();

	$css = openstation_desktop_theme_compile_css(
		$manifest,
		$slug,
		openstation_desktop_themes_url( $slug ),
		(string) $installed_at
	);

	if ( false === file_put_contents( $target . '/theme.css', $css ) ) {
		openstation_desktop_theme_rmdir( $staging );
		openstation_desktop_theme_rmdir( $target );
		return new WP_Error(
			'openstation_desktop_theme_write_failed',
			__( 'Could not write the compiled theme stylesheet.', 'desktop-mode' ),
			array( 'status' => 500 )
		);
	}

	openstation_desktop_theme_rmdir( $staging );

	$entry = array(
		'slug'        => $slug,
		'manifest'    => $manifest,
		'installedAt' => $installed_at,
		'installedBy' => get_current_user_id(),
	);

	$index          = openstation_desktop_themes_index();
	$index[ $slug ] = $entry;
	openstation_desktop_themes_put_index( $index );

	do_action( 'openstation_desktop_theme_installed', $slug, $entry );

	return $entry;
}

function openstation_desktop_theme_delete( $slug ) {
	$slug  = sanitize_key( (string) $slug );
	$index = openstation_desktop_themes_index();
	if ( '' === $slug || ! isset( $index[ $slug ] ) ) {
		return new WP_Error(
			'openstation_desktop_theme_not_found',
			__( 'That desktop theme is not installed.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}

	$entry = $index[ $slug ];
	$dir   = openstation_desktop_themes_dir( $slug );
	if ( is_dir( $dir ) ) {
		openstation_desktop_theme_rmdir( $dir );
	}
	unset( $index[ $slug ] );
	openstation_desktop_themes_put_index( $index );

	do_action( 'openstation_desktop_theme_deleted', $slug, $entry );

	return true;
}
