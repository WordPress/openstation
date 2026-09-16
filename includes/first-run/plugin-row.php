<?php
/**
 * OpenStation — the "Turn on" plugin row action.
 *
 * One permanent link on OpenStation's row in `plugins.php`. "Plugin
 * activated" is the moment people read that row, and until now the
 * row said nothing about the one thing left to do: turn it on for
 * yourself. While the current user has OpenStation off the link reads
 * "Turn on OpenStation" and points at the portal, which auto-enables
 * (through `openstation_portal_auto_enable`) and lands in the shell;
 * once they are on it reads "Open OpenStation" and points at the
 * shell screen. The portal's same-origin check accepts a click from
 * `plugins.php`.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Prepends the row action.
 *
 * Gated on `read`, the toggle's own capability, so the link never
 * offers what `openstation_ajax_save()` would refuse.
 *
 * @param string[] $links Existing row action links (HTML strings).
 * @return string[]
 */
function openstation_plugin_row_action_links( $links ) {
	if ( ! is_array( $links ) ) {
		$links = array();
	}
	if ( ! current_user_can( 'read' ) ) {
		return $links;
	}

	if ( openstation_is_enabled() ) {
		$link = sprintf(
			'<a href="%s">%s</a>',
			esc_url( openstation_shell_url() ),
			esc_html__( 'Open OpenStation', 'desktop-mode' )
		);
	} else {
		$link = sprintf(
			'<a href="%s">%s</a>',
			esc_url( openstation_portal_url() ),
			esc_html__( 'Turn on OpenStation', 'desktop-mode' )
		);
	}

	return array_merge( array( 'openstation' => $link ), $links );
}
add_filter( 'plugin_action_links_' . plugin_basename( OPENSTATION_FILE ), 'openstation_plugin_row_action_links' );
add_filter( 'network_admin_plugin_action_links_' . plugin_basename( OPENSTATION_FILE ), 'openstation_plugin_row_action_links' );
