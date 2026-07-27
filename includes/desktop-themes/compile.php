<?php
/**
 * Desktop Mode — Desktop-theme CSS compiler.
 *
 * Turns a **sanitized** manifest into a stylesheet made of custom-
 * property declarations plus, when the theme bundles fonts, a block
 * of `@font-face` rules. No author string ever becomes a selector,
 * a property name, or a `url()` — the compiler writes every `url()`
 * itself from a resolved, `rawurlencode`d path.
 *
 * ## The one at-rule we generate
 *
 * `@font-face` is the single exception to "custom properties only",
 * and it is generated ENTIRELY by this file: the literal `@font-face`
 * text, every descriptor name, and every `url()` come from here. The
 * author contributes two constrained substrings — a family name
 * matching `^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$` (so double-quoting it
 * is airtight) and a file path that already passed the font-extension
 * allowlist and a containment check. Everything else is a closed
 * enum. See `desktop_mode_sanitize_desktop_theme_fonts()`.
 *
 * `@font-face` is deliberately NOT scoped to the theme's selector —
 * at-rules cannot be nested inside one, and there is nothing to
 * scope: a face that nothing references costs a name in a table and
 * no bytes on the wire. Fonts load when a token points at them.
 *
 * ## Textures are table-driven
 *
 * The slot => custom-property mapping lives in
 * {@see desktop_mode_desktop_theme_texture_slots()}, not here. This
 * file knows how to turn `image` and `border-image` descriptors into
 * declarations; it does not know that `TITLEBAR` exists. That is what
 * lets a plugin texture a surface the framework has never heard of.
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
 * byte-identical output. Declarations are key-sorted, so authoring
 * order in `theme.json` is irrelevant for tokens and textures.
 * `@font-face` rules are the exception and keep the author's order,
 * because for `unicodeRange`-subsetted faces of one family that
 * order is semantic.
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

	$slots = desktop_mode_desktop_theme_texture_slots();
	// Slots that share one size token (the four window corners).
	// First declared wins; `ksort` above makes "first" deterministic.
	$size_groups = array();

	foreach ( $textures as $slot => $entry ) {
		if ( ! is_array( $entry ) || empty( $entry['path'] ) ) {
			continue;
		}
		$definition = isset( $slots[ $slot ] ) && is_array( $slots[ $slot ] ) ? $slots[ $slot ] : null;
		$prop       = $definition && ! empty( $definition['prop'] ) ? (string) $definition['prop'] : '';
		if ( '' === $prop ) {
			// A slot the allowlist accepts but gives no property to
			// write. Nothing to emit — see the filter docblock.
			continue;
		}
		$url = desktop_mode_desktop_theme_asset_url( $entry['path'], $base_url, $version );
		if ( '' === $url ) {
			continue;
		}
		$css_url = desktop_mode_desktop_theme_css_url( $url );
		$type    = isset( $definition['type'] ) ? (string) $definition['type'] : 'image';

		if ( 'border-image' === $type ) {
			$declarations[] = "\t{$prop}-source: {$css_url};";
			foreach ( array( 'slice', 'width', 'repeat' ) as $key ) {
				if ( ! empty( $entry[ $key ] ) ) {
					$declarations[] = "\t{$prop}-{$key}: {$entry[ $key ]};";
				}
			}
			continue;
		}

		$declarations[] = "\t{$prop}: {$css_url};";

		$size_group = ! empty( $definition['sizeGroup'] ) ? (string) $definition['sizeGroup'] : '';
		if ( '' !== $size_group ) {
			if ( ! isset( $size_groups[ $size_group ] ) && ! empty( $entry['size'] ) ) {
				$size_groups[ $size_group ] = (string) $entry['size'];
			}
			continue;
		}

		// `companions => false` marks a variant slot (TITLEBAR_FOCUSED)
		// that inherits its base slot's repeat + size.
		if ( isset( $definition['companions'] ) && false === $definition['companions'] ) {
			continue;
		}
		if ( ! empty( $entry['repeat'] ) ) {
			$declarations[] = "\t{$prop}-repeat: {$entry['repeat']};";
		}
		if ( ! empty( $entry['size'] ) ) {
			$declarations[] = "\t{$prop}-size: {$entry['size']};";
		}
		if ( ! empty( $entry['position'] ) ) {
			$declarations[] = "\t{$prop}-position: {$entry['position']};";
		}
	}

	foreach ( $size_groups as $property => $value ) {
		$declarations[] = "\t{$property}: {$value};";
	}

	$font_faces = desktop_mode_desktop_theme_compile_font_faces( $manifest, $base_url, $version );

	if ( empty( $declarations ) ) {
		return '' === $font_faces
			? ''
			: "/* Desktop Mode desktop theme: {$slug} — compiled, do not edit. */\n" . $font_faces;
	}

	// Re-sort so the emitted block is stable regardless of the order
	// the loops above happened to append in.
	sort( $declarations, SORT_STRING );

	$selector = '.desktop-mode-shell[data-desktop-mode-desktop-theme="' . $slug . '"],' . "\n"
		. 'body.desktop-mode-desktop-theme-' . $slug;

	return "/* Desktop Mode desktop theme: {$slug} — compiled, do not edit. */\n"
		. $font_faces
		. $selector . " {\n"
		. implode( "\n", $declarations ) . "\n"
		. "}\n";
}

/**
 * Compile a sanitized manifest's `fonts` block into `@font-face`
 * rules.
 *
 * Emitted before the token rule so a `font-family` declaration in
 * the same sheet can name a face defined above it — not that CSS
 * requires the order, but reading top-to-bottom should show the
 * faces before their first use.
 *
 * Descriptor order inside each rule is fixed by this function, and
 * faces keep the author's declaration order (which is meaningful:
 * `unicodeRange`-subsetted faces of the same family are matched in
 * source order).
 *
 * @since 0.9.8
 * @internal
 *
 * @param array  $manifest Sanitized manifest.
 * @param string $base_url Theme base URL (no trailing slash).
 * @param string $version  Cache-buster for relative refs.
 * @return string Stylesheet fragment, or `''` when there are no
 *                usable faces.
 */
function desktop_mode_desktop_theme_compile_font_faces( $manifest, $base_url = '', $version = '' ) {
	$fonts = isset( $manifest['fonts'] ) && is_array( $manifest['fonts'] )
		? $manifest['fonts']
		: array();
	if ( empty( $fonts ) ) {
		return '';
	}

	$rules = array();
	foreach ( $fonts as $face ) {
		if ( ! is_array( $face ) || empty( $face['family'] ) || empty( $face['src'] ) || ! is_array( $face['src'] ) ) {
			continue;
		}

		$sources = array();
		foreach ( $face['src'] as $source ) {
			if ( ! is_array( $source ) || empty( $source['path'] ) || empty( $source['format'] ) ) {
				continue;
			}
			$url = desktop_mode_desktop_theme_asset_url( $source['path'], $base_url, $version );
			if ( '' === $url ) {
				continue;
			}
			$sources[] = desktop_mode_desktop_theme_css_url( $url )
				. ' format("' . $source['format'] . '")';
		}
		if ( empty( $sources ) ) {
			continue;
		}

		// The family name is quoted, and the sanitizer guarantees it
		// contains nothing that could close the quote.
		$lines = array( "\tfont-family: \"{$face['family']}\";" );
		foreach ( array(
			'style'        => 'font-style',
			'weight'       => 'font-weight',
			'stretch'      => 'font-stretch',
			'display'      => 'font-display',
			'unicodeRange' => 'unicode-range',
		) as $key => $descriptor ) {
			if ( ! empty( $face[ $key ] ) ) {
				$lines[] = "\t{$descriptor}: {$face[ $key ]};";
			}
		}
		$lines[] = "\tsrc: " . implode( ",\n\t\t", $sources ) . ';';

		$rules[] = "@font-face {\n" . implode( "\n", $lines ) . "\n}\n";
	}

	return empty( $rules ) ? '' : implode( '', $rules );
}
