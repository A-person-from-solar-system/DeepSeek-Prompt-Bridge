# DeepSeek Prompt Bridge

这是一个直接增强 **DeepSeek 官网** 的 Chrome / Edge 扩展。它不创建新的聊天客户端，也不调用收费 API：你仍在 `https://chat.deepseek.com` 原始页面中聊天，继续使用官网登录状态、免费额度、深度思考、联网搜索和原有会话历史。

扩展只做一件事：在官网的聊天请求发出前，为指定会话注入你设置的系统提示词和 few-shot 示例。

## 安装

1. 打开 Chrome 的 `chrome://extensions`，或 Edge 的 `edge://extensions`。
2. 开启右上角的“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本项目中的 `extension` 文件夹。
5. 刷新已经打开的 DeepSeek 页面。

打开任意 `https://chat.deepseek.com/a/chat/s/...` 会话后，页面右上角会出现 **Prompt** 按钮。

## 使用方式

1. 登录 DeepSeek 官网并进入需要增强的会话。
2. 点击右上角的 **Prompt**。
3. 填写系统提示词，按需添加 user / assistant 示例。
4. 点击“完成”，然后像平常一样使用官网输入框发送消息。

扩展会从当前 URL 自动识别会话 ID。每个会话的配置独立保存在 `chrome.storage.local` 中；切换官网会话时，面板会自动切换对应配置。

## 工作原理

扩展的 `injected.js` 在页面主执行环境中包装 `fetch`、`XMLHttpRequest` 和 `WebSocket`，只处理 DeepSeek 聊天补全请求：

- 如果请求使用 `messages[]`，扩展会插入真正的 `system / user / assistant` 消息。
- 如果官网私有接口使用单个 `prompt` 字段，扩展会用明确的标签把系统提示词、示例和本次用户消息组合起来。
- 修改发生在官网已经读取输入框内容之后，因此官网聊天气泡仍只显示你实际输入的文字。

扩展不读取、不复制、不保存登录 token 或 Cookie，也不会向 DeepSeek 之外的服务器发送数据。认证和会话关联完全由当前官网页面负责。

## 目录

```text
extension/
  manifest.json   Chrome Manifest V3 配置
  injected.js     官网聊天请求注入器（MAIN world）
  content.js      会话识别、配置存储和页面面板
```

之前制作的独立 API 客户端仍保留在 `public/` 和 `server.js` 中，但它不是本项目当前推荐方案。

## 注意事项

- 这是非官方扩展，DeepSeek 更新私有接口后，可能需要同步更新请求匹配逻辑。
- “系统提示词”对官网私有接口而言不一定具有官方 API 中 system role 的完全同等优先级；当官网请求只提供 `prompt` 字段时，扩展使用结构化文本模拟。
- 重复向长会话注入大量示例会增加上下文长度，建议只保留真正有用的示例。
