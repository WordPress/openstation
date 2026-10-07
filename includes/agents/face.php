<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_AGENT_FACE_SIZE = 96;

function openstation_agent_faces_dir() {
	$uploads = wp_get_upload_dir();
	$base    = trailingslashit( $uploads['basedir'] ) . 'desktop-mode-agent-faces';

	return (string) apply_filters( 'openstation_agent_faces_base_dir', $base );
}

function openstation_agent_faces_url() {
	$uploads = wp_get_upload_dir();
	$url     = untrailingslashit( $uploads['baseurl'] ) . '/desktop-mode-agent-faces';

	return (string) apply_filters( 'openstation_agent_faces_base_url', $url );
}

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

		file_put_contents( $htaccess, $rules );
	}

	return $base;
}

function openstation_agent_face_filename( $user_id ) {
	$raw = (string) get_user_meta( (int) $user_id, OPENSTATION_AGENT_FACE_META, true );
	if ( '' === $raw ) {
		return '';
	}
	return (int) $user_id . '-' . substr( md5( $raw ), 0, 8 ) . '.svg';
}

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

function openstation_agent_face_sync_on_update( $user_id, $changed ) {
	if ( ! is_array( $changed ) || ! array_key_exists( 'face', $changed ) ) {
		return;
	}
	openstation_agent_face_write( $user_id );
}
add_action( 'openstation_agent_updated', 'openstation_agent_face_sync_on_update', 10, 2 );

function openstation_agent_face_sync_on_create( $user_id ) {
	openstation_agent_face_write( $user_id );
}
add_action( 'openstation_agent_created', 'openstation_agent_face_sync_on_create', 10, 1 );

function openstation_agent_face_cleanup( $user_id ) {
	openstation_agent_face_delete( $user_id );
}
add_action( 'openstation_agent_deleted', 'openstation_agent_face_cleanup', 10, 1 );

function openstation_agent_face_pending_core_deletes( $add = 0 ) {
	static $pending = array();
	if ( $add > 0 ) {
		$pending[ (int) $add ] = true;
	}
	return $pending;
}

function openstation_agent_face_note_core_delete( $user_id ) {
	if ( openstation_agent_is_agent( (int) $user_id ) ) {
		openstation_agent_face_pending_core_deletes( (int) $user_id );
	}
}
add_action( 'delete_user', 'openstation_agent_face_note_core_delete', 10, 1 );
add_action( 'wpmu_delete_user', 'openstation_agent_face_note_core_delete', 10, 1 );

function openstation_agent_face_cleanup_after_core_delete( $user_id ) {
	$pending = openstation_agent_face_pending_core_deletes();
	if ( empty( $pending[ (int) $user_id ] ) || get_userdata( (int) $user_id ) ) {
		return;
	}
	openstation_agent_face_delete( (int) $user_id );
}
add_action( 'deleted_user', 'openstation_agent_face_cleanup_after_core_delete', 10, 1 );
