import { createSelectionModel, type SelectionModel } from './model';

const DEFAULT_ITEM_SELECTOR = '.os-file-tile';
const SELECTED_CLASS = 'os-file-tile--selected';
const MARQUEE_CLASS = 'os-selection-marquee';

const MARQUEE_THRESHOLD_PX = 4;

const MARQUEE_EDGE_PX = 36;

const MARQUEE_SCROLL_PX = 12;

const MARQUEE_ACTIVE_ATTR = 'data-os-marquee';

function isUserScrollable( el: HTMLElement ): boolean {
	if ( el.scrollHeight <= el.clientHeight ) {
		return false;
	}
	const overflowY = el.ownerDocument?.defaultView
		?.getComputedStyle( el )
		?.overflowY;
	return (
		overflowY === 'auto' ||
		overflowY === 'scroll' ||
		overflowY === 'overlay'
	);
}

function suppressNativeSelection( ref: HTMLElement ): () => void {
	const doc = ref.ownerDocument;
	if ( ! doc ) {
		return () => undefined;
	}
	const onSelectStart = ( e: Event ): void => {
		e.preventDefault();
	};
	doc.addEventListener( 'selectstart', onSelectStart, true );
	doc.body?.setAttribute( MARQUEE_ACTIVE_ATTR, '' );
	try {
		doc.defaultView?.getSelection()?.removeAllRanges();
	} catch {

	}
	return () => {
		doc.removeEventListener( 'selectstart', onSelectStart, true );
		doc.body?.removeAttribute( MARQUEE_ACTIVE_ATTR );
	};
}

const DEFAULT_MARQUEE_EXCLUDE =
	'.os-window, .os-widgets__list, .os-widgets__card, .os-widgets__add, .os-pinned-note, .os-mobile-home, .os-mobile-edge';

const OVERVIEW_ACTIVE_CLASS = 'os-area--overview';

export interface SelectionControllerOptions {

	itemSelector?: string;

	keyOf: ( el: HTMLElement ) => string | null;

	background?: HTMLElement;

	marquee?: boolean;

	marqueeExclude?: string;

	order?: () => string[];
	onChange?: ( keys: string[] ) => void;

	surface?: string;

	scope?: string;

	ariaLabel?: string;
}

export interface SelectionHandle {
	model: SelectionModel< string >;

	keys: () => string[];

	elementFor: ( key: string ) => HTMLElement | null;

	refresh: () => void;
	destroy: () => void;
}

export function attachSelection(
	root: HTMLElement,
	options: SelectionControllerOptions,
): SelectionHandle {
	const itemSelector = options.itemSelector ?? DEFAULT_ITEM_SELECTOR;
	const background = options.background ?? root;
	const marqueeEnabled = options.marquee !== false;
	const marqueeExclude = options.marqueeExclude ?? DEFAULT_MARQUEE_EXCLUDE;

	const itemElements = (): HTMLElement[] =>
		Array.from( root.querySelectorAll< HTMLElement >( itemSelector ) ).filter(
			( el ) => options.keyOf( el ) !== null,
		);

	const defaultOrder = (): string[] => {
		const groups: HTMLElement[] = [];
		const byGroup = new Map<
			HTMLElement,
			Array< { key: string; top: number; left: number; index: number } >
		>();
		itemElements().forEach( ( el, index ) => {
			const parent = el.parentElement ?? root;
			let bucket = byGroup.get( parent );
			if ( ! bucket ) {
				bucket = [];
				byGroup.set( parent, bucket );
				groups.push( parent );
			}
			bucket.push( {
				key: options.keyOf( el ) as string,
				top: parseFloat( el.style.top ) || 0,
				left: parseFloat( el.style.left ) || 0,
				index,
			} );
		} );
		const out: string[] = [];
		for ( const group of groups ) {
			const bucket = byGroup.get( group ) ?? [];
			bucket.sort( ( a, b ) => {
				if ( a.top !== b.top ) {
					return a.top - b.top;
				}
				if ( a.left !== b.left ) {
					return a.left - b.left;
				}
				return a.index - b.index;
			} );
			for ( const entry of bucket ) {
				out.push( entry.key );
			}
		}
		return out;
	};

	const order = options.order ?? defaultOrder;

	const model = createSelectionModel< string >( {
		order,
		onChange: ( keys ) => {
			paint();
			options.onChange?.( keys );
			emitChanged( keys );
		},
	} );

	const identity = {};

	const emitChanged = ( keys: string[] ): void => {
		if ( typeof document === 'undefined' ) {
			return;
		}
		lastActive = {
			surface: options.surface ?? '',
			scope: options.scope ?? '',
			keys: keys.slice(),
			count: keys.length,
		};
		lastActiveOwner = identity;
		document.dispatchEvent(
			new CustomEvent( 'os-selection-changed', { detail: lastActive } ),
		);
	};

	const elementFor = ( key: string ): HTMLElement | null =>
		itemElements().find( ( el ) => options.keyOf( el ) === key ) ?? null;

	const paint = (): void => {
		for ( const el of itemElements() ) {
			const key = options.keyOf( el ) as string;
			const on = model.has( key );
			if ( on !== el.hasAttribute( 'selected' ) ) {
				if ( on ) {
					el.setAttribute( 'selected', '' );
				} else {
					el.removeAttribute( 'selected' );
				}
			}
			el.classList.toggle( SELECTED_CLASS, on );

			if ( ! el.hasAttribute( 'selectable' ) ) {
				el.setAttribute( 'selectable', '' );
			}
			const ariaSelected = on ? 'true' : 'false';
			if ( el.getAttribute( 'aria-selected' ) !== ariaSelected ) {
				el.setAttribute( 'aria-selected', ariaSelected );
			}
		}
	};

	root.setAttribute( 'role', 'listbox' );
	root.setAttribute( 'aria-multiselectable', 'true' );
	if ( options.ariaLabel ) {
		root.setAttribute( 'aria-label', options.ariaLabel );
	}

	let lead: string | null = null;

	const onClick = ( e: MouseEvent ): void => {
		if ( ! ( e.target instanceof Element ) ) {
			return;
		}
		const tile = e.target.closest< HTMLElement >( itemSelector );
		if ( tile && root.contains( tile ) ) {
			const key = options.keyOf( tile );
			if ( key === null ) {
				return;
			}
			lead = key;

			e.stopPropagation();
			if ( e.shiftKey ) {
				model.selectRange( key, e.ctrlKey || e.metaKey );
				return;
			}
			if ( e.ctrlKey || e.metaKey ) {
				model.toggle( key );
				return;
			}
			model.set( [ key ] );
			return;
		}

		if ( suppressNextBackgroundClick ) {
			suppressNextBackgroundClick = false;
			return;
		}
		model.clear();
	};
	background.addEventListener( 'click', onClick );

	let marqueeEl: HTMLElement | null = null;

	let marqueeStart: { x: number; y: number } | null = null;

	let lastPointer: { x: number; y: number } | null = null;
	let marqueeBase: string[] = [];
	let suppressNextBackgroundClick = false;
	let autoScrollRaf = 0;
	let releaseSelectionSuppression: ( () => void ) | null = null;

	let capturedPointerId: number | null = null;

	const capturePointer = ( pointerId: number ): void => {
		if ( typeof background.setPointerCapture !== 'function' ) {
			return;
		}
		try {
			background.setPointerCapture( pointerId );
			capturedPointerId = pointerId;
		} catch {

		}
	};

	const releasePointer = (): void => {
		if (
			capturedPointerId === null ||
			typeof background.releasePointerCapture !== 'function'
		) {
			capturedPointerId = null;
			return;
		}
		try {
			if ( background.hasPointerCapture?.( capturedPointerId ) ) {
				background.releasePointerCapture( capturedPointerId );
			}
		} catch {

		}
		capturedPointerId = null;
	};

	const toContent = (
		clientX: number,
		clientY: number,
	): { x: number; y: number } => {
		const host = background.getBoundingClientRect();
		return {
			x: clientX - host.left + background.scrollLeft,
			y: clientY - host.top + background.scrollTop,
		};
	};

	const endMarquee = (): void => {
		marqueeEl?.remove();
		marqueeEl = null;
		marqueeStart = null;
		lastPointer = null;
		releaseSelectionSuppression?.();
		releaseSelectionSuppression = null;
		releasePointer();
		if ( autoScrollRaf ) {
			cancelAnimationFrame( autoScrollRaf );
			autoScrollRaf = 0;
		}
		document.removeEventListener( 'pointermove', onMarqueeMove );
		document.removeEventListener( 'pointerup', onMarqueeUp );
		document.removeEventListener( 'pointercancel', onMarqueeCancel );
		background.removeEventListener( 'lostpointercapture', onMarqueeCancel );
		background.removeEventListener( 'scroll', renderMarquee );
		window.removeEventListener( 'blur', onMarqueeCancel );
	};

	function renderMarquee(): void {
		if ( ! marqueeStart || ! lastPointer ) {
			return;
		}
		const cursor = toContent( lastPointer.x, lastPointer.y );
		const dx = cursor.x - marqueeStart.x;
		const dy = cursor.y - marqueeStart.y;
		if (
			! marqueeEl &&
			Math.abs( dx ) < MARQUEE_THRESHOLD_PX &&
			Math.abs( dy ) < MARQUEE_THRESHOLD_PX
		) {
			return;
		}
		if ( ! marqueeEl ) {
			marqueeEl = document.createElement( 'div' );
			marqueeEl.className = MARQUEE_CLASS;
			marqueeEl.setAttribute( 'aria-hidden', 'true' );

			if ( getComputedStyle( background ).position === 'static' ) {
				background.style.position = 'relative';
			}
			background.appendChild( marqueeEl );
			suppressNextBackgroundClick = true;

			releaseSelectionSuppression =
				suppressNativeSelection( background );
			startAutoScroll();
		}
		const left = Math.min( marqueeStart.x, cursor.x );
		const top = Math.min( marqueeStart.y, cursor.y );
		const width = Math.abs( dx );
		const height = Math.abs( dy );
		marqueeEl.style.left = `${ left }px`;
		marqueeEl.style.top = `${ top }px`;
		marqueeEl.style.width = `${ width }px`;
		marqueeEl.style.height = `${ height }px`;

		const host = background.getBoundingClientRect();
		const originX = host.left - background.scrollLeft;
		const originY = host.top - background.scrollTop;
		const box = {
			left: left + originX,
			top: top + originY,
			right: left + width + originX,
			bottom: top + height + originY,
		};
		const hits: string[] = [];
		for ( const el of itemElements() ) {
			const rect = el.getBoundingClientRect();
			const intersects =
				rect.left < box.right &&
				rect.right > box.left &&
				rect.top < box.bottom &&
				rect.bottom > box.top;
			if ( intersects ) {
				hits.push( options.keyOf( el ) as string );
			}
		}
		model.set( Array.from( new Set( [ ...marqueeBase, ...hits ] ) ) );
	}

	function startAutoScroll(): void {
		if ( autoScrollRaf || typeof requestAnimationFrame !== 'function' ) {
			return;
		}
		const step = (): void => {
			autoScrollRaf = 0;
			if ( ! marqueeEl || ! lastPointer ) {
				return;
			}
			const host = background.getBoundingClientRect();
			const canScroll = isUserScrollable( background );
			if ( canScroll ) {
				let delta = 0;
				if ( lastPointer.y < host.top + MARQUEE_EDGE_PX ) {
					delta = -MARQUEE_SCROLL_PX;
				} else if ( lastPointer.y > host.bottom - MARQUEE_EDGE_PX ) {
					delta = MARQUEE_SCROLL_PX;
				}
				if ( delta !== 0 ) {
					const before = background.scrollTop;
					background.scrollTop += delta;
					if ( background.scrollTop !== before ) {
						renderMarquee();
					}
				}
			}
			autoScrollRaf = requestAnimationFrame( step );
		};
		autoScrollRaf = requestAnimationFrame( step );
	}

	const onMarqueeMove = ( e: PointerEvent ): void => {
		if ( ! marqueeStart ) {
			return;
		}
		lastPointer = { x: e.clientX, y: e.clientY };
		renderMarquee();
	};

	const onMarqueeUp = (): void => {
		if ( marqueeEl ) {
			lastMarqueeEndAt = Date.now();
		}
		endMarquee();
	};

	const onMarqueeCancel = (): void => {
		endMarquee();
	};

	const onBackgroundPointerDown = ( e: PointerEvent ): void => {
		if ( ! marqueeEnabled || e.button !== 0 ) {
			return;
		}
		if ( ! ( e.target instanceof Element ) ) {
			return;
		}

		if ( background.classList.contains( OVERVIEW_ACTIVE_CLASS ) ) {
			return;
		}
		if ( e.target.closest( itemSelector ) ) {
			return;
		}

		const foreign = e.target.closest< HTMLElement >( marqueeExclude );
		if ( foreign && foreign !== background && background.contains( foreign ) ) {
			return;
		}
		marqueeStart = toContent( e.clientX, e.clientY );
		lastPointer = { x: e.clientX, y: e.clientY };
		if ( typeof e.pointerId === 'number' ) {
			capturePointer( e.pointerId );
		}

		marqueeBase =
			e.ctrlKey || e.metaKey || e.shiftKey ? model.keys() : [];
		if ( marqueeBase.length === 0 ) {
			model.clear();
		}
		document.addEventListener( 'pointermove', onMarqueeMove );
		document.addEventListener( 'pointerup', onMarqueeUp );
		document.addEventListener( 'pointercancel', onMarqueeCancel );

		background.addEventListener( 'lostpointercapture', onMarqueeCancel );
		window.addEventListener( 'blur', onMarqueeCancel );

		background.addEventListener( 'scroll', renderMarquee, {
			passive: true,
		} );
	};
	background.addEventListener( 'pointerdown', onBackgroundPointerDown );

	const onKeyDown = ( e: KeyboardEvent ): void => {
		if ( e.key === 'a' && ( e.ctrlKey || e.metaKey ) ) {
			e.preventDefault();
			model.selectAll();
			return;
		}
		if ( e.key === 'Escape' ) {
			if ( marqueeEl || marqueeStart ) {
				endMarquee();
				return;
			}
			if ( model.size() > 0 ) {
				model.clear();
			}
			return;
		}
		const forward = e.key === 'ArrowRight' || e.key === 'ArrowDown';
		const backward = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
		if ( ! forward && ! backward ) {
			return;
		}
		const step = forward ? 1 : -1;
		const all = order();
		if ( all.length === 0 ) {
			return;
		}

		const cursor = lead ?? model.anchor();
		const from = cursor === null ? -1 : all.indexOf( cursor );
		const next = Math.min(
			all.length - 1,
			Math.max( 0, from < 0 ? 0 : from + step ),
		);
		e.preventDefault();
		const key = all[ next ];
		lead = key;
		if ( e.shiftKey ) {
			model.selectRange( key );
		} else {
			model.set( [ key ] );
		}
		elementFor( key )?.focus();
	};
	root.addEventListener( 'keydown', onKeyDown );

	paint();

	return {
		model,
		keys: () => model.keys(),
		elementFor,
		refresh() {
			model.prune();
			paint();
		},
		destroy() {
			endMarquee();
			background.removeEventListener( 'click', onClick );
			background.removeEventListener(
				'pointerdown',
				onBackgroundPointerDown,
			);
			root.removeEventListener( 'keydown', onKeyDown );

			if ( lastActiveOwner === identity ) {
				lastActive = null;
				lastActiveOwner = null;
			}
		},
	};
}

let lastMarqueeEndAt = 0;

export function recentlyMarqueed(): boolean {
	return lastMarqueeEndAt > 0 && Date.now() - lastMarqueeEndAt < 500;
}

let lastActive: {
	surface: string;
	scope: string;
	keys: string[];
	count: number;
} | null = null;

let lastActiveOwner: object | null = null;

export function activeSelection(): {
	surface: string;
	scope: string;
	keys: string[];
	count: number;
} | null {
	return lastActive ? { ...lastActive, keys: lastActive.keys.slice() } : null;
}
