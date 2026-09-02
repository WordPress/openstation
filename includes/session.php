<?php
/**
 * OpenStation — Session Persistence.
 *
 * Persists each user's open desktop windows — URLs, positions, sizes,
 * states, and which window was focused — to user meta so a session can
 * be restored across page loads and, via the `/openstation` portal,
 * across devices. Cross-device viewport adaptation (a window that sat
 * in the far-right corner of a 3440px ultrawide landing sanely on a
 * 1280px laptop) happens client-side on restore.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * User meta key holding the serialized desktop session.
 *
 * The VALUE keeps its pre-rebrand spelling on purpose: it is a
 * persisted or externally-visible identifier, so renaming it would
 * orphan data already written by live installs (or break a live
 * URL). The mismatch between this constant's name and its value is
 * deliberate — it is NOT a half-finished rename.
 */
const OPENSTATION_SESSION_META_KEY = 'desktop_mode_session';

/**
 * The session meta key for the admin the request is running against.
 *
 * User meta is network-wide, so every site shared one blob, and the
 * sanitizer drops any window URL outside the current site's
 * `admin_url()` — so the first save from site B rewrote it and site A's
 * desktop was gone. The MAIN site keeps the bare key, and so does every
 * single-site install: those sessions already exist, and a new key would
 * silently empty every desktop on upgrade.
 *
 * The NETWORK admin gets its own key rather than sharing the main
 * site's, even though it runs in the main site's blog context. The two
 * desktops derive the same window ids from different admins —
 * `index-php` is the site dashboard on one and the network dashboard on
 * the other — so one shared blob meant the network desktop restored the
 * site's dashboard window (and the reverse), and the dock's Dashboard
 * tile focused the wrong admin's screen.
 *
 * @param bool|null $network The network admin's session (true) or the
 *                           current site's (false). Null follows the
 *                           request, which is wrong on `admin-ajax.php`
 *                           and REST — those callers must pass what the
 *                           client reported.
 * @return string Meta key to read and write.
 */
function openstation_session_meta_key( $network = null ) {
	if ( null === $network ) {
		$network = is_multisite() && is_network_admin();
	}
	if ( $network ) {
		return OPENSTATION_SESSION_META_KEY . '_network';
	}
	return ! is_multisite() || get_current_blog_id() === get_main_site_id()
		? OPENSTATION_SESSION_META_KEY
		: OPENSTATION_SESSION_META_KEY . '_' . get_current_blog_id();
}

/**
 * Whether a persisted window URL belongs to the session's admin.
 *
 * The scope gate behind the per-admin meta keys: keys separate the
 * blobs, this separates their CONTENTS, so a blob written before the
 * keys split (or by an older client posting to the wrong scope) heals
 * on read instead of restoring one admin's window on the other's
 * desktop. Runs on read and on sanitize both.
 *
 * @param string $url     Absolute window URL, already same-admin checked.
 * @param bool   $network Whether the session is the network admin's.
 * @return bool True when the URL lives in the session's own admin.
 */
function openstation_session_url_in_scope( $url, $network ) {
	$path       = wp_parse_url( $url, PHP_URL_PATH );
	$in_network = is_string( $path ) && false !== strpos( $path, '/wp-admin/network/' );
	return $in_network === (bool) $network;
}

/**
 * Whether a window URL may persist in this session, given the desktop
 * it sits on.
 *
 * Two ways in:
 *
 *  1. The session's own admin — same-origin, under this site's admin
 *     path, on the right side of the network split. The rule every
 *     window has always had to satisfy.
 *  2. A site Space — a desktop persisted with a `scope` may hold
 *     windows of exactly that admin: same HOST as this one (a Space
 *     is an iframe arrangement, and cross-origin cannot be framed),
 *     path whose admin scope equals the desktop's. This is the one
 *     deliberate exception to per-admin session scoping.
 *
 * @param string $url           Absolute window URL.
 * @param bool   $network       Whether the session is the network admin's.
 * @param string $desktop_scope The window's desktop's declared scope, or ''.
 * @return bool
 */
function openstation_session_window_url_ok( $url, $network, $desktop_scope = '' ) {
	if ( openstation_url_is_same_admin( $url ) && openstation_session_url_in_scope( $url, $network ) ) {
		return true;
	}
	if ( '' === $desktop_scope ) {
		return false;
	}

	$parts       = wp_parse_url( $url );
	$admin_parts = wp_parse_url( admin_url() );
	if ( ! is_array( $parts ) || ! is_array( $admin_parts ) ) {
		return false;
	}
	$url_host   = isset( $parts['host'] ) ? strtolower( $parts['host'] ) : '';
	$admin_host = isset( $admin_parts['host'] ) ? strtolower( $admin_parts['host'] ) : '';
	if ( '' === $url_host || $url_host !== $admin_host ) {
		return false;
	}

	$path = isset( $parts['path'] ) ? $parts['path'] : '';
	return openstation_admin_scope_of_path( $path ) === $desktop_scope;
}

/**
 * The validated `scope` of one raw desktop entry, or ''.
 *
 * A scope is stored only when it IS a normalized admin-scope path —
 * its own `openstation_admin_scope_of_path()` fixed point — which
 * rules out full URLs, query strings, traversal and free text in one
 * comparison.
 *
 * @param mixed $desktop Raw desktop entry from the client or meta.
 * @return string
 */
function openstation_session_desktop_scope( $desktop ) {
	if ( ! is_array( $desktop ) || ! isset( $desktop['scope'] ) || ! is_string( $desktop['scope'] ) ) {
		return '';
	}
	$scope = $desktop['scope'];
	if ( '' === $scope || strlen( $scope ) > 200 ) {
		return '';
	}
	// Path-rooted only: the fixed-point test below cannot tell a full
	// URL apart (the whole of `http://host/site2/wp-admin/` is its own
	// "scope"), so anything not shaped like a clean absolute path is
	// out before it.
	if (
		'/' !== $scope[0]
		|| false !== strpos( $scope, '//' )
		|| false !== strpos( $scope, '\\' )
		|| false !== strpos( $scope, '..' )
	) {
		return '';
	}
	return openstation_admin_scope_of_path( $scope ) === $scope ? $scope : '';
}

/** Hard cap on persisted windows — guards against runaway meta size. */
const OPENSTATION_SESSION_MAX_WINDOWS = 32;

/**
 * Hard cap on a native window's persisted open-time params. These are
 * "which user / which customer / which tab" — a handful of scalars,
 * never a payload. The cap is what stops a careless (or hostile)
 * client turning the session blob into a data store.
 */
const OPENSTATION_SESSION_MAX_PARAMS = 12;

/** Hard cap on persisted desktops ("Spaces"). Generous — power-users
 * with 8+ desktops are vanishingly rare, and we'd rather drop tail
 * desktops than balloon user meta. */
const OPENSTATION_SESSION_MAX_DESKTOPS = 16;

/** Allowed values for a window's state field. */
const OPENSTATION_SESSION_STATES = array( 'normal', 'minimized', 'maximized', 'fullscreen' );

/**
 * Current time as epoch milliseconds.
 *
 * The session's `updated` field is the ordering key for the
 * stale-write guard and the client stamps it with `Date.now()`.
 * Server-side fallbacks have to speak the same unit — see
 * {@see openstation_save_session()} for why the resolution matters.
 *
 * @return int Epoch milliseconds.
 */
function openstation_session_now_ms() {
	return (int) round( microtime( true ) * 1000 );
}

/** Default desktop entry seeded into empty / corrupt sessions. */
function openstation_default_desktop() {
	return array(
		'id'    => 'desktop-1',
		'label' => 'Desktop 1',
	);
}

/**
 * Returns the default empty session shape.
 *
 * Includes a default desktop ("Desktop 1") so the client can always
 * assume at least one desktop exists at boot — the shell can't
 * function with zero desktops.
 *
 * @return array{windows: array, desktops: array, activeDesktop: string, focused: string, updated: int}
 */
function openstation_empty_session() {
	return array(
		'windows'       => array(),
		'desktops'      => array( openstation_default_desktop() ),
		'activeDesktop' => 'desktop-1',
		'focused'       => '',
		'updated'       => 0,
	);
}

/**
 * Retrieves the saved desktop session for a user.
 *
 * Always returns a well-shaped array so callers don't have to defend
 * against corrupt or partial meta.
 *
 * @param int       $user_id The user ID.
 * @param bool|null $network See {@see openstation_session_meta_key()}.
 * @return array{windows: array, desktops: array, activeDesktop: string, focused: string, updated: int}
 */
function openstation_get_session( $user_id, $network = null ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return openstation_empty_session();
	}
	if ( null === $network ) {
		$network = is_multisite() && is_network_admin();
	}

	$raw = get_user_meta( $user_id, openstation_session_meta_key( $network ), true );
	if ( ! is_array( $raw ) ) {
		return openstation_empty_session();
	}

	// Desktops + activeDesktop are post-0.4.0 additions. Sessions
	// saved before they existed don't carry either field — fall back
	// to the single default desktop so older sessions degrade
	// gracefully rather than booting into a zero-desktop limbo.
	$desktops       = isset( $raw['desktops'] ) && is_array( $raw['desktops'] )
		? array_values( $raw['desktops'] )
		: array( openstation_default_desktop() );
	$active_desktop = isset( $raw['activeDesktop'] ) ? (string) $raw['activeDesktop'] : 'desktop-1';

	// Scope gate on read: drop windows persisted for the other admin.
	// Blobs written before the network admin had its own meta key mix
	// the two, and restoring across the split would open one admin's
	// window on the other's desktop under a colliding window id. A
	// desktop persisted with a `scope` (a site Space) keeps ITS
	// admin's windows — the same exception the sanitizer grants on
	// write.
	$scopes = array();
	foreach ( $desktops as $d ) {
		$d_scope = openstation_session_desktop_scope( $d );
		if ( '' !== $d_scope && is_array( $d ) && isset( $d['id'] ) ) {
			$scopes[ (string) $d['id'] ] = $d_scope;
		}
	}
	$windows = isset( $raw['windows'] ) && is_array( $raw['windows'] ) ? array_values( $raw['windows'] ) : array();
	$windows = array_values(
		array_filter(
			$windows,
			static function ( $win ) use ( $network, $scopes ) {
				if ( ! is_array( $win ) || ! empty( $win['native'] ) ) {
					return true;
				}
				$url       = isset( $win['url'] ) ? (string) $win['url'] : '';
				$desktop   = isset( $win['desktopId'] ) ? (string) $win['desktopId'] : '';
				$win_scope = isset( $scopes[ $desktop ] ) ? $scopes[ $desktop ] : '';
				return openstation_session_window_url_ok( $url, $network, $win_scope );
			}
		)
	);

	return array(
		'windows'       => $windows,
		'desktops'      => $desktops,
		'activeDesktop' => $active_desktop,
		'focused'       => isset( $raw['focused'] ) ? (string) $raw['focused'] : '',
		'updated'       => isset( $raw['updated'] ) ? (int) $raw['updated'] : 0,
	);
}

/**
 * Persists a sanitized desktop session to user meta.
 *
 * Rejects writes whose `updated` timestamp is older than what's
 * already on file — a simple last-write-wins guard that prevents two
 * tabs open on the same user from clobbering each other. The client
 * stamps `updated` with `Date.now()` — epoch MILLISECONDS — at
 * snapshot time (see `WindowManager.snapshot`), so this comparison
 * lines up with real wall-clock ordering on same-machine multi-tab
 * setups.
 *
 * Millisecond resolution is load-bearing, not cosmetic. The two
 * writes that race hardest are a `keepalive` fetch still in flight
 * and the `pagehide` beacon that supersedes it; at second resolution
 * they tie, and the tie rule below hands the win to whichever the
 * server processes last — which can be the stale one, reinstating a
 * window the user just closed.
 *
 * Sessions written before the switch carry a seconds value. Those are
 * ~1000x smaller than any millisecond stamp, so the first write after
 * an upgrade always wins — which is the correct outcome for a stamp
 * that is genuinely older.
 *
 * Equal timestamps are still accepted — that's a tie and whichever the
 * server processes first wins.
 *
 * @param int       $user_id The user ID.
 * @param array     $session Raw session payload (will be sanitized).
 * @param bool|null $network See {@see openstation_session_meta_key()}.
 * @return bool True on success, false when stale / invalid / failed.
 */
function openstation_save_session( $user_id, $session, $network = null ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return false;
	}
	if ( null === $network ) {
		$network = is_multisite() && is_network_admin();
	}

	if ( is_array( $session ) && isset( $session['updated'] ) ) {
		$incoming = (int) $session['updated'];
		if ( $incoming > 0 ) {
			$existing = openstation_get_session( $user_id, $network );
			$stored   = isset( $existing['updated'] ) ? (int) $existing['updated'] : 0;
			if ( $incoming < $stored ) {
				// Stale write — another tab saved a newer snapshot
				// after this one was taken. Bail so the user's latest
				// work isn't overwritten by a slow-to-arrive payload.
				return false;
			}
		}
	}

	$clean = openstation_sanitize_session( $session, $network );

	return false !== update_user_meta( $user_id, openstation_session_meta_key( $network ), $clean );
}

/**
 * Clears a user's saved desktop session.
 *
 * @param int       $user_id The user ID.
 * @param bool|null $network See {@see openstation_session_meta_key()}.
 * @return bool True on success.
 */
function openstation_clear_session( $user_id, $network = null ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return false;
	}
	return (bool) delete_user_meta( $user_id, openstation_session_meta_key( $network ) );
}

/**
 * Sanitizes a session payload before persistence.
 *
 * Rejects windows whose `url` isn't a same-origin admin URL or lives
 * in the other admin's scope, clamps geometry to sane integer ranges,
 * and normalizes the state enum. Windows beyond
 * {@see OPENSTATION_SESSION_MAX_WINDOWS} are dropped.
 *
 * @param mixed     $session Raw session data from the client.
 * @param bool|null $network See {@see openstation_session_meta_key()}.
 * @return array{windows: array, desktops: array, activeDesktop: string, focused: string, updated: int}
 */
function openstation_sanitize_session( $session, $network = null ) {
	if ( null === $network ) {
		$network = is_multisite() && is_network_admin();
	}
	$clean = openstation_empty_session();

	if ( ! is_array( $session ) ) {
		$clean['updated'] = openstation_session_now_ms();
		return $clean;
	}

	// Preserve the client's `updated` timestamp so the stale-write guard
	// in openstation_save_session compares client-to-client (not client-to-server
	// wallclock) — two saves landing in the same millisecond must tie, not lose.
	// The fallback matches the client's unit (epoch milliseconds); mixing
	// units here would store a seconds value that every later comparison
	// treats as ancient, quietly disabling the guard.
	$incoming_updated = isset( $session['updated'] ) ? (int) $session['updated'] : 0;
	$clean['updated'] = $incoming_updated > 0 ? $incoming_updated : openstation_session_now_ms();

	if ( isset( $session['focused'] ) && is_string( $session['focused'] ) ) {
		$clean['focused'] = sanitize_key( $session['focused'] );
	}

	// --- Desktops list -------------------------------------------
	// Build a sanitized desktops array first so we can validate
	// per-window desktopId against it below — windows assigned to
	// non-existent desktops are quietly remapped to the active
	// desktop on restore client-side, but we want server-side
	// integrity too.
	$desktop_ids    = array();
	$desktop_scopes = array();
	if ( isset( $session['desktops'] ) && is_array( $session['desktops'] ) ) {
		$clean_desktops = array();
		foreach ( $session['desktops'] as $d ) {
			if ( ! is_array( $d ) ) {
				continue;
			}
			$d_id = isset( $d['id'] ) ? sanitize_key( (string) $d['id'] ) : '';
			if ( '' === $d_id ) {
				continue;
			}
			$d_label = isset( $d['label'] ) ? wp_strip_all_tags( (string) $d['label'] ) : '';
			if ( '' === $d_label ) {
				$d_label = $d_id;
			}
			// 64-char cap on labels — generous for any sensible
			// human-typed desktop name, hard ceiling on meta size.
			if ( strlen( $d_label ) > 64 ) {
				$d_label = substr( $d_label, 0, 64 );
			}
			$entry = array(
				'id'    => $d_id,
				'label' => $d_label,
			);
			// A site Space: the desktop hosts another admin, and its
			// windows are allowed to address it — see
			// openstation_session_window_url_ok().
			$d_scope = openstation_session_desktop_scope( $d );
			if ( '' !== $d_scope ) {
				$entry['scope']            = $d_scope;
				$desktop_scopes[ $d_id ]   = $d_scope;
			}
			$clean_desktops[] = $entry;
			$desktop_ids[]    = $d_id;
			if ( count( $clean_desktops ) >= OPENSTATION_SESSION_MAX_DESKTOPS ) {
				break;
			}
		}
		if ( ! empty( $clean_desktops ) ) {
			$clean['desktops'] = $clean_desktops;
		}
	}
	// Always at least one desktop in the persisted shape — guards
	// against a client clearing every desktop and saving an empty
	// list, or omitting the key entirely.
	if ( empty( $clean['desktops'] ) ) {
		$clean['desktops'] = array( openstation_default_desktop() );
	}
	if ( empty( $desktop_ids ) ) {
		// Rebuild ids from the authoritative desktops list so the
		// per-window desktopId validation below has something to
		// compare against — otherwise a client that omits `desktops`
		// but sends windows would hit `$desktop_ids[0]` on an empty
		// array.
		$desktop_ids = array_map(
			static function ( $d ) {
				return isset( $d['id'] ) ? (string) $d['id'] : '';
			},
			$clean['desktops']
		);
		$desktop_ids = array_values( array_filter( $desktop_ids ) );
		if ( empty( $desktop_ids ) ) {
			$desktop_ids = array( 'desktop-1' );
		}
	}

	// --- Active desktop ------------------------------------------
	if ( isset( $session['activeDesktop'] ) && is_string( $session['activeDesktop'] ) ) {
		$candidate = sanitize_key( $session['activeDesktop'] );
		if ( in_array( $candidate, $desktop_ids, true ) ) {
			$clean['activeDesktop'] = $candidate;
		}
	}
	// Fallback: first valid desktop. Already true via openstation_empty_session
	// when the client passed nothing, but guards the case where
	// activeDesktop named a desktop that didn't survive sanitization.
	if ( ! in_array( $clean['activeDesktop'], $desktop_ids, true ) ) {
		$clean['activeDesktop'] = $desktop_ids[0];
	}

	if ( isset( $session['windows'] ) && is_array( $session['windows'] ) ) {
		foreach ( $session['windows'] as $win ) {
			if ( ! is_array( $win ) ) {
				continue;
			}

			$id = isset( $win['id'] ) ? sanitize_key( (string) $win['id'] ) : '';
			if ( '' === $id ) {
				continue;
			}

			// `baseId` groups multi-instance windows of the same admin page
			// (e.g. `edit-php`, `edit-php-2`, `edit-php-3` all share baseId
			// `edit-php`). Optional — older sessions predate the field and
			// the client falls back to `id` when missing.
			$base_id = isset( $win['baseId'] ) ? sanitize_key( (string) $win['baseId'] ) : '';
			if ( '' === $base_id ) {
				$base_id = $id;
			}

			// Map the window to a known desktop BEFORE the URL gate —
			// a scoped desktop (a site Space) widens what its windows
			// may address. A client that sends a desktopId pointing at
			// a non-existent desktop (race with a desktop close, or a
			// malicious payload) is silently remapped to the active
			// desktop so the window remains visible — losing it on
			// restore would be the worse UX. The remap also strips any
			// Space privilege the dead id might have carried.
			$win_desktop = isset( $win['desktopId'] ) ? sanitize_key( (string) $win['desktopId'] ) : '';
			if ( '' === $win_desktop || ! in_array( $win_desktop, $desktop_ids, true ) ) {
				$win_desktop = $clean['activeDesktop'];
			}

			// Native windows (OS Settings, Bug Report, anything from
			// `openstation_register_window()`) carry no admin URL —
			// the shell reconstructs them from the registry by id. Their
			// `url` is a `#slug` marker, which would fail the same-admin
			// check below and drop the window from the session entirely.
			// Synthesise the marker server-side instead of trusting (or
			// storing) whatever string the client sent: nothing ever
			// navigates to it, so there is no reason to round-trip a
			// client-controlled value through user meta.
			$is_native = ! empty( $win['native'] );

			if ( $is_native ) {
				$url = '#' . $id;
			} else {
				$url = isset( $win['url'] ) ? esc_url_raw( (string) $win['url'] ) : '';
				// Only allow URLs this session may hold: same-origin,
				// inside this admin — or inside the window's desktop's
				// declared scope, the site-Space exception. Host+path
				// parsing rejects tricks like `//evil.com/wp-admin/…`
				// that a raw prefix check would miss, and one admin's
				// window never persists into another's session outside
				// a Space.
				$win_scope = isset( $desktop_scopes[ $win_desktop ] ) ? $desktop_scopes[ $win_desktop ] : '';
				if ( '' === $url || ! openstation_session_window_url_ok( $url, $network, $win_scope ) ) {
					continue;
				}
				// Strip transient/routing flags before storage. The chromeless
				// `openstation_chromeless` flag is an iframe-only concern and must never
				// end up in a top-level URL (e.g., the portal's entry URL);
				// the portal and classic flags only live on a single request.
				$url = remove_query_arg(
					array( 'openstation_chromeless', OPENSTATION_PORTAL_FLAG, OPENSTATION_CLASSIC_FLAG ),
					$url
				);
			}

			$state = isset( $win['state'] ) ? (string) $win['state'] : 'normal';
			if ( ! in_array( $state, OPENSTATION_SESSION_STATES, true ) ) {
				$state = 'normal';
			}

			$entry = array(
				'id'        => $id,
				'baseId'    => $base_id,
				'desktopId' => $win_desktop,
				'url'       => $url,
				'title'     => isset( $win['title'] ) ? wp_strip_all_tags( (string) $win['title'] ) : '',
				'icon'      => isset( $win['icon'] ) ? sanitize_html_class( (string) $win['icon'] ) : 'dashicons-admin-generic',
				'state'     => $state,
				'x'         => openstation_sanitize_session_dimension( $win['x'] ?? 0, -10000, 10000 ),
				'y'         => openstation_sanitize_session_dimension( $win['y'] ?? 0, -10000, 10000 ),
				'width'     => openstation_sanitize_session_dimension( $win['width'] ?? 800, 0, 20000 ),
				'height'    => openstation_sanitize_session_dimension( $win['height'] ?? 600, 0, 20000 ),
			);

			// Marks the entry for the shell's restore path: native
			// windows reopen through the native-window registry, not by
			// pointing an iframe at a URL. Only written when true so
			// sessions of plain admin windows keep their existing shape.
			if ( $is_native ) {
				$entry['native'] = true;

				// A native window's open-time arguments: WHAT it is
				// showing, as opposed to what it is. A native window
				// is addressed by id, and its id is its identity
				// (`desktop-mode-user-edit` is "the profile editor",
				// not "the profile editor for user 12"), so a
				// singleton that retargets has nowhere else to record
				// its subject. Drop these and the window restores onto
				// its default — the profile window comes back showing
				// whoever is logged in, the customer window comes back
				// empty.
				//
				// Only for native entries: an iframe window's URL
				// already says what it shows, and it round-trips on
				// its own.
				$params = openstation_sanitize_session_params( $win['params'] ?? null );
				if ( ! empty( $params ) ) {
					$entry['params'] = $params;
				}
			}

			// Sanitize external sub-tabs. Each entry carries a URL
			// (any http/https — external tabs are explicitly for links
			// OUT of wp-admin, so we don't restrict to same-origin
			// here) and a label. Capped at a reasonable per-window
			// limit so a runaway client can't balloon user meta.
			if ( isset( $win['externalTabs'] ) && is_array( $win['externalTabs'] ) ) {
				$tabs = array();
				foreach ( $win['externalTabs'] as $tab ) {
					if ( ! is_array( $tab ) ) {
						continue;
					}
					$tab_url = isset( $tab['url'] ) ? esc_url_raw( (string) $tab['url'], array( 'http', 'https' ) ) : '';
					if ( '' === $tab_url ) {
						continue;
					}
					// Hard cap on URL length — a runaway client (or a
					// malicious payload) could otherwise push many
					// megabytes of URL into user meta. 2048 is the
					// de-facto IE-legacy URL length limit and covers
					// every real URL the shell restores.
					if ( strlen( $tab_url ) > 2048 ) {
						continue;
					}
					$label = isset( $tab['label'] ) ? wp_strip_all_tags( (string) $tab['label'] ) : '';
					// Trim long labels server-side too, mirroring the
					// client-side 80-char slice in the chromeless
					// bridge. Keeps meta size predictable.
					if ( strlen( $label ) > 80 ) {
						$label = substr( $label, 0, 80 );
					}
					$tabs[] = array(
						'url'   => $tab_url,
						'label' => $label,
					);
					if ( count( $tabs ) >= 16 ) {
						break;
					}
				}
				if ( ! empty( $tabs ) ) {
					$entry['externalTabs'] = $tabs;
				}
			}

			$clean['windows'][] = $entry;

			if ( count( $clean['windows'] ) >= OPENSTATION_SESSION_MAX_WINDOWS ) {
				break;
			}
		}
	}

	return $clean;
}

/**
 * Clamps a numeric dimension into a sane range.
 *
 * Geometry coming from the client is untrusted. A malicious or buggy
 * payload could try to stash multi-million-pixel values in meta,
 * negative values that break the shell, or non-numeric garbage
 * (strings, arrays, objects). This enforces numeric type and min/max
 * bounds, falling back to `$min` for anything non-numeric so the
 * window restores to a sane geometry rather than colliding with 0.
 *
 * Array/object input and non-numeric strings are rejected by
 * `is_numeric()`; float `INF`/`NAN` pass that gate but cast to 0 and
 * are then clamped into `[min, max]`, so no out-of-range value
 * survives.
 *
 * @param mixed $value The raw value.
 * @param int   $min   Minimum allowed value.
 * @param int   $max   Maximum allowed value.
 * @return int The clamped integer.
 */
function openstation_sanitize_session_dimension( $value, $min, $max ) {
	if ( is_string( $value ) ) {
		$value = trim( $value );
	}
	if ( ! is_numeric( $value ) ) {
		return (int) $min;
	}
	$value = (int) $value;
	if ( $value < $min ) {
		return (int) $min;
	}
	if ( $value > $max ) {
		return (int) $max;
	}
	return $value;
}

/**
 * Sanitize a native window's open-time params.
 *
 * These say WHAT a native window is showing (`{ userId: 12 }`,
 * `{ customerId: 7 }`) as opposed to what it is — see
 * `WindowConfig.params` on the JS side. They come from the client, so
 * they are untrusted, unbounded, and arbitrarily nested unless this
 * says otherwise.
 *
 * The rules mirror the client's own sanitizer so both ends agree on
 * what survives: scalar values only (string, finite number, bool),
 * and hard caps on both the number of keys and the length of a string
 * value. Anything else is dropped rather than rejected — one careless
 * value from a plugin must not cost the user every window's geometry.
 *
 * Keys are filtered to `[A-Za-z0-9_-]` rather than passed through
 * `sanitize_key()`, which **lowercases**. Every param name in the
 * shell is camelCase (`customerId`, `userId`), so lowercasing would
 * store `customerid` and the client's `params.customerId` would read
 * `undefined` — a window that restores blank, with the data sitting
 * right there under a name nobody looks up.
 *
 * @param mixed $params Raw params from the payload.
 * @return array Sanitized params, possibly empty.
 */
function openstation_sanitize_session_params( $params ) {
	if ( ! is_array( $params ) ) {
		return array();
	}

	$clean = array();
	foreach ( $params as $key => $value ) {
		if ( count( $clean ) >= OPENSTATION_SESSION_MAX_PARAMS ) {
			break;
		}
		$key = substr( preg_replace( '/[^A-Za-z0-9_-]/', '', (string) $key ), 0, 64 );
		if ( '' === $key ) {
			continue;
		}
		if ( is_bool( $value ) ) {
			$clean[ $key ] = $value;
			continue;
		}
		if ( is_int( $value ) || is_float( $value ) ) {
			if ( is_finite( (float) $value ) ) {
				$clean[ $key ] = $value + 0;
			}
			continue;
		}
		if ( is_string( $value ) ) {
			// A window param is an id, a slug or a short label. The
			// cap keeps a runaway client from pushing megabytes into
			// user meta, the same way the external-tab URL cap does.
			$clean[ $key ] = substr( sanitize_text_field( $value ), 0, 256 );
		}
	}

	return $clean;
}

/**
 * Registers the REST routes used by the desktop shell to load and save
 * the current user's session.
 */
function openstation_register_session_rest_routes() {
	// `network` addresses the network admin's own session. The route
	// runs in the main site's blog context whichever desktop is
	// saving, so the shell says which one it is: the network screen's
	// `sessionUrl` carries `network=1`.
	$network_arg = array(
		'network' => array(
			'type'    => 'boolean',
			'default' => false,
		),
	);
	register_rest_route(
		'desktop-mode/v1',
		'/session',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => 'openstation_rest_get_session',
				'permission_callback' => 'openstation_rest_session_permission',
				'args'                => $network_arg,
			),
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => 'openstation_rest_save_session',
				'permission_callback' => 'openstation_rest_session_permission',
				'args'                => array_merge(
					array(
						'session' => array(
							'required' => true,
							'type'     => 'object',
						),
					),
					$network_arg
				),
			),
			array(
				'methods'             => WP_REST_Server::DELETABLE,
				'callback'            => 'openstation_rest_clear_session',
				'permission_callback' => 'openstation_rest_session_permission',
				'args'                => $network_arg,
			),
		)
	);
}
add_action( 'rest_api_init', 'openstation_register_session_rest_routes' );

/**
 * Permission gate for the session REST routes: logged-in users who have
 * OpenStation enabled. See {@see openstation_rest_require_enabled()}
 * for why `read` alone is insufficient.
 *
 * @return true|WP_Error
 */
function openstation_rest_session_permission() {
	return openstation_rest_require_enabled();
}

/**
 * Which admin's session a REST call addresses.
 *
 * `is_network_admin()` is false on every REST request, so the client
 * reports the scope (`network=1`, stamped onto the network screen's
 * `sessionUrl`). Honoured only for users who can open the network
 * desktop at all — anyone else's flag falls back to the site session
 * rather than minting a blob for a desktop they cannot reach.
 *
 * @param WP_REST_Request $request The REST request.
 * @return bool True when the call addresses the network admin's session.
 */
function openstation_rest_session_network( WP_REST_Request $request ) {
	return is_multisite()
		&& rest_sanitize_boolean( $request->get_param( 'network' ) )
		&& current_user_can( 'manage_network' );
}

/**
 * GET /desktop-mode/v1/session — returns the caller's session.
 *
 * @param WP_REST_Request $request The REST request.
 * @return WP_REST_Response
 */
function openstation_rest_get_session( WP_REST_Request $request ) {
	return rest_ensure_response(
		openstation_get_session( get_current_user_id(), openstation_rest_session_network( $request ) )
	);
}

/**
 * POST /desktop-mode/v1/session — replaces the caller's session.
 *
 * @param WP_REST_Request $request The REST request.
 * @return WP_REST_Response The stored session (after sanitization).
 */
function openstation_rest_save_session( WP_REST_Request $request ) {
	$user_id = get_current_user_id();
	$payload = $request->get_param( 'session' );
	$network = openstation_rest_session_network( $request );
	openstation_save_session( $user_id, $payload, $network );
	return rest_ensure_response( openstation_get_session( $user_id, $network ) );
}

/**
 * DELETE /desktop-mode/v1/session — clears the caller's session.
 *
 * @param WP_REST_Request $request The REST request.
 * @return WP_REST_Response
 */
function openstation_rest_clear_session( WP_REST_Request $request ) {
	openstation_clear_session( get_current_user_id(), openstation_rest_session_network( $request ) );
	return rest_ensure_response( openstation_empty_session() );
}
