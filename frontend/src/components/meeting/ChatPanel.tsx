'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Paperclip,
  Smile,
  X,
  Download,
  FileText,
  Lock,
  Sparkles,
} from 'lucide-react';
import { ChatMessage } from '@/types/meeting';

interface ChatPanelProps {
  messages: ChatMessage[];
  onSendMessage: (text: string, fileAttachment?: ChatMessage['fileAttachment']) => void;
  onClose: () => void;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({ messages, onSendMessage, onClose }) => {
  const [text, setText] = useState('');
  const [selectedFile, setSelectedFile] = useState<ChatMessage['fileAttachment'] | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() && !selectedFile) return;
    onSendMessage(text, selectedFile || undefined);
    setText('');
    setSelectedFile(null);
  };

  const handleSimulatedFileUpload = () => {
    setSelectedFile({
      name: 'YLAAM-MEET_Design_Doc_v2.pdf',
      size: '4.8 MB',
      type: 'PDF',
    });
  };

  return (
    <div className="w-full h-full min-h-0 flex flex-col bg-white/75 backdrop-blur-2xl border border-white rounded-3xl shadow-xl text-slate-800 overflow-hidden">
      {/* Panel Header */}
      <div className="p-4 border-b border-blue-100/60 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center space-x-2">
          <h2 className="font-bold text-base text-slate-900">In-Meeting Chat</h2>
          <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 text-[11px] font-bold border border-blue-200/60">
            {messages.length}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Encryption Banner */}
      <div className="px-4 py-2 bg-blue-50/80 border-b border-blue-100/60 flex items-center space-x-2 text-xs text-blue-700 flex-shrink-0">
        <Lock className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" />
        <span className="font-medium">Messages are visible to everyone currently in this meeting.</span>
      </div>

      {/* Messages Scroll View */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-slate-200">
        {messages.map((msg) => {
          const isSelf = msg.senderId === 'user-self';
          return (
            <div
              key={msg.id}
              className={`flex items-start space-x-3 ${isSelf ? 'flex-row-reverse space-x-reverse' : ''}`}
            >
              <img
                src={msg.senderAvatar}
                alt={msg.senderName}
                className="w-8 h-8 rounded-full object-cover border border-white shadow-sm flex-shrink-0"
              />
              <div
                className={`flex flex-col max-w-[80%] ${
                  isSelf ? 'items-end' : 'items-start'
                }`}
              >
                <div className="flex items-center space-x-2 mb-1">
                  <span className="text-xs font-semibold text-slate-700">
                    {msg.senderName}
                  </span>
                  {msg.isHost && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-blue-100 text-blue-700 font-semibold">
                      HOST
                    </span>
                  )}
                  <span className="text-[10px] text-slate-400">{msg.timestamp}</span>
                </div>

                <div
                  className={`p-3 rounded-2xl text-xs sm:text-sm leading-relaxed ${
                    isSelf
                      ? 'bg-blue-600 text-white rounded-tr-none shadow-md shadow-blue-200'
                      : 'bg-white/90 text-slate-800 rounded-tl-none border border-blue-100/80 shadow-sm'
                  }`}
                >
                  <p>{msg.message}</p>

                  {/* File attachment rendering */}
                  {msg.fileAttachment && (
                    <div className="mt-2.5 p-2.5 rounded-xl bg-slate-50/80 border border-slate-200 flex items-center space-x-3 text-slate-800">
                      <div className="p-2 rounded-lg bg-blue-100 text-blue-600">
                        <FileText className="w-5 h-5" />
                      </div>
                      <div className="flex-1 overflow-hidden text-left">
                        <p className="font-semibold text-xs text-slate-800 truncate">
                          {msg.fileAttachment.name}
                        </p>
                        <p className="text-[10px] text-slate-500">{msg.fileAttachment.size}</p>
                      </div>
                      <button className="p-1.5 rounded-lg hover:bg-slate-200 text-blue-600">
                        <Download className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={chatEndRef} />
      </div>

      {/* Selected File Preview Box */}
      {selectedFile && (
        <div className="px-4 py-2 border-t border-blue-100 bg-blue-50/50 flex items-center justify-between">
          <div className="flex items-center space-x-2 text-xs text-blue-700">
            <Paperclip className="w-4 h-4" />
            <span className="font-semibold truncate max-w-[200px]">{selectedFile.name}</span>
          </div>
          <button
            onClick={() => setSelectedFile(null)}
            className="p-1 text-slate-400 hover:text-slate-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Message Input Form */}
      <form onSubmit={handleSend} className="p-3 sm:p-4 border-t border-blue-100 bg-white/60 backdrop-blur-md flex-shrink-0">
        <div className="relative flex items-center">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Send a message to everyone..."
            className="w-full py-3 pl-4 pr-24 rounded-2xl bg-white border border-blue-100 text-slate-800 placeholder-slate-400 text-xs sm:text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 shadow-sm transition-all"
          />

          <div className="absolute right-2 flex items-center space-x-1">
            <button
              type="button"
              onClick={handleSimulatedFileUpload}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
              title="Attach File"
            >
              <Paperclip className="w-4 h-4" />
            </button>

            <button
              type="submit"
              disabled={!text.trim() && !selectedFile}
              className={`p-2 rounded-xl transition-all ${
                text.trim() || selectedFile
                  ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-md shadow-blue-200'
                  : 'bg-slate-100 text-slate-300 cursor-not-allowed'
              }`}
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
