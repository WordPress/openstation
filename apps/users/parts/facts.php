<?php
/**
 * Users — the profile facts both apps ship as their config extra.
 *
 * The Users app's Profile tab and the User Edit window host the same
 * `<os-user-profile>`, and both windows register on every request
 * that builds the app manifests; the catalogue work behind the facts
 * (a language directory scan, the admin colour-scheme registry, the
 * editable-roles walk) is done once per request per viewer here and
 * handed to both config callables.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * The static facts `<os-user-profile>` and the Users list read
 * (`ctx.extra`), for the acting user. Memoised per request and per
 * viewer, so switching users mid-request (a test, a `switch_to_user`)
 * recomputes.
 *
 * @return array<string,mixed>
 */
function openstation_users_profile_facts() {
	static $cache = array();
	$viewer_id = (int) get_current_user_id();
	// Neither app is registered for a visitor; skip the catalogue work.
	if ( $viewer_id <= 0 ) {
		return array();
	}
	if ( isset( $cache[ $viewer_id ] ) ) {
		return $cache[ $viewer_id ];
	}
	$cache[ $viewer_id ] = array(
		'currentUserId'   => $viewer_id,
		// Capability flags — the UI hides actions the viewer can't
		// perform; every action and route re-checks, so a tampered flag
		// changes nothing.
		'canEdit'         => current_user_can( 'edit_users' ),
		'canPromote'      => current_user_can( 'promote_users' ),
		'canCreate'       => current_user_can( 'create_users' ),
		'canDelete'       => is_multisite() ? current_user_can( 'remove_users' ) : current_user_can( 'delete_users' ),
		'isMultisite'     => is_multisite(),
		// Roles the viewer may assign — the dropdowns list only these,
		// so a narrowed `editable_roles` never yields "pick a role, hit
		// save, get rejected". `allRoles` is the label catalogue.
		'assignableRoles' => openstation_users_window_role_label_map( $viewer_id ),
		'allRoles'        => openstation_users_window_all_roles_map(),
		'locales'         => openstation_users_window_locales_map(),
		'defaultRole'     => (string) get_option( 'default_role', 'subscriber' ),
		'contactMethods'  => (array) wp_get_user_contact_methods(),
		'colorSchemes'    => openstation_user_edit_window_color_schemes(),
	);
	return $cache[ $viewer_id ];
}
