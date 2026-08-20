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
 * Appearance window's submenu strip via the `openstation_dock_item`
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
 * Called once per dock item via {@see openstation_build_dock_items()}.
 * Skipped for every menu other than `themes.php` and for users who
 * lack the `install_themes` capability — matching what classic
 * admin's "Add Theme" page-title-action enforces.
 *
 * @param array  $dock_item The dock item data (id, title, icon, url,
 *                          badge, submenu, multi, placement, isCore).
 * @param string $menu_slug The menu slug — e.g. `themes.php`.
 * @return array Filtered dock item.
 */
function openstation_inject_appearance_tabs( $dock_item, $menu_slug ) {
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
add_filter( 'openstation_dock_item', 'openstation_inject_appearance_tabs', 10, 2 );

/**
 * Renders the orientation header for the chromeless Themes workspace.
 *
 * Core's page heading is intentionally hidden inside OpenStation because the
 * window chrome already names the screen. The Themes page still needs a little
 * more context than a generic list screen, though: a theme changes the public
 * face of the site, and Core's single-theme state otherwise opens directly on
 * an unexplained details panel.
 *
 * The markup is emitted through `admin_notices`, which places it immediately
 * before the page's `.wrap`. Core continues to own the theme cards, details
 * overlay, actions, AJAX updates, and keyboard behavior.
 *
 * The screen is identified by `get_current_screen()`, not `$pagenow`. Every
 * page registered with `add_theme_page()` also reports `themes.php` as its
 * `$pagenow`, but its body class comes from the hook suffix
 * (`appearance_page_<slug>`) and so matches none of the workspace CSS, which
 * is scoped to `.themes-php`. Gating on `$pagenow` would emit this header
 * unstyled on top of unrelated Appearance screens. The screen ID also keeps
 * network admin (`themes-network`, a different list table entirely) out.
 */
function openstation_render_themes_workspace_intro() {
	if ( ! openstation_is_chromeless_request() ) {
		return;
	}

	$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
	if ( ! $screen || 'themes' !== $screen->id ) {
		return;
	}

	/*
	 * Mirrors how `wp_prepare_themes_for_js()` builds its own list, without
	 * paying for the preparation itself. Core already called that function
	 * on this request before `admin-header.php` ran, and calling it again
	 * would re-resolve every screenshot, tag and author URL and fire
	 * `pre_prepare_themes_for_js` / `wp_prepare_themes_for_js` a second
	 * time — so any third-party callback hanging off them would run twice
	 * per page load. `wp_get_themes()` is cached, so this is a lookup.
	 */
	if ( current_user_can( 'switch_themes' ) ) {
		$themes     = wp_get_themes( array( 'allowed' => true ) );
		$stylesheet = get_stylesheet();
		if ( ! isset( $themes[ $stylesheet ] ) ) {
			$themes[ $stylesheet ] = wp_get_theme();
		}
		$theme_count = count( $themes );
	} else {
		$theme_count = 1;
	}
	?>
	<section class="openstation-themes-intro" aria-labelledby="openstation-themes-intro-title">
		<div class="openstation-themes-intro__copy">
			<p class="openstation-themes-intro__eyebrow"><?php esc_html_e( 'Site appearance', 'desktop-mode' ); ?></p>
			<h1 id="openstation-themes-intro-title"><?php esc_html_e( 'Choose how your site greets the world.', 'desktop-mode' ); ?></h1>
			<p><?php esc_html_e( 'Your theme shapes the templates, typography, colours, and layout visitors see. Your posts and pages stay in place when you switch.', 'desktop-mode' ); ?></p>
		</div>
		<?php
		/*
		 * Left readable rather than labelled: `aria-label` is ignored on a
		 * `<p>` (the paragraph role prohibits an author-supplied name), so
		 * pairing it with `aria-hidden` children hid the count from
		 * assistive tech entirely — and Core's own `.title-count` inside
		 * the page `<h1>` is display:none in chromeless mode, making this
		 * the only count on the screen. Read in DOM order the two spans
		 * announce as "3 Themes installed" on their own.
		 */
		?>
		<p class="openstation-themes-intro__count">
			<strong><?php echo esc_html( number_format_i18n( $theme_count ) ); ?></strong>
			<span><?php echo esc_html( _n( 'Theme installed', 'Themes installed', $theme_count, 'desktop-mode' ) ); ?></span>
		</p>
	</section>
	<?php
}
add_action( 'admin_notices', 'openstation_render_themes_workspace_intro', 0 );

/**
 * Fixes the visible "active tab" state inside chromeless
 * theme-install.php iframes.
 *
 * Background: WP's installer JS uses a Backbone router whose pattern
 * `theme-install.php?browse=:sort` greedy-captures everything past
 * `browse=` ([^/?]+ matches `&` too). Inside chromeless the URL also
 * carries `openstation_chromeless=1`, so `:sort` ends up as
 * `popular&openstation_chromeless=1`. WP's `view.sort()` then runs
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
function openstation_theme_install_active_tab_script() {
	if ( ! openstation_is_chromeless_request() ) {
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
add_action( 'admin_footer', 'openstation_theme_install_active_tab_script', 100 );
