import { createContext, useContext, useState, type CSSProperties, type ReactNode } from "react";
import type { BotId } from "./data";

// Original OpenAg silhouettes; the reference's assets and code are not bundled.
export const avatarPaths = {
  star: "M42 15C47 3 57 3 62 17L65 25C68 28 75 22 81 25C95 32 83 43 83 48C83 53 98 57 94 68C90 79 75 73 70 77C65 81 65 97 54 96C43 95 43 80 37 78C31 76 21 88 13 80C5 72 17 61 15 56C13 51 0 46 5 35C10 24 23 31 29 28C35 25 36 20 42 15Z",
  pebble: "M51 12C73 7 91 25 91 45C98 65 78 88 56 89C33 95 11 80 9 59C4 37 26 15 51 12Z",
  cloud: "M23 34C19 17 40 10 51 23C67 7 85 20 80 35C98 41 98 63 81 69C81 89 59 94 48 79C30 93 12 83 17 65C0 58 5 38 23 34Z",
  droplet: "M42 13C47 5 55 5 60 13C68 27 88 47 88 63C88 82 70 93 50 91C29 94 11 81 12 62C13 45 34 27 42 13Z",
  square: "M31 14H69Q86 14 86 31V69Q86 86 69 86H31Q14 86 14 69V31Q14 14 31 14Z",
  blob: "M49 13C72 8 91 28 88 51C94 76 71 91 49 86C25 92 10 73 14 51C8 28 26 10 49 13Z",
  circle: "M50 13A37 37 0 1 1 50 87A37 37 0 1 1 50 13Z",
  pill: "M29 25H71A25 25 0 0 1 71 75H29A25 25 0 0 1 29 25Z",
  triangle: "M44 17Q50 7 56 17L91 76Q97 87 84 87H16Q3 87 9 76Z",
  hexagon: "M31 14H69Q73 14 76 19L92 45Q95 50 92 55L76 81Q73 86 69 86H31Q27 86 24 81L8 55Q5 50 8 45L24 19Q27 14 31 14Z",
  controller: "M31 24C39 24 42 28 50 28C58 28 61 24 69 24C85 24 90 38 92 61C95 84 79 89 70 75L64 66H36L30 75C21 89 5 84 8 61C10 38 15 24 31 24Z",
  mug: "M24 17H65Q71 17 71 24V30H78C98 30 98 62 78 62H71V69Q71 84 54 84H34Q18 84 18 69V24Q18 17 24 17ZM71 39V53H77C85 53 85 39 77 39Z",
  sprout: "M23 38H77L72 78Q71 87 60 87H40Q29 87 28 78ZM47 38V29C29 29 20 20 20 10C37 9 49 16 50 26C52 12 65 5 81 8C80 23 68 32 53 31V38Z",
  chat: "M29 18H71Q88 18 88 35V61Q88 78 71 78H47L27 92L30 78H29Q12 78 12 61V35Q12 18 29 18Z",
};
export type AvatarShape = keyof typeof avatarPaths;
export const avatarColors = ["blue", "teal", "red", "orange", "amber", "green", "purple", "pink", "brown", "grey", "white"] as const;
export type AvatarColor = typeof avatarColors[number];
export type AvatarConfig = { shape: AvatarShape; color: AvatarColor | null; animated: boolean };
export type AvatarMood = "idle" | "thinking" | "waiting" | "happy";
export const defaultAvatars: Record<BotId, AvatarConfig> = {
  boss: { shape: "square", color: "blue", animated: true },
  researcher: { shape: "hexagon", color: "teal", animated: true },
  coder: { shape: "blob", color: "red", animated: true },
};
const AvatarContext = createContext<{
  avatars: Record<BotId, AvatarConfig>;
  saveAvatar: (bot: BotId, avatar: AvatarConfig) => void;
}>({ avatars: defaultAvatars, saveAvatar: () => {} });
export function AvatarProvider({ children }: { children: ReactNode }) {
  const [avatars, setAvatars] = useState(defaultAvatars);
  return <AvatarContext.Provider value={{ avatars, saveAvatar: (bot, avatar) => setAvatars(current => ({ ...current, [bot]: avatar })) }}>{children}</AvatarContext.Provider>;
}
export const useAvatars = () => useContext(AvatarContext);

// A rounded cross-section: wide at the centre, inset at the front and back.
const depthSlices = Array.from({ length: 25 }, (_, index) => {
  const t = index / 12 - 1;
  return { z: t * .145, scale: .84 + .16 * Math.sqrt(1 - t * t) };
});

export function BotAvatar({ config, size = 30, mood = "idle", depth = false, gaze = [0, 0] }: {
  config: AvatarConfig; size?: number; mood?: AvatarMood; depth?: boolean; gaze?: [number, number];
}) {
  const color = config.color ?? "blue";
  const style = { width: size, height: size, "--bot-color": `var(--bot-${color})`, "--bot-ink": "#19251f", "--bot-blink-delay": `${-Object.keys(avatarPaths).indexOf(config.shape) * .43}s` } as CSSProperties;
  const eyeY = config.shape === "sprout" ? 54 : config.shape === "triangle" ? 55 : 42;
  const eyeX = config.shape === "mug" ? 34 : 40;
  return <span className="bot-avatar" style={style} data-mood={mood} data-animated={config.animated} data-depth={depth} aria-hidden="true">
    <span className="bot-avatar-motion"><span className="bot-avatar-volume">
      {depth && depthSlices.map((slice, index) => <svg key={index} viewBox="0 0 100 100" className="bot-avatar-layer" style={{ transform: `translateZ(${slice.z * size}px) scale(${slice.scale})`, fill: "var(--bot-color)" }}><path d={avatarPaths[config.shape]} fillRule="evenodd" /></svg>)}
      <svg viewBox="0 0 100 100" className="bot-avatar-front" style={{ transform: depth ? `translateZ(${size * .145 + .1}px) scale(.84)` : undefined }}>
        <path className="bot-avatar-body" d={avatarPaths[config.shape]} fillRule="evenodd" />
        <g className="bot-avatar-gaze" style={{ transform: `translate(${config.animated ? gaze[0] : 0}px, ${config.animated ? gaze[1] : 0}px)` }}>
          {[eyeX, eyeX + 16].map((x, i) => <g key={i} className={`bot-eye bot-eye-${i}`} style={{ transformOrigin: `${x + 3}px ${eyeY + 8}px` }}>
            <rect className="bot-eye-open" x={x} y={eyeY} width="6" height="16" rx="3" />
            <path className="bot-eye-happy" d={`M${x - 1} ${eyeY + 9}Q${x + 3} ${eyeY - 1} ${x + 7} ${eyeY + 9}`} fill="none" strokeWidth="4" strokeLinecap="round" />
          </g>)}
        </g>
      </svg>
    </span></span>
  </span>;
}
