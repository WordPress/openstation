<?php
/**
 * Desktop Mode — Code Editor window registration.
 *
 * Registers the `wpdc-editor` native window + matching desktop icon on
 * `init` (after the desktop window registry is ready). Both registrations
 * are capability-gated on `edit_plugins` and skipped entirely when
 * `DISALLOW_FILE_EDIT` is set.
 *
 * The window's render callback lives in JS — it loads Monaco from the
 * vendored AMD distributable at `assets/vendor/monaco-editor/min/vs`
 * and mounts the editor into the body element the shell hands us.
 *
 * @package WPDesktopMode
 * @since 0.18.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Returns the URL the JS bundle should hand to Monaco's AMD loader.
 *
 * Trailing slash kept off so callers can append `/<file>.js` cleanly.
 *
 * @since 0.18.0
 *
 * @return string
 */
function wpdc_monaco_vendor_url() {
	return untrailingslashit( WPDM_URL . 'assets/vendor/monaco-editor/min/vs' );
}

/**
 * Whether the current site allows in-admin file editing.
 *
 * Mirrors the same gate WordPress core applies to the Theme/Plugin
 * editor: when `DISALLOW_FILE_EDIT` is true, the editor MUST NOT
 * expose any UI — it would mislead users into thinking saves work.
 *
 * @since 0.18.0
 *
 * @return bool
 */
function wpdc_file_edit_allowed() {
	return ! ( defined( 'DISALLOW_FILE_EDIT' ) && DISALLOW_FILE_EDIT );
}

/**
 * Whether the current user can use the code editor at all.
 *
 * @since 0.18.0
 *
 * @return bool
 */
function wpdc_current_user_can_edit() {
	return wpdc_file_edit_allowed() && current_user_can( 'edit_plugins' );
}

/**
 * Echoes the editor window's template body.
 *
 * The shell wraps whatever we emit inside its own
 * `<template id="wpdm-native-window-wpdc-editor">`, then on every
 * window open it clones that template into the window body BEFORE
 * invoking our JS render callback. So this callback declares the
 * static skeleton (loading state + Monaco mount node + the data-
 * attribute hooks the JS uses); the render callback is purely about
 * enhancement.
 *
 * Plugin authors who want to reshape this layout (e.g. add a custom
 * status bar, replace the loading copy, ship a different icon) can
 * filter the rendered HTML via `wp_desktop_code_editor_template_html`
 * — keep the `data-wpdc-editor-monaco` hook intact and the JS will
 * mount Monaco there regardless of surrounding markup.
 *
 * @since 0.18.0
 */
function wpdc_render_editor_template() {
	ob_start();
	?>
	<div class="wpdc-editor wpdc-editor--loading" data-wpdc-editor-root>
		<div class="wpdc-editor__loading" data-wpdc-editor-loading>
			<span class="dashicons dashicons-editor-code" aria-hidden="true"></span>
			<p><?php esc_html_e( 'Loading editor…', 'wp-desktop-mode' ); ?></p>
		</div>
		<div class="wpdc-editor__monaco" data-wpdc-editor-monaco></div>
	</div>
	<?php
	$html = (string) ob_get_clean();

	/**
	 * Filter the editor window's template body before it's emitted.
	 *
	 * The JS render callback queries `[data-wpdc-editor-monaco]` to
	 * mount Monaco — keep that hook (or rename via the
	 * `wp_desktop_code_editor_mount_selector` filter) and you can
	 * restyle / restructure everything else.
	 *
	 * @since 0.18.0
	 *
	 * @param string $html Default template HTML.
	 */
	echo apply_filters( 'wp_desktop_code_editor_template_html', $html ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
}

/**
 * Register the code editor window + desktop icon on `init`.
 *
 * Both registrations are no-ops on disallowed sites or for users
 * without `edit_plugins`. We hook on `init` (priority 20) so the
 * native-window registry has been bootstrapped by `components.php`.
 *
 * @since 0.18.0
 */
function wpdc_register_editor_window() {
	if ( ! wpdc_current_user_can_edit() ) {
		return;
	}

	$registered = wp_register_desktop_window(
		'wpdc-editor',
		array(
			'title'        => __( 'Code', 'wp-desktop-mode' ),
			'icon'         => 'dashicons-editor-code',
			'template'     => 'wpdc_render_editor_template',
			'script'       => 'wp-desktop-code-editor',
			'width'        => 960,
			'height'       => 640,
			'min_width'    => 480,
			'min_height'   => 320,
			'placement'    => 'taskbar',
			'capabilities' => array( 'edit_plugins' ),
		)
	);

	if ( is_wp_error( $registered ) ) {
		// Capability gate already passed above; only the static input
		// validations could fail here. Log and bail rather than blow up
		// the whole init phase.
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( '[wp-desktop-mode] Code editor window registration failed: ' . $registered->get_error_message() );
		return;
	}

	wp_register_desktop_icon(
		'wpdc-editor',
		array(
			'title'        => __( 'Code', 'wp-desktop-mode' ),
			'icon'         => 'dashicons-editor-code',
			'window'       => 'wpdc-editor',
			'position'     => 50,
			'capabilities' => array( 'edit_plugins' ),
		)
	);
}
add_action( 'init', 'wpdc_register_editor_window', 20 );

/**
 * Pass Monaco's vendor URL into the editor's JS bundle just before it
 * runs. The bundle reads `window.wpDesktopCodeEditor.monacoVendorUrl`
 * to configure the AMD loader's `paths.vs` setting.
 *
 * Inline-script localization runs whenever `wp-desktop-code-editor` is
 * enqueued — the shell calls `loadVendorScript()` lazily on first
 * window open, but `wp_localize_script` data is attached to the handle
 * itself, so it's available regardless of when WordPress prints it.
 *
 * @since 0.18.0
 */
function wpdc_localize_editor_config() {
	if ( ! wpdc_current_user_can_edit() ) {
		return;
	}

	wp_localize_script(
		'wp-desktop-code-editor',
		'wpDesktopCodeEditorConfig',
		array(
			'monacoVendorUrl' => wpdc_monaco_vendor_url(),
			'pluginUrl'       => untrailingslashit( WPDM_URL ),
		)
	);

	// Enqueue the editor's stylesheet eagerly. The JS bundle is pulled
	// on demand by the native-window sync only when the user opens the
	// editor; the CSS, however, has to be in place BEFORE the template
	// is cloned so the loading state renders correctly. The file is
	// tiny — cheap to ship to every desktop-mode page load.
	wp_enqueue_style( 'wp-desktop-code-editor' );
}
add_action( 'admin_enqueue_scripts', 'wpdc_localize_editor_config', 30 );
