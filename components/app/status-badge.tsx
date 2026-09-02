import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const INZET_STATUS: Record<string, { label: string; className: string }> = {
  actief: { label: "Actief", className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  verlengen: { label: "Verlengen", className: "bg-amber-100 text-amber-900 border-amber-200" },
  in_contact: { label: "In contact", className: "bg-sky-100 text-sky-900 border-sky-200" },
  contract_wachten: { label: "Contract afwachten", className: "bg-violet-100 text-violet-900 border-violet-200" },
  beeindigd: { label: "Beëindigd", className: "bg-muted text-muted-foreground" },
};

const ACTIE_STATUS: Record<string, { label: string; className: string }> = {
  open: { label: "Open", className: "bg-amber-100 text-amber-900 border-amber-200" },
  conceptmail_klaar: { label: "Concept klaar", className: "bg-sky-100 text-sky-900 border-sky-200" },
  verstuurd: { label: "Verstuurd", className: "bg-violet-100 text-violet-900 border-violet-200" },
  afgerond: { label: "Afgerond", className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  genegeerd: { label: "Genegeerd", className: "bg-muted text-muted-foreground" },
};

const MAIL_STATUS: Record<string, { label: string; className: string }> = {
  nieuw: { label: "Nieuw", className: "bg-muted" },
  verwerken: { label: "Verwerken…", className: "bg-sky-100 text-sky-900" },
  te_beoordelen: { label: "Te beoordelen", className: "bg-amber-100 text-amber-900 border-amber-200" },
  verwerkt: { label: "Verwerkt", className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  genegeerd: { label: "Genegeerd", className: "bg-muted text-muted-foreground" },
  fout: { label: "Fout", className: "bg-red-100 text-red-900 border-red-200" },
};

export function InzetStatusBadge({ status }: { status: string }) {
  const s = INZET_STATUS[status] ?? { label: status, className: "" };
  return (
    <Badge variant="outline" className={cn("font-medium", s.className)}>
      {s.label}
    </Badge>
  );
}

export function ActieStatusBadge({ status }: { status: string }) {
  const s = ACTIE_STATUS[status] ?? { label: status, className: "" };
  return (
    <Badge variant="outline" className={cn("font-medium", s.className)}>
      {s.label}
    </Badge>
  );
}

export function MailStatusBadge({ status }: { status: string }) {
  const s = MAIL_STATUS[status] ?? { label: status, className: "" };
  return (
    <Badge variant="outline" className={cn("font-medium", s.className)}>
      {s.label}
    </Badge>
  );
}

export const INZET_STATUS_LABELS = Object.fromEntries(Object.entries(INZET_STATUS).map(([k, v]) => [k, v.label]));
