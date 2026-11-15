/**
 * The lines of the last assistant change on the AI coach hub
 * (docs/plans/ai-coach-hub.md): each change named by the program or cycle it
 * is in. A note's change line already quotes the note, so it stands alone.
 */
export function lastChangeLines(objects: { type: string; name: string; changes: string[] }[]): string[] {
  return objects.flatMap((o) => o.changes.map((c) => (o.type === "memory" ? c : `${o.name} · ${c}`))).slice(0, 2);
}
