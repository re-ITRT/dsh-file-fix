# dsh-file-fix 设计稿 v0.2

> 目标：把 dsh 的「图片专属导入」改为「统一文件导入体系」——任何后缀都走同一条导入通道。
> 已拍板：**完全不保留官方导入链路**（图片也走我们的通道），其余照 Hermes 的做法。
> 本稿到方案层，实现细节（精确 API/工作区解析）在写代码时再深挖。

---

## 一、探究结论

### 1. Hermes（参照模型）怎么做

源码：`apps/desktop/src/app/chat/hooks/use-composer-actions.ts`、`composer/hooks/use-composer-drop.ts`、`use-file-drop-zone.ts`

核心机制：**统一附件抽象 + 统一 rail + 交互细节**。

- 所有附件是一种东西：`ComposerAttachment`（`kind: image | file | folder | url | review`），
  混排在**同一条**输入框 rail 上（label 显示名 + thumbnail 缩略图 + uploadState 上传状态）。
- 图片：字节保存 + 缩略图走**专用降采样队列**（`downscaleDataUrlForPreview`）；提交时读字节给 vision。
- 非图片：路径引用（Electron 能读本机文件系统）。
- 交互细节（照抄清单）：整页 drop 区、enter/leave **深度计数**防闪烁、离开视口边界强制复位、
  **Esc 取消拖拽**、drop 后**焦点回输入框**、失败**逐个提示**（不整批吞）、
  移除附件 → **删除落盘文件**（image.detach）、chip 三态（上传中/完成/失败）。

### 2. dsh（目标平台）现状

- **附件体系只认图片**：`ctx.attachments` 白名单 png/jpeg/webp/gif，sha256 内容寻址。
- **入口只认图片**：`InputBar.tsx` 的 `intakeImages`（document 级 drop + paste）→ 格式白名单预检
  → 非图片 toast「仅支持 PNG、JPG、WebP、GIF 格式的图片」。
- 图片官方链路：draft rail → `serializeImages` → 消息 image block → pre-step。
- 文件能力现成：`ctx.fs`（`writeBytes` 等，fs-local 实现），agent 侧已有成熟 fs 工具。
- **`read_image` 工具现成**（tool-fs）：agent 调它读工作区图片 → 存官方附件 → image block 进
  模型上下文（要求当前模型 route 声明 image input）。**图片对模型可见由它兜底，我们不用碰。**
- 客户端扩展面：slot 体系（`conversation.composer.dock` / `conversation.input.*` 等）+ Typert Remote。

### 3. 结论

统一文件导入体系 = **任何文件（含图片）→ 拦截接管 → 字节上传 → host 落盘会话工作区 → 引用注入**。
图片只是带缩略图的普通文件；发送后 agent 用 fs 读文件、用 read_image 读图——官方导入链路零复用。

---

## 二、用户视角：每种操作看到什么

### 入口（全部接管，不再有"仅支持图片"）

| 入口 | 现状 | 目标 |
| --- | --- | --- |
| 整页拖入 | 只收图片 | **任何文件**（含图片）都收 |
| 剪贴板粘贴（Ctrl+V） | 只收图片 | **任何文件**都收（纯文本粘贴不受影响） |
| 点击选择 | 无入口 | composer dock 加「📎」按钮 → 文件选择框（accept 所有类型） |

### 统一 rail（照 Hermes：一条 rail 混排所有类型）

- 每个文件一个 chip：**文件名 + 大小**；图片额外有**缩略图**（降采样队列，照 Hermes）。
- chip 三态：`上传中(进度) → 完成(大小/缩略图) → 失败(原因 + 点击重试)`；chip 可删除。
- 删除 chip → 调 `upload/remove` **连工作区文件一起删**（照 Hermes image.detach）。
- 拖拽悬停 overlay 文案「拖入文件」；drop 后 overlay 必定复位（不再卡住）。

### 上传完成后

- 引用文本注入输入框末尾（照 Hermes 的 refText 风格）：

  ```
  @file:attachments/demo.zip（1.2 MB）
  ```

- 用户发送 → agent 视角：工作区 `attachments/` 下多了这些文件。
  - 普通文件 → agent 用 fs 工具读；
  - 图片 → agent 用 `read_image` 工具把图装进上下文（模型需声明 image input，否则退化为路径引用，
    与其他文件一致——这是模型能力问题，不是导入问题）。

### 细节效果（照 Hermes）

1. Esc 取消拖拽；离开视口边界强制复位 overlay；drop 后焦点回输入框。
2. 超限整批拒绝 + 明确提示（单文件大小 / 批量数量），与官方图片预检同一交互范式。
3. 失败绝不吞输入：上传失败，用户文本原样保留 + 明确错误提示。
4. 混合批量（图+文件）同批处理，rail 顺序 = 加入顺序。

---

## 三、技术方案

### host 侧（`src/`）

- **Typert Remote 服务**（命名空间 `upload`），端点：
  - `upload/persistFile(sessionId, name, mediaType, data)` → 校验（大小限制、空文件、文件名清洗：
    剥路径、去控制字符、截断，照官方 `displayName` 手法）→ `ctx.fs.writeBytes` 写
    会话工作区 `attachments/<清洗后文件名>`（重名自动 `-1`/`-2` 后缀）→ 返回 `{ relPath, size }`；
  - `upload/limits` → 部署限制（客户端预检）；
  - `upload/remove(sessionId, relPath)` → 删除落盘文件（chip 删除时调用）。
- 复用 `ctx.fs`（工作区文件对 agent 天然可见），不发明第二套文件体系。
- 限制默认值（插件 config 可覆盖，不做 UI 设置页）：单文件 50 MB、每批 20 个、批量总量 200 MB。
- 所有注册走 `ctx.effect`，卸载自动清理。

### client 侧（`client/`）

- **拦截层**（document 级，捕获阶段）：`dragenter/over/leave/drop` + composer `paste`，
  **全部文件**（含图片）完全接管：`preventDefault + stopPropagation` 压掉官方一切行为
  （含「仅支持 PNG…」误提示），处理后派发合成 `dragend` 复位官方 overlay。
  深度计数防闪烁、视口边界复位、Esc 取消——照 Hermes 实现。
- **统一 rail**：经 composer slot 注册 chip 列表，混排 image/file（图片缩略图走降采样队列）。
- **引用注入**：上传完成后 `@file:` 引用文本写入输入框（复用官方 draft/keyboard 机制）。
- 图片不调用官方 `addImages`、不走官方 draft rail、不碰 `serializeImages`——零官方链路复用。

### 数据流

```
drop/paste/📎(File[])
  → 拦截层全部接管（preventDefault+stopPropagation，派发合成 dragend 复位 overlay）
  → chip 上 rail（上传中）
  → readAsDataURL → upload/persistFile ──→ host 校验 → ctx.fs 写工作区 attachments/
  → 返回 relPath+size → chip 完成（图片补缩略图）
  → 引用文本注入输入框 → 用户发送 → agent 用 fs / read_image 处理
失败 → chip 失败态（原因+重试）；删除 chip → upload/remove
```

### 不做什么（v1 边界）

- 不调官方图片链路任何 API（intakeImages / addImages / serializeImages 全不碰）；
- 不做目录上传（drop 文件夹 → 明确提示「暂不支持文件夹」）；
- 不做内容寻址去重、不做上传进度条（chip 用上传中/完成二态 + 失败重试）；
- 不做 UI 设置页（限制走插件 config，cordis.yml 可覆盖）；
- 不提供 vision 辅助（图片进模型靠 dsh 自带 read_image，模型能力自理）。

---

## 四、LOG 设计

原则：**每一条日志能还原一次上传的完整链路**（入口 → 接管 → 上传 → 落盘 → 注入）。

### host 侧（`ctx.logger`）

| 时机 | 级别 | 内容 |
| --- | --- | --- |
| 服务注册 | info | `[dsh-file-fix] host loaded, limits={...}` |
| persistFile 收到 | info | `persistFile session=<id> name=<name> mediaType=<t> bytes=<n>` |
| 拒绝 | warn | `persistFile rejected: <code> name=<name> bytes=<n> limit=<n>`（TOO_LARGE / INVALID_NAME / EMPTY / TOO_MANY） |
| 写入成功 | info | `persistFile ok → <relPath> (<human size>) in <ms>ms` |
| 写入失败 | error | `persistFile write failed: <cause> name=<name>` |
| remove | info | `remove <relPath> ok / not-found / failed` |

### client 侧（`ctx.logger`）

| 时机 | 级别 | 内容 |
| --- | --- | --- |
| 拦截到 drop/paste | info | `intake files=<n> images=<k> others=<m> via=<drop|paste|picker>` |
| 接管确认 | info | `intercepted: native upload suppressed, overlay reset` |
| 上传开始/完成 | info | `upload start <name> (<size>)` / `upload ok <name> → <relPath> <ms>ms` |
| 上传失败 | warn | `upload failed <name>: <code>` |
| 重试 | info | `upload retry <name>` |
| 删除 | info | `chip removed <name> → remove remote <relPath>` |
| 引用注入 | info | `ref injected: <refText>` |
| 拦截层异常 | error | 完整堆栈（吞掉异常会无声无息） |

---

## 五、已定 & 遗留

**已拍板**：完全不用官方导入链路（图片同权）；统一 rail 混排；落盘会话工作区 `attachments/`；
`@file:` 引用注入；chip 删除连带删工作区文件；交互细节全照 Hermes；无设置页；限制走 config。

**遗留（实现阶段再定）**：会话工作区目录的解析方式（session → workspace.path 映射）、
引用文本精确格式（`@file:attachments/x` vs 其他）、限流/并发控制。
