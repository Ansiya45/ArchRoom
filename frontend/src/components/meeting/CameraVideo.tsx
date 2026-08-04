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
}

declare global {
  interface Window {
    SelfieSegmentation?: any;
  }
}

export const CameraVideo: React.FC<CameraVideoProps> = ({
  isCameraOn,
  activeBg = 'none',
  className = '',
  fallbackAvatar = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=800&auto=format&fit=crop&q=80',
  objectFit = 'cover',
  isSelf = true,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bgImageRef = useRef<HTMLImageElement | null>(null);
  const avatarImgRef = useRef<HTMLImageElement | null>(null);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [hasError, setHasError] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isAiSegmentationReady, setIsAiSegmentationReady] = useState<boolean>(false);

  // Background image URLs
  const bgImageMap: Record<string, string> = {
    office: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1280&auto=format&fit=crop&q=80',
    skyline: 'https://images.unsplash.com/photo-1513694203232-719a280e022f?w=1280&auto=format&fit=crop&q=80',
    studio: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1280&auto=format&fit=crop&q=80',
  };

  const currentBgUrl = bgImageMap[activeBg];

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

  // 1. Initialize Webcam Stream
  useEffect(() => {
    let active = true;
    let localStream: MediaStream | null = null;

    async function startCamera() {
      if (!isCameraOn || !isSelf) {
        if (stream) {
          stream.getTracks().forEach((track) => track.stop());
          setStream(null);
        }
        return;
      }

      setHasError(false);
      setErrorMessage('');

      try {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          const mediaStream = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              facingMode: 'user',
            },
            audio: false,
          });

          if (!active) {
            mediaStream.getTracks().forEach((track) => track.stop());
            return;
          }

          localStream = mediaStream;
          setStream(mediaStream);

          if (videoRef.current) {
            videoRef.current.srcObject = mediaStream;
          }
        } else {
          throw new Error('Camera access API not supported on this browser.');
        }
      } catch (err: any) {
        if (!active) return;
        console.warn('Real webcam access error:', err);
        setHasError(true);
        setErrorMessage(
          err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError'
            ? 'Camera permission denied in browser.'
            : 'Webcam device not found or already in use.'
        );
      }
    }

    startCamera();

    return () => {
      active = false;
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [isCameraOn, isSelf]);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  // 2. Load MediaPipe SelfieSegmentation for real-time AI background removal
  useEffect(() => {
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
          (window as any)._selfieSegmentation = selfieSeg;
          setIsAiSegmentationReady(true);
        } catch (e) {
          console.warn('MediaPipe initialization fallback:', e);
        }
      }
    };

    if (!window.SelfieSegmentation) {
      const script = document.createElement('script');
      script.src =
        'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/selfie_segmentation.js';
      script.async = true;
      script.onload = () => {
        loadMediaPipe();
      };
      document.body.appendChild(script);
    } else {
      loadMediaPipe();
    }
  }, []);

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
      const selfieSeg = (window as any)._selfieSegmentation;

      // Set canvas size matching container ratio
      const width = canvas.clientWidth || 640;
      const height = canvas.clientHeight || 360;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      // Check if live camera video is active
      const isVideoActive =
        isSelf && stream && video && video.readyState >= 2 && !hasError;

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
          {!hasError && stream && isSelf ? (
            <video
              autoPlay
              playsInline
              muted
              ref={(el) => {
                if (el && stream) el.srcObject = stream;
              }}
              className={`w-full h-full ${
                objectFit === 'cover' ? 'object-cover' : 'object-contain'
              } -scale-x-100 transition-all duration-300`}
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
