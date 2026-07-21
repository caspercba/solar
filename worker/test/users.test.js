import { describe, it, expect } from "vitest";
import {
  hashPassword,
  verifyPassword,
  createUser,
  findUserByUsername,
  disableUser,
  deleteUser,
  updateUser,
  countActiveAdmins,
  listUsersPublic,
} from "../src/users.js";
import { createMockKV } from "./helpers.js";

function env() {
  return { SYSTEMS: createMockKV() };
}

describe("password hashing", () => {
  it("stores a PBKDF2 hash that never contains the plaintext password", async () => {
    const hash = await hashPassword("correct-horse-battery");
    expect(hash).toMatch(/^pbkdf2\$sha256\$100000\$/);
    expect(hash).not.toContain("correct-horse-battery");
    expect(await verifyPassword("correct-horse-battery", hash)).toBe(true);
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("rejects malformed stored hashes", async () => {
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("", "pbkdf2$sha256$100000$aa$bb")).toBe(false);
  });
});

describe("users registry", () => {
  it("creates a user with a hashed password and unique case-normalized username", async () => {
    const e = env();
    const user = await createUser(e, {
      username: "Alice",
      password: "secret-password",
      role: "admin",
      createdBy: "shared",
    });

    expect(user).toMatchObject({
      username: "alice",
      role: "admin",
      createdBy: "shared",
      disabledAt: null,
    });
    expect(user).not.toHaveProperty("passwordHash");

    const stored = await e.SYSTEMS.get(`user:${user.id}`, "json");
    expect(stored.passwordHash).toMatch(/^pbkdf2\$/);
    expect(JSON.stringify(stored)).not.toContain("secret-password");

    await expect(
      createUser(e, { username: "ALICE", password: "another-password", role: "read" }),
    ).rejects.toThrow(/already taken/);
  });

  it("findUserByUsername is case-insensitive", async () => {
    const e = env();
    const created = await createUser(e, { username: "bob", password: "password123", role: "read" });
    const found = await findUserByUsername(e, "Bob");
    expect(found.id).toBe(created.id);
    expect(await verifyPassword("password123", found.passwordHash)).toBe(true);
  });

  it("refuses to disable or delete the last admin", async () => {
    const e = env();
    const admin = await createUser(e, { username: "solo", password: "password123", role: "admin" });
    expect(await countActiveAdmins(e)).toBe(1);

    const disabled = await disableUser(e, admin.id);
    expect(disabled).toEqual({ ok: false, error: "Cannot disable the last admin", status: 400 });

    const deleted = await deleteUser(e, admin.id);
    expect(deleted).toEqual({ ok: false, error: "Cannot delete the last admin", status: 400 });
  });

  it("refuses to demote the last admin", async () => {
    const e = env();
    const admin = await createUser(e, { username: "solo", password: "password123", role: "admin" });
    const result = await updateUser(e, admin.id, { role: "read" });
    expect(result).toEqual({ ok: false, error: "Cannot demote the last admin", status: 400 });
  });

  it("allows disabling a non-final admin and lists public fields only", async () => {
    const e = env();
    const a = await createUser(e, { username: "a", password: "password123", role: "admin" });
    const b = await createUser(e, { username: "b", password: "password123", role: "admin" });

    const result = await disableUser(e, a.id);
    expect(result.ok).toBe(true);
    expect(result.user.disabledAt).toBeTruthy();
    expect(await countActiveAdmins(e)).toBe(1);

    const list = await listUsersPublic(e);
    expect(list).toHaveLength(2);
    for (const u of list) {
      expect(u).not.toHaveProperty("passwordHash");
    }
    expect(list.find((u) => u.id === b.id).disabledAt).toBeNull();
  });

  it("hard-deletes a user when another admin remains", async () => {
    const e = env();
    const a = await createUser(e, { username: "a", password: "password123", role: "admin" });
    await createUser(e, { username: "b", password: "password123", role: "admin" });

    const result = await deleteUser(e, a.id);
    expect(result.ok).toBe(true);
    expect(await e.SYSTEMS.get(`user:${a.id}`)).toBeNull();
    expect(await listUsersPublic(e)).toHaveLength(1);
  });
});
