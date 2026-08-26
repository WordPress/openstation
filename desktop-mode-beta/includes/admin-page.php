<?php
/**
 * The Tools → Desktop Mode Beta admin page.
 *
 * Deliberately a plain wp-admin page rendered without any Desktop Mode
 * machinery: if a branch build ever breaks the desktop shell, this page
 * is the surface that still works and switches the site back to stable.
 *
 * @package DesktopModeBeta
 */

defined( 'ABSPATH' ) || exit;

/**
 * Config injected next to the UI script in both contexts.
 *
 * @since 0.1.0
 *
 * @param string $context `admin` (Tools page) or `shell` (OS Settings tab).
 * @return array
 */
function desktop_mode_beta_script_config( $context ) {
	return array(
		'ajaxUrl'    => admin_url( 'admin-ajax.php' ),
		'nonce'      => wp_create_nonce( 'desktop-mode-beta' ),
		'context'    => $context,
		'repo'       => desktop_mode_beta_repo(),
		'repoUrl'    => 'https://github.com/' . desktop_mode_beta_repo(),
		'canInstall' => current_user_can( 'install_plugins' ),
	);
}

/**
 * Register the Tools submenu page.
 *
 * @since 0.1.0
 */
function desktop_mode_beta_register_admin_page() {
	add_management_page(
		__( 'Desktop Mode Beta', 'desktop-mode-beta' ),
		__( 'Desktop Mode Beta', 'desktop-mode-beta' ),
		'update_plugins',
		'desktop-mode-beta',
		'desktop_mode_beta_render_admin_page'
	);
}
add_action( 'admin_menu', 'desktop_mode_beta_register_admin_page' );

/**
 * Enqueue the UI script/styles on the Tools page only.
 *
 * @since 0.1.0
 *
 * @param string $hook_suffix Current admin page hook suffix.
 */
function desktop_mode_beta_admin_page_assets( $hook_suffix ) {
	if ( 'tools_page_desktop-mode-beta' !== $hook_suffix ) {
		return;
	}
	wp_enqueue_style(
		'desktop-mode-beta-admin',
		DESKTOP_MODE_BETA_URL . 'assets/beta-admin.css',
		array(),
		DESKTOP_MODE_BETA_VERSION
	);
	wp_register_script(
		'desktop-mode-beta-admin',
		DESKTOP_MODE_BETA_URL . 'assets/beta.js',
		array(),
		DESKTOP_MODE_BETA_VERSION,
		true
	);
	wp_localize_script( 'desktop-mode-beta-admin', 'desktopModeBetaConfig', desktop_mode_beta_script_config( 'admin' ) );
	wp_enqueue_script( 'desktop-mode-beta-admin' );
}
add_action( 'admin_enqueue_scripts', 'desktop_mode_beta_admin_page_assets' );

/**
 * Render the page shell — the script paints into the root node.
 *
 * @since 0.1.0
 */
function desktop_mode_beta_render_admin_page() {
	?>
	<div class="wrap desktop-mode-beta-wrap">
		<h1><?php esc_html_e( 'Desktop Mode Beta', 'desktop-mode-beta' ); ?></h1>
		<p>
			<?php esc_html_e( 'Install an OpenStation build from a pull request branch, the trunk branch, or switch back to the latest stable release.', 'desktop-mode-beta' ); ?>
		</p>
		<div id="desktop-mode-beta-root">
			<p><?php esc_html_e( 'Loading builds…', 'desktop-mode-beta' ); ?></p>
		</div>
	</div>
	<?php
}
