import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { fetchSurahUthmani, getAyahSampleAudio, getSurahAudioUrl } from '../lib/api';
import {
  buildSurahWeightEntries,
  fetchSurahAyahTimings,
  getSeekTimeSecondsForAyah,
  resolveActiveAyahFromTime,
  type AyahTimingSegment,
  type SurahWeightEntry,
} from '../lib/audioSync';
import { getCachedAudioObjectUrl } from '../lib/cache';
import type { Ayah, Moshaf, Reciter } from '../types/quran';

export interface AudioTrack {
  id: string;
  kind: 'surah' | 'ayah-sample';
  surahNumber: number;
  surahName: string;
  reciterName: string;
  reciterId?: number;
  moshafId?: number;
  url: string;
  ayahNumberInSurah?: number;
  globalAyahNumber?: number;
  isSample?: boolean;
}

export interface PlaySurahOptions {
  startAyahNumber?: number;
  startGlobalAyahNumber?: number;
}

interface PendingSeekTarget {
  trackId: string;
  surahNumber: number;
  ayahNumberInSurah: number;
  globalAyahNumber?: number;
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
  activeSurahNumber: number | null;
  activeAyahInSurah: number | null;
  playTrack: (
    track: AudioTrack,
    queue?: AudioTrack[],
    startIndex?: number,
    options?: PlaySurahOptions
  ) => Promise<void>;
  playSurahFromReciter: (
    reciter: Reciter,
    moshaf: Moshaf,
    surahNumber: number,
    surahName: string,
    queueSurahs?: Array<{ number: number; name: string }>,
    options?: PlaySurahOptions
  ) => Promise<void>;
  jumpToSurahAyah: (
    reciter: Reciter,
    moshaf: Moshaf,
    surahNumber: number,
    surahName: string,
    ayahNumberInSurah: number,
    queueSurahs?: Array<{ number: number; name: string }>,
    globalAyahNumber?: number
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
  const playbackTokenRef = useRef(0);
  const activeTrackIdRef = useRef<string | null>(null);
  const pendingSeekRef = useRef<PendingSeekTarget | null>(null);
  const timingsRef = useRef<AyahTimingSegment[]>([]);
  const timingsReadyRef = useRef(false);
  const weightsRef = useRef<SurahWeightEntry[]>([]);
  const weightsReadyRef = useRef(false);
  const unmuteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [activeTrack, setActiveTrack] = useState<AudioTrack | null>(null);
  const [queue, setQueue] = useState<AudioTrack[]>([]);
  const [queueIndex, setQueueIndex] = useState<number>(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [surahTimings, setSurahTimings] = useState<AyahTimingSegment[]>([]);
  const [surahAyahWeights, setSurahAyahWeights] = useState<SurahWeightEntry[]>([]);
  const [pendingTargetAyah, setPendingTargetAyah] = useState<PendingSeekTarget | null>(null);

  const cleanupObjectUrl = () => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  };

  const clearUnmuteTimer = () => {
    if (unmuteTimerRef.current) {
      clearTimeout(unmuteTimerRef.current);
      unmuteTimerRef.current = null;
    }
  };

  const safeUnmute = useCallback(() => {
    clearUnmuteTimer();
    const audio = audioRef.current;
    if (audio) {
      audio.muted = false;
    }
  }, []);

  const tryApplyPendingSeek = useCallback(() => {
    const audio = audioRef.current;
    const pending = pendingSeekRef.current;
    if (!audio || !pending) return false;
    if (activeTrackIdRef.current !== pending.trackId) return false;
    if (audio.readyState < 1) return false; // wait for loadedmetadata

    const dur = Number.isFinite(audio.duration) ? audio.duration : 0;

    // Wait until timing table check completes before falling back to weights
    if (!timingsReadyRef.current) return false;

    const hasTimings = timingsRef.current.length > 0;
    if (!hasTimings && !weightsReadyRef.current) return false;

    const seekSec = getSeekTimeSecondsForAyah({
      surahNumber: pending.surahNumber,
      ayahNumberInSurah: pending.ayahNumberInSurah,
      timings: timingsRef.current,
      durationSeconds: dur,
      weights: weightsRef.current,
    });

    if (seekSec === null) return false;

    pendingSeekRef.current = null;
    setPendingTargetAyah(null);

    if (seekSec > 0.05 && Math.abs(audio.currentTime - seekSec) > 0.25) {
      const handleSeeked = () => {
        safeUnmute();
      };
      audio.addEventListener('seeked', handleSeeked, { once: true });
      clearUnmuteTimer();
      unmuteTimerRef.current = setTimeout(() => {
        audio.removeEventListener('seeked', handleSeeked);
        safeUnmute();
      }, 600);

      audio.currentTime = seekSec;
      setCurrentTime(seekSec);
    } else {
      safeUnmute();
    }

    return true;
  }, [safeUnmute]);

  const loadSurahSyncData = useCallback(
    async (track: AudioTrack, token: number) => {
      timingsRef.current = [];
      timingsReadyRef.current = false;
      weightsRef.current = [];
      weightsReadyRef.current = false;

      const timingPromise = track.moshafId
        ? fetchSurahAyahTimings(track.moshafId, track.surahNumber)
        : Promise.resolve<AyahTimingSegment[]>([]);

      const weightsPromise = fetchSurahUthmani(track.surahNumber)
        .then(({ data }) => buildSurahWeightEntries(data.ayahs))
        .catch(() => [] as SurahWeightEntry[]);

      const [timings, weights] = await Promise.all([
        timingPromise.then((res) => {
          if (playbackTokenRef.current === token) {
            timingsRef.current = res;
            timingsReadyRef.current = true;
            setSurahTimings(res);
            if (res.length > 0) {
              tryApplyPendingSeek();
            }
          }
          return res;
        }),
        weightsPromise.then((res) => {
          if (playbackTokenRef.current === token) {
            weightsRef.current = res;
            weightsReadyRef.current = true;
            setSurahAyahWeights(res);
          }
          return res;
        }),
      ]);

      if (playbackTokenRef.current !== token) return;

      if (timings.length === 0 && weights.length === 0) {
        // Nothing available to seek by; unmute cleanly
        pendingSeekRef.current = null;
        setPendingTargetAyah(null);
        safeUnmute();
        return;
      }

      tryApplyPendingSeek();
    },
    [safeUnmute, tryApplyPendingSeek]
  );

  const startPlaybackForTrack = useCallback(
    async (track: AudioTrack, options?: PlaySurahOptions) => {
      const audio = audioRef.current;
      if (!audio) return;

      const token = ++playbackTokenRef.current;
      activeTrackIdRef.current = track.id;

      const startAyah =
        options?.startAyahNumber && options.startAyahNumber > 1
          ? Math.floor(options.startAyahNumber)
          : 1;

      setError(null);
      setIsLoading(true);
      setCurrentTime(0);
      setDuration(0);
      setActiveTrack(track);
      setSurahTimings([]);
      setSurahAyahWeights([]);
      clearUnmuteTimer();

      if (track.kind === 'surah' && startAyah > 1) {
        const pending: PendingSeekTarget = {
          trackId: track.id,
          surahNumber: track.surahNumber,
          ayahNumberInSurah: startAyah,
          globalAyahNumber: options?.startGlobalAyahNumber,
        };
        pendingSeekRef.current = pending;
        setPendingTargetAyah(pending);
        // Temporarily mute during initial metadata/seek so Ayah 1 isn't heard before jumping
        audio.muted = true;
        unmuteTimerRef.current = setTimeout(() => {
          safeUnmute();
        }, 2500);
      } else {
        pendingSeekRef.current = null;
        setPendingTargetAyah(null);
        audio.muted = false;
      }

      if (track.kind === 'surah') {
        void loadSurahSyncData(track, token);
      } else {
        timingsRef.current = [];
        timingsReadyRef.current = true;
        weightsRef.current = [];
        weightsReadyRef.current = true;
      }

      cleanupObjectUrl();

      try {
        const cachedBlobUrl = await getCachedAudioObjectUrl(track.url);
        if (playbackTokenRef.current !== token) return;

        if (cachedBlobUrl) {
          objectUrlRef.current = cachedBlobUrl;
          audio.src = cachedBlobUrl;
        } else {
          audio.src = track.url;
        }
        audio.load();
        await audio.play();
      } catch (err) {
        if (playbackTokenRef.current !== token) return;
        safeUnmute();
        pendingSeekRef.current = null;
        setPendingTargetAyah(null);
        setIsLoading(false);
        setIsPlaying(false);
        if (err instanceof Error && err.name === 'NotAllowedError') {
          setError('اضغط تشغيل لبدء الصوت');
        } else {
          setError('تعذر تشغيل الملف الصوتي. تحقق من الاتصال أو جرّب إعادة المحاولة.');
        }
      }
    },
    [loadSurahSyncData, safeUnmute]
  );

  const playTrack = useCallback(
    async (
      track: AudioTrack,
      nextQueue?: AudioTrack[],
      startIndex = 0,
      options?: PlaySurahOptions
    ) => {
      if (nextQueue && nextQueue.length > 0) {
        setQueue(nextQueue);
        setQueueIndex(startIndex);
      } else {
        setQueue([track]);
        setQueueIndex(0);
      }
      await startPlaybackForTrack(track, options);
    },
    [startPlaybackForTrack]
  );

  const playSurahFromReciter = useCallback(
    async (
      reciter: Reciter,
      moshaf: Moshaf,
      surahNumber: number,
      surahName: string,
      queueSurahs?: Array<{ number: number; name: string }>,
      options?: PlaySurahOptions
    ) => {
      if (queueSurahs && queueSurahs.length > 0) {
        const tracks: AudioTrack[] = queueSurahs.map((s) => ({
          id: `${reciter.id}-${moshaf.id}-${s.number}`,
          kind: 'surah',
          surahNumber: s.number,
          surahName: s.name,
          reciterName: reciter.name,
          reciterId: reciter.id,
          moshafId: moshaf.id,
          url: getSurahAudioUrl(moshaf, s.number),
        }));
        const idx = Math.max(0, tracks.findIndex((t) => t.surahNumber === surahNumber));
        await playTrack(tracks[idx], tracks, idx, options);
      } else {
        const track: AudioTrack = {
          id: `${reciter.id}-${moshaf.id}-${surahNumber}`,
          kind: 'surah',
          surahNumber,
          surahName,
          reciterName: reciter.name,
          reciterId: reciter.id,
          moshafId: moshaf.id,
          url: getSurahAudioUrl(moshaf, surahNumber),
        };
        await playTrack(track, undefined, 0, options);
      }
    },
    [playTrack]
  );

  const jumpToSurahAyah = useCallback(
    async (
      reciter: Reciter,
      moshaf: Moshaf,
      surahNumber: number,
      surahName: string,
      ayahNumberInSurah: number,
      queueSurahs?: Array<{ number: number; name: string }>,
      globalAyahNumber?: number
    ) => {
      const targetTrackId = `${reciter.id}-${moshaf.id}-${surahNumber}`;
      const audio = audioRef.current;
      const safeAyah = Math.max(1, Math.floor(ayahNumberInSurah));

      if (
        audio &&
        activeTrack &&
        activeTrack.id === targetTrackId &&
        audio.src
      ) {
        const pending: PendingSeekTarget = {
          trackId: targetTrackId,
          surahNumber,
          ayahNumberInSurah: safeAyah,
          globalAyahNumber,
        };
        pendingSeekRef.current = pending;
        setPendingTargetAyah(pending);

        if (safeAyah === 1) {
          pendingSeekRef.current = null;
          setPendingTargetAyah(null);
          audio.currentTime = 0;
          setCurrentTime(0);
          safeUnmute();
        } else {
          const applied = tryApplyPendingSeek();
          if (!applied) {
            audio.muted = true;
          }
        }

        if (audio.paused) {
          setError(null);
          try {
            await audio.play();
          } catch {
            safeUnmute();
            setError('اضغط تشغيل لبدء الصوت');
          }
        }
        return;
      }

      await playSurahFromReciter(
        reciter,
        moshaf,
        surahNumber,
        surahName,
        queueSurahs,
        {
          startAyahNumber: safeAyah,
          startGlobalAyahNumber: globalAyahNumber,
        }
      );
    },
    [activeTrack, playSurahFromReciter, safeUnmute, tryApplyPendingSeek]
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

  const seek = useCallback(
    (time: number) => {
      const audio = audioRef.current;
      if (!audio || !Number.isFinite(time)) return;
      pendingSeekRef.current = null;
      setPendingTargetAyah(null);
      safeUnmute();
      audio.currentTime = Math.max(0, Math.min(time, audio.duration || time));
      setCurrentTime(audio.currentTime);
    },
    [safeUnmute]
  );

  const stop = useCallback(() => {
    playbackTokenRef.current += 1;
    activeTrackIdRef.current = null;
    pendingSeekRef.current = null;
    timingsRef.current = [];
    timingsReadyRef.current = false;
    weightsRef.current = [];
    weightsReadyRef.current = false;
    clearUnmuteTimer();

    const audio = audioRef.current;
    if (audio) {
      audio.muted = false;
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
    setSurahTimings([]);
    setSurahAyahWeights([]);
    setPendingTargetAyah(null);
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
      tryApplyPendingSeek();
      setIsLoading(false);
    };
    const onCanPlay = () => {
      tryApplyPendingSeek();
      setIsLoading(false);
    };
    const onPlay = () => {
      setIsPlaying(true);
      setIsLoading(false);
    };
    const onPause = () => setIsPlaying(false);
    const onTimeUpdate = () => {
      if (!pendingSeekRef.current) {
        setCurrentTime(audio.currentTime);
      }
    };
    const onError = () => {
      safeUnmute();
      pendingSeekRef.current = null;
      setPendingTargetAyah(null);
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
      clearUnmuteTimer();
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
  }, [safeUnmute, tryApplyPendingSeek]);

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

  const resolvedActiveAyah = useMemo(() => {
    if (!activeTrack) return null;

    if (pendingTargetAyah && pendingTargetAyah.trackId === activeTrack.id) {
      const fromWeights = surahAyahWeights.find(
        (w) => w.ayahNumberInSurah === pendingTargetAyah.ayahNumberInSurah
      );
      const firstGlobal = surahAyahWeights[0]?.globalNumber;
      const globalNum =
        pendingTargetAyah.globalAyahNumber ??
        fromWeights?.globalNumber ??
        (firstGlobal !== undefined
          ? firstGlobal + pendingTargetAyah.ayahNumberInSurah - 1
          : null);
      if (globalNum !== null) {
        return {
          ayahNumberInSurah: pendingTargetAyah.ayahNumberInSurah,
          globalAyahNumber: globalNum,
        };
      }
      return null;
    }

    if (!isPlaying && currentTime === 0) return null;

    if (activeTrack.kind === 'ayah-sample') {
      if (activeTrack.globalAyahNumber == null) return null;
      return {
        ayahNumberInSurah: activeTrack.ayahNumberInSurah ?? 1,
        globalAyahNumber: activeTrack.globalAyahNumber,
      };
    }

    return resolveActiveAyahFromTime({
      currentTimeSeconds: currentTime,
      durationSeconds: duration,
      surahNumber: activeTrack.surahNumber,
      timings: surahTimings,
      weights: surahAyahWeights,
      firstGlobalAyahOfSurah: surahAyahWeights[0]?.globalNumber,
    });
  }, [
    activeTrack,
    currentTime,
    duration,
    isPlaying,
    pendingTargetAyah,
    surahAyahWeights,
    surahTimings,
  ]);

  const activeAyahGlobalNumber = resolvedActiveAyah?.globalAyahNumber ?? null;
  const activeSurahNumber = activeTrack?.surahNumber ?? null;
  const activeAyahInSurah = resolvedActiveAyah?.ayahNumberInSurah ?? null;

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
      activeSurahNumber,
      activeAyahInSurah,
      playTrack,
      playSurahFromReciter,
      jumpToSurahAyah,
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
      activeSurahNumber,
      activeAyahInSurah,
      playTrack,
      playSurahFromReciter,
      jumpToSurahAyah,
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
