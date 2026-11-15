/**
 * The Account sub-pages under /more/account/<id>, with their titles. A plain
 * module, so the server route can read it (sections.tsx is a client module).
 */
export const SUB_PAGES = {
  profile: "Profile",
  "goals-and-training": "Goals and training",
  "body-and-health": "Body and health",
  "training-numbers": "Training numbers",
  "privacy-and-security": "Privacy and security",
  "your-data": "Your data",
} as const;

export type SubPage = keyof typeof SUB_PAGES;

export const isSubPage = (id: string): id is SubPage => Object.hasOwn(SUB_PAGES, id);
