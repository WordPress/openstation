/**
 * My WordPress — WordPress's own bulk actions, on a selection.
 *
 * The list tables in wp-admin have had a bulk-actions dropdown since
 * 2.7: pick rows, pick an action, Apply. This module is that set,
 * re-expressed as multi-safe entries on the selection context menu —
 * so what you can do to twelve posts here is what you can do to
 * twelve posts there.
 *
 * | wp-admin                          | here                          |
 * |-----------------------------------|-------------------------------|
 * | Posts → Bulk actions → Edit       | **Edit…** (the same modal)    |
 * | Posts → Bulk actions → Move to Trash | **Move to Trash**          |
 * | Post row action → Publish / Draft | **Publish** / **Switch to Draft** |
 * | Media row action → Detach         | **Detach**                    |
 * | Media → Bulk actions → Delete     | **Delete permanently**        |
 * | Users → Bulk actions → Change role to… | **Change role…**         |
 * | Users → Bulk actions → Delete     | **Delete users…**             |
 *
 * Two things core does that we deliberately match:
 *
 *   - **Bulk edit only writes what you changed.** Every control
 *     starts on "— No change —", and a field left alone is absent
 *     from the request. This is why bulk edit can't be built out of
 *     "read the first item, show its values, save them to all" — that
 *     would silently overwrite eleven posts with the twelfth's data.
 *   - **Categories and tags are additive.** Core adds the terms you
 *     pick to whatever each post already has; it never replaces the
 *     set. The REST API only accepts the full array, so we read each
 *     post's current terms first and merge.
 *
 * Statuses that no longer appear in the list (trashed entries) have
 * no Restore / Delete-permanently entries here, because the section's
 * own query never surfaces them — an action nobody can reach is worse
 * than an action that isn't there.
 */

import { __, sprintf } from '../i18n';
import { showToast } from '../toast';
import type { SelectionAction } from '../selection';
import {
	createTag,
	deleteUser,
	fetchAuthors,
	fetchEntityBulkFields,
	fetchTaxonomyTerms,
	updateEntity,
	updateUser,
	type EntityBulkFields,
	type TermOption,
} from './rest';
import { updateMediaItem } from './media-rest';
import type {
	EntityListItem,
	MediaListItem,
	MyWordPressEntity,
	UserListItem,
} from './types';
import '../ui/components/os-modal/os-modal';
import '../ui/components/os-select/os-select';
import '../ui/components/os-button/os-button';
import '../ui/components/os-category-picker/os-category-picker';
import '../ui/components/os-tag-input/os-tag-input';
import '../ui/components/os-notice/os-notice';
import '../ui/components/os-role-picker/os-role-picker';
import '../ui/components/os-spinner/os-spinner';
import type { OsTagItem } from '../ui/components/os-tag-input/os-tag-input';

/** Sentinel for every "— No change —" control in the bulk-edit modal. */
const NO_CHANGE = '';

/**
 * Statuses a bulk edit may set. Mirrors core's dropdown, minus the
 * ones it also hides (`trash` is reached by the Trash action, `auto-
 * draft` and `inherit` are internal).
 */
const STATUS_OPTIONS: Array< { value: string; label: string } > = [
	{ value: 'publish', label: __( 'Published', 'desktop-mode' ) },
	{ value: 'pending', label: __( 'Pending Review', 'desktop-mode' ) },
	{ value: 'draft', label: __( 'Draft', 'desktop-mode' ) },
	{ value: 'private', label: __( 'Private', 'desktop-mode' ) },
];

/* ------------------------------------------------------------------ *
 *  Shared plumbing — run one write per item, report once.
 * ------------------------------------------------------------------ */

export interface BulkRunResult {
	succeeded: number[];
	failed: number;
	firstError: string;
}

/**
 * Apply `run` to every id, in parallel, and collect the outcome.
 *
 * Partial failure is the normal case, not the exception: a
 * contributor's selection can span posts they may edit and posts
 * they may not, and the REST API answers per row. Reporting "12
 * updated" when 3 were rejected is the kind of lie the user finds
 * out about later, from the list.
 */
export async function runBulk(
	ids: readonly number[],
	run: ( id: number ) => Promise< void >,
): Promise< BulkRunResult > {
	const results = await Promise.allSettled( ids.map( ( id ) => run( id ) ) );
	const succeeded: number[] = [];
	let failed = 0;
	let firstError = '';
	results.forEach( ( result, index ) => {
		if ( result.status === 'fulfilled' ) {
			succeeded.push( ids[ index ] );
			return;
		}
		failed += 1;
		if ( ! firstError ) {
			firstError =
				result.reason instanceof Error
					? result.reason.message
					: String( result.reason );
		}
	} );
	return { succeeded, failed, firstError };
}

/** One toast for the whole run, naming the failures when there are any. */
export function reportBulk(
	result: BulkRunResult,
	singular: string,
	plural: string,
): void {
	const n = result.succeeded.length;
	if ( n === 0 ) {
		showToast( {
			message:
				result.firstError ||
				__( 'Nothing could be updated.', 'desktop-mode' ),
			duration: 6000,
		} );
		return;
	}
	const done = sprintf( n === 1 ? singular : plural, n );
	showToast( {
		message:
			result.failed > 0
				? sprintf(
					/* translators: 1: what succeeded, e.g. "3 items updated". 2: number that failed. */
					__( '%1$s · %2$d failed', 'desktop-mode' ),
					done,
					result.failed,
				)
				: done,
		duration: result.failed > 0 ? 6000 : 4000,
	} );
}

/* ------------------------------------------------------------------ *
 *  Bulk edit — the modal.
 * ------------------------------------------------------------------ */

interface BulkEditPatch {
	status?: string;
	author?: number;
	comment_status?: string;
	sticky?: boolean;
	/** Term ids to ADD (core's semantics), merged per item. */
	addCategories?: number[];
	/** Term ids to ADD. */
	addTags?: number[];
}

function labelled( label: string, control: HTMLElement ): HTMLElement {
	const row = document.createElement( 'div' );
	row.className = 'os-my-wordpress__bulk-row';
	const caption = document.createElement( 'div' );
	caption.className = 'os-my-wordpress__bulk-label';
	caption.textContent = label;
	row.append( caption, control );
	return row;
}

function select(
	options: Array< { value: string; label: string } >,
): HTMLElement {
	const el = document.createElement( 'os-select' );
	el.setAttribute( 'value', NO_CHANGE );
	const noChange = document.createElement( 'os-option' );
	noChange.setAttribute( 'value', NO_CHANGE );
	noChange.textContent = __( '— No change —', 'desktop-mode' );
	el.appendChild( noChange );
	for ( const option of options ) {
		const opt = document.createElement( 'os-option' );
		opt.setAttribute( 'value', option.value );
		opt.textContent = option.label;
		el.appendChild( opt );
	}
	return el;
}

function readSelect( el: HTMLElement ): string {
	return el.getAttribute( 'value' ) ?? NO_CHANGE;
}

/**
 * Open the bulk-edit modal. Resolves with the patch the user asked
 * for, or `null` if they cancelled.
 *
 * The modal shape follows core's inline bulk-edit panel: the controls
 * that apply to this post type, each defaulting to "no change", and a
 * count of what's about to be touched.
 */
function openBulkEditModal( opts: {
	count: number;
	entityLabel: string;
	authors: Array< { id: number; name: string } >;
	categories: TermOption[] | null;
	supportsTags: boolean;
	supportsSticky: boolean;
} ): Promise< BulkEditPatch | null > {
	return new Promise( ( resolve ) => {
		const modal = document.createElement( 'os-modal' );
		modal.setAttribute( 'open', '' );
		modal.setAttribute( 'size', 'md' );
		modal.setAttribute(
			'title',
			sprintf(
				/* translators: 1: number of entries, 2: entity label, e.g. "Posts". */
				__( 'Edit %1$d %2$s', 'desktop-mode' ),
				opts.count,
				opts.entityLabel,
			),
		);
		document.body.appendChild( modal );

		let settled = false;
		const finish = ( value: BulkEditPatch | null ): void => {
			if ( settled ) {
				return;
			}
			settled = true;
			modal.remove();
			resolve( value );
		};

		const hint = document.createElement( 'os-notice' );
		hint.setAttribute( 'tone', 'info' );
		hint.textContent = __(
			'Only the fields you change are applied. Categories and tags are added to what each entry already has.',
			'desktop-mode',
		);
		modal.appendChild( hint );

		const statusEl = select( STATUS_OPTIONS );
		modal.appendChild(
			labelled( __( 'Status', 'desktop-mode' ), statusEl ),
		);

		const authorEl = select(
			opts.authors.map( ( a ) => ( {
				value: String( a.id ),
				label: a.name,
			} ) ),
		);
		if ( opts.authors.length > 0 ) {
			modal.appendChild(
				labelled( __( 'Author', 'desktop-mode' ), authorEl ),
			);
		}

		const commentsEl = select( [
			{ value: 'open', label: __( 'Allow', 'desktop-mode' ) },
			{ value: 'closed', label: __( 'Do not allow', 'desktop-mode' ) },
		] );
		modal.appendChild(
			labelled( __( 'Comments', 'desktop-mode' ), commentsEl ),
		);

		const stickyEl = select( [
			{ value: 'sticky', label: __( 'Sticky', 'desktop-mode' ) },
			{ value: 'not-sticky', label: __( 'Not sticky', 'desktop-mode' ) },
		] );
		if ( opts.supportsSticky ) {
			modal.appendChild(
				labelled( __( 'Sticky', 'desktop-mode' ), stickyEl ),
			);
		}

		const categoryEl = document.createElement( 'os-category-picker' ) as
			HTMLElement & { items: TermOption[]; value: number[] };
		if ( opts.categories && opts.categories.length > 0 ) {
			categoryEl.items = opts.categories;
			categoryEl.value = [];
			modal.appendChild(
				labelled(
					__( 'Add categories', 'desktop-mode' ),
					categoryEl,
				),
			);
		}

		const tagEl = document.createElement( 'os-tag-input' ) as HTMLElement & {
			value: OsTagItem[];
			suggestions: OsTagItem[];
		};
		if ( opts.supportsTags ) {
			tagEl.setAttribute( 'creatable', '' );
			tagEl.setAttribute(
				'placeholder',
				__( 'Add tags…', 'desktop-mode' ),
			);
			tagEl.value = [];
			tagEl.addEventListener( 'os-tag-suggest', ( e: Event ) => {
				const query = ( e as CustomEvent< { query: string } > ).detail
					.query;
				void fetchTaxonomyTerms( 'tags', query ).then( ( terms ) => {
					tagEl.suggestions = terms.map( ( t ) => ( {
						id: t.id,
						label: t.name,
					} ) );
				} );
			} );
			// A brand-new tag has no id until the server mints one; do
			// it at pick time so the submit path only ever deals in ids.
			tagEl.addEventListener( 'os-tag-add', ( e: Event ) => {
				const detail = ( e as CustomEvent< {
					tag: OsTagItem;
					isNew: boolean;
				} > ).detail;
				if ( ! detail.isNew ) {
					return;
				}
				void createTag( detail.tag.label ).then( ( created ) => {
					if ( ! created ) {
						return;
					}
					tagEl.value = tagEl.value.map( ( t ) =>
						t.label === detail.tag.label && t.id === undefined
							? { id: created.id, label: created.name }
							: t,
					);
				} );
			} );
			modal.appendChild(
				labelled( __( 'Add tags', 'desktop-mode' ), tagEl ),
			);
		}

		const footer = document.createElement( 'div' );
		footer.setAttribute( 'slot', 'footer' );

		const cancel = document.createElement( 'os-button' );
		cancel.setAttribute( 'variant', 'ghost' );
		cancel.textContent = __( 'Cancel', 'desktop-mode' );
		cancel.addEventListener( 'click', () => finish( null ) );

		const apply = document.createElement( 'os-button' );
		apply.setAttribute( 'variant', 'primary' );
		apply.textContent = __( 'Update', 'desktop-mode' );
		apply.addEventListener( 'click', () => {
			const patch: BulkEditPatch = {};
			const status = readSelect( statusEl );
			if ( status !== NO_CHANGE ) {
				patch.status = status;
			}
			const author = readSelect( authorEl );
			if ( author !== NO_CHANGE ) {
				patch.author = Number( author );
			}
			const comments = readSelect( commentsEl );
			if ( comments !== NO_CHANGE ) {
				patch.comment_status = comments;
			}
			const sticky = readSelect( stickyEl );
			if ( opts.supportsSticky && sticky !== NO_CHANGE ) {
				patch.sticky = sticky === 'sticky';
			}
			const cats = opts.categories ? categoryEl.value : [];
			if ( cats.length > 0 ) {
				patch.addCategories = cats.slice();
			}
			const tags = opts.supportsTags
				? tagEl.value
					.map( ( t ) => Number( t.id ) )
					.filter( ( id ) => Number.isFinite( id ) && id > 0 )
				: [];
			if ( tags.length > 0 ) {
				patch.addTags = tags;
			}
			finish( Object.keys( patch ).length > 0 ? patch : null );
		} );

		footer.append( cancel, apply );
		modal.appendChild( footer );

		modal.addEventListener( 'os-modal-cancel', () => finish( null ) );
	} );
}

/**
 * The "Edit…" bulk action for post-shaped entities.
 *
 * Reads the current taxonomy state for the selection first — which is
 * both what makes the additive merge correct and how we discover
 * whether this post type has categories or tags at all.
 */
export async function bulkEditEntities(
	entity: MyWordPressEntity,
	items: readonly EntityListItem[],
): Promise< number[] > {
	const ids = items.map( ( i ) => i.id );

	let current: EntityBulkFields[] = [];
	let authors: Array< { id: number; name: string } > = [];
	try {
		[ current, authors ] = await Promise.all( [
			fetchEntityBulkFields( entity, ids ),
			fetchAuthors(),
		] );
	} catch ( err ) {
		showToast( {
			message:
				err instanceof Error
					? err.message
					: __( 'Could not read the selected entries.', 'desktop-mode' ),
			duration: 6000,
		} );
		return [];
	}

	const supportsCategories = current.some( ( row ) =>
		Array.isArray( row.categories ),
	);
	const supportsTags = current.some( ( row ) => Array.isArray( row.tags ) );
	const categories = supportsCategories
		? await fetchTaxonomyTerms( 'categories' )
		: null;

	const patch = await openBulkEditModal( {
		count: items.length,
		entityLabel: entity.label,
		authors,
		categories,
		supportsTags,
		// Only the built-in `post` type has sticky posts — core hides
		// the control everywhere else, and the REST schema rejects the
		// field outright.
		supportsSticky: ( entity.post_type ?? 'post' ) === 'post',
	} );
	if ( ! patch ) {
		return [];
	}

	const byId = new Map( current.map( ( row ) => [ row.id, row ] ) );
	const result = await runBulk( ids, async ( id ) => {
		const body: Record< string, unknown > = {};
		if ( patch.status !== undefined ) {
			body.status = patch.status;
		}
		if ( patch.author !== undefined ) {
			body.author = patch.author;
		}
		if ( patch.comment_status !== undefined ) {
			body.comment_status = patch.comment_status;
		}
		if ( patch.sticky !== undefined ) {
			body.sticky = patch.sticky;
		}
		if ( patch.addCategories ) {
			const existing = byId.get( id )?.categories ?? [];
			body.categories = Array.from(
				new Set( [ ...existing, ...patch.addCategories ] ),
			);
		}
		if ( patch.addTags ) {
			const existing = byId.get( id )?.tags ?? [];
			body.tags = Array.from( new Set( [ ...existing, ...patch.addTags ] ) );
		}
		await updateEntity( entity, id, body );
	} );

	reportBulk(
		result,
		/* translators: %d: number of entries updated. */
		__( '%d entry updated', 'desktop-mode' ),
		/* translators: %d: number of entries updated. */
		__( '%d entries updated', 'desktop-mode' ),
	);
	return result.succeeded;
}

/** Set the same status on every selected entry (Publish / Draft). */
export async function bulkSetStatus(
	entity: MyWordPressEntity,
	items: readonly EntityListItem[],
	status: string,
): Promise< number[] > {
	const result = await runBulk( items.map( ( i ) => i.id ), ( id ) =>
		updateEntity( entity, id, { status } ),
	);
	reportBulk(
		result,
		/* translators: %d: number of entries updated. */
		__( '%d entry updated', 'desktop-mode' ),
		/* translators: %d: number of entries updated. */
		__( '%d entries updated', 'desktop-mode' ),
	);
	return result.succeeded;
}

/* ------------------------------------------------------------------ *
 *  Post-shaped bulk actions.
 * ------------------------------------------------------------------ */

export interface EntityBulkContext {
	entity: MyWordPressEntity;
	/** Called with the ids that changed so the caller can repaint. */
	onChanged: ( ids: number[] ) => void;
}

/**
 * The status-changing entries core exposes as row actions, plus the
 * bulk-edit modal it exposes as a bulk action.
 *
 * `item` is the ONE entry these are built for —
 * `resolveCommonActions` calls this per selected tile and intersects
 * — so each `onClick` closes over its own entry and each `bulk` takes
 * the whole set.
 */
export function entityBulkActions(
	ctx: EntityBulkContext,
	item: EntityListItem,
): SelectionAction< EntityListItem >[] {
	const { entity, onChanged } = ctx;
	const one = [ item ];

	const actions: SelectionAction< EntityListItem >[] = [
		{
			id: 'bulk-edit',
			label: __( 'Edit…', 'desktop-mode' ),
			icon: 'dashicons-edit-large',
			sort: 30,
			multi: true,
			bulkLabel: ( n ) =>
				sprintf(
					/* translators: %d: number of selected entries. */
					__( 'Edit %d entries…', 'desktop-mode' ),
					n,
				),
			bulk: async ( items ) =>
				onChanged( await bulkEditEntities( entity, items ) ),
			onClick: async () =>
				onChanged( await bulkEditEntities( entity, one ) ),
		},
	];

	// Publish / Switch to Draft mirror core's row actions, and each
	// hides itself when it would be a no-op for the entry it's built
	// for — so a selection of published posts offers Draft but not
	// Publish, exactly as the intersection rule implies.
	if ( item.status !== 'publish' ) {
		actions.push( {
			id: 'publish',
			label: __( 'Publish', 'desktop-mode' ),
			icon: 'dashicons-yes',
			sort: 40,
			multi: true,
			bulkLabel: ( n ) =>
				sprintf(
					/* translators: %d: number of selected entries. */
					__( 'Publish %d entries', 'desktop-mode' ),
					n,
				),
			bulk: async ( items ) =>
				onChanged( await bulkSetStatus( entity, items, 'publish' ) ),
			onClick: async () =>
				onChanged( await bulkSetStatus( entity, one, 'publish' ) ),
		} );
	}
	if ( item.status !== 'draft' ) {
		actions.push( {
			id: 'to-draft',
			label: __( 'Switch to Draft', 'desktop-mode' ),
			icon: 'dashicons-edit-page',
			sort: 45,
			multi: true,
			bulkLabel: ( n ) =>
				sprintf(
					/* translators: %d: number of selected entries. */
					__( 'Switch %d entries to Draft', 'desktop-mode' ),
					n,
				),
			bulk: async ( items ) =>
				onChanged( await bulkSetStatus( entity, items, 'draft' ) ),
			onClick: async () =>
				onChanged( await bulkSetStatus( entity, one, 'draft' ) ),
		} );
	}

	return actions;
}

/* ------------------------------------------------------------------ *
 *  Media.
 * ------------------------------------------------------------------ */

export interface MediaBulkContext {
	onChanged: ( ids: number[] ) => void;
}

/**
 * Core's media row actions that make sense over a set. "Detach" is
 * the same operation the media list table offers per row — clear the
 * attachment's parent post, leaving the file itself alone.
 */
export function mediaBulkActions(
	ctx: MediaBulkContext,
	media: MediaListItem,
): SelectionAction< MediaListItem >[] {
	const detach = async ( items: readonly MediaListItem[] ): Promise< void > => {
		const result = await runBulk( items.map( ( m ) => m.id ), ( id ) =>
			updateMediaItem( id, { post: 0 } ),
		);
		reportBulk(
			result,
			/* translators: %d: number of files detached. */
			__( '%d file detached', 'desktop-mode' ),
			/* translators: %d: number of files detached. */
			__( '%d files detached', 'desktop-mode' ),
		);
		ctx.onChanged( result.succeeded );
	};

	const actions: SelectionAction< MediaListItem >[] = [];
	// Only offer Detach for files that are actually attached to
	// something — on an unattached file the action would be a no-op,
	// and it disappears from a mixed selection for the same reason.
	if ( Number( media.post ?? 0 ) > 0 ) {
		actions.push( {
			id: 'detach',
			label: __( 'Detach', 'desktop-mode' ),
			icon: 'dashicons-editor-unlink',
			sort: 30,
			multi: true,
			bulkLabel: ( n ) =>
				sprintf(
					/* translators: %d: number of selected files. */
					__( 'Detach %d files', 'desktop-mode' ),
					n,
				),
			bulk: ( items ) => detach( items ),
			onClick: () => detach( [ media ] ),
		} );
	}
	return actions;
}

/* ------------------------------------------------------------------ *
 *  Users.
 * ------------------------------------------------------------------ */

/** Role slug → label, from the roles the shell already ships. */
function eligibleRoles(): Array< { slug: string; label: string } > {
	const cfg = (
		window as unknown as {
			openStationConfig?: {
				shareEligibleRoles?: Array< { slug: string; name?: string; label?: string } >;
			};
		}
	).openStationConfig;
	const rows = cfg?.shareEligibleRoles ?? [];
	return rows.map( ( r ) => ( {
		slug: r.slug,
		label: r.label ?? r.name ?? r.slug,
	} ) );
}

/** Ask which role to set, then set it on every selected user. */
async function promptRole(): Promise< string | null > {
	const roles = eligibleRoles();
	if ( roles.length === 0 ) {
		showToast( {
			message: __(
				'No assignable roles are available on this site.',
				'desktop-mode',
			),
		} );
		return null;
	}
	return new Promise( ( resolve ) => {
		const modal = document.createElement( 'os-modal' );
		modal.setAttribute( 'open', '' );
		modal.setAttribute( 'size', 'sm' );
		modal.setAttribute( 'title', __( 'Change role', 'desktop-mode' ) );
		document.body.appendChild( modal );

		let settled = false;
		const finish = ( value: string | null ): void => {
			if ( settled ) {
				return;
			}
			settled = true;
			modal.remove();
			resolve( value );
		};

		const picker = select(
			roles.map( ( r ) => ( { value: r.slug, label: r.label } ) ),
		);
		modal.appendChild(
			labelled( __( 'New role', 'desktop-mode' ), picker ),
		);

		const footer = document.createElement( 'div' );
		footer.setAttribute( 'slot', 'footer' );
		const cancel = document.createElement( 'os-button' );
		cancel.setAttribute( 'variant', 'ghost' );
		cancel.textContent = __( 'Cancel', 'desktop-mode' );
		cancel.addEventListener( 'click', () => finish( null ) );
		const apply = document.createElement( 'os-button' );
		apply.setAttribute( 'variant', 'primary' );
		apply.textContent = __( 'Change role', 'desktop-mode' );
		apply.addEventListener( 'click', () => {
			const value = readSelect( picker );
			finish( value === NO_CHANGE ? null : value );
		} );
		footer.append( cancel, apply );
		modal.appendChild( footer );
		modal.addEventListener( 'os-modal-cancel', () => finish( null ) );
	} );
}

/**
 * Core's user-delete screen asks one question before it will proceed:
 * what happens to the content these users wrote. Delete it with them,
 * or attribute it to somebody else. The REST endpoint asks the same
 * thing (`reassign`), and refuses without an answer.
 */
async function promptReassign(
	count: number,
	authors: Array< { id: number; name: string } >,
	excludeIds: readonly number[],
): Promise< { confirmed: boolean; reassign: number | null } > {
	const candidates = authors.filter( ( a ) => ! excludeIds.includes( a.id ) );
	return new Promise( ( resolve ) => {
		const modal = document.createElement( 'os-modal' );
		modal.setAttribute( 'open', '' );
		modal.setAttribute( 'size', 'md' );
		modal.setAttribute(
			'title',
			sprintf(
				/* translators: %d: number of users about to be deleted. */
				__( 'Delete %d users', 'desktop-mode' ),
				count,
			),
		);
		document.body.appendChild( modal );

		let settled = false;
		const finish = ( confirmed: boolean, reassign: number | null ): void => {
			if ( settled ) {
				return;
			}
			settled = true;
			modal.remove();
			resolve( { confirmed, reassign } );
		};

		const warning = document.createElement( 'os-notice' );
		warning.setAttribute( 'tone', 'danger' );
		warning.textContent = __(
			'Users have no trash — this cannot be undone.',
			'desktop-mode',
		);
		modal.appendChild( warning );

		const picker = select( [
			{
				value: 'delete',
				label: __( 'Delete all their content', 'desktop-mode' ),
			},
			...candidates.map( ( a ) => ( {
				value: String( a.id ),
				label: sprintf(
					/* translators: %s: a user's display name. */
					__( 'Attribute all content to %s', 'desktop-mode' ),
					a.name,
				),
			} ) ),
		] );
		modal.appendChild(
			labelled( __( 'Their content', 'desktop-mode' ), picker ),
		);

		const footer = document.createElement( 'div' );
		footer.setAttribute( 'slot', 'footer' );
		const cancel = document.createElement( 'os-button' );
		cancel.setAttribute( 'variant', 'ghost' );
		cancel.textContent = __( 'Cancel', 'desktop-mode' );
		cancel.addEventListener( 'click', () => finish( false, null ) );
		const apply = document.createElement( 'os-button' );
		apply.setAttribute( 'variant', 'danger' );
		apply.textContent = __( 'Delete', 'desktop-mode' );
		apply.addEventListener( 'click', () => {
			const value = readSelect( picker );
			if ( value === NO_CHANGE ) {
				// Nothing chosen — the question is mandatory, so treat
				// Delete-without-an-answer as "not yet".
				return;
			}
			finish( true, value === 'delete' ? null : Number( value ) );
		} );
		footer.append( cancel, apply );
		modal.appendChild( footer );
		modal.addEventListener( 'os-modal-cancel', () => finish( false, null ) );
	} );
}

export interface UserBulkContext {
	onChanged: ( ids: number[] ) => void;
	/** Ids removed from the list entirely (deleted users). */
	onRemoved: ( ids: number[] ) => void;
}

export function userBulkActions(
	ctx: UserBulkContext,
	user: UserListItem,
): SelectionAction< UserListItem >[] {
	const changeRole = async (
		items: readonly UserListItem[],
	): Promise< void > => {
		const role = await promptRole();
		if ( ! role ) {
			return;
		}
		const result = await runBulk( items.map( ( u ) => u.id ), ( id ) =>
			updateUser( id, { roles: [ role ] } ),
		);
		reportBulk(
			result,
			/* translators: %d: number of users updated. */
			__( '%d user updated', 'desktop-mode' ),
			/* translators: %d: number of users updated. */
			__( '%d users updated', 'desktop-mode' ),
		);
		ctx.onChanged( result.succeeded );
	};

	const remove = async ( items: readonly UserListItem[] ): Promise< void > => {
		const ids = items.map( ( u ) => u.id );
		const authors = await fetchAuthors();
		const { confirmed, reassign } = await promptReassign(
			items.length,
			authors,
			ids,
		);
		if ( ! confirmed ) {
			return;
		}
		const result = await runBulk( ids, ( id ) => deleteUser( id, reassign ) );
		reportBulk(
			result,
			/* translators: %d: number of users deleted. */
			__( '%d user deleted', 'desktop-mode' ),
			/* translators: %d: number of users deleted. */
			__( '%d users deleted', 'desktop-mode' ),
		);
		ctx.onRemoved( result.succeeded );
	};

	return [
		{
			id: 'change-role',
			label: __( 'Change role…', 'desktop-mode' ),
			icon: 'dashicons-groups',
			sort: 40,
			multi: true,
			bulkLabel: ( n ) =>
				sprintf(
					/* translators: %d: number of selected users. */
					__( 'Change role for %d users…', 'desktop-mode' ),
					n,
				),
			bulk: ( items ) => changeRole( items ),
			onClick: () => changeRole( [ user ] ),
		},
		{
			id: 'delete-user',
			label: __( 'Delete…', 'desktop-mode' ),
			icon: 'dashicons-trash',
			sort: 90,
			danger: true,
			multi: true,
			bulkLabel: ( n ) =>
				sprintf(
					/* translators: %d: number of selected users. */
					__( 'Delete %d users…', 'desktop-mode' ),
					n,
				),
			bulk: ( items ) => remove( items ),
			onClick: () => remove( [ user ] ),
		},
	];
}

/* ------------------------------------------------------------------ *
 *  Shared: "Copy links".
 * ------------------------------------------------------------------ */

/**
 * Put the URLs of a selection on the clipboard, one per line.
 *
 * Not a wp-admin bulk action, but the thing people leave wp-admin to
 * do by hand: select the posts, copy their URLs, paste them into a
 * newsletter. `urlOf` is per-surface because "the URL" isn't the same
 * field everywhere — posts and users have a `link`, an attachment's
 * useful address is its `source_url`.
 */
export async function copyLinks< T >(
	items: readonly T[],
	urlOf: ( item: T ) => string,
): Promise< void > {
	const links = items
		.map( ( i ) => String( urlOf( i ) ?? '' ).trim() )
		.filter( Boolean );
	if ( links.length === 0 ) {
		showToast( {
			message: __( 'Nothing to copy — no links found.', 'desktop-mode' ),
		} );
		return;
	}
	try {
		await navigator.clipboard.writeText( links.join( '\n' ) );
		showToast( {
			message:
				links.length === 1
					? __( 'Link copied.', 'desktop-mode' )
					: sprintf(
						/* translators: %d: number of links copied. */
						__( '%d links copied.', 'desktop-mode' ),
						links.length,
					),
		} );
	} catch {
		// Clipboard access is permission-gated and simply absent over
		// plain HTTP; say so rather than failing mutely.
		showToast( {
			message: __(
				'Could not reach the clipboard — copying needs a secure (https) connection.',
				'desktop-mode',
			),
			duration: 6000,
		} );
	}
}

/** The "Copy link" entry, shared by every list whose rows have URLs. */
export function copyLinksAction< T >(
	item: T,
	urlOf: ( row: T ) => string,
	label: string = __( 'Copy link', 'desktop-mode' ),
): SelectionAction< T > {
	return {
		id: 'copy-links',
		label,
		icon: 'dashicons-admin-links',
		sort: 60,
		multi: true,
		bulkLabel: ( n ) =>
			sprintf(
				/* translators: %d: number of selected entries. */
				__( 'Copy %d links', 'desktop-mode' ),
				n,
			),
		bulk: ( items ) => copyLinks( items, urlOf ),
		onClick: () => copyLinks( [ item ], urlOf ),
	};
}
