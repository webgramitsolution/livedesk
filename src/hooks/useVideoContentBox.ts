import { useEffect, useState, type RefObject } from 'react';
import { computeContentBox, type ContentBox } from '@/lib/annotation/geometry';

/**
 * Tracks the painted content area of a `<video style="object-fit: contain">`
 * element: element size (ResizeObserver), intrinsic size (loadedmetadata /
 * resize events) and devicePixelRatio. Consumers map between normalized
 * presentation coordinates and pixels through the returned box.
 */
export function useVideoContentBox(videoRef: RefObject<HTMLVideoElement | null>) {
  const [box, setBox] = useState<ContentBox>({ x: 0, y: 0, width: 0, height: 0 });
  const [elementSize, setElementSize] = useState({ width: 0, height: 0 });
  const [intrinsic, setIntrinsic] = useState({ width: 0, height: 0 });
  const [dpr, setDpr] = useState(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const measure = () => {
      const rect = video.getBoundingClientRect();
      setElementSize({ width: rect.width, height: rect.height });
      setIntrinsic({ width: video.videoWidth, height: video.videoHeight });
      setDpr(window.devicePixelRatio || 1);
    };
    measure();

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(video);
    video.addEventListener('loadedmetadata', measure);
    video.addEventListener('resize', measure);
    video.addEventListener('playing', measure);
    window.addEventListener('resize', measure);
    // Zoom changes alter devicePixelRatio; poll cheaply since there is no event in every browser.
    const dprTimer = window.setInterval(() => {
      if ((window.devicePixelRatio || 1) !== dpr) measure();
    }, 1000);

    return () => {
      ro?.disconnect();
      video.removeEventListener('loadedmetadata', measure);
      video.removeEventListener('resize', measure);
      video.removeEventListener('playing', measure);
      window.removeEventListener('resize', measure);
      window.clearInterval(dprTimer);
    };
    // dpr is intentionally read at effect setup only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoRef, videoRef.current]);

  useEffect(() => {
    setBox(computeContentBox(elementSize.width, elementSize.height, intrinsic.width, intrinsic.height));
  }, [elementSize, intrinsic]);

  return { box, elementSize, intrinsic, dpr };
}
