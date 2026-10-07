<?php

defined( 'ABSPATH' ) || exit;

function openstation_cron_manager_register_assets() {
	wp_register_style(
		'desktop-mode-cron-manager',
		OPENSTATION_CRON_MANAGER_URL . 'assets/css/cron-manager.css',
		array( 'os-variables', 'dashicons' ),
		OPENSTATION_CRON_MANAGER_VERSION
	);

	$bundle_url = add_query_arg(
		array( 'action' => 'openstation_cron_bundle' ),
		admin_url( 'admin-ajax.php' )
	);

	wp_register_script(
		'desktop-mode-cron-manager',
		$bundle_url,

		array( 'wp-i18n', 'openstation' ),
		OPENSTATION_CRON_MANAGER_VERSION,
		true
	);
}

function openstation_cron_manager_serve_bundle() {
	if ( ! openstation_cron_manager_user_can_use() ) {
		status_header( 403 );
		exit;
	}

	$base = trailingslashit( rest_url( OPENSTATION_CRON_MANAGER_REST_NAMESPACE ) );

	$config = array(
		'restNonce'    => wp_create_nonce( 'wp_rest' ),
		'eventsUrl'    => esc_url_raw( $base . 'events' ),
		'schedulesUrl' => esc_url_raw( $base . 'schedules' ),
		'runNowUrl'    => esc_url_raw( $base . 'events/run-now' ),
	);

	nocache_headers();
	header( 'Content-Type: application/javascript; charset=utf-8' );
	header( 'Vary: Cookie' );

	echo 'window.openStationCronManagerConfig = ' . wp_json_encode( $config ) . ';' . "\n";

	$suffix = ( defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG ) ? '' : '.min';
	$bundle = OPENSTATION_CRON_MANAGER_DIR . 'assets/js/cron-manager' . $suffix . '.js';
	if ( ! file_exists( $bundle ) ) {
		$bundle = OPENSTATION_CRON_MANAGER_DIR . 'assets/js/cron-manager.js';
	}
	if ( file_exists( $bundle ) ) {
		readfile( $bundle );
	}

	echo "\n" . '(function(){var r=window.openStationNativeWindows=window.openStationNativeWindows||{};var orig=r["wpdm-cron-manager"];if(!orig){return;}r["wpdm-cron-manager"]=function(body){if(window.customElements&&typeof customElements.whenDefined==="function"){customElements.whenDefined("os-table").then(function(){orig(body);});}else{orig(body);}};})();';

	exit;
}

function openstation_cron_manager_render_template() {
	ob_start();
	?>
	<div class="wpdm-cron-manager" data-osm-cron-manager-root>
		<header class="osm-cron-manager__toolbar">
			<div class="osm-cron-manager__toolbar-left">
				<os-text-field
					data-osm-cron-manager-search
					type="search"
					placeholder="<?php esc_attr_e( 'Search cron jobs...', 'desktop-mode-cron-manager' ); ?>"
				></os-text-field>
				<os-select
					data-osm-cron-manager-schedule-filter
					placeholder="<?php esc_attr_e( 'All schedules', 'desktop-mode-cron-manager' ); ?>"
				></os-select>
			</div>
			<div class="osm-cron-manager__feedback" data-osm-cron-manager-feedback role="status" aria-live="polite" hidden></div>
			<div class="osm-cron-manager__toolbar-right">
				<os-button variant="ghost" data-osm-cron-manager-refresh title="<?php esc_attr_e( 'Refresh', 'desktop-mode-cron-manager' ); ?>">
					<span class="dashicons dashicons-update" aria-hidden="true"></span>
				</os-button>
				<os-button variant="primary" data-osm-cron-manager-create>
					<span class="dashicons dashicons-plus-alt2" aria-hidden="true"></span>
					<?php esc_html_e( 'Create', 'desktop-mode-cron-manager' ); ?>
				</os-button>
			</div>
		</header>
		<div class="osm-cron-manager__content">
			<div class="osm-cron-manager__table-wrap">
				<os-table
					data-osm-cron-manager-table
					sticky-header
					hover
					striped
					loading
				>
					<div slot="empty" class="osm-cron-manager__empty">
						<span class="dashicons dashicons-clock" aria-hidden="true"></span>
						<p><?php esc_html_e( 'No cron jobs found.', 'desktop-mode-cron-manager' ); ?></p>
					</div>
				</os-table>
			</div>
			<aside class="osm-cron-manager__editor" data-osm-cron-manager-editor hidden>
				<div class="osm-cron-manager__editor-head">
					<h3 data-osm-cron-manager-editor-title><?php esc_html_e( 'Cron job', 'desktop-mode-cron-manager' ); ?></h3>
					<button type="button" class="osm-cron-manager__icon-button" data-osm-cron-manager-close-editor aria-label="<?php esc_attr_e( 'Close editor', 'desktop-mode-cron-manager' ); ?>">
						<span class="dashicons dashicons-no-alt" aria-hidden="true"></span>
					</button>
				</div>
				<div class="osm-cron-manager__form">
					<os-text-field data-osm-cron-manager-field="hook" label="<?php esc_attr_e( 'Hook', 'desktop-mode-cron-manager' ); ?>" placeholder="my_plugin_cron_hook"></os-text-field>
					<label class="osm-cron-manager__field">
						<span><?php esc_html_e( 'Next run', 'desktop-mode-cron-manager' ); ?></span>
						<input type="datetime-local" data-osm-cron-manager-field="timestamp">
					</label>
					<os-select data-osm-cron-manager-field="schedule" label="<?php esc_attr_e( 'Recurrence', 'desktop-mode-cron-manager' ); ?>"></os-select>
					<div class="osm-cron-manager__custom-schedule" data-osm-cron-manager-custom-schedule hidden>
						<os-text-field data-osm-cron-manager-field="customSlug" label="<?php esc_attr_e( 'Schedule slug', 'desktop-mode-cron-manager' ); ?>" placeholder="every_five_minutes"></os-text-field>
						<os-number-field data-osm-cron-manager-field="customInterval" label="<?php esc_attr_e( 'Interval', 'desktop-mode-cron-manager' ); ?>" min="1" step="1" suffix="<?php esc_attr_e( 'seconds', 'desktop-mode-cron-manager' ); ?>"></os-number-field>
						<os-text-field data-osm-cron-manager-field="customDisplay" label="<?php esc_attr_e( 'Display label', 'desktop-mode-cron-manager' ); ?>" placeholder="<?php esc_attr_e( 'Every 5 minutes', 'desktop-mode-cron-manager' ); ?>"></os-text-field>
					</div>
					<label class="osm-cron-manager__field osm-cron-manager__field--args">
						<span><?php esc_html_e( 'Args JSON', 'desktop-mode-cron-manager' ); ?></span>
						<textarea data-osm-cron-manager-field="args" spellcheck="false"></textarea>
					</label>
					<p class="osm-cron-manager__notice" data-osm-cron-manager-notice hidden></p>
					<div class="osm-cron-manager__actions">
						<os-button variant="danger" data-osm-cron-manager-delete hidden><?php esc_html_e( 'Delete', 'desktop-mode-cron-manager' ); ?></os-button>
						<span class="osm-cron-manager__spacer"></span>
						<os-button variant="secondary" data-osm-cron-manager-cancel><?php esc_html_e( 'Cancel', 'desktop-mode-cron-manager' ); ?></os-button>
						<os-button variant="primary" data-osm-cron-manager-save><?php esc_html_e( 'Save', 'desktop-mode-cron-manager' ); ?></os-button>
					</div>
				</div>
			</aside>
		</div>
	</div>
	<?php
	$html = (string) ob_get_clean();

	echo apply_filters( 'openstation_cron_manager_template_html', $html );
}

function openstation_cron_manager_register_window() {
	if ( ! openstation_cron_manager_user_can_use() ) {
		return;
	}

	$window_args = array(
		'title'        => __( 'Cron Jobs', 'desktop-mode-cron-manager' ),
		'icon'         => 'dashicons-clock',
		'template'     => 'openstation_cron_manager_render_template',
		'script'       => 'desktop-mode-cron-manager',
		'width'        => 980,
		'height'       => 620,
		'min_width'    => 640,
		'min_height'   => 420,
		'placement'    => 'dock',
		'capabilities' => array( 'manage_options' ),
	);

	$window_args = (array) apply_filters( 'openstation_cron_manager_window_args', $window_args );

	$registered = openstation_register_window( 'wpdm-cron-manager', $window_args );
	if ( is_wp_error( $registered ) ) {

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

	$icon_args = (array) apply_filters( 'openstation_cron_manager_icon_args', $icon_args );

	openstation_register_icon( 'wpdm-cron-manager', $icon_args );
}

function openstation_cron_manager_enqueue_style() {
	if ( ! openstation_cron_manager_user_can_use() ) {
		return;
	}
	wp_enqueue_style( 'desktop-mode-cron-manager' );
}

function openstation_cron_manager_maybe_init_ui() {
	if ( ! function_exists( 'openstation_register_window' ) ) {
		return;
	}

	add_action( 'init', 'openstation_cron_manager_register_assets', 20 );
	add_action( 'init', 'openstation_cron_manager_register_window', 20 );
	add_action( 'admin_enqueue_scripts', 'openstation_cron_manager_enqueue_style', 30 );
}

add_action( 'wp_ajax_openstation_cron_bundle', 'openstation_cron_manager_serve_bundle' );
add_action( 'plugins_loaded', 'openstation_cron_manager_maybe_init_ui', 20 );
