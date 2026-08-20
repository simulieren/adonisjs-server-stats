/**
 * Shared server-side rules for recognising credentials.
 *
 * Both the config inspector and the SQL-binding writer need to answer "does
 * this look like a secret?", and they used to answer it differently — config
 * values were redacted against a real word list while query bindings were only
 * truncated by length. One list, used by both, so the same secret cannot be
 * masked in one view and printed in full in another.
 */

// Custom word boundaries: `\b` does not match between `CLIENT` and `SECRET` in
// `GOOGLE_CLIENT_SECRET`, because `_` is a word character. These treat `_`,
// `.`, and `-` as separators, and also match a bare token on its own. The
// trailing boundary tolerates a plural `s` so `tokens`/`secrets` match too.
// camelCase is handled by normalizing the name BEFORE testing (see
// `splitCamelCase`), not by the boundaries themselves.
const B = '(?:^|[_.\\-])' // boundary before
const A = 's?(?:$|[_.\\-])' // boundary after (optional plural)

/**
 * Insert `_` at lower/digit→UPPER transitions so the separator-based patterns
 * above see camelCase the same way they see snake_case. Without this,
 * `passwordHash` and `clientSecret` — the *normal* shape for AdonisJS config
 * keys and camelCase column strategies — sail past every pattern while their
 * snake_case twins are redacted.
 */
function splitCamelCase(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
}

/**
 * Names that identify a credential — applies to env vars, config keys, and SQL
 * identifiers alike.
 */
export const SECRET_NAME_PATTERNS: RegExp[] = [
  new RegExp(`${B}password${A}`, 'i'),
  new RegExp(`${B}secret${A}`, 'i'),
  new RegExp(`${B}token${A}`, 'i'),
  new RegExp(`${B}credential${A}`, 'i'),
  new RegExp(`${B}private${A}`, 'i'),
  new RegExp(`${B}auth${A}`, 'i'),
  // API keys: `api_key`, `apiKey`, `API_KEY`
  /api[_-]?key/i,
  // `_KEY` at end or `_KEY_` in middle (AWS_ACCESS_KEY_ID, ENCRYPTION_KEY, etc.)
  /[_-]key([_-]|$)/i,
  // ACCESS_KEY pattern (AWS credentials)
  /access[_-]?key/i,
  // Exact match for just "key" (standalone)
  /^key$/i,
  // Connection strings and DSNs
  new RegExp(`${B}dsn${A}`, 'i'),
  /connection[_-]?string/i,
  // Webhook secrets
  /webhook[_-]?secret/i,
  // Signing / encryption
  new RegExp(`${B}signing${A}`, 'i'),
  new RegExp(`${B}encryption${A}`, 'i'),
  // App key / app secret
  /app[_-]key/i,
  // One-time codes and second factors
  new RegExp(`${B}otp${A}`, 'i'),
  new RegExp(`${B}totp${A}`, 'i'),
  new RegExp(`${B}mfa${A}`, 'i'),
  // Password abbreviations
  new RegExp(`${B}passwd${A}`, 'i'),
  new RegExp(`${B}pwd${A}`, 'i'),
  // Card / identity numbers
  new RegExp(`${B}cvv${A}`, 'i'),
  new RegExp(`${B}cvc${A}`, 'i'),
  new RegExp(`${B}pin${A}`, 'i'),
  new RegExp(`${B}ssn${A}`, 'i'),
]

/**
 * Names that matter for env vars and config keys but NOT for SQL identifiers.
 *
 * An `email` env var is usually an SMTP account; an `email` *column* is ordinary
 * application data, and redacting every binding of every query that touches it
 * would make the query pane useless for debugging auth. Same for the service
 * URLs, which are env-shaped names rather than column names.
 */
export const CONFIG_ONLY_NAME_PATTERNS: RegExp[] = [
  new RegExp(`${B}email${A}`, 'i'),
  new RegExp(`${B}smtp${A}`, 'i'),
  /database[_-]?url/i,
  /redis[_-]?url/i,
]

/** Whether a name identifies a credential. */
export function isSecretName(name: string): boolean {
  const normalized = splitCamelCase(name)
  return SECRET_NAME_PATTERNS.some((pattern) => pattern.test(normalized))
}

/** Whether a name is sensitive in a config/env context (credentials plus contact/service names). */
export function isSensitiveConfigName(name: string): boolean {
  if (isSecretName(name)) return true
  const normalized = splitCamelCase(name)
  return CONFIG_ONLY_NAME_PATTERNS.some((pattern) => pattern.test(normalized))
}

/** Identifier-ish tokens in a SQL statement: table names, column names, aliases. */
const SQL_IDENTIFIER_RE = /[A-Za-z_][A-Za-z0-9_$]*/g

/**
 * Whether a SQL statement mentions a credential-shaped identifier.
 *
 * Tokenised first: the name patterns above use `_`/`.`/`-` boundaries, so
 * running them across raw SQL would miss `password` sitting between spaces.
 *
 * Positional bindings cannot be mapped back to specific columns reliably, so a
 * hit means every binding for that statement is redacted. Coarse on purpose —
 * over-redacting one statement's parameters beats storing a password.
 */
export function sqlMentionsSecret(sql: string): boolean {
  for (const match of sql.matchAll(SQL_IDENTIFIER_RE)) {
    if (isSecretName(match[0])) return true
  }
  return false
}

/**
 * Whether a value looks like a credential from its shape alone, independent of
 * any name.
 *
 * Deliberately excludes bare email addresses: they are sensitive as *config*
 * (see {@link CONFIG_ONLY_NAME_PATTERNS}) but are ordinary query parameters.
 */
const CREDENTIAL_VALUE_PATTERNS: RegExp[] = [
  // URL with userinfo — credentials embedded in the URL
  /^[a-z][a-z0-9+.-]*:\/\/[^/]*:[^/]*@/i,
  // bcrypt / argon2 / scrypt password hashes
  /^\$(?:2[aby]|argon2[a-z]*|scrypt|s?crypt)\$/i,
  // JWT
  /^ey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./,
  // Well-known provider key prefixes. Underscores allowed in the tail so
  // `sk_live_…` / `pk_test_…` match (Stripe, GitHub, Slack, AWS).
  /^(?:sk|pk|rk|whsec)_[A-Za-z0-9_]{8,}/,
  /^gh[pousr]_[A-Za-z0-9]{8,}/,
  /^xox[baprs]-[A-Za-z0-9-]{8,}/,
  /^(?:AKIA|ASIA)[A-Z0-9]{12,}$/,
  // Long hex digests — session ids, reset tokens, sha hashes
  /^[0-9a-f]{32,}$/i,
]

/** Minimum length before a base64url-shaped blob is treated as high-entropy. */
const MIN_BLOB_LEN = 40

export function looksLikeCredentialValue(value: string): boolean {
  // Long high-entropy base64url blobs — length-gated, so kept out of the table.
  if (value.length >= MIN_BLOB_LEN && /^[A-Za-z0-9_-]+={0,2}$/.test(value)) return true
  return CREDENTIAL_VALUE_PATTERNS.some((pattern) => pattern.test(value))
}
