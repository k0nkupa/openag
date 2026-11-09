import { useState } from 'react';
import type { BrandId } from './brand-logo';
import { BookOpen, CalendarDays, FileSearch, Folder, GitBranch, Globe, Mail, MessageSquare, PanelsTopLeft, type LucideIcon } from 'lucide-react';

export type LibraryApp = {
  id: string; name: string; description: string; category: string; kind: 'Connector' | 'Local app';
  icon: LucideIcon; brand?: BrandId; delivery: 'Account connection' | 'Local connector' | 'App package';
  setup: 'account' | 'folder' | 'label' | 'none'; requirement: string;
  tools: { name: string; mode: 'Read / search' | 'Ask' | 'Always ask' }[];
};
export type AppInstallation = { status: 'setup' | 'ready' | 'paused'; label: string; config: string; added: string; checked?: string };
export const libraryApps: LibraryApp[] = [
  { id:'notes', name:'Workspace notes', description:'Keep Markdown notes close to your agents and easy to find again.', category:'Files & knowledge', kind:'Local app', icon:BookOpen, delivery:'App package', setup:'folder', requirement:'A notes folder on host.', tools:[{name:'Read and search notes',mode:'Read / search'},{name:'Save or change a note',mode:'Ask'}] },
  { id:'documents', name:'Document tools', description:'Extract text and tables from documents for research and comparison.', category:'Files & knowledge', kind:'Local app', icon:FileSearch, delivery:'App package', setup:'none', requirement:'Runs locally on the OpenAg machine.', tools:[{name:'Read supplied documents',mode:'Read / search'}] },
  { id:'github', brand:'github', name:'GitHub', description:'Bring repository activity, issues, and reviews into your agents’ work.', category:'Development', kind:'Connector', icon:GitBranch, delivery:'Account connection', setup:'account', requirement:'A GitHub account and selected repositories.', tools:[{name:'Read repositories, issues and reviews',mode:'Read / search'},{name:'Post comments or update issues',mode:'Always ask'}] },
  { id:'gmail', brand:'gmail', name:'Gmail', description:'Find the right message and prepare replies with the full context.', category:'Productivity', kind:'Connector', icon:Mail, delivery:'Account connection', setup:'account', requirement:'A Google account with mail access.', tools:[{name:'Read and search mail',mode:'Read / search'},{name:'Send a reviewed message',mode:'Always ask'}] },
  { id:'calendar', brand:'calendar', name:'Google Calendar', description:'Check availability and prepare events without leaving your desk.', category:'Productivity', kind:'Connector', icon:CalendarDays, delivery:'Account connection', setup:'account', requirement:'A Google account and calendars you select.', tools:[{name:'Read events and availability',mode:'Read / search'},{name:'Create or change an event',mode:'Always ask'}] },
  { id:'slack', brand:'slack', name:'Slack', description:'Give your agents context from channels and prepare team updates.', category:'Productivity', kind:'Connector', icon:MessageSquare, delivery:'Account connection', setup:'account', requirement:'A Slack workspace and channel access.', tools:[{name:'Read selected channels',mode:'Read / search'},{name:'Post a message',mode:'Always ask'}] },
  { id:'linear', brand:'linear', name:'Linear', description:'Turn project context into clear issues, updates, and next steps.', category:'Development', kind:'Connector', icon:PanelsTopLeft, delivery:'Account connection', setup:'account', requirement:'A Linear account and selected teams.', tools:[{name:'Read projects and issues',mode:'Read / search'},{name:'Create or change issues',mode:'Always ask'}] },
  { id:'brave', brand:'brave', name:'Brave Search', description:'Find public sources and bring useful evidence back to a conversation.', category:'Research', kind:'Connector', icon:Globe, delivery:'Local connector', setup:'label', requirement:'A search API credential on the OpenAg machine.', tools:[{name:'Search the public web',mode:'Read / search'}] },
  { id:'filesystem', name:'Filesystem', description:'Read and organise files in a folder on your OpenAg machine.', category:'Files & knowledge', kind:'Connector', icon:Folder, delivery:'Local connector', setup:'folder', requirement:'A folder on host for the connector to use.', tools:[{name:'Read and search files',mode:'Read / search'},{name:'Create or edit files',mode:'Ask'}] },
];
export function installationLabel(app: LibraryApp, install?: AppInstallation) {
  if (!install) return 'Not added';
  return install.status === 'setup' ? 'Needs setup' : install.status === 'paused' ? 'Paused' : app.kind === 'Connector' ? 'Connected' : 'Ready';
}
const initialInstallations: Record<string, AppInstallation> = {
  github:{status:'ready',label:'Personal repositories',config:'Example account · selected repositories',added:'Earlier',checked:'Today, 08:30'},
  gmail:{status:'ready',label:'Personal mail',config:'Example Google account',added:'Earlier',checked:'Today, 08:30'},
  brave:{status:'ready',label:'Public web search',config:'Example server credential',added:'Earlier',checked:'Today, 08:30'},
  filesystem:{status:'ready',label:'Agent workspace',config:'/workspace',added:'Earlier',checked:'Today, 08:30'},
};
export function useAppLibrary(announce: (message: string) => void) {
  const [appInstallations, setInstallations] = useState(initialInstallations);
  const [libraryDialogId, setLibraryDialogId] = useState<string | null>(null);
  const [libraryStage, setLibraryStage] = useState<'details'|'setup'|'added'>('details');
  function openLibraryApp(id: string) { if (!libraryApps.some(a => a.id === id)) return; setLibraryStage('details'); setLibraryDialogId(id); }
  function addLibraryApp(id: string) {
    const app = libraryApps.find(a => a.id === id); if (!app || appInstallations[id]) return;
    setInstallations(rows => rows[id] ? rows : {...rows,[id]:{status:app.setup === 'none' ? 'ready' : 'setup',label:app.name,config:'',added:'Now'}});
    setLibraryStage(app.setup === 'none' ? 'added' : 'setup');
    announce(`${app.name} added to the sample host library. No software was installed.`);
  }
  function configureLibraryApp(id: string, label: string, config: string) {
    if (!libraryApps.some(a => a.id === id) || !appInstallations[id] || !label.trim() || !config.trim()) return;
    setInstallations(rows => ({...rows,[id]:{...rows[id],status:'ready',label:label.trim(),config:config.trim(),checked:undefined}}));
    setLibraryStage('added'); announce('Sample setup complete. No account, credential or folder was accessed.');
  }
  function enableLibraryApp(id: string, enabled: boolean) {
    setInstallations(rows => !rows[id] || rows[id].status === 'setup' ? rows : {...rows,[id]:{...rows[id],status:enabled ? 'ready' : 'paused'}});
    announce(`App ${enabled ? 'enabled' : 'paused'} locally.`);
  }
  function removeLibraryApp(id: string) {
    setInstallations(rows => { const next={...rows}; delete next[id]; return next; });
    setLibraryDialogId(null); announce('Removed from the sample machine. No real software or connection changed.');
  }
  function checkLibraryApp(id: string) {
    setInstallations(rows => !rows[id] || rows[id].status !== 'ready' ? rows : {...rows,[id]:{...rows[id],checked:'Now'}});
    announce('Sample connection check passed. No service was contacted.');
  }
  return {appInstallations,libraryDialogId,setLibraryDialogId,libraryStage,setLibraryStage,openLibraryApp,addLibraryApp,configureLibraryApp,enableLibraryApp,removeLibraryApp,checkLibraryApp};
}
export type AppLibraryState = ReturnType<typeof useAppLibrary>;
