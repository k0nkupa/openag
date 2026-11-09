import type {Api} from '../api';
import type {Approval,BotInfo,ConversationRequest,Decision,WorkQuestion} from '../types';
import {ApprovalCard} from './ApprovalCard';
import {McpInteractionCard} from './McpInteractionCard';
import {Button} from './ui/button';
import {Alert,AlertDescription} from './ui/alert';
import {Message,MessageContent} from './ui/message';

export function ConversationRequests({api,requests,approvals,bots,onDecide,onReply,visibleQuestions,refresh,error,more,canManage=false}:{api:Api;requests:ConversationRequest[];approvals:Approval[];bots:BotInfo[];onDecide:(id:string,decision:Decision)=>Promise<void>;onReply:(question:WorkQuestion)=>void;visibleQuestions:ReadonlySet<string>;refresh:()=>void;error?:string;more?:()=>void;canManage?:boolean}){
  return <>
    {error&&<Alert variant="destructive"><AlertDescription>Could not load conversation requests: {error} <Button variant="outline" onClick={refresh}>Retry</Button></AlertDescription></Alert>}
    {approvals.map(approval=><Message key={approval.id} align="start"><MessageContent><ApprovalCard approval={approval} onDecide={onDecide} inline botName={bots.find(bot=>bot.id===approval.botId)?.name}/></MessageContent></Message>)}
    {requests.filter(request=>request.kind!=='provider'||canManage).map(request=>request.kind==='provider'?<Message key={request.id} align="start"><MessageContent><McpInteractionCard api={api} id={request.id} onChange={refresh}/></MessageContent></Message>:request.question&&!visibleQuestions.has(request.id)?<Message key={request.id} align="start"><MessageContent><p>{bots.find(bot=>bot.id===request.question!.botId)?.name??request.question.botId}</p><p className="whitespace-pre-wrap">{request.question.prompt??request.question.context}</p>{canManage&&<Button variant="outline" onClick={()=>onReply(request.question!)}>Reply</Button>}</MessageContent></Message>:null)}
    {more&&<Button variant="ghost" onClick={more}>Earlier pending requests</Button>}
  </>;
}
