import { redirect } from "next/navigation";

/** Seasons are listed on the cycles screen (docs/plans/seasons.md, 2.10). */
export default function SeasonsPage() {
  redirect("/cycles");
}
