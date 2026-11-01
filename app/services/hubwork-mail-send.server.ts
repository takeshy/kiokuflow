/** Compatibility for old Web Builder helpers. Email delivery moved to GemiHub. */
export async function sendHtmlEmail(_client: unknown, _message: { to: string; subject: string; html: string; cc?: string; bcc?: string }): Promise<never> {
  throw new Error("Gmail delivery is no longer available in kiokuflow.");
}
