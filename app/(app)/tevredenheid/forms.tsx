"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { uploadExcel, vernieuwFormulieren } from "./actions";
import type { ActionState } from "../inzetten/actions";

const Msg = ({ state }: { state: ActionState }) => (state ? <span className={state.ok ? "text-xs text-emerald-700" : "text-xs text-destructive"}>{state.message}</span> : null);

export function ExcelUploadForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(uploadExcel, null);
  return (
    <form action={action} className="space-y-2">
      <Input type="file" name="bestand" accept=".xlsx,.xls,.csv" />
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Inlezen…" : "Excel inlezen"}
        </Button>
        <Msg state={state} />
      </div>
    </form>
  );
}

export function VernieuwFormulierenButton() {
  const [state, action, pending] = useActionState<ActionState>(vernieuwFormulieren, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Ophalen…" : "Formulieren opnieuw ophalen"}
      </Button>
      <Msg state={state} />
    </form>
  );
}
