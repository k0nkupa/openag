import type { ReactNode } from "react";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

export function ProactiveCard({ title, description, action, children }: { title: string; description?: string; action?: ReactNode; children: ReactNode }) {
  return <Card role="region" aria-label={title}>
    <CardHeader>
      <CardTitle><h2 className="m-0 text-base font-medium">{title}</h2></CardTitle>
      {description && <CardDescription>{description}</CardDescription>}
      {action && <CardAction>{action}</CardAction>}
    </CardHeader>
    <CardContent className="flex min-w-0 flex-col gap-5">{children}</CardContent>
  </Card>;
}
