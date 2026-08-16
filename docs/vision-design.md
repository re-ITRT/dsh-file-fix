# 视觉双路线设计（dsh-file-fix 二期）

> 目标：把「视觉」加回来——文件上传体系下，模型能否看图取决于模型模态声明。
> 设计两条工具路线，按当前模型能力动态可见，重点解决中途切换模型。

## 0. 官方机制实证（调研结论）

| 机制 | 位置 | 结论 |
| --- | --- | --- |
| 模型能力标记 | `LlmModelInfo.inputModalities?: ModelModality[]`（`'text'\|'image'`，merge-extensible） | 模型有没有视觉 = provider 声明，**非插件可绕过** |
| DeepSeek 官方模型 | `llm-deepseek/adapter.ts:113` | **全部 `['text']`**（含 V4 系列） |
| 第三方视觉接入 | `llm-pi-ai/catalog.ts`（逐模型 `image: true`）/ config `defaultInput: ['text','image']` | 自定义 gateway 可声明视觉 |
| 带图消息发送门控 | `api-proxy.ts:2482-2495` | 当前模型无 image → `MODEL_DOES_NOT_SUPPORT_IMAGES` 拒绝 |
| **切换模型门控** | `api-proxy.ts:2286-2306`（selectModel） | **会话已含图片时切到无视觉模型 → 拒绝切换** |
| 工具执行时门控先例 | `tool-fs/read-image.ts:64-76`（assertImageCapableRoute） | 执行时 `resolveModelInfo` 检查，无 image 抛错 |
| 图片 block | `llm/llm/src/types.ts:66-72` | **「only user content carries images today」** → 注入图片的消息必须 role=user |
| 模型路由权威信号 | `agent-loop/agent.ts:466-469` | 每次请求构建 `request/header` 事件（reason: initial/change）——bridge 已监听 |
| 设置页扩展 | `ui-settings/contract/slots.ts` `settings.page` slot（list） | 第三方可注册独立设置 tab（id/order/label） |
| 工具动态装卸 | `core/tools` `register()` 返回 disposer；`view(scope).visible` 每次组装实时投影 | **按模态 register/dispose 即可动态可见性**（restrict 是单调的，不可用） |

## 1. 工具一：`add_image_to_context`（视觉模型可见）

```ts
add_image_to_context(attachment_id: string, description?: string)
```

- **适用**：当前模型 `inputModalities` 含 `'image'` 时注册可见
- **行为**：图片（`ImageAttachmentRef` image block + 一行说明文字）注入**下一条 user 消息**
  - 注入路径复用现有 pre-step 机制：role=user + source {kind:'plugin', form:'notice', summary:'📷 图片已加入上下文'}
  - image block 走平台图片通道（models 自带视觉的模型直接看图）
- **执行时门控**（双保险）：resolveModelInfo 确认 image 模态，否则抛错「当前模型不支持图片，请切换到视觉模型或使用 visual_assist」
- **描述里明示**：`注入后本会话将包含图片；切换到不声明 image 输入的模型会被平台拒绝（需保持视觉模型）`

## 2. 工具二：`visual_assist`（无视觉模型可见）

```ts
visual_assist(attachment_id: string, question: string)
```

- **适用**：当前模型无 `'image'` 模态时注册可见（默认场景：DeepSeek 官方模型）
- **行为**：host 把图片字节 + 问题发给**配置的视觉辅助模型**（`llm.resolveModelInfo` 校验过 image 模态的 provider/model）→ 返回文字描述作为工具结果 → 当前模型读描述
- **与 hermes vision_tool 同模式**：辅助模型单独调用、文字返回（hermes 的 vision_analyze 即此模式：有视觉直连上下文，无视觉 fallback 辅助模型）
- **执行时门控**：辅助模型未配置 → 抛错「请在设置 → 视觉辅助 里配置视觉模型」

## 3. 设置页 tab：「视觉辅助」

- 用 `settings.page` slot 注册独立 tab（id: `uploadux-vision`，label: 视觉辅助）
- 配置项：
  - 视觉辅助 provider / model（下拉来自 `llm.listProviders()` + 模型目录；校验按钮调用 `resolveModelInfo` 显示模态徽章「✓ 支持图片」/「✗ 纯文本」）
  - 复用 dsh 现有 provider 配置（用户已有的 OpenAI 兼容/pi-ai 等 provider 均可选）
- 存储：user-settings 服务（与插件 config 分离，UI 可改）

## 4. 中途切换模型（重点设计）

**约束**（平台硬性，非插件可改）：
- 会话已含图片 → 切无视觉模型 → selectModel 拒绝
- 带图消息在无视觉模型下发送 → 拒绝

**插件侧的动态可见性**：

```
模型切换（UI selectModel）
  └─ 下一条请求构建 → request/header 事件（reason: change）→ bridge 收到
       └─ resolveModelInfo(新 provider/model) → inputModalities
            ├─ 含 'image' → dispose visual_assist + register add_image_to_context
            └─ 不含     → dispose add_image_to_context + register visual_assist
```

- 事件源：`request/header`（模型路由的权威持久信号；bridge 已监听 session/event，零新机制）
- 装卸：`tools.register()` 返回 disposer，动态 register/dispose（组装时实时投影，下一条请求即生效）
- **竞态防御**：切换瞬间旧工具仍在列表 → 两个工具执行时都做模态门控（抛明确错误引导）
- **平台约束传导**：add_image_to_context 的注入消息 + 描述明示「本会话将含图片，无视觉模型无法接管」——让模型和用户在注入前知情

**时序示例**：
1. DeepSeek（无视觉）会话：只见 `visual_assist`；模型调用它读图（辅助模型返回描述）
2. 用户切到视觉模型（如 pi-ai 视觉模型）：下一请求 header change → 工具列表切换 → 只见 `add_image_to_context`；图片注入上下文，模型直接看图
3. 再切回 DeepSeek：若会话已有图片 → 平台拒绝切换（用户需新建会话或先移除图片——UI 层选择器会报错提示）；若无图片 → 正常切回，工具列表切回 visual_assist

## 5. 与现有体系融合

- 图片走现有上传管线（persistFile 字节入库，mediaType image/*）
- 缩略图 chip / 历史气泡预览已存在（UI 层，不依赖模型视觉）
- 图片文件清单注入（现 pre-step）不区分图片/文件——视觉路由只发生在两个新工具

## 6. 实施清单

- [ ] host：`registerAddImageTool`（注入 image block 的 pre-step 路径 + 门控）
- [ ] host：`registerVisualAssistTool`（辅助模型调用：image block + question → 文字结果）
- [ ] host：模型路由监听（request/header → 模态 → 工具装卸）+ 初始注册
- [ ] host：visual_assist 配置读取（user-settings）
- [ ] client：设置页 tab（provider/model 下拉 + 校验按钮）
- [ ] 类型：`settings.page` slot 声明合并 + 工具 schema
- [ ] 测试：双模型会话切换全链路（opencli 实测）
