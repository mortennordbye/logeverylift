"use client";

import {
  addAiModel,
  deleteAiModel,
  listAiModelConfigs,
  moveAiModel,
  setAiModelEnabled,
  testAiModel,
} from "@/lib/actions/ai-model-configs";
import type { AiModelConfig } from "@/db/schema/ai-model-configs";
import { Bot, ChevronDown, ChevronLeft, ChevronUp, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

type TestResult = { ok: true; latencyMs: number } | { ok: false; error: string };

export function AdminAiModelsClient({ initialModels }: { initialModels: AiModelConfig[] }) {
  const [models, setModels] = useState(initialModels);
  const [testing, setTesting] = useState<Record<number, boolean>>({});
  const [testResults, setTestResults] = useState<Record<number, TestResult>>({});
  const [busy, setBusy] = useState<Record<number, boolean>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [newModelId, setNewModelId] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [addLoading, setAddLoading] = useState(false);

  async function refresh() {
    const result = await listAiModelConfigs();
    if (result.success) setModels(result.data);
  }

  async function handleToggle(id: number, enabled: boolean) {
    setBusy((b) => ({ ...b, [id]: true }));
    await setAiModelEnabled(id, enabled);
    await refresh();
    setBusy((b) => ({ ...b, [id]: false }));
  }

  async function handleMove(id: number, direction: "up" | "down") {
    setBusy((b) => ({ ...b, [id]: true }));
    await moveAiModel(id, direction);
    await refresh();
    setBusy((b) => ({ ...b, [id]: false }));
  }

  async function handleTest(id: number, modelId: string) {
    setTesting((t) => ({ ...t, [id]: true }));
    setTestResults((r) => { const next = { ...r }; delete next[id]; return next; });
    const result = await testAiModel(modelId);
    setTestResults((r) => ({
      ...r,
      [id]: result.success ? { ok: true, latencyMs: result.data.latencyMs } : { ok: false, error: result.error },
    }));
    setTesting((t) => ({ ...t, [id]: false }));
  }

  async function handleDelete(id: number) {
    setBusy((b) => ({ ...b, [id]: true }));
    await deleteAiModel(id);
    await refresh();
    setBusy((b) => ({ ...b, [id]: false }));
  }

  async function handleAdd() {
    setAddError(null);
    setAddLoading(true);
    const result = await addAiModel(newModelId, newLabel);
    if (!result.success) {
      setAddError(result.error);
    } else {
      setNewModelId("");
      setNewLabel("");
      setShowAdd(false);
      await refresh();
    }
    setAddLoading(false);
  }

  return (
    <div className="h-[100dvh] bg-background flex flex-col overflow-hidden">
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
        <Link href="/more/admin" className="flex items-center gap-0.5 text-primary active:opacity-70 -ml-1">
          <ChevronLeft className="w-5 h-5" />
          <span className="text-sm font-medium">Admin</span>
        </Link>
      </div>
      <div className="px-4 pt-2 pb-4 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">AI Models</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Models are tried in priority order. The first available one is used.
        </p>
      </div>

      <main className="flex-1 overflow-y-auto px-4 pb-nav-safe space-y-4">
        <div className="rounded-xl border border-border divide-y divide-border overflow-hidden">
          {models.map((model, idx) => {
            const isFirst = idx === 0;
            const isLast = idx === models.length - 1;
            const isBusy = !!busy[model.id];
            const isTesting = !!testing[model.id];
            const result = testResults[model.id];

            return (
              <div key={model.id} className="px-4 py-3 flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  {/* Priority arrows */}
                  <div className="flex flex-col gap-0.5">
                    <button
                      onClick={() => handleMove(model.id, "up")}
                      disabled={isFirst || isBusy}
                      className="p-0.5 rounded text-muted-foreground active:text-foreground disabled:opacity-20"
                    >
                      <ChevronUp className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleMove(model.id, "down")}
                      disabled={isLast || isBusy}
                      className="p-0.5 rounded text-muted-foreground active:text-foreground disabled:opacity-20"
                    >
                      <ChevronDown className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Label + model ID */}
                  <div className="flex-1 min-w-0">
                    <div className={`font-medium text-sm ${!model.enabled ? "text-muted-foreground line-through" : ""}`}>
                      {model.label}
                    </div>
                    <div className="text-xs text-muted-foreground font-mono truncate">{model.modelId}</div>
                  </div>

                  {/* Enable toggle */}
                  <button
                    onClick={() => handleToggle(model.id, !model.enabled)}
                    disabled={isBusy}
                    className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors duration-200 disabled:opacity-50 ${model.enabled ? "bg-primary" : "bg-muted-foreground/30"}`}
                  >
                    <span
                      className={`inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform duration-200 mt-0.5 ${model.enabled ? "translate-x-5" : "translate-x-0.5"}`}
                    />
                  </button>
                </div>

                {/* Test row */}
                <div className="flex items-center gap-2 pl-9">
                  <button
                    onClick={() => handleTest(model.id, model.modelId)}
                    disabled={isTesting}
                    className="text-xs px-3 py-1.5 rounded-lg border border-border active:bg-muted/50 disabled:opacity-50 flex items-center gap-1.5"
                  >
                    <Bot className="w-3 h-3" />
                    {isTesting ? "Testing…" : "Test"}
                  </button>
                  {result && (
                    <span className={`text-xs ${result.ok ? "text-emerald-500" : "text-destructive"}`}>
                      {result.ok ? `✓ ${result.latencyMs}ms` : `✗ ${result.error}`}
                    </span>
                  )}
                  <button
                    onClick={() => handleDelete(model.id)}
                    disabled={isBusy}
                    className="ml-auto p-1.5 rounded-lg text-muted-foreground active:text-destructive disabled:opacity-30"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}

          {models.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              No models configured. Add one below.
            </div>
          )}
        </div>

        {/* Add model */}
        {showAdd ? (
          <div className="rounded-xl border border-border p-4 flex flex-col gap-3">
            <p className="text-sm font-medium">Add model</p>
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Label (e.g. Gemini 2.0 Flash)"
              className="w-full rounded-xl bg-muted px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary"
            />
            <input
              value={newModelId}
              onChange={(e) => setNewModelId(e.target.value)}
              placeholder="OpenRouter model ID (e.g. google/gemini-2.0-flash-exp:free)"
              className="w-full rounded-xl bg-muted px-3 py-2.5 text-sm font-mono outline-none focus:ring-2 focus:ring-primary"
            />
            {addError && <p className="text-xs text-destructive">{addError}</p>}
            <div className="flex gap-2">
              <button
                onClick={handleAdd}
                disabled={addLoading || !newModelId.trim() || !newLabel.trim()}
                className="flex-1 rounded-xl bg-primary text-primary-foreground py-2.5 text-sm font-semibold active:opacity-80 disabled:opacity-50"
              >
                {addLoading ? "Adding…" : "Add"}
              </button>
              <button
                onClick={() => { setShowAdd(false); setAddError(null); }}
                className="flex-1 rounded-xl border border-border py-2.5 text-sm active:bg-muted/50"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowAdd(true)}
            className="w-full flex items-center justify-center gap-2 rounded-xl border border-dashed border-border py-3 text-sm text-muted-foreground active:bg-muted/30"
          >
            <Plus className="w-4 h-4" />
            Add model
          </button>
        )}
      </main>
    </div>
  );
}
