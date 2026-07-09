"use client";

import { createCustomExercise, deleteCustomExercise, updateCustomExercise } from "@/lib/actions/exercises";
import { EXERCISE_TYPES, EXERCISE_TYPE_LABELS, type ExerciseType } from "@/lib/utils/exercise-type";
import type { Exercise } from "@/types/workout";
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  Eye,
  PersonStanding,
  Plus,
  Search,
  Timer,
  Trash2,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Category = "strength" | "cardio" | "flexibility";
type BodyArea = "upper_body" | "lower_body" | "core" | "full_body" | "cardio";
type MuscleGroup = "chest" | "back" | "shoulders" | "biceps" | "triceps" | "forearms" | "quads" | "hamstrings" | "glutes" | "calves" | "abs" | "lower_back" | "full_body" | "cardio";
type Equipment = "barbell" | "dumbbell" | "machine" | "cable" | "bodyweight" | "kettlebell" | "bands" | "other";
type MovementPattern = "push" | "pull" | "hinge" | "squat" | "carry" | "rotation" | "isometric" | "cardio";
type ViewId = "all" | "bodyArea" | "muscles" | "equipment" | "timed" | "function" | "custom";

const BODY_AREA_ORDER: BodyArea[] = ["upper_body", "lower_body", "core", "full_body", "cardio"];
const BODY_AREA_LABELS: Record<BodyArea, string> = {
  upper_body: "Upper Body", lower_body: "Lower Body", core: "Core",
  full_body: "Full Body", cardio: "Cardio",
};

const MUSCLE_ORDER: MuscleGroup[] = ["chest", "back", "shoulders", "biceps", "triceps", "forearms", "quads", "hamstrings", "glutes", "calves", "abs", "lower_back", "full_body", "cardio"];
const MUSCLE_LABELS: Record<MuscleGroup, string> = {
  chest: "Chest", back: "Back", shoulders: "Shoulders", biceps: "Biceps",
  triceps: "Triceps", forearms: "Forearms", quads: "Quads", hamstrings: "Hamstrings",
  glutes: "Glutes", calves: "Calves", abs: "Abs", lower_back: "Lower Back",
  full_body: "Full Body", cardio: "Cardio",
};

const EQUIPMENT_ORDER: Equipment[] = ["barbell", "dumbbell", "machine", "cable", "bodyweight", "kettlebell", "bands", "other"];
const EQUIPMENT_LABELS: Record<Equipment, string> = {
  barbell: "Barbell", dumbbell: "Dumbbell", machine: "Machine", cable: "Cable",
  bodyweight: "Bodyweight", kettlebell: "Kettlebell", bands: "Bands", other: "Other",
};

const MOVEMENT_ORDER: MovementPattern[] = ["push", "pull", "hinge", "squat", "carry", "rotation", "isometric", "cardio"];
const MOVEMENT_LABELS: Record<MovementPattern, string> = {
  push: "Push", pull: "Pull", hinge: "Hinge", squat: "Squat",
  carry: "Carry", rotation: "Rotation", isometric: "Isometric", cardio: "Cardio",
};

const MENU_ITEMS: { id: ViewId; label: string; Icon: React.ElementType }[] = [
  { id: "all", label: "All Exercises", Icon: Dumbbell },
  { id: "bodyArea", label: "Body Area", Icon: PersonStanding },
  { id: "muscles", label: "Muscles", Icon: Zap },
  { id: "equipment", label: "Equipment", Icon: Wrench },
  { id: "timed", label: "Timed", Icon: Timer },
  { id: "function", label: "Function", Icon: Activity },
  { id: "custom", label: "My Exercises", Icon: Eye },
];

const GROUP_CONFIG = {
  bodyArea: { key: "bodyArea" as keyof Exercise, order: BODY_AREA_ORDER as string[], labels: BODY_AREA_LABELS as Record<string, string> },
  muscles: { key: "muscleGroup" as keyof Exercise, order: MUSCLE_ORDER as string[], labels: MUSCLE_LABELS as Record<string, string> },
  equipment: { key: "equipment" as keyof Exercise, order: EQUIPMENT_ORDER as string[], labels: EQUIPMENT_LABELS as Record<string, string> },
  function: { key: "movementPattern" as keyof Exercise, order: MOVEMENT_ORDER as string[], labels: MOVEMENT_LABELS as Record<string, string> },
} as const;

function capitalize(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function exerciseType(category: string, isTimed?: boolean) {
  if (isTimed || category === "cardio") return "Timed";
  if (category === "flexibility") return "Flexibility";
  return "Reps Based";
}

// ─── Search Bar ───────────────────────────────────────────────────────────────

function SearchBar({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search"
        className="w-full rounded-xl bg-muted/60 pl-9 pr-4 py-2.5 text-base outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}

// ─── Detail View ──────────────────────────────────────────────────────────────

function DetailView({ exercise }: { exercise: Exercise }) {
  const rows: { label: string; value: string }[] = [
    { label: "Title", value: exercise.name },
    // "Format" = how the exercise is tracked (timed vs reps). Distinct from the
    // "Type" row below, which is the compound/isolation classification.
    { label: "Format", value: exerciseType(exercise.category, exercise.isTimed) },
    ...(exercise.exerciseType ? [{ label: "Type", value: EXERCISE_TYPE_LABELS[exercise.exerciseType as ExerciseType] }] : []),
    ...(exercise.bodyArea ? [{ label: "Body Area", value: capitalize(exercise.bodyArea) }] : []),
    ...(exercise.muscleGroup ? [{ label: "Muscle Group", value: capitalize(exercise.muscleGroup) }] : []),
    ...(exercise.equipment ? [{ label: "Equipment", value: capitalize(exercise.equipment) }] : []),
    ...(exercise.movementPattern ? [{ label: "Movement", value: capitalize(exercise.movementPattern) }] : []),
  ];

  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight mb-6">
        {exercise.name}
        {exercise.isCustom && (
          <span className="ml-2 text-sm font-medium text-primary bg-primary/10 px-2 py-0.5 rounded align-middle">
            Custom
          </span>
        )}
      </h1>
      <div className="bg-card rounded-2xl overflow-hidden">
        {rows.map(({ label, value }, i) => (
          <div
            key={label}
            className={`flex items-center justify-between px-4 py-3.5 ${i < rows.length - 1 ? "border-b border-border/50" : ""}`}
          >
            <span className="text-foreground">{label}</span>
            <span className="text-muted-foreground text-right">{value}</span>
          </div>
        ))}
      </div>
    </>
  );
}

// ─── Exercise Row ─────────────────────────────────────────────────────────────

function ExerciseRow({
  exercise,
  onOpen,
  onSelect,
  selectLoading,
}: {
  exercise: Exercise;
  onOpen: (exercise: Exercise) => void;
  onSelect?: (exercise: Exercise) => void;
  selectLoading?: boolean;
}) {
  const sub = [
    exercise.exerciseType ? EXERCISE_TYPE_LABELS[exercise.exerciseType as ExerciseType] : null,
    exercise.muscleGroup ? capitalize(exercise.muscleGroup) : null,
    exercise.equipment ? capitalize(exercise.equipment) : null,
  ].filter(Boolean).join(" · ");

  return (
    <button
      onClick={() => onSelect ? onSelect(exercise) : onOpen(exercise)}
      disabled={selectLoading}
      className="flex items-center justify-between w-full px-4 py-3.5 min-h-[54px] border-b border-border/50 last:border-0 active:bg-muted/50 transition-colors text-left disabled:opacity-50"
    >
      <div className="flex-1 min-w-0">
        <p className="font-medium">{exercise.name}</p>
        {sub && <p className="text-sm text-muted-foreground mt-0.5">{sub}</p>}
      </div>
      {exercise.isCustom ? (
        <span className="text-xs text-primary bg-primary/10 px-2 py-0.5 rounded shrink-0">
          Custom
        </span>
      ) : (
        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
      )}
    </button>
  );
}

// ─── Flat Exercise List ────────────────────────────────────────────────────────

function FlatExerciseList({
  title,
  exercises,
  onOpen,
  onSelect,
  selectLoading,
}: {
  title: string;
  exercises: Exercise[];
  onOpen: (exercise: Exercise) => void;
  onSelect?: (exercise: Exercise) => void;
  selectLoading?: boolean;
}) {
  const [search, setSearch] = useState("");
  const filtered = exercises.filter((ex) =>
    ex.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight mb-4">{title}</h1>
      <SearchBar value={search} onChange={setSearch} />
      <div className="bg-card rounded-2xl overflow-hidden mt-4">
        {filtered.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No exercises found.</p>
        ) : (
          filtered.map((ex) => (
            <ExerciseRow
              key={ex.id}
              exercise={ex}
              onOpen={onOpen}
              onSelect={onSelect}
              selectLoading={selectLoading}
            />
          ))
        )}
      </div>
    </>
  );
}

// ─── Category List ────────────────────────────────────────────────────────────

function CategoryList({
  title,
  items,
  onSelect,
}: {
  title: string;
  items: { key: string; label: string }[];
  onSelect: (key: string) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = items.filter((item) =>
    item.label.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight mb-4">{title}</h1>
      <SearchBar value={search} onChange={setSearch} />
      <div className="bg-card rounded-2xl overflow-hidden mt-4">
        {filtered.map((item) => (
          <button
            key={item.key}
            onClick={() => onSelect(item.key)}
            className="flex items-center justify-between w-full px-4 py-3.5 min-h-[54px] border-b border-border/50 last:border-0 active:bg-muted/50 transition-colors"
          >
            <span className="font-medium">{item.label}</span>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </button>
        ))}
      </div>
    </>
  );
}

// ─── Exercise Form Fields ─────────────────────────────────────────────────────

function ExerciseFormFields({
  name, setName,
  category, setCategory,
  bodyArea, setBodyArea,
  muscleGroup, setMuscleGroup,
  equipment, setEquipment,
  movementPattern, setMovementPattern,
  exType, setExType,
  error,
  loading,
  submitLabel,
}: {
  name: string; setName: (v: string) => void;
  category: Category; setCategory: (v: Category) => void;
  bodyArea: BodyArea | ""; setBodyArea: (v: BodyArea | "") => void;
  muscleGroup: MuscleGroup | ""; setMuscleGroup: (v: MuscleGroup | "") => void;
  equipment: Equipment | ""; setEquipment: (v: Equipment | "") => void;
  movementPattern: MovementPattern | ""; setMovementPattern: (v: MovementPattern | "") => void;
  exType: ExerciseType | ""; setExType: (v: ExerciseType | "") => void;
  error: string;
  loading: boolean;
  submitLabel: string;
}) {
  return (
    <>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Exercise name"
        className="w-full rounded-xl bg-muted px-4 py-3 text-base outline-none focus:ring-2 ring-primary"
      />
      <div className="grid grid-cols-3 gap-2">
        {(["strength", "cardio", "flexibility"] as Category[]).map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setCategory(cat)}
            className={`py-2.5 rounded-xl text-sm font-semibold capitalize transition-colors ${
              category === cat
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-foreground active:opacity-70"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>
      <select
        value={bodyArea}
        onChange={(e) => setBodyArea(e.target.value as BodyArea | "")}
        className="w-full rounded-xl bg-muted px-4 py-3 text-base outline-none focus:ring-2 ring-primary"
      >
        <option value="">Body area (optional)</option>
        {BODY_AREA_ORDER.map((val) => (
          <option key={val} value={val}>{BODY_AREA_LABELS[val]}</option>
        ))}
      </select>
      <select
        value={muscleGroup}
        onChange={(e) => setMuscleGroup(e.target.value as MuscleGroup | "")}
        className="w-full rounded-xl bg-muted px-4 py-3 text-base outline-none focus:ring-2 ring-primary"
      >
        <option value="">Muscle group (optional)</option>
        {MUSCLE_ORDER.map((val) => (
          <option key={val} value={val}>{MUSCLE_LABELS[val]}</option>
        ))}
      </select>
      <select
        value={equipment}
        onChange={(e) => setEquipment(e.target.value as Equipment | "")}
        className="w-full rounded-xl bg-muted px-4 py-3 text-base outline-none focus:ring-2 ring-primary"
      >
        <option value="">Equipment (optional)</option>
        {EQUIPMENT_ORDER.map((val) => (
          <option key={val} value={val}>{EQUIPMENT_LABELS[val]}</option>
        ))}
      </select>
      <select
        value={movementPattern}
        onChange={(e) => setMovementPattern(e.target.value as MovementPattern | "")}
        className="w-full rounded-xl bg-muted px-4 py-3 text-base outline-none focus:ring-2 ring-primary"
      >
        <option value="">Movement pattern (optional)</option>
        {MOVEMENT_ORDER.map((val) => (
          <option key={val} value={val}>{MOVEMENT_LABELS[val]}</option>
        ))}
      </select>
      <select
        value={exType}
        onChange={(e) => setExType(e.target.value as ExerciseType | "")}
        className="w-full rounded-xl bg-muted px-4 py-3 text-base outline-none focus:ring-2 ring-primary"
      >
        <option value="">Type (optional)</option>
        {EXERCISE_TYPES.map((val) => (
          <option key={val} value={val}>{EXERCISE_TYPE_LABELS[val]}</option>
        ))}
      </select>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <button
        type="submit"
        disabled={loading || !name.trim()}
        className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
      >
        {submitLabel}
      </button>
    </>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ExercisesClient({
  exercises,
  onSelectExercise,
  onBack,
}: {
  exercises: Exercise[];
  onSelectExercise?: (exercise: Exercise) => Promise<void>;
  onBack?: () => void;
}) {
  const router = useRouter();
  const [view, setView] = useState<ViewId | "menu">("menu");
  const [subCategory, setSubCategory] = useState<string | null>(null);
  const [selectedExercise, setSelectedExercise] = useState<Exercise | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingExercise, setEditingExercise] = useState<Exercise | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<Category>("strength");
  const [bodyArea, setBodyArea] = useState<BodyArea | "">("");
  const [muscleGroup, setMuscleGroup] = useState<MuscleGroup | "">("");
  const [equipment, setEquipment] = useState<Equipment | "">("");
  const [movementPattern, setMovementPattern] = useState<MovementPattern | "">("");
  const [exType, setExType] = useState<ExerciseType | "">("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectLoading, setSelectLoading] = useState(false);
  const [menuSearch, setMenuSearch] = useState("");

  async function handleSelectExercise(exercise: Exercise) {
    if (!onSelectExercise) return;
    setSelectLoading(true);
    await onSelectExercise(exercise);
    setSelectLoading(false);
  }

  function openEdit(exercise: Exercise) {
    setEditingExercise(exercise);
    setName(exercise.name);
    setCategory(exercise.category as Category);
    setBodyArea((exercise.bodyArea as BodyArea | "") ?? "");
    setMuscleGroup((exercise.muscleGroup as MuscleGroup | "") ?? "");
    setEquipment((exercise.equipment as Equipment | "") ?? "");
    setMovementPattern((exercise.movementPattern as MovementPattern | "") ?? "");
    setExType((exercise.exerciseType as ExerciseType | "") ?? "");
    setError("");
  }

  function closeEdit() {
    setEditingExercise(null);
    setName(""); setCategory("strength"); setBodyArea("");
    setMuscleGroup(""); setEquipment(""); setMovementPattern(""); setExType("");
    setError("");
  }

  async function handleDelete() {
    if (!editingExercise) return;
    setLoading(true);
    const result = await deleteCustomExercise(editingExercise.id);
    setLoading(false);
    if (!result.success) { setError(result.error ?? "Failed to delete exercise"); return; }
    closeEdit();
    setSelectedExercise(null);
    router.refresh();
  }

  function resetForm() {
    setName(""); setCategory("strength"); setBodyArea("");
    setMuscleGroup(""); setEquipment(""); setMovementPattern(""); setExType("");
    setError("");
  }

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!editingExercise || !name.trim()) return;
    setLoading(true);
    setError("");
    const result = await updateCustomExercise(editingExercise.id, {
      name: name.trim(), category, isCustom: true,
      bodyArea: bodyArea || undefined, muscleGroup: muscleGroup || undefined,
      equipment: equipment || undefined, movementPattern: movementPattern || undefined,
      exerciseType: exType || undefined,
    });
    setLoading(false);
    if (!result.success) { setError(result.error ?? "Failed to update exercise"); return; }
    setSelectedExercise(result.data);
    closeEdit();
    router.refresh();
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError("");
    const result = await createCustomExercise({
      name: name.trim(), category, isCustom: true,
      bodyArea: bodyArea || undefined, muscleGroup: muscleGroup || undefined,
      equipment: equipment || undefined, movementPattern: movementPattern || undefined,
      exerciseType: exType || undefined,
    });
    setLoading(false);
    if (!result.success) { setError(result.error ?? "Failed to create exercise"); return; }
    resetForm();
    setShowForm(false);
    router.refresh();
  }

  // ── Compute back action based on current navigation depth ──────────────────
  function handleBack() {
    if (editingExercise) { closeEdit(); return; }
    if (selectedExercise) { setSelectedExercise(null); return; }
    if (subCategory !== null) { setSubCategory(null); return; }
    if (view !== "menu") { setView("menu"); return; }
    if (onBack) { onBack(); return; }
    router.push("/more");
  }

  // ── Compute right header action ────────────────────────────────────────────
  const headerRight = selectedExercise?.isCustom && !editingExercise ? (
    <button
      onClick={() => openEdit(selectedExercise)}
      className="min-h-[44px] px-1 text-primary text-base active:opacity-70"
    >
      Edit
    </button>
  ) : null;

  // ── Compute scrollable content ─────────────────────────────────────────────
  const viewLabel = MENU_ITEMS.find((m) => m.id === view)?.label ?? "My Exercises";

  let content: React.ReactNode;

  if (editingExercise) {
    content = (
      <>
        <h1 className="text-3xl font-bold tracking-tight mb-6">Edit Exercise</h1>
        <div className="bg-card rounded-2xl p-4 space-y-3">
          <form onSubmit={handleUpdate} className="space-y-3">
            <ExerciseFormFields
              name={name} setName={setName}
              category={category} setCategory={setCategory}
              bodyArea={bodyArea} setBodyArea={setBodyArea}
              muscleGroup={muscleGroup} setMuscleGroup={setMuscleGroup}
              equipment={equipment} setEquipment={setEquipment}
              movementPattern={movementPattern} setMovementPattern={setMovementPattern}
              exType={exType} setExType={setExType}
              error={error} loading={loading} submitLabel={loading ? "Saving…" : "Save Changes"}
            />
          </form>
        </div>
        <button
          onClick={handleDelete}
          disabled={loading}
          className="w-full mt-4 flex items-center justify-center gap-2 py-4 rounded-2xl text-destructive bg-destructive/10 active:bg-destructive/20 transition-colors disabled:opacity-50"
        >
          <Trash2 className="w-4 h-4" />
          <span className="text-base font-semibold">Delete Exercise</span>
        </button>
      </>
    );
  } else if (selectedExercise) {
    content = <DetailView exercise={selectedExercise} />;
  } else if (view !== "menu" && subCategory !== null) {
    const config = GROUP_CONFIG[view as keyof typeof GROUP_CONFIG];
    const filtered = config ? exercises.filter((ex) => ex[config.key] === subCategory) : [];
    const subLabel = config?.labels[subCategory] ?? capitalize(subCategory);
    content = (
      <FlatExerciseList
        title={subLabel}
        exercises={filtered}
        onOpen={setSelectedExercise}
        onSelect={onSelectExercise ? handleSelectExercise : undefined}
        selectLoading={selectLoading}
      />
    );
  } else if (view !== "menu" && view in GROUP_CONFIG) {
    const config = GROUP_CONFIG[view as keyof typeof GROUP_CONFIG];
    const present = new Set(exercises.map((ex) => ex[config.key] as string).filter(Boolean));
    const items = config.order.filter((k) => present.has(k)).map((k) => ({ key: k, label: config.labels[k] }));
    content = <CategoryList title={viewLabel} items={items} onSelect={(key) => setSubCategory(key)} />;
  } else if (view !== "menu") {
    const filtered =
      view === "timed" ? exercises.filter((ex) => ex.isTimed || ex.category === "cardio") :
      view === "custom" ? exercises.filter((ex) => ex.isCustom) :
      exercises;
    content = (
      <FlatExerciseList
        title={viewLabel}
        exercises={filtered}
        onOpen={setSelectedExercise}
        onSelect={onSelectExercise ? handleSelectExercise : undefined}
        selectLoading={selectLoading}
      />
    );
  } else {
    // Menu view
    const searchFiltered = menuSearch.trim()
      ? exercises.filter((ex) => ex.name.toLowerCase().includes(menuSearch.trim().toLowerCase()))
      : null;

    content = (
      <>
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-3xl font-bold tracking-tight">Exercises</h1>
          <button
            onClick={() => { setShowForm(true); setError(""); }}
            className="flex items-center justify-center w-10 h-10 rounded-full border border-border text-foreground active:opacity-70"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>
        <SearchBar value={menuSearch} onChange={setMenuSearch} />

        {showForm && (
          <div className="bg-card rounded-2xl p-4 mt-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">New Exercise</p>
              <button
                onClick={() => setShowForm(false)}
                className="text-muted-foreground min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-3">
              <ExerciseFormFields
                name={name} setName={setName}
                category={category} setCategory={setCategory}
                bodyArea={bodyArea} setBodyArea={setBodyArea}
                muscleGroup={muscleGroup} setMuscleGroup={setMuscleGroup}
                equipment={equipment} setEquipment={setEquipment}
                movementPattern={movementPattern} setMovementPattern={setMovementPattern}
                exType={exType} setExType={setExType}
                error={error} loading={loading} submitLabel={loading ? "Creating…" : "Create Exercise"}
              />
            </form>
          </div>
        )}

        {searchFiltered ? (
          <div className="bg-card rounded-2xl overflow-hidden mt-4">
            {searchFiltered.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">No exercises found.</p>
            ) : (
              searchFiltered.map((ex) => (
                <ExerciseRow
                  key={ex.id}
                  exercise={ex}
                  onOpen={setSelectedExercise}
                  onSelect={onSelectExercise ? handleSelectExercise : undefined}
                  selectLoading={selectLoading}
                />
              ))
            )}
          </div>
        ) : (
          <div className="bg-card rounded-2xl overflow-hidden mt-3">
            {MENU_ITEMS.map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => setView(id)}
                className="flex items-center gap-2.5 w-full px-4 py-2.5 min-h-[44px] border-b border-border/50 last:border-0 active:bg-muted/50 transition-colors"
              >
                <div className="w-8 h-8 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 text-primary" />
                </div>
                <span className="flex-1 text-left font-medium">{label}</span>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </button>
            ))}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Fixed header — back button never moves */}
      <div className="shrink-0 flex items-center justify-between px-4 pt-6 pb-2 min-h-[56px]">
        <button
          onClick={handleBack}
          className="flex items-center gap-0.5 min-h-[44px] text-primary active:opacity-70 -ml-1"
        >
          <ChevronLeft className="w-5 h-5" />
          <span className="text-base">Back</span>
        </button>
        {headerRight}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 pb-nav-safe">
        {content}
        <div aria-hidden="true" style={{ height: "var(--kb-height, 0px)" }} />
      </div>
    </div>
  );
}
