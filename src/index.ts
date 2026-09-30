import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";

// ============================================================
// 类型定义
// ============================================================

interface ParsedMessage {
  role: string;
  content: string;
}

// ============================================================
// ChatBox 导出格式解析器
// ============================================================

/**
 * 解析 ChatBox 导出的 Markdown 格式
 *
 * 支持的格式：
 *   #### You:
 *   用户消息内容...
 *
 *   #### ChatGPT:
 *   AI回复内容...
 *
 *   **User:**
 *   用户消息...
 */
function parseMarkdown(text: string): ParsedMessage[] {
  const messages: ParsedMessage[] = [];
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const splitPattern =
    /^(?:#{1,6}\s+(.+?)[:：]\s*$|^\*\*(.+?)[:：]\*\*\s*$|^>\s*\*\*(.+?)[:：]\*\*\s*$)/gm;

  const segments: { role: string; startIndex: number }[] = [];
  let match: RegExpExecArray | null;

  while ((match = splitPattern.exec(text)) !== null) {
    const role = (match[1] || match[2] || match[3]).trim();
    segments.push({ role, startIndex: match.index + match[0].length });
  }

  for (let i = 0; i < segments.length; i++) {
    const start = segments[i].startIndex;
    const end =
      i + 1 < segments.length
        ? text.lastIndexOf("\n", segments[i + 1].startIndex - 1)
        : text.length;
    const content = text.slice(start, end).trim();
    if (content) {
      messages.push({
        role: normalizeRole(segments[i].role),
        content,
      });
    }
  }

  return messages;
}

/**
 * 解析 ChatBox 导出的纯文本格式
 *
 *   You:
 *   消息内容...
 *
 *   ChatGPT:
 *   AI回复...
 */
function parsePlainText(text: string): ParsedMessage[] {
  const messages: ParsedMessage[] = [];
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const rolePattern =
    /^(You|User|我|用户|Human|ChatGPT|GPT|Assistant|AI|Claude|Bot|System|系统|助手)\s*[:：]\s*$/gim;

  const segments: { role: string; startIndex: number }[] = [];
  let match: RegExpExecArray | null;

  while ((match = rolePattern.exec(text)) !== null) {
    const role = match[1].trim();
    segments.push({ role, startIndex: match.index + match[0].length });
  }

  for (let i = 0; i < segments.length; i++) {
    const start = segments[i].startIndex;
    const end =
      i + 1 < segments.length
        ? text.lastIndexOf("\n", segments[i + 1].startIndex - 1)
        : text.length;
    const content = text.slice(start, end).trim();
    if (content) {
      messages.push({
        role: normalizeRole(segments[i].role),
        content,
      });
    }
  }

  return messages;
}

/**
 * 解析 JSON 格式（ChatBox 也支持 JSON 导出）
 */
function parseJSON(text: string): ParsedMessage[] {
  try {
    const data = JSON.parse(text);
    const messages: ParsedMessage[] = [];
    const items = Array.isArray(data)
      ? data
      : data.messages || data.data || [];

    for (const item of items) {
      if (item.role && item.content) {
        messages.push({
          role: normalizeRole(item.role),
          content:
            typeof item.content === "string"
              ? item.content
              : JSON.stringify(item.content),
        });
      }
    }
    return messages;
  } catch {
    return [];
  }
}

/**
 * 统一角色名称
 */
function normalizeRole(role: string): string {
  const lower = role.toLowerCase().trim();

  const userNames = ["you", "user", "human", "我", "用户", "me"];
  const assistantNames = [
    "chatgpt", "gpt", "assistant", "ai", "claude",
    "bot", "助手", "机器人", "copilot", "gemini",
    "deepseek", "grok", "chatbox",
  ];
  const systemNames = ["system", "系统"];

  if (userNames.includes(lower)) return "user";
  if (assistantNames.includes(lower)) return "assistant";
  if (systemNames.includes(lower)) return "system";

  return lower;
}

/**
 * 自动检测格式并解析
 */
function autoParseChat(text: string): ParsedMessage[] {
  const trimmed = text.trim();

  // 尝试 JSON
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const result = parseJSON(trimmed);
    if (result.length > 0) return result;
  }

  // 尝试 Markdown
  if (
    /^#{1,6}\s+.+[:：]\s*$/m.test(trimmed) ||
    /^\*\*.+[:：]\*\*\s*$/m.test(trimmed)
  ) {
    const result = parseMarkdown(trimmed);
    if (result.length > 0) return result;
  }

  // 纯文本
  const result = parsePlainText(trimmed);
  if (result.length > 0) return result;

  // 兜底：全部试一遍
  for (const parser of [parseMarkdown, parsePlainText]) {
    const r = parser(trimmed);
    if (r.length > 0) return r;
  }

  return [];
}

/**
 * 过滤并格式化用户消息 —— 每条消息独立，不糊成一段
 */
function extractUserMessages(
  messages: ParsedMessage[],
  options: {
    includeIndex: boolean;
    separator: string;
    trimEmpty: boolean;
  }
): string {
  let userMessages = messages.filter((m) => m.role === "user");

  if (options.trimEmpty) {
    userMessages = userMessages.filter((m) => m.content.trim().length > 0);
  }

  if (options.includeIndex) {
    return userMessages
      .map((m, i) => `[${i + 1}]\n${m.content}`)
      .join(options.separator);
  }

  return userMessages.map((m) => m.content).join(options.separator);
}

// ============================================================
// MCP Server
// ============================================================

const server = new McpServer({
  name: "chatbox-msg-cleaner",
  version: "1.0.0",
});

/**
 * 工具1: clean_chat_text
 * 直接传入文本内容进行清洗
 */
server.tool(
  "clean_chat_text",
  "清洗 ChatBox 导出的对话文本，只保留用户消息。直接传入文本内容。",
  {
    text: z.string().describe("ChatBox 导出的对话文本内容（TXT / Markdown / JSON）"),
    numbered: z
      .boolean()
      .default(false)
      .describe("是否给每条消息编号，默认 false"),
    separator: z
      .string()
      .default("\n\n---\n\n")
      .describe("消息之间的分隔符，默认用 --- 分隔线"),
    output_format: z
      .enum(["plain", "markdown", "json"])
      .default("plain")
      .describe("输出格式：plain 纯文本 / markdown / json"),
  },
  async ({ text, numbered, separator, output_format }) => {
    const messages = autoParseChat(text);

    if (messages.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: "⚠️ 未能识别出对话结构。请检查文本格式是否为 ChatBox 的导出格式。\n\n支持的格式：\n- Markdown：`#### You:` / `**User:**` 开头\n- 纯文本：`You:` / `User:` / `我:` 开头\n- JSON：`[{role, content}]` 数组",
          },
        ],
      };
    }

    const totalMessages = messages.length;
    const userMessages = messages.filter((m) => m.role === "user");
    const userCount = userMessages.length;

    let output: string;

    if (output_format === "json") {
      output = JSON.stringify(
        userMessages.map((m, i) => ({
          index: i + 1,
          content: m.content,
        })),
        null,
        2
      );
    } else if (output_format === "markdown") {
      output = userMessages
        .map(
          (m, i) =>
            `### ${numbered ? `消息 ${i + 1}` : "用户消息"}\n\n${m.content}`
        )
        .join("\n\n---\n\n");
    } else {
      output = extractUserMessages(messages, {
        includeIndex: numbered,
        separator,
        trimEmpty: true,
      });
    }

    const stats = `📊 统计：共 ${totalMessages} 条消息，其中用户消息 ${userCount} 条`;

    return {
      content: [
        {
          type: "text" as const,
          text: `${stats}\n\n${output}`,
        },
      ],
    };
  }
);

/**
 * 工具2: clean_chat_file
 * 从文件路径读取并清洗
 */
server.tool(
  "clean_chat_file",
  "从文件路径读取 ChatBox 导出的对话文件并清洗，只保留用户消息。",
  {
    file_path: z.string().describe("文件路径（支持 .txt / .md / .json）"),
    numbered: z
      .boolean()
      .default(false)
      .describe("是否给消息编号"),
    output_format: z
      .enum(["plain", "markdown", "json"])
      .default("plain")
      .describe("输出格式"),
    save_to: z
      .string()
      .optional()
      .describe("可选：保存清洗结果到指定文件路径"),
  },
  async ({ file_path, numbered, output_format, save_to }) => {
    const resolvedPath = path.resolve(file_path);

    if (!fs.existsSync(resolvedPath)) {
      return {
        content: [
          {
            type: "text" as const,
            text: `❌ 文件不存在：${resolvedPath}`,
          },
        ],
      };
    }

    const text = fs.readFileSync(resolvedPath, "utf-8");
    const messages = autoParseChat(text);

    if (messages.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: "⚠️ 未能识别出对话结构，请确认文件是 ChatBox 的导出格式。",
          },
        ],
      };
    }

    const userMessages = messages.filter((m) => m.role === "user");
    const userCount = userMessages.length;
    const totalMessages = messages.length;

    let output: string;

    if (output_format === "json") {
      output = JSON.stringify(
        userMessages.map((m, i) => ({
          index: i + 1,
          content: m.content,
        })),
        null,
        2
      );
    } else if (output_format === "markdown") {
      output = userMessages
        .map(
          (m, i) =>
            `### ${numbered ? `消息 ${i + 1}` : "用户消息"}\n\n${m.content}`
        )
        .join("\n\n---\n\n");
    } else {
      output = extractUserMessages(messages, {
        includeIndex: numbered,
        separator: "\n\n---\n\n",
        trimEmpty: true,
      });
    }

    // 保存到文件
    if (save_to) {
      const savePath = path.resolve(save_to);
      fs.mkdirSync(path.dirname(savePath), { recursive: true });
      fs.writeFileSync(savePath, output, "utf-8");

      return {
        content: [
          {
            type: "text" as const,
            text: `✅ 清洗完成！\n📊 共 ${totalMessages} 条消息，提取用户消息 ${userCount} 条\n💾 已保存至：${savePath}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `📊 文件: ${path.basename(resolvedPath)}\n共 ${totalMessages} 条消息，用户消息 ${userCount} 条\n\n${output}`,
        },
      ],
    };
  }
);

/**
 * 工具3: analyze_chat
 * 分析对话结构
 */
server.tool(
  "analyze_chat",
  "分析 ChatBox 对话文件的结构，查看角色分布和消息统计。",
  {
    text: z.string().describe("对话文本内容"),
  },
  async ({ text }) => {
    const messages = autoParseChat(text);

    if (messages.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: "⚠️ 未能识别出对话结构。",
          },
        ],
      };
    }

    const roleStats: Record<string, number> = {};
    const roleLengths: Record<string, number> = {};

    for (const m of messages) {
      roleStats[m.role] = (roleStats[m.role] || 0) + 1;
      roleLengths[m.role] = (roleLengths[m.role] || 0) + m.content.length;
    }

    let report = `## 📊 对话分析报告\n\n`;
    report += `- **总消息数**：${messages.length}\n\n`;
    report += `| 角色 | 消息数 | 平均字数 | 总字数 |\n`;
    report += `|------|--------|----------|--------|\n`;

    for (const [role, count] of Object.entries(roleStats)) {
      const avgLen = Math.round(roleLengths[role] / count);
      report += `| ${role} | ${count} 条 | ${avgLen} 字/条 | ${roleLengths[role]} 字 |\n`;
    }

    report += `\n### 前 3 条用户消息预览\n\n`;
    const userPreview = messages
      .filter((m) => m.role === "user")
      .slice(0, 3);
    for (const [i, m] of userPreview.entries()) {
      const preview =
        m.content.length > 100
          ? m.content.slice(0, 100) + "..."
          : m.content;
      report += `${i + 1}. ${preview}\n`;
    }

    return {
      content: [
        {
          type: "text" as const,
          text: report,
        },
      ],
    };
  }
);

// ============================================================
// 启动
// ============================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("🧹 ChatBox Msg Cleaner MCP Server 已启动");
}

main().catch(console.error);
