<?php
/**
 * Desktop Mode — Recycle Bin: window + icon registration.
 *
 * Native window with id `wpdm-recycle-bin`, pinned to the taskbar with a
 * matching wallpaper icon. Like the code editor, the template body is a
 * static skeleton that the JS bundle enhances on first open — the table
 * is populated from the REST list endpoint at render time.
 *
 * Both registrations are filterable via the standard
 * `wp_desktop_recycle_bin_window_args` / `wp_desktop_recycle_bin_icon_args`
 * filters so a plugin can swap the icon, change the dimensions, or
 * restrict who sees the bin without touching this file.
 *
 * @package WPDesktopMode
 * @since   0.19.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Echoes the recycle bin window's template body.
 *
 * The shell wraps this in `<template id="wpdm-native-window-wpdm-recycle-bin">`
 * and clones it into the window body BEFORE the JS render callback runs.
 * The `data-wpdm-recycle-bin-*` hooks below are the contract the JS
 * relies on — keep them intact (or rename via the filter) when
 * customizing the layout.
 *
 * @since 0.19.0
 */
function wpdm_recycle_bin_render_template() {
	ob_start();
	?>
	<div class="wpdm-recycle-bin" data-wpdm-recycle-bin-root>
		<header class="wpdm-recycle-bin__toolbar" data-wpdm-recycle-bin-toolbar>
			<div class="wpdm-recycle-bin__toolbar-left">
				<wpd-segmented data-wpdm-recycle-bin-filter>
					<wpd-segment value="" selected><?php esc_html_e( 'All', 'desktop-mode' ); ?></wpd-segment>
					<wpd-segment value="post"><?php esc_html_e( 'Posts', 'desktop-mode' ); ?></wpd-segment>
					<wpd-segment value="page"><?php esc_html_e( 'Pages', 'desktop-mode' ); ?></wpd-segment>
					<wpd-segment value="attachment"><?php esc_html_e( 'Media', 'desktop-mode' ); ?></wpd-segment>
					<wpd-segment value="comment"><?php esc_html_e( 'Comments', 'desktop-mode' ); ?></wpd-segment>
				</wpd-segmented>
				<wpd-text-field
					data-wpdm-recycle-bin-search
					placeholder="<?php esc_attr_e( 'Search trash…', 'desktop-mode' ); ?>"
				></wpd-text-field>
			</div>
			<div class="wpdm-recycle-bin__toolbar-right" data-wpdm-recycle-bin-bulk hidden>
				<span class="wpdm-recycle-bin__count" data-wpdm-recycle-bin-count></span>
				<wpd-button variant="secondary" data-wpdm-recycle-bin-restore-selected>
					<span class="dashicons dashicons-image-rotate" aria-hidden="true"></span>
					<?php esc_html_e( 'Restore', 'desktop-mode' ); ?>
				</wpd-button>
				<wpd-button variant="danger" data-wpdm-recycle-bin-purge-selected>
					<span class="dashicons dashicons-trash" aria-hidden="true"></span>
					<?php esc_html_e( 'Delete forever', 'desktop-mode' ); ?>
				</wpd-button>
			</div>
			<div class="wpdm-recycle-bin__toolbar-trailing">
				<wpd-button variant="ghost" data-wpdm-recycle-bin-refresh title="<?php esc_attr_e( 'Refresh', 'desktop-mode' ); ?>">
					<span class="dashicons dashicons-update" aria-hidden="true"></span>
				</wpd-button>
				<wpd-button variant="danger" data-wpdm-recycle-bin-empty>
					<span class="dashicons dashicons-trash" aria-hidden="true"></span>
					<?php esc_html_e( 'Empty bin', 'desktop-mode' ); ?>
				</wpd-button>
			</div>
		</header>
		<div class="wpdm-recycle-bin__body" data-wpdm-recycle-bin-body>
			<wpd-table
				data-wpdm-recycle-bin-table
				selectable="multi"
				sticky-header
				hover
				striped
				loading
			>
				<div slot="empty" class="wpdm-recycle-bin__empty">
					<span class="dashicons dashicons-trash" aria-hidden="true"></span>
					<p><?php esc_html_e( 'The recycle bin is empty.', 'desktop-mode' ); ?></p>
					<p class="wpdm-recycle-bin__empty-hint">
						<?php esc_html_e( 'Deleted posts, pages, and media show up here. Restoring puts them back where they were.', 'desktop-mode' ); ?>
					</p>
				</div>
			</wpd-table>
		</div>
	</div>
	<?php
	$html = (string) ob_get_clean();

	/**
	 * Filter the recycle bin window's template HTML.
	 *
	 * Keep the `data-wpdm-recycle-bin-*` hooks intact so the JS render
	 * callback can find its mount points, or rename them and update the
	 * matching constants in `src/recycle-bin/index.ts`.
	 *
	 * @since 0.19.0
	 *
	 * @param string $html Default template HTML.
	 */
	echo apply_filters( 'wp_desktop_recycle_bin_template_html', $html ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
}

/**
 * Whether the current user should see the recycle bin at all.
 *
 * Filterable so plugins can hide it from authors/contributors who
 * don't manage trash, or invert the gate to expose it to a custom
 * role.
 *
 * @since 0.19.0
 *
 * @return bool
 */
function wpdm_recycle_bin_user_can_use() {
	$can = current_user_can( 'edit_posts' );

	/**
	 * Filter whether the current user can see the recycle bin window.
	 *
	 * @since 0.19.0
	 *
	 * @param bool $can Default: edit_posts capability.
	 */
	return (bool) apply_filters( 'wp_desktop_recycle_bin_user_can_use', $can );
}

/**
 * Register the recycle bin window + desktop icon on `init`.
 *
 * Hooked at priority 20, after `components.php` has bootstrapped the
 * native-window registry — same timing as the code editor.
 *
 * @since 0.19.0
 */
function wpdm_recycle_bin_register_window() {
	if ( ! wpdm_recycle_bin_user_can_use() ) {
		return;
	}

	$window_args = array(
		'title'      => __( 'Recycle Bin', 'desktop-mode' ),
		'icon'       => 'dashicons-trash',
		'template'   => 'wpdm_recycle_bin_render_template',
		'script'     => 'wp-desktop-recycle-bin',
		'width'      => 880,
		'height'     => 560,
		'min_width'  => 520,
		'min_height' => 360,
		'placement'  => 'taskbar',
	);

	/**
	 * Filter the args used to register the recycle bin native window.
	 *
	 * @since 0.19.0
	 *
	 * @param array $window_args Args passed to `desktop_mode_register_window()`.
	 */
	$window_args = (array) apply_filters( 'wp_desktop_recycle_bin_window_args', $window_args );

	$registered = desktop_mode_register_window( 'wpdm-recycle-bin', $window_args );
	if ( is_wp_error( $registered ) ) {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( '[desktop-mode] Recycle bin window registration failed: ' . $registered->get_error_message() );
		return;
	}

	$icon_args = array(
		'title'    => __( 'Recycle Bin', 'desktop-mode' ),
		'icon'     => 'dashicons-trash',
		'window'   => 'wpdm-recycle-bin',
		'position' => 80,
	);

	/**
	 * Filter the args used to register the recycle bin desktop icon.
	 *
	 * @since 0.19.0
	 *
	 * @param array $icon_args Args passed to `desktop_mode_register_icon()`.
	 */
	$icon_args = (array) apply_filters( 'wp_desktop_recycle_bin_icon_args', $icon_args );

	desktop_mode_register_icon( 'wpdm-recycle-bin', $icon_args );
}
add_action( 'init', 'wpdm_recycle_bin_register_window', 20 );

/**
 * Localize REST endpoints for the JS bundle.
 *
 * Same pattern as the code editor: the bundle reads its config off
 * `window.wpDesktopRecycleBinConfig` and never hardcodes URLs.
 *
 * @since 0.19.0
 */
function wpdm_recycle_bin_localize_config() {
	if ( ! wpdm_recycle_bin_user_can_use() ) {
		return;
	}

	wp_localize_script(
		'wp-desktop-recycle-bin',
		'wpDesktopRecycleBinConfig',
		array(
			'restNonce'  => wp_create_nonce( 'wp_rest' ),
			'listUrl'    => esc_url_raw( rest_url( 'wp-desktop/v1/recycle-bin' ) ),
			'restoreUrl' => esc_url_raw( rest_url( 'wp-desktop/v1/recycle-bin/restore' ) ),
			'purgeUrl'   => esc_url_raw( rest_url( 'wp-desktop/v1/recycle-bin/purge' ) ),
			'emptyUrl'   => esc_url_raw( rest_url( 'wp-desktop/v1/recycle-bin/empty' ) ),
			'countUrl'   => esc_url_raw( rest_url( 'wp-desktop/v1/recycle-bin/count' ) ),
		)
	);

	wp_enqueue_style( 'wp-desktop-recycle-bin' );
}
add_action( 'admin_enqueue_scripts', 'wpdm_recycle_bin_localize_config', 30 );

/**
 * Inject the initial trash count into the shell config so the
 * dock/taskbar tile + desktop icon can paint a badge on the very
 * first paint — before the bin window has ever opened.
 *
 * @since 0.21.0
 *
 * @param array $config Shell config blob.
 * @return array
 */
function wpdm_recycle_bin_inject_shell_config( $config ) {
	if ( ! is_array( $config ) ) {
		return $config;
	}
	$config['recycleBinCount']    = wpdm_recycle_bin_count();
	$config['recycleBinCountUrl'] = esc_url_raw( rest_url( 'wp-desktop/v1/recycle-bin/count' ) );
	return $config;
}
add_filter( 'desktop_mode_shell_config', 'wpdm_recycle_bin_inject_shell_config', 20 );
