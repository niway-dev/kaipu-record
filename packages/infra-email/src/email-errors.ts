import type { EmailTemplate } from "./templates/types";

/**
 * What a failed send is worth knowing, flattened into plain fields so it
 * survives a log transport that keeps only strings.
 */
export interface EmailFailure {
  /** The provider that rejected the message, e.g. `resend`. */
  provider: string;
  /**
   * The provider's own machine-readable code. Resend returns names like
   * `invalid_from_address`, `missing_api_key` and `rate_limit_exceeded`, and
   * that is the field that says whether to fix configuration, credentials or
   * pacing. The human message is prose and cannot be matched on.
   */
  code: string;
  /** The provider's human-readable explanation. */
  detail: string;
  /** The envelope sender — the usual culprit when a domain is unverified. */
  from: string;
  /**
   * The recipient's domain only. Enough to tell "this provider blocks this
   * domain" from "this address is malformed", without writing a user's address
   * into every log line.
   */
  toDomain: string;
  /** Which template was being sent. The provider cannot know it; the service adds it. */
  template?: EmailTemplate;
}

export class EmailSendError extends Error {
  readonly failure: EmailFailure;

  constructor(failure: EmailFailure) {
    super(formatFailure(failure));
    this.name = "EmailSendError";
    this.failure = failure;
  }

  /** Re-stamp with the template once it is known, on the way up the stack. */
  withTemplate(template: EmailTemplate): EmailSendError {
    return new EmailSendError({ ...this.failure, template });
  }
}

function formatFailure(failure: EmailFailure): string {
  const template = failure.template ? ` [${failure.template}]` : "";
  return (
    `${failure.provider} ${failure.code}${template}: ${failure.detail} ` +
    `(from=${failure.from} to=@${failure.toDomain})`
  );
}

/** The domain, or a marker — building a log line must never throw. */
export function recipientDomain(address: string): string {
  const at = address.lastIndexOf("@");
  return at > -1 && at < address.length - 1 ? address.slice(at + 1) : "unknown";
}

/**
 * Describe any thrown value for a log line.
 *
 * `summary` belongs in the log's own message because that is the only part
 * guaranteed to survive. A Cloudflare Workers log of `console.error(msg, err)`
 * rendered `err` as a bare stack and dropped the `Error:` line carrying the
 * cause, so a failing send reported nothing but "failed to send the
 * verification email" plus frame addresses. `fields` is the structured copy,
 * useful where the transport keeps it.
 */
export function describeEmailFailure(err: unknown): {
  summary: string;
  fields: Record<string, unknown>;
} {
  if (err instanceof EmailSendError) {
    return { summary: err.message, fields: { ...err.failure } };
  }
  if (err instanceof Error) {
    return {
      summary: `${err.name}: ${err.message}`,
      fields: { errorName: err.name, detail: err.message },
    };
  }
  return { summary: String(err), fields: { detail: String(err) } };
}
