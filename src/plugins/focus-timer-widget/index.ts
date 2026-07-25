/**
 * Desktop Mode — Focus Timer widget.
 *
 * A focus countdown you add from the widget picker. Pick a duration,
 * optionally link it to one of your open windows, and start. When time
 * is up the linked window shakes (via the public `Window.shake()`) and
 * an alarm rings until you press Stop. The timer itself lives in a
 * page-wide runtime (`./timer`) so it keeps counting across re-renders
 * and page reloads; this file is only the view.
 *
 * @since 0.26.0
 */

import './styles.css';
import '../../ui/components/wpd-select/wpd-select';
import '../../ui/components/wpd-checkbox-label/wpd-checkbox-label';
import { __, sprintf } from '../../i18n';
import type { WidgetContext, WidgetTeardown } from '../../widgets/types';
import { listWindows, getWindow } from './desktop';
import {
	focusTimer,
	DURATION_BOUNDS,
	type Phase,
	type TimerSnapshot,
} from './timer';

const WIDGET_ID = 'desktop-mode/focus-timer';
const PRESETS_MIN = [ 5, 15, 25, 45 ];
const NONE = '__none__';

/** A `wpd-select` element with the small typed surface we drive. */
interface WpdSelect extends HTMLElement {
	items: ReadonlyArray< { value: string; label: string } >;
	value: string;
}

function el< K extends keyof HTMLElementTagNameMap >(
	tag: K,
	className?: string,
	text?: string,
): HTMLElementTagNameMap[ K ] {
	const node = document.createElement( tag );
	if ( className ) {
		node.className = className;
	}
	if ( text !== undefined ) {
		node.textContent = text;
	}
	return node;
}

// Native <button> for transport/presets — matches the Notes + Starter
// widgets. (wpd-select / wpd-checkbox-label web components are used for
// the picker + toggle, as the Notes widget does.)
function button( className: string, label: string ): HTMLButtonElement {
	const b = document.createElement( 'button' );
	b.type = 'button';
	b.className = className;
	b.textContent = label;
	return b;
}

/** ms → "MM:SS" (or "H:MM:SS" past an hour). */
function fmt( ms: number ): string {
	const total = Math.ceil( ms / 1000 );
	const h = Math.floor( total / 3600 );
	const m = Math.floor( ( total % 3600 ) / 60 );
	const s = total % 60;
	const mm = String( m ).padStart( 2, '0' );
	const ss = String( s ).padStart( 2, '0' );
	return h > 0 ? `${ h }:${ mm }:${ ss }` : `${ mm }:${ ss }`;
}

const mount = (
	container: HTMLElement,
	ctx: WidgetContext,
): WidgetTeardown => {
	const timer = focusTimer();
	timer.attachStorage( ctx.storage );
	container.classList.add( 'dm-focus' );

	let renderedPhase: Phase | null = null;
	let timeEl: HTMLElement | null = null;
	let subEl: HTMLElement | null = null;
	let windowSelect: WpdSelect | null = null;

	// --- Window link picker -------------------------------------------

	function windowItems(): Array< { value: string; label: string } > {
		const items: Array< { value: string; label: string } > = [
			{
				value: NONE,
				label: __( 'No window — just alarm', 'desktop-mode' ),
			},
		];
		// Only currently-open windows are offered — a closed window is
		// nothing to shake, so it never appears as a choice (issue #410).
		for ( const w of listWindows() ) {
			if ( w.id === WIDGET_ID ) {
				continue;
			}
			items.push( {
				value: w.id,
				label: w.config.title || __( 'Untitled window', 'desktop-mode' ),
			} );
		}
		return items;
	}

	function refreshWindowOptions(): void {
		if ( ! windowSelect ) {
			return;
		}
		const items = windowItems();
		windowSelect.items = items;
		// Show the linked window only if it is still open; otherwise fall
		// back to "No window".
		const linked = timer.snapshot().linkedWindowId;
		windowSelect.value =
			linked && items.some( ( i ) => i.value === linked ) ? linked : NONE;
	}

	// --- Phase skeletons -----------------------------------------------

	function buildSetup( s: TimerSnapshot ): void {
		container.replaceChildren();

		// Big editable time with − / + steppers.
		const time = el( 'div', 'dm-focus__time-row' );
		const minus = button( 'dm-focus__step', '−' );
		minus.setAttribute(
			'aria-label',
			__( 'Subtract a minute', 'desktop-mode' ),
		);
		const plus = button( 'dm-focus__step', '+' );
		plus.setAttribute( 'aria-label', __( 'Add a minute', 'desktop-mode' ) );
		timeEl = el( 'div', 'dm-focus__time' );
		minus.addEventListener( 'click', () =>
			timer.setDuration(
				timer.snapshot().durationMs - DURATION_BOUNDS.step,
			),
		);
		plus.addEventListener( 'click', () =>
			timer.setDuration(
				timer.snapshot().durationMs + DURATION_BOUNDS.step,
			),
		);
		time.append( minus, timeEl, plus );
		container.appendChild( time );

		// Quick presets.
		const presets = el( 'div', 'dm-focus__presets' );
		for ( const min of PRESETS_MIN ) {
			const chip = button(
				'dm-focus__chip',
				sprintf(
					/* translators: %d: minutes. */
					__( '%d min', 'desktop-mode' ),
					min,
				),
			);
			chip.addEventListener( 'click', () =>
				timer.setDuration( min * 60 * 1000 ),
			);
			presets.appendChild( chip );
		}
		container.appendChild( presets );

		// Link-to-window picker (wpd-select).
		const linkRow = el( 'div', 'dm-focus__field' );
		linkRow.append(
			el(
				'span',
				'dm-focus__field-label',
				__( 'Shake this window when done', 'desktop-mode' ),
			),
		);
		windowSelect = document.createElement( 'wpd-select' ) as WpdSelect;
		windowSelect.className = 'dm-focus__select';
		refreshWindowOptions();
		windowSelect.addEventListener( 'wpd-pick', ( ev ) => {
			const value = ( ev as CustomEvent< { value: string } > ).detail
				.value;
			timer.setLinkedWindow( value === NONE ? null : value );
		} );
		linkRow.appendChild( windowSelect );
		container.appendChild( linkRow );

		// Show-remaining toggle (wpd-checkbox-label).
		const toggle = document.createElement( 'wpd-checkbox-label' );
		toggle.className = 'dm-focus__toggle';
		toggle.setAttribute(
			'label',
			__( 'Show remaining time while running', 'desktop-mode' ),
		);
		if ( s.showRemaining ) {
			toggle.setAttribute( 'checked', '' );
		}
		toggle.addEventListener( 'wpd-checkbox-change', ( ev ) => {
			timer.setShowRemaining(
				( ev as CustomEvent< { checked: boolean } > ).detail.checked,
			);
		} );
		container.appendChild( toggle );

		// Actions.
		const actions = el( 'div', 'dm-focus__actions' );
		if ( s.phase === 'paused' ) {
			const resume = button(
				'dm-focus__btn is-primary',
				__( 'Resume', 'desktop-mode' ),
			);
			resume.addEventListener( 'click', () => timer.start() );
			const reset = button(
				'dm-focus__btn',
				__( 'Reset', 'desktop-mode' ),
			);
			reset.addEventListener( 'click', () => timer.reset() );
			actions.append( resume, reset );
		} else {
			const startBtn = button(
				'dm-focus__btn is-primary',
				__( 'Start focus', 'desktop-mode' ),
			);
			startBtn.addEventListener( 'click', () => timer.start() );
			actions.appendChild( startBtn );
		}
		container.appendChild( actions );
		subEl = null;
	}

	function buildRunning(): void {
		container.replaceChildren();
		windowSelect = null;

		timeEl = el( 'div', 'dm-focus__time dm-focus__time--running' );
		container.appendChild( timeEl );

		subEl = el( 'div', 'dm-focus__sub' );
		container.appendChild( subEl );

		const actions = el( 'div', 'dm-focus__actions' );
		const pause = button( 'dm-focus__btn', __( 'Pause', 'desktop-mode' ) );
		pause.addEventListener( 'click', () => timer.pause() );
		const reset = button( 'dm-focus__btn', __( 'Reset', 'desktop-mode' ) );
		reset.addEventListener( 'click', () => timer.reset() );
		actions.append( pause, reset );
		container.appendChild( actions );
	}

	function buildFinished(): void {
		container.replaceChildren();
		windowSelect = null;
		timeEl = null;

		container.appendChild( el( 'div', 'dm-focus__bell', '⏰' ) );
		container.appendChild(
			el( 'div', 'dm-focus__done', __( 'Time’s up!', 'desktop-mode' ) ),
		);
		subEl = el( 'div', 'dm-focus__sub' );
		container.appendChild( subEl );

		const stop = button(
			'dm-focus__btn is-primary dm-focus__btn--stop',
			__( 'Stop alarm', 'desktop-mode' ),
		);
		stop.addEventListener( 'click', () => timer.dismiss() );
		const actions = el( 'div', 'dm-focus__actions' );
		actions.appendChild( stop );
		container.appendChild( actions );
	}

	// --- Dynamic paint (runs every tick, no DOM rebuild) ---------------

	function linkedTitle( s: TimerSnapshot ): string {
		if ( ! s.linkedWindowId ) {
			return '';
		}
		return getWindow( s.linkedWindowId )?.config.title || '';
	}

	function paint(): void {
		const s = timer.snapshot();

		if ( timeEl && s.phase === 'running' ) {
			if ( s.showRemaining ) {
				timeEl.textContent = fmt( s.remainingMs );
				timeEl.classList.remove( 'is-hidden' );
			} else {
				timeEl.textContent = __( 'Focusing…', 'desktop-mode' );
				timeEl.classList.add( 'is-hidden' );
			}
		} else if ( timeEl ) {
			timeEl.textContent = fmt( s.remainingMs );
		}

		if ( subEl ) {
			const title = linkedTitle( s );
			if ( s.phase === 'running' ) {
				/* translators: %s: window title. */
				const linked = __( 'Linked to “%s”', 'desktop-mode' );
				subEl.textContent = title
					? sprintf( linked, title )
					: __( 'No window linked', 'desktop-mode' );
			} else if ( s.phase === 'finished' ) {
				/* translators: %s: window title. */
				const shaking = __( 'Shaking “%s”', 'desktop-mode' );
				subEl.textContent = title
					? sprintf( shaking, title )
					: __( 'Press stop to silence.', 'desktop-mode' );
			}
		}
	}

	function render(): void {
		const s = timer.snapshot();
		const layoutPhase: Phase = s.phase === 'paused' ? 'idle' : s.phase;

		if ( layoutPhase !== renderedPhase ) {
			if ( layoutPhase === 'running' ) {
				buildRunning();
			} else if ( layoutPhase === 'finished' ) {
				buildFinished();
			} else {
				buildSetup( s );
			}
			renderedPhase = layoutPhase;
		}

		container.classList.toggle( 'is-running', s.phase === 'running' );
		container.classList.toggle( 'is-finished', s.phase === 'finished' );
		paint();
	}

	const unsubscribe = timer.subscribe( render );

	// Refresh the window picker as windows come and go (setup view only).
	const onWindowsChanged = (): void => {
		if ( renderedPhase === 'idle' ) {
			refreshWindowOptions();
		}
	};
	document.addEventListener(
		'desktop-mode-window-opened',
		onWindowsChanged,
	);
	document.addEventListener(
		'desktop-mode-window-closed',
		onWindowsChanged,
	);

	render();

	return () => {
		unsubscribe();
		document.removeEventListener(
			'desktop-mode-window-opened',
			onWindowsChanged,
		);
		document.removeEventListener(
			'desktop-mode-window-closed',
			onWindowsChanged,
		);
	};
};

const w = window as unknown as {
	desktopModeWidgets?: Record< string, typeof mount >;
};
w.desktopModeWidgets = w.desktopModeWidgets ?? {};
w.desktopModeWidgets[ WIDGET_ID ] = mount;
