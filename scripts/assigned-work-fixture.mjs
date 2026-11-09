// Explicit synthetic assignments for checks of existing Work behavior. Ordinary chat is verified separately.
import { getBot } from '../apps/daemon/dist/rooms.js';
export function assignedWorkDispatch(runner, db) {
  return async args => {
    const { room, botIds, message } = args;
    if (db.prepare('SELECT 1 FROM work_questions WHERE answer_message_id=?').get(message.id) ||
        db.prepare('SELECT 1 FROM work_recovery_actions WHERE message_id=?').get(message.id)) return runner.dispatch(args);
    await Promise.all(botIds.map(botId => {
      const bot = getBot(db, botId);
      const task = runner.work.begin({ roomId: room.id, botId, messageId: message.id });
      return runner.run(room, bot, message, undefined, { workId: task.workId });
    }));
  };
}
