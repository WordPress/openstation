import { defineApp, html, __ } from '@openstation/app';

export interface CalculatorState extends Record< string, unknown > {
	display: string;
	accumulator: string;
	operator: string;
	replace: boolean;
	waiting: boolean;
	lastOperator: string;
	lastOperand: string;
	expression: string;
	error: boolean;
}

export function initialState(): CalculatorState {
	return {
		display: '0',
		accumulator: '',
		operator: '',
		replace: true,
		waiting: false,
		lastOperator: '',
		lastOperand: '',
		expression: '',
		error: false,
	};
}

const symbols: Record< string, string > = { '+': '+', '-': '−', '*': '×', '/': '÷' };

function format( value: number ): string {
	return String( Number( value.toPrecision( 12 ) ) );
}

function calculate( state: CalculatorState, left: string, operator: string, right: string ): boolean {
	const a = Number( left );
	const b = Number( right );
	let value: number;
	switch ( operator ) {
		case '+': value = a + b; break;
		case '-': value = a - b; break;
		case '*': value = a * b; break;
		case '/': value = a / b; break;
		default: return false;
	}
	if ( ! Number.isFinite( value ) ) {
		Object.assign( state, initialState(), { error: true } );
		return false;
	}
	state.display = format( value );
	return true;
}

export function pressKey( state: CalculatorState, key: string ): void {
	if ( key === 'clear' ) {
		Object.assign( state, initialState() );
		return;
	}
	if ( /^\d$/.test( key ) || key === '.' ) {
		if ( state.error ) {
			Object.assign( state, initialState() );
		}
		if ( state.replace ) {
			state.display = key === '.' ? '0.' : key;
			state.replace = false;
		} else if ( key === '.' ) {
			if ( ! state.display.includes( '.' ) ) {
				state.display += '.';
			}
		} else if ( state.display.replace( /\D/g, '' ).length < 12 ) {
			if ( state.display === '0' ) {
				state.display = key;
			} else if ( state.display === '-0' ) {
				state.display = `-${ key }`;
			} else {
				state.display += key;
			}
		}
		state.lastOperator = '';
		state.lastOperand = '';
		state.waiting = false;
		if ( ! state.operator ) {
			state.expression = '';
		}
		return;
	}
	if ( state.error ) {
		return;
	}
	if ( key === 'backspace' ) {
		if ( state.replace ) {
			return;
		}
		const shortened = state.display.slice( 0, -1 );
		state.display = shortened && shortened !== '-' ? shortened : '0';
		return;
	}
	if ( key === 'sign' ) {
		if ( state.waiting ) {
			state.display = '-0';
			state.replace = false;
		} else {
			state.display = state.display.startsWith( '-' ) ? state.display.slice( 1 ) : `-${ state.display }`;
			if ( Number( state.display ) === 0 ) {
				state.replace = false;
			}
		}
		state.waiting = false;
		state.lastOperator = '';
		state.lastOperand = '';
		if ( ! state.operator ) {
			state.expression = '';
		}
		return;
	}
	if ( key === 'percent' ) {
		const base = state.operator === '+' || state.operator === '-' ? Number( state.accumulator ) : 1;
		const value = base * ( Number( state.display ) / 100 );
		if ( ! Number.isFinite( value ) ) {
			Object.assign( state, initialState(), { error: true } );
			return;
		}
		state.display = format( value );
		state.replace = true;
		state.waiting = false;
		state.lastOperator = '';
		state.lastOperand = '';
		if ( ! state.operator ) {
			state.expression = '';
		}
		return;
	}
	if ( Object.prototype.hasOwnProperty.call( symbols, key ) ) {
		if ( state.operator && ! state.waiting && ! calculate( state, state.accumulator, state.operator, state.display ) ) {
			return;
		}
		state.accumulator = state.display;
		state.operator = key;
		state.replace = true;
		state.waiting = true;
		state.lastOperator = '';
		state.lastOperand = '';
		state.expression = `${ state.display } ${ symbols[ key ] }`;
		return;
	}
	if ( key === '=' ) {
		const operator = state.operator || state.lastOperator;
		if ( ! operator ) {
			return;
		}
		const left = state.operator ? state.accumulator : state.display;
		const right = state.operator ? state.display : state.lastOperand;
		if ( ! calculate( state, left, operator, right ) ) {
			return;
		}
		state.expression = `${ left } ${ symbols[ operator ] } ${ right } =`;
		state.lastOperator = operator;
		state.lastOperand = right;
		state.operator = '';
		state.accumulator = '';
		state.replace = true;
		state.waiting = false;
	}
}

export function keyboardKey( event: KeyboardEvent ): string | null {
	if ( event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.isComposing ) {
		return null;
	}
	if ( event.composedPath().some( ( target ) => target instanceof HTMLElement && (
		target.isContentEditable || target.matches( 'input, textarea, select' ) ||
		( event.key === 'Enter' && target.matches( 'button, os-button' ) )
	) ) ) {
		return null;
	}
	if ( /^[\d.+\-*/=%]$/.test( event.key ) ) {
		return event.key === '%' ? 'percent' : event.key;
	}
	const shortcuts: Record< string, string > = {
		Enter: '=', Escape: 'clear', Delete: 'clear', Backspace: 'backspace', ',': '.',
	};
	return shortcuts[ event.key ] ?? null;
}

export default defineApp< CalculatorState, unknown[] >( 'openstation-calculator', {
	local: {
		press: ( state, args ) => pressKey( state, String( args.key ) ),
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
				<div class="os-calculator__screen">
					<div class="os-calculator__expression" dir="ltr">${ state.expression }</div>
					<os-display class="os-calculator__result" dir="ltr" aria-atomic="true" size="xl"
						style=${ `--_calculator-digits: ${ Math.max( 12, state.display.length ) }` }
						aria-label=${ __( 'Result' ) } value=${ state.error ? __( 'Error' ) : state.display }></os-display>
				</div>
				<div class="os-calculator__keypad" role="group" aria-label=${ __( 'Calculator keypad' ) }>
					${ keys.map( ( [ key, label, name, variant ] ) => html`
						<os-button fill-cell os-key=${ key } variant=${ variant } aria-label=${ name }
							os-action="press" os-arg-key=${ key }>${ label }</os-button>
					` ) }
				</div>
			</section>
		`;
	},
	mounted: ( ctx ) => {
		const onKeyDown = ( event: KeyboardEvent ) => {
			const key = keyboardKey( event );
			if ( key === null ) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			ctx.local( 'press', { key } );
		};
		ctx.root.addEventListener( 'keydown', onKeyDown );
		return () => ctx.root.removeEventListener( 'keydown', onKeyDown );
	},
} );
