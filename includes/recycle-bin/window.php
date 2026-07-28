<?php
/**
 * Desktop Mode — Recycle Bin: window + icon registration.
 *
 * Native window with id `desktop-mode-recycle-bin`, pinned to the taskbar with a
 * matching wallpaper icon. Like the code editor, the template body is a
 * static skeleton that the JS bundle enhances on first open — the table
 * is populated from the REST list endpoint at render time.
 *
 * Both registrations are filterable via the standard
 * `desktop_mode_recycle_bin_window_args` / `desktop_mode_recycle_bin_icon_args`
 * filters so a plugin can swap the icon, change the dimensions, or
 * restrict who sees the bin without touching this file.
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/**
 * Echoes the recycle bin window's template body.
 *
 * The shell wraps this in `<template id="desktop-mode-native-window-desktop-mode-recycle-bin">`
 * and clones it into the window body BEFORE the JS render callback runs.
 * The `data-desktop-mode-recycle-bin-*` hooks below are the contract the JS
 * relies on — keep them intact (or rename via the filter) when
 * customizing the layout.
 */
function desktop_mode_recycle_bin_render_template() {
	ob_start();
	?>
	<div class="desktop-mode-recycle-bin" data-desktop-mode-recycle-bin-root>
		<header class="desktop-mode-recycle-bin__toolbar" data-desktop-mode-recycle-bin-toolbar>
			<div class="desktop-mode-recycle-bin__toolbar-left">
				<wpd-segmented data-desktop-mode-recycle-bin-filter>
					<wpd-segment value="" selected><?php esc_html_e( 'All', 'desktop-mode' ); ?></wpd-segment>
					<wpd-segment value="post"><?php esc_html_e( 'Posts', 'desktop-mode' ); ?></wpd-segment>
					<wpd-segment value="page"><?php esc_html_e( 'Pages', 'desktop-mode' ); ?></wpd-segment>
					<?php
					// The Media segment is only useful when WP itself routes
					// attachment deletions through Trash. That gate is the
					// `MEDIA_TRASH` constant — defaults to false in core, can
					// be flipped to true from `wp-config.php`. Without it,
					// attachments permanent-delete on first click and the
					// Trash bin will never have anything in this bucket, so
					// the tab would always read "0" and confuse users.
					if ( defined( 'MEDIA_TRASH' ) && MEDIA_TRASH ) :
						?>
						<wpd-segment value="attachment"><?php esc_html_e( 'Media', 'desktop-mode' ); ?></wpd-segment>
						<?php
					endif;
					?>
					<wpd-segment value="comment"><?php esc_html_e( 'Comments', 'desktop-mode' ); ?></wpd-segment>
					<wpd-segment value="desktop"><?php esc_html_e( 'Desktop', 'desktop-mode' ); ?></wpd-segment>
				</wpd-segmented>
				<wpd-text-field
					data-desktop-mode-recycle-bin-search
					placeholder="<?php esc_attr_e( 'Search trash…', 'desktop-mode' ); ?>"
				></wpd-text-field>
			</div>
			<div class="desktop-mode-recycle-bin__toolbar-right" data-desktop-mode-recycle-bin-bulk hidden>
				<span class="desktop-mode-recycle-bin__count" data-desktop-mode-recycle-bin-count></span>
				<wpd-button variant="secondary" data-desktop-mode-recycle-bin-restore-selected>
					<span class="dashicons dashicons-image-rotate" aria-hidden="true"></span>
					<?php esc_html_e( 'Restore', 'desktop-mode' ); ?>
				</wpd-button>
				<wpd-button variant="secondary" data-desktop-mode-recycle-bin-pin-to-desktop>
					<span class="dashicons dashicons-desktop" aria-hidden="true"></span>
					<?php esc_html_e( 'Pin to desktop', 'desktop-mode' ); ?>
				</wpd-button>
				<wpd-button variant="danger" data-desktop-mode-recycle-bin-purge-selected>
					<span class="dashicons dashicons-trash" aria-hidden="true"></span>
					<?php esc_html_e( 'Delete forever', 'desktop-mode' ); ?>
				</wpd-button>
			</div>
			<div class="desktop-mode-recycle-bin__toolbar-trailing">
				<wpd-button variant="ghost" data-desktop-mode-recycle-bin-refresh title="<?php esc_attr_e( 'Refresh', 'desktop-mode' ); ?>">
					<span class="dashicons dashicons-update" aria-hidden="true"></span>
				</wpd-button>
				<wpd-button variant="danger" data-desktop-mode-recycle-bin-empty>
					<span class="dashicons dashicons-trash" aria-hidden="true"></span>
					<?php esc_html_e( 'Empty bin', 'desktop-mode' ); ?>
				</wpd-button>
			</div>
		</header>
		<div class="desktop-mode-recycle-bin__body" data-desktop-mode-recycle-bin-body>
			<wpd-table
				data-desktop-mode-recycle-bin-table
				selectable="multi"
				sticky-header
				hover
				striped
				loading
			>
				<div slot="empty" class="desktop-mode-recycle-bin__empty">
					<span class="dashicons dashicons-trash" aria-hidden="true"></span>
					<p><?php esc_html_e( 'The recycle bin is empty.', 'desktop-mode' ); ?></p>
					<p class="desktop-mode-recycle-bin__empty-hint">
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
	 * Keep the `data-desktop-mode-recycle-bin-*` hooks intact so the JS render
	 * callback can find its mount points, or rename them and update the
	 * matching constants in `src/recycle-bin/index.ts`.
	 *
	 * @param string $html Default template HTML.
	 */
	$filtered = (string) apply_filters( 'desktop_mode_recycle_bin_template_html', $html );
	echo wp_kses( $filtered, desktop_mode_native_window_allowed_html() );
}

/**
 * Whether the current user should see the recycle bin at all.
 *
 * Filterable so plugins can hide it from authors/contributors who
 * don't manage trash, or invert the gate to expose it to a custom
 * role.
 *
 * @return bool
 */
function desktop_mode_recycle_bin_user_can_use() {
	$can = current_user_can( 'edit_posts' );

	/**
	 * Filter whether the current user can see the recycle bin window.
	 *
	 * @param bool $can Default: edit_posts capability.
	 */
	return (bool) apply_filters( 'desktop_mode_recycle_bin_user_can_use', $can );
}

/**
 * Register the recycle bin window + desktop icon on `init`.
 *
 * Hooked at priority 20, after `components.php` has bootstrapped the
 * native-window registry — same timing as the code editor.
 */
function desktop_mode_recycle_bin_register_window() {
	if ( ! desktop_mode_recycle_bin_user_can_use() ) {
		return;
	}

	$window_args = array(
		'title'      => __( 'Recycle Bin', 'desktop-mode' ),
		'icon'       => 'dashicons-trash',
		'template'   => 'desktop_mode_recycle_bin_render_template',
		'script'     => 'desktop-mode-recycle-bin',
		'width'      => 880,
		'height'     => 560,
		'min_width'  => 520,
		'min_height' => 360,
		'placement'  => 'taskbar',
	);

	/**
	 * Filter the args used to register the recycle bin native window.
	 *
	 * @param array $window_args Args passed to `desktop_mode_register_window()`.
	 */
	$window_args = (array) apply_filters( 'desktop_mode_recycle_bin_window_args', $window_args );

	$registered = desktop_mode_register_window( 'desktop-mode-recycle-bin', $window_args );
	if ( is_wp_error( $registered ) ) {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( '[desktop-mode] Recycle bin window registration failed: ' . $registered->get_error_message() );
		return;
	}

	$icon_args = array(
		'title'    => __( 'Recycle Bin', 'desktop-mode' ),
		'icon'     => 'dashicons-trash',
		'window'   => 'desktop-mode-recycle-bin',
		'position' => 80,
	);

	/**
	 * Filter the args used to register the recycle bin desktop icon.
	 *
	 * @param array $icon_args Args passed to `desktop_mode_register_icon()`.
	 */
	$icon_args = (array) apply_filters( 'desktop_mode_recycle_bin_icon_args', $icon_args );

	desktop_mode_register_icon( 'desktop-mode-recycle-bin', $icon_args );
}
add_action( 'init', 'desktop_mode_recycle_bin_register_window', 20 );

/**
 * Localize REST endpoints for the JS bundle.
 *
 * Same pattern as the code editor: the bundle reads its config off
 * `window.desktopModeRecycleBinConfig` and never hardcodes URLs.
 */
function desktop_mode_recycle_bin_localize_config() {
	if ( ! desktop_mode_recycle_bin_user_can_use() ) {
		return;
	}

	wp_localize_script(
		'desktop-mode-recycle-bin',
		'desktopModeRecycleBinConfig',
		array(
			'restNonce'  => wp_create_nonce( 'wp_rest' ),
			'listUrl'    => esc_url_raw( rest_url( 'desktop-mode/v1/recycle-bin' ) ),
			'restoreUrl' => esc_url_raw( rest_url( 'desktop-mode/v1/recycle-bin/restore' ) ),
			'purgeUrl'   => esc_url_raw( rest_url( 'desktop-mode/v1/recycle-bin/purge' ) ),
			'emptyUrl'   => esc_url_raw( rest_url( 'desktop-mode/v1/recycle-bin/empty' ) ),
			'countUrl'   => esc_url_raw( rest_url( 'desktop-mode/v1/recycle-bin/count' ) ),
			'postTypes'  => desktop_mode_recycle_bin_capture_post_types(),
		)
	);

	wp_enqueue_style( 'desktop-mode-recycle-bin' );
}
add_action( 'admin_enqueue_scripts', 'desktop_mode_recycle_bin_localize_config', 30 );

/**
 * Inject the initial trash count into the shell config so the
 * dock/taskbar tile + desktop icon can paint a badge on the very
 * first paint — before the bin window has ever opened.
 *
 * @param array $config Shell config blob.
 * @return array
 */
function desktop_mode_recycle_bin_inject_shell_config( $config ) {
	if ( ! is_array( $config ) ) {
		return $config;
	}
	$config['recycleBinCount']     = desktop_mode_recycle_bin_count();
	$config['recycleBinCountUrl']  = esc_url_raw( rest_url( 'desktop-mode/v1/recycle-bin/count' ) );
	$config['recycleBinPostTypes'] = desktop_mode_recycle_bin_capture_post_types();
	return $config;
}
add_filter( 'desktop_mode_shell_config', 'desktop_mode_recycle_bin_inject_shell_config', 20 );
