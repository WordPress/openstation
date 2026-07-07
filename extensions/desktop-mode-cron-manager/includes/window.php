<?php
/**
 * Cron Manager window, icon, and asset registration.
 *
 * @package DesktopModeCronManager
 * @since   0.6.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the script + style handles backing the Cron Manager window.
 *
 * The script is served through `admin-ajax.php?action=desktop_mode_cron_bundle`
 * — the response body starts with the config assignment, then streams
 * the prebuilt bundle, then closes with the `customElements.whenDefined`
 * wrapper. Everything the bundle needs is in a single HTTP response,
 * so there is no `wp_print_scripts` lifecycle to depend on, no
 * `wp_localize_script` / `wp_add_inline_script` data that can be
 * dropped on the lazy-load path, and no admin-template hook that has
 * to fire on the consuming user's environment.
 *
 * @since 0.6.0
 */
function desktop_mode_cron_manager_register_assets() {
	wp_register_style(
		'desktop-mode-cron-manager',
		DESKTOP_MODE_CRON_MANAGER_URL . 'assets/css/cron-manager.css',
		array( 'desktop-mode-variables', 'dashicons' ),
		DESKTOP_MODE_CRON_MANAGER_VERSION
	);

	$bundle_url = add_query_arg(
		array( 'action' => 'desktop_mode_cron_bundle' ),
		admin_url( 'admin-ajax.php' )
	);

	wp_register_script(
		'desktop-mode-cron-manager',
		$bundle_url,
		// `desktop-mode` — the prebuilt bundle reaches into the
		// `<wpd-table>` / `<wpd-select>` / `<wpd-text-field>` setters
		// the moment the window opens, so the custom-element classes
		// must be defined first.
		array( 'wp-i18n', 'desktop-mode' ),
		DESKTOP_MODE_CRON_MANAGER_VERSION,
		true
	);
}

/**
 * Serve the Cron Manager bundle with the REST config baked in.
 *
 * Hooked on `wp_ajax_desktop_mode_cron_bundle`. Outputs:
 *
 *  1. `window.wpDesktopCronManagerConfig = {...};` — REST URLs + nonce.
 *  2. The prebuilt cron-manager bundle (min when not SCRIPT_DEBUG).
 *  3. A `customElements.whenDefined('wpd-table')` wrapper around the
 *     render callback the bundle just registered, defending against
 *     custom-element upgrade races on the first window-open.
 *
 * Cache headers are set to per-user, no-store so different sessions
 * never share a response (the response carries a session-bound nonce).
 *
 * The JS-side global name (`wpDesktopCronManagerConfig`) and the native
 * window id (`wpdm-cron-manager`) are kept on the legacy spelling
 * because the prebuilt bundle hardcodes them — renaming would require
 * rebuilding from source.
 *
 * @since 0.6.0
 */
function desktop_mode_cron_manager_serve_bundle() {
	if ( ! desktop_mode_cron_manager_user_can_use() ) {
		status_header( 403 );
		exit;
	}

	$base = trailingslashit( rest_url( DESKTOP_MODE_CRON_MANAGER_REST_NAMESPACE ) );

	$config = array(
		'restNonce'    => wp_create_nonce( 'wp_rest' ),
		'eventsUrl'    => esc_url_raw( $base . 'events' ),
		'schedulesUrl' => esc_url_raw( $base . 'schedules' ),
		'runNowUrl'    => esc_url_raw( $base . 'events/run-now' ),
	);

	nocache_headers();
	header( 'Content-Type: application/javascript; charset=utf-8' );
	header( 'Vary: Cookie' );

	echo '/* desktop-mode-cron-manager config + bundle */' . "\n";
	echo 'window.wpDesktopCronManagerConfig = ' . wp_json_encode( $config ) . ';' . "\n";

	$suffix = ( defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG ) ? '' : '.min';
	$bundle = DESKTOP_MODE_CRON_MANAGER_DIR . 'assets/js/cron-manager' . $suffix . '.js';
	if ( ! file_exists( $bundle ) ) {
		$bundle = DESKTOP_MODE_CRON_MANAGER_DIR . 'assets/js/cron-manager.js';
	}
	if ( file_exists( $bundle ) ) {
		readfile( $bundle ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_readfile
	}

	echo "\n" . '(function(){var r=window.wpDesktopNativeWindows=window.wpDesktopNativeWindows||{};var orig=r["wpdm-cron-manager"];if(!orig){return;}r["wpdm-cron-manager"]=function(body){if(window.customElements&&typeof customElements.whenDefined==="function"){customElements.whenDefined("wpd-table").then(function(){orig(body);});}else{orig(body);}};})();';

	exit;
}

/**
 * Echoes the Cron Manager window's static template.
 *
 * The `wpdm-cron-manager` class names and `data-wpdm-cron-manager-*`
 * attributes are intentionally kept on the legacy `wpdm-` spelling —
 * the prebuilt JS bundle queries them by exactly those selectors and
 * cannot be rebuilt from this directory.
 *
 * @since 0.6.0
 */
function desktop_mode_cron_manager_render_template() {
	ob_start();
	?>
	<div class="wpdm-cron-manager" data-wpdm-cron-manager-root>
		<header class="wpdm-cron-manager__toolbar">
			<div class="wpdm-cron-manager__toolbar-left">
				<wpd-text-field
					data-wpdm-cron-manager-search
					type="search"
					placeholder="<?php esc_attr_e( 'Search cron jobs...', 'desktop-mode-cron-manager' ); ?>"
				></wpd-text-field>
				<wpd-select
					data-wpdm-cron-manager-schedule-filter
					placeholder="<?php esc_attr_e( 'All schedules', 'desktop-mode-cron-manager' ); ?>"
				></wpd-select>
			</div>
			<div class="wpdm-cron-manager__feedback" data-wpdm-cron-manager-feedback role="status" aria-live="polite" hidden></div>
			<div class="wpdm-cron-manager__toolbar-right">
				<wpd-button variant="ghost" data-wpdm-cron-manager-refresh title="<?php esc_attr_e( 'Refresh', 'desktop-mode-cron-manager' ); ?>">
					<span class="dashicons dashicons-update" aria-hidden="true"></span>
				</wpd-button>
				<wpd-button variant="primary" data-wpdm-cron-manager-create>
					<span class="dashicons dashicons-plus-alt2" aria-hidden="true"></span>
					<?php esc_html_e( 'Create', 'desktop-mode-cron-manager' ); ?>
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
						<p><?php esc_html_e( 'No cron jobs found.', 'desktop-mode-cron-manager' ); ?></p>
					</div>
				</wpd-table>
			</div>
			<aside class="wpdm-cron-manager__editor" data-wpdm-cron-manager-editor hidden>
				<div class="wpdm-cron-manager__editor-head">
					<h3 data-wpdm-cron-manager-editor-title><?php esc_html_e( 'Cron job', 'desktop-mode-cron-manager' ); ?></h3>
					<button type="button" class="wpdm-cron-manager__icon-button" data-wpdm-cron-manager-close-editor aria-label="<?php esc_attr_e( 'Close editor', 'desktop-mode-cron-manager' ); ?>">
						<span class="dashicons dashicons-no-alt" aria-hidden="true"></span>
					</button>
				</div>
				<div class="wpdm-cron-manager__form">
					<wpd-text-field data-wpdm-cron-manager-field="hook" label="<?php esc_attr_e( 'Hook', 'desktop-mode-cron-manager' ); ?>" placeholder="my_plugin_cron_hook"></wpd-text-field>
					<label class="wpdm-cron-manager__field">
						<span><?php esc_html_e( 'Next run', 'desktop-mode-cron-manager' ); ?></span>
						<input type="datetime-local" data-wpdm-cron-manager-field="timestamp">
					</label>
					<wpd-select data-wpdm-cron-manager-field="schedule" label="<?php esc_attr_e( 'Recurrence', 'desktop-mode-cron-manager' ); ?>"></wpd-select>
					<div class="wpdm-cron-manager__custom-schedule" data-wpdm-cron-manager-custom-schedule hidden>
						<wpd-text-field data-wpdm-cron-manager-field="customSlug" label="<?php esc_attr_e( 'Schedule slug', 'desktop-mode-cron-manager' ); ?>" placeholder="every_five_minutes"></wpd-text-field>
						<wpd-number-field data-wpdm-cron-manager-field="customInterval" label="<?php esc_attr_e( 'Interval', 'desktop-mode-cron-manager' ); ?>" min="1" step="1" suffix="<?php esc_attr_e( 'seconds', 'desktop-mode-cron-manager' ); ?>"></wpd-number-field>
						<wpd-text-field data-wpdm-cron-manager-field="customDisplay" label="<?php esc_attr_e( 'Display label', 'desktop-mode-cron-manager' ); ?>" placeholder="<?php esc_attr_e( 'Every 5 minutes', 'desktop-mode-cron-manager' ); ?>"></wpd-text-field>
					</div>
					<label class="wpdm-cron-manager__field wpdm-cron-manager__field--args">
						<span><?php esc_html_e( 'Args JSON', 'desktop-mode-cron-manager' ); ?></span>
						<textarea data-wpdm-cron-manager-field="args" spellcheck="false"></textarea>
					</label>
					<p class="wpdm-cron-manager__notice" data-wpdm-cron-manager-notice hidden></p>
					<div class="wpdm-cron-manager__actions">
						<wpd-button variant="danger" data-wpdm-cron-manager-delete hidden><?php esc_html_e( 'Delete', 'desktop-mode-cron-manager' ); ?></wpd-button>
						<span class="wpdm-cron-manager__spacer"></span>
						<wpd-button variant="secondary" data-wpdm-cron-manager-cancel><?php esc_html_e( 'Cancel', 'desktop-mode-cron-manager' ); ?></wpd-button>
						<wpd-button variant="primary" data-wpdm-cron-manager-save><?php esc_html_e( 'Save', 'desktop-mode-cron-manager' ); ?></wpd-button>
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
	 * @since 0.6.0
	 *
	 * @param string $html Default template HTML.
	 */
	echo apply_filters( 'desktop_mode_cron_manager_template_html', $html ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
}

/**
 * Register the Cron Manager window and desktop icon.
 *
 * @since 0.6.0
 */
function desktop_mode_cron_manager_register_window() {
	if ( ! desktop_mode_cron_manager_user_can_use() ) {
		return;
	}

	$window_args = array(
		'title'        => __( 'Cron Jobs', 'desktop-mode-cron-manager' ),
		'icon'         => 'dashicons-clock',
		'template'     => 'desktop_mode_cron_manager_render_template',
		'script'       => 'desktop-mode-cron-manager',
		'width'        => 980,
		'height'       => 620,
		'min_width'    => 640,
		'min_height'   => 420,
		'placement'    => 'dock',
		'capabilities' => array( 'manage_options' ),
	);

	/**
	 * Filter args used to register the Cron Manager native window.
	 *
	 * @since 0.6.0
	 *
	 * @param array $window_args Args passed to `desktop_mode_register_window()`.
	 */
	$window_args = (array) apply_filters( 'desktop_mode_cron_manager_window_args', $window_args );

	$registered = desktop_mode_register_window( 'wpdm-cron-manager', $window_args );
	if ( is_wp_error( $registered ) ) {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( '[desktop-mode-cron-manager] window registration failed: ' . $registered->get_error_message() );
		return;
	}

	$icon_args = array(
		'title'        => __( 'Cron Jobs', 'desktop-mode-cron-manager' ),
		'icon'         => 'dashicons-clock',
		'window'       => 'wpdm-cron-manager',
		'position'     => 90,
		'capabilities' => array( 'manage_options' ),
	);

	/**
	 * Filter args used to register the Cron Manager desktop icon.
	 *
	 * @since 0.6.0
	 *
	 * @param array $icon_args Args passed to `desktop_mode_register_icon()`.
	 */
	$icon_args = (array) apply_filters( 'desktop_mode_cron_manager_icon_args', $icon_args );

	desktop_mode_register_icon( 'wpdm-cron-manager', $icon_args );
}

/**
 * Enqueue the Cron Manager stylesheet for any desktop-mode admin page.
 *
 * @since 0.6.0
 */
function desktop_mode_cron_manager_enqueue_style() {
	if ( ! desktop_mode_cron_manager_user_can_use() ) {
		return;
	}
	wp_enqueue_style( 'desktop-mode-cron-manager' );
}

/**
 * Wire the UI surface to Desktop Mode once we know it's loaded.
 *
 * No-ops cleanly when Desktop Mode is missing — REST routes and the
 * `cron_schedules` filter (registered in store.php) keep working so
 * scheduled events that depend on the custom intervals don't drop.
 *
 * @since 0.6.0
 */
function desktop_mode_cron_manager_maybe_init_ui() {
	if ( ! function_exists( 'desktop_mode_register_window' ) ) {
		return;
	}

	add_action( 'init', 'desktop_mode_cron_manager_register_assets', 20 );
	add_action( 'init', 'desktop_mode_cron_manager_register_window', 20 );
	add_action( 'admin_enqueue_scripts', 'desktop_mode_cron_manager_enqueue_style', 30 );
}

// The bundle endpoint is wired unconditionally so the config is
// reachable even when the consumer's page-render hooks misbehave —
// `desktop_mode_cron_manager_user_can_use()` is the actual auth gate
// inside the handler.
add_action( 'wp_ajax_desktop_mode_cron_bundle', 'desktop_mode_cron_manager_serve_bundle' );
add_action( 'plugins_loaded', 'desktop_mode_cron_manager_maybe_init_ui', 20 );
