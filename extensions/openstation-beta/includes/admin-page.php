<?php
/**
 * The Tools → OpenStation Beta admin page.
 *
 * Deliberately a plain wp-admin page rendered without any OpenStation
 * machinery: if a branch build ever breaks the desktop shell, this page
 * is the surface that still works and switches the site back to stable.
 *
 * @package OpenStationBeta
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
function openstation_beta_script_config( $context ) {
	return array(
		'ajaxUrl'    => admin_url( 'admin-ajax.php' ),
		'nonce'      => wp_create_nonce( 'openstation-beta' ),
		'context'    => $context,
		'repo'       => openstation_beta_repo(),
		'repoUrl'    => 'https://github.com/' . openstation_beta_repo(),
		'canInstall' => current_user_can( 'install_plugins' ),
	);
}

/**
 * Register the Tools submenu page.
 *
 * @since 0.1.0
 */
function openstation_beta_register_admin_page() {
	add_management_page(
		__( 'OpenStation Beta', 'openstation-beta' ),
		__( 'OpenStation Beta', 'openstation-beta' ),
		'update_plugins',
		'openstation-beta',
		'openstation_beta_render_admin_page'
	);
}
add_action( 'admin_menu', 'openstation_beta_register_admin_page' );

/**
 * Enqueue the UI script/styles on the Tools page only.
 *
 * @since 0.1.0
 *
 * @param string $hook_suffix Current admin page hook suffix.
 */
function openstation_beta_admin_page_assets( $hook_suffix ) {
	if ( 'tools_page_openstation-beta' !== $hook_suffix ) {
		return;
	}
	wp_enqueue_style(
		'openstation-beta-admin',
		OPENSTATION_BETA_URL . 'assets/beta-admin.css',
		array(),
		OPENSTATION_BETA_VERSION
	);
	wp_register_script(
		'openstation-beta-admin',
		OPENSTATION_BETA_URL . 'assets/beta.js',
		array(),
		OPENSTATION_BETA_VERSION,
		true
	);
	wp_localize_script( 'openstation-beta-admin', 'openStationBetaConfig', openstation_beta_script_config( 'admin' ) );
	wp_enqueue_script( 'openstation-beta-admin' );
}
add_action( 'admin_enqueue_scripts', 'openstation_beta_admin_page_assets' );

/**
 * Render the page shell — the script paints into the root node.
 *
 * @since 0.1.0
 */
function openstation_beta_render_admin_page() {
	?>
	<div class="wrap openstation-beta-wrap">
		<h1><?php esc_html_e( 'OpenStation Beta', 'openstation-beta' ); ?></h1>
		<p>
			<?php esc_html_e( 'Install an OpenStation build from a pull request branch, the trunk branch, or switch back to the latest stable release.', 'openstation-beta' ); ?>
		</p>
		<div id="openstation-beta-root">
			<p><?php esc_html_e( 'Loading builds…', 'openstation-beta' ); ?></p>
		</div>
	</div>
	<?php
}
