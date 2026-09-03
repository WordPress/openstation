<?php
/**
 * OpenStation — In-page "Add New" button de-duplication.
 *
 * Most list screens render a `.page-title-action` button next to the
 * `<h1>` ("Add New Post", "Add New User", …). Inside a window the
 * same destination is usually already a tab in the submenu strip
 * just above it, so the button is a duplicate.
 *
 * We emit one inline CSS rule per submenu URL of the current parent
 * menu, matching `.page-title-action` on its `href`. A button is
 * hidden only when its destination is a tab in the same window.
 *
 * The match is on `href`, at any depth inside `.wrap`. Core renders
 * the button as a direct child, but a plugin is free to move it: on
 * a Jetpack site the external-media package lifts core's "Add Media
 * File" out of `.wrap` into a `div.wpcom-media-library-action-buttons`
 * of its own so it can append "Import Media" beside it, and Big Sky
 * inserts "Generate Image" into the same box. A `>` combinator stops
 * at the wrapper and every one of those buttons survives next to the
 * tab that already leads there. Depth says nothing about where a
 * button goes, so it is not part of the test.
 *
 * Matching is on the exact href, never a partial path compare. A
 * missed match leaves a redundant button; a loose match takes away
 * the only route to a page. So these all stay visible:
 *
 *   - "Upload Plugin" (`plugin-install.php?tab=upload`), which is a
 *     different URL from the "Add Plugin" tab (`plugin-install.php`).
 *   - WooCommerce's "Add order" (`…&action=new`) next to the Orders
 *     tab (no `action`).
 *   - Anything on a screen with no submenu strip, which contributes
 *     no URLs at all.
 *   - In-page toggles, see
 *     {@see openstation_chromeless_title_action_toggle_classes()}.
 *
 * `themes.php` is the one screen this can't cover; see the per-page
 * rule in `assets/css/chromeless.css`.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Collects the tab URLs the current window's submenu strip exposes.
 *
 * Repeats the submenu filtering {@see openstation_build_dock_items()}
 * does (capability, empty title, `openstation_menu_item_url()`) for
 * one parent menu only. A full dock rebuild would run `get_plugins()`
 * and walk every other menu, which is a lot of work for an iframe
 * load that needs one menu's children.
 *
 * WordPress auto-prepends a self-link to every parent menu and we
 * keep it, because the shell shows it as the "back to parent" tab.
 *
 * `$parent_file` is set by each `wp-admin/*.php` page before it
 * includes `admin-header.php`. Plugin screens (`admin.php?page=…`)
 * don't have one this early, so they return no URLs and nothing gets
 * hidden. That's the outcome we want there anyway.
 *
 * Two cases this still can't see, both of which end with a button
 * hidden and no tab replacing it. Start here if someone reports that:
 *
 *   - `openstation_dock_item` can add or remove submenu entries, and
 *     `includes/themes-tabs.php` uses it in-tree. Firing it would
 *     mean inventing a dock item to pass through it, so we don't.
 *   - A window whose URL matches no dock entry gets no tab strip at
 *     all (`findDockEntry` feeds `config.submenu` in
 *     `src/window/dom.ts`), while `$parent_file` still resolves here.
 *
 * @return string[] Absolute admin URLs, empty when the current screen
 *                  has no resolvable submenu strip.
 */
function openstation_chromeless_submenu_tab_urls() {
	global $submenu, $parent_file;

	$parent = is_string( $parent_file ) ? $parent_file : '';

	if ( '' === $parent || empty( $submenu[ $parent ] ) || ! is_array( $submenu[ $parent ] ) ) {
		return array();
	}

	$urls = array();

	foreach ( $submenu[ $parent ] as $sub_item ) {
		if ( empty( $sub_item[2] ) ) {
			continue;
		}
		if ( ! empty( $sub_item[1] ) && ! current_user_can( $sub_item[1] ) ) {
			continue;
		}
		// A row with no usable label never becomes a tab, so it can't
		// be duplicating one either.
		if ( '' === openstation_menu_item_title( $sub_item[0] ?? '' ) ) {
			continue;
		}

		$url = openstation_menu_item_url( (string) $sub_item[2] );
		if ( '' !== $url ) {
			$urls[] = $url;
		}
	}

	return array_values( array_unique( $urls ) );
}

/**
 * Anchors that are really in-page toggles, so their href is just the
 * no-JS fallback and doesn't say where the button goes.
 *
 *   - `aria-button-if-js` is core's own marker. On `upload.php` in
 *     grid mode, media-grid.js opens a drop zone above the grid
 *     instead of leaving for `media-new.php`. The list-mode copy of
 *     that button has no marker, so it does get de-duplicated.
 *   - `upload-view-toggle` is `plugin-install.php`'s "Upload Plugin",
 *     which plugin-install.js flips to "Browse Plugins" and back. Its
 *     href always points at the state it is NOT in, so on
 *     `?tab=upload` it reads `plugin-install.php`, identical to the
 *     "Add Plugin" tab.
 *
 * The chromeless bridge skips clicks on both for the same reason.
 *
 * @return string[] CSS class names.
 */
function openstation_chromeless_title_action_toggle_classes() {
	return array( 'aria-button-if-js', 'upload-view-toggle' );
}

/**
 * Escapes a URL for use inside a double-quoted CSS attribute value.
 *
 * Backslashes and quotes are escaped. Angle brackets and newlines
 * are stripped instead, so a plugin-authored menu slug can't close
 * the `<style>` tag; the selector just stops matching.
 *
 * @param string $url URL to escape.
 * @return string Escaped value, without the surrounding quotes.
 */
function openstation_chromeless_css_attr_value( $url ) {
	$url = preg_replace( '/[\r\n<>]/', '', (string) $url );

	return str_replace( array( '\\', '"' ), array( '\\\\', '\\"' ), $url );
}

/**
 * Builds the de-duplication CSS for the current chromeless screen.
 *
 * Two selectors per URL: a CSS attribute selector compares the
 * attribute's parsed value, which is entity-decoded but NOT resolved
 * against the document URL. So we need both the absolute form core
 * renders and the admin-relative form some plugins hand-write
 * (`href="post-new.php"`).
 *
 * The `:not()` guards come from
 * {@see openstation_chromeless_title_action_toggle_classes()}.
 *
 * @param string[] $tab_urls Absolute admin URLs.
 * @return string CSS, or an empty string when there's nothing to hide.
 */
function openstation_chromeless_title_action_css( $tab_urls ) {
	if ( empty( $tab_urls ) ) {
		return '';
	}

	$admin_base = admin_url();
	$selectors  = array();

	$exclusions = '';
	foreach ( openstation_chromeless_title_action_toggle_classes() as $class ) {
		$exclusions .= ':not( .' . $class . ' )';
	}

	foreach ( $tab_urls as $url ) {
		$hrefs = array( $url );

		if ( str_starts_with( $url, $admin_base ) ) {
			$relative = substr( $url, strlen( $admin_base ) );
			if ( '' !== $relative ) {
				$hrefs[] = $relative;
			}
		}

		foreach ( $hrefs as $href ) {
			$selectors[] = '.os-chromeless .wrap .page-title-action[href="'
				. openstation_chromeless_css_attr_value( $href ) . '"]' . $exclusions;
		}
	}

	$selectors = array_values( array_unique( $selectors ) );

	return implode( ",\n", $selectors ) . " {\n\tdisplay: none;\n}\n";
}

/**
 * Attaches the de-duplication rules to the chromeless stylesheet.
 *
 * CSS rather than removing the node: the rule lands in `<head>`
 * before first paint, so the button never flashes, and it stays in
 * the DOM for the core scripts that toggle `.page-title-action`.
 */
function openstation_chromeless_title_action_styles() {
	if ( ! openstation_is_chromeless_request() ) {
		return;
	}

	$css = openstation_chromeless_title_action_css(
		openstation_chromeless_submenu_tab_urls()
	);

	if ( '' === $css ) {
		return;
	}

	wp_add_inline_style( 'os-chromeless', $css );
}
add_action( 'openstation_chromeless_styles', 'openstation_chromeless_title_action_styles' );
