# 🧹 chatbox-msg-cleaner

一个运行在 **Cloudflare Workers** 上的 MCP Server，清洗 ChatBox 导出的对话文本，**只保留用户消息**，每条消息独立分隔。

零部署成本，多设备通用，配个 URL 就能用。

## ✨ 功能

- 🔍 自动识别格式（Markdown / 纯文本 / JSON）
- 🧹 只保留用户消息，每条独立分隔
- 📝 自动提取对话标题
- 📊 对话结构分析
- ☁️ Cloudflare Workers 部署，免费、全球加速、多设备共享

## 🛠️ 工具

| 工具 | 说明 |
|------|------|
| `clean_chat_text` | 传入文本清洗，返回用户消息 |
| `analyze_chat` | 分析对话结构和统计信息 |

## ⚙️ 在 ChatBox 中配置

打开 ChatBox → 设置 → MCP，添加：

| 字段 | 值 |
|------|-----|
| 类型 | Streamable HTTP |
| URL | `https://chatboxcleaner.windlife.site/mcp` |

或者用 SSE 模式：

| 字段 | 值 |
|------|-----|
| 类型 | SSE |
| URL | `https://chatboxcleaner.windlife.site/sse` |

配好后任何设备的 ChatBox 都可以用同一个 URL。

## 📖 支持的对话格式

### Markdown

```markdown
# 帮我写一个爬虫

#### You:
你好，请帮我写一段代码

#### ChatGPT:
好的，这是代码...
```

### 纯文本

```
You:
你好

ChatGPT:
你好！
```

### JSON

```json
[
  {"role": "user", "content": "你好"},
  {"role": "assistant", "content": "你好！"}
]
```

## 🔧 工具参数

### `clean_chat_text`

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `text` | string | *必填* | 对话文本内容 |
| `numbered` | boolean | `false` | 是否给消息编号 |
| `separator` | string | `\n\n---\n\n` | 消息分隔符 |
| `output_format` | enum | `plain` | `plain` / `markdown` / `json` |

### `analyze_chat`

| 参数 | 类型 | 说明 |
|------|------|------|
| `text` | string | 对话文本内容 |

## 📋 输出示例

```
📝 对话标题：帮我写一个爬虫
📊 统计：共 10 条消息，其中用户消息 5 条

你好，请帮我写一段 Python 爬虫代码

---

能不能加个异常处理？

---

再帮我写个单元测试
```

## 📡 API 端点

| 路径 | 方法 | 说明 |
|------|------|------|
| `/mcp` | POST | Streamable HTTP MCP |
| `/sse` | GET | SSE 连接 |
| `/message` | POST | SSE 消息处理 |
| `/health` | GET | 健康检查 |

## 🚀 自行部署

如果你想部署自己的实例：

```bash
git clone https://github.com/Meldanna/chatbox-msg-cleaner.git
cd chatbox-msg-cleaner
npm install
npx wrangler login
npm run deploy
```

## 📄 License

MIT
