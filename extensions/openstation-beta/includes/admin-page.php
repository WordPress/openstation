<?php

defined( 'ABSPATH' ) || exit;

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
