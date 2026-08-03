<?php
/**
 * OpenStation — Recycle Bin: window + icon registration.
 *
 * Native window with id `desktop-mode-recycle-bin`, pinned to the taskbar with a
 * matching wallpaper icon. Like the code editor, the template body is a
 * static skeleton that the JS bundle enhances on first open — the table
 * is populated from the REST list endpoint at render time.
 *
 * Both registrations are filterable via the standard
 * `open_station_recycle_bin_window_args` / `open_station_recycle_bin_icon_args`
 * filters so a plugin can swap the icon, change the dimensions, or
 * restrict who sees the bin without touching this file.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Echoes the recycle bin window's template body.
 *
 * The shell wraps this in `<template id="os-native-window-desktop-mode-recycle-bin">`
 * and clones it into the window body BEFORE the JS render callback runs.
 * The `data-os-recycle-bin-*` hooks below are the contract the JS
 * relies on — keep them intact (or rename via the filter) when
 * customizing the layout.
 */
function open_station_recycle_bin_render_template() {
	ob_start();
	?>
	<div class="desktop-mode-recycle-bin" data-os-recycle-bin-root>
		<header class="os-recycle-bin__toolbar" data-os-recycle-bin-toolbar>
			<div class="os-recycle-bin__toolbar-left">
				<os-segmented data-os-recycle-bin-filter>
					<os-segment value="" selected><?php esc_html_e( 'All', 'desktop-mode' ); ?></os-segment>
					<os-segment value="post"><?php esc_html_e( 'Posts', 'desktop-mode' ); ?></os-segment>
					<os-segment value="page"><?php esc_html_e( 'Pages', 'desktop-mode' ); ?></os-segment>
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
						<os-segment value="attachment"><?php esc_html_e( 'Media', 'desktop-mode' ); ?></os-segment>
						<?php
					endif;
					?>
					<os-segment value="comment"><?php esc_html_e( 'Comments', 'desktop-mode' ); ?></os-segment>
					<os-segment value="desktop"><?php esc_html_e( 'Desktop', 'desktop-mode' ); ?></os-segment>
				</os-segmented>
				<os-text-field
					data-os-recycle-bin-search
					placeholder="<?php esc_attr_e( 'Search trash…', 'desktop-mode' ); ?>"
				></os-text-field>
			</div>
			<div class="os-recycle-bin__toolbar-right" data-os-recycle-bin-bulk hidden>
				<span class="os-recycle-bin__count" data-os-recycle-bin-count></span>
				<os-button variant="secondary" data-os-recycle-bin-restore-selected>
					<span class="dashicons dashicons-image-rotate" aria-hidden="true"></span>
					<?php esc_html_e( 'Restore', 'desktop-mode' ); ?>
				</os-button>
				<os-button variant="secondary" data-os-recycle-bin-pin-to-desktop>
					<span class="dashicons dashicons-desktop" aria-hidden="true"></span>
					<?php esc_html_e( 'Pin to desktop', 'desktop-mode' ); ?>
				</os-button>
				<os-button variant="danger" data-os-recycle-bin-purge-selected>
					<span class="dashicons dashicons-trash" aria-hidden="true"></span>
					<?php esc_html_e( 'Delete forever', 'desktop-mode' ); ?>
				</os-button>
			</div>
			<div class="os-recycle-bin__toolbar-trailing">
				<os-button variant="ghost" data-os-recycle-bin-refresh title="<?php esc_attr_e( 'Refresh', 'desktop-mode' ); ?>">
					<span class="dashicons dashicons-update" aria-hidden="true"></span>
				</os-button>
				<os-button variant="danger" data-os-recycle-bin-empty>
					<span class="dashicons dashicons-trash" aria-hidden="true"></span>
					<?php esc_html_e( 'Empty Trash', 'desktop-mode' ); ?>
				</os-button>
			</div>
		</header>
		<div class="os-recycle-bin__body" data-os-recycle-bin-body>
			<os-table
				data-os-recycle-bin-table
				selectable="multi"
				sticky-header
				hover
				striped
				loading
			>
				<div slot="empty" class="os-recycle-bin__empty">
					<span class="dashicons dashicons-trash" aria-hidden="true"></span>
					<p><?php esc_html_e( 'The Trash is empty.', 'desktop-mode' ); ?></p>
					<p class="os-recycle-bin__empty-hint">
						<?php esc_html_e( 'Deleted posts, pages, and media show up here. Restoring puts them back where they were.', 'desktop-mode' ); ?>
					</p>
				</div>
			</os-table>
		</div>
	</div>
	<?php
	$html = (string) ob_get_clean();

	/**
	 * Filter the recycle bin window's template HTML.
	 *
	 * Keep the `data-os-recycle-bin-*` hooks intact so the JS render
	 * callback can find its mount points, or rename them and update the
	 * matching constants in `src/recycle-bin/index.ts`.
	 *
	 * @param string $html Default template HTML.
	 */
	$filtered = (string) apply_filters( 'open_station_recycle_bin_template_html', $html );
	echo wp_kses( $filtered, open_station_native_window_allowed_html() );
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
function open_station_recycle_bin_user_can_use() {
	$can = current_user_can( 'edit_posts' );

	/**
	 * Filter whether the current user can see the recycle bin window.
	 *
	 * @param bool $can Default: edit_posts capability.
	 */
	return (bool) apply_filters( 'open_station_recycle_bin_user_can_use', $can );
}

/**
 * Register the recycle bin window + desktop icon on `init`.
 *
 * Hooked at priority 20, after `components.php` has bootstrapped the
 * native-window registry — same timing as the code editor.
 */
function open_station_recycle_bin_register_window() {
	if ( ! open_station_recycle_bin_user_can_use() ) {
		return;
	}

	$window_args = array(
		'title'      => __( 'Trash', 'desktop-mode' ),
		'icon'       => 'dashicons-trash',
		'template'   => 'open_station_recycle_bin_render_template',
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
	 * @param array $window_args Args passed to `open_station_register_window()`.
	 */
	$window_args = (array) apply_filters( 'open_station_recycle_bin_window_args', $window_args );

	$registered = open_station_register_window( 'desktop-mode-recycle-bin', $window_args );
	if ( is_wp_error( $registered ) ) {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( '[openstation] Recycle bin window registration failed: ' . $registered->get_error_message() );
		return;
	}

	$icon_args = array(
		'title'    => __( 'Trash', 'desktop-mode' ),
		'icon'     => 'dashicons-trash',
		'window'   => 'desktop-mode-recycle-bin',
		'position' => 80,
	);

	/**
	 * Filter the args used to register the recycle bin desktop icon.
	 *
	 * @param array $icon_args Args passed to `open_station_register_icon()`.
	 */
	$icon_args = (array) apply_filters( 'open_station_recycle_bin_icon_args', $icon_args );

	open_station_register_icon( 'desktop-mode-recycle-bin', $icon_args );
}
add_action( 'init', 'open_station_recycle_bin_register_window', 20 );

/**
 * Localize REST endpoints for the JS bundle.
 *
 * Same pattern as the code editor: the bundle reads its config off
 * `window.openStationRecycleBinConfig` and never hardcodes URLs.
 */
function open_station_recycle_bin_localize_config() {
	if ( ! open_station_recycle_bin_user_can_use() ) {
		return;
	}

	wp_localize_script(
		'desktop-mode-recycle-bin',
		'openStationRecycleBinConfig',
		array(
			'restNonce'  => wp_create_nonce( 'wp_rest' ),
			'listUrl'    => esc_url_raw( rest_url( 'desktop-mode/v1/recycle-bin' ) ),
			'restoreUrl' => esc_url_raw( rest_url( 'desktop-mode/v1/recycle-bin/restore' ) ),
			'purgeUrl'   => esc_url_raw( rest_url( 'desktop-mode/v1/recycle-bin/purge' ) ),
			'emptyUrl'   => esc_url_raw( rest_url( 'desktop-mode/v1/recycle-bin/empty' ) ),
			'countUrl'   => esc_url_raw( rest_url( 'desktop-mode/v1/recycle-bin/count' ) ),
			'postTypes'  => open_station_recycle_bin_capture_post_types(),
		)
	);

	wp_enqueue_style( 'desktop-mode-recycle-bin' );
}
add_action( 'admin_enqueue_scripts', 'open_station_recycle_bin_localize_config', 30 );

/**
 * Inject the initial trash count into the shell config so the
 * dock/taskbar tile + desktop icon can paint a badge on the very
 * first paint — before the bin window has ever opened.
 *
 * @param array $config Shell config blob.
 * @return array
 */
function open_station_recycle_bin_inject_shell_config( $config ) {
	if ( ! is_array( $config ) ) {
		return $config;
	}
	$config['recycleBinCount']     = open_station_recycle_bin_count();
	$config['recycleBinCountUrl']  = esc_url_raw( rest_url( 'desktop-mode/v1/recycle-bin/count' ) );
	$config['recycleBinPostTypes'] = open_station_recycle_bin_capture_post_types();
	return $config;
}
add_filter( 'open_station_shell_config', 'open_station_recycle_bin_inject_shell_config', 20 );
