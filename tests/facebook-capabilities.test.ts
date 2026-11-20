import { describe, expect, it } from "vitest";
import { facebookCapabilities } from "../src/core/facebook/capabilities";

describe("Facebook capability mapping", () => {
  it("maps granted permissions to supported personal capabilities", () => {
    expect(facebookCapabilities([
      "public_profile", "user_posts", "user_videos",
    ])).toEqual({
      profile: true,
      personal_posts: true,
      personal_photos: true,
      personal_videos: true,
      page_features: false,
      personal_messenger_inbox: false,
    });
  });

  it("allows photo access without post access", () => {
    expect(facebookCapabilities(["user_photos"])).toMatchObject({
      profile: false,
      personal_posts: false,
      personal_photos: true,
      personal_videos: false,
    });
  });

  it("fails closed when no supported permissions are granted", () => {
    expect(facebookCapabilities([])).toEqual({
      profile: false,
      personal_posts: false,
      personal_photos: false,
      personal_videos: false,
      page_features: false,
      personal_messenger_inbox: false,
    });
  });
});
