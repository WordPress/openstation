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
 * the renderer refuses to emit.** `openstation_mio_portrait_svg()`
 * writes numbers and a fixed vocabulary of elements: no text nodes, no
 * caller-supplied string anywhere. The directory is hardened exec-off
 * rather than deny-all, because unlike a theme's PHP these files have
 * to stay servable.
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
	$raw = (string) get_user_meta( (int) $user_id, OPENSTATION_AGENT_FACE_META, true );
	if ( '' === $raw ) {
		return '';
	}
	return (int) $user_id . '-' . substr( md5( $raw ), 0, 8 ) . '.svg';
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

	$look = openstation_mio_clamp_look( openstation_agent_get_face( $user_id ) );
	$svg  = openstation_mio_portrait_svg( $look, OPENSTATION_AGENT_FACE_SIZE );

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
	if ( ! is_array( $changed ) || ! array_key_exists( 'face', $changed ) ) {
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
