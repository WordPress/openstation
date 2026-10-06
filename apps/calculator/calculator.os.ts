import { defineApp, html, __ } from '@openstation/app';
import { keyboardKey, press, type CalculatorState } from './parts/arithmetic';

export default defineApp< CalculatorState, unknown >( 'openstation-calculator', {
	local: {
		press: ( state, args ) => press( state, String( args.key ?? '' ) ),
	},
	view: ( { state } ) => {
		const keys = [
			[ 'clear', 'AC', __( 'Clear all' ), 'secondary' ],
			[ 'sign', '±', __( 'Change sign' ), 'secondary' ],
			[ 'percent', '%', __( 'Percent' ), 'secondary' ],
			[ '/', '÷', __( 'Divide' ), 'secondary' ],
			[ '7', '7', '7', 'ghost' ], [ '8', '8', '8', 'ghost' ], [ '9', '9', '9', 'ghost' ],
			[ '*', '×', __( 'Multiply' ), 'secondary' ],
			[ '4', '4', '4', 'ghost' ], [ '5', '5', '5', 'ghost' ], [ '6', '6', '6', 'ghost' ],
			[ '-', '−', __( 'Subtract' ), 'secondary' ],
			[ '1', '1', '1', 'ghost' ], [ '2', '2', '2', 'ghost' ], [ '3', '3', '3', 'ghost' ],
			[ '+', '+', __( 'Add' ), 'secondary' ],
			[ 'backspace', '⌫', __( 'Delete last digit' ), 'secondary' ],
			[ '0', '0', '0', 'ghost' ], [ '.', '.', __( 'Decimal point' ), 'ghost' ],
			[ '=', '=', __( 'Equals' ), 'primary' ],
		];
		return html`
			<section class="os-calculator" tabindex="0" aria-label=${ __( 'Calculator' ) }>
				<div class="os-calculator__display" dir="ltr">
					<div class="os-calculator__expression">${ state.expression || '\u00a0' }</div>
					<output class="os-calculator__result" aria-label=${ __( 'Result' ) } aria-live="polite" aria-atomic="true"
						data-long=${ state.display.length > 10 ? 'true' : 'false' }>${ state.error ? __( 'Error' ) : state.display }</output>
				</div>
				<div class="os-calculator__keys" role="group" aria-label=${ __( 'Calculator keypad' ) }>
					${ keys.map( ( [ key, label, name, variant ] ) => html`
						<os-button fill-cell variant=${ variant } os-key=${ key } os-action="press" os-arg-key=${ key }
							aria-label=${ name } class=${ state.operator === key ? 'os-calculator__key os-calculator__key--selected' : 'os-calculator__key' }>${ label }</os-button>
					` ) }
				</div>
			</section>
		`;
	},
	mounted: ( ctx ) => {
		const onKey = ( event: KeyboardEvent ) => {
			const key = keyboardKey( event );
			if ( key === null || event.defaultPrevented ) {
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
