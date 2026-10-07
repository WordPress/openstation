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

const TAB_ID = 'os-file-associations';

let unsubscribe: ( () => void ) | null = null;

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

		setUserAssociations( merged );
		void saveAssociations( merged ).catch( ( err: unknown ) => {
			console.error( '[openstation] saveAssociations failed:', err );
		} );
	} );

	row.appendChild( select );
	return row;
}
