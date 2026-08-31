<?php
/**
 * OpenStation — Agents: faces on disk.
 *
 * An agent's face is a Mio look in user meta. This turns that look into
 * a file, because the thing that has to consume it is `get_avatar()`,
 * and `get_avatar()` wants a URL.
 *
 * **Why a file rather than a REST route.** Both would satisfy the
 * "must be a real URL" constraint that `openstation_agent_avatar_url()`
 * documents. A file wins on the read path: a busy post rendering forty
 * comment avatars costs zero PHP, the web server serves static bytes,
 * and the content hash in the filename gives cache-busting for free. A
 * route would run the whole renderer per avatar per request.
 *
 * So the write is the interesting half, and it happens on save:
 * `openstation_agent_created` and `openstation_agent_updated`. The read
 * is pure and never writes: a write inside `pre_get_avatar_data` would
 * be a write during a front-end GET.
 *
 * **The files are SVG in uploads, which is only safe because of what
 * the renderers refuse to emit.** Mio portraits use a fixed vocabulary
 * of numeric shapes. Custom profile pictures accept raster Media
 * Library attachments only, re-encode or base64-wrap their bytes, and
 * place that inert data URI behind a fixed AGENT ribbon. No source URL,
 * filename, alt text, SVG markup, or other caller string is copied into
 * the generated document. The directory is hardened exec-off rather
 * than deny-all, because unlike a theme's PHP these files have to stay
 * servable.
 *
 * **The .htaccess is the second line, not the first.** It is Apache
 * only: the `php_flag` and `<FilesMatch>` rules do nothing on nginx,
 * the same limitation WordPress's own `uploads/.htaccess` carries. So
 * what actually makes this directory safe is that the renderer cannot
 * be made to emit anything but inert SVG. Worth knowing before putting
 * a different kind of file in here: a new file type does not inherit
 * that guarantee, and the .htaccess alone will not cover it.
 *
 * **Known limitation, multisite.** `wp_users` and `wp_usermeta` are
 * network-wide but `wp_get_upload_dir()` is per-site, so an agent
 * created on site A has no face file on site B and degrades to the
 * shipped robot there. That is a graceful fallback rather than a
 * breakage, and fixing it properly means deciding whether faces belong
 * to the network.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Size the stored portrait is rendered at.
 *
 * The SVG scales, so this only sets the intrinsic size an `img` with no
 * dimensions falls back to. 96 matches what `get_avatar()` asks for.
 */
const OPENSTATION_AGENT_FACE_SIZE = 96;

/** Square raster size embedded behind a custom profile-picture ribbon. */
const OPENSTATION_AGENT_PROFILE_PICTURE_RASTER_SIZE = 256;

/** Largest original image embedded when WordPress cannot resize it. */
const OPENSTATION_AGENT_PROFILE_PICTURE_SOURCE_MAX_BYTES = 5242880;

/**
 * Absolute path to the face directory.
 *
 * The directory name keeps the frozen `desktop-mode-` prefix its
 * siblings use: it is a path on live filesystems the moment it ships.
 *
 * @return string Absolute path, no trailing slash.
 */
function openstation_agent_faces_dir() {
	$uploads = wp_get_upload_dir();
	$base    = trailingslashit( $uploads['basedir'] ) . 'desktop-mode-agent-faces';
	/**
	 * Filters the agent-face storage directory.
	 *
	 * Whatever this points at must be web-servable: the portraits are
	 * loaded by the browser as avatars.
	 *
	 * @param string $base Absolute path, no trailing slash.
	 */
	return (string) apply_filters( 'openstation_agent_faces_base_dir', $base );
}

/**
 * Base URL of the face directory.
 *
 * @return string Absolute URL, no trailing slash.
 */
function openstation_agent_faces_url() {
	$uploads = wp_get_upload_dir();
	$url     = untrailingslashit( $uploads['baseurl'] ) . '/desktop-mode-agent-faces';
	/**
	 * Filters the agent-face base URL. Must resolve to the same bytes
	 * `openstation_agent_faces_base_dir` points at.
	 *
	 * @param string $url Absolute URL, no trailing slash.
	 */
	return (string) apply_filters( 'openstation_agent_faces_base_url', $url );
}

/**
 * Create the face directory and harden it.
 *
 * Exec-off, not deny-all: the portraits must stay servable.
 *
 * @return string|WP_Error Absolute path, or an error.
 */
function openstation_agent_faces_ensure_dir() {
	$base = openstation_agent_faces_dir();
	if ( ! wp_mkdir_p( $base ) ) {
		return new WP_Error(
			'openstation_agent_faces_mkdir_failed',
			__( 'Could not create the agent-faces directory.', 'desktop-mode' ),
			array( 'status' => 500 )
		);
	}

	$index = $base . '/index.php';
	if ( ! file_exists( $index ) ) {
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents
		file_put_contents( $index, "<?php // Silence is golden.\n" );
	}

	$htaccess = $base . '/.htaccess';
	if ( ! file_exists( $htaccess ) ) {
		$rules = "Options -Indexes\n"
			. "<IfModule mod_php.c>\n\tphp_flag engine off\n</IfModule>\n"
			. "<IfModule mod_php7.c>\n\tphp_flag engine off\n</IfModule>\n"
			. "<FilesMatch \"\\.(?i:php|phtml|phar|php3|php4|php5|php7|php8|pht|phps|cgi|pl|asp|aspx|jsp|shtml|htaccess)$\">\n"
			. "\t<IfModule mod_authz_core.c>\n\t\tRequire all denied\n\t</IfModule>\n"
			. "\t<IfModule !mod_authz_core.c>\n\t\tOrder deny,allow\n\t\tDeny from all\n\t</IfModule>\n"
			. "</FilesMatch>\n";
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents
		file_put_contents( $htaccess, $rules );
	}

	return $base;
}

/**
 * The filename an agent's current face would have.
 *
 * The hash is of the stored look, so a shuffled face lands on a new
 * filename and every cache that held the old one is bypassed without a
 * query string.
 *
 * @param int $user_id Agent user id.
 * @return string Filename, or '' when the agent has no face.
 */
function openstation_agent_face_filename( $user_id ) {
	$user_id       = (int) $user_id;
	$raw           = (string) get_user_meta( $user_id, OPENSTATION_AGENT_FACE_META, true );
	$attachment_id = openstation_agent_get_avatar_attachment_id( $user_id );
	if ( '' === $raw && 0 === $attachment_id ) {
		return '';
	}
	$fingerprint = $raw;
	if ( $attachment_id > 0 ) {
		$fingerprint .= '|avatar:' . $attachment_id . ':'
			. (int) get_post_modified_time( 'U', true, $attachment_id );
	}
	return $user_id . '-' . substr( md5( $fingerprint ), 0, 8 ) . '.svg';
}

/**
 * URL of an agent's face file, if it has been written.
 *
 * Pure: never writes, never renders. A missing file returns '' and the
 * caller falls back to the shipped robot, which is also what happens on
 * hosts that refuse to serve SVG from uploads.
 *
 * @param int $user_id Agent user id.
 * @return string URL, or '' when there is no face on disk.
 */
function openstation_agent_face_url( $user_id ) {
	$file = openstation_agent_face_filename( $user_id );
	if ( '' === $file ) {
		return '';
	}
	if ( ! file_exists( openstation_agent_faces_dir() . '/' . $file ) ) {
		return '';
	}
	return openstation_agent_faces_url() . '/' . $file;
}

/**
 * Render an agent's face and write it to disk.
 *
 * Idempotent: a face whose file already exists is left alone. Stale
 * files for the same agent are removed, so an admin shuffling a face
 * ten times leaves one file behind rather than ten.
 *
 * @param int $user_id Agent user id.
 * @return string|WP_Error Absolute path written (or already present),
 *                         '' when the agent has no face, or an error.
 */
function openstation_agent_face_write( $user_id ) {
	$user_id = (int) $user_id;
	$file    = openstation_agent_face_filename( $user_id );
	if ( '' === $file ) {
		openstation_agent_face_delete( $user_id );
		return '';
	}

	$base = openstation_agent_faces_ensure_dir();
	if ( is_wp_error( $base ) ) {
		return $base;
	}

	$path = $base . '/' . $file;
	if ( file_exists( $path ) ) {
		return $path;
	}

	$attachment_id = openstation_agent_get_avatar_attachment_id( $user_id );
	if ( $attachment_id > 0 ) {
		$svg = openstation_agent_profile_picture_svg(
			$attachment_id,
			OPENSTATION_AGENT_FACE_SIZE,
			$base,
			$user_id
		);
		if ( is_wp_error( $svg ) ) {
			return $svg;
		}
	} else {
		$look = openstation_mio_clamp_look( openstation_agent_get_face( $user_id ) );
		$svg  = openstation_mio_portrait_svg( $look, OPENSTATION_AGENT_FACE_SIZE );
	}

	// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents
	$written = file_put_contents( $path, $svg );
	if ( false === $written ) {
		return new WP_Error(
			'openstation_agent_face_write_failed',
			__( 'Could not write the agent face.', 'desktop-mode' ),
			array( 'status' => 500 )
		);
	}

	openstation_agent_face_delete( $user_id, $file );
	return $path;
}

/**
 * Read a custom profile picture into an inert raster data URI.
 *
 * WordPress's image editor is preferred: it crops the source to a
 * small square and strips format-specific payloads before those bytes
 * enter the avatar SVG. Hosts without an available editor may still
 * use a reasonably sized, allowlisted raster file directly.
 *
 * @param int    $attachment_id Image attachment id.
 * @param string $base          Writable agent-face directory.
 * @param int    $user_id       Agent user id, used in the temp name.
 * @return string|WP_Error Raster data URI, or an error.
 */
function openstation_agent_profile_picture_data_uri( $attachment_id, $base, $user_id ) {
	$attachment_id = openstation_agent_sanitize_avatar_attachment_id( $attachment_id );
	$source        = $attachment_id > 0 ? get_attached_file( $attachment_id ) : false;
	$mime          = $attachment_id > 0 ? (string) get_post_mime_type( $attachment_id ) : '';
	if ( ! is_string( $source ) || '' === $source || ! is_readable( $source ) ) {
		return new WP_Error(
			'openstation_agent_profile_picture_missing',
			__( 'The selected agent profile picture is unavailable.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$editor = wp_get_image_editor( $source );
	if ( ! is_wp_error( $editor ) ) {
		$resized = $editor->resize(
			OPENSTATION_AGENT_PROFILE_PICTURE_RASTER_SIZE,
			OPENSTATION_AGENT_PROFILE_PICTURE_RASTER_SIZE,
			true
		);
		if ( ! is_wp_error( $resized ) ) {
			$temp  = trailingslashit( $base ) . wp_unique_filename(
				$base,
				'.' . (int) $user_id . '-profile-picture.png'
			);
			$saved = $editor->save( $temp, 'image/png' );
			if ( ! is_wp_error( $saved ) && isset( $saved['path'], $saved['mime'] ) ) {
				// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- Reading the raster this function just rendered.
				$bytes = file_get_contents( $saved['path'] );
				wp_delete_file( $saved['path'] );
				if ( false !== $bytes ) {
					return 'data:' . (string) $saved['mime'] . ';base64,' . base64_encode( $bytes );
				}
			}
		}
	}

	$size = filesize( $source );
	if ( false === $size || $size > OPENSTATION_AGENT_PROFILE_PICTURE_SOURCE_MAX_BYTES ) {
		return new WP_Error(
			'openstation_agent_profile_picture_too_large',
			__( 'The selected agent profile picture could not be resized.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- Reading an allowlisted local raster attachment.
	$bytes = file_get_contents( $source );
	if ( false === $bytes ) {
		return new WP_Error(
			'openstation_agent_profile_picture_unreadable',
			__( 'The selected agent profile picture could not be read.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	return 'data:' . $mime . ';base64,' . base64_encode( $bytes );
}

/**
 * Compose a profile picture and the permanent AGENT identity ribbon.
 *
 * The ribbon is in the served image rather than CSS so it survives
 * every `get_avatar()` consumer: WP Admin lists, comments, desktop
 * user tiles, chat, and plugin surfaces all receive the same identity.
 *
 * @param int    $attachment_id Image attachment id.
 * @param int    $size          Intrinsic SVG size.
 * @param string $base          Writable agent-face directory.
 * @param int    $user_id       Agent user id.
 * @return string|WP_Error SVG document, or an error.
 */
function openstation_agent_profile_picture_svg( $attachment_id, $size, $base, $user_id ) {
	$data = openstation_agent_profile_picture_data_uri( $attachment_id, $base, $user_id );
	if ( is_wp_error( $data ) ) {
		return $data;
	}
	$size = max( 24, min( 1024, (int) $size ) );
	return '<svg xmlns="http://www.w3.org/2000/svg" width="' . $size . '" height="' . $size . '" viewBox="0 0 96 96">'
		. '<defs><clipPath id="avatar-clip"><circle cx="48" cy="48" r="46"/></clipPath></defs>'
		. '<circle cx="48" cy="48" r="48" fill="#f0f0f1"/>'
		. '<image href="' . $data . '" x="2" y="2" width="92" height="92" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatar-clip)"/>'
		. '<circle cx="48" cy="48" r="46" fill="none" stroke="#ffffff" stroke-opacity=".55" stroke-width="2"/>'
		. '<g clip-path="url(#avatar-clip)"><g transform="rotate(45 72 18)">'
		. '<rect x="34" y="8" width="76" height="18" fill="#f252fc"/>'
		. '<text x="72" y="21" fill="#050505" font-family="Arial,sans-serif" font-size="9" font-weight="700" letter-spacing="1" text-anchor="middle">AGENT</text>'
		. '</g></g></svg>';
}

/**
 * Remove an agent's face files.
 *
 * @param int    $user_id Agent user id.
 * @param string $keep    Filename to leave in place, if any.
 * @return void
 */
function openstation_agent_face_delete( $user_id, $keep = '' ) {
	$base = openstation_agent_faces_dir();
	if ( ! is_dir( $base ) ) {
		return;
	}
	$found = glob( $base . '/' . (int) $user_id . '-*.svg' );
	if ( ! is_array( $found ) ) {
		return;
	}
	foreach ( $found as $path ) {
		if ( '' !== $keep && basename( $path ) === $keep ) {
			continue;
		}
		wp_delete_file( $path );
	}
}

/**
 * Keep the file in step with the meta.
 *
 * @param int   $user_id Agent user id.
 * @param array $changed Map of field => { from, to }.
 * @return void
 */
function openstation_agent_face_sync_on_update( $user_id, $changed ) {
	if (
		! is_array( $changed )
		|| ( ! array_key_exists( 'face', $changed ) && ! array_key_exists( 'avatarAttachmentId', $changed ) )
	) {
		return;
	}
	openstation_agent_face_write( $user_id );
}
add_action( 'openstation_agent_updated', 'openstation_agent_face_sync_on_update', 10, 2 );

/**
 * Write the face for a freshly created agent.
 *
 * @param int $user_id Agent user id.
 * @return void
 */
function openstation_agent_face_sync_on_create( $user_id ) {
	openstation_agent_face_write( $user_id );
}
add_action( 'openstation_agent_created', 'openstation_agent_face_sync_on_create', 10, 1 );

/**
 * Clean up when an agent is deleted.
 *
 * @param int $user_id Agent user id.
 * @return void
 */
function openstation_agent_face_cleanup( $user_id ) {
	openstation_agent_face_delete( $user_id );
}
add_action( 'openstation_agent_deleted', 'openstation_agent_face_cleanup', 10, 1 );

/**
 * Re-render agents that use an attachment whose image changed.
 *
 * @param int $attachment_id Attachment id.
 * @return void
 */
function openstation_agent_profile_picture_attachment_updated( $attachment_id ) {
	$agent_ids = get_users(
		array(
			'fields'     => 'ids',
			'meta_key'   => OPENSTATION_AGENT_AVATAR_ATTACHMENT_META, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
			'meta_value' => (string) (int) $attachment_id, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value
		)
	);
	foreach ( $agent_ids as $agent_id ) {
		openstation_agent_face_write( (int) $agent_id );
	}
}
add_action( 'edit_attachment', 'openstation_agent_profile_picture_attachment_updated' );

/**
 * Fall back to the generated face when a chosen picture is deleted.
 *
 * @param int $attachment_id Attachment id being deleted.
 * @return void
 */
function openstation_agent_profile_picture_attachment_deleted( $attachment_id ) {
	$agent_ids = get_users(
		array(
			'fields'     => 'ids',
			'meta_key'   => OPENSTATION_AGENT_AVATAR_ATTACHMENT_META, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
			'meta_value' => (string) (int) $attachment_id, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value
		)
	);
	foreach ( $agent_ids as $agent_id ) {
		openstation_agent_update( (int) $agent_id, array( 'avatarAttachmentId' => 0 ) );
	}
}
add_action( 'delete_attachment', 'openstation_agent_profile_picture_attachment_deleted' );
