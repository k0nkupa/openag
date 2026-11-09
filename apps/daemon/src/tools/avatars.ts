import { z } from 'zod';
import { ActionFailure } from '../action-receipts.js';
import { AvatarError, avatarInput, type AvatarLibrary, type AvatarScope } from '../avatars.js';
import type { ToolDef, ToolExecContext } from './registry.js';

function scope(ctx: ToolExecContext): AvatarScope {
  if (!ctx.roomId || !ctx.turnId || !ctx.toolCallId || ctx.roomId.startsWith('_') || ctx.investigation || ctx.turnPolicy?.unattended) throw new AvatarError('Avatar generation requires an attended conversation.');
  return { botId: ctx.botId, roomId: ctx.roomId, turnId: ctx.turnId, toolCallId: ctx.toolCallId };
}
export function createAvatarTools(library?: AvatarLibrary): ToolDef[] {
  return [
    { name: 'avatar_preview',permission:()=>({approval:'allow'}),offlineSafe:true, effectScope:()=>({kind:'read'}),class: 'read', enabled: () => !!library, input: avatarInput,
      description: 'Validate a geometry-only Open Bot Avatar definition and show its rendered draft in this chat. Does not add it to the picker or select it. Then offer avatar_library_add for this exact returned previewId. Attended conversations only.',
      review(ctx) { scope(ctx); return {}; },
      async execute(ctx, args) { return library!.preview(scope(ctx), args); } },
    { name: 'avatar_library_add',permission:ctx=>({approval:ctx.permission?.mode==='danger-full-access'?'allow':'review'}),offlineSafe:true, class: 'act-local', enabled: () => !!library, editable: false,
      input: z.object({ previewId: z.string().uuid() }).strict(),
      description: 'Add an exact avatar_preview draft from this agent and conversation to the installation-wide picker library when requested. Full access registers without Inbox approval; Read Only and Workspace Write require Inbox review. Ask in chat if the desired design is unclear. Declining review leaves only the preview. Does not select or replace any agent avatar.',
      review(ctx, args) { return library!.review(scope(ctx), args.previewId); },
      async execute(ctx, args) {
        try {
          const current = scope(ctx);
          const review = ctx.review ?? (ctx.permission?.mode === 'danger-full-access' ? library!.review(current, args.previewId) : undefined);
          return library!.add(current, args.previewId, review);
        } catch (error) { if (error instanceof AvatarError) throw new ActionFailure(error.message, "not-run"); throw error; }
      },
      confirm: () => ({ outcome: 'completed', detail: 'The validated avatar is persisted in the shared picker library. No agent appearance was changed.' }) },
  ];
}
