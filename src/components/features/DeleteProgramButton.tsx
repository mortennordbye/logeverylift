"use client";

import { deleteProgram } from "@/lib/actions/programs";
import { Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  programId: number;
  programName: string;
};

export function DeleteProgramButton({ programId, programName }: Props) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm(`Delete "${programName}" and all its exercises?`)) return;

    setDeleting(true);
    await deleteProgram(programId);
    router.push("/programs");
  };

  return (
    <button
      onClick={handleDelete}
      disabled={deleting}
      className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-destructive/10 active:bg-destructive/20 transition-colors disabled:opacity-50"
      title="Delete program"
    >
      <Trash2Icon className="h-4 w-4 text-destructive" />
    </button>
  );
}
