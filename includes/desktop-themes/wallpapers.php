<?php
/**
 * OpenStation — Desktop-theme wallpapers.
 *
 * A theme may declare any number of wallpapers in its manifest. Each
 * is published into the ordinary wallpaper registry as a pickable
 * entry labelled `<name> - (theme)`, alongside the built-in gradients
 * and canvas wallpapers. A theme shipping several names them, and the
 * label becomes `<name>: <label> - (theme)`.
 *
 * ## Why it is a pick and not an act
 *
 * Every other desktop OS swaps the wallpaper when you apply a theme.
 * We deliberately do not, because a wallpaper here is a **stored user
 * preference** (`wallpaper` in `desktop_mode_os_settings`), and
 * activating a theme would have to either overwrite that silently or
 * grow a shadow "what did they have before" record to undo it later.
 * Both are worse than simply offering the theme's artwork in the
 * place the user already goes to change wallpapers.
 *
 * The practical consequence is a nice one: a theme's wallpaper is
 * usable WITHOUT wearing the theme, and wearing the theme never
 * costs you the wallpaper you chose.
 *
 * Note this is separate from the `DESKTOP` texture slot. That slot
 * layers over whatever wallpaper is active and follows the theme;
 * this is a wallpaper in its own right that the user selects.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Prefix for wallpaper ids minted from desktop themes.
 *
 * Namespaced so a theme's wallpaper can never collide with a
 * built-in or with a plugin's own registration.
 */
const OPENSTATION_DESKTOP_THEME_WALLPAPER_PREFIX = 'desktop-theme/';

/**
 * Build the CSS `background` value for a theme's wallpaper.
 *
 * PHP writes the `url()` itself from the resolved, `rawurlencode`d
 * path — the same rule the compiler follows, and the reason a
 * manifest may not contain a `url()` of its own.
 *
 * @internal
 *
 * @param array  $wallpaper Sanitized `wallpaper` block.
 * @param string $base_url  Theme base URL (empty for code themes,
 *                          whose paths are absolute already).
 * @param string $version   Cache-buster for relative paths.
 * @return string CSS value, or `''` when unusable.
 */
function openstation_desktop_theme_wallpaper_css( $wallpaper, $base_url = '', $version = '' ) {
	if ( ! is_array( $wallpaper ) || empty( $wallpaper['path'] ) ) {
		return '';
	}
	$url = openstation_desktop_theme_asset_url( $wallpaper['path'], $base_url, $version );
	if ( '' === $url ) {
		return '';
	}

	// `<image> <position> / <size> <repeat>` — a background shorthand,
	// which is what `--os-bg` is assigned to. Defaults cover
	// the overwhelmingly common case (a photo filling the desk); the
	// manifest can override each part through the same grammar the
	// texture slots use.
	$position = ! empty( $wallpaper['position'] ) ? (string) $wallpaper['position'] : 'center center';
	$size     = ! empty( $wallpaper['size'] ) ? (string) $wallpaper['size'] : 'cover';
	$repeat   = ! empty( $wallpaper['repeat'] ) ? (string) $wallpaper['repeat'] : 'no-repeat';

	return openstation_desktop_theme_css_url( $url ) . ' ' . $position . ' / ' . $size . ' ' . $repeat;
}

/**
 * Picker label for a theme's wallpaper.
 *
 * The theme `name` reaching this function has already been through
 * `sanitize_text_field()` in the manifest sanitizer, and
 * `openstation_register_wallpaper()` sanitizes the finished label
 * again on the way into the registry. Both are belt-and-braces: the
 * shell paints wallpaper labels through the `html` tagged template,
 * whose text slots are built with `createTextNode()`, so a label is
 * never parsed as markup.
 *
 * @param string $name      Theme display name.
 * @param string $slug      Theme slug.
 * @param string $own_label The wallpaper's own label, or `''`.
 * @return string
 */
function openstation_desktop_theme_wallpaper_label( $name, $slug, $own_label = '' ) {
	$own_label = (string) $own_label;
	if ( '' === $own_label ) {
		$label = sprintf(
			/* translators: %s: desktop theme name. Marks a wallpaper that came from a theme. */
			__( '%s - (theme)', 'desktop-mode' ),
			$name
		);
	} else {
		$label = sprintf(
			/* translators: 1: desktop theme name, 2: the wallpaper's own name. */
			__( '%1$s: %2$s - (theme)', 'desktop-mode' ),
			$name,
			$own_label
		);
	}
	/**
	 * Filters the picker label for a wallpaper contributed by a
	 * desktop theme.
	 *
	 * @param string $label     Default `<name> - (theme)`, or
	 *                          `<name>: <own label> - (theme)`.
	 * @param string $name      Theme display name.
	 * @param string $slug      Theme slug.
	 * @param string $own_label The wallpaper's own label, or `''`.
	 */
	return (string) apply_filters(
		'openstation_desktop_theme_wallpaper_label',
		$label,
		$name,
		$slug,
		$own_label
	);
}

/**
 * Register one wallpaper per installed/registered theme that declares
 * one.
 *
 * Runs on `init` at 20 — after the built-ins (5) and after
 * code-registered themes, which the documented recipe hooks at the
 * default 10.
 *
 * Every theme in the library contributes, not just the active one:
 * the whole point of a pick is that it is available whether or not
 * you are wearing the theme it came from.
 *
 * @return void
 */
function openstation_register_desktop_theme_wallpapers() {
	$sources = array();

	foreach ( openstation_desktop_theme_registry() as $slug => $entry ) {
		$sources[ $slug ] = array( $entry, '', '' );
	}
	// Uploaded themes win on a slug collision, matching the payload
	// builder's precedence.
	foreach ( openstation_desktop_themes_index() as $slug => $entry ) {
		$installed_at = isset( $entry['installedAt'] ) ? (int) $entry['installedAt'] : 0;
		$sources[ $slug ] = array(
			$entry,
			openstation_desktop_themes_url( $slug ),
			$installed_at > 0 ? (string) $installed_at : '',
		);
	}

	foreach ( $sources as $slug => $source ) {
		list( $entry, $base_url, $version ) = $source;
		if ( ! is_array( $entry ) || empty( $entry['manifest'] ) || ! is_array( $entry['manifest'] ) ) {
			continue;
		}
		$manifest = $entry['manifest'];
		if ( empty( $manifest['wallpapers'] ) || ! is_array( $manifest['wallpapers'] ) ) {
			continue;
		}
		$name = isset( $manifest['name'] ) ? (string) $manifest['name'] : $slug;

		foreach ( $manifest['wallpapers'] as $wallpaper ) {
			$value = openstation_desktop_theme_wallpaper_css( $wallpaper, $base_url, $version );
			if ( '' === $value ) {
				continue;
			}
			// `<theme-slug>/<wallpaper-id>` — the wallpaper id is
			// derived from something stable (see the sanitizer), so a
			// user's stored selection survives a re-upload.
			$id = OPENSTATION_DESKTOP_THEME_WALLPAPER_PREFIX . $slug . '/' . $wallpaper['id'];

			openstation_register_wallpaper(
				$id,
				array(
					'label' => openstation_desktop_theme_wallpaper_label(
						$name,
						$slug,
						isset( $wallpaper['label'] ) ? (string) $wallpaper['label'] : ''
					),
					// Swatch and surface are the same artwork. The swatch
					// is a small box, so the same value on both keeps the
					// preview an honest miniature of what selecting it
					// produces.
					'preview'     => $value,
					'value'       => $value,
					'type'        => 'css',
					'description' => ! empty( $wallpaper['description'] )
						? (string) $wallpaper['description']
						: ( isset( $manifest['description'] ) ? (string) $manifest['description'] : '' ),
				)
			);
		}
	}
}
add_action( 'init', 'openstation_register_desktop_theme_wallpapers', 20 );
