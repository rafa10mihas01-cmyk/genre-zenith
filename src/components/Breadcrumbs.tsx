import { Link, useLocation } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";
import { Fragment } from "react";

const ROUTE_LABELS: Record<string, string> = {
  "": "Início",
  dashboard: "Dashboard",
  brain: "Cérebro",
  models: "Modelos",
  genres: "Gêneros",
  collect: "Coleta",
  logs: "Logs",
  settings: "Configurações",
  login: "Login",
};

function labelFor(segment: string) {
  return ROUTE_LABELS[segment] ?? decodeURIComponent(segment).replace(/-/g, " ");
}

export function Breadcrumbs() {
  const { pathname } = useLocation();
  const segments = pathname.split("/").filter(Boolean);

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs min-w-0">
      <Link
        to="/"
        className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors shrink-0"
      >
        <Home className="h-3.5 w-3.5" />
      </Link>
      {segments.map((seg, i) => {
        const path = "/" + segments.slice(0, i + 1).join("/");
        const isLast = i === segments.length - 1;
        return (
          <Fragment key={path}>
            <ChevronRight className="h-3 w-3 text-muted-foreground/50 shrink-0" />
            {isLast ? (
              <span className="text-foreground font-medium truncate capitalize">
                {labelFor(seg)}
              </span>
            ) : (
              <Link
                to={path}
                className="text-muted-foreground hover:text-foreground transition-colors capitalize truncate"
              >
                {labelFor(seg)}
              </Link>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
