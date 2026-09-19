export interface EmailMessage {
  to: string;
  from: string;
  /** Optional Reply-To; Kaipu uses the Niway public contact for support replies. */
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailSendResult {
  /**
   * The provider's id for the accepted message, when it returns one. Logging it
   * is what lets "the user says no email arrived" be matched against a row in
   * the provider's dashboard instead of guessed at.
   */
  id?: string;
}

export interface IEmailProvider {
  /** Identifies the provider in failure logs. */
  readonly name: string;
  /** Throws `EmailSendError` on rejection. */
  send(message: EmailMessage): Promise<EmailSendResult>;
}
