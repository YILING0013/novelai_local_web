import { useEffect, useMemo, useState } from 'react';
import { getNovelAIImageTokenizer } from '../PromptEditor/novelAIImageTokenizer.mjs';
import { getNoteTokenCount, NOTE_TOKEN_MODEL } from './noteLimits.mjs';

/**
 * 为保存和编辑对话框加载同一分词器；加载失败明确提示，并允许用户重新加载。
 * @param {boolean} open 对话框是否打开。
 * @param {string} positive 正文正向提示词。
 * @param {string} negative 正文负向提示词。
 * @param {object[]} characters 已解析的角色卡。
 * @returns {{tokenCount:number|null,status:string,retry:Function}} token 总数、加载状态和重试入口。
 */
export default function useNoteTokenCount(open, positive, negative, characters) {
  const [tokenizer, setTokenizer] = useState(null);
  const [status, setStatus] = useState('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setStatus('loading');
    getNovelAIImageTokenizer(NOTE_TOKEN_MODEL).then(({ tokenizer: loaded }) => {
      if (!cancelled) {
        setTokenizer(loaded);
        setStatus('ready');
      }
    }).catch(() => {
      if (!cancelled) {
        setTokenizer(null);
        setStatus('error');
      }
    });
    return () => { cancelled = true; };
  }, [open, attempt]);

  const tokenCount = useMemo(() => tokenizer && open
    ? getNoteTokenCount(tokenizer, positive, negative, characters) : null,
  [tokenizer, open, positive, negative, characters]);

  return { tokenCount, status, retry: () => setAttempt((previous) => previous + 1) };
}
