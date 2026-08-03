<?php
/**
 * Code Editor window, icon, and asset registration.
 *
 * Registers the `osc-editor` native window + matching desktop icon
 * and serves the bundle through `admin-ajax.php` so the Monaco loader
 * URL + REST URLs + nonce land in the response body — no
 * `wp_localize_script` lifecycle to depend on, no inline-script tag
 * to lose on the lazy-load path.
 *
 * Window id (`osc-editor`), DOM selectors (`data-osc-editor-*`),
 * CSS classes (`osc-editor*`), and the JS-side config global
 * (`window.openStationCodeEditorConfig`) intentionally retain their
 * original spellings — third-party plugins documented under
 * `desktop-mode/docs/examples/code-editor-open.md` deep-link by
 * window id, and renaming would break public consumers.
 *
 * @package OpenStationCodeEditor
 */

defined( 'ABSPATH' ) || exit;

/**
 * URL the JS bundle hands to Monaco's AMD loader.
 *
 * @return string
 */
function open_station_code_editor_monaco_vendor_url() {
	return untrailingslashit(
		OPEN_STATION_CODE_EDITOR_URL . 'assets/vendor/monaco-editor/min/vs'
	);
}

/**
 * Register the script + style handles backing the editor window.
 *
 * The script is served through `admin-ajax.php?action=open_station_code_editor_bundle`
 * so the editor config is baked into the response body. The CSS is a
 * normal static stylesheet.
 */
function open_station_code_editor_register_assets() {
	$css_path = OPEN_STATION_CODE_EDITOR_DIR . 'assets/css/code-editor.css';
	wp_register_style(
		'desktop-mode-code-editor',
		OPEN_STATION_CODE_EDITOR_URL . 'assets/css/code-editor.css',
		array( 'os-variables', 'dashicons' ),
		// CSS iterates faster than the bundle; cache-bust on mtime so a
		// fresh stylesheet always lands without a plugin version bump.
		file_exists( $css_path ) ? (string) filemtime( $css_path ) : OPEN_STATION_CODE_EDITOR_VERSION
	);

	$bundle_url = add_query_arg(
		array( 'action' => 'open_station_code_editor_bundle' ),
		admin_url( 'admin-ajax.php' )
	);

	wp_register_script(
		'desktop-mode-code-editor',
		$bundle_url,
		array( 'wp-i18n' ),
		OPEN_STATION_CODE_EDITOR_VERSION,
		true
	);
	wp_set_script_translations(
		'desktop-mode-code-editor',
		'desktop-mode-code-editor',
		OPEN_STATION_CODE_EDITOR_DIR . 'languages'
	);
}

/**
 * Serve the Code Editor bundle with the config baked in.
 *
 * Hooked on `wp_ajax_open_station_code_editor_bundle`. Outputs:
 *
 *   1. `window.openStationCodeEditorConfig = {...};` — Monaco vendor URL
 *      + REST URLs + nonce.
 *   2. The prebuilt code-editor bundle (min when not SCRIPT_DEBUG).
 *
 * `Vary: Cookie` + `nocache_headers()` ensure each session gets its
 * own nonce — cached responses are never shared across users.
 */
function open_station_code_editor_serve_bundle() {
	if ( ! open_station_code_editor_user_can_use() ) {
		status_header( 403 );
		exit;
	}

	$base = trailingslashit( rest_url( OPEN_STATION_CODE_EDITOR_REST_NAMESPACE ) );

	$config = array(
		'monacoVendorUrl' => open_station_code_editor_monaco_vendor_url(),
		'pluginUrl'       => untrailingslashit( OPEN_STATION_CODE_EDITOR_URL ),
		'restNonce'       => wp_create_nonce( 'wp_rest' ),
		'treeUrl'         => esc_url_raw( $base . 'tree' ),
		'fileUrl'         => esc_url_raw( $base . 'file' ),
		'phpSymbolsUrl'   => esc_url_raw( $base . 'php-symbols' ),
		'phpSymbolUrl'    => esc_url_raw( $base . 'php-symbols/' ),
	);

	nocache_headers();
	header( 'Content-Type: application/javascript; charset=utf-8' );
	header( 'Vary: Cookie' );

	echo '/* desktop-mode-code-editor config + bundle */' . "\n";
	echo 'window.openStationCodeEditorConfig = ' . wp_json_encode( $config ) . ';' . "\n";

	$suffix = ( defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG ) ? '' : '.min';
	$bundle = OPEN_STATION_CODE_EDITOR_DIR . 'assets/js/code-editor' . $suffix . '.js';
	if ( ! file_exists( $bundle ) ) {
		$bundle = OPEN_STATION_CODE_EDITOR_DIR . 'assets/js/code-editor.js';
	}
	if ( file_exists( $bundle ) ) {
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_readfile
		readfile( $bundle );
	}

	exit;
}

/**
 * Echoes the Code Editor window's static template.
 *
 * The shell wraps whatever we emit inside its own
 * `<template id="os-native-window-osc-editor">`, then on every
 * window open it clones that template into the window body BEFORE
 * invoking our JS render callback.
 */
function open_station_code_editor_render_template() {
	ob_start();
	?>
	<div class="osc-editor osc-editor--loading" data-osc-editor-root>
		<div class="osc-editor__loading" data-osc-editor-loading>
			<span class="dashicons dashicons-editor-code" aria-hidden="true"></span>
			<p><?php esc_html_e( 'Loading editor…', 'desktop-mode-code-editor' ); ?></p>
		</div>
		<div class="osc-editor__monaco" data-osc-editor-monaco></div>
	</div>
	<?php
	$html = (string) ob_get_clean();

	/**
	 * Filter the editor window's template body before it's emitted.
	 *
	 * Keep the `data-osc-editor-monaco` hook (or rename via the
	 * `open_station_code_editor_mount_selector` filter) and you can
	 * restyle / restructure everything else.
	 *
	 * @param string $html Default template HTML.
	 */
	echo apply_filters( 'open_station_code_editor_template_html', $html ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
}

/**
 * Register the Code Editor window and desktop icon.
 *
 * Both registrations are no-ops on disallowed sites or for users
 * without `edit_plugins`. We hook on `init` (priority 20) so the
 * native-window registry has been bootstrapped by the framework.
 */
function open_station_code_editor_register_window() {
	if ( ! open_station_code_editor_user_can_use() ) {
		return;
	}

	$window_args = array(
		'title'        => __( 'Code', 'desktop-mode-code-editor' ),
		'icon'         => 'dashicons-editor-code',
		'template'     => 'open_station_code_editor_render_template',
		'script'       => 'desktop-mode-code-editor',
		'width'        => 960,
		'height'       => 640,
		'min_width'    => 480,
		'min_height'   => 320,
		'placement'    => 'taskbar',
		'capabilities' => array( 'edit_plugins' ),
	);

	/**
	 * Filter args used to register the Code Editor native window.
	 *
	 * @param array $window_args Args passed to `open_station_register_window()`.
	 */
	$window_args = (array) apply_filters( 'open_station_code_editor_window_args', $window_args );

	$registered = open_station_register_window( 'osc-editor', $window_args );
	if ( is_wp_error( $registered ) ) {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( '[desktop-mode-code-editor] window registration failed: ' . $registered->get_error_message() );
		return;
	}

	$icon_args = array(
		'title'        => __( 'Code', 'desktop-mode-code-editor' ),
		'icon'         => 'dashicons-editor-code',
		'window'       => 'osc-editor',
		'position'     => 50,
		'capabilities' => array( 'edit_plugins' ),
	);

	/**
	 * Filter args used to register the Code Editor desktop icon.
	 *
	 * @param array $icon_args Args passed to `open_station_register_icon()`.
	 */
	$icon_args = (array) apply_filters( 'open_station_code_editor_icon_args', $icon_args );

	open_station_register_icon( 'osc-editor', $icon_args );
}

/**
 * Enqueue the editor stylesheet for any openstation admin page.
 *
 * The CSS has to be in place BEFORE the template is cloned so the
 * loading state renders correctly. The bundle is pulled on demand
 * by the native-window sync; the CSS is cheap to ship to every
 * openstation page load.
 */
function open_station_code_editor_enqueue_style() {
	if ( ! open_station_code_editor_user_can_use() ) {
		return;
	}
	wp_enqueue_style( 'desktop-mode-code-editor' );
}

/**
 * Wire the UI surface to OpenStation once we know it's loaded.
 *
 * No-ops cleanly when OpenStation is missing — REST routes still
 * register so any consumer that relies on them keeps working.
 */
function open_station_code_editor_maybe_init_ui() {
	if ( ! function_exists( 'open_station_register_window' ) ) {
		return;
	}

	add_action( 'init', 'open_station_code_editor_register_assets', 20 );
	add_action( 'init', 'open_station_code_editor_register_window', 20 );
	add_action( 'admin_enqueue_scripts', 'open_station_code_editor_enqueue_style', 30 );
}

// The bundle endpoint is wired unconditionally so the config is
// reachable even when the consumer's page-render hooks misbehave —
// `open_station_code_editor_user_can_use()` is the actual auth gate
// inside the handler.
add_action( 'wp_ajax_open_station_code_editor_bundle', 'open_station_code_editor_serve_bundle' );
add_action( 'plugins_loaded', 'open_station_code_editor_maybe_init_ui', 20 );
