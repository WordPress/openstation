<?php
/**
 * Re-derives WordPress Core's *global* admin notices — the ones that would
 * otherwise repeat in every desktop window — into shell descriptors, so the
 * shell can surface each once. The update nag is handled separately (see
 * update-notice.php); this covers the rest. See docs/core-notices-audit.md
 * for the full audit and disposition of every core notice.
 *
 * @since 0.9.4
 * @package DesktopMode
 */

defined( 'ABSPATH' ) || exit;

/**
 * The in-scope global core notices for the current user, as shell
 * descriptors. Each descriptor is
 * `{ id, message, actionLabel?, actionUrl?, dismissible }`, re-derived from
 * authoritative state (never scraped) and capability-gated exactly as Core
 * gates the underlying notice.
 *
 * @since 0.9.4
 *
 * @return array<int,array{id:string,message:string,actionLabel:string,actionUrl:string,dismissible:bool}>
 */
function desktop_mode_get_core_notices() {
	$builders = array(
		'desktop_mode_core_notice_maintenance',
		'desktop_mode_core_notice_recovery_mode',
		'desktop_mode_core_notice_default_password',
		'desktop_mode_core_notice_deactivated_plugins',
		'desktop_mode_core_notice_paused_plugins',
		'desktop_mode_core_notice_paused_themes',
	);

	$notices = array();
	foreach ( $builders as $builder ) {
		$notice = $builder();
		if ( $notice ) {
			$notices[] = $notice;
		}
	}

	/**
	 * Filters the core notices surfaced once in the desktop shell. Return an
	 * empty array to suppress them all, or unset individual entries by `id`.
	 *
	 * @since 0.9.4
	 *
	 * @param array $notices List of notice descriptors.
	 */
	return apply_filters( 'desktop_mode_core_notices', $notices );
}

/**
 * Normalizes a notice descriptor, filling optional fields.
 *
 * @since 0.9.4
 *
 * @param array $notice Partial descriptor with at least `id` + `message`.
 * @return array{id:string,title:string,message:string,actionLabel:string,actionUrl:string,dismissible:bool}
 */
function desktop_mode_core_notice( array $notice ) {
	return array(
		'id'          => (string) $notice['id'],
		'title'       => isset( $notice['title'] ) ? (string) $notice['title'] : '',
		'message'     => (string) $notice['message'],
		'actionLabel' => isset( $notice['actionLabel'] ) ? (string) $notice['actionLabel'] : '',
		'actionUrl'   => isset( $notice['actionUrl'] ) ? (string) $notice['actionUrl'] : '',
		'dismissible' => ! empty( $notice['dismissible'] ),
	);
}

/**
 * Interrupted / failed automated core update — mirrors `maintenance_nag()`.
 * Clears itself when the update completes, so it isn't dismissible.
 *
 * @since 0.9.4
 *
 * @return array|null
 */
function desktop_mode_core_notice_maintenance() {
	$nag = isset( $GLOBALS['upgrading'] );

	if ( ! $nag ) {
		$failed     = get_site_option( 'auto_core_update_failed' );
		$comparison = ! empty( $failed['critical'] ) ? '>=' : '>';
		if ( isset( $failed['attempted'] )
			&& version_compare( $failed['attempted'], get_bloginfo( 'version' ), $comparison )
		) {
			$nag = true;
		}
	}

	if ( ! $nag ) {
		return null;
	}

	$can = current_user_can( 'update_core' );
	return desktop_mode_core_notice(
		array(
			'id'          => 'maintenance',
			'title'       => __( 'WordPress Updates', 'desktop-mode' ),
			'message'     => $can
				? __( 'An automated WordPress update failed to complete.', 'desktop-mode' )
				: __( 'An automated WordPress update failed to complete. Please notify the site administrator.', 'desktop-mode' ),
			'actionLabel' => $can ? __( 'Retry update', 'desktop-mode' ) : '',
			'actionUrl'   => $can ? self_admin_url( 'update-core.php' ) : '',
		)
	);
}

/**
 * Site is in recovery mode — mirrors `wp_recovery_mode_nag()`. Clears itself
 * on exit, so it isn't dismissible.
 *
 * @since 0.9.4
 *
 * @return array|null
 */
function desktop_mode_core_notice_recovery_mode() {
	if ( ! function_exists( 'wp_is_recovery_mode' ) || ! wp_is_recovery_mode() ) {
		return null;
	}

	$url = wp_login_url();
	$url = add_query_arg( 'action', WP_Recovery_Mode::EXIT_ACTION, $url );
	$url = wp_nonce_url( $url, WP_Recovery_Mode::EXIT_ACTION );

	return desktop_mode_core_notice(
		array(
			'id'          => 'recovery-mode',
			'title'       => __( 'Recovery Mode', 'desktop-mode' ),
			'message'     => __( 'You are in recovery mode. There may be an error with a theme or plugin.', 'desktop-mode' ),
			'actionLabel' => __( 'Exit recovery mode', 'desktop-mode' ),
			'actionUrl'   => $url,
		)
	);
}

/**
 * User is still on their auto-generated password — mirrors
 * `default_password_nag()`. Dismissible, matching Core's "No thanks" link.
 *
 * @since 0.9.4
 *
 * @return array|null
 */
function desktop_mode_core_notice_default_password() {
	if ( ! get_user_option( 'default_password_nag' ) ) {
		return null;
	}

	return desktop_mode_core_notice(
		array(
			'id'          => 'default-password',
			'title'       => __( 'Profile', 'desktop-mode' ),
			'message'     => __( 'You are using an auto-generated password. Would you like to change it?', 'desktop-mode' ),
			'actionLabel' => __( 'Change password', 'desktop-mode' ),
			'actionUrl'   => self_admin_url( 'profile.php#password' ),
			'dismissible' => true,
		)
	);
}

/**
 * Plugins force-deactivated on a WordPress upgrade — mirrors
 * `deactivated_plugins_notice()`. Core only clears the option when its own
 * notice callback prints, which the shell can't be relied on to trigger, so
 * this one is dismissible to guarantee the user can clear it.
 *
 * @since 0.9.4
 *
 * @return array|null
 */
function desktop_mode_core_notice_deactivated_plugins() {
	if ( ! current_user_can( 'activate_plugins' ) ) {
		return null;
	}

	$deactivated = get_option( 'wp_force_deactivated_plugins' );
	if ( empty( $deactivated ) || ! is_array( $deactivated ) ) {
		return null;
	}

	$names = array();
	foreach ( $deactivated as $plugin ) {
		if ( ! empty( $plugin['plugin_name'] ) ) {
			$names[] = $plugin['plugin_name'];
		}
	}
	if ( ! $names ) {
		return null;
	}

	return desktop_mode_core_notice(
		array(
			'id'          => 'deactivated-plugins',
			'title'       => __( 'Plugins', 'desktop-mode' ),
			'message'     => sprintf(
				/* translators: %s: comma-separated list of plugin names. */
				__( 'Deactivated during a WordPress upgrade for incompatibility: %s.', 'desktop-mode' ),
				implode( ', ', $names )
			),
			'actionLabel' => __( 'View plugins', 'desktop-mode' ),
			'actionUrl'   => self_admin_url( 'plugins.php?plugin_status=inactive' ),
			'dismissible' => true,
		)
	);
}

/**
 * Plugins paused by recovery mode — mirrors `paused_plugins_notice()`. Clears
 * itself on recovery-mode exit, so it isn't dismissible.
 *
 * @since 0.9.4
 *
 * @return array|null
 */
function desktop_mode_core_notice_paused_plugins() {
	if ( ! current_user_can( 'resume_plugins' ) || ! function_exists( 'wp_paused_plugins' ) ) {
		return null;
	}

	if ( empty( wp_paused_plugins()->get_all() ) ) {
		return null;
	}

	return desktop_mode_core_notice(
		array(
			'id'          => 'paused-plugins',
			'title'       => __( 'Plugins', 'desktop-mode' ),
			'message'     => __( 'One or more plugins failed to load properly.', 'desktop-mode' ),
			'actionLabel' => __( 'Go to Plugins', 'desktop-mode' ),
			'actionUrl'   => self_admin_url( 'plugins.php?plugin_status=paused' ),
		)
	);
}

/**
 * Themes paused by recovery mode — mirrors `paused_themes_notice()`. Clears
 * itself on recovery-mode exit, so it isn't dismissible.
 *
 * @since 0.9.4
 *
 * @return array|null
 */
function desktop_mode_core_notice_paused_themes() {
	if ( ! current_user_can( 'resume_themes' ) || ! function_exists( 'wp_paused_themes' ) ) {
		return null;
	}

	if ( empty( wp_paused_themes()->get_all() ) ) {
		return null;
	}

	return desktop_mode_core_notice(
		array(
			'id'          => 'paused-themes',
			'title'       => __( 'Themes', 'desktop-mode' ),
			'message'     => __( 'One or more themes failed to load properly.', 'desktop-mode' ),
			'actionLabel' => __( 'Go to Themes', 'desktop-mode' ),
			'actionUrl'   => self_admin_url( 'themes.php' ),
		)
	);
}
