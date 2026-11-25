import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { fetchSurahUthmani, getAyahSampleAudio, getSurahAudioUrl } from '../lib/api';
import { getCachedAudioObjectUrl } from '../lib/cache';
import type { Ayah, Moshaf, Reciter } from '../types/quran';

export interface AudioTrack {
  id: string;
  kind: 'surah' | 'ayah-sample';
  surahNumber: number;
  surahName: string;
  reciterName: string;
  url: string;
  ayahNumberInSurah?: number;
  globalAyahNumber?: number;
  isSample?: boolean;
}

interface AudioContextValue {
  activeTrack: AudioTrack | null;
  queue: AudioTrack[];
  queueIndex: number;
  isPlaying: boolean;
  isLoading: boolean;
  error: string | null;
  currentTime: number;
  duration: number;
  activeAyahGlobalNumber: number | null;
  playTrack: (track: AudioTrack, queue?: AudioTrack[], startIndex?: number) => Promise<void>;
  playSurahFromReciter: (
    reciter: Reciter,
    moshaf: Moshaf,
    surahNumber: number,
    surahName: string,
    queueSurahs?: Array<{ number: number; name: string }>
  ) => Promise<void>;
  playAyahSample: (ayah: Ayah, surahName: string) => Promise<void>;
  togglePlayPause: () => void;
  seek: (time: number) => void;
  playNext: () => void;
  playPrev: () => void;
  stop: () => void;
  retryCurrent: () => void;
}

const AudioContext = createContext<AudioContextValue | null>(null);

export function AudioProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const [activeTrack, setActiveTrack] = useState<AudioTrack | null>(null);
  const [queue, setQueue] = useState<AudioTrack[]>([]);
  const [queueIndex, setQueueIndex] = useState<number>(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [surahAyahWeights, setSurahAyahWeights] = useState<Array<{ globalNumber: number; endRatio: number }>>([]);

  const cleanupObjectUrl = () => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  };

  const loadSurahTimingWeights = useCallback(async (surahNumber: number) => {
    try {
      const { data } = await fetchSurahUthmani(surahNumber);
      const weights = data.ayahs.map((a) => Math.max(12, a.text.length));
      const total = weights.reduce((acc, w) => acc + w, 0);
      let cumulative = 0;
      const mapped = data.ayahs.map((a, idx) => {
        cumulative += weights[idx];
        return {
          globalNumber: a.number,
          endRatio: cumulative / total,
        };
      });
      setSurahAyahWeights(mapped);
    } catch {
      setSurahAyahWeights([]);
    }
  }, []);

  const startPlaybackForTrack = useCallback(
    async (track: AudioTrack) => {
      const audio = audioRef.current;
      if (!audio) return;

      setError(null);
      setIsLoading(true);
      setCurrentTime(0);
      setDuration(0);
      setActiveTrack(track);

      if (track.kind === 'surah') {
        void loadSurahTimingWeights(track.surahNumber);
      } else {
        setSurahAyahWeights([]);
      }

      cleanupObjectUrl();

      try {
        const cachedBlobUrl = await getCachedAudioObjectUrl(track.url);
        if (cachedBlobUrl) {
          objectUrlRef.current = cachedBlobUrl;
          audio.src = cachedBlobUrl;
        } else {
          audio.src = track.url;
        }
        audio.load();
        await audio.play();
      } catch (err) {
        setIsLoading(false);
        setIsPlaying(false);
        if (err instanceof Error && err.name === 'NotAllowedError') {
          setError('اضغط تشغيل لبدء الصوت');
        } else {
          setError('تعذر تشغيل الملف الصوتي. تحقق من الاتصال أو جرّب إعادة المحاولة.');
        }
      }
    },
    [loadSurahTimingWeights]
  );

  const playTrack = useCallback(
    async (track: AudioTrack, nextQueue?: AudioTrack[], startIndex = 0) => {
      if (nextQueue && nextQueue.length > 0) {
        setQueue(nextQueue);
        setQueueIndex(startIndex);
      } else {
        setQueue([track]);
        setQueueIndex(0);
      }
      await startPlaybackForTrack(track);
    },
    [startPlaybackForTrack]
  );

  const playSurahFromReciter = useCallback(
    async (
      reciter: Reciter,
      moshaf: Moshaf,
      surahNumber: number,
      surahName: string,
      queueSurahs?: Array<{ number: number; name: string }>
    ) => {
      if (queueSurahs && queueSurahs.length > 0) {
        const tracks: AudioTrack[] = queueSurahs.map((s) => ({
          id: `${reciter.id}-${moshaf.id}-${s.number}`,
          kind: 'surah',
          surahNumber: s.number,
          surahName: s.name,
          reciterName: reciter.name,
          url: getSurahAudioUrl(moshaf, s.number),
        }));
        const idx = Math.max(0, tracks.findIndex((t) => t.surahNumber === surahNumber));
        await playTrack(tracks[idx], tracks, idx);
      } else {
        const track: AudioTrack = {
          id: `${reciter.id}-${moshaf.id}-${surahNumber}`,
          kind: 'surah',
          surahNumber,
          surahName,
          reciterName: reciter.name,
          url: getSurahAudioUrl(moshaf, surahNumber),
        };
        await playTrack(track);
      }
    },
    [playTrack]
  );

  const playAyahSample = useCallback(
    async (ayah: Ayah, surahName: string) => {
      let reciterId = 112;
      try {
        const stored = JSON.parse(localStorage.getItem('sadiq_settings_v1') || 'null') as { defaultReciterId?: number } | null;
        if (stored && typeof stored.defaultReciterId === 'number') reciterId = stored.defaultReciterId;
      } catch {
        reciterId = 112;
      }
      const sample = getAyahSampleAudio(reciterId, ayah.number);
      const track: AudioTrack = {
        id: `sample-${ayah.number}`,
        kind: 'ayah-sample',
        surahNumber: ayah.surah?.number ?? 1,
        surahName,
        reciterName: sample.reciterName,
        url: sample.url,
        ayahNumberInSurah: ayah.numberInSurah,
        globalAyahNumber: ayah.number,
        isSample: true,
      };
      await playTrack(track);
    },
    [playTrack]
  );

  const playNext = useCallback(() => {
    if (queueIndex >= 0 && queueIndex + 1 < queue.length) {
      const nextIdx = queueIndex + 1;
      setQueueIndex(nextIdx);
      void startPlaybackForTrack(queue[nextIdx]);
    }
  }, [queue, queueIndex, startPlaybackForTrack]);

  const playPrev = useCallback(() => {
    if (queueIndex > 0) {
      const prevIdx = queueIndex - 1;
      setQueueIndex(prevIdx);
      void startPlaybackForTrack(queue[prevIdx]);
    }
  }, [queue, queueIndex, startPlaybackForTrack]);

  const togglePlayPause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !activeTrack) return;
    if (audio.paused) {
      setError(null);
      audio.play().catch(() => {
        setError('تعذر استئناف التشغيل');
      });
    } else {
      audio.pause();
    }
  }, [activeTrack]);

  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(time)) return;
    audio.currentTime = Math.max(0, Math.min(time, audio.duration || time));
    setCurrentTime(audio.currentTime);
  }, []);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    cleanupObjectUrl();
    setActiveTrack(null);
    setQueue([]);
    setQueueIndex(-1);
    setIsPlaying(false);
    setIsLoading(false);
    setError(null);
    setCurrentTime(0);
    setDuration(0);
    setSurahAyahWeights([]);
  }, []);

  const retryCurrent = useCallback(() => {
    if (activeTrack) {
      void startPlaybackForTrack(activeTrack);
    }
  }, [activeTrack, startPlaybackForTrack]);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audioRef.current = audio;

    const onLoadStart = () => setIsLoading(true);
    const onLoadedMetadata = () => {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
      setIsLoading(false);
    };
    const onCanPlay = () => setIsLoading(false);
    const onPlay = () => {
      setIsPlaying(true);
      setIsLoading(false);
    };
    const onPause = () => setIsPlaying(false);
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onError = () => {
      setIsLoading(false);
      setIsPlaying(false);
      setError('تعذر تحميل التلاوة الصوتية من الخادم');
    };

    audio.addEventListener('loadstart', onLoadStart);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('canplay', onCanPlay);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('error', onError);

    return () => {
      audio.pause();
      cleanupObjectUrl();
      audio.removeEventListener('loadstart', onLoadStart);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('error', onError);
    };
  }, []);

  // Separate effect for ended so it uses latest playNext
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onEnded = () => {
      if (queueIndex >= 0 && queueIndex + 1 < queue.length) {
        playNext();
      } else {
        setIsPlaying(false);
      }
    };
    audio.addEventListener('ended', onEnded);
    return () => audio.removeEventListener('ended', onEnded);
  }, [playNext, queue.length, queueIndex]);

  const activeAyahGlobalNumber = useMemo(() => {
    if (!activeTrack || (!isPlaying && currentTime === 0)) return null;
    if (activeTrack.kind === 'ayah-sample') {
      return activeTrack.globalAyahNumber ?? null;
    }
    if (surahAyahWeights.length === 0 || duration <= 0) return null;
    // Account for ~2.5s Basmala intro if surah has separate Basmala
    const introOffset = activeTrack.surahNumber !== 1 && activeTrack.surahNumber !== 9 ? Math.min(2.5, duration * 0.05) : 0;
    const effectiveElapsed = Math.max(0, currentTime - introOffset);
    const effectiveDuration = Math.max(1, duration - introOffset);
    const ratio = Math.min(1, effectiveElapsed / effectiveDuration);
    const match = surahAyahWeights.find((w) => ratio <= w.endRatio);
    return match ? match.globalNumber : surahAyahWeights[surahAyahWeights.length - 1]?.globalNumber ?? null;
  }, [activeTrack, currentTime, duration, isPlaying, surahAyahWeights]);

  const value = useMemo<AudioContextValue>(
    () => ({
      activeTrack,
      queue,
      queueIndex,
      isPlaying,
      isLoading,
      error,
      currentTime,
      duration,
      activeAyahGlobalNumber,
      playTrack,
      playSurahFromReciter,
      playAyahSample,
      togglePlayPause,
      seek,
      playNext,
      playPrev,
      stop,
      retryCurrent,
    }),
    [
      activeTrack,
      queue,
      queueIndex,
      isPlaying,
      isLoading,
      error,
      currentTime,
      duration,
      activeAyahGlobalNumber,
      playTrack,
      playSurahFromReciter,
      playAyahSample,
      togglePlayPause,
      seek,
      playNext,
      playPrev,
      stop,
      retryCurrent,
    ]
  );

  return <AudioContext.Provider value={value}>{children}</AudioContext.Provider>;
}

export function useAudio(): AudioContextValue {
  const ctx = useContext(AudioContext);
  if (!ctx) throw new Error('useAudio must be used within AudioProvider');
  return ctx;
}
