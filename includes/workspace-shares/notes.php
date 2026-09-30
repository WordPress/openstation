<?php
/**
 * OpenStation — Workspace notes: who has dismissed which.
 *
 * A workspace can carry read-only notes its author pinned on the desk
 * (`profile.notes`, see `openstation_sanitize_workspace_notes()`). Each
 * person using the desk may dismiss a note; the dismissal is theirs,
 * per site, and survives reloads and devices. A note the author edits
 * keeps its id, and so stays dismissed — a NEW note is a new id.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/** User option: ids of the workspace notes this user dismissed. */
const OPENSTATION_WORKSPACE_DISMISSED_NOTES_OPTION = 'openstation_workspace_dismissed_notes';

/** Cap on remembered dismissals; the oldest go first. */
const OPENSTATION_WORKSPACE_DISMISSED_NOTES_MAX = 200;

/**
 * The note ids a user has dismissed.
 *
 * @param int $user_id User id.
 * @return string[]
 */
function openstation_workspace_dismissed_notes( $user_id ) {
	$ids = get_user_option( OPENSTATION_WORKSPACE_DISMISSED_NOTES_OPTION, (int) $user_id );
	return is_array( $ids ) ? array_values( array_filter( array_map( 'strval', $ids ) ) ) : array();
}

/**
 * Records a dismissal.
 *
 * @param int    $user_id User id.
 * @param string $note_id Note id.
 * @return string[] The ids now dismissed.
 */
function openstation_workspace_dismiss_note( $user_id, $note_id ) {
	$note_id = substr( preg_replace( '/[^a-z0-9]/', '', strtolower( (string) $note_id ) ), 0, 24 );
	$ids     = openstation_workspace_dismissed_notes( $user_id );
	if ( '' !== $note_id && ! in_array( $note_id, $ids, true ) ) {
		$ids[] = $note_id;
		$ids   = array_slice( $ids, -OPENSTATION_WORKSPACE_DISMISSED_NOTES_MAX );
		update_user_option( (int) $user_id, OPENSTATION_WORKSPACE_DISMISSED_NOTES_OPTION, $ids );
	}
	return $ids;
}

/**
 * Registers `POST desktop-mode/v1/workspace-notes/dismiss`.
 *
 * @return void
 */
function openstation_workspace_notes_register_routes() {
	register_rest_route(
		'desktop-mode/v1',
		'/workspace-notes/dismiss',
		array(
			'methods'             => 'POST',
			'callback'            => static function ( WP_REST_Request $request ) {
				return rest_ensure_response(
					array( 'dismissed' => openstation_workspace_dismiss_note( get_current_user_id(), (string) $request->get_param( 'id' ) ) )
				);
			},
			'permission_callback' => 'openstation_rest_require_enabled',
			'args'                => array(
				'id' => array(
					'type'     => 'string',
					'required' => true,
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'openstation_workspace_notes_register_routes' );

/**
 * Ships the dismissed ids with the shell, so a dismissed note never
 * flashes on the desk before a request could say so.
 *
 * @param array $config Shell config.
 * @return array
 */
function openstation_workspace_notes_shell_config( $config ) {
	$config['workspaceDismissedNotes'] = openstation_workspace_dismissed_notes( get_current_user_id() );
	return $config;
}
add_filter( 'openstation_shell_config', 'openstation_workspace_notes_shell_config' );
