import type { ExpansionApprovedData } from "./expansion-approved";
import type { ResetPasswordData } from "./reset-password";
import type { VerifyEmailData } from "./verify-email";

export const EMAIL_TEMPLATE_VALUES = {
  VERIFY_EMAIL: "VERIFY_EMAIL",
  RESET_PASSWORD: "RESET_PASSWORD",
  EXPANSION_APPROVED: "EXPANSION_APPROVED",
} as const;

export type EmailTemplate = (typeof EMAIL_TEMPLATE_VALUES)[keyof typeof EMAIL_TEMPLATE_VALUES];

export type TemplateDataMap = {
  [EMAIL_TEMPLATE_VALUES.VERIFY_EMAIL]: VerifyEmailData;
  [EMAIL_TEMPLATE_VALUES.RESET_PASSWORD]: ResetPasswordData;
  [EMAIL_TEMPLATE_VALUES.EXPANSION_APPROVED]: ExpansionApprovedData;
};
