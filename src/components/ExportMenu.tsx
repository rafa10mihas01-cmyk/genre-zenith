import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Download, FileJson, FileSpreadsheet } from "lucide-react";

interface Props {
  onCSV?: () => void;
  onJSON?: () => void;
  disabled?: boolean;
  label?: string;
  size?: "sm" | "default";
}

export default function ExportMenu({ onCSV, onJSON, disabled, label = "Exportar", size = "sm" }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size={size} disabled={disabled}>
          <Download className="h-4 w-4" />
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {onCSV && (
          <DropdownMenuItem onClick={onCSV}>
            <FileSpreadsheet className="h-4 w-4" />
            Baixar CSV
          </DropdownMenuItem>
        )}
        {onJSON && (
          <DropdownMenuItem onClick={onJSON}>
            <FileJson className="h-4 w-4" />
            Baixar JSON
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
