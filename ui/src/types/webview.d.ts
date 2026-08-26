// Electron 的 <webview> 标签:只在 Electron 渲染器里存在,这里补上 JSX 类型。
import "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string;
          partition?: string;
          allowpopups?: string;
          useragent?: string;
        },
        HTMLElement
      >;
    }
  }
}
