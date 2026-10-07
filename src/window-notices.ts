import { createSharedStore } from './shared-store';
import {
	registerWindowSlot,
	unregisterWindowSlot,
} from './window-chrome/slots/registry';
import type { Window as DesktopWindow } from './window';
import {
	clearNoticeDismissed,
	markNoticeDismissed,
} from './ui/components/os-notice/storage';

import './ui/components/os-notice/os-notice';

export type WindowNoticeTone =
	| 'info'
	| 'success'
	| 'warning'
	| 'error'
	| 'danger'
	| 'neutral';

export type WindowNoticeMatch = ( win: DesktopWindow ) => boolean;

export interface WindowNoticeEntry {

	id: string;

	message: string;

	tone?: WindowNoticeTone;

	dismissible?: boolean;

	icon?: string;

	match?: WindowNoticeMatch;

	order?: number;

	owner?: string;
}

interface RegistryState {
	entries: Map< string, WindowNoticeEntry >;
}

const store = createSharedStore< RegistryState >(
	'desktop-mode/window-notices',
	() => ( { entries: new Map() } ),
);

const ID_PATTERN = /^[a-z0-9_/-]+$/;

function slotIdFor( id: string ): string {
	return `os-notice/${ id.toLowerCase() }`;
}

function buildNoticeElement( entry: WindowNoticeEntry ): HTMLElement {
	const el = document.createElement( 'os-notice' );
	el.setAttribute( 'tone', entry.tone ?? 'info' );
	el.setAttribute( 'notice-id', entry.id );
	if ( entry.dismissible === false ) {
		el.setAttribute( 'not-dismissible', '' );
	}
	if ( entry.icon ) {
		el.setAttribute( 'icon', entry.icon );
	}

	el.innerHTML = entry.message;
	return el;
}

export function registerWindowNotice(
	entry: WindowNoticeEntry,
): () => void {
	if ( ! entry || typeof entry !== 'object' ) {
		return () => {};
	}
	const id = String( entry.id ?? '' ).trim().toLowerCase();
	if ( ! id || ! ID_PATTERN.test( id ) ) {
		return () => {};
	}
	if ( typeof entry.message !== 'string' || entry.message === '' ) {
		return () => {};
	}

	const normalised: WindowNoticeEntry = { ...entry, id };
	store.state.entries.set( id, normalised );

	const slotId = slotIdFor( id );
	registerWindowSlot( {
		id: slotId,
		slot: 'after-titlebar',
		order: normalised.order ?? 100,

		replace: false,
		owner: normalised.owner,
		match: ( win ) => {
			const def = store.state.entries.get( id );
			if ( ! def ) {
				return false;
			}
			if ( typeof def.match !== 'function' ) {
				return true;
			}
			try {
				return def.match( win ) === true;
			} catch {
				return false;
			}
		},
		render: ( host ) => {
			const def = store.state.entries.get( id );
			if ( ! def ) {
				return;
			}
			host.appendChild( buildNoticeElement( def ) );
		},
	} );

	return () => unregisterWindowNotice( id );
}

export function unregisterWindowNotice( id: string ): void {
	const key = String( id ?? '' ).trim().toLowerCase();
	if ( ! key ) {
		return;
	}
	if ( store.state.entries.delete( key ) ) {
		unregisterWindowSlot( slotIdFor( key ) );
	}
}

export function listWindowNotices(): WindowNoticeEntry[] {
	return Array.from( store.state.entries.values() ).sort( ( a, b ) => {
		const oa = a.order ?? 100;
		const ob = b.order ?? 100;
		if ( oa !== ob ) {
			return oa - ob;
		}
		return a.id.localeCompare( b.id );
	} );
}

export function dismissWindowNotice( id: string ): void {
	const key = String( id ?? '' ).trim().toLowerCase();
	if ( ! key ) {
		return;
	}
	markNoticeDismissed( key );
}

export function undismissWindowNotice( id: string ): void {
	const key = String( id ?? '' ).trim().toLowerCase();
	if ( ! key ) {
		return;
	}
	clearNoticeDismissed( key );
}

export function _resetWindowNoticesForTests(): void {
	for ( const id of Array.from( store.state.entries.keys() ) ) {
		unregisterWindowSlot( slotIdFor( id ) );
	}
	store.state.entries.clear();
}
