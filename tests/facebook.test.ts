import { describe, expect, it } from "vitest";
import { decryptFacebookToken, encryptFacebookToken } from "../src/facebook";

describe("Facebook token encryption", () => {
  it("encrypts and decrypts tokens using the server app secret", async () => {
    const bundle = { access_token: "EAAB-test-token-with-sufficient-length", expires_at: 1_900_000_000 };
    const encrypted = await encryptFacebookToken(bundle, "facebook-app-secret-for-tests");
    expect(encrypted.ciphertext).not.toContain(bundle.access_token);
    await expect(decryptFacebookToken({
      token_ciphertext: encrypted.ciphertext,
      token_iv: encrypted.iv,
      token_salt: encrypted.salt,
    }, "facebook-app-secret-for-tests")).resolves.toEqual(bundle);
  });

  it("rejects decryption with a different server secret", async () => {
    const encrypted = await encryptFacebookToken(
      { access_token: "EAAB-test-token-with-sufficient-length" },
      "first-facebook-app-secret",
    );
    await expect(decryptFacebookToken({
      token_ciphertext: encrypted.ciphertext,
      token_iv: encrypted.iv,
      token_salt: encrypted.salt,
    }, "different-facebook-app-secret")).rejects.toThrow();
  });
});
