import { defineAstroPaperConfig } from "./src/types/config";

export default defineAstroPaperConfig({
  site: {
    url: "https://andiradulescu.github.io/",
    title: "Andi Radulescu",
    description: "Notes on software, hardware, and debugging.",
    author: "Andi Radulescu",
    profile: "https://github.com/andiradulescu",
    ogImage: "og.png",
    lang: "en",
    timezone: "Europe/Bucharest",
    dir: "ltr",
  },
  posts: {
    perPage: 4,
    perIndex: 4,
    scheduledPostMargin: 0,
  },
  features: {
    lightAndDarkMode: true,
    dynamicOgImage: true,
    showArchives: true,
    showBackButton: true,
    editPost: {
      enabled: false,
    },
    search: "pagefind",
  },
  socials: [
    {
      name: "github",
      url: "https://github.com/andiradulescu",
      linkTitle: "Andi Radulescu on GitHub",
    },
    { name: "x", url: "https://x.com/andiradulescu" },
    {
      name: "linkedin",
      url: "https://www.linkedin.com/in/andiradulescu",
      linkTitle: "Andi Radulescu on LinkedIn",
    },
  ],
  shareLinks: [],
});
