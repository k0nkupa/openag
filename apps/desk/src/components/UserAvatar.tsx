import type { UserProfile } from "../types";

export function UserAvatar({ profile, size = 28 }: { profile: UserProfile; size?: number }) {
  return <span role="img" aria-label={`${profile.name}’s avatar`}>
    {profile.avatar ? <img src={profile.avatar} alt="" width={size} height={size} className="rounded-full object-cover" /> :
      <span className="grid place-items-center rounded-full border border-border text-xs text-muted-foreground" style={{ width: size, height: size }}>{profile.name === "You" ? "You" : Array.from(profile.name)[0]}</span>}
  </span>;
}
