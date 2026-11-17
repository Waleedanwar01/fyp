/** Test-mode card checks for the built-in payment simulator (used while no
 * Stripe keys are configured). Behaves like Stripe's test mode: real card
 * rules (Luhn, expiry, CVC), Stripe's documented test numbers succeed or
 * decline the way Stripe would, and no real card is ever charged. */

export const TEST_CARD = { number: "4242 4242 4242 4242", expiry: "12/30", cvc: "123" };

/** Stripe's test numbers that must fail, with Stripe's own decline messages. */
const DECLINED: Record<string, string> = {
  "4000000000000002": "Your card was declined.",
  "4000000000009995": "Your card has insufficient funds.",
  "4000000000009987": "Your card was declined (lost card).",
  "4000000000009979": "Your card was declined (stolen card).",
  "4000000000000069": "Your card has expired.",
  "4000000000000127": "Your card's security code is incorrect.",
  "4000000000000119": "An error occurred while processing your card. Try again.",
};

/** "4242424242424242" -> "4242 4242 4242 4242" while typing. */
export function formatCardNumber(value: string) {
  return value
    .replace(/\D/g, "")
    .slice(0, 19)
    .replace(/(\d{4})(?=\d)/g, "$1 ");
}

/** "1230" -> "12/30" while typing. */
export function formatExpiry(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
}

function luhnValid(digits: string) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** null when the card would be accepted, otherwise the error to show. */
export function validateTestCard(number: string, expiry: string, cvc: string): string | null {
  const digits = number.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19 || !luhnValid(digits)) {
    return "Your card number is invalid. Use the test card 4242 4242 4242 4242.";
  }
  if (DECLINED[digits]) return DECLINED[digits];

  const m = expiry.match(/^(\d{2})\s*\/\s*(\d{2})$/);
  if (!m) return "Enter the expiry date as MM/YY.";
  const month = Number(m[1]);
  const year = 2000 + Number(m[2]);
  if (month < 1 || month > 12) return "Your card's expiration month is invalid.";
  const now = new Date();
  if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)) {
    return "Your card's expiration date is in the past.";
  }

  if (!/^\d{3,4}$/.test(cvc.trim())) return "Your card's security code is invalid.";
  return null;
}

/** Display-safe details sent to the server -- never the full number or CVC. */
export function cardSummary(number: string, expiry: string) {
  const digits = number.replace(/\D/g, "");
  const brand = /^4/.test(digits)
    ? "visa"
    : /^(5[1-5]|2[2-7])/.test(digits)
      ? "mastercard"
      : /^3[47]/.test(digits)
        ? "amex"
        : /^6/.test(digits)
          ? "discover"
          : "card";
  const [mm, yy] = expiry.split("/").map((v) => Number(v.trim()));
  return { card_brand: brand, card_last4: digits.slice(-4), card_exp_month: mm || null, card_exp_year: yy ? 2000 + yy : null };
}
