'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Circle,
  Eraser,
  Minus,
  Pencil,
  RectangleHorizontal,
  Share2,
  Trash2,
  Type,
  Undo2,
  Users,
  X,
} from 'lucide-react';

type Tool = 'pencil' | 'eraser' | 'line' | 'rectangle' | 'circle' | 'text';
type Point = { x: number; y: number };
type TextEditor = Point & { left: number; top: number; value: string };

interface WhiteboardProps {
  onClose: () => void;
  shared: boolean;
  connected: boolean;
  connectionError: string | null;
  isHost: boolean;
  canEdit: boolean;
  participants: Array<{ id: string; name: string; isHost: boolean; canEdit: boolean }>;
  remoteSnapshot: string | null;
  onToggleShare: (shared: boolean) => void;
  onGrantAccess: (participantId: string, canEdit: boolean) => void;
  onPublishSnapshot: (data: string) => void;
}

const tools: Array<{ id: Tool; label: string; icon: React.ReactNode }> = [
  { id: 'pencil', label: 'Pencil', icon: <Pencil className="w-4 h-4" /> },
  { id: 'eraser', label: 'Eraser', icon: <Eraser className="w-4 h-4" /> },
  { id: 'line', label: 'Line', icon: <Minus className="w-4 h-4" /> },
  { id: 'rectangle', label: 'Rectangle', icon: <RectangleHorizontal className="w-4 h-4" /> },
  { id: 'circle', label: 'Circle', icon: <Circle className="w-4 h-4" /> },
  { id: 'text', label: 'Text', icon: <Type className="w-4 h-4" /> },
];

export const Whiteboard: React.FC<WhiteboardProps> = ({
  onClose,
  shared,
  connected,
  connectionError,
  isHost,
  canEdit,
  participants,
  remoteSnapshot,
  onToggleShare,
  onGrantAccess,
  onPublishSnapshot,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const startRef = useRef<Point>({ x: 0, y: 0 });
  const snapshotRef = useRef<ImageData | null>(null);
  const historyRef = useRef<ImageData[]>([]);
  const textInputRef = useRef<HTMLInputElement | null>(null);
  const [tool, setTool] = useState<Tool>('pencil');
  const [color, setColor] = useState('#e2e8f0');
  const [textEditor, setTextEditor] = useState<TextEditor | null>(null);
  const [showParticipants, setShowParticipants] = useState(false);

  const context = () => canvasRef.current?.getContext('2d') ?? null;

  useEffect(() => {
    if (!textEditor) return;
    const timer = window.setTimeout(() => {
      textInputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [textEditor !== null]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const previous = document.createElement('canvas');
      previous.width = canvas.width;
      previous.height = canvas.height;
      previous.getContext('2d')?.drawImage(canvas, 0, 0);

      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * ratio);
      canvas.height = Math.round(rect.height * ratio);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      canvas.getContext('2d')?.drawImage(previous, 0, 0, canvas.width, canvas.height);
      historyRef.current = [];
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = context();
    if (!canvas || !ctx || !remoteSnapshot) return;
    const image = new Image();
    image.onload = () => {
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    };
    image.src = remoteSnapshot;
  }, [remoteSnapshot]);

  const publish = () => {
    const canvas = canvasRef.current;
    if (canvas) onPublishSnapshot(canvas.toDataURL('image/png'));
  };

  const getPoint = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const saveHistory = () => {
    const canvas = canvasRef.current;
    const ctx = context();
    if (!canvas || !ctx) return;
    historyRef.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (historyRef.current.length > 30) historyRef.current.shift();
  };

  const configureStroke = (ctx: CanvasRenderingContext2D) => {
    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = (tool === 'eraser' ? 24 : 3) * (window.devicePixelRatio || 1);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  };

  const drawShape = (ctx: CanvasRenderingContext2D, start: Point, end: Point) => {
    configureStroke(ctx);
    ctx.beginPath();
    if (tool === 'line') {
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
    } else if (tool === 'rectangle') {
      ctx.rect(start.x, start.y, end.x - start.x, end.y - start.y);
    } else if (tool === 'circle') {
      const radiusX = Math.abs(end.x - start.x) / 2;
      const radiusY = Math.abs(end.y - start.y) / 2;
      ctx.ellipse((start.x + end.x) / 2, (start.y + end.y) / 2, radiusX, radiusY, 0, 0, Math.PI * 2);
    }
    ctx.stroke();
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const ctx = context();
    if (!canvas || !ctx || !canEdit) return;
    const point = getPoint(event);

    if (tool === 'text') {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      setTextEditor({
        ...point,
        left: Math.min(event.clientX - rect.left, Math.max(8, rect.width - 220)),
        top: Math.min(event.clientY - rect.top, Math.max(8, rect.height - 42)),
        value: '',
      });
      return;
    }

    saveHistory();
    drawingRef.current = true;
    startRef.current = point;
    snapshotRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
    canvas.setPointerCapture(event.pointerId);

    if (tool === 'pencil' || tool === 'eraser') {
      configureStroke(ctx);
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const ctx = context();
    if (!ctx) return;
    const point = getPoint(event);

    if (tool === 'pencil' || tool === 'eraser') {
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
      return;
    }

    if (snapshotRef.current) ctx.putImageData(snapshotRef.current, 0, 0);
    drawShape(ctx, startRef.current, point);
  };

  const finishDrawing = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    handlePointerMove(event);
    drawingRef.current = false;
    snapshotRef.current = null;
    publish();
  };

  const undo = () => {
    const ctx = context();
    const previous = historyRef.current.pop();
    if (ctx && previous) {
      ctx.putImageData(previous, 0, 0);
      publish();
    }
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = context();
    if (!canvas || !ctx) return;
    saveHistory();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    publish();
  };

  const commitText = () => {
    if (!textEditor) return;
    const value = textEditor.value.trim();
    if (value) {
      const ctx = context();
      if (ctx) {
        saveHistory();
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = color;
        ctx.font = `${20 * (window.devicePixelRatio || 1)}px sans-serif`;
        ctx.textBaseline = 'top';
        ctx.fillText(value, textEditor.x, textEditor.y);
        publish();
      }
    }
    setTextEditor(null);
  };

  return (
    <div className="absolute inset-2 sm:inset-4 z-40 bg-white/95 border border-blue-100 rounded-3xl p-3 sm:p-4 shadow-2xl flex flex-col gap-3 animate-fadeIn text-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-blue-100 pb-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {tools.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTool(item.id)}
              disabled={!canEdit}
              title={item.label}
              aria-label={item.label}
              className={`p-2 rounded-xl border transition-colors ${
                tool === item.id
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-blue-50'
              }`}
            >
              {item.icon}
            </button>
          ))}
          <input
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
            disabled={!canEdit}
            title="Drawing color"
            aria-label="Drawing color"
            className="w-9 h-9 rounded-xl border border-slate-200 bg-white p-1 cursor-pointer"
          />
          <button type="button" disabled={!canEdit} onClick={undo} title="Undo" aria-label="Undo" className="p-2 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-blue-50 disabled:opacity-40">
            <Undo2 className="w-4 h-4" />
          </button>
          <button type="button" disabled={!canEdit} onClick={clear} title="Clear board" aria-label="Clear board" className="p-2 rounded-xl border border-rose-200 bg-white text-rose-600 hover:bg-rose-50 disabled:opacity-40">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
        <div className="relative flex items-center gap-1.5">
          <button
            type="button"
            disabled={!isHost || !connected}
            onClick={() => {
              onToggleShare(!shared);
              if (!shared) publish();
            }}
            title={isHost ? (shared ? 'Stop sharing' : 'Share whiteboard') : 'Only the host can share'}
            className={`p-2 rounded-xl border disabled:opacity-40 ${shared ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-slate-200 text-slate-600'}`}
          >
            <Share2 className="w-5 h-5" />
          </button>
          <button type="button" onClick={() => setShowParticipants((value) => !value)} title="Whiteboard participants" className="p-2 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-blue-50">
            <Users className="w-5 h-5" />
          </button>
          <button type="button" onClick={onClose} title="Close whiteboard" aria-label="Close whiteboard" className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600">
            <X className="w-5 h-5" />
          </button>
          {showParticipants && (
            <div className="absolute right-0 top-12 z-30 w-72 max-h-72 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl">
              <div className="mb-2 text-xs font-bold text-slate-800">Whiteboard access</div>
              {connectionError ? (
                <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-700">{connectionError} Drawing is available locally, but sharing is offline.</p>
              ) : participants.length === 0 ? (
                <p className="text-xs text-slate-500">No connected participants.</p>
              ) : participants.map((participant) => (
                <div key={participant.id} className="flex items-center justify-between gap-3 border-t border-slate-100 py-2 first:border-0">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-slate-800">{participant.name}</div>
                    <div className="text-[10px] text-slate-500">{participant.isHost ? 'Host' : participant.canEdit ? 'Can edit' : 'View only'}</div>
                  </div>
                  {!participant.isHost && isHost && (
                    <button
                      type="button"
                      onClick={() => onGrantAccess(participant.id, !participant.canEdit)}
                      className={`shrink-0 rounded-lg px-2 py-1 text-[10px] font-bold ${participant.canEdit ? 'bg-rose-50 text-rose-600' : 'bg-blue-50 text-blue-600'}`}
                    >
                      {participant.canEdit ? 'Remove access' : 'Allow edit'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 rounded-2xl border border-blue-200 overflow-y-auto overflow-x-hidden shadow-inner bg-slate-950">
        <div
          ref={containerRef}
          className="relative w-full min-h-[1200px] h-[200%] bg-slate-900 bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:24px_24px]"
        >
          <canvas
            ref={canvasRef}
            tabIndex={-1}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishDrawing}
            onPointerCancel={finishDrawing}
            className={`absolute inset-0 touch-none ${!canEdit ? 'cursor-not-allowed' : tool === 'text' ? 'cursor-text' : tool === 'eraser' ? 'cursor-cell' : 'cursor-crosshair'}`}
          />
          {textEditor && (
            <input
              ref={textInputRef}
              type="text"
              autoFocus
              value={textEditor.value}
              onChange={(event) => setTextEditor((current) => current ? { ...current, value: event.target.value } : null)}
              onBlur={commitText}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitText();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setTextEditor(null);
                }
              }}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              aria-label="Whiteboard text"
              placeholder="Type here…"
              className="absolute z-20 w-52 bg-slate-800 border-2 border-blue-400 rounded-md px-2 py-1 outline-none shadow-xl caret-white"
              style={{
                left: textEditor.left,
                top: textEditor.top,
                color,
                fontSize: 20,
                lineHeight: 1.3,
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
};
