import { describe, it, expect } from "vitest";
import {
  encryptCredentials,
  decryptCredentials,
  isEncryptedCredentials,
} from "../src/credentials.js";

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

const TEST_KEY = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));

const env = { CREDENTIALS_KEY: TEST_KEY };

describe("credentials encryption", () => {
  it("round-trips Growatt credentials", async () => {
    const plain = {
      user: "growatt-user",
      password: "secret-pass",
      plantId: "12345",
      storageSn: "SN001",
      nominalPower: 5000,
      nominalPV: 6000,
    };

    const encrypted = await encryptCredentials(plain, env);
    expect(isEncryptedCredentials(encrypted)).toBe(true);
    expect(encrypted.password).toBeUndefined();

    const decrypted = await decryptCredentials(encrypted, env);
    expect(decrypted).toEqual(plain);
  });

  it("round-trips ShineMonitor credentials", async () => {
    const plain = {
      user: "shine-user",
      pwdSha1: "abc123deadbeef",
      plantId: "99",
      device: { pn: "p1", devcode: "1", sn: "s1", devaddr: "0" },
      nominalPower: 3500,
      timezone: -18000,
    };

    const encrypted = await encryptCredentials(plain, env);
    const decrypted = await decryptCredentials(encrypted, env);
    expect(decrypted).toEqual(plain);
  });

  it("passes through plaintext when CREDENTIALS_KEY is unset", async () => {
    const plain = { user: "u", password: "p" };
    const stored = await encryptCredentials(plain, {});
    expect(stored).toEqual(plain);
    const out = await decryptCredentials(stored, {});
    expect(out).toEqual(plain);
  });

  it("rejects decrypt without CREDENTIALS_KEY", async () => {
    const encrypted = await encryptCredentials({ user: "u", password: "p" }, env);
    await expect(decryptCredentials(encrypted, {})).rejects.toThrow(/CREDENTIALS_KEY required/);
  });

  it("produces unique ciphertext for the same input", async () => {
    const plain = { user: "u", password: "p" };
    const a = await encryptCredentials(plain, env);
    const b = await encryptCredentials(plain, env);
    expect(a.data).not.toBe(b.data);
    expect(a.iv).not.toBe(b.iv);
  });
});
