import { describe, it, expect } from "vitest";
import { checkAuth } from "../src/auth.js";

function makeRequest(authHeader) {
  const headers = new Headers();
  if (authHeader != null) headers.set("Authorization", authHeader);
  return new Request("https://example.com/api/systems", { headers });
}

describe("checkAuth", () => {
  it("allows all requests when API_TOKEN is not configured", () => {
    const env = {};
    expect(checkAuth(makeRequest(), env)).toBe(true);
    expect(checkAuth(makeRequest("Bearer wrong"), env)).toBe(true);
  });

  it("allows requests with a valid Bearer token", () => {
    const env = { API_TOKEN: "secret-token" };
    expect(checkAuth(makeRequest("Bearer secret-token"), env)).toBe(true);
  });

  it("rejects requests with a missing Authorization header", () => {
    const env = { API_TOKEN: "secret-token" };
    expect(checkAuth(makeRequest(), env)).toBe(false);
  });

  it("rejects requests with an invalid Bearer token", () => {
    const env = { API_TOKEN: "secret-token" };
    expect(checkAuth(makeRequest("Bearer wrong-token"), env)).toBe(false);
    expect(checkAuth(makeRequest("Basic secret-token"), env)).toBe(false);
  });
});
