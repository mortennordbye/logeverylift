/**
 * The shape of `user.home_layout` (docs/home-widgets-audit.md, 6.3). Type only,
 * so the schema can import it. The Zod schemas and the functions that read it
 * live in src/lib/home/layout.ts.
 */

export type StoredSize = "s" | "m" | "l";

export type StoredHomeItem = {
  id: string;
  size: StoredSize;
  hidden: boolean;
  /** Ids and numbers only; never free text. */
  settings?: Record<string, number | string>;
};

export type StoredHomeLayout = {
  /** Shape version. */
  v: 1;
  /** ISO time of the save, for the conflict check. */
  updatedAt: string;
  /** Header and widget kinds only, in the user's order. */
  items: StoredHomeItem[];
};
