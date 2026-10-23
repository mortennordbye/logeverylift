export const meta = {
  name: 'exercise-art',
  description: 'Draw exercise illustrations in parallel: pose each spec, review its preview, fix, then rebuild the index',
  whenToUse: 'Batch-drawing exercise illustrations. Pass the exercise names (exact seed names) as args; `pnpm art todo` lists the missing ones.',
  phases: [
    { title: 'Draw', detail: 'one agent per exercise writes and checks its spec' },
    { title: 'Review', detail: 'a fresh agent judges each preview against the skill checklist' },
    { title: 'Fix', detail: 'only for exercises the review rejected, then reviewed again' },
    { title: 'Index', detail: 'regenerate the spec index and run the tests' },
  ],
}

const names = Array.isArray(args) ? args : []
if (!names.length) throw new Error('Pass exercise names as args, e.g. ["Bench Press", "Squat"]')

const slug = (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const DRAWN = {
  type: 'object',
  properties: {
    slug: { type: 'string' },
    passedCheck: { type: 'boolean', description: 'pnpm art check passed on the final spec' },
    notes: { type: 'string', description: 'anything the reviewer should know, e.g. a seed muscle group you overrode' },
  },
  required: ['slug', 'passedCheck', 'notes'],
}

const VERDICT = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    problems: { type: 'array', items: { type: 'string' }, description: 'concrete, fixable: which view, which frame, which joint, what is wrong' },
  },
  required: ['pass', 'problems'],
}

const drawPrompt = (name) => `Use the exercise-art skill (.claude/skills/exercise-art/SKILL.md) to draw "${name}".
Write src/lib/exercise-art/specs/${slug(name)}.json, run \`pnpm art check ${slug(name)}\`, Read .art-preview/${slug(name)}.png and iterate until the skill's checklist holds.
Only touch that one spec file: other agents are drawing other exercises in parallel. Do not run \`pnpm art index\`.
If the exercise needs equipment the skill's props table cannot draw, do not fake it with another prop: write no spec, set passedCheck false, and say in notes which prop is missing.`

const reviewPrompt = (name, drawn) => `You are reviewing an exercise illustration someone else drew. Be strict: a figure people learn technique from must not be wrong.
Exercise: "${name}". Spec: src/lib/exercise-art/specs/${slug(name)}.json. The drawer's notes: ${drawn.notes || 'none'}.
Run \`pnpm art check ${slug(name)}\`, Read .art-preview/${slug(name)}.png, and judge it against the checklist in .claude/skills/exercise-art/SKILL.md and against how the exercise is really performed.
Do not edit any file. Pass only if every checklist row holds.`

const fixPrompt = (name, problems) => `Use the exercise-art skill to fix the illustration for "${name}" (src/lib/exercise-art/specs/${slug(name)}.json). A reviewer found:
${problems.map((p) => `- ${p}`).join('\n')}
Fix each one, run \`pnpm art check ${slug(name)}\`, Read the PNG and confirm. Only touch that one spec file.`

const results = await pipeline(
  names,
  (name) => agent(drawPrompt(name), { label: `draw:${slug(name)}`, phase: 'Draw', schema: DRAWN }),
  (drawn, name) =>
    // No spec written (e.g. a missing prop): nothing to review or fix.
    drawn && !drawn.passedCheck
      ? { name, drawn, skipped: true }
      : agent(reviewPrompt(name, drawn), { label: `review:${slug(name)}`, phase: 'Review', schema: VERDICT })
          .then((verdict) => ({ name, drawn, verdict })),
  async (r) => {
    if (r.skipped) return { name: r.name, status: 'not drawn', problems: [r.drawn.notes] }
    if (!r.verdict || r.verdict.pass) return { name: r.name, status: 'ok', problems: [] }
    await agent(fixPrompt(r.name, r.verdict.problems), { label: `fix:${slug(r.name)}`, phase: 'Fix' })
    // A fix nobody re-reviews can still be wrong (batch 1: four of eight were), so check it once more.
    const again = await agent(reviewPrompt(r.name, { notes: `fixed after review: ${r.verdict.problems.join(' / ')}` }), { label: `re-review:${slug(r.name)}`, phase: 'Fix', schema: VERDICT })
    return { name: r.name, status: again?.pass ? 'fixed' : 'still failing', problems: again?.pass ? [] : again?.problems ?? ['re-review failed to run'] }
  },
)

phase('Index')
const index = await agent(
  'Run `pnpm art index`, then `pnpm art check` (all specs) and `pnpm test src/__tests__/exercise-art.test.ts`. Do not change any spec. Report which specs fail, with the error lines, or "all green".',
  { label: 'index', phase: 'Index' },
)

const dropped = names.filter((_, i) => !results[i])
if (dropped.length) log(`Dropped (agent failed): ${dropped.join(', ')}`)
return { results: results.filter(Boolean), dropped, index }
