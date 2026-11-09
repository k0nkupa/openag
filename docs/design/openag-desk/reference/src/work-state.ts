import { useState } from 'react';
import type { Approval, Automation } from './data';
import { initialResults, initialRuns, initialWork, type DecisionReceipt, type InspectorTab, type ResultFile, type RoutineRun, type WorkItem } from './work-data';

export function useWorkState(announce: (message: string) => void) {
  const [work, setWork] = useState(initialWork);
  const [results, setResults] = useState(initialResults);
  const [receipts, setReceipts] = useState<DecisionReceipt[]>([{ id: 'receipt-a3', approvalId: 'a3', decision: 'accepted', body: 'Weekly progress: the new desk foundation is ready for review.', time: 'Yesterday, 16:05', outcome: 'completed' }]);
  const [runs, setRuns] = useState(initialRuns);
  const [selectedWorkId, selectWork] = useState('supplier');
  const [detailOpen, setDetailOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('work');
  const [resultId, setResultId] = useState<string | null>(null);
  const [reviewId, setReviewId] = useState('a1');
  function openWork(id: string, tab: InspectorTab = 'work') { selectWork(id); setInspectorTab(tab); setDetailOpen(true); }
  function workAction(id: string, action: 'answer' | 'retry' | 'finish' | 'cancel', answer?: string) {
    const current = work.find(w => w.id === id);
    if (!current || (action === 'answer' && (!answer?.trim() || current.status !== 'input')) || (action === 'retry' && (current.approvalId || !['failed', 'interrupted'].includes(current.status))) || (['finish', 'cancel'].includes(action) && (current.status !== 'working' || current.approvalId))) return;
    const status = action === 'finish' ? 'completed' : action === 'cancel' ? 'cancelled' : 'working';
    const text = action === 'answer' ? `Alex supplied: ${answer!.trim()}` : action === 'retry' ? 'Restarted the sample work after review. No external action was repeated.' : action === 'finish' ? 'Sample work completed and result saved.' : 'Sample work stopped. Existing results are kept.';
    setWork(rows => rows.map(w => w.id !== id ? w : { ...w, status, answer: answer?.trim() ?? w.answer, updated: 'Now', next: action === 'answer' ? 'Preparing the result using your answer.' : action === 'retry' ? 'Continuing the sample read-only work.' : action === 'finish' ? 'Your result is saved below.' : 'Stopped by you. Review before continuing.', steps: w.steps.map((s, i) => ({ ...s, state: action === 'finish' ? 'done' : (action === 'answer' && i === 1) ? 'done' : action === 'answer' && i === 2 ? 'active' : s.state })), activity: [...w.activity, { text, time: 'Now', bot: w.bot }] }));
    if (action === 'finish') setResults(rows => rows.some(r => r.id === `result-${id}`) ? rows : [...rows, { id: `result-${id}`, workId: id, name: `${id}-summary.md`, kind: 'note', state: 'Saved', summary: 'Saved result from the sample run.', body: `# ${current.title}\n\n${current.answer ? `Your brief: ${current.answer}\n\n` : ''}${id === 'budget' ? 'Shortlist prepared within the supplied budget. Delivery must be confirmed before any purchase.' : id === 'catalogue' ? 'Sample catalogue check completed. No material price change.' : id === 'release' ? 'Repository digest prepared. No external action was taken.' : 'Completed work collected. Supplier review and room metadata remain subject to their own approvals.'}` }]);
    announce(text);
  }
  function settleApproval(a: Approval, decision: Approval['status'], body?: string) {
    const related = work.find(w => w.approvalId === a.id);
    setReceipts(rows => [{ id: `receipt-${a.id}`, approvalId: a.id, workId: related?.id, decision, body: body ?? a.body, time: 'Now', outcome: ['accepted', 'edited'].includes(decision) ? 'pending' : 'not-run' }, ...rows.filter(r => r.approvalId !== a.id)]);
    if (related) setWork(rows => rows.map(w => w.id === related.id ? { ...w, status: ['accepted', 'edited'].includes(decision) ? 'working' : 'interrupted', next: ['accepted', 'edited'].includes(decision) ? 'Approved. Execution has not started.' : decision === 'responded' ? 'You requested a change. The previous action will not run.' : 'You ignored the action. Nothing will run.', updated: 'Now', activity: [...w.activity, { text: `Alex ${decision} the action. ${['accepted', 'edited'].includes(decision) ? 'Awaiting execution.' : 'No action was executed.'}`, time: 'Now', bot: w.bot }] } : w));
  }
  function executeSample(approvalId: string, outcome: 'completed' | 'failed' | 'unknown') {
    const receipt = receipts.find(r => r.approvalId === approvalId);
    if (!receipt || receipt.outcome !== 'pending' || !['accepted', 'edited'].includes(receipt.decision)) return;
    setReceipts(rows => rows.map(r => r.approvalId === approvalId ? { ...r, outcome } : r));
    const text = outcome === 'completed' ? 'Sample execution completed. Receipt saved.' : outcome === 'unknown' ? 'Outcome unknown. Check the target before any retry.' : 'Sample execution failed before any action was performed.';
    setWork(rows => rows.map(w => w.approvalId === approvalId ? { ...w, status: outcome === 'completed' ? 'completed' : 'failed', next: text, updated: 'Now', steps: w.steps.map(s => ({ ...s, state: outcome === 'completed' ? 'done' : s.state })), activity: [...w.activity, { text, time: 'Now', bot: w.bot }] } : w));
    if (outcome === 'completed') setResults(rows => rows.map(r => r.workId === receipt.workId && r.kind !== 'comparison' ? { ...r, state: 'Saved', body: r.kind === 'draft' ? receipt.body : r.body, summary: 'Sample execution complete · receipt saved.' } : r));
    announce(text + ' No real action occurred.');
  }
  function simulateRoutine(automation: Automation) {
    if (!automation.enabled) return;
    const quiet = ['prs', 'prices'].includes(automation.id);
    const run: RoutineRun = { id: crypto.randomUUID(), automationId: automation.id, time: 'Now', outcome: quiet ? 'Quiet' : 'Completed', summary: quiet ? 'Sample check completed. Nothing needs your attention.' : 'Sample result prepared for the next brief.', delivery: quiet ? 'Kept in history · no notification' : 'Added to the sample digest' };
    setRuns(rows => [run, ...rows]);
    announce('Sample run recorded. No schedule, agent or provider was called.');
  }
  return { work, setWork, results, receipts, runs, selectedWorkId, selectWork, detailOpen, setDetailOpen, inspectorTab, setInspectorTab, resultId, setResultId, reviewId, setReviewId, openWork, workAction, settleApproval, executeSample, simulateRoutine };
}
export type WorkState = ReturnType<typeof useWorkState>;
