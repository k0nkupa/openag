import {useEffect,useRef,useState} from 'react';
import {messageOf,type Api} from './api';
import type {ConversationRequest} from './types';
import {useStream} from './stream';

export function useConversationRequests(api:Api,roomId:string){
  const {subscribe}=useStream();
  const [requests,setRequests]=useState<ConversationRequest[]>([]),[error,setError]=useState<string>(),[cursor,setCursor]=useState<string|null>(null);
  const controls=useRef({refresh:()=>{},more:()=>{}});
  useEffect(()=>{
    let active=true,busy=false,queued=false,pages=1,next:string|null=null,timer:ReturnType<typeof setTimeout>|undefined;
    setRequests([]);setError(undefined);setCursor(null);
    const schedule=()=>{if(timer===undefined)timer=setTimeout(()=>{timer=undefined;void load();},100);};
    async function load(){
      if(busy){queued=true;return;}busy=true;
      try{
        const rows:ConversationRequest[]=[];let before:string|undefined;
        for(let page=0;page<pages;page++){
          const result=await api.conversationRequests(roomId,before);if(!active)return;
          rows.push(...result.requests);next=result.nextCursor;if(!next)break;before=next;
        }
        if(active){setRequests([...new Map(rows.map(row=>[row.id,row])).values()]);setCursor(next);setError(undefined);}
      }catch(err){if(active)setError(messageOf(err));}
      finally{busy=false;if(active&&queued){queued=false;schedule();}}
    }
    controls.current={refresh:()=>void load(),more:()=>{if(!busy&&next){pages++;void load();}}};
    void load();const off=subscribe({onOpen:schedule,onEvent:event=>{if(event.roomId===roomId&&['question_updated','mcp_interaction_updated'].includes(event.type))schedule();}});
    return()=>{active=false;clearTimeout(timer);off();};
  },[api,roomId,subscribe]);
  return {requests,error,cursor,refresh:()=>controls.current.refresh(),more:()=>controls.current.more()};
}
