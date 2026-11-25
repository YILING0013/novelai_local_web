'use client';
import { useEffect, useState } from 'react';
import TutorialDemoWorkspace from '@/components/tutorials/TutorialDemoWorkspace';

/** 从静态导出页打开指定篇目的离线演示。 */
export default function TutorialDemoPage() {
  const [topic, setTopic] = useState(null);
  useEffect(() => setTopic(new URLSearchParams(location.search).get('topic')), []);
  return topic && <TutorialDemoWorkspace topic={topic} />;
}
