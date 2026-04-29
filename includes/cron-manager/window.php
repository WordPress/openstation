<?php
/**
 * Desktop Mode - Cron Manager window + icon registration.
 *
 * @package WPDesktopMode
 * @since   0.22.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Echoes the Cron Manager window's static template.
 *
 * @since 0.22.0
 */
function wpdm_cron_manager_render_template() {
	ob_start();
	?>
	<div class="wpdm-cron-manager" data-wpdm-cron-manager-root>
		<header class="wpdm-cron-manager__toolbar">
			<div class="wpdm-cron-manager__toolbar-left">
				<wpd-text-field
					data-wpdm-cron-manager-search
					type="search"
					placeholder="<?php esc_attr_e( 'Search cron jobs...', 'desktop-mode' ); ?>"
				></wpd-text-field>
				<wpd-select
					data-wpdm-cron-manager-schedule-filter
					placeholder="<?php esc_attr_e( 'All schedules', 'desktop-mode' ); ?>"
				></wpd-select>
			</div>
			<div class="wpdm-cron-manager__feedback" data-wpdm-cron-manager-feedback role="status" aria-live="polite" hidden></div>
			<div class="wpdm-cron-manager__toolbar-right">
				<wpd-button variant="ghost" data-wpdm-cron-manager-refresh title="<?php esc_attr_e( 'Refresh', 'desktop-mode' ); ?>">
					<span class="dashicons dashicons-update" aria-hidden="true"></span>
				</wpd-button>
				<wpd-button variant="primary" data-wpdm-cron-manager-create>
					<span class="dashicons dashicons-plus-alt2" aria-hidden="true"></span>
					<?php esc_html_e( 'Create', 'desktop-mode' ); ?>
				</wpd-button>
			</div>
		</header>
		<div class="wpdm-cron-manager__content">
			<div class="wpdm-cron-manager__table-wrap">
				<wpd-table
					data-wpdm-cron-manager-table
					sticky-header
					hover
					striped
					loading
				>
					<div slot="empty" class="wpdm-cron-manager__empty">
						<span class="dashicons dashicons-clock" aria-hidden="true"></span>
						<p><?php esc_html_e( 'No cron jobs found.', 'desktop-mode' ); ?></p>
					</div>
				</wpd-table>
			</div>
			<aside class="wpdm-cron-manager__editor" data-wpdm-cron-manager-editor hidden>
				<div class="wpdm-cron-manager__editor-head">
					<h3 data-wpdm-cron-manager-editor-title><?php esc_html_e( 'Cron job', 'desktop-mode' ); ?></h3>
					<button type="button" class="wpdm-cron-manager__icon-button" data-wpdm-cron-manager-close-editor aria-label="<?php esc_attr_e( 'Close editor', 'desktop-mode' ); ?>">
						<span class="dashicons dashicons-no-alt" aria-hidden="true"></span>
					</button>
				</div>
				<div class="wpdm-cron-manager__form">
					<wpd-text-field data-wpdm-cron-manager-field="hook" label="<?php esc_attr_e( 'Hook', 'desktop-mode' ); ?>" placeholder="my_plugin_cron_hook"></wpd-text-field>
					<label class="wpdm-cron-manager__field">
						<span><?php esc_html_e( 'Next run', 'desktop-mode' ); ?></span>
						<input type="datetime-local" data-wpdm-cron-manager-field="timestamp">
					</label>
					<wpd-select data-wpdm-cron-manager-field="schedule" label="<?php esc_attr_e( 'Recurrence', 'desktop-mode' ); ?>"></wpd-select>
					<div class="wpdm-cron-manager__custom-schedule" data-wpdm-cron-manager-custom-schedule hidden>
						<wpd-text-field data-wpdm-cron-manager-field="customSlug" label="<?php esc_attr_e( 'Schedule slug', 'desktop-mode' ); ?>" placeholder="every_five_minutes"></wpd-text-field>
						<wpd-number-field data-wpdm-cron-manager-field="customInterval" label="<?php esc_attr_e( 'Interval', 'desktop-mode' ); ?>" min="1" step="1" suffix="<?php esc_attr_e( 'seconds', 'desktop-mode' ); ?>"></wpd-number-field>
						<wpd-text-field data-wpdm-cron-manager-field="customDisplay" label="<?php esc_attr_e( 'Display label', 'desktop-mode' ); ?>" placeholder="<?php esc_attr_e( 'Every 5 minutes', 'desktop-mode' ); ?>"></wpd-text-field>
					</div>
					<label class="wpdm-cron-manager__field wpdm-cron-manager__field--args">
						<span><?php esc_html_e( 'Args JSON', 'desktop-mode' ); ?></span>
						<textarea data-wpdm-cron-manager-field="args" spellcheck="false"></textarea>
					</label>
					<p class="wpdm-cron-manager__notice" data-wpdm-cron-manager-notice hidden></p>
					<div class="wpdm-cron-manager__actions">
						<wpd-button variant="danger" data-wpdm-cron-manager-delete hidden><?php esc_html_e( 'Delete', 'desktop-mode' ); ?></wpd-button>
						<span class="wpdm-cron-manager__spacer"></span>
						<wpd-button variant="secondary" data-wpdm-cron-manager-cancel><?php esc_html_e( 'Cancel', 'desktop-mode' ); ?></wpd-button>
						<wpd-button variant="primary" data-wpdm-cron-manager-save><?php esc_html_e( 'Save', 'desktop-mode' ); ?></wpd-button>
					</div>
				</div>
			</aside>
		</div>
	</div>
	<?php
	$html = (string) ob_get_clean();

	/**
	 * Filter the Cron Manager window template HTML.
	 *
	 * @since 0.22.0
	 *
	 * @param string $html Default template HTML.
	 */
	echo apply_filters( 'wp_desktop_cron_manager_template_html', $html ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
}

/**
 * Register the Cron Manager window and desktop icon.
 *
 * @since 0.22.0
 */
function wpdm_cron_manager_register_window() {
	if ( ! wpdm_cron_manager_user_can_use() ) {
		return;
	}

	$window_args = array(
		'title'        => __( 'Cron Jobs', 'desktop-mode' ),
		'icon'         => 'dashicons-clock',
		'template'     => 'wpdm_cron_manager_render_template',
		'script'       => 'wp-desktop-cron-manager',
		'width'        => 980,
		'height'       => 620,
		'min_width'    => 640,
		'min_height'   => 420,
		'placement'    => 'taskbar',
		'capabilities' => array( 'manage_options' ),
	);

	/**
	 * Filter args used to register the Cron Manager native window.
	 *
	 * @since 0.22.0
	 *
	 * @param array $window_args Args passed to `desktop_mode_register_window()`.
	 */
	$window_args = (array) apply_filters( 'wp_desktop_cron_manager_window_args', $window_args );

	$registered = desktop_mode_register_window( 'wpdm-cron-manager', $window_args );
	if ( is_wp_error( $registered ) ) {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( '[desktop-mode] Cron Manager window registration failed: ' . $registered->get_error_message() );
		return;
	}

	$icon_args = array(
		'title'        => __( 'Cron Jobs', 'desktop-mode' ),
		'icon'         => 'dashicons-clock',
		'window'       => 'wpdm-cron-manager',
		'position'     => 90,
		'capabilities' => array( 'manage_options' ),
	);

	/**
	 * Filter args used to register the Cron Manager desktop icon.
	 *
	 * @since 0.22.0
	 *
	 * @param array $icon_args Args passed to `desktop_mode_register_icon()`.
	 */
	$icon_args = (array) apply_filters( 'wp_desktop_cron_manager_icon_args', $icon_args );

	desktop_mode_register_icon( 'wpdm-cron-manager', $icon_args );
}
add_action( 'init', 'wpdm_cron_manager_register_window', 20 );

/**
 * Localize REST endpoints for the Cron Manager bundle.
 *
 * @since 0.22.0
 */
function wpdm_cron_manager_localize_config() {
	if ( ! wpdm_cron_manager_user_can_use() ) {
		return;
	}

	wp_localize_script(
		'wp-desktop-cron-manager',
		'wpDesktopCronManagerConfig',
		array(
			'restNonce'    => wp_create_nonce( 'wp_rest' ),
			'eventsUrl'    => esc_url_raw( rest_url( 'wp-desktop/v1/cron/events' ) ),
			'schedulesUrl' => esc_url_raw( rest_url( 'wp-desktop/v1/cron/schedules' ) ),
			'runNowUrl'    => esc_url_raw( rest_url( 'wp-desktop/v1/cron/events/run-now' ) ),
		)
	);

	wp_enqueue_style( 'wp-desktop-cron-manager' );
}
add_action( 'admin_enqueue_scripts', 'wpdm_cron_manager_localize_config', 30 );
