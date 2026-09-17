import { Email } from "@convex-dev/auth/providers/Email";
import axios from "axios";
import { RandomReader, generateRandomString } from "@oslojs/crypto/random";

/**
 * Email OTP delivery.
 *
 * The delivery key is read from `VLY_EMAIL_KEY` — it must never be hardcoded,
 * because this repository is public and a committed key is a compromised key.
 * Without the env var the provider refuses to send, so a misconfigured
 * deployment fails loudly instead of leaking someone else's quota.
 */
const SEND_OTP_URL =
  process.env.VLY_EMAIL_URL ?? "https://auth.freebuff.app/send_otp";

export const emailOtp = Email({
  id: "email-otp",
  maxAge: 60 * 15, // 15 minutes
  // This function can be asynchronous
  async generateVerificationToken() {
    const random: RandomReader = {
      read(bytes: Uint8Array) {
        crypto.getRandomValues(bytes);
      },
    };
    const alphabet = "0123456789";
    return generateRandomString(random, alphabet, 6);
  },
  async sendVerificationRequest({ identifier: email, token }) {
    const apiKey = process.env.VLY_EMAIL_KEY;
    if (!apiKey) {
      throw new Error(
        "Отправка кода на почту отключена: задайте VLY_EMAIL_KEY в переменных окружения Convex.",
      );
    }
    try {
      await axios.post(
        SEND_OTP_URL,
        {
          to: email,
          otp: token,
          appName: process.env.VLY_APP_NAME || "a freebuff.com application",
        },
        {
          headers: {
            "x-api-key": apiKey,
          },
          timeout: 15_000,
        },
      );
    } catch {
      // Never echo the provider response body or the key back to the client.
      throw new Error("Не удалось отправить код на почту. Попробуйте позже.");
    }
  },
});
