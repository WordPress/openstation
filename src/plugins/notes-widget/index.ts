/**
 * Desktop Mode — Note Pad widget.
 *
 * The composer for pinned notes: a physical pad of pastel paper on
 * the widget card. The top sheet is the live draft; two peek sheets
 * beneath it are tinted with the NEXT colors in the cycle (the pad
 * advertises its own palette), a folded bottom-right corner whose
 * underside shows the next color doubles as the cycler, and a row of
 * paper-dot swatches picks directly.
 *
 * Creating a note:
 *
 *   - Drag the sheet (its glued top edge, or any paper margin) out
 *     of the pad and drop it on the wallpaper — a `'note-draft'`
 *     DragManager payload the notes layer (main bundle) turns into a
 *     POST + the pin-insertion thunk.
 *   - Or press the "Pin to desktop" button / Ctrl+Enter in the
 *     textarea — this bundle POSTs directly and hands the note to
 *     the layer via the `desktop-mode-note-created` CustomEvent.
 *
 * Cross-bundle rules honored here: only plain data crosses to the
 * main bundle (payload / CustomEvent detail); the REST client copy
 * compiled into THIS bundle gets its own deps installed from
 * `window.desktopModeConfig`.
 *
 * @since 0.9.6
 */
import './styles.css';
import '../../ui/components/wpd-checkbox-label/wpd-checkbox-label';
import '../../ui/components/wpd-textarea/wpd-textarea';
import { __ } from '../../i18n';
import type { DragManagerApi } from '../../drag';
import { NOTE_COLORS, nextNoteColor, normalizeNoteColor } from '../../notes/colors';
import { hashNoteSeed } from '../../notes/motion';
import { buildPinImage } from '../../notes/pin';
import { createNote, installNotesRestDeps } from '../../notes/rest';
import {
	NOTE_CREATED_EVENT,
	NOTE_DRAFT_PAYLOAD_TYPE,
	type NoteDraftDragData,
} from '../../notes/types';
import type { WidgetContext, WidgetTeardown } from '../../widgets/types';

const WIDGET_ID = 'desktop-mode/notes';

type WpdTextareaElement = HTMLElement & { focusInput?: () => void };

interface ShellConfig {
	notesUrl?: string;
	restNonce?: string;
}

function readShellConfig(): ShellConfig {
	return (
		( window as unknown as { desktopModeConfig?: ShellConfig } )
			.desktopModeConfig ?? {}
	);
}

function getDragManager(): DragManagerApi | null {
	return (
		(
			window as unknown as {
				wp?: { desktop?: { dragManager?: DragManagerApi } };
			}
		).wp?.desktop?.dragManager ?? null
	);
}

const mount = (
	container: HTMLElement,
	ctx: WidgetContext,
): WidgetTeardown => {
	let destroyed = false;

	const config = readShellConfig();
	const canCreate = Boolean( config.notesUrl );
	if ( canCreate ) {
		installNotesRestDeps( {
			baseUrl: config.notesUrl as string,
			nonce: config.restNonce ?? '',
		} );
	}

	let color = normalizeNoteColor(
		ctx.storage.get< string >( 'color' ) ?? NOTE_COLORS[ 0 ],
	);
	let isPublic = ctx.storage.get< boolean >( 'public' ) ?? false;
	let text = '';

	// ------------------------------------------------------------------
	// DOM
	// ------------------------------------------------------------------

	const root = document.createElement( 'div' );
	root.className = 'dm-notes-pad';

	const stack = document.createElement( 'div' );
	stack.className = 'dm-notes-pad__stack';

	const under2 = document.createElement( 'div' );
	under2.className = 'dm-notes-pad__under dm-notes-pad__under--2';
	const under1 = document.createElement( 'div' );
	under1.className = 'dm-notes-pad__under dm-notes-pad__under--1';

	const sheet = document.createElement( 'div' );
	sheet.className = 'dm-notes-pad__sheet';

	const peel = document.createElement( 'div' );
	peel.className = 'dm-notes-pad__peel';
	peel.setAttribute( 'aria-hidden', 'true' );
	const peelHint = document.createElement( 'span' );
	peelHint.className = 'dm-notes-pad__peel-hint';
	peelHint.textContent = __( 'Drag to pin', 'desktop-mode' );
	peel.appendChild( peelHint );

	const editor = document.createElement( 'wpd-textarea' ) as WpdTextareaElement;
	editor.className = 'dm-notes-pad__editor';
	editor.setAttribute( 'aria-label', __( 'New note', 'desktop-mode' ) );
	editor.setAttribute( 'placeholder', __( 'Write a note…', 'desktop-mode' ) );
	editor.setAttribute( 'rows', '5' );
	editor.setAttribute( 'auto-grow', '' );
	editor.setAttribute( 'max-rows', '8' );

	const corner = document.createElement( 'button' );
	corner.type = 'button';
	corner.className = 'dm-notes-pad__corner';

	sheet.append( peel, editor, corner );
	stack.append( under2, under1, sheet );

	const footer = document.createElement( 'div' );
	footer.className = 'dm-notes-pad__footer';

	const swatches = document.createElement( 'div' );
	swatches.className = 'dm-notes-pad__swatches';
	swatches.setAttribute( 'role', 'radiogroup' );
	swatches.setAttribute( 'aria-label', __( 'Paper color', 'desktop-mode' ) );
	const swatchButtons = new Map< string, HTMLButtonElement >();
	for ( const slug of NOTE_COLORS ) {
		const dot = document.createElement( 'button' );
		dot.type = 'button';
		dot.className = 'dm-notes-pad__swatch';
		dot.dataset.noteColor = slug;
		dot.setAttribute( 'role', 'radio' );
		dot.setAttribute( 'aria-label', slug );
		dot.addEventListener( 'click', () => setColor( slug ) );
		swatchButtons.set( slug, dot );
		swatches.appendChild( dot );
	}

	const publicToggle = document.createElement( 'wpd-checkbox-label' );
	publicToggle.className = 'dm-notes-pad__public';
	publicToggle.setAttribute(
		'label',
		__( 'Public — visible to other desktop users', 'desktop-mode' ),
	);
	if ( isPublic ) {
		publicToggle.setAttribute( 'checked', '' );
	}
	publicToggle.addEventListener( 'wpd-checkbox-change', ( ev ) => {
		isPublic =
			( ev as CustomEvent< { checked: boolean } > ).detail.checked;
		ctx.storage.set( 'public', isPublic );
	} );

	const pinButton = document.createElement( 'button' );
	pinButton.type = 'button';
	pinButton.className = 'dm-notes-pad__pin-btn';
	pinButton.textContent = __( 'Pin to desktop', 'desktop-mode' );
	pinButton.title = __(
		'Pin the note without dragging (Ctrl+Enter)',
		'desktop-mode',
	);

	footer.append( swatches, publicToggle, pinButton );
	root.append( stack, footer );
	container.appendChild( root );

	// ------------------------------------------------------------------
	// Color state
	// ------------------------------------------------------------------

	function refreshColors(): void {
		const next1 = nextNoteColor( color );
		const next2 = nextNoteColor( next1 );
		sheet.dataset.noteColor = color;
		stack.dataset.noteColor = color;
		under1.dataset.noteColor = next1;
		under2.dataset.noteColor = next2;
		corner.dataset.noteColor = next1;
		corner.setAttribute(
			'aria-label',
			`${ __( 'Next paper color', 'desktop-mode' ) }: ${ next1 }`,
		);
		for ( const [ slug, dot ] of swatchButtons ) {
			dot.setAttribute(
				'aria-checked',
				slug === color ? 'true' : 'false',
			);
			dot.classList.toggle( 'is-selected', slug === color );
		}
	}

	function setColor( slug: string ): void {
		color = normalizeNoteColor( slug );
		ctx.storage.set( 'color', color );
		refreshColors();
	}

	const onCornerClick = (): void => setColor( nextNoteColor( color ) );
	corner.addEventListener( 'click', onCornerClick );
	refreshColors();

	// ------------------------------------------------------------------
	// Draft state
	// ------------------------------------------------------------------

	const onInput = ( ev: Event ): void => {
		text = ( ev as CustomEvent< { value: string } > ).detail.value;
	};
	editor.addEventListener( 'wpd-input-change', onInput );

	// Shell shortcuts must not fire while writing on the pad — and
	// Ctrl/Cmd+Enter is the keyboard pin path.
	const onEditorKeydown = ( ev: Event ): void => {
		const kev = ev as KeyboardEvent;
		if ( kev.key === 'Enter' && ( kev.ctrlKey || kev.metaKey ) ) {
			kev.preventDefault();
			void pinWithoutDrag();
		}
		kev.stopPropagation();
	};
	[ 'keydown', 'keypress', 'keyup' ].forEach( ( name ) =>
		editor.addEventListener( name, ( ev ) => {
			if ( name === 'keydown' ) {
				onEditorKeydown( ev );
			} else {
				ev.stopPropagation();
			}
		} ),
	);

	const clearDraft = (): void => {
		text = '';
		editor.setAttribute( 'value', '' );
	};

	/** A tiny "nothing to pin" shake for empty-draft attempts. */
	const shakeSheet = (): void => {
		if (
			typeof window.matchMedia === 'function' &&
			window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches
		) {
			return;
		}
		sheet.animate?.(
			[
				{ transform: 'translateX(0)' },
				{ transform: 'translateX(-4px)' },
				{ transform: 'translateX(4px)' },
				{ transform: 'translateX(0)' },
			],
			{ duration: 200, easing: 'ease-out' },
		);
	};

	// ------------------------------------------------------------------
	// Tear-off drag
	// ------------------------------------------------------------------

	/**
	 * Ghost: a real-looking pinned note held by its pin — reuses the
	 * `.desktop-mode-pinned-note-ghost` classes styled by the shell's
	 * notes.css (the ghost mounts on the shell body, not the widget).
	 */
	const buildDraftGhost = (): {
		root: HTMLElement;
		tipX: number;
		tipY: number;
	} => {
		const width = 208;
		const ghostRoot = document.createElement( 'div' );
		ghostRoot.className = 'desktop-mode-pinned-note-ghost';
		ghostRoot.dataset.noteColor = color;
		ghostRoot.style.width = `${ width }px`;

		const swing = document.createElement( 'div' );
		swing.className = 'desktop-mode-pinned-note-ghost__swing';
		swing.dataset.noteColor = color;
		// Needle tip: top-center of the paper (no jitter on a draft).
		const tipX = width / 2;
		const tipY = 10;
		swing.style.transformOrigin = `${ tipX }px ${ tipY }px`;

		const pin = document.createElement( 'span' );
		pin.className = 'desktop-mode-pinned-note__pin';
		pin.style.setProperty( '--dm-pin-dx', '0px' );
		pin.style.setProperty( '--dm-pin-rot', '0deg' );
		pin.appendChild( buildPinImage( ctx.pluginUrl ) );

		const paper = document.createElement( 'div' );
		paper.className =
			'desktop-mode-pinned-note__paper desktop-mode-pinned-note-ghost__paper';
		const body = document.createElement( 'div' );
		body.className = 'desktop-mode-pinned-note__body';
		body.textContent = text;
		paper.appendChild( body );

		swing.append( pin, paper );
		ghostRoot.appendChild( swing );
		return { root: ghostRoot, tipX, tipY };
	};

	const onSheetPointerDown = ( ev: PointerEvent ): void => {
		if ( destroyed || ! canCreate ) {
			return;
		}
		const target = ev.target as Element | null;
		// The textarea keeps normal text editing; the corner keeps its
		// click. Everything else on the sheet is a tear-off handle.
		if ( target?.closest( 'wpd-textarea, .dm-notes-pad__corner' ) ) {
			return;
		}
		if ( ! text.trim() ) {
			shakeSheet();
			return;
		}
		const dragManager = getDragManager();
		if ( ! dragManager ) {
			return;
		}
		// Without this, the browser treats the gesture as a text-drag:
		// moving the pointer across the sheet sweeps a native selection
		// through the textarea while the ghost flies. Also drop any
		// selection that already exists (e.g. from a previous edit).
		ev.preventDefault();
		sheet.ownerDocument.defaultView?.getSelection()?.removeAllRanges();
		const ghost = buildDraftGhost();
		const data: NoteDraftDragData = {
			text,
			color,
			isPublic,
		};
		dragManager.start( {
			payload: {
				type: NOTE_DRAFT_PAYLOAD_TYPE,
				source: sheet,
				data,
				ghost: {
					element: ghost.root,
					offsetX: ghost.tipX,
					offsetY: ghost.tipY,
					hint: {
						neutral: __( 'Drop on the desktop to pin', 'desktop-mode' ),
						accept: __( 'Pin here', 'desktop-mode' ),
						reject: __( 'Can’t pin here', 'desktop-mode' ),
					},
				},
			},
			origin: ev,
			onClickOnly: () => editor.focusInput?.(),
			onCommit: () => {
				// Torn off — the layer owns the note now. Reveal a
				// fresh sheet with a springy pop.
				clearDraft();
				playTearOffPromotion();
			},
			// onCancel: the sheet reappears untouched (the manager
			// removes its source-dragging class) — the draft survives.
		} );
	};
	sheet.addEventListener( 'pointerdown', onSheetPointerDown );

	const playTearOffPromotion = (): void => {
		if (
			typeof window.matchMedia === 'function' &&
			window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches
		) {
			return;
		}
		sheet.animate?.(
			[
				{
					transform: 'translate(3px, 4px) rotate(1.1deg)',
					opacity: 0.9,
				},
				{
					transform: 'translate(-1px, -2px) rotate(-0.4deg)',
					offset: 0.7,
				},
				{ transform: 'translate(0, 0) rotate(0deg)', opacity: 1 },
			],
			{ duration: 260, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' },
		);
	};

	// ------------------------------------------------------------------
	// Keyboard / button pin path
	// ------------------------------------------------------------------

	async function pinWithoutDrag(): Promise< void > {
		if ( destroyed || ! canCreate ) {
			return;
		}
		if ( ! text.trim() ) {
			shakeSheet();
			editor.focusInput?.();
			return;
		}
		pinButton.disabled = true;
		try {
			// A gentle cascade keeps repeated keyboard pins from
			// stacking exactly on top of each other.
			const slot = Math.floor( Date.now() / 1000 ) % 5;
			const note = await createNote( {
				text,
				color,
				x: 0.55 + slot * 0.04,
				y: 0.12 + slot * 0.05,
				public: isPublic,
				seed: hashNoteSeed( text ),
			} );
			if ( destroyed ) {
				return;
			}
			clearDraft();
			playTearOffPromotion();
			document.dispatchEvent(
				new CustomEvent( NOTE_CREATED_EVENT, { detail: { note } } ),
			);
		} catch ( err ) {
			// eslint-disable-next-line no-console
			console.error( '[desktop-mode] note pad: create failed:', err );
			// Same user-visible feedback the drag path gets — a silent
			// failure reads as "the feature is broken".
			shakeSheet();
			const toast = (
				window as unknown as {
					wp?: {
						desktop?: {
							showToast?: ( opts: {
								message: string;
								duration?: number;
							} ) => void;
						};
					};
				}
			).wp?.desktop?.showToast;
			toast?.( {
				message: __(
					'Could not pin the note. Please try again.',
					'desktop-mode',
				),
				duration: 5000,
			} );
		} finally {
			pinButton.disabled = false;
		}
	}
	const onPinButton = (): void => {
		void pinWithoutDrag();
	};
	pinButton.addEventListener( 'click', onPinButton );

	if ( ! canCreate ) {
		root.classList.add( 'dm-notes-pad--unavailable' );
		editor.setAttribute( 'disabled', '' );
		pinButton.disabled = true;
	}

	return () => {
		destroyed = true;
		sheet.removeEventListener( 'pointerdown', onSheetPointerDown );
		corner.removeEventListener( 'click', onCornerClick );
		pinButton.removeEventListener( 'click', onPinButton );
	};
};

const w = window as unknown as {
	desktopModeWidgets?: Record< string, typeof mount >;
};
w.desktopModeWidgets = w.desktopModeWidgets ?? {};
w.desktopModeWidgets[ WIDGET_ID ] = mount;
