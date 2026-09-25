'use client';

import React, { useEffect, useRef, useState } from 'react';
import { VideoOff, AlertCircle, Sparkles } from 'lucide-react';
import { BackgroundChoice } from '@/types/meeting';

interface CameraVideoProps {
  isCameraOn: boolean;
  activeBg?: BackgroundChoice;
  className?: string;
  fallbackAvatar?: string;
  objectFit?: 'cover' | 'contain';
  isSelf?: boolean;
  mediaStream?: MediaStream | null;
  cameraDeviceId?: string;
  onCameraUnavailable?: (message: string) => void;
}

declare global {
  interface Window {
    SelfieSegmentation?: any;
  }
}

const activeCameraStreams = new Set<MediaStream>();
const BACKGROUND_IMAGES: Partial<Record<BackgroundChoice, string>> = {
  office: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1280&auto=format&fit=crop&q=80',
  skyline: 'https://images.unsplash.com/photo-1513694203232-719a280e022f?w=1280&auto=format&fit=crop&q=80',
  studio: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1280&auto=format&fit=crop&q=80',
};
let mediaPipeScriptPromise: Promise<void> | null = null;

function preloadMediaPipe() {
  if (window.SelfieSegmentation) return Promise.resolve();
  if (!mediaPipeScriptPromise) {
    mediaPipeScriptPromise = new Promise<void>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>('script[data-selfie-segmentation]');
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error('Unable to load background effects')), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/selfie_segmentation.js';
      script.async = true;
      script.dataset.selfieSegmentation = 'true';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Unable to load background effects'));
      document.body.appendChild(script);
    }).catch((error) => {
      mediaPipeScriptPromise = null;
      throw error;
    });
  }
  return mediaPipeScriptPromise;
}

export function stopAllCameraStreams() {
  activeCameraStreams.forEach((cameraStream) => {
    cameraStream.getTracks().forEach((track) => track.stop());
  });
  activeCameraStreams.clear();
}

export const CameraVideo: React.FC<CameraVideoProps> = ({
  isCameraOn,
  activeBg = 'none',
  className = '',
  fallbackAvatar = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=800&auto=format&fit=crop&q=80',
  objectFit = 'cover',
  isSelf = true,
  mediaStream,
  cameraDeviceId = 'default',
  onCameraUnavailable,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bgImageRef = useRef<HTMLImageElement | null>(null);
  const avatarImgRef = useRef<HTMLImageElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ownsStreamRef = useRef(false);
  const cameraRequestedRef = useRef(false);
  const cameraEnabledRef = useRef(isCameraOn);
  const cameraDeviceRef = useRef(cameraDeviceId);
  const mountedRef = useRef(true);
  const selfieSegmentationRef = useRef<any>(null);
  cameraEnabledRef.current = isCameraOn;

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [hasError, setHasError] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isAiSegmentationReady, setIsAiSegmentationReady] = useState<boolean>(false);

  const currentBgUrl = BACKGROUND_IMAGES[activeBg];

  useEffect(() => {
    if (cameraDeviceRef.current === cameraDeviceId) return;
    cameraDeviceRef.current = cameraDeviceId;
    if (ownsStreamRef.current && streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      activeCameraStreams.delete(streamRef.current);
      streamRef.current = null;
      ownsStreamRef.current = false;
      cameraRequestedRef.current = false;
      setStream(null);
    }
  }, [cameraDeviceId]);

  // Warm the local-only background assets while the meeting is idle so a
  // later selection can switch immediately without starting multiple loads.
  useEffect(() => {
    if (!isSelf) return;
    Object.values(BACKGROUND_IMAGES).forEach((url) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.src = url;
    });
    void preloadMediaPipe().catch(() => undefined);
  }, [isSelf]);

  // Preload background image object for canvas rendering
  useEffect(() => {
    if (currentBgUrl) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = currentBgUrl;
      img.onload = () => {
        bgImageRef.current = img;
      };
    } else {
      bgImageRef.current = null;
    }
  }, [currentBgUrl]);

  // Preload fallback avatar image for canvas rendering
  useEffect(() => {
    if (fallbackAvatar) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = fallbackAvatar;
      img.onload = () => {
        avatarImgRef.current = img;
      };
    }
  }, [fallbackAvatar]);

  // Stop locally owned preview tracks when the camera is off so the browser
  // releases the physical camera, then acquire a fresh track when it is on.
  useEffect(() => {
    async function startCamera() {
      if (mediaStream !== undefined) {
        if (ownsStreamRef.current && streamRef.current && streamRef.current !== mediaStream) {
          streamRef.current.getTracks().forEach((track) => track.stop());
          activeCameraStreams.delete(streamRef.current);
        }
        ownsStreamRef.current = false;
        streamRef.current = mediaStream;
        setStream(mediaStream);
        return;
      }
      if (!isCameraOn || !isSelf) {
        if (ownsStreamRef.current && streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
          activeCameraStreams.delete(streamRef.current);
          streamRef.current = null;
          ownsStreamRef.current = false;
          cameraRequestedRef.current = false;
          setStream(null);
        }
        return;
      }

      if (streamRef.current) {
        streamRef.current.getVideoTracks().forEach((track) => {
          track.enabled = true;
        });
        setStream(streamRef.current);
        return;
      }

      if (cameraRequestedRef.current) return;
      cameraRequestedRef.current = true;

      setHasError(false);
      setErrorMessage('');

      try {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          const mediaStream = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              ...(cameraDeviceId !== 'default' ? { deviceId: { exact: cameraDeviceId } } : { facingMode: 'user' }),
            },
            audio: false,
          });

          if (!mountedRef.current) {
            mediaStream.getTracks().forEach((track) => track.stop());
            return;
          }

          // Permission/capture can resolve after the user has already switched
          // the camera off. Never retain that late stream because it would keep
          // the physical camera active while the meeting shows video as off.
          if (!cameraEnabledRef.current) {
            mediaStream.getTracks().forEach((track) => track.stop());
            cameraRequestedRef.current = false;
            setStream(null);
            return;
          }

          streamRef.current = mediaStream;
          ownsStreamRef.current = true;
          activeCameraStreams.add(mediaStream);
          setStream(mediaStream);
          mediaStream.getVideoTracks()[0]?.addEventListener('ended', () => {
            if (!mountedRef.current) return;
            setStream(null);
            setHasError(true);
            setErrorMessage('The selected camera was disconnected. Choose another camera or the default device.');
          }, { once: true });

          if (videoRef.current) {
            videoRef.current.srcObject = mediaStream;
          }
        } else {
          throw new Error('Camera access API not supported on this browser.');
        }
      } catch (err: any) {
        cameraRequestedRef.current = false;
        console.warn('Real webcam access error:', err);
        setHasError(true);
        const message = err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError'
          ? 'Camera permission was denied. Allow camera access in your browser settings, then try again.'
          : 'The selected camera was not found or is already in use.';
        setErrorMessage(message);
        onCameraUnavailable?.(message);
      }
    }

    startCamera();
  }, [isCameraOn, isSelf, mediaStream, cameraDeviceId, onCameraUnavailable]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const currentStream = streamRef.current;
      if (ownsStreamRef.current) {
        currentStream?.getTracks().forEach((track) => track.stop());
        if (currentStream) activeCameraStreams.delete(currentStream);
      }
      streamRef.current = null;
    };
  }, []);

  useEffect(() => {
    const videoElements = [videoRef.current, previewVideoRef.current];
    videoElements.forEach((videoElement) => {
      if (videoElement && videoElement.srcObject !== stream) {
        videoElement.srcObject = stream;
        // Remote audio/video may arrive after the element was rendered.
        // Explicit play handles browsers that do not resume automatically.
        void videoElement.play().catch(() => undefined);
      }
    });
  }, [stream]);

  // 2. Load MediaPipe SelfieSegmentation for real-time AI background removal
  useEffect(() => {
    if (activeBg === 'none') return;

    let selfieSeg: any = null;

    const loadMediaPipe = () => {
      if (window.SelfieSegmentation) {
        try {
          selfieSeg = new window.SelfieSegmentation({
            locateFile: (file: string) =>
              `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
          });
          selfieSeg.setOptions({
            modelSelection: 1, // 1 for landscape selfie mode
          });
          selfieSegmentationRef.current = selfieSeg;
          setIsAiSegmentationReady(true);
        } catch (e) {
          console.warn('MediaPipe initialization fallback:', e);
        }
      }
    };

    void preloadMediaPipe().then(loadMediaPipe).catch((error) => {
      console.warn('MediaPipe loading fallback:', error);
    });
    return () => {
      selfieSegmentationRef.current = null;
      void selfieSeg?.close?.();
    };
  }, [activeBg === 'none']);

  // 3. Canvas Segmentation Render Loop
  useEffect(() => {
    if (activeBg === 'none' || !isCameraOn) return;

    let animFrameId: number;
    let isProcessing = false;

    const renderFrame = async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const video = videoRef.current;
      const selfieSeg = selfieSegmentationRef.current;

      // Set canvas size matching container ratio
      const width = canvas.clientWidth || 640;
      const height = canvas.clientHeight || 360;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      // Check if live camera video is active
      const isVideoActive = stream && video && video.readyState >= 2 && !hasError;

      if (isVideoActive && selfieSeg && isAiSegmentationReady) {
        // AI Segmentation Path with MediaPipe
        if (!isProcessing) {
          isProcessing = true;
          selfieSeg.onResults((results: any) => {
            ctx.save();
            ctx.clearRect(0, 0, width, height);

            // Mirror video feed for natural selfie preview
            ctx.translate(width, 0);
            ctx.scale(-1, 1);

            // Step A: Draw Virtual Background or Blur
            if (activeBg === 'blur') {
              ctx.filter = 'blur(16px)';
              ctx.drawImage(video, -20, -20, width + 40, height + 40);
              ctx.filter = 'none';
            } else if (bgImageRef.current && bgImageRef.current.complete) {
              ctx.drawImage(bgImageRef.current, 0, 0, width, height);
            } else {
              // Dark fallback studio background
              ctx.fillStyle = '#0f172a';
              ctx.fillRect(0, 0, width, height);
            }

            // Step B: Draw Person Subject using AI Segmentation Mask
            // Mask canvas holds the person outline
            const maskCanvas = document.createElement('canvas');
            maskCanvas.width = width;
            maskCanvas.height = height;
            const maskCtx = maskCanvas.getContext('2d');

            if (maskCtx) {
              maskCtx.drawImage(results.segmentationMask, 0, 0, width, height);

              // Composite: keep ONLY video pixels inside the person segmentation mask
              maskCtx.globalCompositeOperation = 'source-in';
              maskCtx.drawImage(video, 0, 0, width, height);

              // Draw person subject seamlessly on top of virtual background
              ctx.drawImage(maskCanvas, 0, 0);
            }

            ctx.restore();
            isProcessing = false;
          });

          selfieSeg.send({ image: video }).catch(() => {
            isProcessing = false;
          });
        }
      } else {
        // Canvas Silhouette Cutout (for Fallback Avatar or loading AI model)
        // Completely strips away original background and isolates head & torso
        ctx.save();
        ctx.clearRect(0, 0, width, height);

        // A. Draw Background
        if (activeBg === 'blur') {
          if (avatarImgRef.current && avatarImgRef.current.complete) {
            ctx.filter = 'blur(20px)';
            ctx.drawImage(avatarImgRef.current, -20, -20, width + 40, height + 40);
            ctx.filter = 'none';
          } else {
            ctx.fillStyle = '#1e293b';
            ctx.fillRect(0, 0, width, height);
          }
        } else if (bgImageRef.current && bgImageRef.current.complete) {
          ctx.drawImage(bgImageRef.current, 0, 0, width, height);
        } else {
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(0, 0, width, height);
        }

        // B. Create Anatomical Person Silhouette Mask (Head + Neck + Shoulders + Torso)
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = width;
        maskCanvas.height = height;
        const maskCtx = maskCanvas.getContext('2d');

        if (maskCtx) {
          const centerX = width * 0.5;
          const headY = height * 0.38;
          const headRadius = height * 0.22;

          // Draw head circle + shoulder body path mask
          maskCtx.fillStyle = '#ffffff';
          maskCtx.beginPath();
          // Head
          maskCtx.arc(centerX, headY, headRadius, 0, Math.PI * 2);
          maskCtx.fill();

          // Neck & Shoulders & Torso curve
          maskCtx.beginPath();
          maskCtx.moveTo(centerX - headRadius * 0.6, headY + headRadius * 0.5);
          maskCtx.bezierCurveTo(
            centerX - headRadius * 1.8,
            headY + headRadius * 1.5,
            centerX - width * 0.42,
            height,
            centerX - width * 0.45,
            height
          );
          maskCtx.lineTo(centerX + width * 0.45, height);
          maskCtx.bezierCurveTo(
            centerX + width * 0.42,
            height,
            centerX + headRadius * 1.8,
            headY + headRadius * 1.5,
            centerX + headRadius * 0.6,
            headY + headRadius * 0.5
          );
          maskCtx.closePath();
          maskCtx.fill();

          // Soften edges for natural silhouette blending
          maskCtx.filter = 'blur(4px)';

          // Composite image inside person silhouette
          maskCtx.globalCompositeOperation = 'source-in';
          if (isVideoActive && video) {
            // Mirror live camera feed
            maskCtx.translate(width, 0);
            maskCtx.scale(-1, 1);
            maskCtx.drawImage(video, 0, 0, width, height);
          } else if (avatarImgRef.current && avatarImgRef.current.complete) {
            maskCtx.drawImage(avatarImgRef.current, 0, 0, width, height);
          }

          // Draw isolated person subject onto Virtual Background
          ctx.drawImage(maskCanvas, 0, 0);
        }

        ctx.restore();
      }

      animFrameId = requestAnimationFrame(renderFrame);
    };

    renderFrame();

    return () => {
      if (animFrameId) cancelAnimationFrame(animFrameId);
    };
  }, [activeBg, isCameraOn, stream, isSelf, hasError, isAiSegmentationReady]);

  if (!isCameraOn) {
    return (
      <div
        className={`w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 to-slate-950 p-6 text-center ${className}`}
      >
        <div className="w-16 h-16 rounded-full bg-slate-800/90 border border-white/20 flex items-center justify-center text-slate-300 shadow-inner">
          <VideoOff className="w-7 h-7 text-white" />
        </div>
        <p className="mt-3 text-xs sm:text-sm text-slate-300 font-medium">
          Camera is turned off
        </p>
      </div>
    );
  }

  return (
    <div className={`relative w-full h-full overflow-hidden bg-slate-950 ${className}`}>
      {/* Hidden Video element for webcam capture */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="hidden"
      />

      {/* Mode A: Clean direct camera view when activeBg === 'none' */}
      {activeBg === 'none' ? (
        <div className="relative w-full h-full flex items-center justify-center bg-slate-950">
          {!hasError && stream ? (
            <video
              autoPlay
              playsInline
              muted
              ref={previewVideoRef}
              className={`w-full h-full ${
                objectFit === 'cover' ? 'object-cover' : 'object-contain'
              } ${isSelf ? '-scale-x-100' : ''} transition-all duration-300`}
            />
          ) : (
            <img
              src={fallbackAvatar}
              alt="Person Stream"
              className="w-full h-full object-cover transition-all duration-300"
            />
          )}
        </div>
      ) : (
        /* Mode B: AI Segmentation Canvas with Background Replacement */
        <div className="relative w-full h-full flex items-center justify-center bg-slate-950">
          <canvas
            ref={canvasRef}
            className="w-full h-full object-cover block"
          />
        </div>
      )}

      {/* Error alert overlay if webcam permission denied */}
      {hasError && isSelf && (
        <div className="absolute bottom-3 left-3 right-3 p-2.5 rounded-xl bg-slate-900/90 border border-amber-500/40 text-amber-300 text-[11px] font-medium flex items-center space-x-2 backdrop-blur-md shadow-lg z-20">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="truncate">
            {errorMessage} (Using high-res stream preview)
          </span>
        </div>
      )}

      {/* Subtle bottom vignette gradient */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent pointer-events-none z-10" />
    </div>
  );
};
