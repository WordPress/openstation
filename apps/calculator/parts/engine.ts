export type Operator = '+' | '-' | '*' | '/';

export interface CalculatorState extends Record< string, unknown > {
	display: string;
	accumulator: string;
	operator: string;
	fresh: boolean;
	lastOperator: string;
	lastOperand: string;
	expression: string;
	error: boolean;
}

export function initialState(): CalculatorState {
	return {
		display: '0', accumulator: '', operator: '', fresh: true,
		lastOperator: '', lastOperand: '', expression: '', error: false,
	};
}

const symbols: Record< Operator, string > = { '+': '+', '-': '−', '*': '×', '/': '÷' };
const isOperator = ( key: string ): key is Operator => Object.prototype.hasOwnProperty.call( symbols, key );
const format = ( value: number ): string => String( Number( value.toPrecision( 12 ) ) );

function calculate( left: number, right: number, operator: Operator ): number {
	switch ( operator ) {
		case '+': return left + right;
		case '-': return left - right;
		case '*': return left * right;
		case '/': return right === 0 ? NaN : left / right;
	}
}

function result( state: CalculatorState, value: number ): CalculatorState {
	if ( ! Number.isFinite( value ) ) {
		return { ...initialState(), error: true };
	}
	return { ...state, display: format( value ), fresh: true, error: false };
}

export function pressKey( previous: CalculatorState, key: string ): CalculatorState {
	let state = { ...previous };
	if ( key === 'clear' ) {
		return initialState();
	}
	if ( /^\d$/.test( key ) || key === '.' ) {
		if ( state.error ) {
			state = initialState();
		}
		if ( state.fresh || state.display.includes( 'e' ) ) {
			state.display = key === '.' ? '0.' : key;
			state.fresh = false;
			state.lastOperator = '';
			state.lastOperand = '';
			if ( state.operator === '' ) {
				state.expression = '';
			}
		} else if ( key === '.' ) {
			if ( ! state.display.includes( '.' ) && ! state.display.includes( 'e' ) ) {
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
		return state;
	}
	if ( state.error ) {
		return state;
	}
	if ( key === 'backspace' ) {
		if ( ! state.fresh && ! state.display.includes( 'e' ) ) {
			state.display = state.display.slice( 0, -1 );
			if ( state.display === '' || state.display === '-' ) {
				state.display = '0';
			}
		}
		return state;
	}
	if ( key === 'sign' || key === '%' ) {
		const value = Number( state.display );
		if ( key === 'sign' ) {
			state.display = state.display.startsWith( '-' ) ? state.display.slice( 1 ) : `-${ state.display }`;
			state.fresh = state.fresh && state.display !== '-0' && state.operator === '';
		} else {
			const relative = state.operator === '+' || state.operator === '-';
			state = result( state, relative ? Number( state.accumulator ) * value / 100 : value / 100 );
			state.fresh = state.operator === '';
		}
		state.lastOperator = '';
		state.lastOperand = '';
		if ( state.operator === '' ) {
			state.expression = '';
		}
		return state;
	}
	if ( isOperator( key ) ) {
		if ( isOperator( state.operator ) && ! state.fresh ) {
			state = result( state, calculate( Number( state.accumulator ), Number( state.display ), state.operator ) );
			if ( state.error ) {
				return state;
			}
		}
		state.accumulator = state.display;
		state.operator = key;
		state.expression = `${ state.display } ${ symbols[ key ] }`;
		state.fresh = true;
		state.lastOperator = '';
		state.lastOperand = '';
		return state;
	}
	if ( key === '=' ) {
		const operator = state.operator || state.lastOperator;
		if ( ! isOperator( operator ) ) {
			return state;
		}
		const left = state.operator ? state.accumulator : state.display;
		const right = state.operator ? state.display : state.lastOperand;
		state = result( state, calculate( Number( left ), Number( right ), operator ) );
		if ( state.error ) {
			return state;
		}
		state.expression = `${ left } ${ symbols[ operator ] } ${ right } =`;
		state.operator = '';
		state.accumulator = '';
		state.lastOperator = operator;
		state.lastOperand = right;
	}
	return state;
}

export function keyboardKey( key: string ): string | null {
	if ( /^\d$/.test( key ) || isOperator( key ) || key === '%' || key === '=' ) {
		return key;
	}
	const keys: Record< string, string > = {
		'.': '.', ',': '.', Enter: '=', Escape: 'clear', Delete: 'clear', Backspace: 'backspace',
	};
	return keys[ key ] ?? null;
}
