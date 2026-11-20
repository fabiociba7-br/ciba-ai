export const facebookCapabilities = (permissions: string[]) => ({
  profile: permissions.includes("public_profile"),
  personal_posts: permissions.includes("user_posts"),
  personal_photos: permissions.includes("user_photos") || permissions.includes("user_posts"),
  personal_videos: permissions.includes("user_videos"),
  page_features: false,
  personal_messenger_inbox: false,
});
