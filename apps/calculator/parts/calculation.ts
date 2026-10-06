export interface CalculatorState extends Record< string, unknown > {
	display: string;
	accumulator: string;
	operator: string;
	fresh: boolean;
	repeatOperator: string;
	repeatOperand: string;
	expression: string;
	error: boolean;
}

export const initialState = (): CalculatorState => ( {
	display: '0',
	accumulator: '',
	operator: '',
	fresh: true,
	repeatOperator: '',
	repeatOperand: '',
	expression: '',
	error: false,
} );

const symbols: Record< string, string > = { '+': '+', '-': '−', '*': '×', '/': '÷' };

function format( value: number ): string {
	return String( Number( value.toPrecision( 12 ) ) );
}

function calculate( left: number, right: number, operator: string ): number {
	switch ( operator ) {
		case '+': return left + right;
		case '-': return left - right;
		case '*': return left * right;
		case '/': return right === 0 ? NaN : left / right;
		default: return right;
	}
}

function result( state: CalculatorState, value: number ): CalculatorState {
	return Number.isFinite( value )
		? { ...state, display: format( value ) }
		: { ...initialState(), error: true };
}

function expression( state: CalculatorState ): string {
	return state.operator
		? `${ state.accumulator } ${ symbols[ state.operator ] } ${ state.display }`
		: '';
}

export function press( previous: CalculatorState, key: string ): CalculatorState {
	let state = { ...previous };
	if ( key === 'clear' ) {
		return initialState();
	}
	if ( state.error ) {
		if ( ! /^\d$/.test( key ) && key !== '.' ) {
			return state;
		}
		state = initialState();
	}
	if ( /^\d$/.test( key ) || key === '.' ) {
		if ( state.fresh || state.display.includes( 'e' ) ) {
			state.display = '0';
		}
		if ( key === '.' ) {
			if ( ! state.display.includes( '.' ) ) {
				state.display += '.';
			}
		} else if ( state.display.replace( /\D/g, '' ).length < 12 ) {
			state.display = state.display === '0' || state.display === '-0'
				? `${ state.display.startsWith( '-' ) ? '-' : '' }${ key }`
				: state.display + key;
		}
		state.fresh = false;
		state.repeatOperator = '';
		state.repeatOperand = '';
		state.expression = expression( state );
		return state;
	}
	if ( key === 'backspace' ) {
		if ( state.fresh || state.display.includes( 'e' ) ) {
			return state;
		}
		state.display = state.display.slice( 0, -1 );
		if ( state.display === '' || state.display === '-' ) {
			state.display = '0';
		}
		state.expression = expression( state );
		return state;
	}
	if ( key === 'sign' || key === '%' ) {
		if ( state.fresh && state.operator && key === 'sign' ) {
			state.display = '-0';
		} else if ( key === 'sign' ) {
			state.display = state.display.startsWith( '-' )
				? state.display.slice( 1 ) : `-${ state.display }`;
		} else {
			const base = state.operator === '+' || state.operator === '-'
				? Number( state.accumulator ) : 1;
			state = result( state, base * Number( state.display ) / 100 );
		}
		state.fresh = false;
		state.repeatOperator = '';
		state.repeatOperand = '';
		state.expression = expression( state );
		return state;
	}
	if ( Object.prototype.hasOwnProperty.call( symbols, key ) ) {
		if ( state.operator && ! state.fresh ) {
			state = result( state, calculate( Number( state.accumulator ), Number( state.display ), state.operator ) );
			if ( state.error ) {
				return state;
			}
		}
		state.accumulator = state.display;
		state.operator = key;
		state.fresh = true;
		state.repeatOperator = '';
		state.repeatOperand = '';
		state.expression = `${ state.display } ${ symbols[ key ] }`;
		return state;
	}
	if ( key === '=' ) {
		const operator = state.operator || state.repeatOperator;
		if ( ! operator ) {
			return state;
		}
		const left = state.operator ? state.accumulator : state.display;
		const right = state.operator ? state.display : state.repeatOperand;
		state = result( state, calculate( Number( left ), Number( right ), operator ) );
		if ( state.error ) {
			return state;
		}
		state.expression = `${ left } ${ symbols[ operator ] } ${ right } =`;
		state.accumulator = '';
		state.operator = '';
		state.repeatOperator = operator;
		state.repeatOperand = right;
		state.fresh = true;
	}
	return state;
}

export function keyFromEvent( event: KeyboardEvent ): string | null {
	if ( event.ctrlKey || event.metaKey || event.altKey || event.isComposing ) {
		return null;
	}
	if ( /^\d$/.test( event.key ) || [ '.', '+', '-', '*', '/', '%', '=' ].includes( event.key ) ) {
		return event.key;
	}
	const aliases: Record< string, string > = {
		Enter: '=', Backspace: 'backspace', Delete: 'clear', c: 'clear', C: 'clear',
	};
	return aliases[ event.key ] ?? null;
}
