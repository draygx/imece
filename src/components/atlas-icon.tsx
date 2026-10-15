import atlasIconUrl from "@/assets/atlas-icon.svg";
import { cn } from "@/lib/utils";

interface AtlasIconProps {
  size?: number;
  className?: string;
  alt?: string;
}

export function AtlasIcon({ size = 32, className, alt = "İmece" }: AtlasIconProps) {
  return (
    <img
      src={atlasIconUrl}
      width={size}
      height={size}
      alt={alt}
      draggable={false}
      className={cn("select-none", className)}
      style={{ width: size, height: size }}
    />
  );
}
