<?php
/**
 * OpenStation — My WordPress: the explorer's identity + shared helpers.
 *
 * The app people open is `apps/my-wordpress/` — WP Explorer, rebuilt
 * on the App Framework. This module keeps what the port shares: the
 * name and the folder-mark icon (the app reads both from the helpers
 * here), the capability gate, and the inert entities compatibility
 * surface (see the note at the end of the file).
 *
 * **The app is called WP Explorer; the module is called my-wordpress.**
 * The function prefix and every `openstation_my_wordpress_*` filter
 * are names plugins already reference — the frozen-values rule in
 * AGENTS.md keeps them put.
 *
 * Filterable surface:
 *
 *   - `openstation_my_wordpress_user_can_use`
 *   - `openstation_my_wordpress_entities` (inert — see the end note)
 *
 * (`openstation_my_wordpress_icon_args`, `_window_args` and
 * `_template_html` went with the legacy window they configured.)
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Display name of the app, for the window title and the pinned icon.
 *
 * A file explorer, named after what it explores. The window used to
 * carry the site title instead, on the reasoning that the desktop holds
 * objects rather than a mention of the software you are already standing
 * in — but a site title is what the *root folder* is called, not what
 * the app is called, and the breadcrumb still says it. The two are no
 * longer the same string.
 *
 * @return string
 */
function openstation_my_wordpress_app_title() {
	return __( 'WP Explorer', 'desktop-mode' );
}

/**
 * The app's icon: a folder wearing the WordPress mark.
 *
 * The window used to wear `dashicons-wordpress`, the double-ringed
 * wp.org mark, which said "WordPress" and nothing about what the app
 * does — every other window here is WordPress too. A folder says
 * "browse", and the single-ringed mark inside it says whose files.
 *
 * Drawn in `currentColor` so both painters mask it: the dock masks
 * image icons to the rail's own glyph colour so a plugin's brand
 * colours cannot break the monochrome rail, and `renderIcon()` masks it
 * to the title bar's text colour. A literal fill would silently turn it
 * back into a background image in one and a solid blob in the other.
 *
 * The folder is outlined rather than filled so the mark inside it stays
 * a mark: on a filled folder, a same-colour mark is invisible. Hand-
 * placed at 64×64, the established canvas for the custom icons here,
 * and held to two shapes because it renders as small as 20px in the
 * dock. The mark's own path is the upstream single-ringed logo, a
 * filled disc with the W knocked out by the nonzero fill rule.
 *
 * On the sizing: the front panel runs `y 19.1 → 52.1` on the
 * centreline, so at stroke 3 the clear height inside it is 30 units.
 * The mark takes 20 of those at scale 1, centred on 35.6, which leaves
 * five units above and below. It used to be scaled 1.15× for 23 units
 * and barely three units of clearance, less than one stroke width, and
 * a disc that close to the panel edge reads as crammed in rather than
 * placed. Horizontal clearance was never the constraint: the panel is
 * 50 units wide against the mark's 20.
 *
 * @return string Raw `<svg>` markup.
 */
function openstation_my_wordpress_icon_svg() {
	return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
		// The folder: back tab, notch, front panel, all one outline.
		. '<path d="M11 13h12.2a3 3 0 0 1 2.4 1.2l2.8 3.7a3 3 0 0 0 2.4 1.2H53a4 4 0 0 1 4 4v25a4 4 0 0 1-4 4H11a4 4 0 0 1-4-4V17a4 4 0 0 1 4-4z"'
		. ' fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>'
		// The WordPress mark, centred on the front panel at r=10.
		. '<g transform="translate(22 25.6) scale(1)">'
		. '<path fill="currentColor" d="M20 10c0-5.51-4.49-10-10-10C4.48 0 0 4.49 0 10c0 5.52 4.48 10 10 10 5.51 0 10-4.48 10-10zM7.78 15.37L4.37 6.22c.55-.02 1.17-.08 1.17-.08.5-.06.44-1.13-.06-1.11 0 0-1.45.11-2.37.11-.18 0-.37 0-.58-.01C4.12 2.69 6.87 1.11 10 1.11c2.33 0 4.45.87 6.05 2.34-.68-.11-1.65.39-1.65 1.58 0 .74.45 1.36.9 2.1.35.61.55 1.36.55 2.46 0 1.49-1.4 5-1.4 5l-3.03-8.37c.54-.02.82-.17.82-.17.5-.05.44-1.25-.06-1.22 0 0-1.44.12-2.38.12-.87 0-2.33-.12-2.33-.12-.5-.03-.56 1.2-.06 1.22l.92.08 1.26 3.41zM17.41 10c.24-.64.74-1.87.43-4.25.7 1.29 1.05 2.71 1.05 4.25 0 3.29-1.73 6.24-4.4 7.78.97-2.59 1.94-5.2 2.92-7.78zM6.1 18.09C3.12 16.65 1.11 13.53 1.11 10c0-1.3.23-2.48.72-3.59C3.25 10.3 4.67 14.2 6.1 18.09zm4.03-6.63l2.58 6.98c-.86.29-1.76.45-2.71.45-.79 0-1.57-.11-2.29-.33.81-2.38 1.62-4.74 2.42-7.1z"/>'
		. '</g>'
		. '</svg>';
}

/**
 * Whether the current user should see My WordPress.
 *
 * Mirrors the recycle-bin gate — anyone who can edit posts can
 * browse posts and pages.
 *
 * @return bool
 */
function openstation_my_wordpress_user_can_use() {
	$can = current_user_can( 'edit_posts' );

	/**
	 * Filter whether the current user can see the My WordPress
	 * pinned icon and window.
	 *
	 * @param bool $can Default: edit_posts capability.
	 */
	return (bool) apply_filters( 'openstation_my_wordpress_user_can_use', $can );
}

/**
 * Build the entity list shipped to the bundle. Posts, Pages,
 * Users, and Media. Future phases add
 * Comments, Tags, Categories, Themes, and Plugins.
 *
 * The optional `kind` field tells the bundle how to render entries
 * of this entity: `'post'` (default) renders the standard
 * title/excerpt/featured-image tile and the rendered-HTML preview;
 * `'user'` renders an avatar + display-name tile and routes to the
 * user dossier preview; `'media'` renders a thumbnail-grid tile and
 * routes to the media preview pane. Plugins extending the entity
 * list with a post-shaped collection can omit the field; user- and
 * media-shaped collections must set `'user'` / `'media'`.
 * The optional `post_type` field specifies the WP post-type
 * slug used for `os.<slug>.changed` cross-window broadcasts.
 *
 * @return array[] Each entry is `array( 'id', 'label', 'icon',
 *                 'restPath', 'kind', 'post_type' )`. `restPath` is appended to
 *                 the `restRoot` config to derive the list URL.
 */
function openstation_my_wordpress_entities() {
	$entities = array(
		array(
			'id'        => 'posts',
			'label'     => __( 'Posts', 'desktop-mode' ),
			'icon'      => 'dashicons-admin-post',
			'restPath'  => 'wp/v2/posts',
			'kind'      => 'post',
			'post_type' => 'post',
		),
		array(
			'id'        => 'pages',
			'label'     => __( 'Pages', 'desktop-mode' ),
			'icon'      => 'dashicons-admin-page',
			'restPath'  => 'wp/v2/pages',
			'kind'      => 'post',
			'post_type' => 'page',
		),
		array(
			'id'       => 'users',
			'label'    => __( 'Users', 'desktop-mode' ),
			'icon'     => 'dashicons-admin-users',
			'restPath' => 'wp/v2/users',
			'kind'     => 'user',
		),
		array(
			'id'        => 'media',
			'label'     => __( 'Media', 'desktop-mode' ),
			'icon'      => 'dashicons-admin-media',
			'restPath'  => 'wp/v2/media',
			'kind'      => 'media',
			'post_type' => 'attachment',
		),
	);

	/**
	 * Filter the list of entity types shown inside the My WordPress
	 * window. Each entry must declare `id`, `label`, `icon`, and
	 * `restPath`. Returning a reordered or extended array shows up
	 * in the bundle on the next render.
	 *
	 * **Status: Experimental** — the entity descriptor shape may
	 * gain fields as new entity kinds land (Comments, Tags,
	 * Categories, Themes, Plugins). Stable id/label/icon/restPath
	 * fields will continue to work; new optional fields will not
	 * break existing consumers. The `kind` field is optional and
	 * defaults to `'post'` for back-compat.
	 *
	 * Optional fields:
	 *   - `kind`       — render strategy (`'post'` default, `'user'`, `'media'`).
	 *   - `post_type`  — WP post-type slug for cross-window broadcast topic `os.<slug>.changed`.
	 *   - `thumbnails` — set false to keep the section icon on every tile
	 *                    instead of the entity's featured image.
	 *   - `editAction` — who edits this section's rows. A preview-action id
	 *                    (see `openstation_my_wordpress_preview_actions`)
	 *                    replaces "Open in editor" everywhere — pane button,
	 *                    context-menu open entry, tile double-click. `false`
	 *                    removes every edit affordance (double-click falls
	 *                    back to the detail dossier; the bulk "Edit…" modal
	 *                    is suppressed). Omit for the classic editor.
	 *   - `group`      — folder id this section nests under at the root
	 *                    (null / omitted renders it loose at the root).
	 *   - `groupLabel` — folder label. `groupIcon`, `groupOrder` follow.
	 *
	 * @param array[] $entities Default entities.
	 */
	$filtered = apply_filters( 'openstation_my_wordpress_entities', $entities );
	return is_array( $filtered ) ? array_values( $filtered ) : $entities;
}

/*
 * No window, no template, no launcher. The explorer people open is
 * the `my-wordpress` APP (`apps/my-wordpress/`), which reclaimed the
 * "WP Explorer" name and the folder mark from this module's helpers
 * above. The legacy native window, its bundle and its pinned icon are
 * gone; every deep surface it used to host moved with the port — the
 * detail dossiers and the activity footprint render inside the app,
 * "open this object" travels through the shared stores in
 * `src/my-wordpress/explorer-open.ts` / `footprint-target.ts`, and
 * the Recycle Bin trashes dropped rows by their payload's `restPath`.
 *
 * `openstation_my_wordpress_entities()` and its filter remain as an
 * inert compatibility surface: subscribers registered against them
 * (WooCommerce's own among them) still run, and the pure helpers are
 * still what the tests pin — but nothing consumes the list to build a
 * window any more. The `openstation_my_wordpress_window_args` /
 * `openstation_my_wordpress_template_html` filters no longer fire.
 */
