<?php
/**
 * OpenStation — Shared workspaces: the fence.
 *
 * A workspace narrows the rails, and narrowing is a view: an app it
 * hides is still one typed URL away. For a user PINNED to a shared
 * workspace that is not good enough — the admin who shared it meant
 * "these screens and no others" — so the screens the workspace does
 * not include are refused on the server, inside a window and out.
 *
 * What the workspace includes is worked out from the RECIPIENT'S own
 * admin menu at request time, never from anything the client sent:
 * the menu items whose ids the workspace keeps, every page under them,
 * and the pages its launch list opens. A post type's list implies its
 * editor; a taxonomy's list implies its term screen; the Media library
 * implies uploading.
 *
 * This is a guardrail, not a security boundary. It fences admin
 * SCREENS; capabilities still decide what a user may do, and a
 * REST or AJAX call is answered on the capability alone. To take a
 * power away from someone, take it off their role.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Screens a pinned user can always reach, whatever the workspace keeps.
 *
 * The shell itself, the Dashboard (the shell's own landing), and the
 * user's own profile — a workspace must never cost someone the page
 * where they change their password.
 *
 * @return string[] Admin-relative URLs.
 */
function openstation_workspace_fence_always_allowed() {
	/**
	 * Filters the screens a pinned user can reach whatever their
	 * workspace includes.
	 *
	 * @param string[] $urls Admin-relative URLs. Default: the shell
	 *                       screen, index.php, profile.php.
	 */
	return (array) apply_filters(
		'openstation_workspace_fence_always_allowed',
		array( 'admin.php?page=' . OPENSTATION_SHELL_PAGE_SLUG, 'index.php', 'profile.php' )
	);
}

/**
 * Splits an admin URL into its file and query args.
 *
 * @param string $url Absolute or admin-relative URL.
 * @return array{file:string, args:array<string,string>}|null
 */
function openstation_workspace_fence_parse( $url ) {
	$url = html_entity_decode( (string) $url );
	$pos = strpos( $url, '/wp-admin/' );
	if ( false !== $pos ) {
		$url = substr( $url, $pos + strlen( '/wp-admin/' ) );
	}
	$path = (string) wp_parse_url( $url, PHP_URL_PATH );
	$file = basename( '' === $path ? 'index.php' : $path );
	$args = array();
	$qs   = wp_parse_url( $url, PHP_URL_QUERY );
	if ( is_string( $qs ) ) {
		wp_parse_str( $qs, $args );
	}
	// `os_tab` is the shell's own tab marker, never part of a screen.
	unset( $args['os_tab'] );
	$args = array_filter( $args, 'is_scalar' );
	return '' === $file ? null : array(
		'file' => $file,
		'args' => array_map( 'strval', $args ),
	);
}

/**
 * The screens a share lets a pinned user reach, in parsed form.
 *
 * @param array $share The share.
 * @return array{urls: array[], post_types: string[], taxonomies: string[]}|null
 *         Null when the workspace does not narrow at all (`apps.mode` is `all`).
 */
function openstation_workspace_fence_allowlist( $share ) {
	$profile = $share['profile'];
	if ( ! is_array( $profile ) || 'only' !== ( $profile['apps']['mode'] ?? 'all' ) ) {
		return null;
	}

	$urls = openstation_workspace_fence_always_allowed();
	$keep = array_flip( (array) ( $profile['apps']['ids'] ?? array() ) );
	foreach ( openstation_build_dock_items() as $item ) {
		if ( ! isset( $keep[ $item['id'] ] ) ) {
			continue;
		}
		$urls[] = $item['url'];
		foreach ( (array) $item['submenu'] as $sub ) {
			if ( ! empty( $sub['url'] ) && empty( $sub['offSite'] ) ) {
				$urls[] = $sub['url'];
			}
		}
	}
	foreach ( (array) ( $profile['windows'] ?? array() ) as $win ) {
		if ( ! empty( $win['url'] ) ) {
			$urls[] = $win['url'];
		}
	}

	$parsed     = array();
	$post_types = array();
	$taxonomies = array();
	foreach ( $urls as $url ) {
		$p = openstation_workspace_fence_parse( $url );
		if ( ! $p ) {
			continue;
		}
		$parsed[] = $p;
		if ( in_array( $p['file'], array( 'edit.php', 'post-new.php' ), true ) ) {
			$post_types[] = $p['args']['post_type'] ?? 'post';
		} elseif ( in_array( $p['file'], array( 'upload.php', 'media-new.php' ), true ) ) {
			$post_types[] = 'attachment';
		} elseif ( 'edit-tags.php' === $p['file'] && ! empty( $p['args']['taxonomy'] ) ) {
			$taxonomies[] = $p['args']['taxonomy'];
		}
	}

	return array(
		'urls'       => $parsed,
		'post_types' => array_values( array_unique( $post_types ) ),
		'taxonomies' => array_values( array_unique( $taxonomies ) ),
	);
}

/**
 * Whether the current request is a screen the allowlist includes.
 *
 * @param array  $allow   {@see openstation_workspace_fence_allowlist()}.
 * @param string $file    `$pagenow`.
 * @param array  $request Query args of the request.
 * @return bool
 */
function openstation_workspace_fence_matches( $allow, $file, $request ) {
	foreach ( $allow['urls'] as $url ) {
		if ( $url['file'] !== $file ) {
			continue;
		}
		// Every arg the allowed URL names must match; the request may
		// carry more (paging, filters, a search).
		$ok = true;
		foreach ( $url['args'] as $key => $value ) {
			if ( ! isset( $request[ $key ] ) || (string) $request[ $key ] !== $value ) {
				$ok = false;
				break;
			}
		}
		if ( $ok ) {
			return true;
		}
	}

	// A list implies its editor and its uploader.
	if ( in_array( $file, array( 'post.php', 'post-new.php' ), true ) ) {
		$type = 'post-new.php' === $file
			? ( $request['post_type'] ?? 'post' )
			: get_post_type( isset( $request['post'] ) ? absint( $request['post'] ) : 0 );
		return $type && in_array( $type, $allow['post_types'], true );
	}
	if ( 'media-new.php' === $file ) {
		return in_array( 'attachment', $allow['post_types'], true );
	}
	if ( in_array( $file, array( 'edit-tags.php', 'term.php' ), true ) ) {
		return ! empty( $request['taxonomy'] ) && in_array( $request['taxonomy'], $allow['taxonomies'], true );
	}
	return false;
}

/**
 * Refuses a screen the pinned user's workspace does not include.
 *
 * On `current_screen`: late enough that the menu is built (the
 * allowlist is read off it), early enough that nothing has rendered.
 * AJAX, REST and `admin-post.php` never reach this hook.
 *
 * @return void
 */
function openstation_workspace_fence_screen() {
	if ( is_network_admin() || wp_doing_ajax() ) {
		return;
	}
	$user_id = get_current_user_id();
	$pin     = openstation_workspace_pin_get( $user_id );
	if ( ! $pin ) {
		return;
	}
	$share = openstation_workspace_share_get( $pin['share'] );
	if ( ! $share ) {
		return;
	}
	global $pagenow;
	$file = (string) $pagenow;

	// "Hide settings" wins over everything the workspace includes.
	if ( ! empty( $share['profile']['restricted'] ) && in_array( $file, openstation_workspace_restricted_screens(), true ) ) {
		$allowed = false;
	} else {
		$allow = openstation_workspace_fence_allowlist( $share );
		if ( null === $allow ) {
			$allowed = true;
		} else {
			// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only routing.
			$request = array_map( 'strval', array_filter( wp_unslash( $_GET ), 'is_scalar' ) );
			$allowed = openstation_workspace_fence_matches( $allow, $file, $request );
		}
	}

	/**
	 * Filters whether a pinned user may load the current admin screen.
	 *
	 * @param bool   $allowed Whether the workspace includes this screen.
	 * @param int    $user_id The pinned user.
	 * @param array  $share   The share they are pinned to.
	 * @param string $pagenow The admin file being loaded.
	 */
	if ( apply_filters( 'openstation_workspace_fence_allows', $allowed, $user_id, $share, $file ) ) {
		return;
	}

	wp_die(
		esc_html__( 'This screen is not part of your workspace. Ask the person who set it up if you need it.', 'desktop-mode' ),
		esc_html__( 'Not in your workspace', 'desktop-mode' ),
		array( 'response' => 403 )
	);
}
add_action( 'current_screen', 'openstation_workspace_fence_screen' );
