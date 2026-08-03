<?php
/**
 * OpenStation — Shell markup injection.
 *
 * Emits the `<div id="os-shell">…</div>` skeleton at
 * `in_admin_header @ 5`. The shell floats on top of the classic
 * admin via `position: fixed`; the body class added by
 * `body-classes.php` triggers the CSS that hides classic chrome.
 *
 * Extracted from `render.php` during the architecture-0.8.1 PHP
 * slicing (phase 6).
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;


/**
 * Injects the desktop shell markup into the admin page.
 *
 * Runs on `in_admin_header` at priority 5 so the shell renders right
 * after the classic admin bar but before the page content. The shell
 * floats above the classic layout via `position: fixed` in CSS; the
 * classic sidebar, body, and footer are hidden with `body.os-active`
 * selectors.
 */
function open_station_render_shell() {
	if ( open_station_is_chromeless_request() || ! open_station_is_enabled() || open_station_is_classic_request() ) {
		return;
	}

	/**
	 * Fires right before the desktop shell markup is rendered.
	 */
	do_action( 'open_station_shell_before' );

	// Stamp the user's admin color scheme onto the shell root so the
	// variables.css per-scheme selectors kick in before first paint —
	// doing this from JS on init() would show the default palette for a
	// frame before swapping.
	$scheme = sanitize_html_class( get_user_option( 'admin_color' ), 'fresh' );

	// Same reasoning for the active desktop theme: the compiled
	// theme stylesheet keys off this attribute, so stamping it
	// server-side means the first paint is already themed. Setting
	// it from `applyDesktopTheme()` on boot would flash the default
	// palette for a frame. Empty string when the user is on the
	// system default (and nothing else about themes runs at all).
	$desktop_theme = function_exists( 'open_station_active_desktop_theme_slug' )
		? open_station_active_desktop_theme_slug()
		: '';
	?>
	<div id="os-shell" class="os-shell" data-os-scheme="<?php echo esc_attr( $scheme ); ?>"<?php echo '' !== $desktop_theme ? ' data-os-desktop-theme="' . esc_attr( $desktop_theme ) . '"' : ''; ?> role="application" aria-label="<?php esc_attr_e( 'Desktop shell', 'desktop-mode' ); ?>">
		<?php
		/*
		 * Wallpaper layer — sits behind both the dock and the desktop
		 * area so a translucent dock bleeds through to the wallpaper
		 * (macOS pattern). Canvas-driven wallpapers mount their own
		 * DOM into this element; static CSS wallpapers just inherit
		 * the `--os-bg` custom property the shell sets at
		 * boot. Presentational only.
		 */
		?>
		<div id="os-wallpaper" class="os-wallpaper" aria-hidden="true"></div>
		<div class="os-shell__body">
			<nav id="os-dock" class="os-dock" role="toolbar" aria-label="<?php esc_attr_e( 'Admin navigation', 'desktop-mode' ); ?>"></nav>
			<div id="os-area" class="os-area os-area--with-dock os-area--booting">
				<?php
				/*
				 * Widget column — paints above the wallpaper but
				 * beneath windows (z-index 1 vs. windows at 100+).
				 * Hosted INSIDE `.os-area` so scrolling the
				 * area (not that we do today) would scroll widgets
				 * with it, and so the dock naturally frames
				 * it. Empty on first render — JS (`WidgetLayer`)
				 * populates it on boot.
				 */
				?>
				<aside id="os-widgets" class="os-widgets" aria-label="<?php esc_attr_e( 'Widgets', 'desktop-mode' ); ?>"></aside>
			</div>
		</div>
	</div>
	<?php
	/**
	 * Fires right after the desktop shell markup has rendered.
	 */
	do_action( 'open_station_shell_after' );
}
add_action( 'in_admin_header', 'open_station_render_shell', 5 );

