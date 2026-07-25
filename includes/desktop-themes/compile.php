<?php
/**
 * Desktop Mode — Desktop-theme CSS compiler.
 *
 * Turns a **sanitized** manifest into a stylesheet made of nothing
 * but custom-property declarations. No author string ever becomes a
 * selector, a property name, an at-rule, or a `url()` — the compiler
 * writes every `url()` itself from a resolved, `rawurlencode`d path.
 *
 * ## Why the selector is doubled
 *
 * Output is scoped to BOTH:
 *
 *     .desktop-mode-shell[data-desktop-mode-desktop-theme="<slug>"]
 *     body.desktop-mode-desktop-theme-<slug>
 *
 * The shell root covers the desktop, dock, and every window. But
 * toasts, confirm dialogs, tooltips, and context menus mount on
 * `document.body`, OUTSIDE `#desktop-mode-shell` — a shell-only
 * scope would leave those surfaces on the default palette while
 * everything around them reskinned.
 *
 * ## Why the dependency chain matters
 *
 * Both selectors weigh (0,2,0) — the same specificity as the
 * per-admin-color-scheme blocks in `variables.css`
 * (`.desktop-mode-shell[data-desktop-mode-scheme="…"]`). A
 * specificity tie is broken by source order, so the compiled theme
 * sheet MUST print after `variables.css`. That is enforced by
 * registering the style handle with `desktop-mode-variables` as a
 * dependency (see `desktop_mode_enqueue_desktop_theme_style()`);
 * do not remove that dependency, and do not "simplify" the selector
 * to a single class — it would lose the tie.
 *
 * @package WPDesktopMode
 * @since   0.9.7
 */

defined( 'ABSPATH' ) || exit;

/**
 * Resolve one manifest asset reference to an absolute URL.
 *
 * Code-registered themes carry absolute http(s) URLs (already
 * validated by the URL asset resolver). Uploaded themes carry
 * theme-relative paths, which get joined to the theme's base URL
 * with every segment `rawurlencode`d — that encoding is also what
 * guarantees the result can never contain a quote, paren, or
 * whitespace that would break out of the `url("…")` wrapper.
 *
 * @since 0.9.7
 * @internal
 *
 * ## Why the `?ver=` matters
 *
 * Re-uploading a theme with the same id is an UPDATE, by design. The
 * files change but their paths do not, so without a version query
 * every browser that had seen the old theme keeps serving its cached
 * icons and textures — a theme author fixes their artwork, re-uploads,
 * and sees no change. Stamping with the install timestamp gives each
 * upload its own URL space.
 *
 * Absolute URLs (code-registered themes) are left alone: those assets
 * belong to a plugin that owns its own cache-busting, and appending
 * to a URL that may already carry a query is not ours to do.
 *
 * @param string $ref      Manifest reference (relative path or URL).
 * @param string $base_url Theme base URL, no trailing slash.
 * @param string $version  Cache-buster for relative refs (the theme's
 *                         `installedAt`). Omit to skip versioning.
 * @return string Absolute URL, or `''` when unusable.
 */
function desktop_mode_desktop_theme_asset_url( $ref, $base_url, $version = '' ) {
	$ref = (string) $ref;
	if ( '' === $ref ) {
		return '';
	}
	if ( preg_match( '~^https?://~i', $ref ) ) {
		return $ref;
	}
	$base = untrailingslashit( (string) $base_url );
	if ( '' === $base ) {
		return '';
	}
	$segments = array_map( 'rawurlencode', explode( '/', $ref ) );
	$url      = $base . '/' . implode( '/', $segments );
	$version  = (string) $version;
	return '' !== $version ? $url . '?ver=' . rawurlencode( $version ) : $url;
}

/**
 * Wrap a resolved asset URL in a CSS `url()` function.
 *
 * @since 0.9.7
 * @internal
 *
 * @param string $url Absolute URL.
 * @return string
 */
function desktop_mode_desktop_theme_css_url( $url ) {
	return 'url("' . $url . '")';
}

/**
 * Compile a sanitized manifest into a scoped stylesheet.
 *
 * Deterministic: the same manifest + slug + base URL always produce
 * byte-identical output (declarations are key-sorted, so authoring
 * order in `theme.json` is irrelevant).
 *
 * @since 0.9.7
 *
 * @param array  $manifest Sanitized manifest from
 *                         {@see desktop_mode_sanitize_desktop_theme_manifest()}.
 * @param string $slug     Storage slug.
 * @param string $base_url Theme base URL (no trailing slash). May be
 *                         empty for code themes whose assets are
 *                         absolute URLs.
 * @param string $version  Cache-buster appended to generated asset
 *                         URLs — see
 *                         {@see desktop_mode_desktop_theme_asset_url()}.
 *                         The stylesheet itself is versioned by the
 *                         enqueue, but the textures it references are
 *                         not, and a re-upload must invalidate both.
 * @return string Stylesheet text. `''` when the theme sets nothing.
 */
function desktop_mode_desktop_theme_compile_css( $manifest, $slug, $base_url = '', $version = '' ) {
	$slug = sanitize_key( (string) $slug );
	if ( '' === $slug || ! is_array( $manifest ) ) {
		return '';
	}

	$declarations = array();

	// --- Design tokens. ---
	$tokens = isset( $manifest['tokens'] ) && is_array( $manifest['tokens'] )
		? $manifest['tokens']
		: array();
	ksort( $tokens );
	foreach ( $tokens as $property => $value ) {
		$declarations[] = "\t{$property}: {$value};";
	}

	// --- Textures. ---
	$textures = isset( $manifest['textures'] ) && is_array( $manifest['textures'] )
		? $manifest['textures']
		: array();
	ksort( $textures );

	// Simple `background-image` slots: slot => property prefix.
	$image_slots = array(
		'TITLEBAR'         => '--desktop-mode-titlebar-image',
		'TITLEBAR_FOCUSED' => '--desktop-mode-titlebar-image-focused',
		'DOCK'             => '--desktop-mode-dock-bg-image',
		'DESKTOP'          => '--desktop-mode-desktop-image',
	);
	$corner_slots = array(
		'WINDOW_CORNER_NE' => '--desktop-mode-window-corner-ne-image',
		'WINDOW_CORNER_NW' => '--desktop-mode-window-corner-nw-image',
		'WINDOW_CORNER_SE' => '--desktop-mode-window-corner-se-image',
		'WINDOW_CORNER_SW' => '--desktop-mode-window-corner-sw-image',
	);

	$corner_size = '';

	foreach ( $textures as $slot => $entry ) {
		if ( ! is_array( $entry ) || empty( $entry['path'] ) ) {
			continue;
		}
		$url = desktop_mode_desktop_theme_asset_url( $entry['path'], $base_url, $version );
		if ( '' === $url ) {
			continue;
		}
		$css_url = desktop_mode_desktop_theme_css_url( $url );

		if ( isset( $image_slots[ $slot ] ) ) {
			$prop           = $image_slots[ $slot ];
			$declarations[] = "\t{$prop}: {$css_url};";
			// The `-focused` variant shares the base slot's repeat +
			// size; only its image differs.
			if ( 'TITLEBAR_FOCUSED' !== $slot ) {
				if ( ! empty( $entry['repeat'] ) ) {
					$declarations[] = "\t{$prop}-repeat: {$entry['repeat']};";
				}
				if ( ! empty( $entry['size'] ) ) {
					$declarations[] = "\t{$prop}-size: {$entry['size']};";
				}
			}
			continue;
		}

		if ( isset( $corner_slots[ $slot ] ) ) {
			$prop           = $corner_slots[ $slot ];
			$declarations[] = "\t{$prop}: {$css_url};";
			// Corners share one size token — first declared wins.
			// `ksort` above makes "first" deterministic (NE, NW, SE, SW).
			if ( '' === $corner_size && ! empty( $entry['size'] ) ) {
				$corner_size = (string) $entry['size'];
			}
			continue;
		}

		if ( 'WINDOW_FRAME' === $slot ) {
			$declarations[] = "\t--desktop-mode-window-border-image-source: {$css_url};";
			if ( ! empty( $entry['slice'] ) ) {
				$declarations[] = "\t--desktop-mode-window-border-image-slice: {$entry['slice']};";
			}
			if ( ! empty( $entry['width'] ) ) {
				$declarations[] = "\t--desktop-mode-window-border-image-width: {$entry['width']};";
			}
			if ( ! empty( $entry['repeat'] ) ) {
				$declarations[] = "\t--desktop-mode-window-border-image-repeat: {$entry['repeat']};";
			}
		}
	}

	if ( '' !== $corner_size ) {
		$declarations[] = "\t--desktop-mode-window-corner-size: {$corner_size};";
	}

	if ( empty( $declarations ) ) {
		return '';
	}

	// Re-sort so the emitted block is stable regardless of the order
	// the loops above happened to append in.
	sort( $declarations, SORT_STRING );

	$selector = '.desktop-mode-shell[data-desktop-mode-desktop-theme="' . $slug . '"],' . "\n"
		. 'body.desktop-mode-desktop-theme-' . $slug;

	return "/* Desktop Mode desktop theme: {$slug} — compiled, do not edit. */\n"
		. $selector . " {\n"
		. implode( "\n", $declarations ) . "\n"
		. "}\n";
}
