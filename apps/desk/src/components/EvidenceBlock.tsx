import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { CodeBlock, CodeBlockContent } from "./ui/code-block";

/** Exact stored text with shared presentation and keyboard-scrollable bounds. */
export function EvidenceBlock({ className, ...props }: ComponentProps<typeof CodeBlockContent>) {
  return <CodeBlock size="sm"><CodeBlockContent wrap className={cn("max-h-64", className)} {...props} /></CodeBlock>;
}
