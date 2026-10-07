<?php

defined( 'ABSPATH' ) || exit;

function openstation_code_editor_monaco_vendor_url() {
	return untrailingslashit(
		OPENSTATION_CODE_EDITOR_URL . 'assets/vendor/monaco-editor/min/vs'
	);
}

function openstation_code_editor_register_assets() {
	$css_path = OPENSTATION_CODE_EDITOR_DIR . 'assets/css/code-editor.css';
	wp_register_style(
		'desktop-mode-code-editor',
		OPENSTATION_CODE_EDITOR_URL . 'assets/css/code-editor.css',
		array( 'os-variables', 'dashicons' ),

		file_exists( $css_path ) ? (string) filemtime( $css_path ) : OPENSTATION_CODE_EDITOR_VERSION
	);

	$bundle_url = add_query_arg(
		array( 'action' => 'openstation_code_editor_bundle' ),
		admin_url( 'admin-ajax.php' )
	);

	wp_register_script(
		'desktop-mode-code-editor',
		$bundle_url,
		array( 'wp-i18n' ),
		OPENSTATION_CODE_EDITOR_VERSION,
		true
	);
	wp_set_script_translations(
		'desktop-mode-code-editor',
		'desktop-mode-code-editor',
		OPENSTATION_CODE_EDITOR_DIR . 'languages'
	);
}

function openstation_code_editor_serve_bundle() {
	if ( ! openstation_code_editor_user_can_use() ) {
		status_header( 403 );
		exit;
	}

	$base = trailingslashit( rest_url( OPENSTATION_CODE_EDITOR_REST_NAMESPACE ) );

	$config = array(
		'monacoVendorUrl' => openstation_code_editor_monaco_vendor_url(),
		'pluginUrl'       => untrailingslashit( OPENSTATION_CODE_EDITOR_URL ),
		'restNonce'       => wp_create_nonce( 'wp_rest' ),
		'treeUrl'         => esc_url_raw( $base . 'tree' ),
		'fileUrl'         => esc_url_raw( $base . 'file' ),
		'phpSymbolsUrl'   => esc_url_raw( $base . 'php-symbols' ),
		'phpSymbolUrl'    => esc_url_raw( $base . 'php-symbols/' ),
	);

	nocache_headers();
	header( 'Content-Type: application/javascript; charset=utf-8' );
	header( 'Vary: Cookie' );

	echo 'window.openStationCodeEditorConfig = ' . wp_json_encode( $config ) . ';' . "\n";

	$suffix = ( defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG ) ? '' : '.min';
	$bundle = OPENSTATION_CODE_EDITOR_DIR . 'assets/js/code-editor' . $suffix . '.js';
	if ( ! file_exists( $bundle ) ) {
		$bundle = OPENSTATION_CODE_EDITOR_DIR . 'assets/js/code-editor.js';
	}
	if ( file_exists( $bundle ) ) {

		readfile( $bundle );
	}

	exit;
}

function openstation_code_editor_render_template() {
	ob_start();
	?>
	<div class="wpdc-editor osc-editor--loading" data-osc-editor-root>
		<div class="osc-editor__loading" data-osc-editor-loading>
			<span class="dashicons dashicons-editor-code" aria-hidden="true"></span>
			<p><?php esc_html_e( 'Loading editor…', 'desktop-mode-code-editor' ); ?></p>
		</div>
		<div class="osc-editor__monaco" data-osc-editor-monaco></div>
	</div>
	<?php
	$html = (string) ob_get_clean();

	echo apply_filters( 'openstation_code_editor_template_html', $html );
}

function openstation_code_editor_register_window() {
	if ( ! openstation_code_editor_user_can_use() ) {
		return;
	}

	$window_args = array(
		'title'        => __( 'Code', 'desktop-mode-code-editor' ),
		'icon'         => 'dashicons-editor-code',
		'template'     => 'openstation_code_editor_render_template',
		'script'       => 'desktop-mode-code-editor',
		'width'        => 960,
		'height'       => 640,
		'min_width'    => 480,
		'min_height'   => 320,
		'placement'    => 'taskbar',
		'capabilities' => array( 'edit_plugins' ),
	);

	$window_args = (array) apply_filters( 'openstation_code_editor_window_args', $window_args );

	$registered = openstation_register_window( 'wpdc-editor', $window_args );
	if ( is_wp_error( $registered ) ) {

		error_log( '[desktop-mode-code-editor] window registration failed: ' . $registered->get_error_message() );
		return;
	}

	$icon_args = array(
		'title'        => __( 'Code', 'desktop-mode-code-editor' ),
		'icon'         => 'dashicons-editor-code',
		'window'       => 'wpdc-editor',
		'position'     => 50,
		'capabilities' => array( 'edit_plugins' ),
	);

	$icon_args = (array) apply_filters( 'openstation_code_editor_icon_args', $icon_args );

	openstation_register_icon( 'wpdc-editor', $icon_args );
}

function openstation_code_editor_enqueue_style() {
	if ( ! openstation_code_editor_user_can_use() ) {
		return;
	}
	wp_enqueue_style( 'desktop-mode-code-editor' );
}

function openstation_code_editor_maybe_init_ui() {
	if ( ! function_exists( 'openstation_register_window' ) ) {
		return;
	}

	add_action( 'init', 'openstation_code_editor_register_assets', 20 );
	add_action( 'init', 'openstation_code_editor_register_window', 20 );
	add_action( 'admin_enqueue_scripts', 'openstation_code_editor_enqueue_style', 30 );
}

add_action( 'wp_ajax_openstation_code_editor_bundle', 'openstation_code_editor_serve_bundle' );
add_action( 'plugins_loaded', 'openstation_code_editor_maybe_init_ui', 20 );
