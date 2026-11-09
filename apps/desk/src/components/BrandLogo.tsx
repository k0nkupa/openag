import { cn } from "@/lib/utils";

/** Local, licensed identity artwork. A logo says nothing about connection or publisher verification. */
export function BrandLogo({ brand, size = 28 }: { brand: string; size?: number }) {
  const name = brand === "claude-code" ? "claudecode" : brand;
  if (!["apple", "anthropic", "openai", "openrouter", "typesafe", "nebius", "ollama", "github", "linear", "claudecode", "codex", "brave", "composio"].includes(name)) return <span aria-hidden="true" className="inline-flex shrink-0 items-center justify-center rounded bg-muted text-xs text-muted-foreground" style={{ width: size, height: size }}>{brand.slice(0, 2).toUpperCase()}</span>;
  return <img className={cn("block flex-none object-contain", ["apple", "anthropic", "openai", "openrouter", "typesafe", "nebius", "ollama", "github", "linear"].includes(name) && "[[data-theme=dark]_&]:invert")} src={`/brands/${name}.${name === "composio" ? "png" : "svg"}`} alt="" aria-hidden="true" width={size} height={size} />;
}
