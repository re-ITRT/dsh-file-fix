# dsh-upload-ux

DeepSeek Harness（DSH）上传体验优化插件。

## 背景（DSH Web 原生痛点）

| 痛点 | 现状 |
| --- | --- |
| 非图片文件无法上传 | DSH Web 只有整页 drop，且只收图片；非图片弹「仅支持 PNG、JPG、WebP、GIF」提示 |
| 拖入非图片后 overlay 卡住 | drop 后「拖入图片」界面不消失 |
| 无法点击选择文件 | 没有 file input |
| 粘贴只支持文本 | Ctrl+V 文件无反应 |

## 方案（思路已在 dsh-vision-tool 中验证）

- 非图片文件 drop / 粘贴 → host 落盘到会话工作区 `attachments/` → 引用文本注入输入框
- 处理后派发合成 `dragend` 复位原生 drag overlay
- 纯非图片 drop 完全接管，压掉原生误提示；混合 drop 只让图片走原生流程
- 图片仍走 DSH 原生流程（缩略图 rail + pre-step 拆分）

## 结构

- `src/` host 侧（Cordis 插件：文件落盘 / Typert Remote 服务）
- `client/` 浏览器侧（drop/paste 拦截、引用注入、可选设置页）
- `scripts/build-client.mjs` client bundle 构建（esbuild CJS + `__ModuleLoader__` 外壳）

## 开发

```bash
npm install
npm run typecheck   # host + client 类型检查
npm run build       # tsc + client bundle
```

单实例要求：与 DSH 共用同一棵 node_modules —— `cd ~/.dsh/profiles/web && npm i @deepseek-ai/dsh@<ver> <本插件路径>`，从 profile 目录跑 `npx dsh web`。
