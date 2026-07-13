<?php
/**
 * Desktop window content relations — server-side surface.
 *
 * A desktop window may carry a "content identity": the object the
 * page inside it shows ("post 123", "comment 45 of post 123"). The
 * shell groups windows sharing the same root object and draws visual
 * ties between them (see `src/window-links/` and
 * `docs/examples/window-links.md`).
 *
 * This file builds the authoritative identity for admin iframe pages.
 * It runs inside the chromeless iframe request — real admin context,
 * where `get_current_screen()` and the content globals are live — so
 * relations the URL alone can't answer (which post a comment belongs
 * to) resolve server-side and reach the shell via the chromeless
 * bridge's `desktop-mode-content-identity` postMessage.
 *
 * @since 0.9.4
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/**
 * Build the content identity for the current admin screen.
 *
 * Returns `null` when the screen shows no single identifiable object
 * (list tables, dashboards, settings pages, `post-new.php` before the
 * first save). Shape mirrors the JS `WindowContentRef`:
 *
 *     array(
 *         'type'  => 'comment',                          // sanitize_key'd object type
 *         'id'    => 45,
 *         'label' => 'Nice post! I especially liked…',   // optional, for tooltips
 *         'root'  => array( 'type' => 'post', 'id' => 123 ), // omitted when this IS a root
 *     )
 *
 * Detected screens:
 *  - `post.php` (post / page / CPT edit) — a root identity.
 *  - `post.php` on an attachment (Media edit) — `media`, rooted at
 *    `post_parent` when attached.
 *  - `comment.php` (comment edit / moderation) — `comment`, rooted at
 *    the parent post. The URL alone can't answer this one; only real
 *    admin context can.
 *
 * @since 0.9.4
 *
 * @return array|null Identity array, or `null` when none applies.
 */
function desktop_mode_build_content_identity() {
	$identity = null;
	$screen   = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
	$pagenow  = isset( $GLOBALS['pagenow'] ) ? (string) $GLOBALS['pagenow'] : '';

	if ( 'comment.php' === $pagenow ) {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only identity harvest; the host admin page enforces capability + nonce.
		$comment_id = isset( $_GET['c'] ) ? absint( $_GET['c'] ) : 0;
		$comment    = $comment_id ? get_comment( $comment_id ) : null;
		if ( $comment ) {
			$identity = array(
				'type'  => 'comment',
				'id'    => (int) $comment->comment_ID,
				'label' => wp_trim_words( $comment->comment_content, 10 ),
			);

			$post_id   = (int) $comment->comment_post_ID;
			$post_type = $post_id ? get_post_type( $post_id ) : false;
			if ( $post_type ) {
				$identity['root'] = array(
					'type' => sanitize_key( $post_type ),
					'id'   => $post_id,
				);
			}
		}
	} elseif ( $screen && 'post' === $screen->base && 'add' !== $screen->action ) {
		$post = get_post();
		if ( $post instanceof WP_Post && $post->ID > 0 ) {
			if ( 'attachment' === $post->post_type ) {
				$identity = array(
					'type'  => 'media',
					'id'    => (int) $post->ID,
					'label' => get_the_title( $post ),
				);

				$parent_id   = (int) $post->post_parent;
				$parent_type = $parent_id ? get_post_type( $parent_id ) : false;
				if ( $parent_type ) {
					$identity['root'] = array(
						'type' => sanitize_key( $parent_type ),
						'id'   => $parent_id,
					);
				}
			} else {
				$identity = array(
					'type'  => sanitize_key( $post->post_type ),
					'id'    => (int) $post->ID,
					'label' => get_the_title( $post ),
				);

				// Outbound references — the internal hyperlinks inside
				// this post's content, resolved to post ids. When a
				// window showing a linked post is open, the shell draws
				// a directed tie toward it (mutual links collapse into
				// one bidirectional arrow). Reuses the content-graph
				// extractor; guarded because that module is a separate
				// include.
				$links = desktop_mode_window_links_extract_references( $post );
				if ( ! empty( $links ) ) {
					$identity['links'] = $links;
				}
			}
		}
	}

	/**
	 * Filters the content identity announced for the current admin screen.
	 *
	 * Plugins add identities for their own admin screens (an order
	 * editor, a form-entry viewer) or return `null` to suppress the
	 * built-in detection. The shape must match the JS
	 * `WindowContentRef`: `type` (lowercase slug), `id` (int|string),
	 * optional `label`, optional `root => array( 'type', 'id' )`.
	 *
	 * @since 0.9.4
	 *
	 * @param array|null     $identity Identity array, or `null` for none.
	 * @param WP_Screen|null $screen   The current screen, when available.
	 */
	return apply_filters( 'desktop_mode_window_content_identity', $identity, $screen );
}

/**
 * Resolve a post's outbound internal references for the identity's
 * `links` array: every `<a href>` in `post_content` that points at
 * another post on this site, as `array( 'type' => ..., 'id' => ... )`
 * entries. Attachments and self-references are skipped; the list is
 * capped so a link-farm post can't flood the shell.
 *
 * @since 0.9.4
 *
 * @param WP_Post $post Source post.
 * @return array[] Reference entries, possibly empty.
 */
function desktop_mode_window_links_extract_references( $post ) {
	if ( ! function_exists( 'desktop_mode_content_graph_extract_internal_links' ) ) {
		return array();
	}

	$links = array();
	$ids   = desktop_mode_content_graph_extract_internal_links( (string) $post->post_content );
	foreach ( array_slice( $ids, 0, 32 ) as $target_id ) {
		$target_id = (int) $target_id;
		if ( $target_id === (int) $post->ID ) {
			continue;
		}
		$target_type = get_post_type( $target_id );
		if ( ! $target_type || 'attachment' === $target_type ) {
			continue;
		}
		$links[] = array(
			'type' => sanitize_key( $target_type ),
			'id'   => $target_id,
		);
	}
	return $links;
}

/**
 * Declare a WP-registered script handle as a window-link renderer
 * provider.
 *
 * Mirrors the unfocus-effect / command script registration pattern:
 * minimum-ceremony PHP opt-in tells the shell which enqueued scripts
 * contribute window-link renderers. The shell injects the script URL
 * into the live-refresh payload so a plugin activated mid-session
 * surfaces its renderer in OS Settings → Effects → Window links
 * immediately, no F5 needed.
 *
 * Renderers themselves are declared JS-side via
 * `wp.desktop.registerWindowLinkRenderer( … )` — the mount callback
 * and label live in the plugin's JavaScript. The built-in
 * `svg-splines` is registered through the very same JS hook (see
 * `src/window-links/renderers/svg-splines.ts`).
 *
 * Example:
 *
 * ```php
 * add_action( 'admin_enqueue_scripts', function () {
 *     wp_register_script(
 *         'my-plugin-link-renderer',
 *         plugins_url( 'js/link-renderer.js', __FILE__ ),
 *         array( 'desktop-mode' ),
 *         '1.0.0',
 *         true
 *     );
 *     wp_enqueue_script( 'my-plugin-link-renderer' );
 * } );
 * desktop_mode_register_window_link_renderer_script( 'my-plugin-link-renderer' );
 * ```
 *
 * For live unregistration on deactivation, the plugin's JS should set
 * `owner: 'my-plugin-link-renderer'` on each
 * `registerWindowLinkRenderer` call. Otherwise the renderer stays
 * until the next page reload — graceful backwards-compat.
 *
 * @since 0.9.4
 *
 * @param string $handle WP-registered script handle.
 * @return true|WP_Error `true` on success; `WP_Error` on validation failure.
 */
function desktop_mode_register_window_link_renderer_script( $handle ) {
	$handle = (string) $handle;
	if ( '' === $handle ) {
		return desktop_mode_registration_error(
			'desktop_mode_missing_handle',
			__( 'Window-link renderer script registration requires a non-empty script handle.', 'desktop-mode' )
		);
	}

	desktop_mode_window_link_renderer_script_registry( $handle, true );

	/**
	 * Fires after a window-link renderer script handle is registered.
	 *
	 * @since 0.9.4
	 *
	 * @param string $handle The registered script handle.
	 */
	do_action( 'desktop_mode_window_link_renderer_script_registered', $handle );

	return true;
}

/**
 * Internal module-level registry for window-link renderer script handles.
 *
 * @since 0.9.4
 * @internal
 *
 * @param string    $handle Script handle to read or write.
 * @param bool|null $value  Pass `true` to register; `null` to read only.
 * @return array|bool When called with no args returns the full store.
 */
function desktop_mode_window_link_renderer_script_registry( $handle = '', $value = null ) {
	static $store = array();

	if ( '__flush__' === (string) $handle ) {
		$store = array();
		return array();
	}
	if ( '' === (string) $handle ) {
		return $store;
	}
	if ( null !== $value ) {
		$store[ (string) $handle ] = (bool) $value;
	}
	return isset( $store[ (string) $handle ] ) ? $store[ (string) $handle ] : false;
}

/**
 * Test-only: clear the registry between PHPUnit cases. See
 * {@see desktop_mode_flush_script_handle_registries()}.
 *
 * @since 0.9.4
 */
function desktop_mode_flush_window_link_renderer_script_registry() {
	desktop_mode_window_link_renderer_script_registry( '__flush__' );
}

/**
 * Build the script-handle payload fed to the shell. Handles that
 * aren't currently enqueued resolve to an empty URL and are dropped.
 *
 * @since 0.9.4
 *
 * @return array[] List of `{ handle, scriptUrl, … }` entries.
 */
function desktop_mode_build_window_link_renderer_scripts_payload() {
	$registry = desktop_mode_window_link_renderer_script_registry();
	if ( ! is_array( $registry ) || empty( $registry ) ) {
		return array();
	}

	$out  = array();
	$seen = array();
	foreach ( $registry as $handle => $active ) {
		if ( ! $active || isset( $seen[ $handle ] ) ) {
			continue;
		}
		$payload = desktop_mode_resolve_script_payload( $handle );
		if ( '' === $payload['url'] ) {
			// Loud diagnostic — visible under WP_DEBUG. Deduped by
			// `desktop_mode_warn_unresolvable_script_handle` so the
			// notice fires once per handle per request.
			desktop_mode_warn_unresolvable_script_handle(
				'desktop_mode_register_window_link_renderer_script',
				'Window-link renderer',
				(string) $handle
			);
			continue;
		}
		$out[]           = array(
			'handle'             => (string) $handle,
			'scriptUrl'          => $payload['url'],
			'scriptBefore'       => $payload['before'],
			'scriptAfter'        => $payload['after'],
			'scriptL10n'         => $payload['l10n'],
			'scriptTranslations' => $payload['translations'],
		);
		$seen[ $handle ] = true;
	}
	return $out;
}
