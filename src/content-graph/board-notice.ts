/**
 * Content Graph — what the board says when there is little on it.
 *
 * A site with two posts used to open onto two dots and the status
 * line "2 nodes · 0 links", which reads as broken rather than as
 * empty. The board now explains itself: an empty state when there is
 * nothing to pin (and whether that is because the site has no content,
 * because the toolbar has filtered it all out, or because every type
 * is switched off), and a short note when there are nodes but no
 * threads yet, saying what a thread is and where the other
 * relationships live.
 *
 * `deriveBoardNotice` is the pure decision; `renderBoardNotice` owns
 * the DOM. Both live outside the Pixi canvas — a plain overlay on the
 * stage, the same shape the categories mind-map uses for its hint —
 * so the copy is real text: translatable and themable.
 *
 * @public
 */

// Side-effect import — registers `<os-empty-state>` for this bundle.
// `defineComponent` is idempotent across bundles, and every window
// bundle that constructs the element imports it the same way so it
// works whatever order the bundles landed in.
import '../ui/components/os-empty-state/os-empty-state';
import { __ } from '../i18n';

export type BoardNotice =
	| { kind: 'none' }
	/** No readable content of any graphable type on the site. */
	| { kind: 'no-content' }
	/** Content exists, but every type that has any is switched off. */
	| { kind: 'filtered-out' }
	/** Every toolbar chip is off. */
	| { kind: 'all-off' }
	/** Nodes on the board, no thread between any two of them. */
	| { kind: 'no-threads' };

export interface BoardNoticeInput {
	/** `stats.nodes` from the graph payload. */
	nodes: number;
	/** `stats.edges` from the graph payload. */
	edges: number;
	/**
	 * Post-type descriptors with their live counts. `count` is absent
	 * on the descriptors the window config ships (only `/post-types`
	 * adds it); while no descriptor carries one, the counts are
	 * treated as unknown rather than as zero.
	 */
	types: ReadonlyArray< { slug: string; count?: number } >;
	/** Slugs currently switched on in the toolbar. */
	activeTypes: ReadonlyArray< string >;
}

export function deriveBoardNotice( input: BoardNoticeInput ): BoardNotice {
	if ( input.nodes > 0 ) {
		return input.edges > 0 ? { kind: 'none' } : { kind: 'no-threads' };
	}
	if ( input.activeTypes.length === 0 && input.types.length > 0 ) {
		return { kind: 'all-off' };
	}
	const active = new Set( input.activeTypes );
	const countsKnown = input.types.some(
		( t ) => typeof t.count === 'number',
	);
	let hidden = 0;
	for ( const t of input.types ) {
		if ( active.has( t.slug ) ) {
			continue;
		}
		// With counts unknown (`/post-types` failed) a switched-off
		// type is assumed to have content: blaming the chips when the
		// user is filtering is the safer of the two mistakes.
		hidden += countsKnown ? t.count ?? 0 : 1;
	}
	return hidden > 0 ? { kind: 'filtered-out' } : { kind: 'no-content' };
}

export interface BoardNoticeHandle {
	set: ( notice: BoardNotice ) => void;
	/**
	 * Hide the "No threads yet" note without forgetting it — used
	 * while a grouping is active, when the cluster labels need the
	 * top-left corner. Empty-board states are never suppressed.
	 */
	setSuppressed: ( suppressed: boolean ) => void;
	destroy: () => void;
}

export const BOARD_EMPTY_CLASS = 'os-content-graph__empty';
export const BOARD_HINT_CLASS = 'os-content-graph__hint';

export function renderBoardNotice( host: HTMLElement ): BoardNoticeHandle {
	let current: HTMLElement | null = null;
	let currentKind: BoardNotice[ 'kind' ] = 'none';
	let wanted: BoardNotice = { kind: 'none' };
	let suppressed = false;

	const remove = (): void => {
		current?.remove();
		current = null;
		currentKind = 'none';
	};

	const emptyState = (
		icon: string,
		heading: string,
		description: string,
	): HTMLElement => {
		const el = document.createElement( 'os-empty-state' );
		el.className = BOARD_EMPTY_CLASS;
		el.setAttribute( 'icon', icon );
		el.setAttribute( 'heading', heading );
		el.setAttribute( 'description', description );
		return el;
	};

	const hint = ( title: string, body: string ): HTMLElement => {
		const el = document.createElement( 'div' );
		el.className = BOARD_HINT_CLASS;
		el.setAttribute( 'role', 'note' );
		const h = document.createElement( 'strong' );
		h.className = `${ BOARD_HINT_CLASS }-title`;
		h.textContent = title;
		const p = document.createElement( 'p' );
		p.className = `${ BOARD_HINT_CLASS }-body`;
		p.textContent = body;
		el.append( h, p );
		return el;
	};

	const build = ( notice: BoardNotice ): HTMLElement | null => {
		switch ( notice.kind ) {
			case 'none':
				return null;
			case 'no-content':
				return emptyState(
					'admin-post',
					__( 'Nothing on the board yet' ),
					__(
						'Publish a post or a page and it is pinned here. Threads are drawn between posts when one links to another.',
					),
				);
			case 'filtered-out':
				return emptyState(
					'filter',
					__( 'Nothing to show for these types' ),
					__(
						'The post types switched on in the toolbar have no content yet. Switch another one on to see its posts.',
					),
				);
			case 'all-off':
				return emptyState(
					'filter',
					__( 'Every post type is switched off' ),
					__( 'Switch a type back on in the toolbar to see its posts.' ),
				);
			case 'no-threads':
				return hint(
					__( 'No threads yet' ),
					__(
						'A thread joins two posts when one links to the other. Click a node to see its author, terms, comments, media and revisions, or group the board by category, tag, author, year or month from the toolbar.',
					),
				);
		}
	};

	const paint = (): void => {
		const effective: BoardNotice =
			suppressed && wanted.kind === 'no-threads'
				? { kind: 'none' }
				: wanted;
		if ( effective.kind === currentKind ) {
			return;
		}
		remove();
		const el = build( effective );
		if ( el ) {
			host.appendChild( el );
			current = el;
			currentKind = effective.kind;
		}
	};

	return {
		set: ( notice ) => {
			wanted = notice;
			paint();
		},
		setSuppressed: ( value ) => {
			suppressed = value;
			paint();
		},
		destroy: remove,
	};
}
