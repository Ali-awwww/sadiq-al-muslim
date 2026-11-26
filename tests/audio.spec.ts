import { describe, expect, it } from 'vitest';
import {
  ALLOWED_RECITER_IDS,
  getAvailableSurahsForMoshaf,
  getAyahSampleAudio,
  getSurahAudioUrl,
} from '../src/lib/api';
import type { Moshaf } from '../src/types/quran';

describe('audio api and helper functions', () => {
  it('ALLOWED_RECITER_IDS contains exactly the 5 allowed reciter IDs', () => {
    expect(ALLOWED_RECITER_IDS).toEqual([112, 109, 92, 137, 81]);
    expect(ALLOWED_RECITER_IDS).toHaveLength(5);
  });

  describe('getSurahAudioUrl', () => {
    const moshafWithSlash: Moshaf = {
      id: 1,
      name: 'حفص عن عاصم',
      server: 'https://server.mp3quran.net/minsh/',
      surah_total: 114,
      moshaf_type: 1,
      surah_list: '1,2,3',
    };

    const moshafWithoutSlash: Moshaf = {
      id: 2,
      name: 'حفص عن عاصم',
      server: 'https://server.mp3quran.net/minsh',
      surah_total: 114,
      moshaf_type: 1,
      surah_list: '1,2,3',
    };

    it('builds url with normalized trailing slash and pads surah 1 to 001.mp3', () => {
      expect(getSurahAudioUrl(moshafWithSlash, 1)).toBe('https://server.mp3quran.net/minsh/001.mp3');
      expect(getSurahAudioUrl(moshafWithoutSlash, 1)).toBe('https://server.mp3quran.net/minsh/001.mp3');
    });

    it('builds url with normalized trailing slash and pads surah 114 to 114.mp3', () => {
      expect(getSurahAudioUrl(moshafWithSlash, 114)).toBe('https://server.mp3quran.net/minsh/114.mp3');
      expect(getSurahAudioUrl(moshafWithoutSlash, 114)).toBe('https://server.mp3quran.net/minsh/114.mp3');
    });
  });

  describe('getAyahSampleAudio', () => {
    it('returns Al-Minshawi sample for reciter 112 ayah 1', () => {
      expect(getAyahSampleAudio(112, 1)).toEqual({
        url: 'https://cdn.islamic.network/quran/audio/128/ar.minshawi/1.mp3',
        reciterName: 'محمد صديق المنشاوي',
      });
    });

    it('returns Muhammad Ayoub sample for reciter 109 ayah 6236', () => {
      expect(getAyahSampleAudio(109, 6236)).toEqual({
        url: 'https://cdn.islamic.network/quran/audio/128/ar.muhammadayyoub/6236.mp3',
        reciterName: 'محمد أيوب',
      });
    });

    it('returns fallback Minshawi sample for reciters 137, 81, 92, and unknown 999', () => {
      for (const reciterId of [137, 81, 92, 999]) {
        const result = getAyahSampleAudio(reciterId, 7);
        expect(result).toEqual({
          url: 'https://cdn.islamic.network/quran/audio/128/ar.minshawi/7.mp3',
          reciterName: 'محمد صديق المنشاوي',
        });
      }
    });
  });

  describe('getAvailableSurahsForMoshaf', () => {
    it('returns Set with {1, 2, 3, 114} when surah_list is "1,2,3,114"', () => {
      const moshaf: Moshaf = {
        id: 1,
        name: 'مرتل',
        server: 'https://server.com/',
        surah_total: 4,
        moshaf_type: 1,
        surah_list: '1,2,3,114',
      };
      const surahs = getAvailableSurahsForMoshaf(moshaf);
      expect(surahs).toEqual(new Set([1, 2, 3, 114]));
    });

    it('excludes values outside 1..114 and non-numeric values from "0,1,115,abc,114", returning {1, 114}', () => {
      const moshaf: Moshaf = {
        id: 2,
        name: 'مرتل',
        server: 'https://server.com/',
        surah_total: 2,
        moshaf_type: 1,
        surah_list: '0,1,115,abc,114',
      };
      const surahs = getAvailableSurahsForMoshaf(moshaf);
      expect(surahs).toEqual(new Set([1, 114]));
    });

    it('returns empty Set when moshaf is missing or surah_list is missing', () => {
      expect(getAvailableSurahsForMoshaf(undefined)).toEqual(new Set());
      const moshafWithoutList = {
        id: 3,
        name: 'مرتل',
        server: 'https://server.com/',
        surah_total: 0,
        moshaf_type: 1,
      } as Moshaf;
      expect(getAvailableSurahsForMoshaf(moshafWithoutList)).toEqual(new Set());
    });
  });
});
