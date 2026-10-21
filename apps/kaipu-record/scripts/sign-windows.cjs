/**
 * Windows code-signing hook, loaded by electron-builder through
 * `win.signtoolOptions.sign` (see electron-builder.yml). electron-builder calls
 * it once per file and per hash algorithm, so it must be cheap and idempotent.
 *
 * Contract:
 *  - No WIN_SIGN_VENDOR and no other signing variable: do nothing and warn once
 *    per process. The build ships unsigned, visibly.
 *  - No WIN_SIGN_VENDOR but another signing variable set: throw, naming the
 *    variables (never their values). Secrets exist, so an unsigned release would
 *    be a mistake — most likely a forgotten WIN_SIGN_VENDOR (spec, Failure 4).
 *  - WIN_SIGN_VENDOR set to a vendor this script does not implement: throw. A
 *    release must never ship unsigned while a vendor is configured.
 *  - Any signing error propagates. Nothing is swallowed.
 *
 * Vendors are a seam, not an integration: no vendor has been bought yet, so
 * `azure` and `sslcom` validate their inputs and then fail with the next step.
 * Replace the body of a vendor entry to wire a real one.
 *
 * GitHub resolves an absent secret to "", so "" counts as unset everywhere.
 * Only the variables in SIGNING_ENV_KEYS count — not every WIN_SIGN_* / AZURE_*
 * name: hosted Windows runners set unrelated AZURE_* variables of their own
 * (e.g. AZURE_EXTENSION_DIR), which must not fail an unsigned build.
 */

const UNSIGNED_WARNING = "::warning::Windows build is unsigned — no WIN_SIGN_VENDOR configured";

const SIGNING_ENV_KEYS = [
  "WIN_SIGN_VENDOR",
  "WIN_SIGN_PUBLISHER_NAME",
  "WIN_SIGN_ENDPOINT",
  "WIN_SIGN_CERTIFICATE_PROFILE",
  "WIN_SIGN_ACCOUNT_NAME",
  "AZURE_TENANT_ID",
  "AZURE_CLIENT_ID",
  "AZURE_CLIENT_SECRET",
];

/** Reads the signing inputs; empty strings are dropped so "" behaves as unset. */
function readSigningEnv(env = process.env) {
  const values = {};
  for (const key of SIGNING_ENV_KEYS) {
    const value = env[key];
    if (typeof value === "string" && value.trim() !== "") values[key] = value.trim();
  }
  return values;
}

function requireVars(vendor, values, keys) {
  const missing = keys.filter((key) => values[key] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `WIN_SIGN_VENDOR=${vendor} requires these variables, missing: ${missing.join(", ")}`,
    );
  }
}

const VENDORS = {
  azure(values) {
    requireVars("azure", values, [
      "AZURE_TENANT_ID",
      "AZURE_CLIENT_ID",
      "AZURE_CLIENT_SECRET",
      "WIN_SIGN_PUBLISHER_NAME",
      "WIN_SIGN_ENDPOINT",
      "WIN_SIGN_CERTIFICATE_PROFILE",
      "WIN_SIGN_ACCOUNT_NAME",
    ]);
    throw new Error(
      "WIN_SIGN_VENDOR=azure is not implemented in this hook. Set win.azureSignOptions " +
        "in electron-builder.yml (publisherName, endpoint, certificateProfileName, " +
        "codeSigningAccountName) and remove win.signtoolOptions.sign; electron-builder " +
        "signs with the AZURE_* credentials itself. This hook handles custom vendors.",
    );
  },
  sslcom() {
    throw new Error(
      "WIN_SIGN_VENDOR=sslcom is not implemented in this hook. It would drive SSL.com " +
        "eSigner CodeSignTool with WIN_SIGN_USERNAME, WIN_SIGN_PASSWORD, " +
        "WIN_SIGN_CREDENTIAL_ID and WIN_SIGN_TOTP_SECRET; implement it here and pass " +
        "those secrets in the build-win job.",
    );
  },
};

let warnedUnsigned = false;

/** Core of the hook; `configuration.path` is the file to sign. `env` is injectable for tests. */
async function signWithEnv(configuration, env) {
  const values = readSigningEnv(env);
  const vendor = values.WIN_SIGN_VENDOR;

  if (vendor === undefined) {
    const stray = Object.keys(values);
    if (stray.length > 0) {
      throw new Error(
        `Signing variables are set (${stray.join(", ")}) but WIN_SIGN_VENDOR is empty. ` +
          "Refusing to build an unsigned release while signing secrets exist: set " +
          "WIN_SIGN_VENDOR, or remove these variables to ship unsigned on purpose.",
      );
    }
    if (!warnedUnsigned) {
      warnedUnsigned = true;
      console.warn(UNSIGNED_WARNING);
    }
    return;
  }

  const handler = Object.hasOwn(VENDORS, vendor) ? VENDORS[vendor] : undefined;
  if (handler === undefined) {
    throw new Error(
      `Unknown WIN_SIGN_VENDOR "${vendor}". Supported: ${Object.keys(VENDORS).join(", ")}. ` +
        "Refusing to build an unsigned release while a vendor is configured.",
    );
  }
  await handler(values, configuration);
}

// electron-builder calls `sign(configuration, packager)`: the second argument is
// not an env, so the exported entry point must never take one.
module.exports = (configuration) => signWithEnv(configuration, process.env);
module.exports.signWithEnv = signWithEnv;
module.exports.readSigningEnv = readSigningEnv;
