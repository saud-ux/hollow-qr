import { westernDigits } from "../../shared/format";

const EASTERN_DIGIT = /[٠-٩۰-۹]/;

/**
 * Every number typed in the app is written with Western digits: a digit typed
 * on the Arabic keyboard turns into its Western twin as it is typed, in every
 * text box but passwords (a password stays exactly as it was set).
 *
 * The value is written through the prototype's setter, so React still sees the
 * change and its onChange gets the converted text.
 */
export function installWesternDigits(doc: Document = document): void {
  doc.addEventListener(
    "input",
    (e) => {
      const el = e.target;
      const isInput = el instanceof HTMLInputElement;
      if (!isInput && !(el instanceof HTMLTextAreaElement)) return;
      if (isInput && el.type === "password") return;
      if (e.isComposing || !EASTERN_DIGIT.test(el.value)) return;
      const { selectionStart, selectionEnd } = el;
      const proto = isInput ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, westernDigits(el.value));
      try {
        // One digit for one digit: the caret stays where it was.
        el.setSelectionRange(selectionStart, selectionEnd);
      } catch {
        // Some input types (email, number) have no caret to restore.
      }
    },
    true,
  );
}
