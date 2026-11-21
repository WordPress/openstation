/**
 * Posts app — quick edit for one page, the Pages window's dialog.
 *
 * Opening reads the page in the edit context and the pages it could
 * hang under; the dialog shows only when both reads succeed. Saving
 * sends `POST wp/v2/pages/<id>` with the fields that differ from that
 * read and nothing else, so Core decides who may edit, publish, or
 * pick a template or a parent, and a plugin's REST hooks for pages
 * run as they would for the editor.
 *
 * @public
 */

import { __, html, sprintf, type TemplateResult } from '@openstation/app';
import '../../../src/ui/components/os-modal/os-modal';
import '../../../src/ui/components/os-notice/os-notice';
import '../../../src/ui/components/os-number-field/os-number-field';
import '../../../src/ui/components/os-select/os-select';
import '../../../src/ui/components/os-switch/os-switch';
import { STATUS_LABELS } from './cells/env';
import type { PostsRestClient } from './rest';
import type { ListExtra, PageEditRecord, PageParentOption, PagePatch, PostListItem } from './types';
import type { Ctx } from './window-context';

/** The fields the dialog edits, under their REST names. */
type QuickEditValues = Required< PagePatch >;

export interface QuickEditState {
	id: number;
	/** What the edit-context read returned; Save sends what differs from it. */
	original: QuickEditValues;
	/** What the dialog holds now. */
	values: QuickEditValues;
	statuses: Array< [ string, string ] >;
	parents: Array< [ number, string ] >;
	templates: Array< [ string, string ] >;
	saving: boolean;
	/** The server's reason for the last refused save. */
	error: string;
}

/** The slice of the window's UI state quick edit owns. */
export interface QuickEditUi {
	quickEdit: QuickEditState | null;
	/** The row whose reads are in flight; the latest click wins. */
	quickEditPending: number;
	disposed: boolean;
}

/** What opening needs from the window. */
export interface QuickEditDoors {
	client: PostsRestClient;
	/** Say a read failed, with the server's reason. */
	toast: ( title: string, err: unknown ) => void;
}

const FIELDS = [ 'title', 'slug', 'status', 'parent', 'menu_order', 'template', 'comment_status' ] as const;

function valuesOf( page: PageEditRecord ): QuickEditValues {
	return {
		title: page.title?.raw ?? '',
		slug: page.slug ?? '',
		status: page.status,
		parent: page.parent ?? 0,
		menu_order: page.menu_order ?? 0,
		template: page.template ?? '',
		comment_status: page.comment_status === 'open' ? 'open' : 'closed',
	};
}

/**
 * The status choices. Published and Private only when Core's edit
 * response says this user may publish (`wp:action-publish`); the
 * page's current status always, so a scheduled page keeps "Scheduled".
 */
function statusOptions( page: PageEditRecord ): Array< [ string, string ] > {
	const canPublish = !! page._links && 'wp:action-publish' in page._links;
	const options: Array< [ string, string ] > = [
		...( canPublish ? [ [ 'publish', __( 'Published' ) ] as [ string, string ] ] : [] ),
		[ 'pending', __( 'Pending Review' ) ],
		[ 'draft', __( 'Draft' ) ],
		...( canPublish ? [ [ 'private', __( 'Private' ) ] as [ string, string ] ] : [] ),
	];
	if ( ! options.some( ( [ value ] ) => value === page.status ) ) {
		options.unshift( [ page.status, STATUS_LABELS[ page.status ] ?? page.status ] );
	}
	return options;
}

/**
 * The parent choices: "No parent", then the tree in page order,
 * indented by depth, without the page itself or anything under it.
 * A page whose parent was not fetched starts a branch of its own; the
 * current parent is offered even when it is not among the options.
 */
function parentOptions( page: PageEditRecord, pages: PageParentOption[] ): Array< [ number, string ] > {
	const known = new Set( pages.map( ( p ) => p.id ) );
	const children = new Map< number, PageParentOption[] >();
	for ( const p of pages ) {
		const parent = known.has( p.parent ) ? p.parent : 0;
		children.set( parent, [ ...( children.get( parent ) ?? [] ), p ] );
	}
	const options: Array< [ number, string ] > = [ [ 0, __( 'No parent' ) ] ];
	const walk = ( parent: number, depth: number ): void => {
		const kids = ( children.get( parent ) ?? [] ).sort(
			( a, b ) => a.menu_order - b.menu_order || a.title.localeCompare( b.title ),
		);
		for ( const p of kids ) {
			// The page and its descendants: a page cannot sit under itself.
			if ( p.id === page.id ) {
				continue;
			}
			options.push( [ p.id, `${ '— '.repeat( depth ) }${ p.title || __( '(no title)' ) }` ] );
			walk( p.id, depth + 1 );
		}
	};
	walk( 0, 0 );
	if ( page.parent && ! options.some( ( [ id ] ) => id === page.parent ) ) {
		options.push( [ page.parent, sprintf( /* translators: %d: parent page ID. */ __( 'Parent page #%d' ), page.parent ) ] );
	}
	return options;
}

/** The theme's page templates, plus the page's own when the theme no longer lists it. */
function templateOptions( page: PageEditRecord, extra: ListExtra ): Array< [ string, string ] > {
	const map = extra.pageTemplates ?? {};
	const options = Object.entries( map );
	if ( options.every( ( [ slug ] ) => slug === '' ) ) {
		return [];
	}
	const current = page.template ?? '';
	if ( ! ( current in map ) ) {
		options.push( [ current, current ] );
	}
	return options;
}

/**
 * Open the dialog on a row: read the page and the parent options, and
 * show the dialog only when both answered. A failed read is a toast.
 */
export async function openQuickEdit( ctx: Ctx, ui: QuickEditUi, doors: QuickEditDoors, row: PostListItem ): Promise< void > {
	ui.quickEditPending = row.id;
	let page: PageEditRecord;
	let pages: PageParentOption[];
	try {
		[ page, pages ] = await Promise.all( [
			doors.client.fetchPageForEdit( row.id ),
			doors.client.fetchPageParentOptions(),
		] );
	} catch ( err ) {
		if ( ui.quickEditPending === row.id ) {
			ui.quickEditPending = 0;
			doors.toast( __( 'Couldn’t open quick edit:' ), err );
		}
		return;
	}
	if ( ui.disposed || ui.quickEditPending !== row.id ) {
		return;
	}
	ui.quickEditPending = 0;
	const original = valuesOf( page );
	ui.quickEdit = {
		id: page.id,
		original,
		values: { ...original },
		statuses: statusOptions( page ),
		parents: parentOptions( page, pages ),
		templates: templateOptions( page, ctx.extra as ListExtra ),
		saving: false,
		error: '',
	};
	ctx.repaint();
}

function close( ctx: Ctx, ui: QuickEditUi ): void {
	// Dropping `open` first hands focus back to the control that opened it.
	ctx.root.querySelector( 'os-modal.os-posts-quick-edit' )?.removeAttribute( 'open' );
	ui.quickEdit = null;
	ctx.repaint();
}

/** The fields that differ from the edit-context read. */
function changes( qe: QuickEditState ): PagePatch {
	const patch: Record< string, unknown > = {};
	for ( const key of FIELDS ) {
		if ( qe.values[ key ] !== qe.original[ key ] ) {
			patch[ key ] = qe.values[ key ];
		}
	}
	return patch as PagePatch;
}

async function save( ctx: Ctx, ui: QuickEditUi, doors: QuickEditDoors, qe: QuickEditState ): Promise< void > {
	if ( qe.saving ) {
		return;
	}
	const patch = changes( qe );
	if ( Object.keys( patch ).length === 0 ) {
		close( ctx, ui );
		return;
	}
	qe.saving = true;
	qe.error = '';
	ctx.repaint();
	try {
		await doors.client.updatePage( qe.id, patch );
	} catch ( err ) {
		qe.saving = false;
		qe.error = err instanceof Error ? err.message : String( err );
		if ( ! ui.disposed ) {
			ctx.repaint();
		}
		return;
	}
	if ( ui.disposed ) {
		return;
	}
	close( ctx, ui );
	ctx.host.announce?.( 'page', 'updated', [ qe.id ] );
	await ctx.dispatch( 'refresh' );
}

/** The dialog, while one is open. */
export function renderQuickEdit( ctx: Ctx, ui: QuickEditUi, doors: QuickEditDoors ): TemplateResult | '' {
	const qe = ui.quickEdit;
	if ( ! qe ) {
		return '';
	}
	const v = qe.values;
	const onCancel = ( e: Event ): void => {
		// A save in flight finishes before the dialog may go.
		if ( qe.saving ) {
			e.preventDefault();
			return;
		}
		close( ctx, ui );
	};
	const text = ( key: 'title' | 'slug' ) => ( e: Event ): void => {
		v[ key ] = String( ( e as CustomEvent< { value: string } > ).detail?.value ?? '' );
	};
	const order = ( e: Event ): void => {
		const n = Number( ( e as CustomEvent< { value: number } > ).detail?.value );
		if ( Number.isFinite( n ) ) {
			v.menu_order = Math.trunc( n );
		}
	};
	const pick = ( key: 'status' | 'template' ) => ( e: Event ): void => {
		v[ key ] = String( ( e as CustomEvent< { value: string } > ).detail?.value ?? '' );
	};
	return html`<os-modal open size="sm" class="os-posts-quick-edit" title=${ __( 'Quick edit' ) } @os-modal-cancel=${ onCancel }>
		<div class="os-posts-quick-edit__fields">
			${ qe.error ? html`<os-notice tone="danger" not-dismissible data-os-pages-quick-edit-error>${ qe.error }</os-notice>` : '' }
			<os-text-field label=${ __( 'Title' ) } value=${ v.title } data-field="title"
				@os-input-change=${ text( 'title' ) }></os-text-field>
			<os-text-field label=${ __( 'Slug' ) } value=${ v.slug } data-field="slug"
				@os-input-change=${ text( 'slug' ) }></os-text-field>
			<os-select label=${ __( 'Status' ) } value=${ v.status } data-field="status" @os-pick=${ pick( 'status' ) }>
				${ qe.statuses.map( ( [ value, label ] ) => html`<os-option value=${ value }>${ label }</os-option>` ) }
			</os-select>
			<os-select label=${ __( 'Parent' ) } value=${ String( v.parent ) } data-field="parent" @os-pick=${ ( e: Event ) => {
				v.parent = Number( ( e as CustomEvent< { value: string } > ).detail?.value ) || 0;
			} }>
				${ qe.parents.map( ( [ id, label ] ) => html`<os-option value=${ String( id ) }>${ label }</os-option>` ) }
			</os-select>
			<os-number-field label=${ __( 'Order' ) } value=${ String( v.menu_order ) } step="1" data-field="menu_order"
				@os-input-change=${ order } @os-input-commit=${ order }></os-number-field>
			${ qe.templates.length ? html`<os-select label=${ __( 'Template' ) } value=${ v.template } data-field="template" @os-pick=${ pick( 'template' ) }>
				${ qe.templates.map( ( [ slug, label ] ) => html`<os-option value=${ slug }>${ label }</os-option>` ) }
			</os-select>` : '' }
			<os-switch label=${ __( 'Allow comments' ) } ?checked=${ v.comment_status === 'open' } data-field="comment_status"
				@os-switch-change=${ ( e: Event ) => {
					v.comment_status = ( e as CustomEvent< { checked: boolean } > ).detail?.checked ? 'open' : 'closed';
				} }></os-switch>
		</div>
		<os-button slot="footer" variant="secondary" ?disabled=${ qe.saving } data-os-pages-quick-edit-cancel
			@click=${ () => ! qe.saving && close( ctx, ui ) }>${ __( 'Cancel' ) }</os-button>
		<os-button slot="footer" variant="primary" ?busy=${ qe.saving } ?disabled=${ qe.saving } data-os-pages-quick-edit-save
			@click=${ () => void save( ctx, ui, doors, qe ) }>${ __( 'Save' ) }</os-button>
	</os-modal>`;
}
