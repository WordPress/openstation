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
 * This file owns two things:
 *
 *   1. The server-side view of the shipped templates, so a plugin can
 *      add or drop one from PHP without shipping JavaScript.
 *   2. Sanitization of a profile arriving from the client. The session
 *      is user meta written from an untrusted payload, so every field
 *      is bounded here and nowhere else.
 *
 * The JS side is `src/workspaces/`, and the two lists of shipped
 * templates are deliberately separate: PHP's exists so a filter has
 * something to filter, JS's is what the switcher renders. Neither
 * generates the other, and `Tests_OpenStation_Workspaces` pins that
 * the ids match.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/** Hard cap on apps named by one workspace's visible set. */
const OPENSTATION_WORKSPACE_MAX_APPS = 128;

/** Hard cap on widgets named by one workspace's column. */
const OPENSTATION_WORKSPACE_MAX_WIDGETS = 32;

/**
 * How many nested arrays an appearance value may hold.
 *
 * Two is exactly what the deepest real shape needs:
 * `wallpaperSettings` is a record of wallpaper ids (one), each holding
 * that wallpaper's own settings (two), each holding scalars.
 * `customGradient` and `customImage` stop at one. Anything below that
 * is not a setting, and user meta is not a place to store an object
 * graph.
 */
const OPENSTATION_WORKSPACE_APPEARANCE_MAX_DEPTH = 2;

/** Hard cap on windows one workspace opens with. */
const OPENSTATION_WORKSPACE_MAX_WINDOWS = 12;

/** Arrangements a workspace's `layout` may name. Mirrors `WORKSPACE_LAYOUTS`. */
const OPENSTATION_WORKSPACE_LAYOUTS = array( 'free', 'cascade', 'tile', 'columns', 'focus' );

/**
 * Appearance settings a workspace may repaint the desk with.
 *
 * Mirrors `WORKSPACE_APPEARANCE_KEYS` in `src/workspaces/types.ts`,
 * and enforcing it here is not belt-and-braces: a profile is user meta
 * round-tripped through an untrusted client, and an unfiltered patch
 * spread onto the settings state at boot would be a way to write any
 * settings key from anywhere. Everything on the list is visual and
 * instantly reversible, which is the test for belonging — switching
 * desks must never leave a user somewhere they cannot get back from.
 */
const OPENSTATION_WORKSPACE_APPEARANCE_KEYS = array(
	'wallpaper',
	'wallpaperSettings',
	'customGradient',
	'customImage',
	'accent',
	'customAccent',
	'desktopTheme',
	'desktopLayout',
	'dockPlacement',
	'dockSize',
	'dockBehavior',
	'sideDockBehavior',
	'windowRadius',
	'windowReveal',
	'unfocusEffect',
	'adminBarMode',
);

/**
 * The workspace templates the server knows about.
 *
 * Mirrors `builtInPresets()` in `src/workspaces/presets.ts` — the ids,
 * labels and layouts are the contract; the app/window token lists live
 * on the JS side, which is where they are resolved against the live
 * navigation.
 *
 * Named for the job, not for the plugin: a desk called "Woo" is wrong
 * on a store running something else, and wrong again the day the
 * product is renamed. The products are still what the templates reach
 * for — the JS token lists name WooCommerce and Sensei directly — so
 * on a site that has them, Commerce is a WooCommerce desk in
 * everything but its label.
 *
 * Filterable so a site can add a template, or drop one it has no use
 * for. A blog with no store has no reason to be offered a Woo desk.
 *
 * @return array[] List of `array{ id, label, description, icon, color, layout }`.
 */
function openstation_workspace_presets() {
	$presets = array(
		array(
			'id'          => 'commerce',
			'label'       => __( 'Commerce', 'desktop-mode' ),
			'description' => __( 'A shop floor. WooCommerce orders, products and analytics side by side; everything that is not commerce leaves the rails.', 'desktop-mode' ),
			'icon'        => 'dashicons-cart',
			'color'       => '#7f54b3',
			'layout'      => 'columns',
			'order'       => 10,
		),
		array(
			'id'          => 'learning',
			'label'       => __( 'Learning', 'desktop-mode' ),
			'description' => __( 'A course studio. Sensei courses, lessons and learners tiled together, so moving between them is a glance rather than a navigation.', 'desktop-mode' ),
			'icon'        => 'dashicons-welcome-learn-more',
			'color'       => '#43a047',
			'layout'      => 'tile',
			'order'       => 20,
		),
		array(
			'id'          => 'publishing',
			'label'       => __( 'Publishing', 'desktop-mode' ),
			'description' => __( 'A writing desk. A blank page takes two thirds of the screen, the library sits in the margin, and the rest of the admin is somewhere else.', 'desktop-mode' ),
			'icon'        => 'dashicons-edit-page',
			'color'       => '#c8102e',
			'layout'      => 'focus',
			'order'       => 30,
		),
	);

	/**
	 * Filters the workspace templates offered in the switcher.
	 *
	 * A template added here is a complete one: give it `apps` and
	 * `windows` (lists of match tokens — see
	 * `openstation_sanitize_workspace_preset()`) and the client will
	 * resolve them against the live navigation the same way it
	 * resolves a built-in's. The three shipped entries deliberately
	 * carry neither, because the client already has their token lists
	 * and duplicating them here would be two places to keep in step.
	 *
	 * @param array[] $presets List of preset definitions.
	 */
	$presets = apply_filters( 'openstation_workspace_presets', $presets );

	if ( ! is_array( $presets ) ) {
		return array();
	}

	$clean = array();
	foreach ( $presets as $preset ) {
		$entry = openstation_sanitize_workspace_preset( $preset );
		if ( null !== $entry ) {
			$clean[] = $entry;
		}
	}
	return $clean;
}

/**
 * Sanitizes a workspace's appearance patch.
 *
 * Keys outside {@see OPENSTATION_WORKSPACE_APPEARANCE_KEYS} are
 * dropped, and so is any value that isn't a scalar or a plain array —
 * the settings layer's own deserializer validates the shapes, so this
 * only has to guarantee the patch cannot reach a key it has no
 * business setting, and cannot carry an object graph into user meta.
 *
 * `wallpaperSettings`, `customGradient` and `customImage` are the
 * array-valued members, so arrays are allowed but bounded by
 * {@see OPENSTATION_WORKSPACE_APPEARANCE_MAX_DEPTH} — exactly the
 * nesting the deepest of them reaches, and nothing below it.
 *
 * @param mixed $raw Raw appearance patch.
 * @return array Sanitized patch, possibly empty.
 */
function openstation_sanitize_workspace_appearance( $raw ) {
	if ( ! is_array( $raw ) ) {
		return array();
	}
	$clean = array();
	foreach ( OPENSTATION_WORKSPACE_APPEARANCE_KEYS as $key ) {
		if ( ! array_key_exists( $key, $raw ) ) {
			continue;
		}
		$value = $raw[ $key ];
		if ( is_scalar( $value ) || null === $value ) {
			$clean[ $key ] = is_string( $value ) ? substr( wp_strip_all_tags( $value ), 0, 512 ) : $value;
			continue;
		}
		if ( is_array( $value ) ) {
			$clean[ $key ] = openstation_sanitize_workspace_appearance_branch(
				$value,
				OPENSTATION_WORKSPACE_APPEARANCE_MAX_DEPTH
			);
		}
	}
	return $clean;
}

/**
 * Depth-bounded scalar filter for an appearance value's sub-arrays.
 *
 * @param array $value Raw sub-array.
 * @param int   $depth Remaining levels to descend.
 * @return array Sanitized sub-array.
 */
function openstation_sanitize_workspace_appearance_branch( $value, $depth ) {
	$out = array();
	foreach ( $value as $key => $item ) {
		$key = substr( preg_replace( '#[^A-Za-z0-9_/.-]#', '', (string) $key ), 0, 128 );
		if ( '' === $key ) {
			continue;
		}
		if ( is_scalar( $item ) || null === $item ) {
			$out[ $key ] = is_string( $item ) ? substr( wp_strip_all_tags( $item ), 0, 512 ) : $item;
			continue;
		}
		if ( is_array( $item ) && $depth > 1 ) {
			$out[ $key ] = openstation_sanitize_workspace_appearance_branch( $item, $depth - 1 );
		}
	}
	return $out;
}

/**
 * Sanitizes one workspace template.
 *
 * Applied to everything the `openstation_workspace_presets` filter
 * returns, shipped entries included — a template reaches the client in
 * the shell config blob, and a plugin returning a malformed one should
 * cost that template rather than the whole switcher.
 *
 * Returns `null` for an entry with no usable id.
 *
 * @param mixed $raw Raw preset definition.
 * @return array|null Sanitized preset, or null.
 */
function openstation_sanitize_workspace_preset( $raw ) {
	if ( ! is_array( $raw ) ) {
		return null;
	}
	$id = isset( $raw['id'] ) ? sanitize_key( (string) $raw['id'] ) : '';
	if ( '' === $id ) {
		return null;
	}

	$layout = isset( $raw['layout'] ) ? (string) $raw['layout'] : 'free';
	if ( ! in_array( $layout, OPENSTATION_WORKSPACE_LAYOUTS, true ) ) {
		$layout = 'free';
	}

	$label = isset( $raw['label'] ) ? wp_strip_all_tags( (string) $raw['label'] ) : '';
	$color = isset( $raw['color'] ) ? sanitize_hex_color( (string) $raw['color'] ) : '';

	$apps = array();
	if ( isset( $raw['apps'] ) && is_array( $raw['apps'] ) ) {
		foreach ( $raw['apps'] as $token ) {
			if ( ! is_string( $token ) ) {
				continue;
			}
			$token = substr( sanitize_text_field( $token ), 0, 128 );
			if ( '' !== $token ) {
				$apps[] = $token;
			}
			if ( count( $apps ) >= OPENSTATION_WORKSPACE_MAX_APPS ) {
				break;
			}
		}
	}

	$widgets = array();
	if ( isset( $raw['widgets'] ) && is_array( $raw['widgets'] ) ) {
		foreach ( $raw['widgets'] as $id ) {
			if ( ! is_string( $id ) ) {
				continue;
			}
			// Namespaced registry keys — the slash is part of the id.
			$id = substr( preg_replace( '#[^A-Za-z0-9_/-]#', '', $id ), 0, 128 );
			if ( '' !== $id ) {
				$widgets[] = $id;
			}
			if ( count( $widgets ) >= OPENSTATION_WORKSPACE_MAX_WIDGETS ) {
				break;
			}
		}
	}

	$windows = array();
	if ( isset( $raw['windows'] ) && is_array( $raw['windows'] ) ) {
		foreach ( $raw['windows'] as $win ) {
			if ( ! is_array( $win ) ) {
				continue;
			}
			$match = isset( $win['match'] ) ? substr( sanitize_text_field( (string) $win['match'] ), 0, 128 ) : '';
			if ( '' === $match ) {
				continue;
			}
			$entry = array( 'match' => $match );
			if ( isset( $win['url'] ) && is_string( $win['url'] ) ) {
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
			$windows[] = $entry;
			if ( count( $windows ) >= OPENSTATION_WORKSPACE_MAX_WINDOWS ) {
				break;
			}
		}
	}

	return array(
		'appearance'  => openstation_sanitize_workspace_appearance( isset( $raw['appearance'] ) ? $raw['appearance'] : null ),
		'id'          => $id,
		'label'       => '' !== $label ? $label : $id,
		'description' => isset( $raw['description'] ) ? wp_strip_all_tags( (string) $raw['description'] ) : '',
		'icon'        => isset( $raw['icon'] ) ? sanitize_html_class( (string) $raw['icon'] ) : 'dashicons-desktop',
		'color'       => $color ? $color : '',
		'apps'        => $apps,
		'widgets'     => $widgets,
		'windows'     => $windows,
		'layout'      => $layout,
		'order'       => isset( $raw['order'] ) ? (int) $raw['order'] : 0,
	);
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
		// Absent means "the launch list has not run", and a workspace
		// restored mid-provision would otherwise open its windows a
		// second time on top of the ones the session just restored.
		'provisioned' => ! empty( $raw['provisioned'] ),
	);
}
