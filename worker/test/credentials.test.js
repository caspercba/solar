import { describe, it } from "node:test";
import assert from "node:assert/strict";
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
    assert.equal(isEncryptedCredentials(encrypted), true);
    assert.equal(encrypted.password, undefined);

    const decrypted = await decryptCredentials(encrypted, env);
    assert.deepEqual(decrypted, plain);
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
    assert.deepEqual(decrypted, plain);
  });

  it("passes through plaintext when CREDENTIALS_KEY is unset", async () => {
    const plain = { user: "u", password: "p" };
    const stored = await encryptCredentials(plain, {});
    assert.deepEqual(stored, plain);
    const out = await decryptCredentials(stored, {});
    assert.deepEqual(out, plain);
  });

  it("rejects decrypt without CREDENTIALS_KEY", async () => {
    const encrypted = await encryptCredentials({ user: "u", password: "p" }, env);
    await assert.rejects(
      () => decryptCredentials(encrypted, {}),
      /CREDENTIALS_KEY required/,
    );
  });

  it("produces unique ciphertext for the same input", async () => {
    const plain = { user: "u", password: "p" };
    const a = await encryptCredentials(plain, env);
    const b = await encryptCredentials(plain, env);
    assert.notEqual(a.data, b.data);
    assert.notEqual(a.iv, b.iv);
  });
});
