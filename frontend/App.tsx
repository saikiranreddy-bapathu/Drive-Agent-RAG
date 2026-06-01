import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from './context/AuthContext';
import { HardDrive, FolderHeart, Send, Loader2, Link2, LogOut, FileText, CheckCircle2 } from 'lucide-react';

type Folder = {
  id: string;
  name: string;
};

type Message = {
  id: string;
  role: 'user' | 'agent';
  content: string;
  citations?: string[];
};

export default function App() {
  const { user, loading, connectDrive, disconnectDrive } = useAuth();
  
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<Folder | null>(null);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [indexedData, setIndexedData] = useState<{fileCount: number, indexedCount: number, files?: {id: string, name: string}[]} | null>(null);
  
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', role: 'agent', content: 'Hello! Please select a Google Drive folder, and I will be ready to answer your questions strictly based on its contents.' }
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchFolders = async () => {
    setLoadingFolders(true);
    try {
      const res = await fetch('/api/drive/folders', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('drive_auth_token')}`
        }
      });
      let data;
      const responseText = await res.text();
      try {
        data = JSON.parse(responseText);
      } catch (err: any) {
        throw new Error(`Failed to parse response (Status ${res.status}): ${responseText || 'No text'}`);
      }
      if (data.folders) {
        setFolders(data.folders);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingFolders(false);
    }
  };

  useEffect(() => {
    if (user?.connected) {
      fetchFolders();
    }
  }, [user]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSelectFolder = async (f: Folder) => {
    setSelectedFolder(f);
    setIndexing(true);
    setIndexedData(null);
    try {
      const res = await fetch('/api/drive/index', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('drive_auth_token')}`
        },
        body: JSON.stringify({ folderId: f.id })
      });
      let data;
      const responseText = await res.text();
      try {
        data = JSON.parse(responseText);
      } catch (err: any) {
        throw new Error(`Failed to parse response (Status ${res.status}): ${responseText || 'No text'}`);
      }
      if (data.success) {
        setIndexedData({ fileCount: data.fileCount, indexedCount: data.indexedCount, files: data.files });
      } else {
        alert(data.error || 'Failed to index');
      }
    } catch (e) {
      console.error('Indexing failed', e);
    } finally {
      setIndexing(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || sending) return;
    const msgContext = input;
    setInput('');
    
    const newMessages = [...messages, { id: Date.now().toString(), role: 'user' as const, content: msgContext }];
    setMessages(newMessages);
    setSending(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('drive_auth_token')}`
        },
        body: JSON.stringify({ message: msgContext, folderId: selectedFolder?.id })
      });
      let data;
      const responseText = await res.text();
      try {
        data = JSON.parse(responseText);
      } catch (err: any) {
        throw new Error(`Failed to parse response (Status ${res.status}): ${responseText || 'No text'}`);
      }
      setMessages([...newMessages, { 
        id: (Date.now() + 1).toString(),
        role: 'agent',
        content: data.answer || data.error || 'Unknown error occurred.',
        citations: data.citations
      }]);
    } catch (e) {
      console.error(e);
      setMessages([...newMessages, { 
        id: (Date.now() + 1).toString(),
        role: 'agent',
        content: 'Failed to communicate with the server.',
      }]);
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#050505]">
        <Loader2 className="animate-spin w-8 h-8 text-blue-600" />
      </div>
    );
  }

  if (!user?.connected) {
    return (
      <div className="flex flex-col h-screen w-screen items-center justify-center bg-[#050505] text-gray-300 p-6 relative overflow-hidden">
        {/* Decorative background elements */}
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-blue-600/10 rounded-full blur-[120px] pointer-events-none"></div>
        <div className="absolute bottom-[-20%] right-[-10%] w-[40%] h-[40%] bg-emerald-600/10 rounded-full blur-[100px] pointer-events-none"></div>

        <div className="bg-[#0a0a0a] border border-white/5 p-10 rounded-3xl shadow-2xl max-w-lg w-full relative z-10">
          <div className="flex flex-col items-center mb-8">
            <div className="bg-gradient-to-br from-blue-500 to-indigo-600 w-20 h-20 rounded-2xl flex items-center justify-center text-white mb-6 shadow-[0_0_30px_rgba(37,99,235,0.3)] transform rotate-3 transition-transform hover:rotate-6">
              <HardDrive size={40} />
            </div>
            <h1 className="text-4xl font-serif italic tracking-tight text-white mb-3">DocuMind AI</h1>
            <p className="text-base text-gray-400 text-center max-w-sm leading-relaxed">
              Your intelligent research assistant. Chat with your Google Drive documents securely and instantly extract insights.
            </p>
          </div>

          <div className="space-y-4 mb-10">
            <div className="flex items-start gap-4 p-4 rounded-xl bg-white/[0.02] border border-white/[0.05]">
              <div className="bg-blue-500/20 p-2 rounded-lg text-blue-400 mt-0.5">
                <FolderHeart size={20} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-200 mb-1">Select Grounding Folders</h3>
                <p className="text-xs text-gray-500 leading-relaxed">DocuMind limits its knowledge to the specific drive folder you choose, ensuring highly relevant answers.</p>
              </div>
            </div>
            <div className="flex items-start gap-4 p-4 rounded-xl bg-white/[0.02] border border-white/[0.05]">
              <div className="bg-emerald-500/20 p-2 rounded-lg text-emerald-400 mt-0.5">
                <CheckCircle2 size={20} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-200 mb-1">Strict Citations</h3>
                <p className="text-xs text-gray-500 leading-relaxed">Every fact is backed by your documents. It won't hallucinate outside knowledge.</p>
              </div>
            </div>
          </div>

          <button 
            onClick={connectDrive}
            className="w-full py-4 px-6 bg-white hover:bg-gray-100 text-black rounded-xl font-semibold text-base transition-all transform hover:scale-[1.02] active:scale-[0.98] outline-none focus:ring-4 focus:ring-blue-500/30 flex items-center justify-center gap-3 shadow-xl"
          >
            <Link2 size={20} />
            Connect Google Drive to Start
          </button>

          <p className="text-[10px] text-center text-gray-600 mt-6 tracking-wide uppercase font-mono">
            Requires Google Drive Read-Only Permission
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-[#050505] text-gray-300 font-sans overflow-hidden">
      {/* Header Section */}
      <header className="h-16 border-b border-white/10 flex items-center justify-between px-8 bg-[#0a0a0a] flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <HardDrive className="w-5 h-5 text-white" />
          </div>
          <h1 className="font-serif italic text-xl text-white tracking-tight">DocuMind AI</h1>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-white/5 rounded-full border border-white/10">
            <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]"></div>
            <span className="text-xs font-medium uppercase tracking-widest text-emerald-500">Guardrails Active</span>
          </div>
          <button onClick={disconnectDrive} className="flex items-center gap-2 bg-white text-black px-4 py-2 rounded-md text-sm font-semibold hover:bg-gray-200 transition-colors">
            <LogOut className="w-4 h-4" />
            Disconnect
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-72 bg-[#0a0a0a] border-r border-white/10 flex flex-col flex-shrink-0">
          <div className="p-6 flex-1 overflow-y-auto">
            <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-4 block">Selected Directory</label>
            
            {loadingFolders ? (
              <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                <Loader2 size={16} className="animate-spin" /> Fetching folders...
              </div>
            ) : (
              <ul className="space-y-4 mb-6">
                {folders.map(f => (
                  <li key={f.id} className="block">
                    <button
                      onClick={() => handleSelectFolder(f)}
                      className={`w-full text-left flex items-center gap-3 p-3 rounded-xl border transition-colors ${selectedFolder?.id === f.id ? 'bg-white/5 border-white/10' : 'bg-transparent border-transparent hover:bg-white/5 hover:border-white/10'}`}
                    >
                      <FolderHeart size={20} className={selectedFolder?.id === f.id ? 'text-yellow-500' : 'text-gray-500'} />
                      <div className="overflow-hidden">
                        <p className={`text-sm font-semibold truncate ${selectedFolder?.id === f.id ? 'text-white' : 'text-gray-400'}`}>{f.name}</p>
                        {selectedFolder?.id === f.id && (
                           <p className="text-[10px] text-gray-500 mt-0.5">{indexedData?.fileCount || 0} Files ready</p>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
                {folders.length === 0 && (
                  <div className="text-sm text-gray-500 py-2">No folders found.</div>
                )}
              </ul>
            )}

            {selectedFolder && (
              <>
                <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-3 block mt-6">Knowledge Base</label>
                <div className="mb-6">
                  {indexing ? (
                    <div className="flex items-center gap-2 text-xs text-blue-400 bg-blue-900/20 p-3 rounded border border-blue-500/20">
                      <Loader2 size={14} className="animate-spin" /> Indexing documents...
                    </div>
                  ) : indexedData ? (
                    <div className="space-y-4">
                      <div className="flex items-start gap-2 text-xs text-emerald-400 bg-emerald-900/20 p-3 rounded border border-emerald-500/20">
                        <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                        <div>
                          Indexed {indexedData.fileCount} files<br/>
                          ({indexedData.indexedCount} textual chunks)
                        </div>
                      </div>
                      {indexedData.files && indexedData.files.length > 0 && (
                        <ul className="space-y-2 max-h-64 overflow-y-auto pr-2">
                          {indexedData.files.map(file => (
                            <li key={file.id} className="flex items-center gap-2 text-sm text-gray-400 group cursor-pointer hover:text-white">
                              <div className="w-1 h-1 rounded-full bg-blue-500 shrink-0"></div>
                              <span className="truncate" title={file.name}>{file.name}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </div>
          
          <div className="mt-auto p-6 border-t border-white/5">
            <div className="bg-blue-600/10 rounded-xl p-4 border border-blue-500/20">
              <p className="text-xs text-blue-300 font-medium leading-relaxed italic">
                "I will only answer questions based on the selected documents above."
              </p>
            </div>
          </div>
        </aside>

        {/* Chat Interface */}
        <main className="flex-1 flex flex-col bg-[#0d0d0d] relative">
          <div className="flex-1 p-8 overflow-y-auto space-y-8">
            {messages.map((m) => {
              if (m.role === 'user') {
                return (
                  <div key={m.id} className="flex justify-end">
                    <div className="max-w-[70%] bg-blue-600 text-white px-5 py-3 rounded-2xl rounded-tr-none shadow-lg">
                      <p className="text-sm whitespace-pre-wrap">{m.content}</p>
                    </div>
                  </div>
                );
              } else {
                return (
                  <div key={m.id} className="flex justify-start items-start gap-4">
                    <div className="w-8 h-8 rounded-full bg-white flex-shrink-0 flex items-center justify-center text-black font-serif italic text-xs font-bold">D</div>
                    <div className="max-w-[75%] space-y-4">
                      <div className="bg-[#1a1a1a] p-5 rounded-2xl rounded-tl-none border border-white/5">
                        <div className="text-sm leading-relaxed text-gray-200 whitespace-pre-wrap">{m.content}</div>
                      </div>
                      
                      {m.citations && m.citations.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {m.citations.map((c, i) => (
                            <div key={i} className="flex items-center gap-2 px-3 py-1 bg-white/5 border border-white/10 rounded-md">
                              <FileText className="w-3 h-3 text-emerald-500" />
                              <span className="text-[10px] font-mono text-gray-400">{c}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              }
            })}
            
            {sending && (
               <div className="flex justify-start items-start gap-4">
                 <div className="w-8 h-8 rounded-full bg-white flex-shrink-0 flex items-center justify-center text-black font-serif italic text-xs font-bold">D</div>
                 <div className="max-w-[75%] space-y-4">
                   <div className="bg-[#1a1a1a] p-5 rounded-2xl rounded-tl-none border border-white/5 flex items-center gap-3">
                     <Loader2 size={16} className="text-blue-500 animate-spin" />
                     <span className="text-sm text-gray-400">Analyzing documents...</span>
                   </div>
                 </div>
               </div>
            )}
            <div ref={messagesEndRef} />
          </div>
          
          {/* Input Bar */}
          <div className="p-6 bg-[#0a0a0a] border-t border-white/10 flex-shrink-0">
            <div className="relative flex items-center max-w-4xl mx-auto">
              <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSelectFolder && handleSend()}
                placeholder={selectedFolder ? "Ask about your documents..." : "Select a folder first to ask questions"}
                disabled={!selectedFolder || indexing || sending}
                className="w-full bg-[#151515] border border-white/10 rounded-2xl px-6 py-4 pr-24 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all placeholder:text-gray-600 text-gray-200 disabled:opacity-50"
              />
              <div className="absolute right-4 flex items-center gap-2">
                <kbd className="px-2 py-1 bg-white/5 border border-white/10 rounded text-[10px] text-gray-500 hidden sm:inline-block font-mono">ENTER</kbd>
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || !selectedFolder || indexing || sending}
                  className="p-2 bg-blue-600 text-white rounded-xl shadow-lg shadow-blue-600/20 disabled:bg-blue-600/50 disabled:shadow-none transition-all"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
            <p className="mt-3 text-[10px] text-center text-gray-600 tracking-wide uppercase">
              Strict Grounding Mode: AI will only reference provided drive files
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
