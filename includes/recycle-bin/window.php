<?php
/**
 * OpenStation — Recycle Bin: tile art, gate, shell config.
 *
 * The bin WINDOW is an App Framework app (`apps/trash/trash.os.php`)
 * that claims the frozen `desktop-mode-recycle-bin` id, so every
 * shortcut, dock placement and drop target keeps working. This file
 * keeps what the shell needs regardless of the window: the two bin
 * drawings (the dock tile's empty/full swap — `icon-state.ts` — and
 * the app's own `ctx.host.setIcon()` swap read the same pair), the
 * capability gate, the shell-config seed that makes the tile correct
 * on the very first paint, and the stylesheet enqueue (the
 * drag-to-trash drop-target highlight must exist at boot, not at
 * window-open).
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * The bin SVG, used by the app window's icon and its dock tile.
 *
 * The bin used to be `dashicons-trash`, which worked but wore the
 * wrong clothes. Dashicons are WP core's icon set: solid fills on a
 * 20-unit grid, tuned for admin-menu sizes. The shell's own icons are
 * outlined vessels on a 64-unit grid at stroke 3. Sitting next to
 * WP Explorer, Corkboard and Games in the dock, the Dashicon was
 * visibly a guest from another system: heavier, tighter, and drawn to
 * a different rhythm.
 *
 * So this is the same object, redrawn to the house rule the other
 * three follow: an outlined vessel with solid content, three elements
 * because it renders as small as 20px in the dock. The lid is the
 * solid one, which gives the mark a single dense horizontal to be
 * recognised by when the tapered body below it thins out.
 *
 * Drawn in `currentColor`, so `renderIcon()` paints it as a CSS mask
 * and it takes the surface's own text colour. Dashicons already
 * inherited colour, being font glyphs; the point of the change is the
 * drawing, not the theming.
 *
 * Note that the row actions inside the bin window, and the "Move to
 * trash" entries in context menus, stay on `dashicons-trash`. Those
 * are menu glyphs sitting among other menu glyphs, and they should
 * match their neighbours rather than this icon.
 *
 * The bin has two states. Empty is the vessel on its own; full adds
 * three crumpled balls inside it and knocks the lid askew.
 *
 * @param bool $full Whether to draw the bin holding something.
 * @return string Raw `<svg>` markup.
 */
function openstation_recycle_bin_icon_svg( $full = false ) {
	// The lid and the handle travel together. In the full state the
	// pair is lifted clear of the rim and tipped, hinged at the far
	// corner, the way a lid sits on a bin that has too much in it.
	//
	// It was a 2.5-unit lift at 8 degrees, which on the 20px dock
	// tile and the 58px home tile was no difference at all: the bin
	// read as empty while it held things. At 4 units and 12 degrees
	// (a positive angle turns clockwise about the far corner, so the
	// near end rises) the lid's near end clears the rim by a fifth
	// of the body's height and its far end by nine units, and the
	// wedge of light under it survives every size the mark is drawn.
	$lid_transform = $full
		? ' transform="translate(0 -4) rotate(12 52 21.5)"'
		: '';

	$svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
		. '<g' . $lid_transform . '>'
		// The handle, outlined so it reads as a loop rather than a tab.
		. '<path d="M25 19v-2.5a3.5 3.5 0 0 1 3.5-3.5h7a3.5 3.5 0 0 1 3.5 3.5V19" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>'
		// The lid: the one solid element, and the widest, so it anchors
		// the mark at small sizes.
		. '<rect x="10" y="19" width="44" height="5" rx="2.5" fill="currentColor"/>'
		. '</g>'
		// The body, tapered towards the base the way a real bin is, which
		// is also what separates it from a plain bucket.
		//
		// 27 units tall, narrowing to 71% of its top width. It was 24
		// tall at 59%, which drew a shallower, more conical tub than a
		// bin actually is, and left an interior too cramped to hold
		// anything. Taken further, to a bottom much past 75%, the walls
		// go vertical and the mark reads as a bucket; this sits at the
		// edge of that.
		. '<path d="M15.5 28.5h33l-1.2 24a3.5 3.5 0 0 1-3.5 3H20.2a3.5 3.5 0 0 1-3.5-3z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>';

	if ( $full ) {
		// Three crumpled balls, one path with three subpaths so the
		// mark stays at four elements rather than six.
		//
		// Each is a seven-point polygon on a radius jittered between
		// 0.81 and 1.0, with a same-colour round-joined stroke that
		// turns the corners into creases instead of points. Seven
		// points rather than nine because a ball this small needs
		// deeper, fewer facets to keep any texture at all.
		//
		// The layout is staggered deliberately. Two balls at the same
		// height with a third centred under them reads as a face, and
		// it cannot be unseen once noticed, so no two share a y (the
		// top pair are 4.2 units apart) and the third sits below-left
		// rather than on the centreline. Every gap in the mark clears
		// 2 units: 5.1 to the left wall, 4.4 to the right, 2.8 to the
		// rim, 2.5 to the base, and 2.5 to 4.2 between the balls. Those
		// last three decide how far down the size ladder they stay
		// three things instead of one.
		$svg .= '<path d="M29.7 38 27.4 39.5 24.7 39.6 23.6 37.1 24.1 34.4 26.8 34.1 29.2 35.1'
			. 'ZM39.4 44.1 36.7 43.5 34.8 41.6 35.8 39.1 38.1 37.6 40.2 39.3 41.1 41.8'
			. 'ZM28.1 50.4 27 47.9 27.4 45.2 30 44.6 32.6 45.6 32.4 48.3 31 50.5Z"'
			. ' fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>';
		// A fourth, larger sheet rides the rim under the lifted end of
		// the lid — the one element of the full state that is legible
		// at 20px, where the balls inside the body are a texture at
		// best. Same seven-point construction, twice the radius,
		// straddling the rim (y 28.5) so it reads as spilling out
		// rather than sitting in.
		$svg .= '<path d="M30 26 27.3 30 22.7 31.7 19.5 28.2 18.6 23.4 22.8 20.7 27.6 21.6Z"'
			. ' fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>';
	}

	return $svg . '</svg>';
}

/**
 * Both bin states as base64 data URIs, ready for `renderIcon()`.
 *
 * The client swaps between these as the count crosses zero, so both
 * have to reach the page on the first paint. Cheap: two string
 * builds and two base64 encodes, no queries.
 *
 * @return array{empty:string,full:string}
 */
function openstation_recycle_bin_icon_uris() {
	return array(
		'empty' => 'data:image/svg+xml;base64,' . base64_encode( openstation_recycle_bin_icon_svg( false ) ),
		'full'  => 'data:image/svg+xml;base64,' . base64_encode( openstation_recycle_bin_icon_svg( true ) ),
	);
}

/**
 * Whether the current user should see the recycle bin at all.
 *
 * Filterable so plugins can hide it from authors/contributors who
 * don't manage trash, or invert the gate to expose it to a custom
 * role. The app's gate (`apps/trash/trash.os.php`) delegates here.
 *
 * @return bool
 */
function openstation_recycle_bin_user_can_use() {
	$can = current_user_can( 'edit_posts' );

	/**
	 * Filter whether the current user can see the recycle bin window.
	 *
	 * @param bool $can Default: edit_posts capability.
	 */
	return (bool) apply_filters( 'openstation_recycle_bin_user_can_use', $can );
}

/**
 * Enqueue the bin stylesheet with the shell.
 *
 * Not a window-open companion: the sheet also paints the
 * drag-to-trash drop-target highlight on the CLOSED bin's dock tile
 * (`data-os-trash-drop-active`), which must work before the window
 * has ever opened.
 */
function openstation_recycle_bin_enqueue_style() {
	if ( ! openstation_recycle_bin_user_can_use() ) {
		return;
	}
	wp_enqueue_style( 'desktop-mode-recycle-bin' );
}
add_action( 'admin_enqueue_scripts', 'openstation_recycle_bin_enqueue_style', 5 );

/**
 * Inject the initial trash count and both bin drawings into the
 * shell config, so the dock tile (and any icon a user or plugin has
 * placed against this window) shows the right one on the very first
 * paint, before the bin window has ever opened.
 *
 * Both drawings travel together rather than the server picking one:
 * the count changes without a reload, and shipping the pair makes
 * crossing zero a local swap instead of a round trip.
 *
 * @param array $config Shell config blob.
 * @return array
 */
function openstation_recycle_bin_inject_shell_config( $config ) {
	if ( ! is_array( $config ) ) {
		return $config;
	}
	$icons = openstation_recycle_bin_icon_uris();

	$config['recycleBinCount']     = openstation_recycle_bin_count();
	$config['recycleBinCountUrl']  = esc_url_raw( rest_url( 'desktop-mode/v1/recycle-bin/count' ) );
	$config['recycleBinPostTypes'] = openstation_recycle_bin_capture_post_types();
	$config['recycleBinIconEmpty'] = $icons['empty'];
	$config['recycleBinIconFull']  = $icons['full'];
	return $config;
}
add_filter( 'openstation_shell_config', 'openstation_recycle_bin_inject_shell_config', 20 );
