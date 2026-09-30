<?php
/**
 * OpenStation — Workspaces.
 *
 * A virtual desktop ("Space") is a container for windows. A workspace
 * is that container plus the answer to "what is this desk FOR": which
 * apps belong on it, which windows it opens with, and how they are
 * arranged. That answer is the desktop's `profile`, and it rides along
 * with the desktop through {@see openstation_sanitize_session()}.
 *
 * This file sanitizes a profile arriving from the client. The session
 * is user meta written from an untrusted payload, so every field is
 * bounded here and nowhere else. A workspace is made by saving a desk
 * (`src/workspaces/`); sharing one is `includes/workspace-shares/`.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/** Hard cap on apps named by one workspace's visible set. */
const OPENSTATION_WORKSPACE_MAX_APPS = 128;

/** Hard cap on widgets named by one workspace's column. */
const OPENSTATION_WORKSPACE_MAX_WIDGETS = 32;


/** Hard cap on windows one workspace opens with. */
const OPENSTATION_WORKSPACE_MAX_WINDOWS = 12;

/** Arrangements a workspace's `layout` may name. Mirrors `WORKSPACE_LAYOUTS`. */
const OPENSTATION_WORKSPACE_LAYOUTS = array( 'free', 'cascade', 'tile', 'columns', 'focus' );

/**
 * Settings a workspace's `appearance` patch may carry: EVERY OpenStation
 * setting, except the shell's own theme-seeding ledger.
 *
 * Derived from the defaults, so a setting added later is overridable
 * the day it ships. The client derives its list the same way
 * (`WORKSPACE_APPEARANCE_KEYS`, from `DEFAULTS`), so neither can drift.
 *
 * @return string[]
 */
function openstation_workspace_setting_keys() {
	return array_values( array_diff( array_keys( openstation_default_os_settings() ), array( 'appliedThemeRecommendations' ) ) );
}

/**
 * Settings that are only cosmetic — how the desk looks, never what it
 * does.
 *
 * For a user a shared workspace PINS, these are where the workspace
 * starts them, not where it keeps them: they are copied into the
 * user's own settings when the link is claimed, and the user may
 * change them after. Every other setting stays the workspace's while
 * the user is pinned.
 *
 * @return string[]
 */
function openstation_workspace_cosmetic_setting_keys() {
	/**
	 * Filters which settings a pinned user may change for themselves.
	 *
	 * @param string[] $keys Settings keys. Default: wallpaper, accent,
	 *                       theme, window corners, reveals, the unfocus
	 *                       effect, window-link visuals, Mio, the rail
	 *                       renderer and the post-status ribbons.
	 */
	return array_values(
		array_intersect(
			(array) apply_filters(
				'openstation_workspace_cosmetic_settings',
				array(
					'wallpaper',
					'wallpaperSettings',
					'customGradient',
					'customImage',
					'accent',
					'customAccent',
					'desktopTheme',
					'windowRadius',
					'windowReveal',
					'windowRevealDuration',
					'unfocusEffect',
					'windowLinkRenderer',
					'windowLinkVisibility',
					'windowLinkHighlight',
					'dockRailRenderer',
					'mioEnabled',
					'mioShowOnWallpaper',
					'mioStyle',
					'showPostStatusRibbons',
				)
			),
			openstation_workspace_setting_keys()
		)
	);
}

/**
 * Sanitizes a launch entry's `place` — where a window goes, as
 * fractions of the work area.
 *
 * Four numbers in `[0, 1]`, width and height at least 5% so a saved
 * window can never come back as a sliver the user cannot grab. Null
 * for anything else: the window then lands wherever the arrangement
 * puts it, which is what an entry written before positions does.
 *
 * @param mixed $raw Raw place from the payload.
 * @return array|null Sanitized place, or null.
 */
function openstation_sanitize_workspace_place( $raw ) {
	if ( ! is_array( $raw ) ) {
		return null;
	}
	$out = array();
	foreach ( array( 'x', 'y', 'width', 'height' ) as $key ) {
		if ( ! isset( $raw[ $key ] ) || ! is_numeric( $raw[ $key ] ) ) {
			return null;
		}
		$v = (float) $raw[ $key ];
		if ( ! is_finite( $v ) ) {
			return null;
		}
		$out[ $key ] = round( max( 0.0, min( 1.0, $v ) ), 4 );
	}
	if ( $out['width'] < 0.05 || $out['height'] < 0.05 ) {
		return null;
	}
	return $out;
}

/**
 * Sanitizes a workspace's settings patch.
 *
 * Sparse: only the keys present are kept, and only keys
 * {@see openstation_workspace_setting_keys()} allows. Each value goes
 * through the same sanitizer that reads a user's saved settings — laid
 * over the defaults, sanitized, and read back — so a workspace can
 * carry exactly the values a user could have saved, and nothing else.
 *
 * @param mixed $raw Raw patch.
 * @return array Sanitized patch; empty when there is none.
 */
function openstation_sanitize_workspace_appearance( $raw ) {
	if ( ! is_array( $raw ) ) {
		return array();
	}
	$patch = array_intersect_key( $raw, array_flip( openstation_workspace_setting_keys() ) );
	if ( empty( $patch ) ) {
		return array();
	}
	$clean = openstation_sanitize_os_settings( array_merge( openstation_default_os_settings(), $patch ) );
	return array_intersect_key( $clean, $patch );
}

/** Hard cap on notes one workspace carries. */
const OPENSTATION_WORKSPACE_MAX_NOTES = 8;

/** Note colours — mirrors `NOTE_COLORS` in `src/notes/colors.ts`. */
const OPENSTATION_WORKSPACE_NOTE_COLORS = array( 'butter', 'blush', 'sky', 'mint', 'lilac', 'peach' );

/**
 * Sanitizes a workspace's notes: read-only notes the desk's author pins
 * on it, each dismissable by whoever uses the desk.
 *
 * Plain text only — a note is painted with `textContent`, and nothing
 * here is ever markup. An XL note is twice the size and may say twice
 * as much. Positions are fractions of the work area, like a launch
 * window's `place`.
 *
 * @param mixed $raw Raw notes.
 * @return array[]
 */
function openstation_sanitize_workspace_notes( $raw ) {
	if ( ! is_array( $raw ) ) {
		return array();
	}
	$notes = array();
	foreach ( $raw as $note ) {
		if ( ! is_array( $note ) ) {
			continue;
		}
		$id   = isset( $note['id'] ) ? substr( preg_replace( '/[^a-z0-9]/', '', strtolower( (string) $note['id'] ) ), 0, 24 ) : '';
		$size = isset( $note['size'] ) && 'xl' === $note['size'] ? 'xl' : 'normal';
		$text = isset( $note['text'] ) && is_string( $note['text'] ) ? trim( wp_strip_all_tags( $note['text'] ) ) : '';
		if ( '' === $id || '' === $text ) {
			continue;
		}
		$color   = isset( $note['color'] ) && in_array( $note['color'], OPENSTATION_WORKSPACE_NOTE_COLORS, true ) ? $note['color'] : 'butter';
		$unit    = static function ( $v ) {
			return is_numeric( $v ) ? round( max( 0.0, min( 1.0, (float) $v ) ), 4 ) : 0.1;
		};
		$notes[] = array(
			'id'    => $id,
			'text'  => mb_substr( $text, 0, 'xl' === $size ? 2000 : 1000 ),
			'size'  => $size,
			'color' => $color,
			'x'     => $unit( $note['x'] ?? 0.1 ),
			'y'     => $unit( $note['y'] ?? 0.1 ),
		);
		if ( count( $notes ) >= OPENSTATION_WORKSPACE_MAX_NOTES ) {
			break;
		}
	}
	return $notes;
}

/**
 * Sanitizes one workspace profile from an untrusted session payload.
 *
 * Returns `null` for anything that is not a profile, which is the
 * signal for "this desktop is a plain Space" — the field is optional
 * and absent is meaningful, so a malformed profile degrades the
 * desktop rather than the session.
 *
 * @param mixed $raw Raw profile from the client.
 * @return array|null Sanitized profile, or null when there isn't one.
 */
function openstation_sanitize_workspace_profile( $raw ) {
	if ( ! is_array( $raw ) ) {
		return null;
	}

	$layout = isset( $raw['layout'] ) ? (string) $raw['layout'] : 'free';
	if ( ! in_array( $layout, OPENSTATION_WORKSPACE_LAYOUTS, true ) ) {
		$layout = 'free';
	}

	// Colour is a `#rrggbb` accent or empty for "use the shell accent".
	// `sanitize_hex_color()` returns null for anything else, which we
	// fold back to empty rather than dropping the whole profile.
	$color = isset( $raw['color'] ) ? sanitize_hex_color( (string) $raw['color'] ) : '';

	$mode = 'all';
	$ids  = array();
	if ( isset( $raw['apps'] ) && is_array( $raw['apps'] ) ) {
		if ( isset( $raw['apps']['mode'] ) && 'only' === $raw['apps']['mode'] ) {
			$mode = 'only';
		}
		if ( isset( $raw['apps']['ids'] ) && is_array( $raw['apps']['ids'] ) ) {
			foreach ( $raw['apps']['ids'] as $id ) {
				if ( ! is_string( $id ) && ! is_numeric( $id ) ) {
					continue;
				}
				// Nav ids are slugs derived from admin URLs and window
				// ids, so the character class is the same one
				// `sanitize_key()` allows — but NOT `sanitize_key()`
				// itself, which lowercases: a native window registered
				// as `wpdcEditor` would be stored as `wpdceditor` and
				// then match nothing on the client.
				$id = substr( preg_replace( '/[^A-Za-z0-9_\-]/', '', (string) $id ), 0, 128 );
				if ( '' === $id ) {
					continue;
				}
				$ids[] = $id;
				if ( count( $ids ) >= OPENSTATION_WORKSPACE_MAX_APPS ) {
					break;
				}
			}
		}
	}

	// Widgets are a separate decision from apps, with a separate rule:
	// `only` means the column IS these ids, whether or not the user
	// enabled them globally. See `WorkspaceWidgets` on the JS side.
	$widget_mode = 'all';
	$widget_ids  = array();
	if ( isset( $raw['widgets'] ) && is_array( $raw['widgets'] ) ) {
		if ( isset( $raw['widgets']['mode'] ) && 'only' === $raw['widgets']['mode'] ) {
			$widget_mode = 'only';
		}
		if ( isset( $raw['widgets']['ids'] ) && is_array( $raw['widgets']['ids'] ) ) {
			foreach ( $raw['widgets']['ids'] as $id ) {
				if ( ! is_string( $id ) ) {
					continue;
				}
				// Widget ids are namespaced registry keys
				// (`desktop-mode/post-stats`), so the slash is part of
				// the id and the character class has to allow it.
				$id = substr( preg_replace( '#[^A-Za-z0-9_/-]#', '', $id ), 0, 128 );
				if ( '' === $id ) {
					continue;
				}
				$widget_ids[] = $id;
				if ( count( $widget_ids ) >= OPENSTATION_WORKSPACE_MAX_WIDGETS ) {
					break;
				}
			}
		}
	}

	$windows = array();
	if ( isset( $raw['windows'] ) && is_array( $raw['windows'] ) ) {
		foreach ( $raw['windows'] as $win ) {
			if ( ! is_array( $win ) ) {
				continue;
			}
			$match = isset( $win['match'] ) ? sanitize_text_field( (string) $win['match'] ) : '';
			if ( '' === $match ) {
				continue;
			}
			$entry = array( 'match' => substr( $match, 0, 128 ) );
			if ( isset( $win['url'] ) && is_string( $win['url'] ) ) {
				// Relative by design — a template has to survive being
				// read on a subdirectory install — so this is not a URL
				// validator. It strips markup and bounds the length;
				// the client resolves it against wp-admin and the
				// window manager refuses anything that lands outside.
				$url = substr( wp_strip_all_tags( $win['url'] ), 0, 512 );
				if ( '' !== $url ) {
					$entry['url'] = $url;
				}
			}
			if ( isset( $win['title'] ) && is_string( $win['title'] ) ) {
				$title = substr( wp_strip_all_tags( $win['title'] ), 0, 128 );
				if ( '' !== $title ) {
					$entry['title'] = $title;
				}
			}
			// Where the window goes — cells or fractions of the work
			// area, both of which survive a different display. See
			// `openstation_sanitize_workspace_place()`.
			$grid_span = openstation_sanitize_session_grid_span( $win['gridSpan'] ?? null );
			if ( null !== $grid_span ) {
				$entry['gridSpan'] = $grid_span;
			}
			$place = openstation_sanitize_workspace_place( $win['place'] ?? null );
			if ( null !== $place ) {
				$entry['place'] = $place;
			}
			$windows[] = $entry;
			if ( count( $windows ) >= OPENSTATION_WORKSPACE_MAX_WINDOWS ) {
				break;
			}
		}
	}

	return array(
		'appearance'  => openstation_sanitize_workspace_appearance( isset( $raw['appearance'] ) ? $raw['appearance'] : null ),
		'preset'      => isset( $raw['preset'] ) ? substr( sanitize_key( (string) $raw['preset'] ), 0, 64 ) : '',
		'icon'        => isset( $raw['icon'] ) ? sanitize_html_class( (string) $raw['icon'] ) : 'dashicons-desktop',
		'color'       => $color ? $color : '',
		'apps'        => array(
			'mode' => $mode,
			'ids'  => $ids,
		),
		'widgets'     => array(
			'mode' => $widget_mode,
			'ids'  => $widget_ids,
		),
		'windows'     => $windows,
		'layout'      => $layout,
		// "Hide settings": the desk leaves out Settings, Preferences and
		// the admin tools. A view for the desk's owner; for a user
		// PINNED to it, the screens and apps are refused on the server
		// too (includes/workspace-shares/restrictions.php).
		'restricted'  => ! empty( $raw['restricted'] ),
		// Read-only notes the desk's author pinned on it.
		'notes'       => openstation_sanitize_workspace_notes( $raw['notes'] ?? null ),
		// Absent means "the launch list has not run", and a workspace
		// restored mid-provision would otherwise open its windows a
		// second time on top of the ones the session just restored.
		'provisioned' => ! empty( $raw['provisioned'] ),
	);
}
