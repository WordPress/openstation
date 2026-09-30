<?php
/**
 * OpenStation — Shared workspaces: "Hide settings".
 *
 * One checkbox on a workspace, and the answer to the question agencies
 * actually ask: *can my client break the site from here?* A workspace
 * with `restricted` set leaves out every screen that configures the
 * site rather than working in it — Settings, OpenStation Preferences,
 * plugins, themes and the Customizer, the file editors, tools, users,
 * updates and site health.
 *
 * For the desk's owner it is a view: those apps leave the rails. For a
 * user PINNED to it, it is enforced — the screens are refused by the
 * fence and the apps by the App Framework's gate, whatever the rest of
 * the workspace includes. Capabilities are still the real boundary;
 * this is the guardrail on top of them.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Admin screens a restricted workspace leaves out.
 *
 * Matched on the admin FILE, so a plugin's settings page registered
 * under Settings or Tools (`options-general.php?page=…`) goes with its
 * parent.
 *
 * @return string[] Admin file names.
 */
function openstation_workspace_restricted_screens() {
	/**
	 * Filters the admin screens a restricted workspace leaves out.
	 *
	 * @param string[] $files Admin file names (`plugins.php`, …).
	 */
	return array_values(
		array_filter(
			array_map(
				'strval',
				(array) apply_filters(
					'openstation_workspace_restricted_screens',
					array(
						'options-general.php',
						'options-writing.php',
						'options-reading.php',
						'options-discussion.php',
						'options-media.php',
						'options-permalink.php',
						'options-privacy.php',
						'options.php',
						'plugins.php',
						'plugin-install.php',
						'plugin-editor.php',
						'themes.php',
						'theme-install.php',
						'theme-editor.php',
						'customize.php',
						'site-editor.php',
						'widgets.php',
						'nav-menus.php',
						'tools.php',
						'import.php',
						'export.php',
						'site-health.php',
						'export-personal-data.php',
						'erase-personal-data.php',
						'users.php',
						'user-new.php',
						'user-edit.php',
						'update-core.php',
						'update.php',
					)
				)
			)
		)
	);
}

/**
 * App Framework windows a restricted workspace leaves out.
 *
 * @return string[] App ids.
 */
function openstation_workspace_restricted_apps() {
	/**
	 * Filters the App Framework windows a restricted workspace leaves out.
	 *
	 * @param string[] $app_ids App ids. Default: OpenStation Preferences,
	 *                          Plugins, Users, Network, Code Blue and the
	 *                          Workspaces app itself.
	 */
	return array_values(
		array_map(
			'strval',
			(array) apply_filters(
				'openstation_workspace_restricted_apps',
				array(
					'desktop-mode-os-settings',
					'desktop-mode-plugins',
					'desktop-mode-users',
					'openstation-network',
					'openstation-code-blue',
					'openstation-workspaces',
				)
			)
		)
	);
}

/**
 * Whether a user is pinned to a workspace with "Hide settings" on.
 *
 * @param int $user_id Optional. Defaults to the current user.
 * @return bool
 */
function openstation_workspace_is_restricted( $user_id = 0 ) {
	$user_id = $user_id ? (int) $user_id : get_current_user_id();
	$pin     = openstation_workspace_pin_get( $user_id );
	if ( ! $pin ) {
		return false;
	}
	$share = openstation_workspace_share_get( $pin['share'] );
	return $share && ! empty( $share['profile']['restricted'] );
}

/**
 * Refuses the restricted apps to a restricted, pinned user.
 *
 * @param bool   $allowed Whether the app is allowed.
 * @param string $app_id  App id.
 * @return bool
 */
function openstation_workspace_restrict_apps( $allowed, $app_id ) {
	if ( ! $allowed || ! in_array( (string) $app_id, openstation_workspace_restricted_apps(), true ) ) {
		return $allowed;
	}
	return ! openstation_workspace_is_restricted();
}
add_filter( 'openstation_app_allows', 'openstation_workspace_restrict_apps', 10, 2 );

/**
 * Tells the shell what "Hide settings" leaves out, so the rails can
 * leave the same things out on any desk that has it on.
 *
 * @param array $config Shell config.
 * @return array
 */
function openstation_workspace_restrictions_shell_config( $config ) {
	$config['workspaceRestricted'] = array(
		'screens' => openstation_workspace_restricted_screens(),
		'apps'    => openstation_workspace_restricted_apps(),
	);
	return $config;
}
add_filter( 'openstation_shell_config', 'openstation_workspace_restrictions_shell_config' );
