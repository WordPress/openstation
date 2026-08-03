<?php
/**
 * OpenStation — Appearance window tab adaptations.
 *
 * The Appearance dock item opens an iframe of `themes.php` and uses
 * the in-window submenu strip (built from the WP `$submenu` global)
 * as its tab bar. WP Core does not register `theme-install.php` as a
 * submenu of `themes.php`; classic admin instead surfaces it through
 * the in-page "Add Theme" `.page-title-action` button.
 *
 * Inside chromeless we hide that button (it scrolled out of the
 * iframe's visible area on first paint, leaving no entry point to
 * the install flow — see assets/css/chromeless.css). This file
 * compensates by injecting an "Add Theme" tab at the front of the
 * Appearance window's submenu strip via the `open_station_dock_item`
 * filter.
 *
 * Resulting tab order: Appearance | Add Theme | Editor | Fonts | …
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Prepends an "Add Theme" entry to the Appearance dock item's submenu.
 *
 * Called once per dock item via {@see open_station_build_dock_items()}.
 * Skipped for every menu other than `themes.php` and for users who
 * lack the `install_themes` capability — matching what classic
 * admin's "Add Theme" page-title-action enforces.
 *
 * @param array  $dock_item The dock item data (id, title, icon, url,
 *                          badge, submenu, multi, placement, isCore).
 * @param string $menu_slug The menu slug — e.g. `themes.php`.
 * @return array Filtered dock item.
 */
function open_station_inject_appearance_tabs( $dock_item, $menu_slug ) {
	if ( 'themes.php' !== $menu_slug ) {
		return $dock_item;
	}

	if ( ! current_user_can( 'install_themes' ) ) {
		return $dock_item;
	}

	if ( ! isset( $dock_item['submenu'] ) || ! is_array( $dock_item['submenu'] ) ) {
		$dock_item['submenu'] = array();
	}

	// `?browse=popular` lands on the Popular tab (the JS installer
	// router would default-redirect to this anyway when no sort is
	// specified — passing it explicitly makes the intent visible
	// AND avoids the brief flash where WP's Backbone router rewrites
	// the URL after first paint, which inside the iframe re-arms the
	// chromeless body class flicker). Other valid values: `new`
	// (Latest), `block-themes`, `favorites`.
	$add_theme = array(
		'title' => __( 'Add Theme', 'desktop-mode' ),
		'url'   => admin_url( 'theme-install.php?browse=popular' ),
	);

	// Idempotent: skip if a previous filter pass (or another plugin)
	// already added an entry pointing at theme-install.php.
	foreach ( $dock_item['submenu'] as $existing ) {
		if ( ! empty( $existing['url'] ) && false !== strpos( $existing['url'], 'theme-install.php' ) ) {
			return $dock_item;
		}
	}

	array_unshift( $dock_item['submenu'], $add_theme );

	return $dock_item;
}
add_filter( 'open_station_dock_item', 'open_station_inject_appearance_tabs', 10, 2 );

/**
 * Fixes the visible "active tab" state inside chromeless
 * theme-install.php iframes.
 *
 * Background: WP's installer JS uses a Backbone router whose pattern
 * `theme-install.php?browse=:sort` greedy-captures everything past
 * `browse=` ([^/?]+ matches `&` too). Inside chromeless the URL also
 * carries `open_station_chromeless=1`, so `:sort` ends up as
 * `popular&open_station_chromeless=1`. WP's `view.sort()` then runs
 * with that polluted value and the `[data-sort]` selector finds
 * nothing — leaving every tab in the unselected state even though
 * the popular themes ARE the rendered listing.
 *
 * Reordering query params or re-encoding doesn't help: any URL that
 * exposes `browse=` to the router matches the route, and any URL
 * that hides it falls through to a redirect that strips the
 * chromeless flag (which would re-render the iframe with full admin
 * chrome on next paint).
 *
 * The minimum-viable shim: inline JS that reads the real `browse`
 * value dynamically via URLSearchParams on every check, finds the
 * matching `[data-sort]` tab, and sets `current` + `aria-current` on it.
 * A MutationObserver on `.filter-links` keeps the tab synced when WP's
 * router fires or state changes (e.g. switching tabs to Latest or
 * returning via pushState).
 */
function open_station_theme_install_active_tab_script() {
	if ( ! open_station_is_chromeless_request() ) {
		return;
	}
	if ( ! isset( $GLOBALS['pagenow'] ) || 'theme-install.php' !== $GLOBALS['pagenow'] ) {
		return;
	}

	$js = <<<'JS'
( function () {
    function getBrowseParam() {
        return new URLSearchParams( window.location.search ).get( 'browse' );
    }
    if ( ! getBrowseParam() ) {
        return;
    }
    function applyActiveTab() {
        var browseParam = getBrowseParam();
        if ( ! browseParam ) {
            return true;
        }
        var match = document.querySelector(
            '.filter-links li > a[data-sort="' + browseParam + '"]'
        );
        if ( ! match ) {
            return false;
        }
        var tabs = document.querySelectorAll( '.filter-links li > a[data-sort]' );
        var alreadyCorrect =
            match.classList.contains( 'current' ) &&
            Array.prototype.every.call( tabs, function ( a ) {
                return a === match || ! a.classList.contains( 'current' );
            } );
        if ( alreadyCorrect ) {
            return true;
        }
        Array.prototype.forEach.call( tabs, function ( a ) {
            a.classList.remove( 'current' );
            a.removeAttribute( 'aria-current' );
        } );
        match.classList.add( 'current' );
        match.setAttribute( 'aria-current', 'page' );
        return true;
    }
    function init() {
        if ( ! applyActiveTab() ) {
            window.requestAnimationFrame( init );
            return;
        }
        var container = document.querySelector( '.filter-links' );
        if ( ! container ) {
            return;
        }
        var pending = false;
        var observer = new MutationObserver( function () {
            if ( pending ) {
                return;
            }
            pending = true;
            window.requestAnimationFrame( function () {
                pending = false;
                applyActiveTab();
            } );
        } );
        observer.observe( container, {
            attributes: true,
            subtree: true,
            attributeFilter: [ 'class', 'aria-current' ],
        } );
    }
    if ( document.readyState === 'loading' ) {
        document.addEventListener( 'DOMContentLoaded', init );
    } else {
        init();
    }
} )();
JS;

	wp_print_inline_script_tag( $js );
}
add_action( 'admin_footer', 'open_station_theme_install_active_tab_script', 100 );
