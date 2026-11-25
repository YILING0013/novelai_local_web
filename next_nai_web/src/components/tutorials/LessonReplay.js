'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Button, IconButton, NativeSelect, Stack, Typography, useMediaQuery } from '@mui/material';
import { Fullscreen, PauseRounded, PlayArrowRounded, ReplayRounded } from '@mui/icons-material';
import { useI18n } from '@/i18n/I18nProvider';
import { getReplayChapters } from '@/content/tutorials/replayChapters.mjs';
import { playLessonDemo } from './playLessonDemo';

const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const speedKey = 'novelai.tutorials.playbackSpeed';

/** 在独立视口中播放当前篇目的绘图组件，轨迹和字幕随实际控件位置变化。 */
export default function LessonReplay({ topic }) {
  const { t, locale } = useI18n();
  const narrow = useMediaQuery('(max-width:899.95px)');
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const chapters = getReplayChapters(topic, narrow, locale);
  const w = narrow ? 390 : 1080,
    h = narrow ? 700 : 660;
  const root = useRef(null),
    screen = useRef(null),
    frame = useRef(null),
    cursor = useRef(null);
  const controls = useRef({
    playing: !reduced,
    visible: false,
    speed: 1,
    seekChapter: null,
    motion: null,
    reduced,
  });
  const [speed, setSpeed] = useState(1);
  const [scale, setScale] = useState(null),
    [started, setStarted] = useState(false),
    [instance, setInstance] = useState(0);
  const [loaded, setLoaded] = useState(null),
    [playing, setPlaying] = useState(!reduced),
    [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false),
    [cue, setCue] = useState({ text: '', chapter: 0 });
  const [rebuilding, setRebuilding] = useState(false);
  const chapterNav = useRef(null);
  useEffect(() => {
    const nav = chapterNav.current;
    const active = nav?.querySelector('[aria-current=step]');
    if (!active) return;
    const item = active.getBoundingClientRect(),
      strip = nav.getBoundingClientRect();
    if (item.left < strip.left) nav.scrollLeft += item.left - strip.left;
    else if (item.right > strip.right) nav.scrollLeft += item.right - strip.right;
  }, [cue.chapter, narrow]);
  const updatePlayback = useCallback((patch) => {
    const playback = Object.assign(controls.current, patch);
    if (playback.motion) {
      if (patch.speed !== undefined) playback.motion.updatePlaybackRate(playback.speed);
      if (playback.visible && (playback.playing || playback.seekChapter !== null)) playback.motion.play();
      else playback.motion.pause();
    }
  }, []);
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(speedKey));
      if (speeds.includes(saved)) {
        setSpeed(saved);
        updatePlayback({ speed: saved });
      }
    } catch {
      // 浏览器禁用存储时，倍速仍可用于当前演示。
    }
  }, [updatePlayback]);
  const changeSpeed = (event) => {
    const next = Number(event.target.value);
    setSpeed(next);
    updatePlayback({ speed: next });
    try {
      localStorage.setItem(speedKey, String(next));
    } catch {
      // 选择已生效，无须访问存储才能播放。
    }
  };
  useEffect(() => {
    controls.current.reduced = reduced;
    if (reduced) {
      updatePlayback({ playing: false });
      setPlaying(false);
    }
  }, [reduced, updatePlayback]);
  useEffect(() => {
    const measure = new ResizeObserver(([entry]) => {
      setScale(Math.min(1, entry.contentRect.width / w, entry.contentRect.height / h));
    });
    measure.observe(screen.current);
    let visible = false;
    const sync = () => {
      updatePlayback({ visible: visible && !document.hidden });
      if (visible) setStarted(true);
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    observer.observe(screen.current);
    document.addEventListener('visibilitychange', sync);
    return () => {
      measure.disconnect();
      observer.disconnect();
      document.removeEventListener('visibilitychange', sync);
    };
  }, [w, h, updatePlayback]);
  useEffect(() => {
    if (!loaded || loaded !== frame.current?.contentDocument) return;
    const controller = new AbortController();
    playLessonDemo(frame.current.contentWindow, {
      signal: controller.signal,
      state: controls,
      cursor: cursor.current,
      locale,
      chapters: getReplayChapters(topic, narrow, locale),
      onStep: (text, chapter) => {
        if (controls.current.seekChapter === null) {
          setRebuilding(false);
          setCue({ text, chapter });
          setPlaying(controls.current.playing);
        }
      },
      onFinish: () => {
        setDone(true);
        setPlaying(false);
        controls.current.playing = false;
      },
    }).catch((error) => {
      if (!controller.signal.aborted) {
        console.error('Tutorial demonstration:', topic, error);
        setFailed(true);
        setRebuilding(false);
        setPlaying(false);
        controls.current.playing = false;
      }
    });
    return () => controller.abort();
  }, [loaded, topic, locale, narrow]);
  const restart = (chapter = null) => {
    setLoaded(null);
    setCue({ text: '', chapter: chapter ?? 0 });
    setFailed(false);
    setDone(false);
    setRebuilding(chapter > 0);
    updatePlayback({ seekChapter: chapter, playing: true });
    setPlaying(true);
    setInstance((i) => i + 1);
  };
  const toggle = () => {
    if (done || failed) {
      restart();
      return;
    }
    updatePlayback({ playing: !playing });
    setPlaying(!playing);
  };
  return (
    <Box
      ref={root}
      role="group"
      aria-label={t('tutorials.topics.' + topic)}
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: 2,
        overflow: 'hidden',
        bgcolor: 'background.paper',
        '&:fullscreen': { display: 'flex', flexDirection: 'column', justifyContent: 'center' },
      }}
    >
      <Box
        ref={screen}
        sx={{
          width: '100%',
          maxWidth: `min(${w}px, ${(76 * w) / h}dvh)`,
          mx: 'auto',
          position: 'relative',
          flexShrink: 0,
          aspectRatio: w + '/' + h,
          overflow: 'hidden',
        }}
      >
        {started && scale !== null && (
          <Box
            sx={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: w,
              height: h,
              transform: 'translate(-50%, -50%) scale(' + scale + ')',
              pointerEvents: 'none',
              visibility: rebuilding ? 'hidden' : 'visible',
            }}
            inert
          >
            <iframe
              ref={frame}
              key={topic + locale + narrow + instance}
              src={'/tutorial-demo.html?topic=' + encodeURIComponent(topic)}
              title={t('tutorials.topics.' + topic)}
              tabIndex={-1}
              onLoad={(e) => setLoaded(e.currentTarget.contentDocument)}
              style={{ width: '100%', height: '100%', border: 0, display: 'block' }}
            />
            <svg
              ref={cursor}
              aria-hidden="true"
              width="45"
              height="48"
              viewBox="-16 -16 45 48"
              style={{
                position: 'absolute',
                left: -16,
                top: -16,
                overflow: 'visible',
                willChange: 'transform',
                pointerEvents: 'none',
                transform: 'translate(' + w / 2 + 'px,' + h / 2 + 'px)',
              }}
            >
              <g data-demo-drag-preview="" visibility="hidden">
                <rect x="13" y="17" width="64" height="51" rx="5" fill="white" stroke="#547494" />
                <image x="16" y="20" width="58" height="45" preserveAspectRatio="xMidYMid meet" />
              </g>
              <circle
                cx="0"
                cy="0"
                r="12"
                fill="none"
                stroke="#1784d5"
                strokeWidth="2"
                opacity="0"
                style={{ transformOrigin: '0 0' }}
              />
              <path
                d="M0 0 L2 20 L7 14 L12 22 L16 20 L11 12 L19 12 Z"
                fill="white"
                stroke="#193148"
                strokeWidth="1.7"
              />
            </svg>
          </Box>
        )}
        {rebuilding && (
          <Typography role="status" sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
            {t('tutorials.seekingChapter')}
          </Typography>
        )}
      </Box>
      {(cue.text || done || failed) && (
        <Typography
          data-demo-caption=""
          variant="body2"
          role={failed ? 'alert' : undefined}
          sx={{ px: 1.5, py: 0.5, textAlign: 'center', bgcolor: 'background.default' }}
        >
          {failed ? t('tutorials.replayError') : done ? t('tutorials.editorPractice.done') : cue.text}
        </Typography>
      )}
      <Stack
        direction="row"
        data-demo-toolbar=""
        alignItems="center"
        gap={0.5}
        sx={{
          minWidth: 0,
          px: { xs: 0.5, sm: 1 },
          py: 0.5,
          borderTop: 1,
          borderColor: 'divider',
          '& > button, & > label': { flexShrink: 0 },
        }}
      >
        <Stack
          component="nav"
          ref={chapterNav}
          aria-label={t('tutorials.demoChapters')}
          direction="row"
          gap={0.5}
          sx={{ flex: '1 1 auto', minWidth: 0, overflowX: 'auto', scrollbarWidth: 'thin', alignItems: 'center' }}
        >
          {chapters.map(({ start, label }, index) => (
            <Button
              key={start}
              size="small"
              aria-current={index === cue.chapter ? 'step' : undefined}
              variant={index === cue.chapter ? 'contained' : 'text'}
              disableElevation
              onClick={() => restart(index)}
              sx={{ minWidth: 0, flexShrink: 0, whiteSpace: 'nowrap', borderRadius: 4, textTransform: 'none' }}
            >
              {label}
            </Button>
          ))}
        </Stack>
        <IconButton size="small" aria-label={t(playing ? 'tutorials.pause' : 'tutorials.play')} onClick={toggle}>
          {playing ? <PauseRounded /> : <PlayArrowRounded />}
        </IconButton>
        <IconButton size="small" aria-label={t('tutorials.replay')} onClick={() => restart()}>
          <ReplayRounded />
        </IconButton>
        <Box
          component="label"
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.75,
            px: 1,
            py: 0.25,
            border: 1,
            borderColor: 'divider',
            borderRadius: 2,
          }}
        >
          <Typography component="span" variant="body2" sx={{ display: { xs: 'none', sm: 'inline' } }}>
            {t('tutorials.playbackSpeed')}
          </Typography>
          <NativeSelect
            value={speed}
            onChange={changeSpeed}
            disableUnderline
            inputProps={{ 'aria-label': t('tutorials.playbackSpeed') }}
            sx={{ fontSize: '0.875rem', fontVariantNumeric: 'tabular-nums' }}
          >
            {speeds.map((rate) => (
              <option key={rate} value={rate}>
                {rate}×
              </option>
            ))}
          </NativeSelect>
        </Box>
        <IconButton
          size="small"
          aria-label={t('tutorials.fullscreen')}
          onClick={() =>
            document.fullscreenElement ? document.exitFullscreen() : root.current.requestFullscreen?.()
          }
        >
          <Fullscreen />
        </IconButton>
      </Stack>
    </Box>
  );
}
