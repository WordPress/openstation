import { defineApp, html, __ } from '@openstation/app';
import { press, keyFromEvent, type CalculatorState } from './parts/calculation';

const keys = [
	{ key: 'clear', text: 'AC', label: __( 'All clear' ), kind: 'utility' },
	{ key: 'sign', text: '±', label: __( 'Change sign' ), kind: 'utility' },
	{ key: '%', text: '%', label: __( 'Percent' ), kind: 'utility' },
	{ key: '/', text: '÷', label: __( 'Divide' ), kind: 'operator' },
	{ key: '7', text: '7' }, { key: '8', text: '8' }, { key: '9', text: '9' },
	{ key: '*', text: '×', label: __( 'Multiply' ), kind: 'operator' },
	{ key: '4', text: '4' }, { key: '5', text: '5' }, { key: '6', text: '6' },
	{ key: '-', text: '−', label: __( 'Subtract' ), kind: 'operator' },
	{ key: '1', text: '1' }, { key: '2', text: '2' }, { key: '3', text: '3' },
	{ key: '+', text: '+', label: __( 'Add' ), kind: 'operator' },
	{ key: 'backspace', text: '⌫', label: __( 'Delete last digit' ), kind: 'utility' },
	{ key: '0', text: '0' },
	{ key: '.', text: '.', label: __( 'Decimal point' ) },
	{ key: '=', text: '=', label: __( 'Equals' ), kind: 'equals' },
];

export default defineApp< CalculatorState, unknown[] >( 'openstation-calculator', {
	local: {
		press: ( state, args ) => press( state, String( args.key ) ),
	},
	view: ( { state } ) => html`
		<section class="os-calculator" tabindex="0" aria-label=${ __( 'Calculator' ) }>
			<div class="os-calculator__screen">
				<div class="os-calculator__expression" dir="ltr">${ state.expression || '\u00a0' }</div>
				<os-display
					class="os-calculator__display"
					dir="ltr"
					aria-label=${ __( 'Result' ) }
					aria-atomic="true"
					value=${ state.error ? __( 'Error' ) : state.display }
				></os-display>
			</div>
			<os-grid class="os-calculator__keypad" columns="4" rows="5" gap="8" dir="ltr">
				${ keys.map( ( key ) => html`
					<os-button
						os-key=${ key.key }
						os-action="press"
						os-arg-key=${ key.key }
						fill-cell
						class=${ `os-calculator__key os-calculator__key--${ key.kind || 'digit' }` }
						variant=${ key.kind === 'equals' ? 'primary' : 'secondary' }
						aria-label=${ key.label || key.text }
						aria-pressed=${ key.kind === 'operator' ? String( state.operator === key.key ) : null }
					>${ key.text }</os-button>
				` ) }
			</os-grid>
			<p class="os-calculator__hint">${ __( 'Type numbers · Enter to calculate · Delete to clear' ) }</p>
		</section>
	`,
	mounted: ( ctx ) => {
		const onKeyDown = ( event: KeyboardEvent ) => {
			if ( event.key === 'Enter' && event.composedPath().some( ( node ) => node instanceof HTMLButtonElement ) ) {
				return;
			}
			const key = keyFromEvent( event );
			if ( key === null || event.defaultPrevented ) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			ctx.local( 'press', { key } );
		};
		ctx.root.addEventListener( 'keydown', onKeyDown );
		ctx.root.querySelector< HTMLElement >( '.os-calculator' )?.focus( { preventScroll: true } );
		return () => ctx.root.removeEventListener( 'keydown', onKeyDown );
	},
} );
