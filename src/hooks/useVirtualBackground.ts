import { useEffect, useRef, useCallback, useState } from 'react';
import { useMeetingStore } from '@/store/meetingStore';

export function useVirtualBackground(inputStream: MediaStream | null) {
  const selectedBackground = useMeetingStore((s) => s.selectedBackground);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const outputStreamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number>(0);
  const [processedStream, setProcessedStream] = useState<MediaStream | null>(null);

  const processFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.paused || video.ended) {
      animFrameRef.current = requestAnimationFrame(processFrame);
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    if (selectedBackground === 'blur-light' || selectedBackground === 'blur-heavy') {
      const blurAmount = selectedBackground === 'blur-heavy' ? 20 : 8;
      // Apply CSS filter blur via a secondary canvas approach
      ctx.filter = `blur(${blurAmount}px)`;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      ctx.filter = 'none';
      
      // Draw the person area (center) without blur - simple oval mask
      const cx = canvas.width / 2;
      const cy = canvas.height * 0.4;
      const rx = canvas.width * 0.28;
      const ry = canvas.height * 0.55;

      ctx.save();
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.filter = 'none';
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    } else if (selectedBackground !== 'none') {
      // Color overlay backgrounds - tint the background area
      const bgColors: Record<string, string> = {
        office: 'rgba(200, 200, 210, 0.6)',
        nature: 'rgba(100, 180, 100, 0.5)',
        space: 'rgba(20, 10, 50, 0.7)',
        beach: 'rgba(240, 220, 160, 0.5)',
        library: 'rgba(139, 90, 43, 0.4)',
      };

      const color = bgColors[selectedBackground];
      if (color) {
        // Draw blurred background
        ctx.filter = 'blur(12px)';
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        ctx.filter = 'none';

        // Apply color overlay
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw person (center ellipse)
        const cx = canvas.width / 2;
        const cy = canvas.height * 0.4;
        const rx = canvas.width * 0.28;
        const ry = canvas.height * 0.55;

        ctx.save();
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        ctx.restore();
      }
    }

    animFrameRef.current = requestAnimationFrame(processFrame);
  }, [selectedBackground]);

  useEffect(() => {
    if (!inputStream || selectedBackground === 'none') {
      setProcessedStream(inputStream);
      return;
    }

    // Create hidden video element to read frames from
    const video = document.createElement('video');
    video.srcObject = inputStream;
    video.muted = true;
    video.playsInline = true;
    video.play().catch(() => {});
    videoRef.current = video;

    // Create canvas for processing
    const canvas = document.createElement('canvas');
    canvasRef.current = canvas;

    // Wait for video to be ready
    video.onloadedmetadata = () => {
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;

      // Start processing loop
      animFrameRef.current = requestAnimationFrame(processFrame);

      // Capture canvas as stream
      const canvasStream = canvas.captureStream(30);
      // Add audio tracks from original stream
      inputStream.getAudioTracks().forEach((track) => {
        canvasStream.addTrack(track);
      });

      outputStreamRef.current = canvasStream;
      setProcessedStream(canvasStream);
    };

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      video.pause();
      video.srcObject = null;
      videoRef.current = null;
      canvasRef.current = null;
    };
  }, [inputStream, selectedBackground, processFrame]);

  return processedStream;
}
