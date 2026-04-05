import React, { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Check, Copy } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

import "katex/dist/katex.min.css";

interface MarkdownRendererProps {
  content: string;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  // 处理流式输出时代码块未闭合的情况
  const processedContent = React.useMemo(() => {
    const codeBlockCount = (content.match(/```/g) || []).length;
    if (codeBlockCount % 2 !== 0) {
      return content + "\n```";
    }
    return content;
  }, [content]);

  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          rehypeRaw,
          [
            rehypeSanitize,
            {
              ...defaultSchema,
              attributes: {
                ...defaultSchema.attributes,
                code: [
                  ...(defaultSchema.attributes?.code || []),
                  "className",
                ],
                span: [
                  ...(defaultSchema.attributes?.span || []),
                  "className",
                  "style",
                ],
              },
            },
          ],
          [rehypeKatex, { throwOnError: false, strict: false }],
        ]}
        components={{
          code({ node, inline, className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || "");
            const isInline = inline || !match;

            if (!isInline && match) {
              return (
                <CodeBlock language={match[1]} value={String(children).replace(/\n$/, "")} {...props} />
              );
            }

            return (
              <code
                className={cn(
                  "bg-muted px-1.5 py-0.5 rounded-md text-sm font-mono text-muted-foreground",
                  className
                )}
                {...props}
              >
                {children}
              </code>
            );
          },
        }}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  );
}

function CodeBlock({ language, value, ...props }: { language: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const { theme } = useTheme();
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    if (theme === "system") {
      setIsDark(window.matchMedia("(prefers-color-scheme: dark)").matches);
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
      media.addEventListener("change", handler);
      return () => media.removeEventListener("change", handler);
    } else {
      setIsDark(theme === "dark");
    }
  }, [theme]);

  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group my-4 rounded-md overflow-hidden bg-zinc-950 dark:bg-[#1E1E1E] border border-zinc-200/10">
      <div className="flex items-center justify-between px-4 py-1.5 bg-zinc-800 dark:bg-[#2D2D2D] text-zinc-300 text-xs select-none">
        <span className="font-mono uppercase tracking-wider">{language}</span>
        <button
          onClick={handleCopy}
          className="p-1 hover:bg-zinc-700 rounded transition-colors text-zinc-400 hover:text-zinc-100"
          title="复制代码"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
      <SyntaxHighlighter
        style={isDark ? vscDarkPlus : undefined}
        language={language}
        PreTag="div"
        customStyle={{
          margin: 0,
          background: isDark ? "#1E1E1E" : "#ffffff",
          padding: "1rem",
          fontSize: "0.875rem",
        }}
        {...props}
      >
        {value}
      </SyntaxHighlighter>
    </div>
  );
}