import { examples } from "open-bot-avatar";
import { generatedAvatars } from "./avatar-generated";
import { AVATAR_SHAPES, type Avatar, type AvatarColor } from "../types";

type Character = (typeof AVATAR_SHAPES)[number];
export const avatarColors: Record<AvatarColor, string> = {
  red: "#e0574f", orange: "#e8923a", yellow: "#e6b93a", green: "#6fcf8e",
  mint: "#7ed69b", teal: "#5fbfa5", blue: "#5b8def", violet: "#7b6cf0", pink: "#d65db1",
  amber: "#eeb644", purple: "#a582e8", brown: "#ab7959", grey: "#929399", white: "#f2f1ed",
};
const definitions = Object.fromEntries([...examples, ...generatedAvatars].map(definition => [definition.id, definition]));
// Keep automatic appearances stable when the picker gains characters.
const defaultShapes = ["controller", "barbell", "mug", "lightbulb", "chat", "sprout", "watering-can"] as const;
const colors = Object.keys(avatarColors) as AvatarColor[];
function hash(key: string) {
  let value = 0;
  for (const c of key.toLowerCase()) value = (value * 31 + c.charCodeAt(0)) >>> 0;
  return value;
}
export function avatarFor(key: string): { shape: Character; color: AvatarColor } {
  const value = hash(key);
  return { shape: defaultShapes[value % defaultShapes.length], color: colors[(value >>> 3) % colors.length] };
}
export function avatarCharacter(shape: Avatar["shape"] | undefined, key: string): Character {
  return AVATAR_SHAPES.find(id => id === shape) ?? avatarFor(key).shape;
}
export function avatarDefinition(shape: Character) { return definitions[shape]; }
