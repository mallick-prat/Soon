/**
 * EnrollmentStore backed by the sqlite settings row + the SecretBox. the
 * ed25519 private key and the access jwt are encrypted at rest; the public key
 * and server device id are not secret.
 */
import { generateKeyPairSync } from "node:crypto";

import type { SettingsStore } from "../local-database/stores.js";
import type { SecretBox } from "../secure-storage/index.js";
import type { EnrollmentStore, StoredAccessToken } from "./enroller.js";

export function createSettingsEnrollmentStore(
  settings: SettingsStore,
  box: SecretBox,
): EnrollmentStore {
  return {
    ensureDeviceKeypair() {
      const current = settings.get();
      if (current.devicePublicKey !== null && current.devicePrivateKeyEnc !== null) {
        return current.devicePublicKey;
      }
      const { publicKey, privateKey } = generateKeyPairSync("ed25519");
      const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
      const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
      settings.setDeviceKeypair(box.encryptString(privateKeyPem), publicKeyPem);
      return publicKeyPem;
    },

    privateKeyPem() {
      const enc = settings.get().devicePrivateKeyEnc;
      if (enc === null) throw new Error("device keypair has not been generated");
      return box.decryptString(enc);
    },

    serverDeviceId() {
      return settings.get().serverDeviceId;
    },

    saveEnrollment(serverDeviceId: string, token: StoredAccessToken) {
      settings.setServerDeviceId(serverDeviceId);
      settings.setAccessToken(box.encryptString(token.token), token.expiresAtMs);
    },

    accessToken() {
      const current = settings.get();
      if (current.deviceTokenEnc === null || current.deviceTokenExpiresAtMs === null) {
        return null;
      }
      return {
        token: box.decryptString(current.deviceTokenEnc),
        expiresAtMs: current.deviceTokenExpiresAtMs,
      };
    },

    saveAccessToken(token: StoredAccessToken) {
      settings.setAccessToken(box.encryptString(token.token), token.expiresAtMs);
    },
  };
}
