/** 会话节点定义（保留但不再注册）：
 * 历史教训 —— 客户端定义引擎对 late-registered 定义的处理不可靠（探针定义能跑、
 * 但双匹配定义不产出节点）。文件气泡改用 chat.node keyed 渲染器 shadow 方案
 * （见 UserNodeWithFiles），不再依赖 conversationEvents 注册。 */
export {}
