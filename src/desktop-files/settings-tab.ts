/**
 * OpenStation — File Associations OS Settings tab.
 *
 * Phase 5 of the Files-on-the-Desktop system. Renders one row
 * per registered file type with a `<select>` listing every
 * opener that handles that type. Saving writes through the
 * `PUT /associations` REST endpoint and updates the JS-side
 * association map so subsequent `wp.os.files.open()` calls
 * pick up the new choice without a reload.
 */

import { registerSettingsTab } from '../settings/registry';
import { saveAssociations } from './rest';
import {
	getOpenersForType,
	getUserAssociations,
	resolveOpener,
	setUserAssociations,
	subscribeOpeners,
} from './openers';
import { getTypes } from './registry';
// Pre-registered globally by the lazy shell-overlays bundle (Stage 10) — see src/shell-overlays/entry.ts.

const TAB_ID = 'os-file-associations';

let unsubscribe: ( () => void ) | null = null;

/**
 * Register the tab. Called once at bundle boot from
 * `src/desktop-files/index.ts`.
 */
export function registerFileAssociationsTab(): void {
	registerSettingsTab( {
		id: TAB_ID,
		label: 'File Associations',
		order: 50,
		render( body ) {
			if ( unsubscribe ) {
				unsubscribe();
				unsubscribe = null;
			}
			renderTab( body );
			unsubscribe = subscribeOpeners( () => {
				if ( ! body.isConnected ) {
					if ( unsubscribe ) {
						unsubscribe();
						unsubscribe = null;
					}
					return;
				}
				renderTab( body );
			} );
		},
	} );
}

function renderTab( body: HTMLElement ): void {
	body.replaceChildren();

	const types = getTypes();
	if ( types.length === 0 ) {
		const empty = document.createElement( 'p' );
		empty.className = 'os-file-associations__empty';
		empty.textContent = 'No file types are registered.';
		body.appendChild( empty );
		return;
	}

	const intro = document.createElement( 'p' );
	intro.className = 'os-file-associations__intro';
	intro.textContent =
		'Pick which app opens each kind of file when you double-click it on the desktop.';
	body.appendChild( intro );

	const associations = getUserAssociations();
	const list = document.createElement( 'div' );
	list.className = 'os-file-associations__list';
	list.setAttribute( 'role', 'list' );
	for ( const type of types ) {
		list.appendChild( buildRow( type.type, type.label, associations ) );
	}
	body.appendChild( list );
}

function buildRow(
	typeSlug: string,
	typeLabel: string,
	associations: Record< string, string >,
): HTMLElement {
	const row = document.createElement( 'div' );
	row.className = 'os-file-associations__row';
	row.setAttribute( 'role', 'listitem' );
	row.dataset.fileType = typeSlug;

	const label = document.createElement( 'label' );
	label.className = 'os-file-associations__label';
	label.textContent = typeLabel;
	row.appendChild( label );

	const candidates = getOpenersForType( typeSlug );
	if ( candidates.length === 0 ) {
		const empty = document.createElement( 'span' );
		empty.className = 'os-file-associations__none';
		empty.textContent = 'No app available';
		row.appendChild( empty );
		return row;
	}

	const resolved = resolveOpener( typeSlug );
	const currentId = associations[ typeSlug ] ?? resolved?.id ?? '';

	// Use the framework's `<os-select>` so the picker matches the
	// rest of OS Settings. The component wraps a native `<select>`
	// internally — keyboard nav and OS pickers stay correct — and
	// emits `os-pick` with the chosen value.
	const select = document.createElement( 'os-select' ) as HTMLElement & {
		value?: string;
	};
	select.setAttribute( 'value', currentId );
	select.setAttribute( 'aria-label', `Default app for ${ typeLabel }` );
	select.className = 'os-file-associations__select';
	label.htmlFor = `assoc-${ typeSlug }`;
	select.id = `assoc-${ typeSlug }`;

	for ( const o of candidates ) {
		const opt = document.createElement( 'os-option' );
		opt.setAttribute( 'value', o.id );
		opt.textContent = o.isDefault ? `${ o.label } (default)` : o.label;
		select.appendChild( opt );
	}

	select.addEventListener( 'os-pick', ( e: Event ) => {
		const next = ( e as CustomEvent< { value: string } > ).detail?.value;
		if ( ! next ) {
			return;
		}
		const merged = { ...getUserAssociations(), [ typeSlug ]: next };
		// Optimistic update — the open() resolver picks up the change
		// immediately; REST persistence runs in the background.
		setUserAssociations( merged );
		void saveAssociations( merged ).catch( ( err: unknown ) => {
			// eslint-disable-next-line no-console
			console.error( '[openstation] saveAssociations failed:', err );
		} );
	} );

	row.appendChild( select );
	return row;
}
