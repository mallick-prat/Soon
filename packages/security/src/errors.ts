/** base class for all typed security errors */
export class SecurityError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** the encrypted payload string is not in the expected v{n}.{iv}.{ct}.{tag} shape */
export class MalformedPayloadError extends SecurityError {
  constructor(message = "encrypted payload is malformed") {
    super(message, "malformed_payload");
  }
}

/** no key registered for the version embedded in the payload */
export class UnknownKeyVersionError extends SecurityError {
  constructor(public readonly keyVersion: number) {
    super(`no key registered for version ${keyVersion}`, "unknown_key_version");
  }
}

/** wrong key or tampered ciphertext/tag — gcm auth failed */
export class DecryptionFailedError extends SecurityError {
  constructor(message = "decryption failed: wrong key or tampered data") {
    super(message, "decryption_failed");
  }
}

/** device jwt could not be verified (bad signature, expired, malformed) */
export class JwtVerificationError extends SecurityError {
  constructor(
    message: string,
    public readonly reason: "expired" | "invalid_signature" | "malformed" | "missing_claims",
  ) {
    super(message, "jwt_verification_failed");
  }
}

/** command hmac signature did not match */
export class SignatureVerificationError extends SecurityError {
  constructor(message = "command signature verification failed") {
    super(message, "signature_verification_failed");
  }
}

/** environment validation failed — message lists variable names only, never values */
export class EnvValidationError extends SecurityError {
  constructor(
    message: string,
    public readonly variables: readonly string[],
  ) {
    super(message, "env_validation_failed");
  }
}
