'use client';

import { createContext } from 'react';

// 公开演示复用真实编辑器，只在内存中编辑；账号请求、保存和导出入口由各功能禁用。
const PublicDemoContext = createContext(false);

export default PublicDemoContext;
