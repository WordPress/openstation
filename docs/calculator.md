# Calculator

Calculator is a basic native OpenStation app with a large four-column keypad. Open it from the dock or the Calculator desktop shortcut. It is available in site and network admin to signed-in users with the `read` capability.

It supports addition, subtraction, multiplication, division, decimals, percentages, sign changes, deleting the last digit, and clearing the calculation. Operations run from left to right: `2 + 3 × 4 =` gives `20`. Pressing equals again repeats the last operation. Selecting another operator before entering the next number replaces the pending operator.

For addition and subtraction, percent uses the first operand: `200 + 10 % =` gives `220`. For multiplication, division, and a standalone number, percent divides the displayed number by 100. Division by zero displays Error; entering a number or pressing AC starts again. Entry is limited to 12 digits and results use 12 significant digits.

Type numbers and `+`, `-`, `*`, `/`, `.`, `%`, or `=` while the calculator has focus. Enter calculates when the calculator surface is focused; when a keypad button has focus, Enter activates that button. Backspace deletes the last digit during entry. Delete or C clears everything. Tab moves through the keypad. Operating-system shortcuts and Escape keep their normal behavior.

The implementation lives in `apps/calculator/`: the `.os.php` declares the window, launcher, access gate, and state schema; the `.os.ts` paints the `<os-button>`, `<os-grid>`, and `<os-display>` components and runs local actions. Calculation state belongs to the individual mounted app and is not stored between closed windows. The existing app framework builds, registers, and loads the app automatically, with no additional REST routes or shell APIs.
