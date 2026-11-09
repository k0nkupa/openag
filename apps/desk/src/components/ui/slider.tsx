import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import { cn } from "cn";

export function Slider({ className, ...props }: SliderPrimitive.Root.Props<number>) {
  return <SliderPrimitive.Root data-slot="slider" className={cn("flex w-full min-w-0 touch-none items-center select-none data-disabled:opacity-50", className)} {...props}>
    <SliderPrimitive.Control className="flex h-11 w-full items-center">
      <SliderPrimitive.Track className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <SliderPrimitive.Indicator className="rounded-full bg-primary" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb aria-label={props["aria-label"]} className="block size-4 rounded-full border border-primary bg-background shadow-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 data-disabled:pointer-events-none" />
    </SliderPrimitive.Control>
  </SliderPrimitive.Root>;
}
