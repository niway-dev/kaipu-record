/**
 * Carries an email from the sign-in form to the sign-up form across one client-side navigation
 * ("New to Kaipu? Create an account with this email"). It is module state, not the URL, so the
 * address never lands in the address bar, the history or a server log. It is read once: a later
 * visit to the sign-up page starts empty.
 */
let pending: string | null = null;

export function setPrefillEmail(email: string): void {
  pending = email;
}

export function takePrefillEmail(): string | null {
  const email = pending;
  pending = null;
  return email;
}
