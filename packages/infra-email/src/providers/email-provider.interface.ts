export interface EmailMessage {
  to: string;
  from: string;
  /** Optional Reply-To; Kaipu uses the Niway public contact for support replies. */
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
}

export interface IEmailProvider {
  send(message: EmailMessage): Promise<void>;
}
