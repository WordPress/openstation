/**
 * Admin-bar "updates" notifier repaint.
 *
 * Core renders `#wp-admin-bar-updates` (the circle-arrows icon + count
 * at the top-left) as static server HTML when the shell page loads —
 * and omits the node entirely when nothing is pending. After an
 * in-window update run the numbers are stale until a hard refresh
 * (GH#296), so the live menu-refresh payload now carries the aggregate
 * counts (`updateCounts`, built by `open_station_build_menu_payload()`)
 * and this module mirrors them onto the node: text + screen-reader
 * label when the count changes, hidden at zero, re-created when
 * updates appear on a shell that booted with none.
 *
 * All user-facing strings arrive prebuilt (translated + number-
 * formatted) from PHP, so this module never touches i18n.
 */

/** Shape of the payload's `updateCounts` key. */
export interface UpdateCountsEntry {
	/** Aggregate pending-update count (`wp_get_update_data()` total). */
	total: number;
	/** Locale-formatted count for the visible label ("3"). */
	formatted: string;
	/** Screen-reader text ("3 updates available"). */
	text: string;
	/** The update-core.php URL the node links to. */
	url: string;
}

/** Runtime-narrow an unknown payload value into `UpdateCountsEntry`. */
export function parseUpdateCounts( raw: unknown ): UpdateCountsEntry | null {
	if ( ! raw || typeof raw !== 'object' ) {
		return null;
	}
	const entry = raw as Record< string, unknown >;
	if ( typeof entry.total !== 'number' || ! Number.isFinite( entry.total ) ) {
		return null;
	}
	return {
		total: Math.max( 0, Math.floor( entry.total ) ),
		formatted:
			typeof entry.formatted === 'string' && entry.formatted !== ''
				? entry.formatted
				: String( entry.total ),
		text: typeof entry.text === 'string' ? entry.text : '',
		url: typeof entry.url === 'string' ? entry.url : '',
	};
}

/**
 * Build a fresh `#wp-admin-bar-updates` node mirroring Core's
 * `wp_admin_bar_updates_menu()` markup, so admin-bar CSS (which keys
 * off the ids/classes) styles it identically to a server-rendered one.
 */
function createNode( counts: UpdateCountsEntry ): HTMLLIElement | null {
	if ( ! counts.url ) {
		// Without a target URL the node would be a dead link — leave
		// the bar alone and let the next full page load render it.
		return null;
	}
	const li = document.createElement( 'li' );
	li.id = 'wp-admin-bar-updates';

	const anchor = document.createElement( 'a' );
	anchor.className = 'ab-item';
	anchor.href = counts.url;

	const icon = document.createElement( 'span' );
	icon.className = 'ab-icon';
	icon.setAttribute( 'aria-hidden', 'true' );

	const label = document.createElement( 'span' );
	label.className = 'ab-label';
	label.setAttribute( 'aria-hidden', 'true' );

	const srText = document.createElement( 'span' );
	srText.className = 'screen-reader-text updates-available-text';

	anchor.append( icon, label, srText );
	li.appendChild( anchor );
	return li;
}

/**
 * Mirror fresh update counts onto the admin-bar node. Safe no-op when
 * the shell has no admin bar (headless tests, exotic chrome).
 */
export function applyAdminBarUpdates( raw: unknown ): void {
	const counts = parseUpdateCounts( raw );
	if ( ! counts ) {
		return;
	}

	let node = document.getElementById( 'wp-admin-bar-updates' );

	if ( counts.total <= 0 ) {
		// Core omits the node entirely at zero; hiding (rather than
		// removing) keeps repaints cheap when updates reappear later.
		if ( node ) {
			node.style.display = 'none';
		}
		return;
	}

	if ( ! node ) {
		// The shell booted with zero pending updates, so Core never
		// rendered the node — build one in Core's slot (before the
		// comments bubble, matching admin_bar_menu priority order).
		const bar = document.getElementById( 'wp-admin-bar-root-default' );
		if ( ! bar ) {
			return;
		}
		node = createNode( counts );
		if ( ! node ) {
			return;
		}
		const comments = document.getElementById( 'wp-admin-bar-comments' );
		if ( comments && comments.parentNode === bar ) {
			bar.insertBefore( node, comments );
		} else {
			bar.appendChild( node );
		}
	}

	node.style.display = '';

	const label = node.querySelector( '.ab-label' );
	if ( label ) {
		label.textContent = counts.formatted;
	}
	const srText = node.querySelector( '.updates-available-text' );
	if ( srText ) {
		srText.textContent = counts.text;
	}
}
