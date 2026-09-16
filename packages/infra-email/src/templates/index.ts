import { ExpansionApprovedEmail } from "./expansion-approved";
import { emailT } from "./i18n";
import { ResetPasswordEmail } from "./reset-password";
import { EMAIL_TEMPLATE_VALUES, type EmailTemplate, type TemplateDataMap } from "./types";
import { VerifyEmail } from "./verify-email";

export const EmailTemplateMap: {
  [K in EmailTemplate]: {
    subject: (data: TemplateDataMap[K]) => string;
    component: (data: TemplateDataMap[K]) => React.JSX.Element;
  };
} = {
  [EMAIL_TEMPLATE_VALUES.VERIFY_EMAIL]: {
    subject: (d) => emailT(d.locale)("verifySubject"),
    component: VerifyEmail,
  },
  [EMAIL_TEMPLATE_VALUES.RESET_PASSWORD]: {
    subject: (d) => emailT(d.locale)("resetSubject"),
    component: ResetPasswordEmail,
  },
  [EMAIL_TEMPLATE_VALUES.EXPANSION_APPROVED]: {
    subject: (d) => emailT(d.locale)("approvedSubject", { capacity: d.capacityLabel }),
    component: ExpansionApprovedEmail,
  },
};

export { EMAIL_TEMPLATE_VALUES };
export type { EmailTemplate, TemplateDataMap };
