<?php
/**
 * Build installer for Desktop Mode Beta.
 *
 * Installs a resolved build zip over the existing `desktop-mode/`
 * plugin folder — the exact overwrite-in-place WordPress performs on
 * any plugin update — and records what was installed in the
 * `desktop_mode_beta_current` option. Switching back to stable
 * installs the latest release zip and clears the record.
 *
 * The client never supplies a download URL. It sends a
 * `{ source, id }` pair and the server resolves the URL from GitHub
 * data it fetched itself, so the only installable bytes are assets of
 * the configured repository's releases.
 *
 * @package DesktopModeBeta
 */

defined( 'ABSPATH' ) || exit;

/**
 * Resolve a `{ source, id }` request to a download URL + install record.
 *
 * Always bypasses the discovery caches — an install must act on the
 * current head SHA, not one from five minutes ago.
 *
 * @since 0.1.0
 *
 * @param string $source One of `stable`, `trunk`, `pr`.
 * @param string $id     PR number when `$source` is `pr`; ignored otherwise.
 * @return array|WP_Error `{ url, record }` — `record` is null for stable.
 */
function desktop_mode_beta_resolve_target( $source, $id ) {
	switch ( $source ) {
		case 'stable':
			$stable = desktop_mode_beta_fetch_stable( true );
			if ( is_wp_error( $stable ) ) {
				return $stable;
			}
			$prefix = sprintf( 'https://github.com/%s/releases/download/', desktop_mode_beta_repo() );
			if ( 0 !== strpos( $stable['url'], $prefix ) ) {
				return new WP_Error(
					'desktop_mode_beta_unexpected_url',
					__( 'The stable release asset URL does not belong to the configured repository.', 'desktop-mode-beta' ),
					array( 'status' => 502 )
				);
			}
			return array(
				'url'    => $stable['url'],
				'record' => null,
			);

		case 'trunk':
			$trunk = desktop_mode_beta_fetch_trunk( true );
			if ( null === $trunk ) {
				return new WP_Error(
					'desktop_mode_beta_no_trunk',
					__( 'No trunk build has been published yet.', 'desktop-mode-beta' ),
					array( 'status' => 404 )
				);
			}
			return array(
				'url'    => $trunk['url'],
				'record' => array(
					'source'  => 'trunk',
					'id'      => '',
					'sha'     => $trunk['sha'],
					'branch'  => 'trunk',
					'title'   => '',
					'version' => $trunk['version'],
				),
			);

		case 'pr':
			$number = (int) $id;
			if ( $number <= 0 ) {
				return new WP_Error(
					'desktop_mode_beta_bad_pr',
					__( 'A pull request number is required.', 'desktop-mode-beta' ),
					array( 'status' => 400 )
				);
			}
			$prs = desktop_mode_beta_fetch_open_prs( true );
			if ( is_wp_error( $prs ) ) {
				return $prs;
			}
			foreach ( $prs as $pr ) {
				if ( $pr['number'] !== $number ) {
					continue;
				}
				$exists = desktop_mode_beta_assets_exist( array( $pr['asset'] ), true );
				if ( empty( $exists[ $pr['asset'] ] ) ) {
					return new WP_Error(
						'desktop_mode_beta_build_pending',
						sprintf(
							/* translators: %d: Pull request number. */
							__( 'No build exists yet for the latest commit of PR #%d — the build usually lands a few minutes after a push. Try again shortly.', 'desktop-mode-beta' ),
							$number
						),
						array( 'status' => 409 )
					);
				}
				return array(
					'url'    => desktop_mode_beta_ci_asset_url( $pr['asset'] ),
					'record' => array(
						'source'  => 'pr',
						'id'      => (string) $number,
						'sha'     => $pr['sha'],
						'branch'  => $pr['branch'],
						'title'   => $pr['title'],
						'version' => '',
					),
				);
			}
			return new WP_Error(
				'desktop_mode_beta_pr_missing',
				sprintf(
					/* translators: %d: Pull request number. */
					__( 'PR #%d is not an open pull request on the repository.', 'desktop-mode-beta' ),
					$number
				),
				array( 'status' => 404 )
			);
	}

	return new WP_Error(
		'desktop_mode_beta_bad_source',
		__( 'Unknown build source.', 'desktop-mode-beta' ),
		array( 'status' => 400 )
	);
}

/**
 * Download + install a build zip over the current Desktop Mode install
 * and record it. Runs in admin-ajax context (the upgrader classes are
 * admin-only; admin-ajax is the same context Core's own plugin-install
 * ajax handlers use).
 *
 * @since 0.1.0
 *
 * @param string $source One of `stable`, `trunk`, `pr`.
 * @param string $id     PR number when `$source` is `pr`.
 * @return array|WP_Error `{ record, version, messages }` on success.
 */
function desktop_mode_beta_switch( $source, $id ) {
	// Refuse before any network work: overwriting a development
	// checkout (a wp-env bind mount of the working tree) would destroy
	// uncommitted work. See desktop_mode_beta_install_blocked() — the
	// `desktop_mode_beta_allow_dev_overwrite` filter overrides.
	$blocked = desktop_mode_beta_install_blocked();
	if ( null !== $blocked ) {
		return new WP_Error(
			'desktop_mode_beta_dev_checkout',
			$blocked['reason'],
			array( 'status' => 409 )
		);
	}

	$target = desktop_mode_beta_resolve_target( $source, $id );
	if ( is_wp_error( $target ) ) {
		return $target;
	}

	if ( ! function_exists( 'request_filesystem_credentials' ) ) {
		require_once ABSPATH . 'wp-admin/includes/file.php';
	}
	if ( ! function_exists( 'get_plugin_data' ) ) {
		require_once ABSPATH . 'wp-admin/includes/plugin.php';
	}
	if ( ! class_exists( 'WP_Upgrader' ) ) {
		require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
	}
	if ( ! class_exists( 'WP_Ajax_Upgrader_Skin' ) ) {
		require_once ABSPATH . 'wp-admin/includes/class-wp-ajax-upgrader-skin.php';
	}
	if ( ! class_exists( 'Plugin_Upgrader' ) || ! class_exists( 'WP_Ajax_Upgrader_Skin' ) ) {
		return new WP_Error(
			'desktop_mode_beta_upgrader_missing',
			__( 'The plugin upgrader is unavailable in this context. Reload the page and try again.', 'desktop-mode-beta' ),
			array( 'status' => 503 )
		);
	}

	$skin     = new WP_Ajax_Upgrader_Skin();
	$upgrader = new Plugin_Upgrader( $skin );
	$result   = $upgrader->install(
		$target['url'],
		array( 'overwrite_package' => true )
	);

	if ( is_wp_error( $skin->result ) ) {
		return $skin->result;
	}
	if ( $skin->get_errors()->has_errors() ) {
		return $skin->get_errors();
	}
	if ( is_wp_error( $result ) ) {
		return $result;
	}
	if ( false === $result || null === $result ) {
		return new WP_Error(
			'desktop_mode_beta_install_failed',
			__( 'Installing the build failed.', 'desktop-mode-beta' ),
			array( 'status' => 500 )
		);
	}

	// Sanity check: the zip must actually have contained Desktop Mode.
	$plugin_file = (string) $upgrader->plugin_info();
	if ( DESKTOP_MODE_BETA_TARGET_PLUGIN !== $plugin_file ) {
		return new WP_Error(
			'desktop_mode_beta_wrong_plugin',
			sprintf(
				/* translators: %s: Plugin file resolved from the installed zip. */
				__( 'The downloaded zip installed "%s" instead of Desktop Mode.', 'desktop-mode-beta' ),
				$plugin_file
			),
			array( 'status' => 500 )
		);
	}

	// Keep the plugin active. Overwriting an active plugin's folder
	// leaves its activation record untouched, so this only fires when
	// Desktop Mode was inactive (or absent) before the switch.
	if ( ! is_plugin_active( DESKTOP_MODE_BETA_TARGET_PLUGIN ) ) {
		$activated = activate_plugin( DESKTOP_MODE_BETA_TARGET_PLUGIN );
		if ( is_wp_error( $activated ) ) {
			return $activated;
		}
	}

	$version = desktop_mode_beta_installed_version();
	$record  = $target['record'];
	if ( null === $record ) {
		delete_option( DESKTOP_MODE_BETA_CURRENT_OPTION );
	} else {
		$user                   = wp_get_current_user();
		$record['version']      = $version;
		$record['installed_at'] = time();
		$record['installed_by'] = $user instanceof WP_User ? $user->user_login : '';
		update_option( DESKTOP_MODE_BETA_CURRENT_OPTION, $record, false );
	}

	return array(
		'record'   => $record,
		'version'  => $version,
		'messages' => $skin->get_upgrade_messages(),
	);
}
