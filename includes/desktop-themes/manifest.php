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
 * Sanitize the `icons` block: a map of slot => icon descriptor.
 *
 * Accepted descriptors:
 *   - `{ "type": "image",    "path": "icons/close.svg" }`
 *   - `{ "type": "dashicon", "name": "dashicons-no-alt" }`
 *
 * @since 0.9.7
 * @internal
 *
 * @param mixed    $raw            Raw `icons` value.
 * @param callable $asset_resolver `fn( string $path ): string|false`.
 * @return array<string,array>
 */
function desktop_mode_sanitize_desktop_theme_icons( $raw, $asset_resolver ) {
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

		if ( 'dashicon' === $type ) {
			$name = isset( $descriptor['name'] ) ? strtolower( trim( (string) $descriptor['name'] ) ) : '';
			if ( ! preg_match( '/^dashicons-[a-z0-9-]+$/', $name ) ) {
				continue;
			}
			$out[ $slot ] = array(
				'type' => 'dashicon',
				'name' => $name,
			);
			++$count;
			continue;
		}

		if ( 'image' === $type ) {
			$path = isset( $descriptor['path'] ) ? (string) $descriptor['path'] : '';
			$ref  = call_user_func( $asset_resolver, $path );
			if ( ! is_string( $ref ) || '' === $ref ) {
				continue;
			}
			$out[ $slot ] = array(
				'type' => 'image',
				'path' => $ref,
			);
			++$count;
		}
	}
	return $out;
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
		}

		$out[ $slot ] = $entry;
	}
	return $out;
}

/**
 * Sanitize a whole `theme.json` manifest.
 *
 * @since 0.9.7
 *
 * @param mixed    $raw            Decoded manifest.
 * @param callable $asset_resolver `fn( string $path ): string|false`.
 *                                 Returns the reference the compiler
 *                                 should emit (theme-relative path
 *                                 for uploads, absolute URL for code
 *                                 registrations), or `false` to drop.
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
		'icons'           => desktop_mode_sanitize_desktop_theme_icons(
			isset( $raw['icons'] ) ? $raw['icons'] : null,
			$asset_resolver
		),
		'textures'        => desktop_mode_sanitize_desktop_theme_textures(
			isset( $raw['textures'] ) ? $raw['textures'] : null,
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
 * anything whose extension isn't an allowed image type. Uses
 * `realpath()` containment as the final gate so a symlink planted
 * inside the ZIP can't point outward.
 *
 * @since 0.9.7
 *
 * @param string $staging_dir Absolute path of the extracted ZIP.
 * @return callable `fn( string $path ): string|false`
 */
function desktop_mode_desktop_theme_staging_asset_resolver( $staging_dir ) {
	$base = realpath( $staging_dir );
	return static function ( $path ) use ( $base ) {
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
		if ( ! in_array( $ext, array( 'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg' ), true ) ) {
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
 * @return callable `fn( string $url ): string|false`
 */
function desktop_mode_desktop_theme_url_asset_resolver() {
	return static function ( $url ) {
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
		if ( ! in_array( $ext, array( 'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg' ), true ) ) {
			return false;
		}
		return $url;
	};
}
