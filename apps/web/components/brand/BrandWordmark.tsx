import { BRAND } from "../../lib/brand";

export function BrandWordmark({
  size = "md",
  variant = "default",
  className = "",
}: {
  size?: "sm" | "md" | "lg";
  /** Use on dark sidebar / hero backgrounds */
  variant?: "default" | "onDark";
  className?: string;
}) {
  const sizeClass =
    size === "sm" ? "text-sm" : size === "lg" ? "text-xl sm:text-2xl" : "text-base sm:text-lg";

  const poktClass = variant === "onDark" ? "text-white" : "pocket-gradient-text";
  const mcpClass = variant === "onDark" ? "text-white/85" : "text-pocket-foreground";

  return (
    <span className={`inline-flex items-baseline gap-1 font-bold tracking-tight ${sizeClass} ${className}`}>
      <span className={poktClass}>{BRAND.shortName}</span>
      <span className={mcpClass}>{BRAND.suffix}</span>
    </span>
  );
}
