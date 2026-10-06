import { __, defineApp, html } from '@openstation/app';
import { keyboardKey, pressKey, type CalculatorState } from './parts/engine';

export default defineApp< CalculatorState, unknown >( 'openstation-calculator', {
	local: {
		press: ( state, args ) => pressKey( state, String( args.key ?? '' ) ),
	},
	view: ( { state } ) => {
		const keys = [
			{ key: 'clear', text: 'AC', label: __( 'Clear all' ), variant: 'secondary' },
			{ key: 'sign', text: '±', label: __( 'Change sign' ), variant: 'secondary' },
			{ key: '%', text: '%', label: __( 'Percent' ), variant: 'secondary' },
			{ key: '/', text: '÷', label: __( 'Divide' ), variant: 'primary' },
			{ key: '7', text: '7' }, { key: '8', text: '8' }, { key: '9', text: '9' },
			{ key: '*', text: '×', label: __( 'Multiply' ), variant: 'primary' },
			{ key: '4', text: '4' }, { key: '5', text: '5' }, { key: '6', text: '6' },
			{ key: '-', text: '−', label: __( 'Subtract' ), variant: 'primary' },
			{ key: '1', text: '1' }, { key: '2', text: '2' }, { key: '3', text: '3' },
			{ key: '+', text: '+', label: __( 'Add' ), variant: 'primary' },
			{ key: 'backspace', text: '⌫', label: __( 'Delete last digit' ), variant: 'secondary' },
			{ key: '0', text: '0' },
			{ key: '.', text: '.', label: __( 'Decimal point' ) },
			{ key: '=', text: '=', label: __( 'Equals' ), variant: 'holo' },
		];
		const display = state.error ? __( 'Error' ) : state.display;
		return html`
			<section class="os-calculator" tabindex="0" aria-label=${ __( 'Calculator' ) }>
				<div class="os-calculator__screen" dir="ltr">
					<div class="os-calculator__expression">${ state.error ? __( 'Cannot divide by zero or display this result.' ) : state.expression }</div>
					<output class="os-calculator__result" data-length=${ display.length > 9 ? 'long' : 'short' } aria-live="polite" aria-atomic="true" aria-label=${ __( 'Result' ) }>${ display }</output>
				</div>
				<div class="os-calculator__keys" dir="ltr">
					${ keys.map( ( key ) => html`
						<os-button fill-cell variant=${ key.variant ?? 'ghost' } os-key=${ key.key }
							os-action="press" os-arg-key=${ key.key } aria-label=${ key.label ?? key.text }
							data-pending=${ state.operator === key.key ? 'true' : 'false' }>${ key.text }</os-button>
					` ) }
				</div>
			</section>
		`;
	},
	mounted: ( ctx ) => {
		const onKey = ( event: KeyboardEvent ) => {
			if ( event.ctrlKey || event.metaKey || event.altKey || event.isComposing || event.defaultPrevented ) {
				return;
			}
			const target = event.composedPath()[ 0 ];
			if ( target instanceof HTMLElement && ( target.isContentEditable || target.matches( 'input, textarea, select' ) || ( event.key === 'Enter' && target.matches( 'button' ) ) ) ) {
				return;
			}
			const key = keyboardKey( event.key );
			if ( key === null ) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			ctx.local( 'press', { key } );
		};
		ctx.root.addEventListener( 'keydown', onKey );
		return () => ctx.root.removeEventListener( 'keydown', onKey );
	},
} );
