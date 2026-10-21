import { redirect } from "next/navigation";

// The PR feed lives on the Records tab of Progress now; keep old links working.
export default function PrsPage() {
  redirect("/more/metrics?tab=records");
}
