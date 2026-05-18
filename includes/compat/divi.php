<?php
/**
 * Divi compatibility — script dependency repair.
 *
 * Divi (both the theme and the standalone Divi Builder plugin)
 * registers its block-editor bundle `et-builder-gutenberg` with
 * only `[ 'jquery', 'wp-hooks' ]` as dependencies. The bundle
 * calls `wp.data.select( 'core/editor' ).isCleanNewPost` at
 * module-load time (top-level statement, not inside a function),
 * so it needs the `core/editor` data store to be registered before
 * it executes. Without `wp-editor` (which pulls in `wp-data` and
 * registers `core/editor`) in the dep array, WordPress doesn't
 * guarantee that ordering — and when the bundle wins the race the
 * `select( ... )` call returns `undefined` and the bundle throws:
 *
 *     Uncaught TypeError: Cannot read properties of undefined
 *     (reading 'isCleanNewPost')
 *
 * The rest of Divi's React integration never mounts: no `Use Divi
 * Builder` block on new posts, no `PluginSidebar`, no toggle. To
 * the user it looks like Divi simply doesn't work inside a desktop
 * window.
 *
 * We inject the missing deps onto the existing registration so the
 * script loader prints `wp-editor`'s graph first and the bundle
 * runs against a populated `wp.data`. The shim is idempotent: if
 * Divi later ships the fix upstream (or renames the handle), this
 * becomes a no-op.
 *
 * Reported to Elegant Themes. Remove this file when Divi ships
 * the fix upstream.
 *
 * @since   0.18.x
 * @package WP_Desktop_Mode\Compat
 */

defined( 'ABSPATH' ) || exit;

/**
 * Inject `wp-data` and `wp-editor` as dependencies on Divi's
 * `et-builder-gutenberg` script registration, and (inside a
 * chromeless iframe) override Divi's `window.et_gb` assignment so
 * the bundle's webpack externals resolve to the iframe's own
 * `wp.data`.
 *
 * Two problems on the same script registration:
 *
 *  1. **Missing deps.** Divi declares only `[ jquery, wp-hooks ]`
 *     but the bundle reads from `wp.data` at module-load time. We
 *     add `wp-data` + `wp-editor` so the loader prints them first.
 *
 *  2. **`window.et_gb` resolves to the wrong frame.** Divi's
 *     bundle is webpack-built with `@wordpress/data` externalised
 *     to `window.et_gb.wp.data` — not `window.wp.data`. The inline
 *     script Divi adds (`before` the bundle) sets `window.et_gb`
 *     via this expression:
 *
 *         window.et_gb = (window.top && window.top.Cypress && …)
 *             || window.top   // ← falls through to here
 *             || window;
 *
 *     In classic admin `window.top === window`, so `et_gb =
 *     window` and `et_gb.wp.data` is the page's own `wp.data`.
 *     Inside our chromeless iframe `window.top` is the desktop
 *     shell — a different document with no `wp.data` — so
 *     `et_gb.wp.data` is undefined and the bundle throws on first
 *     access (`Cannot read properties of undefined (reading
 *     'isCleanNewPost')`). The rest of Divi's React integration
 *     never mounts: no `Use Divi Builder` block on new posts, no
 *     `PluginSidebar`, no toggle.
 *
 *     Multiple `wp_add_inline_script( …, 'before' )` calls
 *     concatenate in registration order, so appending our own
 *     `window.et_gb = window;` after Divi's lets our assignment
 *     win. Scoped to chromeless requests because Divi's original
 *     intent (use `window.top` when the parent is a Cypress
 *     harness) is sensible in other iframe contexts.
 *
 * Hooked at `enqueue_block_editor_assets` priority 999 so it runs
 * after Divi's own enqueue (priority 4) but before the script
 * loader prints `<script>` tags.
 *
 * Reported to Elegant Themes. Remove this file when Divi ships
 * the fix upstream.
 *
 * @since 0.18.x
 *
 * @return void
 */
function desktop_mode_compat_divi_fix_gutenberg_deps() {
	global $wp_scripts;

	if ( ! ( $wp_scripts instanceof WP_Scripts ) ) {
		return;
	}

	if ( ! isset( $wp_scripts->registered['et-builder-gutenberg'] ) ) {
		return;
	}

	$registration = $wp_scripts->registered['et-builder-gutenberg'];
	$existing     = (array) $registration->deps;

	foreach ( array( 'wp-data', 'wp-editor' ) as $dep ) {
		if ( ! in_array( $dep, $existing, true ) ) {
			$registration->deps[] = $dep;
		}
	}

	if ( function_exists( 'desktop_mode_is_chromeless_request' ) && desktop_mode_is_chromeless_request() ) {
		wp_add_inline_script(
			'et-builder-gutenberg',
			'window.et_gb = window;',
			'before'
		);
	}
}
add_action( 'enqueue_block_editor_assets', 'desktop_mode_compat_divi_fix_gutenberg_deps', 999 );
