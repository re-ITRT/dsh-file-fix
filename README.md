# dsh-upload-ux

DeepSeek Harness（DSH）上传体验优化插件：**统一文件导入体系**——任何后缀的文件都能
拖入 / 粘贴 / 点击选择，落盘到会话工作区，并注入 `@file:` 引用供 agent 用 fs 工具读取。
完全不使用 DSH 官方图片导入链路。

## 背景（DSH Web 原生痛点）

| 痛点 | 现状 |
| --- | --- |
| 非图片文件无法上传 | DSH Web 只收图片；非图片弹「仅支持 PNG、JPG、WebP、GIF」提示 |
| 拖入非图片后 overlay 卡住 | drop 后「拖入图片」界面不消失 |
| 无法点击选择文件 | 没有 file input |
| 粘贴只支持文本 | Ctrl+V 文件无反应 |

## 方案

- 任何文件 drop / 粘贴 / 📎 选择 → 字节上传（`upload/persistFile`）→ host 落盘会话工作区
  `attachments/`（重名自动 `-1` 后缀）→ 引用文本注入输入框（`@file:attachments/x（1.2 MB）`）
- 图片同权（不保留官方链路）：作为带缩略图的普通文件落盘；agent 需要看图时用 DSH 自带
  `read_image` 工具（要求当前模型声明 image input）
- 交互照 Hermes：统一 rail 混排（缩略图降采样队列）、chip 三态（上传中/完成/失败点击重试）、
  删除 chip 连带删工作区文件、Esc 取消拖拽、深度计数防闪烁、drop 后焦点回输入框
- 限制（插件 config 可覆盖）：单文件 50 MB、每批 20 个、批量总量 200 MB；超限整批拒绝 + 提示

## 结构

- `src/` host 侧：`upload` Typert Remote 服务（persistFile / limits / remove）+ 落盘逻辑
- `client/` 浏览器侧：document 级 drop/paste 拦截（捕获阶段）＋ rail + 📎 选择按钮
- `scripts/build-client.mjs` client bundle 构建（esbuild CJS + `__ModuleLoader__` 外壳，zod 内联）

## 开发环境（官方教程路径：源码 checkout + 干净 profile）

一次性准备：

```bash
# 1. 源码 checkout（master），pnpm install + build
# 2. profile 保持干净（不 npm install 任何 @deepseek-ai 包）：
#    ~/.dsh/profiles/web/ 里只有 package.json（bundles 声明）+ cordis.patch.yml
#    —— 运行时会由 dsh 自动 heal 出 ~/.dsh/profiles/node_modules 源码链接
# 3. 本项目依赖解析指向 heal 产物：
node scripts/mk-junction.cjs node_modules "C:\Users\<user>\.dsh\profiles\node_modules"
# 4. 让 profile 能以包名解析本项目（client 插件发现机制需要）：
node scripts/mk-junction.cjs "C:\Users\<user>\.dsh\profiles\web\node_modules\dsh-upload-ux" "C:\Users\<user>\hermes-workspace\dsh-upload-ux"
```

开发循环（在 deepseek-harness 目录跑）：

```bash
pnpm dsh web --patch ../dsh-upload-ux/cordis.dev.yml --port 3081
# host 改动：npm run build 后重启 dsh（lib/ 是包入口）
# client 改动：npm run build（重建 dist/client.js）+ 刷新页面
```

```bash
npm run typecheck   # host + client 类型检查（用仓库的 tsc：
                    # node <repo>/node_modules/typescript/bin/tsc -p tsconfig.json --noEmit）
npm run build       # tsc 编译宿主侧到 lib/ + esbuild 打包 client bundle
```

## 日志约定

`[dsh-upload-ux]` 前缀，全链路可还原：`intake(入口/分流统计) → persistFile(校验/拒绝 code/写入路径/耗时)
→ ref injected(引用注入) → chip removed(删除)`，失败带 code（TOO_LARGE / EMPTY / SESSION_NOT_FOUND /
NO_WORKSPACE / WRITE_FAILED / INVALID_PATH / REMOVE_FAILED）。

## 设计稿

见 `docs/design.md`（v0.2：完全不保留官方链路 + 照 Hermes 交互）。
