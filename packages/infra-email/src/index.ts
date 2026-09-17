export { EmailService } from "./email-service";
export type { EmailMessage, IEmailProvider } from "./providers/email-provider.interface";
export { ResendEmailProvider } from "./providers/resend.provider";
export type { EmailLocale } from "./templates/i18n";
export { EMAIL_TEMPLATE_VALUES, EmailTemplateMap } from "./templates/index";
export type { EmailTemplate, TemplateDataMap } from "./templates/types";
