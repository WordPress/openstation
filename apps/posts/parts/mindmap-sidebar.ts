/**
 * Posts app — the Categories mind map's sidebar: the empty state, the
 * draft form for a not-yet-persisted category (nothing hits REST
 * until Create), and the editor for the focused node (name, slug,
 * description, + Child, Make root, Save, the two-click Delete).
 *
 * @public
 */

import { __, _n, sprintf } from '@openstation/app';
import { hexOf } from './canvas/pixi';
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

/** The node facts the sidebar reads and writes back. */
export interface MindNodeInfo {
	id: number;
	parent: number;
	name: string;
	description: string;
	count: number;
	color: number;
}

/** What the sidebar needs from the mind map. */
export interface MindmapSidebarHost {
	sidebar: HTMLElement;
	client: PostsRestClient;
	toast: ( title: string, err: unknown ) => void;
	terms: () => TermRow[];
	setTerms: ( next: TermRow[] ) => void;
	node: ( id: number ) => MindNodeInfo | undefined;
	focusId: () => number | null;
	setFocus: ( id: number | null ) => void;
	draft: () => { parent: number } | null;
	setDraft: ( draft: { parent: number } | null ) => void;
	clusterColor: ( idx: number ) => number;
	buildTree: () => void;
	relayoutNode: ( id: number ) => void;
	clearPosts: () => void;
	loadPosts: () => Promise< void >;
}

function paintDraft( host: MindmapSidebarHost, d: { parent: number } ): void {
	const { sidebar, client } = host;
	const parentNode = d.parent !== 0 ? host.node( d.parent ) : undefined;
	// A draft nested under a node wears the branch's colour, so the
	// header dot matches the family the new term will join.
	const color = parentNode ? parentNode.color : host.clusterColor( host.terms().length );
	sidebarHeader(
		sidebar,
		hexOf( color ),
		parentNode
			? sprintf(
				/* translators: %s: parent category name. */
				__( 'New child of %s' ),
				parentNode.name,
			)
			: __( 'New root category' ),
	);
	const nameInput = sidebarInput( sidebar, __( 'Name' ), '', __( 'e.g. Recipes' ) );
	// Create is gated on a name — drop the cursor straight in.
	requestAnimationFrame( () => nameInput.focus() );
	const slugInput = sidebarSlugInput( sidebar, '' );
	const descInput = sidebarTextarea( sidebar, '' );

	const createBtn = sidebarButton( 'primary', __( 'Create' ) );
	// The danger style keeps the dual-action row symmetric with the
	// editor's Save / Delete pair.
	const cancelBtn = sidebarButton( 'danger', __( 'Cancel' ) );
	const cancel = (): void => {
		host.setDraft( null );
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
			const created = await client.createCategory( name, d.parent, {
				slug: slugInput.value.trim() || undefined,
				description: descInput.value || undefined,
			} );
			const next: TermRow = {
				id: created.id,
				name: created.name,
				slug: created.slug || '',
				parent: created.parent,
				count: 0,
				description: created.description || '',
				isDefault: false,
			};
			// `createCategory` returns the existing match on term_exists —
			// never a duplicate row.
			if ( ! host.terms().some( ( t ) => t.id === next.id ) ) {
				host.setTerms( host.terms().concat( next ) );
			}
			host.setDraft( null );
			host.buildTree();
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

function paintEditor( host: MindmapSidebarHost, node: MindNodeInfo ): void {
	const { sidebar, client } = host;
	const id = node.id;
	sidebarHeader( sidebar, hexOf( node.color ), `#${ id }` );
	const term = host.terms().find( ( t ) => t.id === id );
	const nameInput = sidebarInput( sidebar, __( 'Name' ), node.name, __( 'Name' ) );
	const slugInput = sidebarSlugInput( sidebar, term?.slug || '' );
	const descInput = sidebarTextarea( sidebar, node.description || '' );
	sidebarMeta(
		sidebar,
		sprintf(
			/* translators: %d: post count. */
			_n( '%d post in this category.', '%d posts in this category.', node.count ),
			node.count,
		),
	);

	const addChildBtn = sidebarButton( 'secondary', __( '+ Child' ) );
	addChildBtn.addEventListener( 'click', () => {
		host.setDraft( { parent: id } );
		paintSidebar( host );
	} );

	// Make root: drag-and-drop reparents within the tree, but there is
	// no drop target for "no parent" — this is the only path to promote
	// a deep child into a top-level cluster.
	const makeRootBtn = node.parent && node.parent !== 0 ? sidebarButton( 'secondary', __( 'Make root' ) ) : null;
	if ( makeRootBtn ) {
		makeRootBtn.title = __( 'Promote this category to a top-level root (no parent).' );
		makeRootBtn.addEventListener( 'click', async () => {
			try {
				await client.updateTerm( 'categories', id, { parent: 0 } );
				const live = host.node( id );
				if ( live ) {
					live.parent = 0;
				}
				host.setTerms( host.terms().map( ( t ) => ( t.id === id ? { ...t, parent: 0 } : t ) ) );
				host.buildTree();
				paintSidebar( host );
			} catch ( err ) {
				host.toast( __( 'Couldn’t reparent:' ), err );
			}
		} );
	}

	const saveBtn = sidebarButton( 'primary', __( 'Save' ) );
	saveBtn.addEventListener( 'click', async () => {
		const name = nameInput.value.trim();
		if ( ! name ) {
			return;
		}
		const description = descInput.value;
		const slugRaw = slugInput.value.trim();
		const currentSlug = term?.slug ?? '';
		if ( name === node.name && description === ( node.description || '' ) && slugRaw === currentSlug ) {
			return;
		}
		// An empty slug is sent explicitly so WP regenerates it from
		// the name instead of holding the old one.
		const patch: { name: string; description: string; slug?: string } = { name, description };
		if ( slugRaw !== currentSlug ) {
			patch.slug = slugRaw;
		}
		try {
			const updated = await client.updateTerm( 'categories', id, patch );
			const live = host.node( id );
			if ( live ) {
				live.name = updated.name;
				live.description = updated.description;
			}
			host.setTerms(
				host.terms().map( ( t ) =>
					t.id === id ? { ...t, name: updated.name, description: updated.description, slug: updated.slug || t.slug } : t,
				),
			);
			host.relayoutNode( id );
			paintSidebar( host );
		} catch ( err ) {
			host.toast( __( 'Couldn’t save:' ), err );
		}
	} );

	const delBtn = armedDeleteButton( async () => {
		try {
			await client.deleteTerm( 'categories', id );
			host.setTerms( host.terms().filter( ( t ) => t.id !== id ) );
			host.setFocus( null );
			host.clearPosts();
			host.buildTree();
			paintSidebar( host );
		} catch ( err ) {
			host.toast( __( 'Couldn’t delete:' ), err );
		}
	} );

	sidebarActions( sidebar, makeRootBtn ? [ addChildBtn, makeRootBtn, saveBtn, delBtn ] : [ addChildBtn, saveBtn, delBtn ] );
}

/**
 * The sidebar always shows one of three states: the draft form, the
 * editor for the focused node, or the empty hint.
 */
export function paintSidebar( host: MindmapSidebarHost ): void {
	host.sidebar.replaceChildren();
	const draft = host.draft();
	if ( draft !== null ) {
		paintDraft( host, draft );
		return;
	}
	const focusId = host.focusId();
	if ( focusId === null ) {
		sidebarEmpty(
			host.sidebar,
			'dashicons-admin-tools',
			__( 'No category selected' ),
			__( 'Click a node on the mindmap to edit its name, description, and posts.' ),
		);
		return;
	}
	const node = host.node( focusId );
	if ( ! node ) {
		host.setFocus( null );
		paintSidebar( host );
		return;
	}
	paintEditor( host, node );
}
