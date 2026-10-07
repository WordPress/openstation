import { applyFilters, doAction, HOOKS } from '../hooks';
import { __, sprintf } from '../i18n';
import { showToast } from '../toast';
import { registerWindowAction } from '../window-actions/registry';
import { getWindowContent } from '../window-links/engine';
import { loadNativeWindowGeometry } from '../window-manager/native-window-geometry';
import { revisionWindowPlacement } from './placement';

import type { WindowConfig } from '../types';
import type { WindowContentRef } from '../window-links/types';

interface RevisionsWindowLike {
	id: string;
	element?: HTMLElement | null;
}

interface RevisionsManager {
	getById: ( id: string ) => RevisionsWindowLike | null | undefined;
	open: (
		config: Partial< WindowConfig > & {
			id: string;
			url: string;
			title: string;
		},
	) => Promise< unknown >;
}

type RevisionsWindowConfig = Partial< WindowConfig > & {
	id: string;
	url: string;
	title: string;
};

export function revisionsWindowId( content: WindowContentRef ): string {
	return `revisions-${ String( content.type ).replace( /\//g, '-' ) }-${
		content.id
	}`;
}

export function revisionsLabel(
	content: WindowContentRef | null | undefined,
): string {
	const count = content?.revisionCount;
	if ( typeof count === 'number' && count > 0 ) {
		return sprintf(

			__( 'View revisions (%d)' ),
			count,
		);
	}
	return __( 'View revisions' );
}

function openingGeometry(
	manager: RevisionsManager,
	editorId: string,
	windowId: string,
): Partial< Pick< WindowConfig, 'x' | 'y' | 'width' | 'height' > > {
	if ( loadNativeWindowGeometry( windowId ) ) {
		return {};
	}
	if (
		typeof window.matchMedia === 'function' &&
		window.matchMedia( '(max-width: 767px)' ).matches
	) {
		return {};
	}
	const editorEl = manager.getById( editorId )?.element;
	const area = document.getElementById( 'os-area' );

	if (
		! editorEl ||
		! area ||
		editorEl.offsetParent === null ||
		editorEl.offsetWidth === 0
	) {
		return {};
	}
	return revisionWindowPlacement(
		{
			x: editorEl.offsetLeft,
			y: editorEl.offsetTop,
			width: editorEl.offsetWidth,
			height: editorEl.offsetHeight,
		},
		{ width: area.clientWidth, height: area.clientHeight },
	);
}

export async function openRevisionsWindow(
	manager: RevisionsManager,
	win: RevisionsWindowLike,
): Promise< void > {
	const content = getWindowContent( win.id );
	if ( ! content?.revisionsUrl ) {
		showToast( {
			message: __( 'No revisions are available for this content.' ),
		} );
		return;
	}

	const windowId = revisionsWindowId( content );
	let title = __( 'Revisions' );
	if ( content.label ) {
		title = sprintf(

			__( 'Revisions: %s' ),
			content.label,
		);
	}

	let config: RevisionsWindowConfig = {
		id: windowId,
		baseId: windowId,
		url: content.revisionsUrl,
		title,
		icon: 'dashicons-backup',
		content: {
			type: 'revisions',
			id: content.id,
			root: { type: content.type, id: content.id },
			label: title,
		},
		...openingGeometry( manager, win.id, windowId ),
	};

	const filtered = applyFilters< RevisionsWindowConfig >(
		HOOKS.REVISIONS_WINDOW_CONFIG,
		config,
		{ editorWindowId: win.id, content },
	);
	if (
		filtered &&
		typeof filtered === 'object' &&
		typeof filtered.id === 'string' &&
		filtered.id !== '' &&
		typeof filtered.url === 'string' &&
		filtered.url !== ''
	) {
		config = filtered;
	} else if ( typeof console !== 'undefined' ) {
		console.warn(
			'[openstation] `os.revisions.window-config` filter ' +
				'returned an invalid config; using the default.',
		);
	}

	await manager.open( config );

	const detail = {
		editorWindowId: win.id,
		revisionsWindowId: config.id,
		content,
	};
	document.dispatchEvent(
		new CustomEvent( 'os-revisions-opened', { detail } ),
	);
	doAction( HOOKS.REVISIONS_OPENED, detail );
}

export function bootRevisions( {
	manager,
}: {
	manager: RevisionsManager;
} ): void {
	registerWindowAction( {
		id: 'desktop-mode/view-revisions',
		label: ( win ) => revisionsLabel( getWindowContent( win.id ) ),
		icon: 'dashicons-backup',

		order: 60,
		isVisible: ( win ) => !! getWindowContent( win.id )?.revisionsUrl,
		onSelect: ( win ) => {
			void openRevisionsWindow( manager, win );
		},
	} );
}
