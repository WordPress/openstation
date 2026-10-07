<?php

defined( 'ABSPATH' ) || exit;

function openstation_render_shell() {
	if ( ! openstation_is_shell_request() ) {
		return;
	}

	do_action( 'openstation_shell_before' );

	$scheme = sanitize_html_class( get_user_option( 'admin_color' ), 'fresh' );

	$desktop_theme = function_exists( 'openstation_active_desktop_theme_slug' )
		? openstation_active_desktop_theme_slug()
		: '';

	$arriving = openstation_shell_lands_in_overview() ? ' os-shell--arriving' : '';
	?>
	<div id="os-shell" class="os-shell<?php echo esc_attr( $arriving ); ?>" data-os-scheme="<?php echo esc_attr( $scheme ); ?>"<?php echo '' !== $desktop_theme ? ' data-os-desktop-theme="' . esc_attr( $desktop_theme ) . '"' : ''; ?> role="application" aria-label="<?php esc_attr_e( 'Desktop shell', 'desktop-mode' ); ?>">
		<?php

		?>
		<div id="os-wallpaper" class="os-wallpaper" aria-hidden="true"></div>
		<div class="os-shell__body">
			<?php

			?>
			<nav id="os-dock" class="os-dock" role="toolbar" aria-label="<?php esc_attr_e( 'Admin navigation', 'desktop-mode' ); ?>" data-os-dock-behavior="<?php echo esc_attr( openstation_get_dock_behavior() ); ?>"></nav>
			<div id="os-area" class="os-area os-area--with-dock os-area--booting">
				<?php

				?>
				<aside id="os-widgets" class="os-widgets" aria-label="<?php esc_attr_e( 'Widgets', 'desktop-mode' ); ?>"></aside>
			</div>
		</div>
	</div>
	<?php

	do_action( 'openstation_shell_after' );
}
add_action( 'in_admin_header', 'openstation_render_shell', 5 );
