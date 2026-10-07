export interface UpdateCountsEntry {

	total: number;

	formatted: string;

	text: string;

	url: string;
}

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

function createNode( counts: UpdateCountsEntry ): HTMLLIElement | null {
	if ( ! counts.url ) {
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

export function applyAdminBarUpdates( raw: unknown ): void {
	const counts = parseUpdateCounts( raw );
	if ( ! counts ) {
		return;
	}

	let node = document.getElementById( 'wp-admin-bar-updates' );

	if ( counts.total <= 0 ) {
		if ( node ) {
			node.style.display = 'none';
		}
		return;
	}

	if ( ! node ) {
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
