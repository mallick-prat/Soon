/**
 * device enrollment client. pairs the mac with the hosted backend and keeps a
 * fresh gateway access token:
 *  - register(code): exchange a dashboard enrollment code for a server device
 *    id + access jwt, presenting a locally-generated ed25519 public key.
 *  - getAccessToken(): return a valid token, refreshing via an ed25519 device
 *    proof when it nears expiry — no dashboard session needed.
 *
 * transport (http) and storage (keypair/token) are injected so the flow is
 * unit-testable without electron, a network, or a real backend.
 */
import { z } from "zod";
import { deviceProofMessage, signDeviceProof } from "@soon/security";

export interface StoredAccessToken {
  token: string;
  /** epoch ms */
  expiresAtMs: number;
}

export interface EnrollmentStore {
  /** generate + persist a device keypair on first call; return the spki public key. */
  ensureDeviceKeypair(): string;
  /** pkcs8 private key pem for signing refresh proofs. throws if absent. */
  privateKeyPem(): string;
  /** server-assigned mac_devices.id, or null when not yet enrolled. */
  serverDeviceId(): string | null;
  /** persist the enrollment result (server device id + first access token). */
  saveEnrollment(serverDeviceId: string, token: StoredAccessToken): void;
  accessToken(): StoredAccessToken | null;
  saveAccessToken(token: StoredAccessToken): void;
}

export interface HttpResponse {
  status: number;
  json: unknown;
}
export type HttpPost = (path: string, body: unknown) => Promise<HttpResponse>;

export class EnrollmentError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "EnrollmentError";
  }
}

export interface DeviceEnrollerOptions {
  store: EnrollmentStore;
  post: HttpPost;
  now?: () => number;
  /** refresh when the token is within this window of expiry (default 24h) */
  refreshSkewMs?: number;
  deviceName?: string;
  appVersion?: string;
}

const DEFAULT_REFRESH_SKEW_MS = 24 * 60 * 60 * 1000;

const registerResponseSchema = z.object({
  device: z.object({ id: z.string() }),
  token: z.string(),
  expiresInSeconds: z.number().positive(),
});
const tokenResponseSchema = z.object({
  token: z.string(),
  expiresInSeconds: z.number().positive(),
});

export class DeviceEnroller {
  private readonly store: EnrollmentStore;
  private readonly post: HttpPost;
  private readonly now: () => number;
  private readonly refreshSkewMs: number;
  private readonly deviceName: string | undefined;
  private readonly appVersion: string | undefined;

  constructor(options: DeviceEnrollerOptions) {
    this.store = options.store;
    this.post = options.post;
    this.now = options.now ?? (() => Date.now());
    this.refreshSkewMs = options.refreshSkewMs ?? DEFAULT_REFRESH_SKEW_MS;
    this.deviceName = options.deviceName;
    this.appVersion = options.appVersion;
  }

  isEnrolled(): boolean {
    return this.store.serverDeviceId() !== null;
  }

  /** pair this mac using a short-lived dashboard enrollment code. */
  async register(enrollmentCode: string): Promise<{ serverDeviceId: string }> {
    const devicePublicKey = this.store.ensureDeviceKeypair();
    const res = await this.post("/api/devices/register", {
      enrollmentToken: enrollmentCode,
      devicePublicKey,
      ...(this.deviceName !== undefined ? { deviceName: this.deviceName } : {}),
      ...(this.appVersion !== undefined ? { appVersion: this.appVersion } : {}),
    });
    if (res.status !== 201) {
      throw new EnrollmentError(`device registration failed (${res.status})`, res.status);
    }
    const body = registerResponseSchema.parse(res.json);
    this.store.saveEnrollment(body.device.id, {
      token: body.token,
      expiresAtMs: this.now() + body.expiresInSeconds * 1000,
    });
    return { serverDeviceId: body.device.id };
  }

  /** a valid gateway access token, refreshed via device proof when near expiry. */
  async getAccessToken(): Promise<string> {
    const deviceId = this.store.serverDeviceId();
    if (deviceId === null) {
      throw new EnrollmentError("device is not enrolled", 0);
    }
    const current = this.store.accessToken();
    if (current !== null && current.expiresAtMs - this.now() > this.refreshSkewMs) {
      return current.token;
    }
    return this.refresh(deviceId);
  }

  private async refresh(deviceId: string): Promise<string> {
    const issuedAtMs = this.now();
    const signature = signDeviceProof(
      this.store.privateKeyPem(),
      deviceProofMessage(deviceId, issuedAtMs),
    );
    const res = await this.post("/api/devices/token", { deviceId, issuedAtMs, signature });
    if (res.status !== 200) {
      throw new EnrollmentError(`token refresh failed (${res.status})`, res.status);
    }
    const body = tokenResponseSchema.parse(res.json);
    const token: StoredAccessToken = {
      token: body.token,
      expiresAtMs: this.now() + body.expiresInSeconds * 1000,
    };
    this.store.saveAccessToken(token);
    return token.token;
  }
}
