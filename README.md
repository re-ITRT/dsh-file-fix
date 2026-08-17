# dsh-file-fix

DeepSeek Harness（DSH）上传体验优化插件：**统一文件导入体系**——任何后缀的文件都能
拖入 / 粘贴 / 点击选择，**字节上传到附件库**（不依赖工作区路径，服务器部署可用），
文件清单随消息注入模型上下文，历史消息下方显示文件气泡（可下载），agent 可读取内容
或导出到工作区。完全不使用 DSH 官方图片导入链路。

## 背景（DSH Web 原生痛点）

| 痛点 | 现状 |
| --- | --- |
| 非图片文件无法上传 | DSH Web 只收图片；非图片弹「仅支持 PNG、JPG、WebP、GIF」提示 |
| 拖入非图片后 overlay 卡住 | drop 后「拖入图片」界面不消失 |
| 无法点击选择文件 | 没有 file input |
| 粘贴只支持文本 | Ctrl+V 文件无反应 |
| 上传文件 agent 不可见 | 无文件清单注入，agent 只能猜路径（曾猜 75 步） |

## 方案

- 任何文件 drop / 粘贴 / 📎 选择 → 字节上传（`uploadux/persistFile`）→ host 存入**内容寻址附件库**
  `~/.dsh/attachments/uploadux/`（sha256 去重，manifest.jsonl 索引）——与工作区完全解耦
- 发送时（`agent/pre-step`）注入文件清单消息（role=user + plugin 来源 + notice 表单：
  UI 只显示「📎 附件 N 个文件」一行摘要，模型读到完整清单与 attachment_id）
- **模型侧工具**：
  - `read_attachment`：按 attachment_id 读取内容；支持分段（offset/limit/more，默认段
    48 KB 避开 dsh spill-policy 的 50 KB 内联阈值）；大文件自动镜像完整副本到工作区
    `.dsh-uploadux/reads/`（官方 `read` 工具在 spill-policy 中豁免，可读全量）
  - `place_attachment`：把附件字节导出到会话工作区任意路径（边界校验，防 `../` 逃逸）
- 历史消息：`uploadux/files` 会话事件（ignorable）记录「消息 ↔ 文件」关联，客户端
  shadow 官方 user 节点渲染器，在文字气泡下方渲染文件列表气泡（文件名+大小+下载链接，
  下载走 `/plugins/dsh-file-fix/download/<attachmentId>`，限 API token）
- 交互照 Hermes：统一 rail 混排（缩略图降采样队列）、chip 三态（上传中/完成/失败点击重试）、
  删除 chip 连带删附件、Esc 取消拖拽、深度计数防闪烁、drop 后焦点回输入框
- 限制（插件 config 可覆盖）：单文件 50 MB、每批 20 个、批量总量 200 MB；超限整批拒绝 + 提示

## 结构

- `src/` host 侧：`upload` Typert Remote 服务（persistFile / limits / remove / markPending /
  listFiles）+ 附件库（内容寻址）+ 桥（session 事件监听 → 关联表 + pre-step 注入）+
  `read_attachment` / `place_attachment` 工具 + 下载路由
- `client/` 浏览器侧：document 级 drop/paste 拦截（捕获阶段）＋ rail + 📎 选择按钮 +
  文件气泡（shadow `conversation.chat.node` 的 user/steering 键）
- `scripts/build-client.mjs` client bundle 构建（esbuild CJS + `__ModuleLoader__` 外壳，zod 内联）
- `scripts/repair-sessions.mjs` 会话日志修复工具（帧级 zstd 解压 → 清洗 → 重压；曾用于清除
  早期版本误存进日志的 system 角色消息）

## 已知平台限制（win32）

- dsh spill-policy 阈值 50 KB：纯文本工具结果超过即替换为「头尾预览 + spill 路径」，
  且 spill 定位是 Windows 路径（agent 的 bash 为 Linux 语义读不了）——插件已通过
  48 KB 默认段 + 工作区镜像规避
- 工具集无 shell 执行能力时 agent 无法解压/运行文件（环境问题，非插件）

## 安装（推荐：npm 官方渠道）

```bash
dsh plugin --profile web add dsh-file-fix@^0.1.1
```

装完重启 `dsh web` 即生效（输入框出现「上传文件」按钮）。

**已实测验证的完整生命周期**（干净 profile 实测）：

| 操作 | 命令 | 结果 |
| --- | --- | --- |
| 全新安装 | `dsh plugin --profile web add dsh-file-fix@^0.1.1` | 依赖 + 自动登记 bundles（插件树加载）✅ |
| 卸载 | `dsh plugin --profile web remove dsh-file-fix` | 依赖 + bundles 登记自动移除 ✅ |
| 重装 | 同安装命令 | 全部恢复 ✅ |

> **注意**：pnpm 10+ 首次 add 可能报 `[ERR_PNPM_IGNORED_BUILDS]`（dsh 官方依赖的原生模块构建被拦截，任何插件都如此）——此时**再跑一次 add** 即可（allowBuilds 已登记后 pnpm 干净退出，dsh 完成登记）。

## 从源码构建安装

```bash
# 1. 构建（需要 deepseek-harness 源码仓库的 node_modules 提供 tsc/esbuild）
npm install        # 或 pnpm install（package-lock 已提交）
npm run build      # host tsc 编译到 lib/ + esbuild 打包 dist/client.js

# 2. 挂载到 dsh profile（以 web profile 为例）
node scripts/mk-junction.cjs node_modules "<你的 dsh profile>/node_modules"
node scripts/mk-junction.cjs "<你的 dsh profile>/web/node_modules/dsh-file-fix" "$PWD"
# 3. 在 profile 的 cordis.patch.yml 里加载本插件（参照 cordis.dev.yml）
```

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
node scripts/mk-junction.cjs "C:\Users\<user>\.dsh\profiles\web\node_modules\dsh-file-fix" "C:\Users\<user>\hermes-workspace\dsh-file-fix"
```

开发循环（在 deepseek-harness 目录跑）：

```bash
pnpm dsh web --patch ../dsh-file-fix/cordis.dev.yml --port 3081
# host 改动：npm run build 后重启 dsh（lib/ 是包入口）
# client 改动：npm run build（重建 dist/client.js）+ 刷新页面
```

```bash
npm run typecheck   # host + client 类型检查（用仓库的 tsc：
                    # node <repo>/node_modules/typescript/bin/tsc -p tsconfig.json --noEmit）
npm run build       # tsc 编译宿主侧到 lib/ + esbuild 打包 client bundle
```

## 日志约定

`[dsh-file-fix]` 前缀，全链路可还原：`intake(入口/分流统计) → persistFile(校验/拒绝 code/写入路径/耗时)
→ ref injected(引用注入) → chip removed(删除)`，失败带 code（TOO_LARGE / EMPTY / SESSION_NOT_FOUND /
NO_WORKSPACE / WRITE_FAILED / INVALID_PATH / REMOVE_FAILED）。

## 设计稿

见 `docs/design.md`（v0.2：完全不保留官方链路 + 照 Hermes 交互）。
