import { isValidElement, memo, type ReactNode } from "react";
import { CodeBlock, CodeBlockContent } from "./ui/code-block";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "./ui/table";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Message content is untrusted. Images remain explicit, authenticated attachments. */
export const MessageText = memo(function MessageText({ text }: { text: string }) {
  return <div className="message-text">
    <Markdown skipHtml remarkPlugins={[remarkGfm]} disallowedElements={["img", "input"]}
      components={{
        pre: ({children}) => <CodeBlock><CodeBlockContent>{isValidElement<{children: ReactNode}>(children) ? children.props.children : children}</CodeBlockContent></CodeBlock>,
        table: ({children, node, ...props}) => <Table {...props}>{children}</Table>, thead: ({children, node, ...props}) => <TableHeader {...props}>{children}</TableHeader>, tbody: ({children, node, ...props}) => <TableBody {...props}>{children}</TableBody>, tr: ({children, node, ...props}) => <TableRow {...props}>{children}</TableRow>, th: ({children, node, ...props}) => <TableHead {...props}>{children}</TableHead>, td: ({children, node, ...props}) => <TableCell {...props}>{children}</TableCell>,
        a: ({ children, href }) => href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span> }}>
      {text}
    </Markdown>
  </div>;
});
