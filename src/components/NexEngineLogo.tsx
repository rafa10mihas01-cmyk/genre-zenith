import { cn } from "@/lib/utils";
import logoSrc from "@/assets/nexengine-logo.png";

/**
 * NexEngine logomark — exact pixel trace from official reference.
 * Renders the official "N" mark with speed lines as a transparent PNG.
 *
 * Source aspect ratio: 192 × 108 (16:9-ish). The image preserves all sharp
 * angles, the 3 speed lines on the left, and the angular "N" form.
 */
export function NexEngineLogo({
  className,
  size = 40,
}: {
  className?: string;
  size?: number;
}) {
  // Maintain native aspect ratio (192:108). `size` controls the height.
  const height = size;
  const width = Math.round(size * (192 / 108));
  return (
    <img
      src={logoSrc}
      alt="NexEngine"
      width={width}
      height={height}
      className={cn("shrink-0 select-none", className)}
      draggable={false}
    />
  );
}
