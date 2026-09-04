/**
 * Posts app — the Tags cloud's sidebar: the empty state, the draft
 * form for a new tag (name + description in one Create), and the
 * editor for the focused chip (name, slug, description, Save, the
 * two-click Delete).
 *
 * @public
 */

import { __, _n, sprintf } from '@openstation/app';
import {
	armedDeleteButton,
	bindDraftKeys,
	sidebarActions,
	sidebarButton,
	sidebarEmpty,
	sidebarHeader,
	sidebarInput,
	sidebarMeta,
	sidebarSlugInput,
	sidebarTextarea,
} from './canvas/sidebar';
import type { PostsRestClient } from './rest';
import type { TermRow } from './types';

export interface TagInfo {
	id: number;
	name: string;
	slug: string;
	description: string;
	count: number;
	hue: number;
}

export interface CloudSidebarHost {
	sidebar: HTMLElement;
	client: PostsRestClient;
	toast: ( title: string, err: unknown ) => void;
	themeHue: number;
	terms: () => TermRow[];
	setTerms: ( next: TermRow[] ) => void;
	tag: ( id: number ) => TagInfo | undefined;
	focusId: () => number | null;
	setFocus: ( id: number | null ) => void;
	draft: () => boolean;
	setDraft: ( on: boolean ) => void;
	/** A tag was renamed / re-slugged: refresh its chip. */
	applyTagUpdate: ( id: number, patch: { name: string; description: string; slug: string } ) => void;
	/** A tag is gone: drop it from the cloud and its persisted position. */
	forgetTag: ( id: number ) => void;
	buildCloud: () => void;
	clearPosts: () => void;
	loadPosts: () => Promise< void >;
}

function paintDraft( host: CloudSidebarHost ): void {
	const { sidebar, client } = host;
	sidebarHeader( sidebar, `hsl( ${ host.themeHue }deg 60% 55% )`, __( 'New tag' ) );
	const nameInput = sidebarInput( sidebar, __( 'Name' ), '', __( 'e.g. featured' ) );
	requestAnimationFrame( () => nameInput.focus() );
	const descInput = sidebarTextarea( sidebar, '' );
	const createBtn = sidebarButton( 'primary', __( 'Create' ) );
	const cancelBtn = sidebarButton( 'danger', __( 'Cancel' ) );
	const cancel = (): void => {
		host.setDraft( false );
		paintSidebar( host );
	};
	const handleCreate = async (): Promise< void > => {
		const name = nameInput.value.trim();
		if ( ! name ) {
			nameInput.focus();
			return;
		}
		createBtn.disabled = true;
		try {
			const created = await client.createTag( name );
			const next: TermRow = {
				id: created.id,
				name: created.name,
				slug: created.slug || '',
				parent: 0,
				count: 0,
				description: created.description || '',
				isDefault: false,
			};
			if ( ! host.terms().some( ( t ) => t.id === next.id ) ) {
				host.setTerms( host.terms().concat( next ) );
			}
			// `createTag` only takes the name; a description rides a
			// second call so one Create does both.
			const desc = descInput.value.trim();
			if ( desc ) {
				try {
					const updated = await client.updateTerm( 'tags', created.id, { description: desc } );
					host.setTerms(
						host.terms().map( ( t ) => ( t.id === updated.id ? { ...t, description: updated.description || desc } : t ) ),
					);
				} catch ( err ) {
					host.toast( __( 'Tag created but description failed:' ), err );
				}
			}
			host.setDraft( false );
			host.buildCloud();
			host.setFocus( created.id );
			paintSidebar( host );
			await host.loadPosts();
		} catch ( err ) {
			createBtn.disabled = false;
			host.toast( __( 'Couldn’t create:' ), err );
		}
	};
	createBtn.addEventListener( 'click', () => void handleCreate() );
	cancelBtn.addEventListener( 'click', cancel );
	bindDraftKeys( nameInput, () => void handleCreate(), cancel );
	sidebarActions( sidebar, [ createBtn, cancelBtn ] );
}

function paintEditor( host: CloudSidebarHost, box: TagInfo ): void {
	const { sidebar, client } = host;
	const id = box.id;
	sidebarHeader( sidebar, `hsl( ${ box.hue }deg 60% 55% )`, `#${ id }` );
	const term = host.terms().find( ( t ) => t.id === id );
	const nameInput = sidebarInput( sidebar, __( 'Name' ), box.name, __( 'Name' ) );
	const slugInput = sidebarSlugInput( sidebar, term?.slug || '' );
	const descInput = sidebarTextarea( sidebar, box.description || '' );
	sidebarMeta(
		sidebar,
		sprintf(
			/* translators: %d: post count. */
			_n( '%d post tagged with this.', '%d posts tagged with this.', box.count ),
			box.count,
		),
	);

	const saveBtn = sidebarButton( 'primary', __( 'Save' ) );
	saveBtn.addEventListener( 'click', async () => {
		const name = nameInput.value.trim();
		if ( ! name ) {
			return;
		}
		const description = descInput.value;
		const slugRaw = slugInput.value.trim();
		const currentSlug = term?.slug ?? '';
		if ( name === box.name && description === ( box.description || '' ) && slugRaw === currentSlug ) {
			return;
		}
		const patch: { name: string; description: string; slug?: string } = { name, description };
		if ( slugRaw !== currentSlug ) {
			patch.slug = slugRaw;
		}
		try {
			const updated = await client.updateTerm( 'tags', id, patch );
			host.applyTagUpdate( id, { name: updated.name, description: updated.description, slug: updated.slug || box.slug } );
			host.setTerms(
				host.terms().map( ( t ) =>
					t.id === id ? { ...t, name: updated.name, description: updated.description, slug: updated.slug || t.slug } : t,
				),
			);
			paintSidebar( host );
		} catch ( err ) {
			host.toast( __( 'Couldn’t save:' ), err );
		}
	} );

	const delBtn = armedDeleteButton( async () => {
		try {
			await client.deleteTerm( 'tags', id );
			host.setTerms( host.terms().filter( ( t ) => t.id !== id ) );
			host.forgetTag( id );
			host.setFocus( null );
			host.clearPosts();
			host.buildCloud();
			paintSidebar( host );
		} catch ( err ) {
			host.toast( __( 'Couldn’t delete:' ), err );
		}
	} );
	sidebarActions( sidebar, [ saveBtn, delBtn ] );
}

export function paintSidebar( host: CloudSidebarHost ): void {
	host.sidebar.replaceChildren();
	if ( host.draft() ) {
		paintDraft( host );
		return;
	}
	const focusId = host.focusId();
	if ( focusId === null ) {
		sidebarEmpty(
			host.sidebar,
			'dashicons-tag',
			__( 'No tag selected' ),
			__( 'Click a tag on the cloud to edit it, or click + Add tag to create a new one.' ),
		);
		return;
	}
	const box = host.tag( focusId );
	if ( ! box ) {
		host.setFocus( null );
		paintSidebar( host );
		return;
	}
	paintEditor( host, box );
}
