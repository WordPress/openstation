<?php

defined( 'ABSPATH' ) || exit;

function openstation_desktop_theme_is_safe_css_value( $value ) {
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

function openstation_sanitize_desktop_theme_tokens( $raw ) {
	if ( ! is_array( $raw ) ) {
		return array();
	}
	$out   = array();
	$count = 0;
	foreach ( $raw as $key => $value ) {

		if ( $count >= 2048 ) {
			break;
		}
		if ( ! is_string( $key ) ) {
			continue;
		}
		$key = strtolower( trim( $key ) );

		if (
			'--wp-admin-theme-color' !== $key
			&& ! preg_match( '/^--os-[a-z0-9-]+$/', $key )
			&& ! preg_match( '/^--os-ui-[a-z0-9-]+$/', $key )
		) {
			continue;
		}
		if ( ! openstation_desktop_theme_is_safe_css_value( $value ) ) {
			continue;
		}
		$out[ $key ] = trim( (string) $value );
		++$count;
	}
	return $out;
}

function openstation_desktop_theme_is_color_value( $value ) {
	if ( ! is_string( $value ) ) {
		return false;
	}
	$value = trim( preg_replace( '/\s+/', ' ', $value ) );
	if ( '' === $value || strlen( $value ) > 64 ) {
		return false;
	}

	if ( ! openstation_desktop_theme_is_safe_css_value( $value ) ) {
		return false;
	}
	if ( 0 === strcasecmp( 'currentcolor', $value ) ) {

		return true;
	}
	if ( preg_match( '/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i', $value ) ) {
		return true;
	}
	if ( preg_match( '/^(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\([0-9a-z%.,\/ +-]+\)$/i', $value ) ) {
		return true;
	}

	return (bool) preg_match( '/^[a-z]{3,24}$/i', $value );
}

function openstation_sanitize_desktop_theme_icons( $raw, $asset_resolver, $default_color = '' ) {
	if ( ! is_array( $raw ) ) {
		return array();
	}
	$allowed = array_flip( array_map( 'strval', openstation_desktop_theme_icon_slots() ) );
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

		$color = '';
		if ( isset( $descriptor['color'] ) && is_string( $descriptor['color'] ) ) {
			$candidate = trim( $descriptor['color'] );
			if ( 0 === strcasecmp( 'none', $candidate ) ) {
				$color = 'none';
			} elseif ( openstation_desktop_theme_is_color_value( $candidate ) ) {
				$color = openstation_desktop_theme_normalize_color( $candidate );
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

function openstation_desktop_theme_normalize_color( $value ) {
	$value = trim( preg_replace( '/\s+/', ' ', (string) $value ) );
	return 0 === strcasecmp( 'currentcolor', $value ) ? 'currentColor' : $value;
}

function openstation_desktop_theme_is_size_value( $value ) {
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

function openstation_desktop_theme_is_position_value( $value ) {
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

		if ( preg_match( '/^-?(0|\d+(\.\d+)?(px|%|rem|em))$/', $part ) ) {
			continue;
		}
		return false;
	}
	return true;
}

function openstation_sanitize_desktop_theme_textures( $raw, $asset_resolver ) {
	if ( ! is_array( $raw ) ) {
		return array();
	}
	$slots  = openstation_desktop_theme_texture_slots();
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

			if ( isset( $descriptor['slice'] ) && is_string( $descriptor['slice'] ) ) {
				$slice = strtolower( trim( preg_replace( '/\s+/', ' ', $descriptor['slice'] ) ) );
				if ( preg_match( '/^\d+( \d+){0,3}( fill)?$/', $slice ) ) {
					$entry['slice'] = $slice;
				}
			}

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
				if ( openstation_desktop_theme_is_size_value( $value ) ) {
					$entry['size'] = $value;
				}
			}
			if ( isset( $descriptor['position'] ) && is_string( $descriptor['position'] ) ) {
				$value = strtolower( trim( preg_replace( '/\s+/', ' ', $descriptor['position'] ) ) );
				if ( openstation_desktop_theme_is_position_value( $value ) ) {
					$entry['position'] = $value;
				}
			}
		}

		$out[ $slot ] = $entry;
	}
	return $out;
}

function openstation_desktop_theme_font_format( $ref ) {
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
	$ext     = strtolower( (string) pathinfo( $path, PATHINFO_EXTENSION ) );
	return isset( $formats[ $ext ] ) ? $formats[ $ext ] : '';
}

function openstation_sanitize_desktop_theme_fonts( $raw, $asset_resolver ) {
	if ( ! is_array( $raw ) ) {
		return array();
	}
	$caps = openstation_desktop_theme_font_caps();
	$out  = array();

	foreach ( $raw as $face ) {
		if ( count( $out ) >= $caps['max_faces'] ) {
			break;
		}
		if ( ! is_array( $face ) ) {
			continue;
		}

		$family = isset( $face['family'] ) && is_string( $face['family'] )
			? trim( preg_replace( '/\s+/', ' ', $face['family'] ) )
			: '';
		if ( ! preg_match( '/^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/', $family ) ) {
			continue;
		}

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
			$format = openstation_desktop_theme_font_format( $ref );
			if ( '' === $format ) {
				continue;
			}
			$sources[] = array(
				'path'   => $ref,
				'format' => $format,
			);
		}
		if ( empty( $sources ) ) {

			continue;
		}

		$entry = array(
			'family' => $family,
			'src'    => $sources,
		);

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

function openstation_sanitize_desktop_theme_wallpapers( $raw, $asset_resolver ) {
	if ( is_string( $raw ) ) {
		$raw = array( array( 'path' => $raw ) );
	} elseif ( is_array( $raw ) && isset( $raw['path'] ) ) {

		$raw = array( $raw );
	}
	if ( ! is_array( $raw ) ) {
		return array();
	}

	$max  = max( 1, (int) apply_filters( 'openstation_desktop_theme_max_wallpapers', 12 ) );
	$out  = array();
	$seen = array();

	foreach ( $raw as $key => $entry ) {
		if ( count( $out ) >= $max ) {
			break;
		}
		if ( is_string( $entry ) ) {
			$entry = array( 'path' => $entry );
		}
		if ( ! is_array( $entry ) ) {
			continue;
		}

		$path = isset( $entry['path'] ) ? (string) $entry['path'] : '';
		$ref  = call_user_func( $asset_resolver, $path, 'image' );
		if ( ! is_string( $ref ) || '' === $ref ) {
			continue;
		}

		$label = isset( $entry['label'] ) && is_string( $entry['label'] )
			? mb_substr( sanitize_text_field( $entry['label'] ), 0, 80 )
			: '';

		$id = '';
		if ( isset( $entry['id'] ) && is_string( $entry['id'] ) ) {
			$id = sanitize_title( $entry['id'] );
		}
		if ( '' === $id && is_string( $key ) ) {
			$id = sanitize_title( $key );
		}
		if ( '' === $id && '' !== $label ) {
			$id = sanitize_title( $label );
		}
		if ( '' === $id ) {
			$id = sanitize_title( (string) pathinfo( $path, PATHINFO_FILENAME ) );
		}
		if ( '' === $id || isset( $seen[ $id ] ) ) {
			continue;
		}
		$seen[ $id ] = true;

		$item = array(
			'id'    => $id,
			'label' => $label,
			'path'  => $ref,
		);

		if ( isset( $entry['repeat'] ) && is_string( $entry['repeat'] ) ) {
			$value = strtolower( trim( $entry['repeat'] ) );
			if ( in_array( $value, array( 'repeat', 'repeat-x', 'repeat-y', 'no-repeat', 'space', 'round' ), true ) ) {
				$item['repeat'] = $value;
			}
		}
		if ( isset( $entry['size'] ) && is_string( $entry['size'] ) ) {
			$value = strtolower( trim( preg_replace( '/\s+/', ' ', $entry['size'] ) ) );
			if ( openstation_desktop_theme_is_size_value( $value ) ) {
				$item['size'] = $value;
			}
		}
		if ( isset( $entry['position'] ) && is_string( $entry['position'] ) ) {
			$value = strtolower( trim( preg_replace( '/\s+/', ' ', $entry['position'] ) ) );
			if ( openstation_desktop_theme_is_position_value( $value ) ) {
				$item['position'] = $value;
			}
		}
		if ( isset( $entry['description'] ) && is_string( $entry['description'] ) ) {
			$item['description'] = mb_substr( sanitize_textarea_field( $entry['description'] ), 0, 500 );
		}

		$out[] = $item;
	}

	return $out;
}

function openstation_sanitize_desktop_theme_recommended_os_settings( $raw ) {
	if ( ! is_array( $raw ) ) {
		return array();
	}
	$schema = openstation_desktop_theme_recommended_os_settings_schema();
	$out    = array();
	foreach ( $schema as $key => $rule ) {
		if ( ! isset( $raw[ $key ] ) ) {
			continue;
		}

		if ( isset( $rule['int'] ) ) {
			if ( ! is_numeric( $raw[ $key ] ) ) {
				continue;
			}
			$out[ $key ] = max(
				(int) $rule['int']['min'],
				min( (int) $rule['int']['max'], (int) round( (float) $raw[ $key ] ) )
			);
			continue;
		}
		if ( ! is_string( $raw[ $key ] ) ) {
			continue;
		}
		$value = trim( $raw[ $key ] );
		if ( '' === $value ) {
			continue;
		}
		if ( isset( $rule['enum'] ) ) {
			if ( in_array( $value, $rule['enum'], true ) ) {
				$out[ $key ] = $value;
			}
			continue;
		}

		$slug = sanitize_key( $value );
		if ( '' !== $slug ) {
			$out[ $key ] = $slug;
		}
	}
	return $out;
}

function openstation_sanitize_desktop_theme_manifest( $raw, $asset_resolver ) {
	if ( ! is_array( $raw ) ) {
		return new WP_Error(
			'openstation_desktop_theme_invalid_manifest',
			__( 'The theme manifest is not a JSON object.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	if ( ! is_callable( $asset_resolver ) ) {
		return new WP_Error(
			'openstation_desktop_theme_invalid_resolver',
			__( 'No asset resolver was provided for this manifest.', 'desktop-mode' ),
			array( 'status' => 500 )
		);
	}

	$version_field = isset( $raw['manifestVersion'] ) ? $raw['manifestVersion'] : null;
	$version       = is_numeric( $version_field ) ? (int) $version_field : 0;
	if ( ! in_array( $version, array( 1, 2 ), true ) ) {
		return new WP_Error(
			'openstation_desktop_theme_bad_version',
			__( 'Unsupported theme manifest version. Expected "manifestVersion": 1 or 2.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$id = isset( $raw['id'] ) && is_string( $raw['id'] ) ? trim( $raw['id'] ) : '';
	if ( '' === $id || strlen( $id ) > 64 || ! preg_match( '~^[a-z0-9_-]+(/[a-z0-9_-]+)?$~', $id ) ) {
		return new WP_Error(
			'openstation_desktop_theme_bad_id',
			__( 'The theme id must look like "neon-glass" or "vendor/neon-glass" (lowercase, max 64 characters).', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	$slug = openstation_desktop_theme_slug_from_id( $id );
	if ( '' === $slug ) {
		return new WP_Error(
			'openstation_desktop_theme_bad_id',
			__( 'The theme id does not reduce to a usable slug.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$name = isset( $raw['name'] ) && is_string( $raw['name'] ) ? sanitize_text_field( $raw['name'] ) : '';
	if ( '' === $name ) {
		return new WP_Error(
			'openstation_desktop_theme_missing_name',
			__( 'The theme manifest requires a non-empty "name".', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$preview     = '';
	$preview_raw = isset( $raw['preview'] ) && is_string( $raw['preview'] ) ? $raw['preview'] : '';
	if ( '' !== $preview_raw ) {
		$resolved = call_user_func( $asset_resolver, $preview_raw );
		if ( is_string( $resolved ) && '' !== $resolved ) {
			$preview = $resolved;
		}
	}

	$icon_color = '';
	if ( isset( $raw['iconColor'] ) && openstation_desktop_theme_is_color_value( $raw['iconColor'] ) ) {
		$icon_color = openstation_desktop_theme_normalize_color( $raw['iconColor'] );
	}

	$manifest = array(
		'manifestVersion'       => $version,
		'id'                    => $id,
		'slug'                  => $slug,
		'name'                  => mb_substr( $name, 0, 120 ),
		'version'               => isset( $raw['version'] ) && is_string( $raw['version'] )
			? mb_substr( sanitize_text_field( $raw['version'] ), 0, 32 )
			: '',
		'author'                => isset( $raw['author'] ) && is_string( $raw['author'] )
			? mb_substr( sanitize_text_field( $raw['author'] ), 0, 120 )
			: '',
		'description'           => isset( $raw['description'] ) && is_string( $raw['description'] )
			? mb_substr( sanitize_textarea_field( $raw['description'] ), 0, 500 )
			: '',
		'preview'               => $preview,
		'tokens'                => openstation_sanitize_desktop_theme_tokens(
			isset( $raw['tokens'] ) ? $raw['tokens'] : null
		),
		'iconColor'             => $icon_color,
		'icons'                 => openstation_sanitize_desktop_theme_icons(
			isset( $raw['icons'] ) ? $raw['icons'] : null,
			$asset_resolver,
			$icon_color
		),
		'textures'              => openstation_sanitize_desktop_theme_textures(
			isset( $raw['textures'] ) ? $raw['textures'] : null,
			$asset_resolver
		),
		'fonts'                 => openstation_sanitize_desktop_theme_fonts(
			isset( $raw['fonts'] ) ? $raw['fonts'] : null,
			$asset_resolver
		),

		'wallpapers'            => openstation_sanitize_desktop_theme_wallpapers(
			isset( $raw['wallpapers'] ) ? $raw['wallpapers'] : (
				isset( $raw['wallpaper'] ) ? $raw['wallpaper'] : null
			),
			$asset_resolver
		),

		'recommendedOsSettings' => openstation_sanitize_desktop_theme_recommended_os_settings(
			isset( $raw['recommendedOsSettings'] ) ? $raw['recommendedOsSettings'] : null
		),
	);

	$manifest = (array) apply_filters( 'openstation_desktop_theme_manifest', $manifest, $raw, $slug );

	return $manifest;
}

function openstation_desktop_theme_staging_asset_resolver( $staging_dir ) {
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
		if ( ! in_array( $ext, openstation_desktop_theme_asset_extensions( $kind ), true ) ) {
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

function openstation_desktop_theme_url_asset_resolver() {
	return static function ( $url, $kind = 'image' ) {
		if ( ! is_string( $url ) ) {
			return false;
		}
		$url = trim( $url );

		if ( ! preg_match( '~^https?://~i', $url ) ) {
			return false;
		}
		$url = esc_url_raw( $url, array( 'http', 'https' ) );
		if ( '' === $url ) {
			return false;
		}
		$path = (string) wp_parse_url( $url, PHP_URL_PATH );
		$ext  = strtolower( (string) pathinfo( $path, PATHINFO_EXTENSION ) );
		if ( ! in_array( $ext, openstation_desktop_theme_asset_extensions( $kind ), true ) ) {
			return false;
		}
		return $url;
	};
}
