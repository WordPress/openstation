<?php
/**
 * OpenStation — Native Plugins Window: registration + template.
 *
 * Native window registered with `placement: 'none'` — the entry
 * point is the existing Plugins dock tile (built from WordPress's
 * `$menu`), which the JS-side URL remap rewrites to open this window
 * when `nativePluginsEnabled` is on.
 *
 * The shell wraps the template echoed by
 * `openstation_plugins_window_render_template()` in
 * `<template id="os-native-window-desktop-mode-plugins">`
 * and clones it into the window body BEFORE the JS render callback
 * fires. The `data-os-plugins-*` hooks below are the
 * contract the JS relies on — keep them intact (or rename via the
 * filter) when customizing the layout.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Echoes the native Plugins window's template body.
 */
function openstation_plugins_window_render_template() {
	$caps = openstation_plugins_window_caps();

	ob_start();
	?>
	<div class="desktop-mode-plugins" data-os-plugins-root>
		<os-tabs value="installed" class="os-plugins__tabs" data-os-plugins-tabs>
			<os-tab value="installed"><?php esc_html_e( 'Installed', 'desktop-mode' ); ?></os-tab>
			<?php if ( ! empty( $caps['install'] ) ) : ?>
				<os-tab value="browse"><?php esc_html_e( 'Add Plugin', 'desktop-mode' ); ?></os-tab>
				<os-tab value="featured"><?php esc_html_e( 'OpenStation plugins', 'desktop-mode' ); ?></os-tab>
			<?php endif; ?>
		</os-tabs>

		<os-tabpanel for="installed" class="os-plugins__panel">
			<div class="os-plugins__installed" data-os-plugins-installed-host>
				<?php
				/*
				 * JS bundle paints the toolbar + <os-table> here.
				 * Empty host — first-frame shows the table's own
				 * loading skeleton.
				 */
				?>
			</div>
		</os-tabpanel>

		<?php if ( ! empty( $caps['install'] ) ) : ?>
			<os-tabpanel for="browse" class="os-plugins__panel">
				<div class="os-plugins__browse" data-os-plugins-browse-host>
					<?php
					/*
					 * JS bundle paints the search + segmented filter
					 * + Upload button + <os-grid> of cards here.
					 */
					?>
				</div>
			</os-tabpanel>
			<os-tabpanel for="featured" class="os-plugins__panel">
				<div class="os-plugins__featured" data-os-plugins-featured-host>
					<?php
					/*
					 * JS bundle paints an intro blurb + gallery of
					 * plugins that integrate with OpenStation here.
					 */
					?>
				</div>
			</os-tabpanel>
		<?php endif; ?>

		<?php
		/*
		 * Detail flyout — populated lazily when a card is clicked.
		 * Lives at the root of the template so it can slide over the
		 * full window body, not just one tab panel.
		 */
		?>
		<os-flyout
			placement="end"
			data-os-plugins-flyout
			aria-label="<?php esc_attr_e( 'Plugin details', 'desktop-mode' ); ?>"
		></os-flyout>
	</div>
	<?php
	$html = (string) ob_get_clean();

	/**
	 * Filter the native Plugins window's template HTML.
	 *
	 * Keep the `data-os-plugins-*` hooks intact so the JS
	 * render callback can find its mount points, or rename them and
	 * update the matching constants in `src/plugins-window/index.ts`.
	 *
	 * @param string $html Default template HTML.
	 */
	$filtered = (string) apply_filters( 'openstation_plugins_window_template_html', $html );

	if ( function_exists( 'openstation_kses_native_window_template' ) ) {
		echo openstation_kses_native_window_template( $filtered ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- helper kses-escapes.
	} else {
		echo wp_kses( $filtered, wp_kses_allowed_html( 'post' ) );
	}
}

/**
 * Register the native Plugins window on `init` (priority 20, after
 * `components.php` has bootstrapped the registry).
 *
 * Cap-only gate so that flipping the opt-in mid-session doesn't
 * require an F5. The opt-in is a runtime check on the JS-side remap
 * (`enabled: ( s ) => s.nativePluginsEnabled === true` in
 * `src/desktop.ts`).
 */
function openstation_plugins_window_register_window() {
	if ( ! openstation_plugins_window_user_can_register() ) {
		return;
	}

	$caps = openstation_plugins_window_caps();

	$window_args = array(
		'title'      => __( 'Plugins', 'desktop-mode' ),
		'icon'       => 'dashicons-admin-plugins',
		'template'   => 'openstation_plugins_window_render_template',
		'script'     => 'os-plugins-window',
		'style'      => 'os-plugins-window',
		'width'      => 1180,
		'height'     => 760,
		'min_width'  => 760,
		'min_height' => 480,
		// `'none'` — no dock or wallpaper tile from this registration.
		// The Plugins dock tile lives in WordPress's `$menu` and the
		// JS-side URL remap routes its click to `openById` here when
		// the opt-in is on. A separate tile would be a duplicate
		// entry point.
		'placement'  => 'none',
		'config'     => array(
			'restRoot'           => esc_url_raw( rest_url() ),
			'restNonce'          => wp_create_nonce( 'wp_rest' ),
			// Core's REST controller for installed plugins.
			'pluginsUrl'         => esc_url_raw( rest_url( 'wp/v2/plugins' ) ),
			// `admin-ajax.php` is the canonical home for our
			// install/upload/browse/info/reviews handlers — Plugin Check
			// rejects calls to admin-only classes from REST callbacks.
			'ajaxUrl'            => esc_url_raw( admin_url( 'admin-ajax.php' ) ),
			'ajaxNonce'          => wp_create_nonce( 'desktop-mode-plugins' ),
			// Core's `wp_ajax_install_plugin` (and friends) verify
			// against the `'updates'` nonce action — same string Core's
			// wp.updates client passes. We reuse it verbatim so we go
			// through Core's existing handler, no reimplementation.
			'updatesNonce'       => wp_create_nonce( 'updates' ),
			'caps'               => $caps,
			// Global "Automatic Updates" column gate — same shape Core's
			// `WP_Plugins_List_Table::$show_autoupdates` uses (true only
			// when the auto-update subsystem is enabled AND the viewer
			// can update plugins). Per-row state still lives on the REST
			// field `openstation_auto_update` so the JS knows whether
			// each individual row is enabled / forced / supported.
			'autoUpdatesEnabled' => openstation_plugins_window_auto_updates_enabled(),
			'currentUserId'      => (int) get_current_user_id(),
			// The plugin file path WordPress uses to identify the
			// OpenStation plugin itself in REST mutations
			// (`/wp/v2/plugins/{plugin}`). The JS uses this to detect
			// "user just deactivated/deleted us" and reload the page
			// out of the now-stale desktop shell before they hit any
			// dead UI.
			//
			// Stripped of `.php` to match Core's REST representation —
			// the `/wp/v2/plugins` controller returns `plugin` as
			// `substr( $file, 0, -4 )` (see
			// `wp-includes/rest-api/endpoints/class-wp-rest-plugins-controller.php`).
			// Comparing the raw `plugin_basename()` against the REST
			// field always missed by exactly four characters, which
			// silently skipped the self-deactivate reload.
			'selfPluginFile'     => substr( plugin_basename( OPENSTATION_FILE ), 0, -4 ),
			// The wp-admin root URL — the JS navigates here after a
			// self-deactivate so the user lands on the classic
			// Dashboard rather than reloading their current URL
			// (which might be a deactivated plugin's `?page=…` route
			// that now 403s).
			'adminUrl'           => esc_url_raw( admin_url() ),
		),
	);

	/**
	 * Filter the args used to register the native Plugins window.
	 *
	 * @param array $window_args Args passed to `openstation_register_window()`.
	 */
	$window_args = (array) apply_filters( 'openstation_plugins_window_args', $window_args );

	$registered = openstation_register_window( 'desktop-mode-plugins', $window_args );
	if ( is_wp_error( $registered ) ) {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( '[openstation] Native Plugins window registration failed: ' . $registered->get_error_message() );
	}
}
add_action( 'init', 'openstation_plugins_window_register_window', 20 );
