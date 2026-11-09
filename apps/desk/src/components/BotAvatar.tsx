import type { AvatarDefinition } from "open-bot-avatar";
import { useAvatarLibrary } from "../avatar-library";
import { useEffect, useMemo, useRef, useState } from "react";
import { mountAvatar, type AvatarOptions, type MountedAvatar } from "open-bot-avatar/dom";
import type { Avatar } from "../types";
import { avatarCharacter, avatarColors, avatarDefinition, avatarFor } from "./avatar-catalogue";

export type AvatarMood = "idle" | "thinking" | "waiting" | "happy";
export function BotAvatar({ name, avatar, size = 26, mood, depth = false, gaze = [0, 0], view = [0, 0], definition, still = false }: {
  name: string; definition?: AvatarDefinition; avatar?: Avatar | null; size?: number; mood?: AvatarMood; depth?: boolean;
  gaze?: [number, number]; view?: [number, number]; still?: boolean;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const mounted = useRef<MountedAvatar | null>(null);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (!depth) return;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [depth]);
  const library = useAvatarLibrary();
  const custom = library.avatars.find(item => item.id === avatar?.shape);
  const auto = avatarFor(name);
  const shape = custom?.id ?? avatarCharacter(avatar?.shape, name);
  const color = avatar?.color ?? auto.color;
  const animated = !still && (avatar?.animated ?? true);
  const moving = animated && !reduced;
  const expression = mood === "waiting" ? "idle" : mood ?? "idle";
  const resolvedDefinition = definition ?? custom?.definition ?? avatarDefinition(avatarCharacter(shape as Avatar["shape"], name));
  const options = useMemo<AvatarOptions>(() => ({
    definition: resolvedDefinition, color: avatarColors[color], eyeColor: "#19251f", label: "",
    mood: expression, still: !animated,
    reducedMotion: moving ? "system" : true,
    lookAt: moving ? { x: gaze[0], y: gaze[1] } : { x: 0, y: 0 },
    view: moving ? { pitch: view[0] * Math.PI / 180, yaw: view[1] * Math.PI / 180 } : { pitch: 0, yaw: 0 },
  }), [resolvedDefinition, color, expression, animated, moving, gaze[0], gaze[1], view[0], view[1]]);
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    const element = host.current!;
    let disposed = false;
    const show = (visible: boolean) => {
      if (disposed) return;
      if (visible) mounted.current ??= mountAvatar(element, latest.current);
      else { mounted.current?.destroy(); mounted.current = null; }
    };
    show(true);
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.target === element) show(entry.isIntersecting);
    });
    observer?.observe(element);
    return () => { disposed = true; observer?.disconnect(); mounted.current?.destroy(); mounted.current = null; };
  }, []);
  useEffect(() => { mounted.current?.update(options); }, [options]);
  return <span ref={host} className="bot-avatar" style={{ width: size, height: size }} data-bot={name}
    data-shape={shape} data-color={color} data-mood={mood ?? "idle"} data-animated={animated} data-depth={depth} aria-hidden="true" />;
}
