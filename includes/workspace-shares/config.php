<?php
/**
 * OpenStation — Shared workspaces: what the shell is told.
 *
 * Three keys on the shell config and one body class. The client uses
 * them to take away what a pinned user cannot use anyway — the server
 * refuses those things regardless, so this is about not offering a
 * button that does nothing.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Adds the shared-workspace keys to the shell config.
 *
 * - `workspacePin`      — `{ label, author }` while the user is pinned, else null.
 * - `workspaceArrival`  — `{ status, label, desktop }` right after a share link, else null.
 * - `workspaceCanShare` — whether the user may share workspaces.
 *
 * @param array $config Shell config.
 * @return array
 */
function openstation_workspace_shares_shell_config( $config ) {
	$user_id = get_current_user_id();
	$pin     = openstation_workspace_pin_get( $user_id );
	$share   = $pin ? openstation_workspace_share_get( $pin['share'] ) : null;
	$author  = $share ? get_userdata( $share['author'] ) : null;

	$config['workspacePin']      = $share ? array(
		'label'  => $share['label'],
		'author' => $author ? (string) $author->display_name : '',
	) : null;
	$config['workspaceArrival']  = openstation_workspace_share_arrival();
	$config['workspaceCanShare'] = openstation_workspace_user_can_share( $user_id );
	return $config;
}
add_filter( 'openstation_shell_config', 'openstation_workspace_shares_shell_config' );

/**
 * Marks a pinned user's shell with `os-workspace-pinned`.
 *
 * @param string $classes Body classes.
 * @return string
 */
function openstation_workspace_shares_body_class( $classes ) {
	if ( openstation_is_shell_request() && openstation_workspace_is_pinned() ) {
		$classes .= ' os-workspace-pinned';
	}
	return $classes;
}
add_filter( 'admin_body_class', 'openstation_workspace_shares_body_class', 20 );
