import Link from "next/link";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { SortKolom, SortRichting } from "@/lib/inzetten/sort";

/**
 * Kolomkop die het overzicht sorteert: een klik sorteert oplopend, nog een klik aflopend. Filters in de URL
 * (zoekterm, status, klant) blijven behouden.
 */
export function SortHeader({
  kolom,
  label,
  huidig,
  params,
  basis = "/inzetten",
  className,
  titel,
}: {
  kolom: SortKolom;
  label: string;
  huidig: { kolom: SortKolom; dir: SortRichting };
  params: Record<string, string | undefined>;
  basis?: string;
  className?: string;
  titel?: string;
}) {
  const actief = huidig.kolom === kolom;
  const volgende: SortRichting = actief && huidig.dir === "asc" ? "desc" : "asc";
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  qs.set("sort", kolom);
  qs.set("dir", volgende);
  return (
    <TableHead className={className} aria-sort={actief ? (huidig.dir === "asc" ? "ascending" : "descending") : "none"}>
      <Link href={`${basis}?${qs.toString()}`} title={titel ?? `Sorteer op ${label.toLowerCase()}`} className={cn("inline-flex items-center gap-1 hover:underline", actief && "font-semibold text-foreground")}>
        {label}
        <span aria-hidden className={cn("text-xs", actief ? "opacity-100" : "opacity-30")}>
          {actief ? (huidig.dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </Link>
    </TableHead>
  );
}
