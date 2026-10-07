<?php

defined( 'ABSPATH' ) || exit;

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

	$add_theme = array(
		'title' => __( 'Add Theme', 'desktop-mode' ),
		'url'   => admin_url( 'theme-install.php?browse=popular' ),
	);

	foreach ( $dock_item['submenu'] as $existing ) {
		if ( ! empty( $existing['url'] ) && false !== strpos( $existing['url'], 'theme-install.php' ) ) {
			return $dock_item;
		}
	}

	array_unshift( $dock_item['submenu'], $add_theme );

	return $dock_item;
}
add_filter( 'openstation_dock_item', 'openstation_inject_appearance_tabs', 10, 2 );

function openstation_render_themes_workspace_intro() {
	if ( ! openstation_is_chromeless_request() ) {
		return;
	}

	$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
	if ( ! $screen || 'themes' !== $screen->id ) {
		return;
	}

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
			<p><?php esc_html_e( 'Themes shape your site’s look. Switching keeps your posts and pages in place.', 'desktop-mode' ); ?></p>
		</div>
		<?php

		?>
		<p class="openstation-themes-intro__count">
			<strong><?php echo esc_html( number_format_i18n( $theme_count ) ); ?></strong>
			<span><?php echo esc_html( _n( 'Theme installed', 'Themes installed', $theme_count, 'desktop-mode' ) ); ?></span>
		</p>
	</section>
	<?php
}
add_action( 'admin_notices', 'openstation_render_themes_workspace_intro', 0 );

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
