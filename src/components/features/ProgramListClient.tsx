"use client";

import { createProgram, deleteManyPrograms, exportAllPrograms, exportProgram, importProgram, updateProgram } from "@/lib/actions/programs";
import type { Program } from "@/types/workout";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { ArrowDownUp, Check, ChevronRightIcon, Download, PlusIcon, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Props = {
  programs: Program[];
};

export function ProgramListClient({ programs: initial }: Props) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [programs, setPrograms] = useState(initial);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null);

  useEffect(() => {
    setPrograms(initial);
  }, [initial]);

  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renamingValue, setRenamingValue] = useState("");

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const [showTransferSheet, setShowTransferSheet] = useState(false);
  const [showProgramPickerSheet, setShowProgramPickerSheet] = useState(false);
  const [importMode, setImportMode] = useState<"single" | "all">("single");
  const [exporting, setExporting] = useState(false);
  const [exportingSingleId, setExportingSingleId] = useState<number | null>(null);

  async function handleExportSingle(id: number, name: string) {
    setExportingSingleId(id);
    const result = await exportProgram(id);
    setExportingSingleId(null);
    if (!result.success) return;
    const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name.replace(/\s+/g, "-").toLowerCase()}-program.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleExportAll() {
    setExporting(true);
    const result = await exportAllPrograms();
    setExporting(false);
    if (!result.success) return;
    const blob = new Blob([JSON.stringify(result.data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `programs-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const [importSheetOpen, setImportSheetOpen] = useState(false);
  const [importStatus, setImportStatus] = useState<"idle" | "reading" | "uploading" | "error" | "success">("idle");
  const [importError, setImportError] = useState<string | null>(null);
  const [importWarning, setImportWarning] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function stopEditing() {
    setIsEditing(false);
    setSelectedIds(new Set());
    setRenamingId(null);
    setShowBulkConfirm(false);
    setBulkDeleteError(null);
  }

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setShowBulkConfirm(false);
  }

  const allSelected = programs.length > 0 && selectedIds.size === programs.length;

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(programs.map((p) => p.id)));
    }
    setShowBulkConfirm(false);
  }

  async function handleBulkDelete() {
    const ids = Array.from(selectedIds);
    setBulkDeleting(true);
    const snapshot = programs;
    setPrograms((prev) => prev.filter((p) => !selectedIds.has(p.id)));
    setSelectedIds(new Set());
    setShowBulkConfirm(false);
    const result = await deleteManyPrograms(ids);
    if (!result.success) {
      setPrograms(snapshot);
      setBulkDeleteError(result.error ?? "Failed to delete programs.");
    } else {
      stopEditing();
    }
    setBulkDeleting(false);
    router.refresh();
  }

  function startRenaming(program: Program) {
    setRenamingId(program.id);
    setRenamingValue(program.name);
  }

  async function commitRename(program: Program) {
    const trimmed = renamingValue.trim();
    setRenamingId(null);
    if (!trimmed || trimmed === program.name) return;
    setPrograms((prev) => prev.map((p) => p.id === program.id ? { ...p, name: trimmed } : p));
    await updateProgram({ id: program.id, name: trimmed });
    router.refresh();
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    const result = await createProgram({ name: newName.trim() });
    setCreating(false);
    if (result.success) {
      setNewName("");
      setShowCreate(false);
      router.refresh();
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportStatus("reading");
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setImportStatus("error");
      setImportError("Invalid JSON file.");
      return;
    }
    setImportStatus("uploading");
    const result = await importProgram(parsed);
    if (!result.success) {
      setImportStatus("error");
      setImportError(result.error);
      return;
    }
    router.refresh();
    if (result.data.skippedExercises.length > 0) {
      setImportWarning(`Some exercises couldn't be resolved and were skipped: "${result.data.skippedExercises.join('", "')}".`);
      setImportStatus("success");
    } else {
      setImportSheetOpen(false);
      setImportStatus("idle");
    }
  }

  function closeImportSheet() {
    setImportSheetOpen(false);
    setImportStatus("idle");
    setImportError(null);
    setImportWarning(null);
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-6 pb-2">
        <h1 className="text-3xl font-bold tracking-tight">Programs</h1>
        <div className="flex items-center gap-3">
          {isEditing ? (
            <>
              <button
                type="button"
                onClick={toggleSelectAll}
                className="text-primary text-sm font-medium min-h-[44px] px-1"
              >
                {allSelected ? "Deselect All" : "Select All"}
              </button>
              <button
                type="button"
                onClick={stopEditing}
                className="text-primary text-sm font-medium min-h-[44px] px-1"
              >
                Done
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setShowTransferSheet(true)}
                className="flex items-center justify-center w-10 h-10 text-muted-foreground active:opacity-60"
                aria-label="Import / Export programs"
              >
                <ArrowDownUp className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                className="text-primary text-sm font-medium min-h-[44px] px-1"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                className="flex items-center justify-center w-10 h-10 rounded-full bg-primary text-primary-foreground active:opacity-80 transition-opacity"
                aria-label="New program"
              >
                <PlusIcon className="w-5 h-5" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Bulk delete bar */}
      {isEditing && selectedIds.size > 0 && (
        <div className="px-4 pb-2">
          {showBulkConfirm ? (
            <div className="rounded-2xl bg-destructive/10 px-4 py-3 flex items-center justify-between">
              <span className="text-sm font-medium text-destructive">
                Delete {selectedIds.size} program{selectedIds.size !== 1 ? "s" : ""}?
              </span>
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => { setShowBulkConfirm(false); setBulkDeleteError(null); }}
                  className="text-sm text-muted-foreground font-medium min-h-[44px]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleBulkDelete}
                  disabled={bulkDeleting}
                  className="text-sm text-destructive font-semibold min-h-[44px] disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowBulkConfirm(true)}
              className="w-full rounded-2xl bg-destructive py-4 text-sm font-semibold text-white active:opacity-80 transition-opacity"
            >
              Delete {selectedIds.size} selected
            </button>
          )}
        </div>
      )}

      {isEditing && bulkDeleteError && (
        <p className="text-sm text-destructive px-4 pb-2">{bulkDeleteError}</p>
      )}

      <div className="px-4 pt-4">
        {programs.length > 0 && (
          <div className="flex flex-col divide-y divide-border rounded-2xl bg-card overflow-hidden mb-4">
            {programs.map((program) => {
              const isSelected = selectedIds.has(program.id);

              return (
                <div key={program.id} className="flex items-center gap-3 px-4">
                  {isEditing && (
                    <button
                      type="button"
                      onClick={() => toggleSelect(program.id)}
                      className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 border-2 transition-colors ${
                        isSelected
                          ? "bg-primary border-primary"
                          : "bg-transparent border-muted-foreground/40"
                      }`}
                      aria-label={isSelected ? `Deselect ${program.name}` : `Select ${program.name}`}
                    >
                      {isSelected && <Check className="w-4 h-4 text-white" />}
                    </button>
                  )}
                  {isEditing ? (
                    renamingId === program.id ? (
                      <input
                        autoFocus
                        value={renamingValue}
                        onChange={(e) => setRenamingValue(e.target.value)}
                        onBlur={() => commitRename(program)}
                        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                        className="flex-1 py-3.5 text-base font-medium bg-transparent outline-none border-b border-primary"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => startRenaming(program)}
                        className="flex-1 py-3.5 text-left text-base font-medium"
                      >
                        {program.name}
                      </button>
                    )
                  ) : (
                    <Link
                      href={`/programs/${program.id}`}
                      className="flex-1 flex items-center justify-between py-3.5 active:opacity-70 transition-opacity"
                    >
                      <span className="text-base font-medium">{program.name}</span>
                      <ChevronRightIcon className="h-5 w-5 text-muted-foreground" />
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {programs.length === 0 && !showCreate && (
          <p className="text-muted-foreground text-sm mb-6">
            No programs yet. Tap + to create one.
          </p>
        )}

        {showCreate && (
          <form onSubmit={handleCreate} className="flex gap-2 mb-4">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Program name…"
              className="flex-1 rounded-xl bg-muted px-4 py-3 text-base outline-none focus:ring-2 ring-primary"
            />
            <button
              type="submit"
              disabled={creating || !newName.trim()}
              className="rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {creating ? "…" : "Create"}
            </button>
            <button
              type="button"
              onClick={() => { setShowCreate(false); setNewName(""); }}
              className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground"
            >
              Cancel
            </button>
          </form>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="sr-only"
        onChange={handleFileChange}
      />
      {showTransferSheet && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowTransferSheet(false)} />
          <div className="relative bg-background rounded-t-2xl pb-safe">
            <div className="w-10 h-1 bg-muted rounded-full mx-auto mt-3 mb-4" />
            <div className="divide-y divide-border">
              <button
                type="button"
                onClick={() => { setShowTransferSheet(false); setImportMode("single"); setImportSheetOpen(true); }}
                className="flex items-center gap-3 w-full px-4 py-4 active:bg-muted/50 transition-colors"
              >
                <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <Upload className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="text-left">
                  <p className="font-medium">Import single program</p>
                  <p className="text-xs text-muted-foreground">From a single-program JSON file</p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => { setShowTransferSheet(false); setImportMode("all"); setImportSheetOpen(true); }}
                className="flex items-center gap-3 w-full px-4 py-4 active:bg-muted/50 transition-colors"
              >
                <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <Upload className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="text-left">
                  <p className="font-medium">Import all programs</p>
                  <p className="text-xs text-muted-foreground">From an all-programs JSON file</p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => { setShowTransferSheet(false); setShowProgramPickerSheet(true); }}
                disabled={programs.length === 0}
                className="flex items-center gap-3 w-full px-4 py-4 active:bg-muted/50 transition-colors disabled:opacity-40"
              >
                <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <Download className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="text-left">
                  <p className="font-medium">Export single program</p>
                  <p className="text-xs text-muted-foreground">Choose which program to export</p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => { setShowTransferSheet(false); handleExportAll(); }}
                disabled={exporting || programs.length === 0}
                className="flex items-center gap-3 w-full px-4 py-4 active:bg-muted/50 transition-colors disabled:opacity-40"
              >
                <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <Download className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="text-left">
                  <p className="font-medium">Export all programs</p>
                  <p className="text-xs text-muted-foreground">All programs to a single JSON file</p>
                </div>
              </button>
            </div>
            <button
              type="button"
              onClick={() => setShowTransferSheet(false)}
              className="w-full py-4 text-primary font-semibold text-sm active:opacity-70 mt-2 border-t border-border"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {showProgramPickerSheet && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowProgramPickerSheet(false)} />
          <div className="relative bg-background rounded-t-2xl pb-safe max-h-[70dvh] flex flex-col">
            <div className="w-10 h-1 bg-muted rounded-full mx-auto mt-3 shrink-0" />
            <div className="flex items-center justify-between px-4 pt-3 pb-3 border-b border-border shrink-0">
              <h2 className="font-semibold">Export which program?</h2>
              <button onClick={() => setShowProgramPickerSheet(false)} className="text-sm text-muted-foreground active:opacity-70">
                Cancel
              </button>
            </div>
            <div className="overflow-y-auto divide-y divide-border">
              {programs.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { setShowProgramPickerSheet(false); handleExportSingle(p.id, p.name); }}
                  disabled={exportingSingleId === p.id}
                  className="flex items-center justify-between w-full px-4 py-3.5 active:bg-muted/50 transition-colors disabled:opacity-50"
                >
                  <span className="font-medium text-left">{p.name}</span>
                  <Download className="w-4 h-4 text-muted-foreground shrink-0" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <BottomSheet open={importSheetOpen} onClose={closeImportSheet}>
        <div className="bg-background rounded-t-2xl px-4 pt-5 pb-10">
          <div className="w-10 h-1 bg-muted rounded-full mx-auto mb-5" />
          <h2 className="text-xl font-bold mb-1">
            {importMode === "all" ? "Import All Programs" : "Import Program"}
          </h2>
          <p className="text-sm text-muted-foreground mb-6">
            {importMode === "all"
              ? "Select a JSON file exported using Export all programs."
              : "Select a JSON file exported from a single program."}
          </p>
          {importStatus === "idle" && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full rounded-2xl bg-primary py-4 text-sm font-semibold text-primary-foreground active:opacity-80"
            >
              Choose File
            </button>
          )}
          {(importStatus === "reading" || importStatus === "uploading") && (
            <p className="text-center text-sm text-muted-foreground py-4">
              {importStatus === "reading" ? "Reading file…" : "Importing…"}
            </p>
          )}
          {importStatus === "error" && (
            <>
              <p className="text-sm text-destructive mb-4">{importError}</p>
              <button
                type="button"
                onClick={() => {
                  setImportStatus("idle");
                  setImportError(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                className="w-full rounded-2xl bg-muted py-4 text-sm font-medium active:opacity-70"
              >
                Try Again
              </button>
            </>
          )}
          {importStatus === "success" && importWarning && (
            <>
              <p className="text-sm text-amber-600 dark:text-amber-400 mb-4">⚠️ {importWarning}</p>
              <button
                type="button"
                onClick={() => {
                  setImportSheetOpen(false);
                  setImportStatus("idle");
                  setImportWarning(null);
                }}
                className="w-full rounded-2xl bg-primary py-4 text-sm font-semibold text-primary-foreground active:opacity-80"
              >
                Done
              </button>
            </>
          )}
          <button
            type="button"
            onClick={closeImportSheet}
            className="w-full mt-3 py-3 text-sm text-muted-foreground"
          >
            Cancel
          </button>
        </div>
      </BottomSheet>
    </>
  );
}
