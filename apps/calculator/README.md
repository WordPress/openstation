# Calculator

A basic native OpenStation app with a dock launcher and desktop shortcut. It uses the shared app runtime, `<os-button>` keypad and `<os-display>` readout. Calculations run locally in each window; the app requires the WordPress `read` capability and is available in site and network admin.

The keypad supports addition, subtraction, multiplication, division, decimals, sign change, percentages, clear and backspace. Operations execute from left to right, and pressing equals again repeats the last operation. Input is limited to 12 digits; results are rounded to 12 significant digits. Division by zero and numeric overflow show Error; clear or enter a number to recover.

For addition and subtraction, percent uses the first operand: `200 + 10 % = 220`. For multiplication, division or a standalone value, percent divides the displayed number by 100.

With focus inside the calculator, type digits and `+`, `-`, `*`, `/`, `%` or a decimal point. Enter or `=` evaluates; Backspace deletes a digit; Escape or Delete clears. A comma also enters a decimal point. Tab navigates the buttons, and Enter or Space activates the focused button. Keyboard shortcuts in other windows keep their own behavior.

The app definition is in `calculator.os.php`, local actions and the view in `calculator.os.ts`, and layout in `calculator.css`. Build with `npm run build`; run the focused JavaScript checks with `npm run test:js -- apps/calculator/calculator.test.ts`.
