<?php
/**
 * Desktop Mode — Shell markup injection.
 *
 * Emits the `<div id="desktop-mode-shell">…</div>` skeleton at
 * `in_admin_header @ 5`. The shell floats on top of the classic
 * admin via `position: fixed`; the body class added by
 * `body-classes.php` triggers the CSS that hides classic chrome.
 *
 * Extracted from `render.php` during the architecture-0.8.1 PHP
 * slicing (phase 6).
 *
 * @package Desktop_Mode
 * @since   0.8.1
 */

defined( 'ABSPATH' ) || exit;


/**
 * Injects the desktop shell markup into the admin page.
 *
 * Runs on `in_admin_header` at priority 5 so the shell renders right
 * after the classic admin bar but before the page content. The shell
 * floats above the classic layout via `position: fixed` in CSS; the
 * classic sidebar, body, and footer are hidden with `body.desktop-mode-active`
 * selectors.
 *
 * @since 0.1.0
 */
function desktop_mode_render_shell() {
	if ( desktop_mode_is_chromeless_request() || ! desktop_mode_is_enabled() || desktop_mode_is_classic_request() ) {
		return;
	}

	/**
	 * Fires right before the desktop shell markup is rendered.
	 *
	 * @since 0.1.0
	 */
	do_action( 'desktop_mode_shell_before' );

	// Stamp the user's admin color scheme onto the shell root so the
	// variables.css per-scheme selectors kick in before first paint —
	// doing this from JS on init() would show the default palette for a
	// frame before swapping.
	$scheme = sanitize_html_class( get_user_option( 'admin_color' ), 'fresh' );
	?>
	<div id="desktop-mode-shell" class="desktop-mode-shell" data-desktop-mode-scheme="<?php echo esc_attr( $scheme ); ?>" role="application" aria-label="<?php esc_attr_e( 'Desktop shell', 'desktop-mode' ); ?>">
		<?php
		/*
		 * Wallpaper layer — sits behind both the dock and the desktop
		 * area so a translucent dock bleeds through to the wallpaper
		 * (macOS pattern). Canvas-driven wallpapers mount their own
		 * DOM into this element; static CSS wallpapers just inherit
		 * the `--desktop-mode-bg` custom property the shell sets at
		 * boot. Presentational only.
		 */
		?>
		<div id="desktop-mode-wallpaper" class="desktop-mode-wallpaper" aria-hidden="true"></div>
		<div class="desktop-mode-shell__body">
			<nav id="desktop-mode-dock" class="desktop-mode-dock" role="toolbar" aria-label="<?php esc_attr_e( 'Admin navigation', 'desktop-mode' ); ?>"></nav>
			<div id="desktop-mode-area" class="desktop-mode-area desktop-mode-area--with-dock desktop-mode-area--booting">
				<?php
				/*
				 * Widget column — paints above the wallpaper but
				 * beneath windows (z-index 1 vs. windows at 100+).
				 * Hosted INSIDE `.desktop-mode-area` so scrolling the
				 * area (not that we do today) would scroll widgets
				 * with it, and so the dock naturally frames
				 * it. Empty on first render — JS (`WidgetLayer`)
				 * populates it on boot.
				 */
				?>
				<aside id="desktop-mode-widgets" class="desktop-mode-widgets" aria-label="<?php esc_attr_e( 'Widgets', 'desktop-mode' ); ?>"></aside>
			</div>
		</div>
	</div>
	<?php
	/**
	 * Fires right after the desktop shell markup has rendered.
	 *
	 * @since 0.1.0
	 */
	do_action( 'desktop_mode_shell_after' );
}
add_action( 'in_admin_header', 'desktop_mode_render_shell', 5 );

