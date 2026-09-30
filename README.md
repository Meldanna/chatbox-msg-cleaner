# 🧹 chatbox-msg-cleaner

一个 MCP Server，用于清洗 ChatBox 导出的对话文件（TXT / Markdown / JSON），**只保留用户消息**，每条消息独立分隔、不糊成一段。

## ✨ 功能

- 🔍 自动识别对话格式（Markdown / 纯文本 / JSON）
- 🧹 清洗后只保留用户消息，每条独立分隔
- 📝 **自动提取对话标题作为导出文件名**
- 💾 支持导出为 TXT / Markdown / JSON
- 📊 对话结构分析

## 📦 安装

```bash
git clone https://github.com/Meldanna/chatbox-msg-cleaner.git
cd chatbox-msg-cleaner
npm install
npm run build
```

## ⚙️ 配置

在你的 MCP 客户端（ChatBox / Claude Desktop 等）中添加：

```json
{
  "mcpServers": {
    "chatbox-cleaner": {
      "command": "node",
      "args": ["/你的绝对路径/chatbox-msg-cleaner/dist/index.js"]
    }
  }
}
```

## 🛠️ 提供的工具

| 工具 | 说明 |
|------|------|
| `clean_chat_text` | 直接传入文本清洗，返回用户消息 |
| `clean_chat_file` | 从文件路径读取清洗，支持保存结果到文件 |
| `analyze_chat` | 分析对话结构，查看角色分布和消息统计 |

## 📖 支持的导出格式

### Markdown 格式

```markdown
# 帮我写一个爬虫

#### You:
你好，请帮我写一段代码

#### ChatGPT:
好的，这是代码...
```

### 纯文本格式

```
You:
你好，请帮我写一段代码

ChatGPT:
好的...
```

### JSON 格式

```json
{
  "title": "帮我写一个爬虫",
  "messages": [
    {"role": "user", "content": "你好"},
    {"role": "assistant", "content": "你好！"}
  ]
}
```

## 🔧 工具参数

### `clean_chat_text`

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `text` | string | *必填* | 对话文本内容 |
| `numbered` | boolean | `false` | 是否给每条消息编号 |
| `separator` | string | `\n\n---\n\n` | 消息之间的分隔符 |
| `output_format` | enum | `plain` | 输出格式：`plain` / `markdown` / `json` |
| `save_to` | string | 可选 | 保存路径（见下方说明） |

### `clean_chat_file`

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `file_path` | string | *必填* | 文件路径 |
| `numbered` | boolean | `false` | 是否编号 |
| `output_format` | enum | `plain` | 输出格式 |
| `save_to` | string | 可选 | 保存路径（见下方说明） |

### `analyze_chat`

| 参数 | 类型 | 说明 |
|------|------|------|
| `text` | string | 对话文本内容 |

## 💾 save_to 参数说明

`save_to` 支持三种用法：

| 传值 | 行为 |
|------|------|
| `"auto"` | 自动用对话标题命名，如 `帮我写一个爬虫_cleaned.txt` |
| 目录路径 | 自动生成文件名放入该目录 |
| 完整文件路径 | 直接保存到该路径 |

找不到对话标题时，自动用时间戳命名：`chat_cleaned_20260930_1430.txt`

## 📋 输出示例

清洗后每条用户消息**独立分隔**：

```
📝 对话标题：帮我写一个爬虫
📊 统计：共 10 条消息，其中用户消息 5 条

你好，请帮我写一段 Python 爬虫代码

---

能不能加个异常处理？

---

再帮我写个单元测试

---

谢谢，最后帮我加上注释

---

完美，就这样
```

导出到文件：

```
✅ 清洗完成！
📝 对话标题：帮我写一个爬虫
📊 共 10 条消息，用户消息 5 条
💾 已保存至：/path/to/帮我写一个爬虫_cleaned.txt
```

## 📄 License

MIT
