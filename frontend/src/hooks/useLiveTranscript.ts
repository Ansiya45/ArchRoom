import { useEffect, useRef, useState } from 'react';

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

export function useLiveTranscript(
  active: boolean,
  microphoneOn: boolean,
  onFinalText: (text: string) => void,
) {
  const [interimText, setInterimText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const callbackRef = useRef(onFinalText);
  const shouldRunRef = useRef(false);
  callbackRef.current = onFinalText;

  const Recognition = typeof window === 'undefined'
    ? undefined
    : ((window as unknown as { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor }).SpeechRecognition
      || (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionConstructor }).webkitSpeechRecognition);
  const supported = Boolean(Recognition);

  useEffect(() => {
    shouldRunRef.current = active && microphoneOn;
    if (!Recognition || !shouldRunRef.current) {
      setInterimText('');
      return;
    }

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';
    let stopped = false;

    recognition.onresult = (event) => {
      let interim = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result[0]?.transcript.trim();
        if (!text) continue;
        if (result.isFinal) callbackRef.current(text);
        else interim += `${text} `;
      }
      setInterimText(interim.trim());
    };
    recognition.onerror = (event) => {
      if (event.error !== 'aborted' && event.error !== 'no-speech') {
        setError(`Transcription stopped: ${event.error}.`);
      }
    };
    recognition.onend = () => {
      if (!stopped && shouldRunRef.current) {
        try { recognition.start(); } catch { /* Already restarting. */ }
      }
    };

    setError(null);
    try {
      recognition.start();
    } catch {
      setError('Unable to start speech recognition in this browser.');
    }

    return () => {
      stopped = true;
      recognition.onend = null;
      recognition.stop();
      setInterimText('');
    };
  }, [active, microphoneOn, Recognition]);

  return { supported, interimText, error };
}
