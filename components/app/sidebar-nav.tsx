"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Briefcase,
  FileText,
  Building2,
  Inbox,
  ListChecks,
  Receipt,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/inzetten", label: "Inzetten", icon: Briefcase },
  { href: "/medewerkers", label: "Medewerkers", icon: Users },
  { href: "/contracten", label: "Contracten", icon: FileText },
  { href: "/klanten", label: "Klanten", icon: Building2 },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/acties", label: "Acties", icon: ListChecks },
  { href: "/facturatie", label: "Facturatie", icon: Receipt },
  { href: "/instellingen", label: "Instellingen", icon: Settings },
] as const;

export function SidebarNav({ badges }: { badges?: Partial<Record<string, number>> }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1">
      {items.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        const badge = badges?.[href];
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            <span className="flex-1">{label}</span>
            {badge ? (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-medium",
                  active ? "bg-primary-foreground/20" : "bg-muted-foreground/15",
                )}
              >
                {badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
