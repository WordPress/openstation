<?php
/**
 * Desktop Mode — Desktop-theme manifest sanitizer.
 *
 * Pure functions: no filesystem writes, no option reads. The one
 * dependency on the outside world is an injected `$asset_resolver`
 * callable, so the same sanitizer serves both intake paths:
 *
 *   - ZIP uploads pass a resolver that validates a path INSIDE the
 *     staging directory and hands back the theme-relative path.
 *   - Code registrations (`desktop_mode_register_desktop_theme()`)
 *     pass a resolver that validates an absolute http(s) URL.
 *
 * Both resolvers take the same two arguments —
 * `fn( string $path, string $kind ): string|false` — where `$kind`
 * is `'image'` or `'font'` and selects the extension allowlist. A
 * font reference can therefore never resolve through the icon path,
 * or vice versa.
 *
 * Validation posture, in two tiers:
 *
 *   - **Fatal** (returns `WP_Error`): `manifestVersion`, `id`,
 *     `name`. Without those there is no theme to speak of.
 *   - **Everything else drops and continues.** A bad token, a
 *     missing icon file, an unknown slot — the offending entry is
 *     removed and the rest of the theme installs. That IS the
 *     fallback contract: whatever the manifest doesn't say, the
 *     system default keeps saying.
 *
 * @package WPDesktopMode
 * @since   0.9.7
 */

defined( 'ABSPATH' ) || exit;

/**
 * Whether a token VALUE is safe to emit into a compiled stylesheet.
 *
 * The compiler writes `key: value;` declarations verbatim, so this
 * is the only thing standing between an author string and the
 * stylesheet. The rules:
 *
 *   - 1–256 characters.
 *   - Charset allowlist. `;` `{` `}` `@` `\` `<` `>` `!` and the
 *     backtick are simply not in it, which kills declaration
 *     escape, at-rule injection, `!important` overrides, and
 *     markup breakout in one stroke.
 *   - No CSS comment sequences (`/*`, `*​/`) — `/` and `*` are
 *     allowed individually because shorthand values need them.
 *   - No `url(`, `image-set(`, `element(`, `attr(`, `var(`, or
 *     `expression`. External references are PHP's job: the compiler
 *     generates every `url()` in the output itself from a resolved,
 *     `rawurlencode`d path. `var()` is banned so an author can't
 *     alias a property we didn't intend them to reach.
 *   - Balanced parentheses.
 *
 * @since 0.9.7
 *
 * @param mixed $value Candidate value.
 * @return bool
 */
function desktop_mode_desktop_theme_is_safe_css_value( $value ) {
	if ( ! is_string( $value ) ) {
		return false;
	}
	$value = trim( $value );
	if ( '' === $value || strlen( $value ) > 256 ) {
		return false;
	}
	if ( ! preg_match( '~^[A-Za-z0-9\s#%.,()/*+\-_\'"]+$~', $value ) ) {
		return false;
	}
	if ( false !== strpos( $value, '/*' ) || false !== strpos( $value, '*/' ) ) {
		return false;
	}
	$lower  = strtolower( $value );
	$banned = array( 'url(', 'image-set(', 'element(', 'attr(', 'var(', 'expression', 'javascript' );
	foreach ( $banned as $needle ) {
		if ( false !== strpos( $lower, $needle ) ) {
			return false;
		}
	}
	// Balanced parentheses, never negative.
	$depth = 0;
	$len   = strlen( $value );
	for ( $i = 0; $i < $len; $i++ ) {
		if ( '(' === $value[ $i ] ) {
			++$depth;
		} elseif ( ')' === $value[ $i ] ) {
			--$depth;
			if ( $depth < 0 ) {
				return false;
			}
		}
	}
	return 0 === $depth;
}

/**
 * Sanitize the `tokens` block: a map of custom-property name =>
 * value. Unknown property names and unsafe values drop.
 *
 * @since 0.9.7
 * @internal
 *
 * @param mixed $raw Raw `tokens` value.
 * @return array<string,string>
 */
function desktop_mode_sanitize_desktop_theme_tokens( $raw ) {
	if ( ! is_array( $raw ) ) {
		return array();
	}
	$out   = array();
	$count = 0;
	foreach ( $raw as $key => $value ) {
		if ( $count >= 512 ) {
			break;
		}
		if ( ! is_string( $key ) ) {
			continue;
		}
		$key = strtolower( trim( $key ) );
		// Three namespaces are themable:
		//
		//   --desktop-mode-*  the shell's own tokens (chrome, dock,
		//                     desktop, window frame).
		//   --wpd-*           the `<wpd-*>` component kit. Window
		//                     BODIES are built from those components,
		//                     and `--wpd-*` is the kit's documented
		//                     theming contract (see
		//                     `src/ui/core/tokens.ts`). Without this a
		//                     theme could restyle the chrome around a
		//                     window but not a single thing inside it.
		//   --wp-admin-theme-color
		//                     the one Core property the shell already
		//                     writes at runtime (the admin accent).
		//
		// Everything else is dropped: a theme must not be able to
		// reach properties the shell never meant to expose.
		if (
			'--wp-admin-theme-color' !== $key
			&& ! preg_match( '/^--desktop-mode-[a-z0-9-]+$/', $key )
			&& ! preg_match( '/^--wpd-[a-z0-9-]+$/', $key )
		) {
			continue;
		}
		if ( ! desktop_mode_desktop_theme_is_safe_css_value( $value ) ) {
			continue;
		}
		$out[ $key ] = trim( (string) $value );
		++$count;
	}
	return $out;
}

/**
 * Whether a value is usable as a CSS colour.
 *
 * Deliberately narrower than the general value grammar: this one is
 * painted as a fill, so a length or a gradient would be nonsense
 * rather than dangerous. Accepts `currentColor`, hex in all four
 * lengths, the functional notations, and bare keywords.
 *
 * `currentColor` is the interesting one — it means "whatever the
 * surface I land on is already using for text", which is how one
 * silhouette iconset stays legible on a dark dock, a light title bar,
 * and a red danger-hover without the author knowing any of them.
 *
 * @since 0.9.8
 *
 * @param mixed $value Candidate.
 * @return bool
 */
function desktop_mode_desktop_theme_is_color_value( $value ) {
	if ( ! is_string( $value ) ) {
		return false;
	}
	$value = trim( preg_replace( '/\s+/', ' ', $value ) );
	if ( '' === $value || strlen( $value ) > 64 ) {
		return false;
	}
	// The general grammar is still the floor — it is what bans `;`,
	// `{`, `@`, quotes, comments and `var()`.
	if ( ! desktop_mode_desktop_theme_is_safe_css_value( $value ) ) {
		return false;
	}
	if ( 0 === strcasecmp( 'currentcolor', $value ) ) {
		// Normalized to the spelling CSS authors expect to read back.
		return true;
	}
	if ( preg_match( '/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i', $value ) ) {
		return true;
	}
	if ( preg_match( '/^(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\([0-9a-z%.,\/ +-]+\)$/i', $value ) ) {
		return true;
	}
	// Bare keyword (`transparent`, `rebeccapurple`, …). Letters only,
	// so nothing else can hide in here.
	return (bool) preg_match( '/^[a-z]{3,24}$/i', $value );
}

/**
 * Sanitize the `icons` block: a map of slot => icon descriptor.
 *
 * Accepted descriptors:
 *   - `{ "type": "image",    "path": "icons/close.svg" }`
 *   - `{ "type": "dashicon", "name": "dashicons-no-alt" }`
 *
 * Either shape may carry `color`, which decides HOW the glyph is
 * painted, not just what colour it comes out:
 *
 *   - **absent** — today's behaviour. An image paints as an `<img>`
 *     and keeps the colours it was drawn with.
 *   - **present** — the glyph is tinted. A dashicon simply takes the
 *     colour; an image is painted as a `currentColor`-style CSS MASK,
 *     so only its alpha channel is used and the fill comes from here.
 *
 * That distinction is the whole point: a monochrome iconset drawn in
 * black is invisible on a dark dock as an `<img>`, and perfect as a
 * mask.
 *
 * @since 0.9.7
 * @since 0.9.8 `$default_color` + per-descriptor `color`.
 * @internal
 *
 * @param mixed    $raw            Raw `icons` value.
 * @param callable $asset_resolver `fn( string $path, string $kind ): string|false`.
 * @param string   $default_color  Manifest-level `iconColor`, applied
 *                                 to any icon that doesn't set its
 *                                 own. `''` for none.
 * @return array<string,array>
 */
function desktop_mode_sanitize_desktop_theme_icons( $raw, $asset_resolver, $default_color = '' ) {
	if ( ! is_array( $raw ) ) {
		return array();
	}
	$allowed = array_flip( array_map( 'strval', desktop_mode_desktop_theme_icon_slots() ) );
	$out     = array();
	$count   = 0;
	foreach ( $raw as $slot => $descriptor ) {
		if ( $count >= 256 ) {
			break;
		}
		if ( ! is_string( $slot ) ) {
			continue;
		}
		$slot = trim( $slot );
		// Either a known fixed slot, or the `APP:<slug>` pattern.
		$is_app = 0 === strpos( $slot, 'APP:' );
		if ( $is_app ) {
			$app_slug = sanitize_key( substr( $slot, 4 ) );
			if ( '' === $app_slug ) {
				continue;
			}
			$slot = 'APP:' . $app_slug;
		} elseif ( ! isset( $allowed[ $slot ] ) ) {
			continue;
		}

		if ( ! is_array( $descriptor ) ) {
			continue;
		}
		$type = isset( $descriptor['type'] ) ? (string) $descriptor['type'] : '';

		// `color` falls back to the manifest-wide `iconColor`. The
		// literal string `none` is the opt-OUT: it lets one icon in an
		// otherwise-tinted set keep its own colours (a brand mark, a
		// multi-colour app icon) without the author having to drop the
		// default for everything else.
		$color = '';
		if ( isset( $descriptor['color'] ) && is_string( $descriptor['color'] ) ) {
			$candidate = trim( $descriptor['color'] );
			if ( 0 === strcasecmp( 'none', $candidate ) ) {
				$color = 'none';
			} elseif ( desktop_mode_desktop_theme_is_color_value( $candidate ) ) {
				$color = desktop_mode_desktop_theme_normalize_color( $candidate );
			}
		}
		if ( '' === $color ) {
			$color = $default_color;
		}
		if ( 'none' === $color ) {
			$color = '';
		}

		if ( 'dashicon' === $type ) {
			$name = isset( $descriptor['name'] ) ? strtolower( trim( (string) $descriptor['name'] ) ) : '';
			if ( ! preg_match( '/^dashicons-[a-z0-9-]+$/', $name ) ) {
				continue;
			}
			$entry = array(
				'type' => 'dashicon',
				'name' => $name,
			);
			if ( '' !== $color ) {
				$entry['color'] = $color;
			}
			$out[ $slot ] = $entry;
			++$count;
			continue;
		}

		if ( 'image' === $type ) {
			$path = isset( $descriptor['path'] ) ? (string) $descriptor['path'] : '';
			$ref  = call_user_func( $asset_resolver, $path, 'image' );
			if ( ! is_string( $ref ) || '' === $ref ) {
				continue;
			}
			$entry = array(
				'type' => 'image',
				'path' => $ref,
			);
			if ( '' !== $color ) {
				$entry['color'] = $color;
			}
			$out[ $slot ] = $entry;
			++$count;
		}
	}
	return $out;
}

/**
 * Normalize a validated colour to its canonical spelling.
 *
 * Only `currentColor` actually changes: CSS is case-insensitive, but
 * the value is echoed back to theme authors through the payload and
 * the JS API, and `currentcolor` reads like a typo.
 *
 * @since 0.9.8
 * @internal
 *
 * @param string $value Validated colour.
 * @return string
 */
function desktop_mode_desktop_theme_normalize_color( $value ) {
	$value = trim( preg_replace( '/\s+/', ' ', (string) $value ) );
	return 0 === strcasecmp( 'currentcolor', $value ) ? 'currentColor' : $value;
}

/**
 * Whether a `background-size`-shaped value is well-formed.
 *
 * Accepts `auto` / `cover` / `contain`, or one-to-two length
 * components (`px`, `%`, `rem`, `em`, or the `auto` keyword).
 *
 * @since 0.9.7
 * @internal
 *
 * @param string $value Candidate.
 * @return bool
 */
function desktop_mode_desktop_theme_is_size_value( $value ) {
	$value = strtolower( trim( (string) $value ) );
	if ( in_array( $value, array( 'auto', 'cover', 'contain' ), true ) ) {
		return true;
	}
	$parts = preg_split( '/\s+/', $value );
	if ( ! is_array( $parts ) || count( $parts ) < 1 || count( $parts ) > 2 ) {
		return false;
	}
	foreach ( $parts as $part ) {
		if ( 'auto' === $part ) {
			continue;
		}
		if ( ! preg_match( '/^\d+(\.\d+)?(px|%|rem|em)$/', $part ) ) {
			return false;
		}
	}
	return true;
}

/**
 * Whether a `background-position`-shaped value is well-formed.
 *
 * Accepts one or two components, each a keyword (`left`, `center`,
 * `right`, `top`, `bottom`) or a length/percentage — including the
 * negative offsets a bleeding texture needs.
 *
 * `position` is what makes a big detailed texture usable rather than
 * merely present: `size: auto` + `repeat` tiles the artwork at its
 * true resolution, and `position` decides where the tiling grid
 * starts. Without it every texture is pinned to the same origin and
 * a motif can never be aligned to the surface it decorates.
 *
 * @since 0.9.8
 * @internal
 *
 * @param string $value Candidate.
 * @return bool
 */
function desktop_mode_desktop_theme_is_position_value( $value ) {
	$value = strtolower( trim( (string) $value ) );
	if ( '' === $value || strlen( $value ) > 64 ) {
		return false;
	}
	$parts = preg_split( '/\s+/', $value );
	if ( ! is_array( $parts ) || count( $parts ) < 1 || count( $parts ) > 2 ) {
		return false;
	}
	$keywords = array( 'left', 'right', 'top', 'bottom', 'center' );
	foreach ( $parts as $part ) {
		if ( in_array( $part, $keywords, true ) ) {
			continue;
		}
		// A bare `0` is a valid CSS length and the natural way to write
		// a flush edge, so it is accepted without a unit. Every other
		// number needs one.
		if ( preg_match( '/^-?(0|\d+(\.\d+)?(px|%|rem|em))$/', $part ) ) {
			continue;
		}
		return false;
	}
	return true;
}

/**
 * Sanitize the `textures` block: a map of slot => texture
 * descriptor. Each descriptor's `path` runs through the resolver;
 * every presentational property is grammar-checked against a closed
 * enum or a numeric pattern, never a free string.
 *
 * @since 0.9.7
 * @internal
 *
 * @param mixed    $raw            Raw `textures` value.
 * @param callable $asset_resolver `fn( string $path ): string|false`.
 * @return array<string,array>
 */
function desktop_mode_sanitize_desktop_theme_textures( $raw, $asset_resolver ) {
	if ( ! is_array( $raw ) ) {
		return array();
	}
	$slots  = desktop_mode_desktop_theme_texture_slots();
	$out    = array();
	$repeat = array( 'repeat', 'repeat-x', 'repeat-y', 'no-repeat', 'space', 'round' );

	foreach ( $raw as $slot => $descriptor ) {
		if ( ! is_string( $slot ) || ! isset( $slots[ $slot ] ) || ! is_array( $descriptor ) ) {
			continue;
		}
		$expected = isset( $slots[ $slot ]['type'] ) ? (string) $slots[ $slot ]['type'] : 'image';
		$type     = isset( $descriptor['type'] ) ? (string) $descriptor['type'] : $expected;
		if ( $type !== $expected ) {
			continue;
		}

		$path = isset( $descriptor['path'] ) ? (string) $descriptor['path'] : '';
		$ref  = call_user_func( $asset_resolver, $path );
		if ( ! is_string( $ref ) || '' === $ref ) {
			continue;
		}

		$entry = array(
			'type' => $type,
			'path' => $ref,
		);

		if ( 'border-image' === $type ) {
			// `slice` — 1–4 unitless numbers, optional trailing `fill`.
			if ( isset( $descriptor['slice'] ) && is_string( $descriptor['slice'] ) ) {
				$slice = strtolower( trim( preg_replace( '/\s+/', ' ', $descriptor['slice'] ) ) );
				if ( preg_match( '/^\d+( \d+){0,3}( fill)?$/', $slice ) ) {
					$entry['slice'] = $slice;
				}
			}
			// `width` — 1–4 lengths (unitless allowed: multiples of
			// the border width, per the border-image-width grammar).
			if ( isset( $descriptor['width'] ) && is_string( $descriptor['width'] ) ) {
				$width = strtolower( trim( preg_replace( '/\s+/', ' ', $descriptor['width'] ) ) );
				$parts = preg_split( '/ /', $width );
				if ( is_array( $parts ) && count( $parts ) >= 1 && count( $parts ) <= 4 ) {
					$ok = true;
					foreach ( $parts as $part ) {
						if ( ! preg_match( '/^\d+(\.\d+)?(px|%|rem|em)?$/', $part ) ) {
							$ok = false;
							break;
						}
					}
					if ( $ok ) {
						$entry['width'] = $width;
					}
				}
			}
			// `repeat` — 1–2 of the border-image-repeat keywords.
			if ( isset( $descriptor['repeat'] ) && is_string( $descriptor['repeat'] ) ) {
				$value = strtolower( trim( preg_replace( '/\s+/', ' ', $descriptor['repeat'] ) ) );
				$parts = preg_split( '/ /', $value );
				$allow = array( 'stretch', 'repeat', 'round', 'space' );
				if ( is_array( $parts ) && count( $parts ) >= 1 && count( $parts ) <= 2 ) {
					$ok = true;
					foreach ( $parts as $part ) {
						if ( ! in_array( $part, $allow, true ) ) {
							$ok = false;
							break;
						}
					}
					if ( $ok ) {
						$entry['repeat'] = $value;
					}
				}
			}
		} else {
			if ( isset( $descriptor['repeat'] ) && is_string( $descriptor['repeat'] ) ) {
				$value = strtolower( trim( $descriptor['repeat'] ) );
				if ( in_array( $value, $repeat, true ) ) {
					$entry['repeat'] = $value;
				}
			}
			if ( isset( $descriptor['size'] ) && is_string( $descriptor['size'] ) ) {
				$value = strtolower( trim( preg_replace( '/\s+/', ' ', $descriptor['size'] ) ) );
				if ( desktop_mode_desktop_theme_is_size_value( $value ) ) {
					$entry['size'] = $value;
				}
			}
			if ( isset( $descriptor['position'] ) && is_string( $descriptor['position'] ) ) {
				$value = strtolower( trim( preg_replace( '/\s+/', ' ', $descriptor['position'] ) ) );
				if ( desktop_mode_desktop_theme_is_position_value( $value ) ) {
					$entry['position'] = $value;
				}
			}
		}

		$out[ $slot ] = $entry;
	}
	return $out;
}

/**
 * Map a resolved font reference to its `format()` hint.
 *
 * The hint is DERIVED, never author-supplied: the extension already
 * passed the font allowlist, and deriving it removes one more free
 * string from the compiled output. Works on both a theme-relative
 * path and an absolute URL (whose query string is discarded first).
 *
 * @since 0.9.8
 * @internal
 *
 * @param string $ref Resolved reference.
 * @return string Format keyword, or `''` when unrecognised.
 */
function desktop_mode_desktop_theme_font_format( $ref ) {
	$ref  = (string) $ref;
	$path = $ref;
	if ( preg_match( '~^https?://~i', $ref ) ) {
		$path = (string) wp_parse_url( $ref, PHP_URL_PATH );
	}
	$formats = array(
		'woff2' => 'woff2',
		'woff'  => 'woff',
		'ttf'   => 'truetype',
		'otf'   => 'opentype',
	);
	$ext = strtolower( (string) pathinfo( $path, PATHINFO_EXTENSION ) );
	return isset( $formats[ $ext ] ) ? $formats[ $ext ] : '';
}

/**
 * Sanitize the `fonts` block: a list of `@font-face` descriptors.
 *
 * ```json
 * "fonts": [
 *   { "family": "Neon Grotesk", "weight": "400", "style": "normal",
 *     "display": "swap", "src": [ "fonts/neon.woff2", "fonts/neon.woff" ] }
 * ]
 * ```
 *
 * **Every field is a closed grammar, and `src` is the only one that
 * reaches the filesystem.** The family name is restricted hard
 * enough that the compiler can wrap it in double quotes and be done:
 * no quote, backslash, semicolon, or brace can appear in it, so
 * there is nothing to escape and no way out of the string. The
 * `format()` hint is derived from the extension rather than read
 * from the author, so a face contributes exactly two author-chosen
 * substrings to the stylesheet — the family name and the file path —
 * and both are constrained before they get there.
 *
 * Sanitization is drop-and-continue at every level: a face with no
 * usable source disappears, a bad `weight` falls back to the CSS
 * initial value, and the rest of the theme installs regardless.
 *
 * @since 0.9.8
 * @internal
 *
 * @param mixed    $raw            Raw `fonts` value.
 * @param callable $asset_resolver `fn( string $path, string $kind ): string|false`.
 * @return array<int,array>
 */
function desktop_mode_sanitize_desktop_theme_fonts( $raw, $asset_resolver ) {
	if ( ! is_array( $raw ) ) {
		return array();
	}
	$caps = desktop_mode_desktop_theme_font_caps();
	$out  = array();

	foreach ( $raw as $face ) {
		if ( count( $out ) >= $caps['max_faces'] ) {
			break;
		}
		if ( ! is_array( $face ) ) {
			continue;
		}

		// --- family. Quoted verbatim by the compiler, hence strict. ---
		$family = isset( $face['family'] ) && is_string( $face['family'] )
			? trim( preg_replace( '/\s+/', ' ', $face['family'] ) )
			: '';
		if ( ! preg_match( '/^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/', $family ) ) {
			continue;
		}

		// --- src. A string, or a list of strings, in preference order. ---
		$sources = array();
		$raw_src = isset( $face['src'] ) ? $face['src'] : null;
		if ( is_string( $raw_src ) ) {
			$raw_src = array( $raw_src );
		}
		if ( ! is_array( $raw_src ) ) {
			continue;
		}
		foreach ( $raw_src as $candidate ) {
			if ( count( $sources ) >= $caps['max_sources'] ) {
				break;
			}
			// Tolerate the `{ "path": … }` object shape too — it is what
			// icons and textures use, and authors reasonably assume it
			// generalizes.
			if ( is_array( $candidate ) && isset( $candidate['path'] ) ) {
				$candidate = $candidate['path'];
			}
			if ( ! is_string( $candidate ) ) {
				continue;
			}
			$ref = call_user_func( $asset_resolver, $candidate, 'font' );
			if ( ! is_string( $ref ) || '' === $ref ) {
				continue;
			}
			$format = desktop_mode_desktop_theme_font_format( $ref );
			if ( '' === $format ) {
				continue;
			}
			$sources[] = array(
				'path'   => $ref,
				'format' => $format,
			);
		}
		if ( empty( $sources ) ) {
			// A face with nothing to load is not a partially broken
			// face — it is no face at all.
			continue;
		}

		$entry = array(
			'family' => $family,
			'src'    => $sources,
		);

		// --- weight. One or two of `normal` / `bold` / 1–1000. ---
		if ( isset( $face['weight'] ) && ( is_string( $face['weight'] ) || is_int( $face['weight'] ) ) ) {
			$weight = strtolower( trim( preg_replace( '/\s+/', ' ', (string) $face['weight'] ) ) );
			$parts  = '' === $weight ? array() : explode( ' ', $weight );
			if ( count( $parts ) >= 1 && count( $parts ) <= 2 ) {
				$ok = true;
				foreach ( $parts as $part ) {
					if ( in_array( $part, array( 'normal', 'bold' ), true ) ) {
						continue;
					}
					if ( preg_match( '/^\d{1,4}$/', $part ) && (int) $part >= 1 && (int) $part <= 1000 ) {
						continue;
					}
					$ok = false;
					break;
				}
				if ( $ok ) {
					$entry['weight'] = $weight;
				}
			}
		}

		// --- style / display / stretch. Closed enums. ---
		if ( isset( $face['style'] ) && is_string( $face['style'] ) ) {
			$style = strtolower( trim( $face['style'] ) );
			if ( in_array( $style, array( 'normal', 'italic', 'oblique' ), true ) ) {
				$entry['style'] = $style;
			}
		}
		if ( isset( $face['display'] ) && is_string( $face['display'] ) ) {
			$display = strtolower( trim( $face['display'] ) );
			if ( in_array( $display, array( 'auto', 'block', 'swap', 'fallback', 'optional' ), true ) ) {
				$entry['display'] = $display;
			}
		}
		if ( isset( $face['stretch'] ) && is_string( $face['stretch'] ) ) {
			$stretch  = strtolower( trim( preg_replace( '/\s+/', ' ', $face['stretch'] ) ) );
			$keywords = array(
				'ultra-condensed',
				'extra-condensed',
				'condensed',
				'semi-condensed',
				'normal',
				'semi-expanded',
				'expanded',
				'extra-expanded',
				'ultra-expanded',
			);
			$parts    = '' === $stretch ? array() : explode( ' ', $stretch );
			if ( count( $parts ) >= 1 && count( $parts ) <= 2 ) {
				$ok = true;
				foreach ( $parts as $part ) {
					if ( in_array( $part, $keywords, true ) ) {
						continue;
					}
					if ( preg_match( '/^\d{1,3}(\.\d+)?%$/', $part ) ) {
						continue;
					}
					$ok = false;
					break;
				}
				if ( $ok ) {
					$entry['stretch'] = $stretch;
				}
			}
		}

		// --- unicodeRange. Subsetted faces live and die by this one. ---
		if ( isset( $face['unicodeRange'] ) && is_string( $face['unicodeRange'] ) ) {
			$range = strtoupper( trim( preg_replace( '/\s+/', ' ', $face['unicodeRange'] ) ) );
			if (
				strlen( $range ) <= 512
				&& preg_match( '/^U\+[0-9A-F?]{1,6}(-[0-9A-F]{1,6})?( ?, ?U\+[0-9A-F?]{1,6}(-[0-9A-F]{1,6})?){0,31}$/', $range )
			) {
				$entry['unicodeRange'] = $range;
			}
		}

		$out[] = $entry;
	}

	return $out;
}

/**
 * Sanitize a whole `theme.json` manifest.
 *
 * @since 0.9.7
 *
 * @param mixed    $raw            Decoded manifest.
 * @param callable $asset_resolver `fn( string $path, string $kind ): string|false`.
 *                                 Returns the reference the compiler
 *                                 should emit (theme-relative path
 *                                 for uploads, absolute URL for code
 *                                 registrations), or `false` to drop.
 *                                 `$kind` is `'image'` or `'font'`
 *                                 and selects the extension
 *                                 allowlist.
 * @return array|WP_Error Sanitized manifest, or `WP_Error` when a
 *                        structural field is missing/invalid.
 */
function desktop_mode_sanitize_desktop_theme_manifest( $raw, $asset_resolver ) {
	if ( ! is_array( $raw ) ) {
		return new WP_Error(
			'desktop_mode_desktop_theme_invalid_manifest',
			__( 'The theme manifest is not a JSON object.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	if ( ! is_callable( $asset_resolver ) ) {
		return new WP_Error(
			'desktop_mode_desktop_theme_invalid_resolver',
			__( 'No asset resolver was provided for this manifest.', 'desktop-mode' ),
			array( 'status' => 500 )
		);
	}

	// --- Fatal fields. ---
	$version_field = isset( $raw['manifestVersion'] ) ? $raw['manifestVersion'] : null;
	if ( 1 !== (int) $version_field || ! is_numeric( $version_field ) ) {
		return new WP_Error(
			'desktop_mode_desktop_theme_bad_version',
			__( 'Unsupported theme manifest version. Expected "manifestVersion": 1.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$id = isset( $raw['id'] ) && is_string( $raw['id'] ) ? trim( $raw['id'] ) : '';
	if ( '' === $id || strlen( $id ) > 64 || ! preg_match( '~^[a-z0-9_-]+(/[a-z0-9_-]+)?$~', $id ) ) {
		return new WP_Error(
			'desktop_mode_desktop_theme_bad_id',
			__( 'The theme id must look like "neon-glass" or "vendor/neon-glass" (lowercase, max 64 characters).', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	$slug = desktop_mode_desktop_theme_slug_from_id( $id );
	if ( '' === $slug ) {
		return new WP_Error(
			'desktop_mode_desktop_theme_bad_id',
			__( 'The theme id does not reduce to a usable slug.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$name = isset( $raw['name'] ) && is_string( $raw['name'] ) ? sanitize_text_field( $raw['name'] ) : '';
	if ( '' === $name ) {
		return new WP_Error(
			'desktop_mode_desktop_theme_missing_name',
			__( 'The theme manifest requires a non-empty "name".', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	// --- Everything below drops-and-continues. ---
	$preview     = '';
	$preview_raw = isset( $raw['preview'] ) && is_string( $raw['preview'] ) ? $raw['preview'] : '';
	if ( '' !== $preview_raw ) {
		$resolved = call_user_func( $asset_resolver, $preview_raw );
		if ( is_string( $resolved ) && '' !== $resolved ) {
			$preview = $resolved;
		}
	}

	// Manifest-wide icon tint. Applied to every icon that doesn't set
	// its own `color`, so a monochrome iconset is one line rather than
	// twenty-odd repetitions.
	$icon_color = '';
	if ( isset( $raw['iconColor'] ) && desktop_mode_desktop_theme_is_color_value( $raw['iconColor'] ) ) {
		$icon_color = desktop_mode_desktop_theme_normalize_color( $raw['iconColor'] );
	}

	$manifest = array(
		'manifestVersion' => 1,
		'id'              => $id,
		'slug'            => $slug,
		'name'            => mb_substr( $name, 0, 120 ),
		'version'         => isset( $raw['version'] ) && is_string( $raw['version'] )
			? mb_substr( sanitize_text_field( $raw['version'] ), 0, 32 )
			: '',
		'author'          => isset( $raw['author'] ) && is_string( $raw['author'] )
			? mb_substr( sanitize_text_field( $raw['author'] ), 0, 120 )
			: '',
		'description'     => isset( $raw['description'] ) && is_string( $raw['description'] )
			? mb_substr( sanitize_textarea_field( $raw['description'] ), 0, 500 )
			: '',
		'preview'         => $preview,
		'tokens'          => desktop_mode_sanitize_desktop_theme_tokens(
			isset( $raw['tokens'] ) ? $raw['tokens'] : null
		),
		'iconColor'       => $icon_color,
		'icons'           => desktop_mode_sanitize_desktop_theme_icons(
			isset( $raw['icons'] ) ? $raw['icons'] : null,
			$asset_resolver,
			$icon_color
		),
		'textures'        => desktop_mode_sanitize_desktop_theme_textures(
			isset( $raw['textures'] ) ? $raw['textures'] : null,
			$asset_resolver
		),
		'fonts'           => desktop_mode_sanitize_desktop_theme_fonts(
			isset( $raw['fonts'] ) ? $raw['fonts'] : null,
			$asset_resolver
		),
	);

	/**
	 * Filters a sanitized desktop-theme manifest just before it is
	 * compiled and stored.
	 *
	 * Runs AFTER every value has been validated. Anything added here
	 * bypasses the sanitizer, so treat it as trusted-code territory —
	 * values land in the compiled stylesheet verbatim.
	 *
	 * @since 0.9.7
	 *
	 * @param array  $manifest Sanitized manifest.
	 * @param array  $raw      The manifest as the author wrote it.
	 * @param string $slug     Storage slug derived from `id`.
	 */
	$manifest = (array) apply_filters( 'desktop_mode_desktop_theme_manifest', $manifest, $raw, $slug );

	return $manifest;
}

/**
 * Build an asset resolver that validates paths inside a staging
 * directory and returns the theme-relative path.
 *
 * Rejects absolute paths, traversal, backslashes, NUL bytes, and
 * anything whose extension isn't allowed for the requested asset
 * kind. Uses `realpath()` containment as the final gate so a symlink
 * planted inside the ZIP can't point outward.
 *
 * @since 0.9.7
 *
 * @param string $staging_dir Absolute path of the extracted ZIP.
 * @return callable `fn( string $path, string $kind = 'image' ): string|false`
 */
function desktop_mode_desktop_theme_staging_asset_resolver( $staging_dir ) {
	$base = realpath( $staging_dir );
	return static function ( $path, $kind = 'image' ) use ( $base ) {
		if ( false === $base || ! is_string( $path ) ) {
			return false;
		}
		$path = trim( $path );
		if ( '' === $path || strlen( $path ) > 255 ) {
			return false;
		}
		if ( false !== strpos( $path, "\0" ) || false !== strpos( $path, '\\' ) ) {
			return false;
		}
		if ( '/' === $path[0] || preg_match( '~^[a-zA-Z]:~', $path ) ) {
			return false;
		}
		foreach ( explode( '/', $path ) as $segment ) {
			if ( '' === $segment || '.' === $segment || '..' === $segment ) {
				return false;
			}
		}
		$ext = strtolower( (string) pathinfo( $path, PATHINFO_EXTENSION ) );
		if ( ! in_array( $ext, desktop_mode_desktop_theme_asset_extensions( $kind ), true ) ) {
			return false;
		}
		$full = realpath( $base . '/' . $path );
		if ( false === $full || ! is_file( $full ) ) {
			return false;
		}
		if ( 0 !== strpos( $full, $base . DIRECTORY_SEPARATOR ) ) {
			return false;
		}
		return $path;
	};
}

/**
 * Build an asset resolver for code-registered themes, whose assets
 * are already-published http(s) URLs rather than files in a ZIP.
 *
 * @since 0.9.7
 *
 * @return callable `fn( string $url, string $kind = 'image' ): string|false`
 */
function desktop_mode_desktop_theme_url_asset_resolver() {
	return static function ( $url, $kind = 'image' ) {
		if ( ! is_string( $url ) ) {
			return false;
		}
		$url = trim( $url );
		// Require the scheme on the RAW input, before `esc_url_raw()`
		// gets a chance to invent one: given `icons/relative.svg` it
		// helpfully returns `http://icons/relative.svg`, which would
		// sail through a post-hoc scheme check and compile into a
		// `url()` pointing at a host called "icons". A code theme's
		// assets have to be fully qualified — the compiler emits them
		// verbatim, with no base to join against.
		if ( ! preg_match( '~^https?://~i', $url ) ) {
			return false;
		}
		$url = esc_url_raw( $url, array( 'http', 'https' ) );
		if ( '' === $url ) {
			return false;
		}
		$path = (string) wp_parse_url( $url, PHP_URL_PATH );
		$ext  = strtolower( (string) pathinfo( $path, PATHINFO_EXTENSION ) );
		if ( ! in_array( $ext, desktop_mode_desktop_theme_asset_extensions( $kind ), true ) ) {
			return false;
		}
		return $url;
	};
}
