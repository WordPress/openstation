/**
 * Content Graph — what the board says when there is little on it.
 *
 * A site with two posts used to open onto two dots and the status
 * line "2 nodes · 0 links", which reads as broken rather than as
 * empty. The board now explains itself: an empty state when there is
 * nothing to pin (and whether that is because the site has no content
 * or because the toolbar has filtered it all out), and a short note
 * when there are cards but no threads yet, saying what a thread is and
 * where the other relationships live.
 *
 * `deriveBoardNotice` is the pure decision; `renderBoardNotice` owns
 * the DOM. Both live outside the Pixi canvas — a plain overlay on the
 * stage, the same shape the categories mind-map uses for its hint —
 * so the copy is real text: selectable, translatable, themable.
 *
 * @public
 */

// Side-effect import — registers `<os-empty-state>` for this bundle.
// `defineComponent` is idempotent across bundles; the main and
// window-system bundles don't register this one.
import '../ui/components/os-empty-state/os-empty-state';
import { __ } from '../i18n';

export type BoardNotice =
	| { kind: 'none' }
	/** No readable content of any graphable type on the site. */
	| { kind: 'no-content' }
	/** Content exists, but every type that has any is switched off. */
	| { kind: 'filtered-out' }
	/** Cards on the board, no thread between any two of them. */
	| { kind: 'no-threads' };

export interface BoardNoticeInput {
	/** `stats.nodes` from the graph payload. */
	nodes: number;
	/** `stats.edges` from the graph payload. */
	edges: number;
	/**
	 * Post-type descriptors with their live counts. `count` is absent
	 * on the descriptors the window config ships (only `/post-types`
	 * adds it), in which case the type is treated as empty.
	 */
	types: ReadonlyArray< { slug: string; count?: number } >;
	/** Slugs currently switched on in the toolbar. */
	activeTypes: ReadonlyArray< string >;
}

export function deriveBoardNotice( input: BoardNoticeInput ): BoardNotice {
	if ( input.nodes > 0 ) {
		return input.edges > 0 ? { kind: 'none' } : { kind: 'no-threads' };
	}
	const active = new Set( input.activeTypes );
	let hiddenCount = 0;
	for ( const t of input.types ) {
		if ( ! active.has( t.slug ) ) {
			hiddenCount += t.count ?? 0;
		}
	}
	return hiddenCount > 0 ? { kind: 'filtered-out' } : { kind: 'no-content' };
}

export interface BoardNoticeHandle {
	set: ( notice: BoardNotice ) => void;
	destroy: () => void;
}

export const BOARD_EMPTY_CLASS = 'os-content-graph__empty';
export const BOARD_HINT_CLASS = 'os-content-graph__hint';

export function renderBoardNotice( host: HTMLElement ): BoardNoticeHandle {
	let current: HTMLElement | null = null;
	let currentKind: BoardNotice[ 'kind' ] = 'none';

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
						'Publish a post or a page and it is pinned here as a card. Threads are drawn between cards when one post links to another.',
					),
				);
			case 'filtered-out':
				return emptyState(
					'filter',
					__( 'Nothing to show for these types' ),
					__(
						'The post types switched on in the toolbar have no content yet. Switch another one on to see its cards.',
					),
				);
			case 'no-threads':
				return hint(
					__( 'No threads yet' ),
					__(
						'A thread joins two cards when one post links to the other. Click a card to see its author, terms, comments, media and revisions, or group the board by category, tag, author or date from the toolbar.',
					),
				);
		}
	};

	return {
		set: ( notice ) => {
			if ( notice.kind === currentKind ) {
				return;
			}
			remove();
			const el = build( notice );
			if ( el ) {
				host.appendChild( el );
				current = el;
				currentKind = notice.kind;
			}
		},
		destroy: remove,
	};
}
