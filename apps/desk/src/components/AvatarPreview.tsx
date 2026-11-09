import { Card, CardContent } from "./ui/card";
import { useMemo } from 'react';
import { validateAvatar } from 'open-bot-avatar';
import { BotAvatar } from './BotAvatar';
import { Badge } from './ui/badge';
import { useAvatarLibrary } from '../avatar-library';
export function AvatarPreview({ definition, previewId }: { definition: unknown; previewId?: string }) {
  const valid = useMemo(() => validateAvatar(definition), [definition]);
  const library = useAvatarLibrary();
  if (!valid.ok) return <p role="status">Avatar preview unavailable.</p>;
  const added = library.avatars.some(item => item.id === `custom:${previewId}`);
  return <Card role="region" aria-label={`Avatar preview: ${valid.value.name}`}><CardContent className="flex min-w-0 flex-col gap-3">
    <BotAvatar name={valid.value.id} definition={valid.value} size={112} />
    <div className="space-y-2"><p className="font-medium">{valid.value.name}</p><Badge variant={added ? 'success' : 'attention'}>{added ? 'In avatar library' : 'Preview only'}</Badge><p className="max-w-64 text-sm text-muted-foreground">{added ? 'Available in every agent’s avatar picker. Select it there to change an avatar.' : 'Adding this character to the shared picker requires your approval.'}</p></div>
  </CardContent></Card>;
}
