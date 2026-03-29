import type { PropsWithChildren, ReactNode } from "react";

interface TooltipProps extends PropsWithChildren {
  content: ReactNode;
}

export function Tooltip({ children, content, className }: TooltipProps) {
  return (
    <span className={className ? `tooltip ${className}` : "tooltip"}>
      {children}
      <span className="tooltip-bubble" role="tooltip">
        {content}
      </span>
    </span>
  );
}

